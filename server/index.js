import express from 'express';
import cors from 'cors';
import { findApps } from './app-discovery.js';
import { getAppDetails } from './app-details.js';
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

// --- UPDATED ENDPOINT ---

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
    
    // New logic to find the main workspace path, prioritizing non-backend workspaces.
    // This makes the app smarter by looking for a frontend-like name.
    const backendKeywords = ['server', 'backend', 'api', 'services'];
    const frontendWorkspace = appToStart.workspaces.find(workspace => !backendKeywords.some(keyword => workspace.toLowerCase().includes(keyword)));
    const mainWorkspacePath = path.join(MONOREPO_ROOT, frontendWorkspace || appToStart.workspaces[0]);

    console.log(`Starting app '${appName}' from workspace: ${mainWorkspacePath}`);
    
    const appProcess = spawn('npm', ['run', 'dev'], { 
        cwd: mainWorkspacePath,
        shell: true,
        stdio: 'pipe'
    });

    runningApps.set(appName, appProcess);
    
    let urlFound = false;
    let frontendUrl = null;
    let fallbackUrl = null;

    const urlRegex = /(https?:\/\/(localhost|127\.0\.0\.1):\d+)/;
    
    const processLog = (log) => {
        io.emit('logs', { appName, log });

        if (!urlFound) {
            const match = log.match(urlRegex);
            if (match) {
                const url = match[0];
                if (log.toLowerCase().includes('server')) {
                    // This is a backend URL, save it as a fallback
                    if (!fallbackUrl) {
                        fallbackUrl = url;
                        console.log(`Found backend URL (fallback) for ${appName}: ${url}`);
                    }
                } else {
                    // This is a frontend URL, use it immediately
                    frontendUrl = url;
                    urlFound = true;
                    console.log(`Found frontend URL for ${appName}: ${url}`);
                    io.emit('app-url', { appName, url });
                }
            }
        }
    }

    // A small delay to ensure we give the frontend time to start and log its URL
    setTimeout(() => {
        if (!urlFound && fallbackUrl) {
            console.log(`Using fallback URL for ${appName}: ${fallbackUrl}`);
            io.emit('app-url', { appName, url: fallbackUrl });
        }
    }, 2000); 

    appProcess.stdout.on('data', (data) => processLog(data.toString()));
    appProcess.stderr.on('data', (data) => processLog(`ERROR: ${data.toString()}`));
    
    appProcess.on('exit', (code) => {
        console.log(`App '${appName}' exited with code ${code}`);
        io.emit('logs', { appName, log: `Process exited with code ${code}` });
        io.emit('app-stopped', { appName });
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
    
    // Kill the process
    try {
        if (process.platform === 'win32') {
            exec(`taskkill /pid ${appProcess.pid} /t /f`);
        } else {
            appProcess.kill();
        }
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

app.get('/api/apps/:appName/details', async (req, res) => {
    const { appName } = req.params;
    const apps = await findApps();
    const app = apps.find(app => app.name === appName);

    if (!app) {
        return res.status(404).json({ message: 'App not found' });
    }

    try {
        const details = await getAppDetails(app);
        res.json(details);
    } catch (error) {
        console.error(`Error getting details for ${appName}:`, error);
        res.status(500).json({ message: 'Failed to get app details.' });
    }
});


server.listen(port, () => {
  console.log(`Backend server listening on http://localhost:${port}`);
});