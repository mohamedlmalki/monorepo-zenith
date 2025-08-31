import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import AnsiToHtml from 'ansi-to-html';
import {
  PlayCircle,
  StopCircle,
  RotateCw,
  Eraser,
  Clipboard,
  Hammer,
  RefreshCw,
  ArrowUpCircle,
  Plus,
  AlertTriangle,
  CheckCircle,
  Clock,
  Loader2,
  Download,
  X,
  PlusCircle,
  Trash2,
  MoreVertical,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";

// --- Types ---
interface App {
  name: string;
  status: 'stopped' | 'starting' | 'running' | 'error' | 'building' | 'installing';
  isInstalled: boolean;
  workspaces: string[];
}

interface AppDetails {
  packageJson: {
    name?: string;
    version?: string;
    description?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };
  stats: {
    fileCount: number;
    totalSize: number;
    fileTypes: Record<string, number>;
  };
  ports: number[];
}

// --- Status Indicator Component ---
const StatusIndicator: React.FC<{ status: App['status'] }> = ({ status }) => {
  const getStatusConfig = (status: App['status']) => {
    switch (status) {
      case 'running': return { className: 'status-running', icon: null };
      case 'starting':
      case 'building':
      case 'installing':
        return { className: 'animate-spin', icon: <Loader2 className="w-3 h-3 text-status-starting" /> };
      case 'error': return { className: 'status-error', icon: null };
      default: return { className: 'status-stopped', icon: null };
    }
  };
  const config = getStatusConfig(status);
  return config.icon ? config.icon : <div className={`status-dot ${config.className}`} />;
};

// --- Add App Dialog Component ---
const AddAppDialog: React.FC<{ onAppAdded: () => void }> = ({ onAppAdded }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [appName, setAppName] = useState('');
    const [appFolder, setAppFolder] = useState('');
    const [workspaces, setWorkspaces] = useState(['.']); // Default to root workspace
    const { toast } = useToast();

    const handleAddWorkspace = () => {
        setWorkspaces([...workspaces, '']);
    };

    const handleRemoveWorkspace = (index: number) => {
        setWorkspaces(workspaces.filter((_, i) => i !== index));
    };

    const handleWorkspaceChange = (index: number, value: string) => {
        const newWorkspaces = [...workspaces];
        newWorkspaces[index] = value;
        setWorkspaces(newWorkspaces);
    };
    
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        
        const trimmedAppName = appName.trim();
        const trimmedAppFolder = appFolder.trim();

        const finalWorkspaces = workspaces
            .map(w => {
                const trimmedWorkspace = w.trim();
                if (trimmedWorkspace === '.') return `apps/${trimmedAppFolder}`;
                return `apps/${trimmedAppFolder}/${trimmedWorkspace}`.replace(/\/$/, '');
            })
            .filter((w, i, arr) => arr.indexOf(w) === i); // remove duplicates

        if (!trimmedAppName || !trimmedAppFolder || workspaces.some(w => !w.trim())) {
            toast({ title: 'Validation Error', description: 'App Name, App Folder, and all workspace paths are required.', variant: 'destructive' });
            return;
        }

        try {
            const response = await fetch('http://localhost:2999/api/apps', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: trimmedAppName, workspaces: finalWorkspaces }),
            });

            if (!response.ok) {
              const errorData = await response.json();
              throw new Error(errorData.message || 'Failed to add the application.');
            }

            toast({ title: 'Success', description: `Application '${trimmedAppName}' has been added.` });
            onAppAdded();
            setIsOpen(false);
            setAppName('');
            setAppFolder('');
            setWorkspaces(['.']);

        } catch (error) {
            toast({ title: 'Error', description: (error as Error).message, variant: 'destructive' });
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <Button variant="ghost" size="sm" className="w-8 h-8 p-0">
                    <Plus className="w-4 h-4" />
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md bg-dashboard-panel border-dashboard-border text-dashboard-text">
                <form onSubmit={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle>Add New Application</DialogTitle>
                        <DialogDescription>
                            Register a new application to be managed by the dashboard.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="space-y-2">
                            <Label htmlFor="name">App Name (Display Name)</Label>
                            <Input id="name" value={appName} onChange={(e) => setAppName(e.target.value)} className="bg-dashboard-bg" placeholder="e.g., Flow" />
                        </div>
                         <div className="space-y-2">
                            <Label htmlFor="folder">App Folder Name</Label>
                            <Input id="folder" value={appFolder} onChange={(e) => setAppFolder(e.target.value)} className="bg-dashboard-bg" placeholder="e.g., Zoho_flow" />
                        </div>
                        <div className="space-y-2">
                            <Label>Workspaces</Label>
                             <p className="text-xs text-dashboard-muted -mt-1">Paths relative to the app folder. Use `.` for the root.</p>
                            {workspaces.map((workspace, index) => (
                                <div key={index} className="flex items-center gap-2">
                                    <div className="flex items-center rounded-md border border-input bg-dashboard-bg w-full">
                                      <span className="text-sm pl-3 text-muted-foreground">apps/{appFolder}/</span>
                                      <Input
                                          id={`workspace-${index}`}
                                          value={workspace}
                                          onChange={(e) => handleWorkspaceChange(index, e.target.value)}
                                          placeholder="e.g., . or server"
                                          className="border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
                                      />
                                    </div>
                                    {workspaces.length > 1 && (
                                        <Button type="button" variant="ghost" size="icon" onClick={() => handleRemoveWorkspace(index)}>
                                            <X className="h-4 w-4" />
                                        </Button>
                                    )}
                                </div>
                            ))}
                        </div>
                        <div className="flex justify-end">
                             <Button type="button" variant="outline" size="sm" onClick={handleAddWorkspace}>
                                <PlusCircle className="h-4 w-4 mr-2" /> Add Workspace
                            </Button>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="submit">Save application</Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
};

// --- App Sidebar Component ---
const AppSidebar: React.FC<{
  apps: App[];
  selectedApp: string | null;
  onSelectApp: (appName: string) => void;
  onStartApp: (appName: string) => void;
  onStopApp: (appName: string) => void;
  onInstallApp: (appName: string) => void;
  onDeleteApp: (appName: string) => void;
  onAppAdded: () => void;
}> = ({ apps, selectedApp, onSelectApp, onStartApp, onStopApp, onInstallApp, onDeleteApp, onAppAdded }) => {
  return (
    <div className="w-80 bg-dashboard-sidebar border-r border-dashboard-border p-4 flex flex-col h-screen">
      <div className="mb-6 flex justify-between items-center">
        <div>
            <h2 className="text-lg font-semibold text-dashboard-text mb-1">Applications</h2>
            <p className="text-sm text-dashboard-muted">{apps.length} apps in monorepo</p>
        </div>
        <AddAppDialog onAppAdded={onAppAdded} />
      </div>
      
      <div className="space-y-2 flex-1 overflow-y-auto">
        {apps.map((app) => (
          <div
            key={app.name}
            className={`app-item group ${selectedApp === app.name ? 'selected' : ''}`}
            onClick={() => onSelectApp(app.name)}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <StatusIndicator status={app.status} />
                <div className="flex-1 truncate">
                  <div className="font-medium text-dashboard-text truncate">{app.name}</div>
                  <div className="text-xs text-dashboard-muted capitalize">{app.status}</div>
                </div>
              </div>
              
              <div className="flex gap-1 items-center">
                {!app.isInstalled ? (
                   <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => { e.stopPropagation(); onInstallApp(app.name); }}
                    disabled={app.status === 'installing'}
                    className="w-8 h-8 p-0 hover:bg-action-primary/20"
                  >
                    <Download className="w-4 h-4 text-action-primary" />
                  </Button>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => { e.stopPropagation(); onStartApp(app.name); }}
                      disabled={app.status === 'running' || app.status === 'starting'}
                      className="w-8 h-8 p-0 hover:bg-action-success/20"
                    >
                      <PlayCircle className="w-4 h-4 text-action-success" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={(e) => { e.stopPropagation(); onStopApp(app.name); }}
                      disabled={app.status === 'stopped' || app.status === 'starting'}
                      className="w-8 h-8 p-0 hover:bg-action-danger/20"
                    >
                      <StopCircle className="w-4 h-4 text-action-danger" />
                    </Button>
                  </>
                )}
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="w-8 h-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity">
                            <MoreVertical className="w-4 h-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-status-error focus:bg-status-error/20 focus:text-status-error">
                                    <Trash2 className="w-4 h-4 mr-2" />
                                    Delete
                                </DropdownMenuItem>
                            </AlertDialogTrigger>
                            <AlertDialogContent className="bg-dashboard-panel border-dashboard-border text-dashboard-text">
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        This will permanently remove the app from the dashboard configuration. It will not delete the files from your disk.
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => onDeleteApp(app.name)} className="bg-destructive hover:bg-destructive/80">
                                        Yes, delete
                                    </AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// --- Terminal Tab Component ---
const TerminalTab: React.FC<{
  appName: string;
  logs: string[];
  appUrl?: string;
  onStartApp: () => void;
  onStopApp: () => void;
  onRestartApp: () => void;
  onClearLogs: () => void;
  onCopyLogs: () => void;
}> = ({ appName, logs, appUrl, onStartApp, onStopApp, onRestartApp, onClearLogs, onCopyLogs }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const ansiToHtml = new AnsiToHtml();

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="p-6 space-y-4">
      <div className="flex gap-2">
        <Button onClick={onStartApp} className="bg-action-success hover:bg-action-success/80"><PlayCircle className="w-4 h-4 mr-2" />Start</Button>
        <Button onClick={onStopApp} variant="destructive"><StopCircle className="w-4 h-4 mr-2" />Stop</Button>
        <Button onClick={onRestartApp} variant="outline"><RotateCw className="w-4 h-4 mr-2" />Restart</Button>
        <div className="flex-1" />
        <Button onClick={onClearLogs} variant="outline" size="sm"><Eraser className="w-4 h-4 mr-2" />Clear Logs</Button>
        <Button onClick={onCopyLogs} variant="outline" size="sm"><Clipboard className="w-4 h-4 mr-2" />Copy Logs</Button>
      </div>
      
      {appUrl && (
        <div className="p-2 border border-dashboard-border rounded-md bg-dashboard-panel text-sm flex items-center gap-2">
          <span className="text-dashboard-muted">Running at:</span>
          <a
            href={appUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-action-primary hover:underline font-medium"
          >
            {appUrl}
          </a>
        </div>
      )}

      <div className="terminal-window">
        <div className="bg-dashboard-border p-2 rounded-t-md">
          <div className="flex items-center gap-2">
            <div className="flex gap-1"><div className="w-3 h-3 rounded-full bg-status-error"></div><div className="w-3 h-3 rounded-full bg-status-starting"></div><div className="w-3 h-3 rounded-full bg-status-running"></div></div>
            <span className="text-sm text-dashboard-muted">{appName} — Terminal</span>
          </div>
        </div>
        <div ref={terminalRef} className="terminal-content">
          {logs.length === 0 ? (
            <div className="text-dashboard-muted">No logs available<br />Start the application to see logs</div>
          ) : (
            logs.map((log, index) => (
              <div key={index} dangerouslySetInnerHTML={{ __html: ansiToHtml.toHtml(log) }} />
            ))
          )}
        </div>
      </div>
    </div>
  );
};

// --- Details Tab Component ---
const DetailsTab: React.FC<{ appDetails: AppDetails | null }> = ({ appDetails }) => {
  if (!appDetails) {
    return (
      <div className="p-6">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  const { packageJson, stats, ports } = appDetails;

  const techStack = [
    { name: 'React', dep: 'react' },
    { name: 'Vite', dep: 'vite' },
    { name: 'TypeScript', dep: 'typescript' },
    { name: 'Tailwind CSS', dep: 'tailwindcss' },
  ].filter(tech => packageJson.dependencies?.[tech.dep] || packageJson.devDependencies?.[tech.dep]);

  return (
    <div className="p-6 space-y-6">
      <Card className="bg-dashboard-panel border-dashboard-border p-4">
        <h3 className="font-semibold text-dashboard-text mb-4">Details</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div><span className="text-dashboard-muted">Version:</span> {packageJson.version || 'N/A'}</div>
          <div><span className="text-dashboard-muted">File Count:</span> {stats.fileCount}</div>
          <div><span className="text-dashboard-muted">Total Size:</span> {(stats.totalSize / 1024).toFixed(2)} KB</div>
          {ports.length > 0 && <div><span className="text-dashboard-muted">Detected Ports:</span> {ports.join(', ')}</div>}
        </div>
        {techStack.length > 0 && (
          <div className="mt-4">
            <h4 className="font-semibold text-dashboard-text mb-2">Technology Stack</h4>
            <div className="flex gap-2">
              {techStack.map(tech => <Badge key={tech.name} variant="secondary">{tech.name}</Badge>)}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
};

// --- Dependencies Tab Component ---
const DependenciesTab: React.FC<{ appName: string; }> = ({ appName }) => {
  const [dependencies, setDependencies] = useState<any[]>([]);
  const [newDep, setNewDep] = useState('');
  const outdatedCount = dependencies.filter(dep => dep.outdated).length;
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-4"><Button variant="outline" className="border-action-primary text-action-primary hover:bg-action-primary/10"><RefreshCw className="w-4 h-4 mr-2" />Check for Updates</Button>{outdatedCount > 0 && (<Button className="bg-action-success hover:bg-action-success/80"><ArrowUpCircle className="w-4 h-4 mr-2" />Update All Outdated ({outdatedCount})</Button>)}</div>
      <Card className="bg-dashboard-panel border-dashboard-border"><div className="p-4"><h3 className="font-semibold text-dashboard-text mb-4">Add New Dependency</h3><div className="flex gap-2"><Input value={newDep} onChange={(e) => setNewDep(e.target.value)} placeholder="Package name (e.g., lodash)" className="bg-dashboard-bg border-dashboard-border text-dashboard-text" /><Button className="bg-action-primary hover:bg-action-primary/80"><Plus className="w-4 h-4 mr-2" />Add</Button></div></div></Card>
      <Card className="bg-dashboard-panel border-dashboard-border"><div className="p-4"><h3 className="font-semibold text-dashboard-text mb-4">Dependencies ({dependencies.length})</h3><div className="space-y-2">{dependencies.map((dep) => (<div key={dep.name} className="flex items-center justify-between p-3 rounded-lg border border-dashboard-border"><div className="flex items-center gap-3"><span className="font-medium text-dashboard-text">{dep.name}</span><Badge variant="outline" className="text-dashboard-muted">{dep.version}</Badge>{dep.outdated && (<Badge className="bg-status-starting/20 text-status-starting border-status-starting">Update available: {dep.latest}</Badge>)}</div>{dep.outdated && (<Button size="sm" variant="outline" className="border-action-success text-action-success hover:bg-action-success/10">Update</Button>)}</div>))}</div></div></Card>
    </div>
  );
};

// --- Main Dashboard Component ---
const Index: React.FC = () => {
  const [apps, setApps] = useState<App[]>([]);
  const [selectedApp, setSelectedApp] = useState<string | null>(null);
  const [logs, setLogs] = useState<Record<string, string[]>>({});
  const [appUrls, setAppUrls] = useState<Record<string, string>>({});
  const [appDetails, setAppDetails] = useState<Record<string, AppDetails>>({});
  const [activeTab, setActiveTab] = useState('terminal');
  const { toast } = useToast();

  const fetchApps = useCallback(async () => {
    try {
      const response = await fetch('http://localhost:2999/api/apps');
      if (!response.ok) throw new Error('Failed to fetch apps');
      
      const fetchedApps: App[] = await response.json();
      // Keep existing statuses if they are 'starting' or 'installing'
      setApps(prevApps => fetchedApps.map(app => {
        const existingApp = prevApps.find(p => p.name === app.name);
        if (existingApp && (existingApp.status === 'starting' || existingApp.status === 'installing')) {
          return { ...app, status: existingApp.status };
        }
        return { ...app, status: app.isInstalled ? app.status : 'stopped' };
      }));
      
      const currentSelectedAppExists = fetchedApps.some(app => app.name === selectedApp);
      if (fetchedApps.length > 0 && (!selectedApp || !currentSelectedAppExists)) {
        setSelectedApp(fetchedApps[0].name);
      } else if (fetchedApps.length === 0) {
        setSelectedApp(null);
      }
    } catch (error) {
      console.error('API call failed:', error);
      toast({ title: 'Connection Error', description: 'Could not connect to the backend server. Is it running?', variant: 'destructive' });
    }
  }, [toast, selectedApp]);

  useEffect(() => {
    fetchApps();
    const socket = io('http://localhost:2999');
    socket.on('logs', ({ appName, log }) => {
      setLogs(prev => ({ ...prev, [appName]: [...(prev[appName] || []), log] }));
    });

    socket.on('app-url', ({ appName, url }) => {
        setAppUrls(prev => {
            if (prev[appName] !== url) {
                return { ...prev, [appName]: url };
            }
            return prev;
        });
    });

    socket.on('app-stopped', ({ appName }) => {
        setAppUrls(prev => {
            const newUrls = { ...prev };
            delete newUrls[appName];
            return newUrls;
        });
    });

    return () => {
      socket.disconnect();
    };
  }, [fetchApps]);

  useEffect(() => {
    const fetchDetails = async () => {
      if (selectedApp && activeTab === 'details' && !appDetails[selectedApp]) {
        try {
          const response = await fetch(`http://localhost:2999/api/apps/${selectedApp}/details`);
          if (!response.ok) throw new Error('Failed to fetch app details');
          const details = await response.json();
          setAppDetails(prev => ({ ...prev, [selectedApp]: details }));
        } catch (error) {
          console.error('Failed to fetch app details:', error);
          toast({ title: 'Error', description: 'Could not fetch app details.', variant: 'destructive' });
        }
      }
    };
    fetchDetails();
  }, [selectedApp, activeTab, appDetails, toast]);


  const startApp = async (appName: string) => {
    setAppUrls(prev => {
      const newUrls = { ...prev };
      delete newUrls[appName];
      return newUrls;
    });
    setApps(prev => prev.map(app => app.name === appName ? { ...app, status: 'starting' } : app));
    toast({ title: 'Starting App', description: `Starting ${appName}...` });
    try {
      const response = await fetch(`http://localhost:2999/api/apps/${appName}/start`, { method: 'POST' });
      if (!response.ok) throw new Error('Failed to start app on the server.');
    } catch (error) {
      toast({ title: 'Error Starting App', description: (error as Error).message, variant: 'destructive' });
    } finally {
      fetchApps();
    }
  };
  
  const stopApp = async (appName: string) => {
    toast({ title: 'Stopping App', description: `Stopping ${appName}...` });
    try {
      const response = await fetch(`http://localhost:2999/api/apps/${appName}/stop`, { method: 'POST' });
      if (!response.ok) throw new Error('Failed to stop app on the server.');
      toast({ title: 'Success', description: `${appName} has been stopped.` });
      setAppUrls(prev => {
          const newUrls = { ...prev };
          delete newUrls[appName];
          return newUrls;
      });
    } catch (error) {
      toast({ title: 'Error Stopping App', description: (error as Error).message, variant: 'destructive' });
    } finally {
      fetchApps();
    }
  };

  const restartApp = async (appName: string) => {
    if (!selectedApp) return;
    await stopApp(selectedApp);
    setTimeout(() => startApp(selectedApp), 1000); // Give a moment for the process to die
  };

  const installApp = async (appName: string) => {
    setApps(prev => prev.map(app => app.name === appName ? { ...app, status: 'installing' } : app));
    toast({ title: 'Installation Started', description: `Installing dependencies for ${appName}...` });
    try {
        const response = await fetch(`http://localhost:2999/api/apps/${appName}/install`, { method: 'POST' });
        if (!response.ok) throw new Error('Installation failed on the server.');
        
        toast({ title: 'Installation Successful', description: `Dependencies for ${appName} are installed.` });
    } catch (error) {
        toast({ title: 'Installation Failed', description: (error as Error).message, variant: 'destructive' });
    } finally {
        fetchApps(); // Refresh app list to show new status
    }
  };

  const deleteApp = async (appName: string) => {
    toast({ title: 'Deleting App', description: `Removing ${appName} from configuration...` });
    try {
      const response = await fetch(`http://localhost:2999/api/apps/${appName}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Failed to delete app on the server.');
      
      toast({ title: 'Success', description: `App '${appName}' has been removed.` });
      
      fetchApps();

    } catch (error) {
      toast({ title: 'Deletion Failed', description: (error as Error).message, variant: 'destructive' });
    }
  };

  const clearLogs = () => { if (selectedApp) setLogs(prev => ({ ...prev, [selectedApp]: [] })); };
  const copyLogs = () => {
    if (selectedApp && logs[selectedApp]) {
      navigator.clipboard.writeText(logs[selectedApp].join('\n'));
      toast({ title: 'Logs Copied', description: 'Logs have been copied to clipboard' });
    }
  };

  return (
    <div className="flex min-h-screen bg-dashboard-bg text-dashboard-text">
      <AppSidebar
        apps={apps}
        selectedApp={selectedApp}
        onSelectApp={setSelectedApp}
        onStartApp={startApp}
        onStopApp={stopApp}
        onInstallApp={installApp}
        onDeleteApp={deleteApp}
        onAppAdded={fetchApps}
      />
      
      <div className="flex-1 flex flex-col">
        {selectedApp ? (
          <div className="p-6 flex-1">
            <div className="mb-6"><h1 className="text-2xl font-bold text-dashboard-text">{selectedApp}</h1><p className="text-dashboard-muted">Manage and monitor your application</p></div>
            <Tabs defaultValue="terminal" onValueChange={setActiveTab} className="flex-1">
              <TabsList className="grid w-full grid-cols-3 bg-dashboard-panel border border-dashboard-border"><TabsTrigger value="terminal" className="data-[state=active]:bg-action-primary data-[state=active]:text-white">Terminal</TabsTrigger><TabsTrigger value="details" className="data-[state=active]:bg-action-primary data-[state=active]:text-white">Details</TabsTrigger><TabsTrigger value="dependencies" className="data-[state=active]:bg-action-primary data-[state=active]:text-white">Dependencies</TabsTrigger></TabsList>
              <TabsContent value="terminal"><TerminalTab appName={selectedApp} logs={logs[selectedApp] || []} appUrl={appUrls[selectedApp]} onStartApp={() => startApp(selectedApp)} onStopApp={() => stopApp(selectedApp)} onRestartApp={() => restartApp(selectedApp)} onClearLogs={clearLogs} onCopyLogs={copyLogs} /></TabsContent>
              <TabsContent value="details"><DetailsTab appDetails={appDetails[selectedApp]} /></TabsContent>
              <TabsContent value="dependencies"><DependenciesTab appName={selectedApp} /></TabsContent>
            </Tabs>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center"><div className="text-center text-dashboard-muted"><h2 className="text-xl font-semibold mb-2">No Application Selected</h2><p>Select an application from the sidebar or add a new one.</p></div></div>
        )}
      </div>
    </div>
  );
};

export default Index;

