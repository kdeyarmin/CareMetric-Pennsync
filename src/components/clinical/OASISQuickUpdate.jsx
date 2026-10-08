import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Brain, CheckCircle2, Clock, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { formatEastern, todayEastern } from "@/components/utils/timezone";
import { markStartOfCareCompleted } from "@/components/referral/intakeToSocTracker";
import { PATIENT_HISTORY_ROWS } from '@/lib/queryLimits';
import { useAuth } from "@/lib/AuthContext";
import OasisResponseControl from "@/components/oasis/OasisResponseControl";
import { visitTypeToTimepoint } from "@/components/oasis/responseSchema/registry.js";
import { V2_DEFINITIONS } from "@/components/oasis/responseSchema/v2CmsE2.js";
import { isResponseAnswered, selectionsForSave } from "@/components/oasis/cmsResponseSelections";
import { saveOfficialResponses } from "@/components/oasis/responseSchema/oasisWriteAdapter.js";
import { listAuthorizedOASISAssessments } from "@/functions/readAuthorizedOASISAssessments";
import {
  listAuthorizedReferrals,
  updateAuthorizedReferral,
} from '@/functions/manageAuthorizedReferral';

// The functional items a clinician most often updates between full assessments,
// from the CMS-aligned (v2) definitions — never PennSync's legacy scales, whose
// codes mean something different on the official instrument. Each one appears
// only at the time points CMS collects it.
const QUICK_DEFINITION_IDS = ["m1830_cms_e2", "m1840_cms_e2", "m1860_cms_e2", "m1870_cms_e2"];

// OASISAssessment.visit_type is a required enum; an assessment must declare which
// kind it is. These are the schema's valid values. (Also consumed by
// SmartOASISAssessment, which drives the same entity.)
export const VISIT_TYPES = ["Start of Care", "Resumption of Care", "Recertification", "Discharge", "Transfer"];

// Referral statuses still waiting on a start-of-care visit — everything before
// the intake→SOC clock closes (intakeToSocTracker closes it at soc_completed /
// declined). `active` is deliberately excluded: an active referral was already
// admitted, so a new SOC OASIS shouldn't rewrite its SOC bookkeeping.
const OPEN_REFERRAL_STATUSES = ["new", "pending", "processing", "awaiting_info", "ready_for_admission"];

// Released by the owner on 2026-10-08 ("turn everything on"). Entry saves only
// through the protected `saveOasisResponses` broker, which authorizes the caller
// and the chart itself; history reads only through `readAuthorizedOASISAssessments`.
const OASIS_QUICK_UPDATE_ENABLED = true;

/**
 * After a Start of Care OASIS is saved, close the intake→SOC clock on the
 * patient's open referral via markStartOfCareCompleted (drives the CMS Timely
 * Initiation of Care measure — see intakeToSocTracker.js).
 *
 * Positive evidence only: applies the update only when exactly ONE open
 * referral matches the patient — zero means nothing to close, and more than
 * one is an ambiguity a human should resolve, not guess at.
 *
 * Best-effort fire-and-forget (call WITHOUT await): resolves rather than
 * throws, so referral bookkeeping can never block or fail the OASIS save —
 * the same non-blocking pattern as the diagnosis-coding step in
 * src/pages/ReferralIntake.jsx.
 */
export async function completeReferralSocForPatient(patientId, socDate, agencyId) {
  try {
    if (!patientId || !agencyId) return;
    const result = await listAuthorizedReferrals({
      agencyId,
      patientId,
      limit: PATIENT_HISTORY_ROWS,
    });
    const openReferrals = result.referrals.filter((referral) => (
      OPEN_REFERRAL_STATUSES.includes(referral.status)
    ));
    if (!Array.isArray(openReferrals) || openReferrals.length !== 1) return;
    const transition = markStartOfCareCompleted(openReferrals[0], { socDate });
    const { soc_completed_by: _serverStamped, ...changes } = transition;
    await updateAuthorizedReferral({
      agencyId,
      referralId: openReferrals[0].id,
      changes,
    });
  } catch (err) {
    console.error("Referral SOC completion skipped:", err);
  }
}

