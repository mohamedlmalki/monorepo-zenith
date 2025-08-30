import fs from 'fs/promises';
import path from 'path';

// Correctly define the monorepo root once
const MONOREPO_ROOT = path.resolve(process.cwd(), '..');
const MONOREPO_CONFIG_PATH = path.join(MONOREPO_ROOT, 'monorepo.json');

/**
 * Reads the monorepo.json file to discover all configured applications.
 * @returns {Promise<Array<{name: string, path: string, isInstalled: boolean}>>} A list of found applications.
 */
export async function findApps() {
  try {
    const configFile = await fs.readFile(MONOREPO_CONFIG_PATH, 'utf-8');
    const config = JSON.parse(configFile);
    const apps = [];

    for (const appConfig of config.apps) {
      // For now, we'll check the first workspace for installation status.
      // This will be improved later to check all workspaces.
      const mainWorkspacePath = path.join(MONOREPO_ROOT, appConfig.workspaces[0]);
      const nodeModulesPath = path.join(mainWorkspacePath, 'node_modules');
      
      let isInstalled = false;
      try {
        await fs.access(nodeModulesPath);
        isInstalled = true;
      } catch (error) {
        // node_modules does not exist
      }
      
      apps.push({
        name: appConfig.name,
        path: mainWorkspacePath, // We'll use the main path for now
        workspaces: appConfig.workspaces,
        isInstalled,
      });
    }
    return apps;

  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error('Error: monorepo.json not found in the root directory.');
      return [];
    }
    console.error('Error reading or parsing monorepo.json:', error);
    return [];
  }
}

