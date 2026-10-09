import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { getTeamTrainingReadiness } from '@/functions/getTeamTrainingReadiness';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import LoadingState from '@/components/ui/LoadingState';
import DepartmentCompletionRow from '@/components/training/DepartmentCompletionRow';
import PrintTrainingSummaryButton from '@/components/training/PrintTrainingSummaryButton';

export default function DepartmentTrainingSummary() {
  const { user, tenantContext, tenantAuthorityKey } = useAuth();
  const [offset, setOffset] = useState(0);
  const allowed = user?.role === 'admin' || ['agency_admin', 'manager', 'platform_owner'].includes(tenantContext?.tenant_role);
  const summary = useQuery({
    queryKey: ['department-training-completion', user?.id, tenantAuthorityKey, offset],
    enabled: !!user?.id && allowed, retry: false,
    queryFn: async () => {
      const response = await getTeamTrainingReadiness({ departmentProgressOnly: true, offset });
      if (response.data?.error) throw new Error(response.data.error);
      return response.data;
    },
  });
  if (!allowed) return null;
  const overall = summary.data?.overall;
  return <Card className="border-border bg-card text-card-foreground">
    <CardHeader className="pb-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle className="text-lg">Course Completion by Department</CardTitle>
        <div className="flex flex-wrap items-start gap-2">
          <PrintTrainingSummaryButton disabled={!summary.isSuccess || summary.isFetching} />
          <Button variant="outline" size="sm" disabled={summary.isFetching} onClick={() => summary.refetch()}>Refresh</Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">Completed or passed course assignments divided by all active assignments, grouped by their assigned department.</p>
    </CardHeader>
    <CardContent className="space-y-4">
      {summary.isPending ? <LoadingState className="py-6" /> : summary.isError ?
        <div role="alert"><p className="mb-3 text-sm text-muted-foreground">Department completion could not be loaded.</p><Button variant="outline" onClick={() => summary.refetch()}>Try again</Button></div> : <>
          <div className="rounded-lg bg-muted p-4"><p className="text-sm text-muted-foreground">Overall course completion</p><strong className="text-2xl text-foreground">{overall?.percentage == null ? 'Not assessed' : `${overall.percentage}%`}</strong><p className="text-sm text-muted-foreground">{overall?.completed ?? 0} of {overall?.total ?? 0} assigned courses completed</p></div>
          {summary.data?.items?.length ? <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{summary.data.items.map(department => <DepartmentCompletionRow key={department.id} department={department} />)}</div> : <p className="py-4 text-center text-sm text-muted-foreground">No active course assignments for your current staff.</p>}
        </>}
      {!summary.isError && (offset > 0 || summary.data?.next_offset != null) && <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={offset === 0 || summary.isFetching} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous</Button>
        <Button variant="outline" disabled={summary.data?.next_offset == null || summary.isFetching} onClick={() => setOffset(summary.data.next_offset)}>Next</Button>
      </div>}
    </CardContent>
  </Card>;
}