function EnabledOASISQuickUpdate({ patient }) {
  const { user, tenantContext } = useAuth();
  const agencyId = tenantContext?.agency_id || null;
  const queryClient = useQueryClient();
  const [responses, setResponses] = useState({});
  const [visitType, setVisitType] = useState("");
  const [assessmentDate, setAssessmentDate] = useState(() => todayEastern());
  const [clinicalNote, setClinicalNote] = useState("");
  const [saving, setSaving] = useState(false);

  const timepoint = visitTypeToTimepoint(visitType);
  const definitions = useMemo(
    () => QUICK_DEFINITION_IDS
      .map((id) => V2_DEFINITIONS[id])
      .filter((definition) => definition && timepoint && definition.timepoints.includes(timepoint)),
    [timepoint],
  );

  const historyKey = ["oasis-assessments", "authorized-summary", agencyId, patient?.id];
  const { data: recentAssessments = [], error: historyError } = useQuery({
    queryKey: historyKey,
    queryFn: async () => (await listAuthorizedOASISAssessments({
      agencyId,
      patientId: patient.id,
      purpose: "summary",
      limit: 5,
    })).assessments,
    enabled: !!patient?.id && !!agencyId,
  });

  const answeredCount = definitions.filter((definition) => isResponseAnswered(definition, responses[definition.definition_id])).length;
  const hasChanges = answeredCount > 0 || clinicalNote.trim().length > 0;

  const handleVisitType = (value) => {
    setVisitType(value);
    // Keep only answers still collected at the new reason.
    const nextPoint = visitTypeToTimepoint(value);
    setResponses((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => (
      V2_DEFINITIONS[id]?.timepoints.includes(nextPoint)
    ))));
  };

  const handleSave = async () => {
    if (!patient?.id || !visitType) return;
    const selections = selectionsForSave(visitType, responses)
      .filter((selection) => QUICK_DEFINITION_IDS.includes(selection.definitionId));
    if (selections.length === 0) {
      toast.error("Select at least one response before saving.");
      return;
    }
    setSaving(true);
    try {
      const result = await saveOfficialResponses({
        agencyId,
        assessment: { patient_id: patient.id, visit_type: visitType, assessment_date: assessmentDate, status: "draft" },
        selections,
        clinicianEmail: user?.email,
        clinicalSummary: clinicalNote,
      });
      if (!result.ok) {
        toast.error(result.detail || "The update was not saved.");
        return;
      }
      toast.success(result.created ? "OASIS update saved as a draft." : "This update was already saved.");
      setResponses({});
      setClinicalNote("");
      queryClient.invalidateQueries({ queryKey: ["oasis-assessments"] });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Recent assessments — read through the authorized summary broker. */}
      {historyError && (
        <p className="text-xs text-amber-700">Recent assessments could not be loaded for this chart.</p>
      )}
      {recentAssessments.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="w-4 h-4 text-slate-500" />
              Recent Assessments
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {recentAssessments.map((a) => (
              <div key={a.id} className="flex items-center justify-between text-sm rounded-lg border p-3 bg-slate-50">
                <div>
                  <span className="font-medium text-slate-800">
                    {formatEastern(a.assessment_date || a.created_date, 'M/d/yyyy')}
                  </span>
                  <span className="text-slate-500 ml-2">{a.visit_type}</span>
                  {typeof a.completion_percentage === "number" && (
                    <span className="text-xs text-slate-400 ml-2">{a.completion_percentage}% of CMS items</span>
                  )}
                </div>
                <Badge className={a.status === "completed" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}>
                  {a.status}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Quick update form */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Brain className="w-4 h-4 text-indigo-500" />
            OASIS Quick Update
          </CardTitle>
          <p className="text-xs text-slate-500">
            Update key functional items with the CMS response wording and save them as a draft for review.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="quick-visit-type" className="text-xs font-semibold text-slate-700 mb-1.5 block">
                Assessment Type <span className="text-red-500">*</span>
              </label>
              <Select value={visitType} onValueChange={handleVisitType}>
                <SelectTrigger id="quick-visit-type" className="h-10 text-sm">
                  <SelectValue placeholder="Select assessment type…" />
                </SelectTrigger>
                <SelectContent>
                  {VISIT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label htmlFor="quick-assessment-date" className="text-xs font-semibold text-slate-700 mb-1.5 block">
                Assessment Date <span className="text-red-500">*</span>
              </label>
              <Input
                id="quick-assessment-date"
                type="date"
                value={assessmentDate}
                onChange={(e) => setAssessmentDate(e.target.value)}
                className="h-10 text-sm"
              />
            </div>
          </div>

          {visitType && definitions.length === 0 && (
            <p className="text-sm text-slate-600 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              CMS collects none of these functional items at {visitType}. Use the full assessment instead.
            </p>
          )}
          {definitions.map((definition) => (
            <OasisResponseControl
              key={definition.definition_id}
              definition={definition}
              timepoint={timepoint}
              value={responses[definition.definition_id] ?? null}
              onChange={(value) => setResponses((prev) => ({ ...prev, [definition.definition_id]: value }))}
              disabled={saving}
            />
          ))}

          <div>
            <label htmlFor="clinical-note" className="text-xs font-semibold text-slate-700 mb-1.5 block">Clinical Note</label>
            <Textarea
              id="clinical-note"
              rows={3}
              maxLength={2000}
              placeholder="Add clinical observations or notes for this assessment…"
              value={clinicalNote}
              onChange={(e) => setClinicalNote(e.target.value)}
              className="resize-none text-sm"
            />
          </div>

          <div className="flex items-center gap-3">
            <Button
              onClick={handleSave}
              disabled={saving || !visitType || answeredCount === 0 || !agencyId}
              className="bg-indigo-600 hover:bg-indigo-700 min-h-[40px]"
            >
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileText className="w-4 h-4 mr-2" />}
              Save as Draft
            </Button>
            {hasChanges && !visitType && (
              <p className="text-xs text-amber-600 flex items-center gap-1">
                Select an assessment type to save
              </p>
            )}
            {hasChanges && visitType && (
              <p className="text-xs text-amber-600 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Unsaved changes
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function OASISQuickUpdate(props) {
  if (!OASIS_QUICK_UPDATE_ENABLED) {
    return (
      <Card className="border-2 border-amber-300 bg-amber-50">
        <CardContent className="space-y-2 p-5 text-sm text-amber-950">
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-5 w-5" /> OASIS Quick Update Paused
          </div>
          <p>Response entry is switched off for this deployment.</p>
        </CardContent>
      </Card>
    );
  }
  if (!props?.patient?.id) {
    return (
      <Card>
        <CardContent className="p-5 text-sm text-slate-600">Select a patient to record a quick OASIS update.</CardContent>
      </Card>
    );
  }
  return <EnabledOASISQuickUpdate {...props} />;
}
