import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { getTeamTrainingReadiness } from '@/functions/getTeamTrainingReadiness';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import LoadingState from '@/components/ui/LoadingState';
import TrainingAssignmentFilters from '@/components/training/TrainingAssignmentFilters';
import TrainingAssignmentRow from '@/components/training/TrainingAssignmentRow';

export default function FilteredTrainingAssignments() {
  const { user, tenantContext, tenantAuthorityKey } = useAuth();
  const [filters, setFilters] = useState({ status: '', department: '', priority: '' });
  const [cursors, setCursors] = useState([null]);
  const [departments, setDepartments] = useState([]);
  const cursor = cursors[cursors.length - 1];
  const teamView = user?.role === 'admin' || ['agency_admin', 'manager', 'platform_owner'].includes(tenantContext?.tenant_role);
  const assignments = useQuery({
    queryKey: ['filtered-training-assignments', user?.id, tenantAuthorityKey, filters, cursor],
    enabled: !!user?.id && !!tenantAuthorityKey, retry: false,
    queryFn: async () => {
      const response = await getTeamTrainingReadiness({ assignmentsOnly: true, ...filters, cursor });
      if (response.data?.error || !Array.isArray(response.data?.items)) throw new Error(response.data?.error || 'Assignments unavailable.');
      return response.data;
    },
  });
  useEffect(() => { if (assignments.data) setDepartments(Array.isArray(assignments.data.departments) ? assignments.data.departments : []); }, [assignments.data]);
  const changeFilters = next => { setFilters(next); setCursors([null]); };
  return <Card className="border-border bg-card text-card-foreground">
    <CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><CardTitle className="text-lg">{teamView ? 'Staff Training Assignments' : 'My Training Assignments'}</CardTitle><Button variant="outline" size="sm" disabled={assignments.isFetching} onClick={() => assignments.refetch()}>Refresh assignments</Button></div>
      <p className="text-sm text-muted-foreground">Filter by status, department, and priority. Choose Overdue, Failed, or Locked to identify assignments needing attention; earliest due dates appear first.</p>
    </CardHeader>
    <CardContent className="space-y-4">
      <TrainingAssignmentFilters filters={filters} departments={departments} onChange={changeFilters} />
      {assignments.isPending ? <LoadingState className="py-6" /> : assignments.isError ? <div role="alert"><p className="mb-3 text-sm text-muted-foreground">Training assignments could not be loaded.</p><Button variant="outline" onClick={() => assignments.refetch()}>Try again</Button></div> : assignments.data.items.length ?
        <ul className="space-y-3" aria-label="Filtered training assignments">{assignments.data.items.map(assignment => <TrainingAssignmentRow key={assignment.id} assignment={assignment} />)}</ul> : <p className="py-6 text-center text-sm text-muted-foreground">No assignments match these filters.</p>}
      {!assignments.isError && (cursors.length > 1 || assignments.data?.has_more) && <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={cursors.length === 1 || assignments.isFetching} onClick={() => setCursors(cursors.slice(0, -1))}>Previous</Button>
        <Button variant="outline" disabled={!assignments.data?.has_more || !assignments.data?.next_cursor || assignments.isFetching} onClick={() => setCursors([...cursors, assignments.data.next_cursor])}>Next</Button>
      </div>}
    </CardContent>
  </Card>;
}