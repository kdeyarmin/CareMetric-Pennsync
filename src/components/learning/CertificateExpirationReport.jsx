import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Download, Calendar, Loader2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import ReportFilters from './ReportFilters';
import { toCsv, exportTimestamp } from '../admin/csvExport';
import { toast } from 'sonner';

const formatDate = (value) => (value ? new Date(value).toLocaleDateString() : '—');

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const daysUntil = (date) => Math.floor((new Date(date).getTime() - Date.now()) / MS_PER_DAY);

const statusFor = (days) => {
  if (days < 0) return { label: 'Expired', className: 'bg-red-100 text-red-800' };
  if (days <= 30) return { label: 'Expiring ≤30d', className: 'bg-orange-100 text-orange-800' };
  if (days <= 60) return { label: 'Expiring ≤60d', className: 'bg-yellow-100 text-yellow-800' };
  if (days <= 90) return { label: 'Expiring ≤90d', className: 'bg-blue-100 text-blue-800' };
  return { label: 'Current', className: 'bg-green-100 text-green-800' };
};

export default function CertificateExpirationReport() {
  const [filters, setFilters] = useState({
    businessLine: 'home_health',
    dateStart: '',
    dateEnd: '',
    employee: '',
    status: 'all',
  });
  const [windowDays, setWindowDays] = useState('90');

  const { data: certificates = [], isLoading: certsLoading } = useQuery({
    queryKey: ['expiring-certificates'],
    queryFn: () => base44.entities.TrainingCertificate.list('-issued_at', 2000),
    initialData: [],
  });

  const { data: credentials = [], isLoading: credsLoading } = useQuery({
    queryKey: ['expiring-credentials'],
    queryFn: () => base44.entities.PersonnelCredential.list('-created_date', 2000),
    initialData: [],
  });

  // Normalize both sources into a single expiration list.
  const items = useMemo(() => {
    const certItems = certificates
      .filter((c) => c.expiration_date && !c.revoked)
      .map((c) => ({
        id: `cert_${c.id}`,
        holder: c.user_name || c.user_id || '—',
        item: c.course_title || 'Training Certificate',
        kind: 'Training',
        issued: c.issued_at || c.completion_date,
        expiration: c.expiration_date,
      }));
    const credItems = credentials
      .filter((c) => c.expiration_date && c.status !== 'rejected')
      .map((c) => ({
        id: `cred_${c.id}`,
        holder: c.user_name || c.user_id || '—',
        item: c.title || (c.item_type ? c.item_type.replace(/_/g, ' ') : 'Credential'),
        kind: c.item_type ? c.item_type.charAt(0).toUpperCase() + c.item_type.slice(1) : 'Credential',
        issued: c.issued_date,
        expiration: c.expiration_date,
      }));
    return [...certItems, ...credItems].map((i) => ({ ...i, _days: daysUntil(i.expiration) }));
  }, [certificates, credentials]);

  const filtered = useMemo(() => {
    const empNeedle = filters.employee.trim().toLowerCase();
    const windowLimit = windowDays === 'all' ? Infinity : Number(windowDays);
    return items
      .filter((i) => i._days <= windowLimit) // includes already-expired (negative days)
      .filter((i) => (empNeedle ? i.holder.toLowerCase().includes(empNeedle) : true))
      .sort((a, b) => a._days - b._days);
  }, [items, filters.employee, windowDays]);

  const stats = useMemo(() => {
    const expired = items.filter((i) => i._days < 0).length;
    const within30 = items.filter((i) => i._days >= 0 && i._days <= 30).length;
    const within60 = items.filter((i) => i._days > 30 && i._days <= 60).length;
    const within90 = items.filter((i) => i._days > 60 && i._days <= 90).length;
    return { expired, within30, within60, within90 };
  }, [items]);

  const handleExportCSV = () => {
    if (filtered.length === 0) {
      toast.error('No data to export');
      return;
    }
    const csv = toCsv(
      [
        { key: 'holder', label: 'Employee' },
        { key: 'item', label: 'Certificate / Credential' },
        { key: 'kind', label: 'Type' },
        { key: 'issued', label: 'Issued', format: formatDate },
        { key: 'expiration', label: 'Expiration', format: formatDate },
        { key: '_days', label: 'Days Until Expiry' },
        { key: '_days', label: 'Status', format: (v) => statusFor(v).label },
      ],
      filtered,
    );
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `certificate_expiration_${exportTimestamp()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV exported successfully');
  };

  const isLoading = certsLoading || credsLoading;

  return (
    <div className="space-y-6">
      <ReportFilters
        onFilterChange={setFilters}
        businessLineOptions={[
          { value: 'home_health', label: 'Home Health' },
          { value: 'hospice', label: 'Hospice' },
        ]}
        showCourse={false}
        showPlan={false}
        showStatus={false}
        showDateRange={false}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-l-4 border-l-red-600">
          <CardContent className="p-4">
            <p className="text-sm text-slate-500">Expired</p>
            <p className="text-2xl font-bold">{stats.expired}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-orange-500">
          <CardContent className="p-4">
            <p className="text-sm text-slate-500">Expiring ≤30 days</p>
            <p className="text-2xl font-bold">{stats.within30}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-yellow-500">
          <CardContent className="p-4">
            <p className="text-sm text-slate-500">Expiring 31–60 days</p>
            <p className="text-2xl font-bold">{stats.within60}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-blue-600">
          <CardContent className="p-4">
            <p className="text-sm text-slate-500">Expiring 61–90 days</p>
            <p className="text-2xl font-bold">{stats.within90}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            Certificate & Credential Expiration ({filtered.length})
          </CardTitle>
          <div className="flex items-center gap-2">
            <Select value={windowDays} onValueChange={setWindowDays}>
              <SelectTrigger className="w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30">Next 30 days</SelectItem>
                <SelectItem value="60">Next 60 days</SelectItem>
                <SelectItem value="90">Next 90 days</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="gap-2" onClick={handleExportCSV}>
              <Download className="w-4 h-4" />
              Export CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-8">
              <Calendar className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <p className="text-slate-500">No certificates or credentials expiring in this window.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Certificate / Credential</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Expiration</TableHead>
                    <TableHead>Days Until Expiry</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((i) => {
                    const status = statusFor(i._days);
                    return (
                      <TableRow key={i.id} className={i._days < 0 ? 'bg-red-50/40' : undefined}>
                        <TableCell className="font-medium">{i.holder}</TableCell>
                        <TableCell>{i.item}</TableCell>
                        <TableCell>{i.kind}</TableCell>
                        <TableCell>{formatDate(i.expiration)}</TableCell>
                        <TableCell>{i._days < 0 ? `${Math.abs(i._days)} days ago` : `${i._days} days`}</TableCell>
                        <TableCell>
                          <Badge className={status.className}>{status.label}</Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
