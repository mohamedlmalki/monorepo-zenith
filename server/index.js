import express from 'express';
import cors from 'cors';
import { findApps } from './app-discovery.js';
import { getAppDetails } from './app-details.js';
import { exec, spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { Server } from 'socket.io';
import http from 'http';
import { createProxyMiddleware } from 'http-proxy-middleware';


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
    let status = 'stopped';
    if (runningProcess) {
        status = runningProcess.status || 'running';
    }
    return {
      ...app,
      status,
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
          io.emit('installation-complete', { appName, success: false });
          return reject(new Error(`Installation failed in ${workspacePath}: ${stderr}`));
        }
        console.log(`Installation successful for ${workspacePath}.`);
        resolve(stdout);
      });
    });
  });

  try {
    await Promise.all(installPromises);
    io.emit('installation-complete', { appName, success: true });
    res.json({ message: `Dependencies for ${appName} installed successfully in all workspaces.` });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

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
    
    const backendKeywords = ['server', 'backend', 'api', 'services'];
    const frontendWorkspace = appToStart.workspaces.find(workspace => !backendKeywords.some(keyword => workspace.toLowerCase().includes(keyword)));
    const mainWorkspacePath = path.join(MONOREPO_ROOT, frontendWorkspace || appToStart.workspaces[0]);

    console.log(`Starting app '${appName}' from workspace: ${mainWorkspacePath}`);
    io.emit('app-starting', { appName });

    // Create a proxy for the app
    const proxyPort = 4000 + runningApps.size;
    const proxy = createProxyMiddleware({
        target: 'http://localhost', // a placeholder, will be overridden by router
        router: (req) => {
            const url = new URL(req.url, `http://${req.headers.host}`);
            return url.origin;
        },
        changeOrigin: true,
        selfHandleResponse: true,
        onProxyReq: (proxyReq, req, res) => {
            let body = '';
            req.on('data', (chunk) => body += chunk);
            req.on('end', () => {
                io.emit('network-request', {
                    appName,
                    request: {
                        id: proxyReq.getHeader('x-request-id'),
                        method: req.method,
                        url: req.url,
                        headers: req.headers,
                        body: body,
                        timestamp: Date.now(),
                    },
                });
            });
        },
        onProxyRes: (proxyRes, req, res) => {
          let body = [];
          proxyRes.on('data', chunk => body.push(chunk));
          proxyRes.on('end', () => {
            const bodyBuffer = Buffer.concat(body);
            io.emit('network-response', {
              appName,
              response: {
                id: req.headers['x-request-id'],
                status: proxyRes.statusCode,
                headers: proxyRes.headers,
                body: bodyBuffer.toString('utf8'),
                timestamp: Date.now(),
              },
            });
            res.end(bodyBuffer);
          });
        }
    });

    const proxyApp = express();
    proxyApp.use((req, res, next) => {
      req.headers['x-request-id'] = Math.random().toString(36).substring(7);
      next();
    }, proxy);
    const proxyServer = proxyApp.listen(proxyPort);
    
    const appProcess = spawn('npm', ['run', 'dev'], { 
        cwd: mainWorkspacePath,
        shell: true,
        stdio: 'pipe',
        env: { ...process.env, HTTP_PROXY: `http://localhost:${proxyPort}` }
    });

    runningApps.set(appName, { process: appProcess, status: 'starting', proxyServer, startTime: Date.now() });
    
    let urlFound = false;
    let stdoutBuffer = '';

    const urlRegex = /(https?:\/\/[^\s]+)/;
    const ansiRegex = /\x1b\[[0-9;]*m/g;

    const processLogLine = (line) => {
        io.emit('logs', { appName, log: line });
        const runningApp = runningApps.get(appName);
        if (runningApp && runningApp.status === 'starting') {
            runningApp.status = 'running';
            io.emit('app-running', { appName });
        }


        if (urlFound) return;
        
        const match = line.match(urlRegex);
        if (!match) return;

        const rawUrl = match[0];
        const cleanUrl = rawUrl.replace(ansiRegex, '').trim().replace(/\/$/, '');

        if (line.includes('[dev:client]') && line.includes('Local:')) {
            urlFound = true;
            console.log(`[dev:server] Found primary frontend URL for ${appName}: ${cleanUrl}`);
            io.emit('app-url', { appName, url: cleanUrl });
            return;
        }

        if (line.includes('[dev:server]')) {
            console.log(`[dev:server] Ignoring potential backend URL: ${cleanUrl}`);
            return;
        }

        urlFound = true;
        console.log(`[dev:server] Found general URL for ${appName}: ${cleanUrl}`);
        io.emit('app-url', { appName, url: cleanUrl });
    };

    const processDataChunk = (data) => {
        stdoutBuffer += data.toString();
        let lines = stdoutBuffer.split('\n');
        stdoutBuffer = lines.pop() || '';
        lines.forEach(line => processLogLine(line));
    };
    
    appProcess.stdout.on('data', processDataChunk);
    appProcess.stderr.on('data', processDataChunk);
    
    appProcess.on('exit', (code) => {
        if (stdoutBuffer) {
            processLogLine(stdoutBuffer);
        }
        console.log(`App '${appName}' exited with code ${code}`);
        io.emit('logs', { appName, log: `Process exited with code ${code}` });
        io.emit('app-stopped', { appName });
        runningApps.delete(appName);
    });

    res.json({ message: `App '${appName}' started successfully.` });
});

app.post('/api/apps/:appName/stop', (req, res) => {
    const { appName } = req.params;
    const appData = runningApps.get(appName);

    if (!appData) {
        return res.status(404).json({ message: 'App is not running.' });
    }
    
    io.emit('app-stopping', { appName });
    appData.status = 'stopping';

    try {
        if (process.platform === 'win32') {
            exec(`taskkill /pid ${appData.process.pid} /t /f`, (error) => {
              if (error) {
                console.error(`taskkill error: ${error}`);
              }
              runningApps.delete(appName);
              io.emit('app-stopped', { appName });
            });
        } else {
            appData.process.kill('SIGTERM', (error) => {
              if (error) {
                console.error(`kill error: ${error}`);
              }
              runningApps.delete(appName);
              io.emit('app-stopped', { appName });
            });
        }
        
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
