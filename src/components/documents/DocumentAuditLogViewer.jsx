import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Calendar, Clock, User, FileCheck, Mail } from 'lucide-react';
import { toast } from 'sonner';

export default function DocumentAuditLogViewer() {
  const [logs, setLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all');

  useEffect(() => {
    fetchAuditLogs();
  }, []);

  const fetchAuditLogs = async () => {
    try {
      setIsLoading(true);
      const packages = await base44.entities.DocumentPackage.list();
      const tokens = await base44.entities.DocumentPackageToken.list();
      const signatures = await base44.entities.DocumentSignature.list();
      const reminders = await base44.entities.ReminderLog.list();

      const auditEvents = [];

      // Package creation events
      packages.forEach((pkg) => {
        auditEvents.push({
          id: `pkg-${pkg.id}`,
          timestamp: pkg.created_date,
          type: 'assigned',
          title: `Package assigned: ${pkg.package_name}`,
          packageName: pkg.package_name,
          packageId: pkg.id,
          signer: pkg.signer_name,
          signerEmail: pkg.signer_email,
          details: `Assigned to ${pkg.signer_name} (${pkg.signer_email})`,
          icon: Mail,
          color: 'blue',
        });

        // Due date tracking
        if (pkg.due_date) {
          auditEvents.push({
            id: `due-${pkg.id}`,
            timestamp: pkg.due_date,
            type: 'due_date',
            title: `Due date: ${pkg.package_name}`,
            packageName: pkg.package_name,
            packageId: pkg.id,
            signer: pkg.signer_name,
            signerEmail: pkg.signer_email,
            details: `Due on ${new Date(pkg.due_date).toLocaleDateString()}`,
            icon: Calendar,
            color: 'yellow',
          });
        }
      });

      // Token access events (signer opened link)
      tokens.forEach((token) => {
        if (token.access_count > 0) {
          auditEvents.push({
            id: `token-${token.id}`,
            timestamp: token.last_accessed_at || token.token_created_at,
            type: 'opened',
            title: `Portal accessed: ${token.signer_name}`,
            packageId: token.package_id,
            signer: token.signer_name,
            signerEmail: token.signer_email,
            details: token.last_accessed_at
              ? `Accessed ${token.access_count} time(s), last at ${new Date(token.last_accessed_at).toLocaleString()}`
              : `Accessed ${token.access_count} time(s)`,
            icon: User,
            color: 'purple',
          });
        }
      });

      // Document signature events
      signatures.forEach((sig) => {
        // 'completed' is the current status; tolerate legacy 'signed'.
        if (sig.status === 'completed' || sig.status === 'signed') {
          const completedSigners = (sig.signers || []).filter(
            (s) => s.status === 'completed' || s.signed_date
          );
          // Most recent signer signed_date as a fallback for completion time.
          const latestSignedDate = completedSigners
            .map((s) => s.signed_date)
            .filter(Boolean)
            .sort((a, b) => new Date(b) - new Date(a))[0];
          const primarySigner = completedSigners[completedSigners.length - 1];
          const documentTitle = sig.document_title || 'Document';
          const signerName = primarySigner?.name || 'Unknown signer';

          auditEvents.push({
            id: `sig-${sig.id}`,
            timestamp: sig.completed_date || latestSignedDate,
            type: 'signed',
            title: `Document signed: ${documentTitle}`,
            packageId: sig.id,
            signer: signerName,
            signerEmail: primarySigner?.email,
            details: `${documentTitle} signed by ${signerName}`,
            icon: FileCheck,
            color: 'green',
          });
        }
      });

      // Reminder events
      reminders.forEach((reminder) => {
        auditEvents.push({
          id: `reminder-${reminder.id}`,
          timestamp: reminder.sent_at,
          type: 'reminder',
          title: `Reminder sent: ${reminder.package_name}`,
          packageId: reminder.package_id,
          signer: reminder.signer_name,
          signerEmail: reminder.signer_email,
          details: `${reminder.reminder_type} reminder sent (${reminder.documents_pending} documents pending)`,
          icon: Mail,
          color: 'orange',
        });
      });

      // Sort by timestamp descending
      auditEvents.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      setLogs(auditEvents);
    } catch (error) {
      toast.error('Failed to load audit logs');
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredLogs = logs.filter((log) => {
    const matchesSearch =
      log.packageName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.signer?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.signerEmail?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesFilter = filterType === 'all' || log.type === filterType;

    return matchesSearch && matchesFilter;
  });

  const getEventColor = (type) => {
    const colors = {
      assigned: 'bg-blue-100 text-blue-800',
      opened: 'bg-navy-100 text-navy-800',
      signed: 'bg-green-100 text-green-800',
      reminder: 'bg-orange-100 text-orange-800',
      due_date: 'bg-yellow-100 text-yellow-800',
    };
    return colors[type] || 'bg-slate-100 text-slate-800';
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5" />
            Document Package Audit Log
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Controls */}
          <div className="flex flex-col sm:flex-row gap-3">
            <Input
              placeholder="Search by package, signer, or email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="flex-1"
            />
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="px-3 py-2 border border-slate-300 rounded-md"
            >
              <option value="all">All Events</option>
              <option value="assigned">Assigned</option>
              <option value="opened">Opened</option>
              <option value="signed">Signed</option>
              <option value="reminder">Reminder</option>
              <option value="due_date">Due Date</option>
            </select>
            <Button onClick={fetchAuditLogs} disabled={isLoading} variant="outline">
              {isLoading ? 'Refreshing...' : 'Refresh'}
            </Button>
          </div>

          {/* Audit Log Timeline */}
          <div className="space-y-3 mt-6">
            {filteredLogs.length === 0 ? (
              <div className="text-center py-12 text-slate-500">
                {logs.length === 0 ? 'No audit logs found' : 'No results match your filters'}
              </div>
            ) : (
              filteredLogs.map((log) => {
                const IconComponent = log.icon;
                return (
                  <div key={log.id} className="flex gap-4 p-4 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
                    {/* Icon */}
                    <div className="flex-shrink-0">
                      <div className={`w-10 h-10 rounded-full ${log.color === 'blue' ? 'bg-blue-100 text-blue-600' : log.color === 'green' ? 'bg-green-100 text-green-600' : log.color === 'purple' ? 'bg-navy-100 text-navy-600' : log.color === 'orange' ? 'bg-orange-100 text-orange-600' : 'bg-yellow-100 text-yellow-600'} flex items-center justify-center`}>
                        <IconComponent className="w-5 h-5" />
                      </div>
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <p className="font-medium text-slate-900">{log.title}</p>
                          <p className="text-sm text-slate-600 mt-1">{log.details}</p>
                        </div>
                        <Badge className={getEventColor(log.type)}>{log.type}</Badge>
                      </div>

                      {/* Metadata */}
                      <div className="flex flex-wrap gap-4 mt-3 text-xs text-slate-500">
                        {log.signer && (
                          <div className="flex items-center gap-1">
                            <User className="w-3 h-3" />
                            {log.signer}
                          </div>
                        )}
                        {log.signerEmail && (
                          <div>
                            {log.signerEmail}
                          </div>
                        )}
                        <div className="flex items-center gap-1 ml-auto">
                          <Clock className="w-3 h-3" />
                          {new Date(log.timestamp).toLocaleString()}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Summary */}
          {logs.length > 0 && (
            <div className="mt-6 pt-4 border-t border-slate-200 text-sm text-slate-600">
              Showing {filteredLogs.length} of {logs.length} events • Last updated:{' '}
              {new Date().toLocaleString()}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}