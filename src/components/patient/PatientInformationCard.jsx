import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ClipboardList } from 'lucide-react';
import { patientInformationRows } from './patientInformationRows';

// Owner decision 2026-10-15: all patient information and names must be
// visible on the chart. PatientDetails reads the two role-specific projections
// through the purpose-bound patient broker (see patientInformationPurposes) and
// hands them in; this card only renders them. It must not read for itself: a
// reader that mounts after the chart gate passes re-runs the shared identity
// and tenant checks, which re-closes the gate and unmounts the card again.
export default function PatientInformationCard({ summary, history }) {
  const rows = useMemo(
    () => patientInformationRows({ ...(history?.data || {}), ...(summary?.data || {}) }),
    [history?.data, summary?.data],
  );
  const failed = !!(summary?.error || history?.error);
  const loading = !rows.length && !failed && !!(summary?.isPending || history?.isPending);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardList className="h-5 w-5 text-navy-600" aria-hidden="true" />
          Patient information
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm">
        {loading && <p className="text-slate-500">Loading patient information…</p>}
        {failed && (
          <p className="mb-3 text-amber-700" role="status">
            Some patient information could not be loaded. Reload the page to try again.
          </p>
        )}
        {!loading && !rows.length && !failed && (
          <p className="text-slate-500">No further information is recorded for this patient.</p>
        )}
        {rows.length > 0 && (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            {rows.map((row) => (
              <div key={row.key} className="min-w-0">
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{row.label}</dt>
                {row.lines.map((line, index) => (
                  <dd key={index} className="break-words text-slate-900">{line}</dd>
                ))}
              </div>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
