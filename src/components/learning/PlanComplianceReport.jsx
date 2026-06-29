import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Download, Award, Loader2, CheckCircle2, Clock, AlertTriangle } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import ReportFilters from './ReportFilters';
import { toCsv, exportTimestamp } from '../admin/csvExport';
import { toast } from 'sonner';

const formatDate = (value) => (value ? new Date(value).toLocaleDateString() : '—');

const statusColors = {
  active: 'bg-blue-100 text-blue-800',
  in_progress: 'bg-yellow-100 text-yellow-800',
  completed: 'bg-green-100 text-green-800',
  overdue: 'bg-red-100 text-red-800',
  cancelled: 'bg-slate-100 text-slate-600',
};

// An enrollment is considered out of compliance when it is overdue, or still
// open past its due date.
const isOverdue = (e) => {
  if (e.status === 'completed' || e.status === 'cancelled') return false;
  if (e.status === 'overdue') return true;
  return !!e.due_date && new Date(e.due_date) < new Date();
};

export default function PlanComplianceReport() {
  const [filters, setFilters] = useState({
    businessLine: 'home_health',
    dateStart: '',
    dateEnd: '',
    employee: '',
    status: 'all',
  });

  const { data: enrollments = [], isLoading } = useQuery({
    queryKey: ['plan-compliance-enrollments'],
    queryFn: () => base44.entities.PlanEnrollment.list('-enrolled_at', 2000),
    initialData: [],
  });

  const filtered = useMemo(() => {
    const empNeedle = filters.employee.trim().toLowerCase();
    return enrollments.filter((e) => {
      if (filters.status !== 'all' && e.status !== filters.status) return false;
      if (empNeedle && !(e.user_name || e.user_id || '').toLowerCase().includes(empNeedle)) return false;
      if (filters.dateStart && e.enrolled_at && new Date(e.enrolled_at) < new Date(filters.dateStart)) return false;
      if (filters.dateEnd && e.enrolled_at && new Date(e.enrolled_at) > new Date(`${filters.dateEnd}T23:59:59`)) return false;
      return true;
    });
  }, [enrollments, filters]);

  const stats = useMemo(() => {
    const total = filtered.length;
    const completed = filtered.filter((e) => e.status === 'completed').length;
    const overdue = filtered.filter(isOverdue).length;
    const inProgress = filtered.filter((e) => e.status === 'in_progress' || e.status === 'active').length;
    const complianceRate = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { total, completed, overdue, inProgress, complianceRate };
  }, [filtered]);

  const handleExportCSV = () => {
    if (filtered.length === 0) {
      toast.error('No data to export');
      return;
    }
    const csv = toCsv(
      [
        { key: 'user_name', label: 'Employee', format: (v, r) => v || r.user_id || '' },
        { key: 'plan_name', label: 'Learning Plan' },
        { key: 'enrolled_at', label: 'Enrolled', format: formatDate },
        { key: 'due_date', label: 'Due Date', format: formatDate },
        { key: 'status', label: 'Status' },
        { key: 'progress_percentage', label: 'Progress %', format: (v) => (v != null ? `${v}%` : '') },
        { key: 'courses_completed', label: 'Courses Completed', format: (v, r) => `${v ?? 0}/${r.courses_total ?? 0}` },
        { key: 'completion_date', label: 'Completed On', format: formatDate },
      ],
      filtered,
    );
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `learning_plan_compliance_${exportTimestamp()}.csv`;
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
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-l-4 border-l-blue-600">
          <CardContent className="p-4">
            <p className="text-sm text-slate-500">Enrollments</p>
            <p className="text-2xl font-bold">{stats.total}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-green-600">
          <CardContent className="p-4">
            <p className="text-sm text-slate-500 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Completed</p>
            <p className="text-2xl font-bold">{stats.completed}</p>
            <p className="text-xs text-slate-500">{stats.complianceRate}% compliant</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-yellow-500">
          <CardContent className="p-4">
            <p className="text-sm text-slate-500 flex items-center gap-1"><Clock className="w-3 h-3" /> In Progress</p>
            <p className="text-2xl font-bold">{stats.inProgress}</p>
          </CardContent>
        </Card>
        <Card className="border-l-4 border-l-red-600">
          <CardContent className="p-4">
            <p className="text-sm text-slate-500 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Overdue</p>
            <p className="text-2xl font-bold">{stats.overdue}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <Award className="w-5 h-5" />
            Learning Plan Compliance ({filtered.length})
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
          ) : filtered.length === 0 ? (
            <div className="text-center py-8">
              <Award className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <p className="text-slate-500">No plan enrollments found for the selected filters.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Learning Plan</TableHead>
                    <TableHead>Enrolled</TableHead>
                    <TableHead>Due Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Progress</TableHead>
                    <TableHead>Courses</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((e) => {
                    const overdue = isOverdue(e);
                    return (
                      <TableRow key={e.id} className={overdue ? 'bg-red-50/40' : undefined}>
                        <TableCell className="font-medium">{e.user_name || e.user_id || '—'}</TableCell>
                        <TableCell>{e.plan_name || '—'}</TableCell>
                        <TableCell>{formatDate(e.enrolled_at)}</TableCell>
                        <TableCell className={overdue ? 'text-red-700 font-medium' : undefined}>
                          {formatDate(e.due_date)}
                        </TableCell>
                        <TableCell>
                          <Badge className={statusColors[overdue ? 'overdue' : e.status] || 'bg-slate-100 text-slate-800'}>
                            {(overdue ? 'overdue' : e.status || 'unknown').replace(/_/g, ' ')}
                          </Badge>
                        </TableCell>
                        <TableCell className="w-40">
                          <div className="flex items-center gap-2">
                            <Progress value={e.progress_percentage || 0} className="h-2" />
                            <span className="text-xs text-slate-500 w-9 text-right">{e.progress_percentage || 0}%</span>
                          </div>
                        </TableCell>
                        <TableCell>{e.courses_completed ?? 0}/{e.courses_total ?? 0}</TableCell>
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
