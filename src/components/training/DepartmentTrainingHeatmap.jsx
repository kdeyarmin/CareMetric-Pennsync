import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { getTeamTrainingReadiness } from '@/functions/getTeamTrainingReadiness';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import LoadingState from '@/components/ui/LoadingState';
import DepartmentHeatmapTiles from '@/components/training/DepartmentHeatmapTiles';

export default function DepartmentTrainingHeatmap() {
  const { user, tenantContext, tenantAuthorityKey } = useAuth();
  const [offset, setOffset] = useState(0);
  const allowed = user?.role === 'admin' || ['agency_admin', 'manager', 'platform_owner'].includes(tenantContext?.tenant_role);
  const heatmap = useQuery({
    queryKey: ['department-training-heatmap', user?.id, tenantAuthorityKey, offset],
    enabled: !!user?.id && !!tenantAuthorityKey && allowed, retry: false,
    queryFn: async () => {
      const response = await getTeamTrainingReadiness({ departmentHeatmapOnly: true, offset });
      if (response.data?.error || !Array.isArray(response.data?.items)) throw new Error(response.data?.error || 'Heat map unavailable.');
      return response.data;
    },
  });
  if (!allowed) return null;
  return <Card className="border-border bg-card text-card-foreground">
    <CardHeader>
      <div className="flex flex-wrap items-center justify-between gap-3"><CardTitle className="text-lg">Department Training Heat Map</CardTitle><Button variant="outline" size="sm" disabled={heatmap.isFetching} onClick={() => heatmap.refetch()}>Refresh heat map</Button></div>
      <p className="text-sm text-muted-foreground">Lowest-progress departments appear first. Redder tiles indicate lower progress; outlined tiles mark the lowest average, including ties.</p>
      <p className="text-xs text-muted-foreground">All-time average of non-archived course assignment progress for active staff, grouped by assigned department. Each assignment has equal weight; completed or passed courses count as 100%, missing progress as 0%. Independent of the nurse and date filters above.</p>
    </CardHeader>
    <CardContent className="space-y-4">
      {heatmap.isPending ? <LoadingState className="py-6" /> : heatmap.isError ?
        <div role="alert"><p className="mb-3 text-sm text-muted-foreground">Department training progress could not be loaded.</p><Button variant="outline" onClick={() => heatmap.refetch()}>Try again</Button></div> :
        heatmap.data.items.length ? <DepartmentHeatmapTiles departments={heatmap.data.items} /> : <p className="py-6 text-center text-sm text-muted-foreground">No course assignments are available for your current staff.</p>}
      {!heatmap.isError && (offset > 0 || heatmap.data?.next_offset != null) && <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={offset === 0 || heatmap.isFetching} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous</Button>
        <Button variant="outline" disabled={heatmap.data?.next_offset == null || heatmap.isFetching} onClick={() => setOffset(heatmap.data.next_offset)}>Next</Button>
      </div>}
    </CardContent>
  </Card>;
}