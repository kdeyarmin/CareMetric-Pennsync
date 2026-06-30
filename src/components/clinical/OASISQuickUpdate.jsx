import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Brain, CheckCircle2, Clock, FileText } from "lucide-react";
import { toast } from "sonner";
import { optionsForItem, PAIN_FREQUENCY_OPTIONS } from "@/components/oasis/oasisScales";

// Each OASIS-E item uses its OWN valid range (M1810/M1845 = 0–3, M1850 = 0–5,
// M1830/M1860 = 0–6) — see oasisScales.js. A single flat list either truncated the
// 0–6 items or offered codes that don't exist for the 0–3/0–5 items.
// `item` is the OASIS M-number persisted into OASISAssessment.oasis_items.
const QUICK_FIELDS = [
  { key: "ambulation", item: "M1860", label: "Ambulation (M1860)", options: optionsForItem("m1860") },
  { key: "bathing", item: "M1830", label: "Bathing (M1830)", options: optionsForItem("m1830") },
  { key: "dressing_upper", item: "M1810", label: "Dressing Upper (M1810)", options: optionsForItem("m1810") },
  { key: "transferring", item: "M1850", label: "Transferring (M1850)", options: optionsForItem("m1850") },
  { key: "toileting", item: "M1845", label: "Toileting (M1845)", options: optionsForItem("m1845") },
  { key: "pain_frequency", item: "M1242", label: "Pain Frequency (M1242)", options: PAIN_FREQUENCY_OPTIONS },
];

// OASISAssessment.visit_type is a required enum; an assessment must declare which
// kind it is. These are the schema's valid values.
const VISIT_TYPES = ["Start of Care", "Resumption of Care", "Recertification", "Discharge", "Transfer"];

export default function OASISQuickUpdate({ patient }) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState({});
  const [visitType, setVisitType] = useState("");
  const [clinicalNote, setClinicalNote] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: recentAssessments = [] } = useQuery({
    queryKey: ["oasis-assessments", patient?.id],
    queryFn: () => base44.entities.OASISAssessment.filter({ patient_id: patient.id }, "-created_date", 5),
    enabled: !!patient?.id,
    initialData: [],
  });

  const handleSave = async () => {
    if (!patient?.id || !visitType) return;
    setSaving(true);
    try {
      // Persist the functional-status selections as schema-valid oasis_items and
      // the note as clinical_summary. The previous payload wrote functional_status
      // / clinical_note / clinician_* / source — none of which are OASISAssessment
      // fields, so the clinical data was silently dropped — and omitted the
      // required visit_type, so the row was empty/invalid. (Base44 records the
      // creating user automatically, so clinician identity needs no custom field.)
      const oasisItems = QUICK_FIELDS
        .filter((f) => values[f.key])
        .map((f) => ({
          item_number: f.item,
          item_name: f.label,
          response: values[f.key],
          ai_suggested: false,
          manually_edited: true,
        }));
      await base44.entities.OASISAssessment.create({
        patient_id: patient.id,
        visit_type: visitType,
        assessment_date: new Date().toISOString().split("T")[0],
        oasis_items: oasisItems,
        clinical_summary: clinicalNote,
        status: "draft",
      });
      toast.success("OASIS quick update saved as draft");
      setValues({});
      setVisitType("");
      setClinicalNote("");
      queryClient.invalidateQueries({ queryKey: ["oasis-assessments", patient?.id] });
    } catch (err) {
      // Without this, a failed save left the button stuck on "Saving…" with no
      // feedback and the clinical draft silently lost.
      console.error("Failed to save OASIS quick update:", err);
      toast.error("Failed to save OASIS quick update. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const hasChanges = Object.keys(values).length > 0 || clinicalNote.trim().length > 0;

  return (
    <div className="space-y-4">
      {/* Recent assessments */}
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
                    {new Date(a.assessment_date || a.created_date).toLocaleDateString()}
                  </span>
                  <span className="text-slate-500 ml-2">by {a.completed_by || a.created_by || "clinician"}</span>
                  {a.clinical_summary && <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">{a.clinical_summary}</p>}
                </div>
                <Badge className={a.status === "submitted" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}>
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
          <p className="text-xs text-slate-500">Update key functional status items and save as a draft for review.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label htmlFor="quick-visit-type" className="text-xs font-semibold text-slate-700 mb-1.5 block">
              Assessment Type <span className="text-red-500">*</span>
            </label>
            <Select value={visitType} onValueChange={setVisitType}>
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {QUICK_FIELDS.map(({ key, label, options }) => (
              <div key={key}>
                <label className="text-xs font-semibold text-slate-700 mb-1.5 block">{label}</label>
                <Select value={values[key] || ""} onValueChange={(v) => setValues((prev) => ({ ...prev, [key]: v }))}>
                  <SelectTrigger className="h-10 text-sm">
                    <SelectValue placeholder="Select…" />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>

          <div>
            <label htmlFor="clinical-note" className="text-xs font-semibold text-slate-700 mb-1.5 block">Clinical Note</label>
            <Textarea
              id="clinical-note"
              rows={3}
              placeholder="Add clinical observations or notes for this assessment…"
              value={clinicalNote}
              onChange={(e) => setClinicalNote(e.target.value)}
              className="resize-none text-sm"
            />
          </div>

          <div className="flex items-center gap-3">
            <Button
              onClick={handleSave}
              disabled={saving || !hasChanges || !visitType}
              className="bg-indigo-600 hover:bg-indigo-700 min-h-[40px]"
            >
              <FileText className="w-4 h-4 mr-2" />
              {saving ? "Saving…" : "Save as Draft"}
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