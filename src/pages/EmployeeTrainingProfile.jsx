import { Link, useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { getTeamTrainingReadiness } from '@/functions/getTeamTrainingReadiness';
import { withTimeout } from '@/components/smartNote/compliance/withTimeout';
import PageContainer from '@/components/ui/PageContainer';
import LoadingState from '@/components/ui/LoadingState';
import { Button } from '@/components/ui/button';
import EmployeeTrainingDetails from '@/components/training/EmployeeTrainingDetails';
export default function EmployeeTrainingProfile() {
  const { user, tenantContext, tenantAuthorityKey } = useAuth();
  const location = useLocation();
  const employeeId = new URLSearchParams(location.search).get('id');
  const allowed = user?.role === 'admin' || ['agency_admin', 'manager', 'platform_owner'].includes(tenantContext?.tenant_role);
  const profile = useQuery({
    queryKey: ['employee-training-profile', user?.id, tenantAuthorityKey, employeeId],
    enabled: !!employeeId && !!user?.id && !!tenantAuthorityKey && allowed, retry: false,
    refetchOnWindowFocus: false, refetchOnReconnect: false,
    queryFn: async () => {
      const response = await withTimeout(
        getTeamTrainingReadiness({ employeeProfileOnly: true, employeeId }), 30000,
        'Training details took too long to load. Please try again.',
      );
      if (response.data?.error || !response.data?.employee) throw new Error(response.data?.error || 'Employee profile unavailable.');
      return response.data;
    },
  });
  return <PageContainer>
    <Button asChild variant="outline"><Link to={allowed ? '/NursePerformanceDashboard' : '/Dashboard'}>{allowed ? 'Back to staff performance' : 'Back to dashboard'}</Link></Button>
    {!allowed ? <p role="alert">Manager or administrator access is required.</p> : !employeeId ? <p>Select an employee from the staff leaderboard to view their profile.</p> : profile.isPending ? <LoadingState /> : profile.isError ?
      <div role="alert" className="space-y-3"><h1 className="text-xl text-foreground">Employee profile unavailable</h1><p>The employee may not be in your agency, or their training details could not be loaded.</p><Button variant="outline" onClick={() => profile.refetch()}>Try again</Button></div> : <>
        <header className="space-y-2"><h1 className="text-2xl sm:text-3xl text-foreground">{profile.data.employee.name}</h1><p className="text-muted-foreground">{profile.data.employee.email}</p><p className="text-sm text-muted-foreground">Employee training profile</p></header>
        <EmployeeTrainingDetails key={`${tenantAuthorityKey}:${employeeId}:${profile.dataUpdatedAt}`} data={profile.data} />
      </>}
  </PageContainer>;
}