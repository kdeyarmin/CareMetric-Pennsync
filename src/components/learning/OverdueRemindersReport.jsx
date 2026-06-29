import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Download, AlertCircle, Loader2, BellOff, Bell } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import ReportFilters from './ReportFilters';
import { toCsv, exportTimestamp } from '../admin/csvExport';
import { toast } from 'sonner';

const formatDate = (value) => (value ? new Date(value).toLocaleDateString() : '—');

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const daysOverdue = (dueDate) => {
  if (!dueDate) return 0;
  const diff = Date.now() - new Date(dueDate).getTime();
  return diff > 0 ? Math.floor(diff / MS_PER_DAY) : 0;
};

// Incomplete assignment whose due date has passed (or already flagged overdue).
const isOverdue = (a) => {
  if (a.status === 'completed') return false;
  if (a.status === 'overdue') return true;
  return !!a.due_date && new Date(a.due_date) < new Date();
};

export default function OverdueRemindersReport() {
  const [filters, setFilters] = useState({
    businessLine: 'home_health',
    dateStart: '',
    dateEnd: '',
    employee: '',
    status: 'all',
  });

  const { data: assignments = [], isLoading } = useQuery({
    queryKey: ['overdue-assignments'],
    queryFn: () => base44.entities.TrainingAssignment.list('-due_date', 2000),
    initialData: [],
  });

  const overdue = useMemo(() => {
    const empNeedle = filters.employee.trim().toLowerCase();
    return assignments
      .filter(isOverdue)
      .filter((a) => {
        if (empNeedle && !(a.assigned_to_user_id || '').toLowerCase().includes(empNeedle)) return false;
        if (filters.dateStart && a.due_date && new Date(a.due_date) < new Date(filters.dateStart)) return false;
        if (filters.dateEnd && a.due_date && new Date(a.due_date) > new Date(`${filters.dateEnd}T23:59:59`)) return false;
        return true;
      })
      .map((a) => ({ ...a, _daysOverdue: daysOverdue(a.due_date) }))
      .sort((a, b) => b._daysOverdue - a._daysOverdue);
  }, [assignments, filters]);

  const stats = useMemo(() => {
    const total = overdue.length;
    const remindersSent = overdue.filter((a) => a.reminder_sent).length;
    const critical = overdue.filter((a) => a._daysOverdue >= 14).length;
    return { total, remindersSent, awaiting: total - remindersSent, critical };
  }, [overdue]);

  const handleExportCSV = () => {
    if (overdue.length === 0) {
      toast.error('No data to export');
      return;
    }
    const csv = toCsv(
      [
        { key: 'assigned_to_user_id', label: 'Employee' },
        { key: 'course_title', label: 'Course' },
        { key: 'assigned_date', label: 'Assigned', format: (v, r) => formatDate(v || r.created_date) },
        { key: 'due_date', label: 'Due Date', format: formatDate },
        { key: '_daysOverdue', label: 'Days Overdue' },
        { key: 'status', label: 'Status' },
        { key: 'reminder_sent', label: 'Reminder Sent', format: (v) => (v ? 'Yes' : 'No') },
        { key: 'last_reminder_date', label: 'Last Reminder', format: formatDate },
      ],
      overdue,
    );
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `overdue_training_${exportTimestamp()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV exported successfully');
  };

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
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-l-4 border-l-red-600">
          <CardContent className="p-4">
            <p className="text-sm text-slate-500">Overdue</p>
            <p className="text-2xl font-bold">{stats.total}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-orange-500">
          <CardContent className="p-4">
            <p className="text-sm text-slate-500">14+ Days Overdue</p>
            <p className="text-2xl font-bold">{stats.critical}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-green-600">
          <CardContent className="p-4">
            <p className="text-sm text-slate-500 flex items-center gap-1"><Bell className="w-3 h-3" /> Reminders Sent</p>
            <p className="text-2xl font-bold">{stats.remindersSent}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-slate-400">
          <CardContent className="p-4">
            <p className="text-sm text-slate-500 flex items-center gap-1"><BellOff className="w-3 h-3" /> No Reminder Yet</p>
            <p className="text-2xl font-bold">{stats.awaiting}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-red-600" />
            Overdue Training & Reminders ({overdue.length})
          </CardTitle>
          <Button variant="outline" size="sm" className="gap-2" onClick={handleExportCSV}>
            <Download className="w-4 h-4" />
            Export CSV
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
            </div>
          ) : overdue.length === 0 ? (
            <div className="text-center py-8">
              <AlertCircle className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <p className="text-slate-500">No overdue training assignments. Everyone is on track.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Course</TableHead>
                    <TableHead>Due Date</TableHead>
                    <TableHead>Days Overdue</TableHead>
                    <TableHead>Reminder</TableHead>
                    <TableHead>Last Reminder</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overdue.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">{a.assigned_to_user_id || '—'}</TableCell>
                      <TableCell>{a.course_title || '—'}</TableCell>
                      <TableCell className="text-red-700 font-medium">{formatDate(a.due_date)}</TableCell>
                      <TableCell>
                        <Badge className={a._daysOverdue >= 14 ? 'bg-red-100 text-red-800' : 'bg-orange-100 text-orange-800'}>
                          {a._daysOverdue} {a._daysOverdue === 1 ? 'day' : 'days'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {a.reminder_sent ? (
                          <Badge className="bg-green-100 text-green-800">Sent</Badge>
                        ) : (
                          <Badge className="bg-slate-100 text-slate-600">Pending</Badge>
                        )}
                      </TableCell>
                      <TableCell>{formatDate(a.last_reminder_date)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
