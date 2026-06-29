import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Download, FileText, Users, Loader2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import ReportFilters from './ReportFilters';
import { toCsvRows } from "@/components/admin/csvExport";
import { toast } from 'sonner';

const formatDate = (value) => value ? new Date(value).toLocaleDateString() : '—';

const statusColors = {
  assigned: 'bg-blue-100 text-blue-800',
  in_progress: 'bg-yellow-100 text-yellow-800',
  completed: 'bg-green-100 text-green-800',
  overdue: 'bg-red-100 text-red-800',
  failed: 'bg-red-100 text-red-700',
};

export default function CourseRosterReport() {
  const [selectedCourse, setSelectedCourse] = useState('');
  const [filters, setFilters] = useState({
    businessLine: 'home_health',
    dateStart: '',
    dateEnd: '',
    status: 'all'
  });

  const { data: courses = [] } = useQuery({
    queryKey: ['roster-courses'],
    queryFn: () => base44.entities.TrainingCourse.filter({ status: 'published' }, 'title'),
    initialData: []
  });

  const { data: roster = [], isLoading: rosterLoading } = useQuery({
    queryKey: ['roster', selectedCourse],
    queryFn: () => base44.entities.TrainingAssignment.filter({ course_id: selectedCourse }, '-created_date', 500),
    initialData: [],
    enabled: !!selectedCourse
  });

  // Apply status filter
  const filteredRoster = filters.status === 'all'
    ? roster
    : roster.filter(a => a.status === filters.status);

  const selectedCourseTitle = courses.find(c => c.id === selectedCourse)?.title || '';

  const handleExportCSV = () => {
    if (filteredRoster.length === 0) {
      toast.error('No data to export');
      return;
    }
    const headers = ['Employee', 'Assigned Date', 'Due Date', 'Status', 'Completion Date', 'Score', 'Attempts'];
    const rows = filteredRoster.map(a => [
      a.assigned_to_user_id || '',
      a.assigned_date ? formatDate(a.assigned_date) : (a.created_date ? formatDate(a.created_date) : ''),
      a.due_date ? formatDate(a.due_date) : '',
      a.status || '',
      a.completion_date ? formatDate(a.completion_date) : '',
      a.score_percentage != null ? `${a.score_percentage}%` : (a.score != null ? a.score : ''),
      a.latest_attempt_number || '0',
    ]);
    const csv = toCsvRows([headers, ...rows]);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedCourseTitle.replace(/\s+/g, '_')}_roster.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV exported successfully');
  };

  const handleExportPDF = async () => {
    if (filteredRoster.length === 0) {
      toast.error('No data to export');
      return;
    }
    const data = filteredRoster.map(a => ({
      employee: a.assigned_to_user_id || '',
      assigned: a.assigned_date ? formatDate(a.assigned_date) : (a.created_date ? formatDate(a.created_date) : ''),
      due: a.due_date ? formatDate(a.due_date) : '',
      status: a.status || '',
      completion: a.completion_date ? formatDate(a.completion_date) : '',
      score: a.score_percentage != null ? `${a.score_percentage}%` : (a.score != null ? String(a.score) : ''),
      attempts: a.latest_attempt_number || '0',
    }));
    const columns = [
      { key: 'employee', header: 'Employee' },
      { key: 'assigned', header: 'Assigned Date' },
      { key: 'due', header: 'Due Date' },
      { key: 'status', header: 'Status' },
      { key: 'completion', header: 'Completion Date' },
      { key: 'score', header: 'Score' },
      { key: 'attempts', header: 'Attempts' },
    ];
    try {
      const { exportDataTableToPDF } = await import('@/components/utils/pdfExporter');
      await exportDataTableToPDF(data, columns, {
        filename: `${selectedCourseTitle.replace(/\s+/g, '_')}_roster.pdf`,
        title: `${selectedCourseTitle} — Course Roster`,
        subtitle: `${filteredRoster.length} enrolled`,
      });
      toast.success('PDF exported successfully');
    } catch (err) {
      console.error('Roster PDF export error:', err);
      toast.error('Failed to export PDF');
    }
  };

  return (
    <div className="space-y-6">
      <ReportFilters
        onFilterChange={setFilters}
        businessLineOptions={[
          { value: 'home_health', label: 'Home Health' },
          { value: 'hospice', label: 'Hospice' }
        ]}
        showCourse={false}
        showPlan={false}
      />

      {/* Course Selector */}
      <Card>
        <CardHeader>
          <CardTitle>Select Course</CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={selectedCourse} onValueChange={setSelectedCourse}>
            <SelectTrigger>
              <SelectValue placeholder="Choose a course to view its roster..." />
            </SelectTrigger>
            <SelectContent>
              {courses.map(course => (
                <SelectItem key={course.id} value={course.id}>
                  {course.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {selectedCourse && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              Course Roster ({filteredRoster.length} enrolled)
            </CardTitle>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="gap-2" onClick={handleExportPDF}>
                <FileText className="w-4 h-4" />
                Export PDF
              </Button>
              <Button variant="outline" size="sm" className="gap-2" onClick={handleExportCSV}>
                <Download className="w-4 h-4" />
                Export CSV
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {rosterLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
              </div>
            ) : filteredRoster.length === 0 ? (
              <div className="text-center py-8">
                <Users className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                <p className="text-slate-500">No enrollments found for this course.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Assigned</TableHead>
                      <TableHead>Due Date</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Completion Date</TableHead>
                      <TableHead>Score</TableHead>
                      <TableHead>Attempts</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRoster.map(assignment => (
                      <TableRow key={assignment.id}>
                        <TableCell className="font-medium">
                          {assignment.assigned_to_user_id}
                        </TableCell>
                        <TableCell>{formatDate(assignment.assigned_date || assignment.created_date)}</TableCell>
                        <TableCell>{formatDate(assignment.due_date)}</TableCell>
                        <TableCell>
                          <Badge className={statusColors[assignment.status] || 'bg-slate-100 text-slate-800'}>
                            {assignment.status?.replace(/_/g, ' ') || 'unknown'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {assignment.completion_date ? formatDate(assignment.completion_date) : '—'}
                        </TableCell>
                        <TableCell>
                          {assignment.score_percentage != null
                            ? `${assignment.score_percentage}%`
                            : (assignment.score != null ? assignment.score : '—')}
                        </TableCell>
                        <TableCell>
                          {assignment.latest_attempt_number || 0}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
