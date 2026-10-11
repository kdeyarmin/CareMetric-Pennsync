import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { getTeamTrainingReadiness } from '@/functions/getTeamTrainingReadiness';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
export default function EmployeeTrainingSection({ employeeId, section, initialPage, title, description, empty, Row }) {
  const [page, setPage] = useState(initialPage);
  const more = useMutation({
    mutationFn: async () => {
      const response = await getTeamTrainingReadiness({ employeeProfileOnly: true, employeeId, profileSection: section, cursor: page.next_cursor });
      if (response.data?.error || !response.data?.[section]) throw new Error(response.data?.error || 'Training details could not be loaded.');
      return response.data[section];
    },
    onSuccess: next => setPage(previous => ({ ...next, items: [...new Map([...previous.items, ...next.items].map(item => [item.id, item])).values()] })),
  });
  return <Card className="border-border bg-card text-card-foreground">
    <CardHeader><CardTitle className="text-lg">{title}</CardTitle><p className="text-sm text-muted-foreground">{description}</p></CardHeader>
    <CardContent className="space-y-4">
      {page.items.length ? <ul className="space-y-3" aria-label={title}>{page.items.map(item => <Row key={item.id} item={item} />)}</ul> : <p className="text-sm text-muted-foreground">{empty}</p>}
      {more.isError && <p role="alert" className="text-sm text-destructive">More details could not be loaded. Please try again.</p>}
      {page.has_more && <Button variant="outline" disabled={more.isPending} onClick={() => more.mutate()}>{more.isPending ? 'Loading…' : `Load more ${section}`}</Button>}
    </CardContent>
  </Card>;
}