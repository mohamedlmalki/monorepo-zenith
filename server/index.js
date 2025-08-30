import express from 'express';
import cors from 'cors';
import { findApps } from './app-discovery.js';
import { exec, spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { Server } from 'socket.io';
import http from 'http';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:8079", // Or your frontend's origin
    methods: ["GET", "POST"]
  }
});

const port = 2999;

const MONOREPO_ROOT = path.resolve(process.cwd(), '..');
const MONOREPO_CONFIG_PATH = path.join(MONOREPO_ROOT, 'monorepo.json');

// This will keep track of running app processes
const runningApps = new Map();

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send('Monorepo Dashboard Backend is running!');
});

app.get('/api/apps', async (req, res) => {
  const apps = await findApps();
  // Add the running status to the app list
  const appsWithStatus = apps.map(app => {
    const runningProcess = runningApps.get(app.name);
    return {
      ...app,
      status: runningProcess ? 'running' : 'stopped',
    }
  });
  res.json(appsWithStatus);
});

app.post('/api/apps', async (req, res) => {
    const { name, workspaces } = req.body;
  
    if (!name || !workspaces || !Array.isArray(workspaces) || workspaces.length === 0) {
      return res.status(400).json({ message: 'Invalid app data provided.' });
    }
  
    try {
      const configData = await fs.readFile(MONOREPO_CONFIG_PATH, 'utf-8');
      const config = JSON.parse(configData);
      
      if (config.apps.find(app => app.name === name)) {
          return res.status(409).json({ message: `App '${name}' already exists.` });
      }

      config.apps.push({ name, workspaces });
      await fs.writeFile(MONOREPO_CONFIG_PATH, JSON.stringify(config, null, 2));
  
      console.log(`Added new app '${name}' to monorepo.json`);
      res.status(201).json({ message: 'App added successfully' });
    } catch (error) {
      console.error('Error updating monorepo.json:', error);
      res.status(500).json({ message: 'Failed to update monorepo configuration.' });
    }
});


app.post('/api/apps/:appName/install', async (req, res) => {
  const { appName } = req.params;
  const apps = await findApps();
  const appToInstall = apps.find(app => app.name === appName);

  if (!appToInstall) {
    return res.status(404).json({ message: 'App not found' });
  }

  const installPromises = appToInstall.workspaces.map(workspacePath => {
    return new Promise((resolve, reject) => {
      const fullPath = path.join(MONOREPO_ROOT, workspacePath);
      console.log(`Starting installation in: ${fullPath}`);
      exec('npm install', { cwd: fullPath }, (error, stdout, stderr) => {
        if (error) {
          console.error(`exec error in ${workspacePath}: ${error}`);
          return reject(new Error(`Installation failed in ${workspacePath}: ${stderr}`));
        }
        console.log(`Installation successful for ${workspacePath}.`);
        resolve(stdout);
      });
    });
  });

  try {
    await Promise.all(installPromises);
    res.json({ message: `Dependencies for ${appName} installed successfully in all workspaces.` });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// --- NEW ENDPOINTS ---

app.post('/api/apps/:appName/start', async (req, res) => {
    const { appName } = req.params;
    if (runningApps.has(appName)) {
        return res.status(409).json({ message: 'App is already running.' });
    }

    const apps = await findApps();
    const appToStart = apps.find(app => app.name === appName);
    if (!appToStart) {
        return res.status(404).json({ message: 'App not found.' });
    }
    
    // We assume the primary workspace is the first one listed
    const mainWorkspacePath = path.join(MONOREPO_ROOT, appToStart.workspaces[0]);
    
    const appProcess = spawn('npm', ['run', 'dev'], { 
        cwd: mainWorkspacePath,
        shell: true,
        stdio: 'pipe'
    });

    runningApps.set(appName, appProcess);
    
    console.log(`Started app '${appName}' with PID: ${appProcess.pid}`);
    
    appProcess.stdout.on('data', (data) => {
      io.emit('logs', { appName, log: data.toString() });
    });
    appProcess.stderr.on('data', (data) => {
      io.emit('logs', { appName, log: `ERROR: ${data.toString()}` });
    });
    
    appProcess.on('exit', (code) => {
        console.log(`App '${appName}' exited with code ${code}`);
        io.emit('logs', { appName, log: `Process exited with code ${code}` });
        runningApps.delete(appName);
    });

    res.json({ message: `App '${appName}' started successfully.` });
});

app.post('/api/apps/:appName/stop', (req, res) => {
    const { appName } = req.params;
    const appProcess = runningApps.get(appName);

    if (!appProcess) {
        return res.status(404).json({ message: 'App is not running.' });
    }
    
    // Kill the process group to ensure child processes are also terminated
    try {
        process.kill(-appProcess.pid);
        runningApps.delete(appName);
        console.log(`Stopped app '${appName}'`);
        res.json({ message: `App '${appName}' stopped successfully.` });
    } catch (error) {
        console.error(`Error stopping app ${appName}:`, error);
        res.status(500).json({ message: 'Failed to stop the app.' });
    }
});


app.delete('/api/apps/:appName', async (req, res) => {
    const { appName } = req.params;
    try {
        const configData = await fs.readFile(MONOREPO_CONFIG_PATH, 'utf-8');
        const config = JSON.parse(configData);
        const appIndex = config.apps.findIndex(app => app.name === appName);
        if (appIndex === -1) {
            return res.status(404).json({ message: `App '${appName}' not found.` });
        }
        config.apps.splice(appIndex, 1);
        await fs.writeFile(MONOREPO_CONFIG_PATH, JSON.stringify(config, null, 2));
        console.log(`Removed app '${appName}' from monorepo.json`);
        res.status(200).json({ message: `App '${appName}' removed successfully.` });
    } catch (error) {
        console.error('Error updating monorepo.json:', error);
        res.status(500).json({ message: 'Failed to update monorepo configuration.' });
    }
});


server.listen(port, () => {
  console.log(`Backend server listening on http://localhost:${port}`);
});