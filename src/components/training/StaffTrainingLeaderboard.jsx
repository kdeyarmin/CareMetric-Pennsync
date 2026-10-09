import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { getTeamTrainingReadiness } from '@/functions/getTeamTrainingReadiness';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import LoadingState from '@/components/ui/LoadingState';
import StaffTrainingLeaderboardRow from '@/components/training/StaffTrainingLeaderboardRow';

export default function StaffTrainingLeaderboard() {
  const { user, tenantContext, tenantAuthorityKey } = useAuth();
  const [offset, setOffset] = useState(0);
  const allowed = user?.role === 'admin' || ['agency_admin', 'manager', 'platform_owner'].includes(tenantContext?.tenant_role);
  const leaderboard = useQuery({
    queryKey: ['staff-training-leaderboard', user?.id, tenantAuthorityKey, offset],
    enabled: !!user?.id && allowed, retry: false,
    queryFn: async () => {
      const response = await getTeamTrainingReadiness({ leaderboardOnly: true, offset });
      if (response.data?.error || !Array.isArray(response.data?.items)) throw new Error(response.data?.error || 'Leaderboard unavailable.');
      return response.data;
    },
  });
  if (!allowed) return null;
  return <Card className="border-border bg-card text-card-foreground">
    <CardHeader>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle className="text-lg">Staff Training Leaderboard</CardTitle>
        <Button variant="outline" size="sm" disabled={leaderboard.isFetching} onClick={() => leaderboard.refetch()}>Refresh leaderboard</Button>
      </div>
      <p className="text-sm text-muted-foreground">Ranked by average training plan progress, then completed plan courses. Equal results share a rank.</p>
      <p className="text-xs text-muted-foreground">All-time progress across non-cancelled plans for active staff; course completions are summed across plans. Independent of the nurse and date filters above.</p>
      <p className="text-xs text-muted-foreground">Badges show plan completion status and issued training certificates, excluding revoked awards. Earned certificates may include expired awards; these are not professional licenses.</p>
    </CardHeader>
    <CardContent className="space-y-4">
      {leaderboard.isPending ? <LoadingState className="py-6" /> : leaderboard.isError ?
        <div role="alert"><p className="mb-3 text-sm text-muted-foreground">The training leaderboard could not be loaded.</p><Button variant="outline" onClick={() => leaderboard.refetch()}>Try again</Button></div> :
        leaderboard.data.items.length ? <ol className="space-y-3" aria-label="Staff training rankings">{leaderboard.data.items.map(staff => <StaffTrainingLeaderboardRow key={staff.id} staff={staff} />)}</ol> :
        <p className="py-6 text-center text-sm text-muted-foreground">No training plan enrollments for your current staff yet.</p>}
      {!leaderboard.isError && (offset > 0 || leaderboard.data?.next_offset != null) && <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={offset === 0 || leaderboard.isFetching} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous</Button>
        <Button variant="outline" disabled={leaderboard.data?.next_offset == null || leaderboard.isFetching} onClick={() => setOffset(leaderboard.data.next_offset)}>Next</Button>
      </div>}
    </CardContent>
  </Card>;
}