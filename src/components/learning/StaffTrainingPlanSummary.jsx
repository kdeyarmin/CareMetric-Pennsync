import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { getTeamTrainingReadiness } from '@/functions/getTeamTrainingReadiness';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import LoadingState from '@/components/ui/LoadingState';
import StaffPlanProgressRow from '@/components/learning/StaffPlanProgressRow';

export default function StaffTrainingPlanSummary() {
  const { user, tenantContext, tenantAuthorityKey } = useAuth();
  const [offset, setOffset] = useState(0);
  const allowed = user?.role === 'admin' || ['agency_admin', 'manager', 'platform_owner'].includes(tenantContext?.tenant_role);
  const summary = useQuery({
    queryKey: ['staff-training-plan-progress', user?.id, tenantAuthorityKey, offset],
    enabled: !!user?.id && allowed, retry: false,
    queryFn: async () => {
      const response = await getTeamTrainingReadiness({ planProgressOnly: true, offset });
      if (response.data?.error) throw new Error(response.data.error);
      return response.data;
    },
  });
  if (!allowed) return null;
  return <Card className="border-border bg-card text-card-foreground">
    <CardHeader className="pb-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle className="text-lg">Staff Training Plan Progress</CardTitle>
        <Button variant="outline" size="sm" disabled={summary.isFetching} onClick={() => summary.refetch()}>Refresh</Button>
      </div>
      <p className="text-sm text-muted-foreground">Average progress across staff enrolled in each PennSync plan. Cancelled enrollments are excluded.</p>
    </CardHeader>
    <CardContent className="space-y-3">
      {summary.isPending ? <LoadingState className="py-6" /> : summary.isError ?
        <div role="alert"><p className="mb-3 text-sm text-muted-foreground">Staff plan progress could not be loaded.</p><Button variant="outline" onClick={() => summary.refetch()}>Try again</Button></div> :
        summary.data?.items?.length ? summary.data.items.map(plan => <StaffPlanProgressRow key={plan.id} plan={plan} />) :
        <p className="py-4 text-center text-sm text-muted-foreground">No training plans are assigned to your current staff.</p>}
      {!summary.isError && (offset > 0 || summary.data?.next_offset != null) && <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={offset === 0 || summary.isFetching} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous</Button>
        <Button variant="outline" disabled={summary.data?.next_offset == null || summary.isFetching} onClick={() => setOffset(summary.data.next_offset)}>Next</Button>
      </div>}
    </CardContent>
  </Card>;
}