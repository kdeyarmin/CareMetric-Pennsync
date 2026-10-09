import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { manageAiResponsibilityPolicy } from '@/functions/manageAiResponsibilityPolicy';

const POLICY_QUERY_KEY = ['platformAiResponsibilityPolicy'];

export default function AIResponsibilityPolicyPanel() {
  const client = useQueryClient();
  const policy = useQuery({ queryKey: POLICY_QUERY_KEY, queryFn: () => manageAiResponsibilityPolicy(), retry: false });
  const save = useMutation({
    mutationFn: enabled => manageAiResponsibilityPolicy({ bypass_previously_acknowledged: enabled }),
    onSuccess: async result => {
      client.setQueryData(POLICY_QUERY_KEY, result);
      await client.invalidateQueries({ queryKey: ['aiContentAgreementStatus'] });
    },
  });
  return <Card>
    <CardHeader><CardTitle>AI responsibility disclaimer</CardTitle>
      <CardDescription>Platform-wide access policy for previously acknowledged clinicians.</CardDescription>
    </CardHeader>
    <CardContent className="space-y-3">
      {policy.isPending ? <p role="status">Loading consent setting…</p> : policy.isError ?
        <div role="alert"><p>{policy.error.message}</p><Button variant="outline" onClick={() => policy.refetch()}>Retry</Button></div> :
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="skip-repeat-ai-disclaimer">Bypass repeat disclaimers for previously acknowledged clinicians</Label>
          <Switch id="skip-repeat-ai-disclaimer" checked={policy.data.bypass_previously_acknowledged} disabled={save.isPending} onCheckedChange={enabled => save.mutate(enabled)} />
        </div>}
      <p className="text-sm text-muted-foreground">When enabled, a verified acknowledgment of a previous agreement version also permits access. First-time users must still acknowledge the disclaimer. Sign-in and agency-access checks remain required. When disabled, acknowledgment of the current version is required (recommended).</p>
      {save.isPending && <p role="status">Saving…</p>}
      {save.isError && <p role="alert" className="text-sm text-destructive">{save.error.message}</p>}
    </CardContent>
  </Card>;
}