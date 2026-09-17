import { Button } from '@/components/ui/button';
import LoadingState from '@/components/ui/LoadingState';

export default function ReportReadState({ queries, title = 'Report data' }) {
  const failed = queries.some(query => query.isError);
  if (!failed) return <LoadingState label={`Loading ${title.toLowerCase()}...`} />;
  return <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
    <p>{title} is unavailable. Retry before viewing totals or exporting a report.</p>
    <Button variant="outline" className="mt-3" disabled={queries.some(query => query.isFetching)} onClick={() => {
      for (const query of queries) void query.refetch();
    }}>Retry report data</Button>
  </div>;
}
