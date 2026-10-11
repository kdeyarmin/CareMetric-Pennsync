import { Badge } from '@/components/ui/badge';
import { formatLocalDate, isPastLocalDueDate } from '@/lib/dateLocal';
export default function EmployeeCertificateRow({ item }) {
  const status = item.revoked ? 'Revoked' : isPastLocalDueDate(item.expiration_date) ? 'Expired' : 'Earned';
  return <li className="rounded-lg border border-border bg-background p-4 space-y-2">
    <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="text-base font-semibold text-foreground">{item.course_title}</h3><Badge variant="outline" className="border-border text-foreground">{status}</Badge></div>
    <p className="text-sm text-muted-foreground">Certificate: {item.certificate_id}</p>
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-foreground">
      <div><dt className="text-muted-foreground">Completed / issued</dt><dd>{formatLocalDate(item.completion_date || item.issued_at) || 'Not recorded'}</dd></div>
      <div><dt className="text-muted-foreground">Expiration</dt><dd>{formatLocalDate(item.expiration_date) || 'No expiration recorded'}</dd></div>
      {item.score != null && <div><dt className="text-muted-foreground">Final score</dt><dd>{item.score}%</dd></div>}
      {item.hours != null && <div><dt className="text-muted-foreground">Education hours</dt><dd>{item.hours}</dd></div>}
      {item.training_category && <div><dt className="text-muted-foreground">Category</dt><dd>{item.training_category.replaceAll('_', ' ')}</dd></div>}
    </dl>
  </li>;
}