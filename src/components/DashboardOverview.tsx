import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PlayCircle, StopCircle, HardHat, RefreshCw } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

// --- Types ---
interface App {
  name: string;
  id: string;
  status: 'stopped' | 'starting' | 'running' | 'error' | 'building' | 'installing' | 'stopping';
  isInstalled: boolean;
  workspaces: string[];
  isFavorite?: boolean;
}

const StatusIndicator: React.FC<{ status: App['status'] }> = ({ status }) => {
    const statusClasses = {
        running: 'bg-green-500',
        stopped: 'bg-gray-400',
        starting: 'bg-yellow-500 animate-pulse',
        stopping: 'bg-yellow-500 animate-pulse',
        error: 'bg-red-500',
        building: 'bg-blue-500 animate-pulse',
        installing: 'bg-blue-500 animate-pulse',
    };
    return <div className={`w-3 h-3 rounded-full ${statusClasses[status]}`} />;
};

export const DashboardOverview: React.FC<{
  apps: App[];
  onStartApp: (appName: string) => void;
  onStopApp: (appName: string) => void;
  onSelectApp: (appName: string) => void;
}> = ({ apps, onStartApp, onStopApp, onSelectApp }) => {
    
    const statusCounts = apps.reduce((acc, app) => {
        acc[app.status] = (acc[app.status] || 0) + 1;
        return acc;
    }, {} as Record<App['status'], number>);

    const chartData = [
        { name: 'Running', count: statusCounts.running || 0, fill: 'hsl(var(--status-running))' },
        { name: 'Stopped', count: statusCounts.stopped || 0, fill: 'hsl(var(--status-stopped))' },
        { name: 'Error', count: statusCounts.error || 0, fill: 'hsl(var(--status-error))' },
    ];

    return (
        <div className="flex-1 p-6">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-dashboard-text">Dashboard Overview</h1>
                    <p className="text-dashboard-muted">A high-level view of your monorepo.</p>
                </div>
                <div className="flex gap-2">
                    <Button onClick={() => apps.forEach(app => onStartApp(app.name))} className="bg-action-success hover:bg-action-success/80">
                        <PlayCircle className="w-4 h-4 mr-2" />
                        Start All
                    </Button>
                    <Button onClick={() => apps.forEach(app => onStopApp(app.name))} variant="destructive">
                        <StopCircle className="w-4 h-4 mr-2" />
                        Stop All
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <Card className="lg:col-span-2 bg-dashboard-panel border-dashboard-border">
                    <CardHeader>
                        <CardTitle>Application Status</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <ResponsiveContainer width="100%" height={300}>
                            <BarChart data={chartData}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="name" />
                                <YAxis />
                                <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--dashboard-panel))', border: '1px solid hsl(var(--dashboard-border))' }} />
                                <Bar dataKey="count" fill="fill" />
                            </BarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>

                <Card className="bg-dashboard-panel border-dashboard-border">
                    <CardHeader>
                        <CardTitle>Quick Actions</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <Button className="w-full justify-start" variant="outline"><HardHat className="w-4 h-4 mr-2" /> Run Linter on All Apps</Button>
                        <Button className="w-full justify-start" variant="outline"><RefreshCw className="w-4 h-4 mr-2" /> Check Outdated Dependencies</Button>
                    </CardContent>
                </Card>
            </div>

            <div className="mt-6">
                <h2 className="text-xl font-semibold mb-4">All Applications</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {apps.map(app => (
                        <Card key={app.name} className="bg-dashboard-panel border-dashboard-border hover:border-action-primary transition-colors cursor-pointer" onClick={() => onSelectApp(app.name)}>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">{app.name}</CardTitle>
                                <StatusIndicator status={app.status} />
                            </CardHeader>
                            <CardContent>
                                <div className="text-xs text-dashboard-muted capitalize">{app.status}</div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            </div>
        </div>
    );
};