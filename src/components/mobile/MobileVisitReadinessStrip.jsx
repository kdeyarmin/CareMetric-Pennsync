import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { buildMobileVisitReadiness } from '@/components/mobile/mobileVisitReadiness';

/**
 * Thin UI consumer for pure buildMobileVisitReadiness (P2-06).
 * Callers pass field-readiness signals already known in OfflineMode / visit flow.
 */
export default function MobileVisitReadinessStrip({
  patientCached = false,
  hasPatientContext = false,
  hasDraftNote = false,
  pendingSyncCount = 0,
  isOnline = true,
  hasRequiredForms = true,
  patientName,
}) {
  const readiness = buildMobileVisitReadiness({
    patientCached,
    hasPatientContext,
    hasDraftNote,
    pendingSyncCount,
    isOnline,
    hasRequiredForms,
  });

  const tone =
    readiness.severity === 'blocked'
      ? { card: 'border-red-200 bg-red-50/40', badge: 'bg-red-100 text-red-800', Icon: AlertTriangle }
      : readiness.severity === 'warning'
        ? { card: 'border-amber-200 bg-amber-50/40', badge: 'bg-amber-100 text-amber-800', Icon: Info }
        : { card: 'border-emerald-200 bg-emerald-50/40', badge: 'bg-emerald-100 text-emerald-800', Icon: CheckCircle2 };

  const Icon = tone.Icon;

  return (
    <Card className={`shadow-sm ${tone.card}`}>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <Icon className="h-4 w-4 text-slate-700" />
          <CardTitle className="text-base text-slate-900">Visit readiness</CardTitle>
          <Badge className={`ml-auto ${tone.badge}`}>
            {readiness.severity === 'blocked' ? 'Blocked' : readiness.severity === 'warning' ? 'Caution' : 'Ready'}
          </Badge>
        </div>
        {patientName && (
          <p className="text-sm text-slate-600">
            Field check for <span className="font-medium text-slate-900">{patientName}</span>
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {readiness.blockers.map((msg) => (
          <p key={msg} className="flex gap-2 text-sm text-red-800">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{msg}</span>
          </p>
        ))}
        {readiness.warnings.map((msg) => (
          <p key={msg} className="flex gap-2 text-sm text-amber-800">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{msg}</span>
          </p>
        ))}
        {readiness.severity === 'ready' && (
          <p className="flex gap-2 text-sm text-emerald-800">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>Patient context is cached. You can document this visit offline or online.</span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
