import { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { retryFailedFax } from '@/functions/retryFailedFax';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { CheckCircle2, AlertCircle, Clock, RefreshCw, X, Bell, RotateCcw, PauseCircle, PlayCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  filterRecentFaxLogs,
  getStatusCounts,
  getRelativeTimeLabel
} from '@/components/fax/faxTrackerUtils';

const statusConfig = {
  delivered: { color: 'bg-green-50', icon: CheckCircle2, label: 'Delivered', badge: 'text-green-700 bg-green-100' },
  failed: { color: 'bg-red-50', icon: AlertCircle, label: 'Failed', badge: 'text-red-700 bg-red-100' },
  pending: { color: 'bg-blue-50', icon: Clock, label: 'Pending', badge: 'text-blue-700 bg-blue-100' },
  queued: { color: 'bg-amber-50', icon: Clock, label: 'Queued', badge: 'text-amber-700 bg-amber-100' }
};


/**
 * Render a real-time fax status tracker UI that displays recent fax delivery statuses, summary cards, a scrollable activity list, and a details modal with retry capabilities.
 *
 * The component fetches and periodically refreshes recent fax logs, optionally subscribes to live updates while live updates are enabled, computes status counts and percentages, shows transient retry success notices, and provides a modal to view fax details and retry failed faxes.
 *
 * @returns {JSX.Element} The React element rendering the fax status tracker interface.
 */
export default function RealtimeFaxStatusTracker() {
  const [selectedFax, setSelectedFax] = useState(null);
  const [liveUpdatesEnabled, setLiveUpdatesEnabled] = useState(true);
  const [retryNotice, setRetryNotice] = useState('');
  const queryClient = useQueryClient();

  // Fetch recent fax logs with real-time polling
  const {
    data: faxLogs = [],
    isLoading,
    isFetching,
    error,
    refetch
  } = useQuery({
    queryKey: ['faxLogs', 'recent'],
    queryFn: async () => {
      const logs = await base44.entities.FaxLog.list('-created_date', 50);
      return filterRecentFaxLogs(logs);
    },
    refetchInterval: liveUpdatesEnabled ? 5000 : false,
    staleTime: 2000
  });

  const retryFaxMutation = useMutation({
    mutationFn: (fax) => retryFailedFax({ fax_log_id: fax.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['faxLogs'] });
      queryClient.invalidateQueries({ queryKey: ['faxLogs', 'recent'] });
      setSelectedFax(null);
      setRetryNotice('Retry request submitted. Status will refresh automatically.');
    }
  });

  // Subscribe to fax status changes (while live updates are enabled)
  useEffect(() => {
    if (!liveUpdatesEnabled) {
      return undefined;
    }

    const unsubscribe = base44.entities.FaxLog.subscribe((event) => {
      if (event.type === 'update' || event.type === 'create') {
        queryClient.invalidateQueries({ queryKey: ['faxLogs', 'recent'] });
      }
    });

    return unsubscribe;
  }, [liveUpdatesEnabled, queryClient]);

  const statusCounts = useMemo(() => getStatusCounts(faxLogs), [faxLogs]);

  const total = Object.values(statusCounts).reduce((sum, value) => sum + value, 0);

  const dismissFax = () => {
    setSelectedFax(null);
  };

  useEffect(() => {
    if (!retryNotice) return undefined;
    const timeoutId = setTimeout(() => setRetryNotice(''), 5000);
    return () => clearTimeout(timeoutId);
  }, [retryNotice]);


  return (
    <div className="space-y-4">
      {/* Notification Alert */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-start gap-3">
        <Bell className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
        <div className="text-sm flex-1">
          <p className="font-medium text-blue-900">Smart Notifications Enabled</p>
          <p className="text-xs text-blue-700 mt-0.5">You'll receive alerts when faxes are delivered or fail. Configure preferences in Settings.</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          onClick={() => setLiveUpdatesEnabled((current) => !current)}
        >
          {liveUpdatesEnabled ? (
            <><PauseCircle className="w-3 h-3 mr-1" /> Pause</>
          ) : (
            <><PlayCircle className="w-3 h-3 mr-1" /> Resume</>
          )}
        </Button>
      </div>

      {/* Summary Cards */}
      {total > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { key: 'delivered', label: 'Delivered' },
            { key: 'pending', label: 'Pending' },
            { key: 'queued', label: 'Queued' },
            { key: 'failed', label: 'Failed' }
          ].map(({ key, label }) => {
            const config = statusConfig[key];
            const Icon = config.icon;
            const count = statusCounts[key] || 0;
            const percentage = total > 0 ? Math.round((count / total) * 100) : 0;

            return (
              <div key={key} className={`${config.color} rounded-lg p-3 border border-slate-200`}>
                <div className="flex items-center gap-2 mb-1">
                  <Icon className="w-4 h-4" />
                  <span className="text-xs font-medium text-slate-600">{label}</span>
                </div>
                <p className="text-xl font-bold text-slate-900">{count}</p>
                <p className="text-xs text-slate-500">{percentage}% of recent faxes</p>
              </div>
            );
          })}
        </div>
      )}

      {retryNotice && (
        <Alert className="bg-green-50 border-green-200">
          <CheckCircle2 className="w-4 h-4 text-green-600" />
          <AlertDescription className="text-green-800">
            {retryNotice}
          </AlertDescription>
        </Alert>
      )}

      {/* Status List */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Fax Status Tracker</CardTitle>
              <CardDescription>Real-time delivery status from the last 24 hours</CardDescription>
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={() => refetch()}
              className="h-8 w-8"
              aria-label="Refresh fax statuses"
            >
              <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {retryFaxMutation.isError && (
            <Alert className="bg-red-50 border-red-200 mb-3">
              <AlertCircle className="w-4 h-4 text-red-600" />
              <AlertDescription className="text-red-800">
                Retry failed. Please try again in a few seconds.
              </AlertDescription>
            </Alert>
          )}
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin">
                <Clock className="w-6 h-6 text-indigo-600" />
              </div>
            </div>
          ) : error ? (
            <Alert className="bg-red-50 border-red-200">
              <AlertCircle className="w-4 h-4 text-red-600" />
              <AlertDescription className="text-red-800">
                Unable to load fax statuses right now. Try refreshing.
              </AlertDescription>
            </Alert>
          ) : faxLogs.length === 0 ? (
            <p className="text-center text-slate-500 py-6">No faxes sent in the last 24 hours</p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {faxLogs.map((fax) => {
                const status = fax.status?.toLowerCase() || 'pending';
                const config = statusConfig[status] || statusConfig.pending;
                const Icon = config.icon;

                return (
                  <div
                    key={fax.id}
                    className={`${config.color} rounded-lg p-3 border border-slate-200 flex items-start justify-between gap-3 cursor-pointer hover:shadow-sm transition`}
                    onClick={() => setSelectedFax(fax)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedFax(fax);
                      }
                    }}
                  >
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <Icon className="w-5 h-5 mt-0.5 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm text-slate-900 truncate">
                          To: {fax.to_number || fax.recipient_fax_number || 'Unknown'}
                        </p>
                        <p className="text-xs text-slate-600 mt-0.5">
                          {fax.document_name || 'Untitled'} · {getRelativeTimeLabel(fax.created_date)}
                        </p>
                        {(fax.failure_reason || fax.error_message) && (
                          <p className="text-xs text-red-700 mt-1">{fax.failure_reason || fax.error_message}</p>
                        )}
                      </div>
                    </div>
                    <span className={`${config.badge} text-xs font-semibold px-2 py-1 rounded-full whitespace-nowrap flex-shrink-0`}>
                      {config.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail Modal */}
      {selectedFax && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" role="dialog" aria-modal="true">
          <Card className="w-full max-w-md">
            <CardHeader>
              <div className="flex items-start justify-between">
                <CardTitle>Fax Details</CardTitle>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={dismissFax}
                  className="h-6 w-6"
                  aria-label="Close fax details"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-xs font-medium text-slate-600 uppercase">Recipient</p>
                <p className="text-sm font-semibold text-slate-900">{selectedFax.to_number || selectedFax.recipient_fax_number || 'Unknown'}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-600 uppercase">Document</p>
                <p className="text-sm text-slate-900">{selectedFax.document_name || 'Untitled'}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-600 uppercase">Status</p>
                <span className={`${statusConfig[selectedFax.status?.toLowerCase()]?.badge || statusConfig.pending.badge} text-xs font-semibold px-2 py-1 rounded inline-block mt-1`}>
                  {statusConfig[selectedFax.status?.toLowerCase()]?.label || 'Unknown'}
                </span>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-600 uppercase">Sent</p>
                <p className="text-sm text-slate-900">{new Date(selectedFax.created_date).toLocaleString()}</p>
              </div>
              {(selectedFax.failure_reason || selectedFax.error_message) && (
                <div className="bg-red-50 border border-red-200 rounded p-3">
                  <p className="text-xs font-medium text-red-900 uppercase mb-1">Error</p>
                  <p className="text-sm text-red-700">{selectedFax.failure_reason || selectedFax.error_message}</p>
                </div>
              )}
              {(selectedFax.telnyx_fax_id || selectedFax.twilio_sid) && (
                <div>
                  <p className="text-xs font-medium text-slate-600 uppercase">Tracking ID</p>
                  <p className="text-xs font-mono text-slate-600 break-all">{selectedFax.telnyx_fax_id || selectedFax.twilio_sid}</p>
                </div>
              )}

              {selectedFax.status?.toLowerCase() === 'failed' && (
                <Button
                  variant="default"
                  className="w-full"
                  disabled={retryFaxMutation.isPending}
                  onClick={() => retryFaxMutation.mutate(selectedFax)}
                >
                  {retryFaxMutation.isPending ? (
                    <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Retrying fax...</>
                  ) : (
                    <><RotateCcw className="w-4 h-4 mr-2" /> Retry failed fax</>
                  )}
                </Button>
              )}

              <Button
                variant="outline"
                className="w-full"
                onClick={dismissFax}
              >
                Close
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
