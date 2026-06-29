import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Play,
  RefreshCw,
  Eye,
  Activity,
  Calendar,
  FileText,
  Monitor
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";
import LoadingState from "@/components/ui/LoadingState";

export default function SystemJobMonitor() {
  const queryClient = useQueryClient();
  const [selectedJobType, setSelectedJobType] = useState("all");
  const [_selectedLog, setSelectedLog] = useState(null);
  const [isRunning, setIsRunning] = useState(false);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['systemLogs', selectedJobType],
    queryFn: async () => {
      if (selectedJobType === 'all') {
        return base44.entities.SystemLog.list('-created_date', 50);
      }
      return base44.entities.SystemLog.filter({ job_type: selectedJobType }, '-created_date', 50);
    },
    enabled: currentUser?.role === 'admin',
    refetchInterval: 30000 // Refresh every 30 seconds
  });

  const runGuidelineSyncMutation = useMutation({
    mutationFn: async () => {
      const response = await base44.functions.invoke('scheduledGuidelineSync', {});
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['systemLogs'] });
      toast.success('Guideline sync started');
    },
    onError: (error) => {
      // Previously the failure was swallowed with console.error only, leaving the
      // admin with no feedback that the manual sync never ran.
      console.error('Sync failed:', error);
      toast.error(`Guideline sync failed: ${error?.message || 'Unknown error'}`);
    }
  });

  const handleRunSync = async () => {
    setIsRunning(true);
    try {
      await runGuidelineSyncMutation.mutateAsync();
    } catch {
      // Error surfaced to the user via the mutation's onError toast above.
    }
    setIsRunning(false);
  };

  const getStatusIcon = (status) => {
    const icons = {
      success: <CheckCircle2 className="w-5 h-5 text-emerald-600" />,
      error: <XCircle className="w-5 h-5 text-red-600" />,
      warning: <AlertTriangle className="w-5 h-5 text-amber-600" />,
      running: <Clock className="w-5 h-5 text-blue-600 animate-spin" />
    };
    return icons[status] || <Activity className="w-5 h-5 text-slate-400" />;
  };

  const getStatusBadge = (status) => {
    const colors = {
      success: "bg-emerald-100 text-emerald-800 border-emerald-300",
      error: "bg-red-100 text-red-800 border-red-300",
      warning: "bg-amber-100 text-amber-800 border-amber-300",
      running: "bg-blue-100 text-blue-800 border-blue-300"
    };
    return (
      <Badge className={colors[status] || "bg-slate-100 text-slate-800"}>
        {status}
      </Badge>
    );
  };

  const formatDuration = (ms) => {
    if (!ms) return 'N/A';
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  };

  if (currentUser?.role !== 'admin') {
    return (
      <div className="p-6">
        <Alert>
          <AlertDescription>
            Admin access required to view system job monitoring.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // Calculate stats
  const stats = {
    total: logs.length,
    success: logs.filter(l => l.status === 'success').length,
    errors: logs.filter(l => l.status === 'error').length,
    warnings: logs.filter(l => l.status === 'warning').length,
    running: logs.filter(l => l.status === 'running').length
  };

  // Get last guideline sync
  const lastGuidelineSync = logs.find(l => l.job_type === 'medicare_guideline_sync');

  return (
    <PageContainer>
      <PageHeader
        icon={Monitor}
        eyebrow="Admin"
        title="System Job Monitor"
        description="Monitor scheduled jobs and automated processes"
        favoritePage="SystemJobMonitor"
        actions={
          <Button
            onClick={handleRunSync}
            disabled={isRunning}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {isRunning ? (
              <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Running...</>
            ) : (
              <><Play className="w-4 h-4 mr-2" /> Run Guideline Sync Now</>
            )}
          </Button>
        }
      />

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">Total Jobs</p>
                <p className="text-2xl font-bold">{stats.total}</p>
              </div>
              <Activity className="w-8 h-8 text-slate-400" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">Success</p>
                <p className="text-2xl font-bold text-emerald-600">{stats.success}</p>
              </div>
              <CheckCircle2 className="w-8 h-8 text-emerald-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">Errors</p>
                <p className="text-2xl font-bold text-red-600">{stats.errors}</p>
              </div>
              <XCircle className="w-8 h-8 text-red-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">Warnings</p>
                <p className="text-2xl font-bold text-amber-600">{stats.warnings}</p>
              </div>
              <AlertTriangle className="w-8 h-8 text-amber-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">Running</p>
                <p className="text-2xl font-bold text-blue-600">{stats.running}</p>
              </div>
              <Clock className="w-8 h-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Last Sync Info */}
      {lastGuidelineSync && (
        <Card className="border-2 border-blue-200 bg-blue-50">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Calendar className="w-5 h-5 text-blue-600" />
              Last Medicare Guideline Sync
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-slate-600">Status</p>
                <div className="mt-1">{getStatusBadge(lastGuidelineSync.status)}</div>
              </div>
              <div>
                <p className="text-slate-600">Date</p>
                <p className="font-medium">{format(new Date(lastGuidelineSync.created_date), 'MMM d, yyyy h:mm a')}</p>
              </div>
              <div>
                <p className="text-slate-600">Duration</p>
                <p className="font-medium">{formatDuration(lastGuidelineSync.duration_ms)}</p>
              </div>
              <div>
                <p className="text-slate-600">Records</p>
                <p className="font-medium">
                  {lastGuidelineSync.records_created || 0} created, {lastGuidelineSync.records_updated || 0} updated
                </p>
              </div>
            </div>
            <p className="text-sm text-slate-700 mt-3">{lastGuidelineSync.message}</p>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Job History</CardTitle>
            <div className="flex items-center gap-2">
              <Select value={selectedJobType} onValueChange={setSelectedJobType}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Job Types</SelectItem>
                  <SelectItem value="medicare_guideline_sync">Medicare Guidelines</SelectItem>
                  <SelectItem value="data_cleanup">Data Cleanup</SelectItem>
                  <SelectItem value="report_generation">Report Generation</SelectItem>
                  <SelectItem value="backup">Backup</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => queryClient.invalidateQueries({ queryKey: ['systemLogs'] })}
              >
                <RefreshCw className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <LoadingState label="Loading logs..." className="py-8" />
          ) : logs.length === 0 ? (
            <div className="text-center py-8">
              <FileText className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              <p className="text-sm text-slate-500">No logs found</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Job Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Date/Time</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Records</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {getStatusIcon(log.status)}
                        {getStatusBadge(log.status)}
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">{log.job_name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{log.job_type}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {format(new Date(log.created_date), 'MMM d, yyyy h:mm a')}
                    </TableCell>
                    <TableCell className="text-sm">{formatDuration(log.duration_ms)}</TableCell>
                    <TableCell className="text-sm">
                      {log.records_processed !== undefined ? (
                        <div className="flex flex-col gap-0.5">
                          <span className="text-xs text-slate-500">
                            {log.records_processed} total
                          </span>
                          {log.records_failed > 0 && (
                            <span className="text-xs text-red-600">
                              {log.records_failed} failed
                            </span>
                          )}
                        </div>
                      ) : '-'}
                    </TableCell>
                    <TableCell className="text-sm max-w-md truncate">
                      {log.message}
                    </TableCell>
                    <TableCell>
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelectedLog(log)}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                          <DialogHeader>
                            <DialogTitle>Job Details: {log.job_name}</DialogTitle>
                          </DialogHeader>
                          <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <p className="text-sm text-slate-600">Status</p>
                                {getStatusBadge(log.status)}
                              </div>
                              <div>
                                <p className="text-sm text-slate-600">Type</p>
                                <Badge variant="outline">{log.job_type}</Badge>
                              </div>
                              <div>
                                <p className="text-sm text-slate-600">Date</p>
                                <p className="text-sm font-medium">
                                  {format(new Date(log.created_date), 'MMM d, yyyy h:mm:ss a')}
                                </p>
                              </div>
                              <div>
                                <p className="text-sm text-slate-600">Duration</p>
                                <p className="text-sm font-medium">{formatDuration(log.duration_ms)}</p>
                              </div>
                            </div>

                            <div>
                              <p className="text-sm text-slate-600 mb-1">Message</p>
                              <p className="text-sm">{log.message}</p>
                            </div>

                            {log.details && (
                              <div>
                                <p className="text-sm text-slate-600 mb-2">Details</p>
                                <pre className="bg-slate-100 p-3 rounded text-xs overflow-x-auto">
                                  {JSON.stringify(log.details, null, 2)}
                                </pre>
                              </div>
                            )}

                            {log.error_stack && (
                              <div>
                                <p className="text-sm text-red-600 mb-2">Error Stack</p>
                                <pre className="bg-red-50 p-3 rounded text-xs overflow-x-auto text-red-800">
                                  {log.error_stack}
                                </pre>
                              </div>
                            )}
                          </div>
                        </DialogContent>
                      </Dialog>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}