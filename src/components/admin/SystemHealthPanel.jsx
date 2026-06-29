import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Zap, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function SystemHealthPanel() {
  const queryClient = useQueryClient();

  const { data: healthResults, isLoading } = useQuery({
    queryKey: ['systemHealth'],
    queryFn: async () => {
      const result = await base44.functions.invoke('testAutomations', {});
      return result.data;
    },
    refetchInterval: 300000, // Refresh every 5 minutes
  });

  const runHealthCheckMutation = useMutation({
    mutationFn: async () => {
      return await base44.functions.invoke('testAutomations', {});
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['systemHealth'], data.data);
      toast.success('System health check completed');
    },
    onError: () => {
      toast.error('Health check failed');
    }
  });

  if (!healthResults && !isLoading) {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <Zap className="w-16 h-16 text-slate-300 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-slate-900 mb-2">System Health Monitor</h3>
          <p className="text-slate-600 mb-6">
            Run automated tests to verify all critical functions are operating correctly
          </p>
          <Button onClick={() => runHealthCheckMutation.mutate()} disabled={runHealthCheckMutation.isPending}>
            <Zap className="w-4 h-4 mr-2" />
            Run Health Check
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (isLoading || runHealthCheckMutation.isPending) {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <Loader2 className="w-16 h-16 text-indigo-500 mx-auto mb-4 animate-spin" />
          <p className="text-slate-600">Running system health checks...</p>
        </CardContent>
      </Card>
    );
  }

  // testAutomations returns { summary: { total_tests, successful, failed }, details: [...] }
  // where each detail is { function, status: 'success' | 'error', error? }. Read that
  // exact shape so a failed automation check is surfaced (not silently reported as
  // "all operational").
  const checks = healthResults?.details ?? [];
  const totalCount = healthResults?.summary?.total_tests ?? checks.length;
  const failedCount = healthResults?.summary?.failed ?? checks.filter(f => f.status === 'error').length;
  const allPassed = totalCount > 0 && failedCount === 0;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">System Health Status</h2>
          <p className="text-sm text-slate-600">Last checked: {healthResults?.timestamp ? new Date(healthResults.timestamp).toLocaleString() : 'Never'}</p>
        </div>
        <Button onClick={() => runHealthCheckMutation.mutate()} disabled={runHealthCheckMutation.isPending}>
          <Zap className="w-4 h-4 mr-2" />
          Run Check
        </Button>
      </div>

      <Alert className={allPassed ? "bg-green-50 border-green-300" : "bg-red-50 border-red-300"}>
        <AlertDescription className="flex items-center gap-2">
          {allPassed ? (
            <>
              <CheckCircle2 className="w-5 h-5 text-green-600" />
              <span className="text-green-800 font-semibold">All systems operational</span>
            </>
          ) : (
            <>
              <AlertTriangle className="w-5 h-5 text-red-600" />
              <span className="text-red-800 font-semibold">{failedCount} function(s) failing</span>
            </>
          )}
        </AlertDescription>
      </Alert>

      <div className="space-y-3">
        {checks.map((func, idx) => {
          const passed = func.status === 'success';
          return (
            <Card key={idx} className={passed ? 'border-green-200' : 'border-red-200'}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-slate-900">{func.function}</h3>
                      <Badge className={passed ? 'bg-green-600' : 'bg-red-600'}>
                        {passed ? 'passed' : 'failed'}
                      </Badge>
                    </div>
                    {func.error && (
                      <pre className="text-xs text-red-600 bg-red-50 p-2 rounded mt-2 overflow-x-auto">
                        {func.error}
                      </pre>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}