import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ClipboardList } from 'lucide-react';
import { useAuthorizedPatient } from '@/hooks/useAuthorizedPatient';
import { patientInformationRows } from './patientInformationRows';

// Owner decision 2026-10-15: all patient information and names must be
// visible on the chart. This reads through the existing purpose-bound patient
// broker, which re-checks chart access on every read; no projection is
// widened. Clinical roles get the two clinical-context projections; social
// work and spiritual care get the identity and diagnosis projections their
// roles are allowed.
const CLINICAL_ROLES = new Set(['platform_owner', 'agency_admin', 'manager', 'clinician']);

export default function PatientInformationCard({ patientId, agencyId, tenantRole }) {
  const clinical = CLINICAL_ROLES.has(tenantRole);
  const summary = useAuthorizedPatient({
    patientId,
    agencyId,
    purpose: clinical ? 'smart_note_context' : 'selector',
    enabled: true,
  });
  const history = useAuthorizedPatient({
    patientId,
    agencyId,
    purpose: clinical ? 'oasis_analysis_context' : 'visit_summary',
    enabled: true,
  });

  const rows = useMemo(
    () => patientInformationRows({ ...(history.data || {}), ...(summary.data || {}) }),
    [history.data, summary.data],
  );
  const loading = (summary.isLoading || history.isLoading) && !rows.length;
  const failed = !!(summary.error || history.error);

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
