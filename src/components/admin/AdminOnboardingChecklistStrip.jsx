import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Circle, ListChecks, ArrowRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { base44 } from '@/api/base44Client';
import { agencyQueryKey } from '@/lib/agencyRoster';
import { buildAdminOnboardingChecklist } from '@/components/admin/adminOnboardingChecklist';

/**
 * Thin UI consumer for pure buildAdminOnboardingChecklist (P2-07).
 * Self-loads lightweight counts so host pages only need to mount the strip.
 */
export default function AdminOnboardingChecklistStrip() {
  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });
  const { data: settings } = useQuery({
    queryKey: ['agencySettings', currentUser?.agency_name || null],
    queryFn: async () => {
      const { fetchCallerAgencySettings } = await import('@/lib/agencySettings');
      return fetchCallerAgencySettings(currentUser?.agency_name);
    },
    enabled: !!currentUser,
  });

  const { data: users = [] } = useQuery({
    queryKey: ['onboardingUserCount', agencyQueryKey(currentUser)],
    queryFn: async () => {
      const _rows = await base44.entities.User.list('-created_date', 50);
      const { filterUsersByCallerAgency } = await import('@/lib/agencyScope');
      return filterUsersByCallerAgency(_rows, currentUser);
    },
    enabled: !!currentUser,
    staleTime: 120000,
  });

  const { data: invitations = [] } = useQuery({
    queryKey: ['onboardingInvitationCount'],
    queryFn: () => base44.entities.UserInvitation.list('-created_date', 50),
    staleTime: 120000,
  });

  // Entities match the checklist's own routes: /TemplateManagement reads
  // DocumentTemplate, /AdminTraining reads TrainingAssignment. Naming them
  // directly keeps the counts consistent with the page each item links to.
  const { data: templates = [] } = useQuery({
    queryKey: ['onboardingTemplateCount'],
    queryFn: () => base44.entities.DocumentTemplate.list('-created_date', 50).catch(() => []),
    staleTime: 120000,
  });

  const { data: trainingAssignments = [] } = useQuery({
    queryKey: ['onboardingTrainingAssignments'],
    queryFn: () => base44.entities.TrainingAssignment.list('-created_date', 50).catch(() => []),
    staleTime: 120000,
  });

  const agencyProfileComplete = Boolean(
    settings?.office_name && String(settings.office_name).trim()
      && settings?.office_zip_code && String(settings.office_zip_code).trim()
  );

  const invitedStaffCount = Math.max(
    (users || []).length,
    (invitations || []).length,
  );

  const checklist = buildAdminOnboardingChecklist({
    // Viewing the running app implies Base44 app config is present.
    appConfigured: true,
    agencyProfileComplete,
    invitedStaffCount,
    // Provider secrets are server-only; treat as incomplete until product wires a safe probe.
    telnyxSecretConfigured: false,
    clinicalTemplateCount: (templates || []).length,
    requiredTrainingAssigned: (trainingAssignments || []).length > 0,
  });

  // Hide once fully ready for pilot (including optional checks) to reduce noise.
  if (checklist.readyForPilot && !checklist.nextAction) return null;
  // Keep visible while required items remain incomplete.
  if (checklist.readyForPilot && checklist.nextAction?.id === 'telnyx_secret') {
    // Optional-only remaining — still show a compact ready banner.
  }

  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <ListChecks className="h-4 w-4 text-navy-600" />
          <CardTitle className="text-base text-slate-900">Agency setup checklist</CardTitle>
          <Badge
            className={
              checklist.readyForPilot
                ? 'ml-auto bg-emerald-100 text-emerald-800'
                : 'ml-auto bg-amber-100 text-amber-800'
            }
          >
            {checklist.percentComplete}% required
          </Badge>
        </div>
        {checklist.nextAction && (
          <p className="text-sm text-slate-600">
            Next: <span className="font-medium text-slate-900">{checklist.nextAction.label}</span>
          </p>
        )}
        {checklist.readyForPilot && (
          <p className="text-sm text-emerald-700">Required setup complete — ready for pilot.</p>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {checklist.items.map((item) => (
          <Link
            key={item.id}
            to={item.route}
            className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2 transition hover:border-navy-200 hover:bg-navy-50"
          >
            {item.complete ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            ) : (
              <Circle className="h-4 w-4 shrink-0 text-slate-300" />
            )}
            <div className="min-w-0 flex-1">
              <p className={`truncate text-sm font-medium ${item.complete ? 'text-slate-500 line-through' : 'text-slate-900'}`}>
                {item.label}
              </p>
              <p className="text-xs text-slate-500">
                {item.required ? 'Required' : 'Optional'}
                {item.complete ? ' · done' : ''}
              </p>
            </div>
            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
