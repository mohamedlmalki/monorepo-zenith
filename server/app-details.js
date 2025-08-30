import fs from 'fs/promises';
import path from 'path';

const MONOREPO_ROOT = path.resolve(process.cwd(), '..');

async function getFileStats(dir, ignore) {
    let fileCount = 0;
    let totalSize = 0;
    const fileTypes = {};

    async function scan(directory) {
        const files = await fs.readdir(directory, { withFileTypes: true });
        for (const file of files) {
            const fullPath = path.join(directory, file.name);
            if (ignore.some(i => fullPath.includes(i))) {
                continue;
            }

            if (file.isDirectory()) {
                await scan(fullPath);
            } else {
                fileCount++;
                const stats = await fs.stat(fullPath);
                totalSize += stats.size;
                const ext = path.extname(file.name);
                fileTypes[ext] = (fileTypes[ext] || 0) + 1;
            }
        }
    }

    await scan(dir);
    return { fileCount, totalSize, fileTypes };
}


async function findPorts(workspaces, ignore) {
    const ports = new Set();
    const portRegex = /(listen|port|PORT)\s*[:=]\s*(\d{4,5})/g;

    for (const workspace of workspaces) {
        const workspacePath = path.join(MONOREPO_ROOT, workspace);
        async function scan(directory) {
            const files = await fs.readdir(directory, { withFileTypes: true });
            for (const file of files) {
                const fullPath = path.join(directory, file.name);
                if (ignore.some(i => fullPath.includes(i))) {
                    continue;
                }

                if (file.isDirectory()) {
                    await scan(fullPath);
                } else if (/\.(js|ts|tsx|jsx)$/.test(file.name)) {
                    try {
                        const content = await fs.readFile(fullPath, 'utf-8');
                        let match;
                        while ((match = portRegex.exec(content)) !== null) {
                            ports.add(parseInt(match[2], 10));
                        }
                    } catch (error) {
                        // ignore read errors
                    }
                }
            }
        }
        await scan(workspacePath);
    }
    return Array.from(ports);
}

export async function getAppDetails(app) {
    const appPath = path.join(MONOREPO_ROOT, app.workspaces[0]);

    const packageJsonPath = path.join(appPath, 'package.json');
    let packageJson = {};
    try {
        const packageJsonContent = await fs.readFile(packageJsonPath, 'utf-8');
        packageJson = JSON.parse(packageJsonContent);
    } catch (error) {
        // package.json might not exist
    }

    const ignore = ['node_modules', 'dist', 'build'];
    const stats = await getFileStats(appPath, ignore);
    const ports = await findPorts(app.workspaces, ignore);

    return {
        packageJson,
        stats,
        ports,
    };
}