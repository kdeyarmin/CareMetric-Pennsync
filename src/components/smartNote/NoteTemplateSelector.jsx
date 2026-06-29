import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronUp, FileText, Zap } from "lucide-react";
import { base44 } from "@/api/base44Client";

const TEMPLATES = [
  {
    id: "routine_sn",
    label: "Routine Skilled Nursing",
    visitType: "routine_visit",
    color: "bg-blue-50 border-blue-200 hover:border-blue-400",
    badgeColor: "bg-blue-100 text-blue-700",
    content: `• Vital signs: BP _/_,  HR _, RR _, O2 _% on RA, Temp _°F, Wt _ lbs
• Pain level: _/10, location: _
• Patient appears [alert/oriented/in no acute distress]
• Homebound status: patient unable to leave home without considerable effort due to [diagnosis]
• Skilled need: [wound care / medication management / disease management teaching]
• Assessment: [brief clinical findings]
• Patient educated on: [topic] — patient verbalized understanding / demonstrated technique
• Safety assessment: fall risk [low/medium/high], environment [safe/clutter noted/hazard identified]
• Care plan progress: [goal status]
• Plan: return visit [frequency], notify MD if [parameters]`,
  },
  {
    id: "admission",
    label: "Admission / SOC",
    visitType: "admission",
    color: "bg-navy-50 border-navy-200 hover:border-navy-400",
    badgeColor: "bg-navy-100 text-navy-700",
    content: `• Admission source: [hospital / SNF / home]
• Primary diagnosis: _ , secondary diagnoses: _
• Baseline vital signs: BP _/_, HR _, RR _, O2 _%, Temp _°F, Wt _ lbs
• Pain: _/10 — location: _
• Functional status: ambulation [independent / walker / wheelchair], ADL independence [level]
• Cognitive status: [alert and oriented x3 / mild confusion / etc.]
• Fall risk assessment: [low/medium/high] — Morse Fall Scale completed
• Medication reconciliation completed — [# medications reviewed], allergies: _
• Homebound status established: patient is unable to leave home without considerable effort due to _
• Skilled need for home health: [reason]
• Home environment: [safe / concerns noted: _]
• Emergency plan reviewed with patient and caregiver
• Goals of care discussed: _
• Initial education provided on: [diagnosis, medications, safety]
• Referrals placed: [PT / OT / MSW / Dietitian as applicable]
• Physician notified of admission — MD orders received`,
  },
  {
    id: "recertification",
    label: "Recertification",
    visitType: "recertification",
    color: "bg-amber-50 border-amber-200 hover:border-amber-400",
    badgeColor: "bg-amber-100 text-amber-700",
    content: `• Recertification period: [dates]
• Current vital signs: BP _/_, HR _, RR _, O2 _%, Temp _°F, Wt _ lbs (change from baseline: _)
• Homebound status continues: patient remains unable to leave home without considerable effort due to _
• Continued skilled need: [reason skilled nursing continues to be necessary]
• Progress toward goals: [specific measurable progress or barriers]
• Goal met: [yes/no/partial] — detail: _
• Goals for next certification period: _
• Medication changes since last cert: [none / list changes]
• Discharge planning discussed: patient [on track / not yet ready] for discharge because _
• Education this visit: _
• Plan for next period: [frequency, focus areas]`,
  },
  {
    id: "discharge",
    label: "Discharge",
    visitType: "discharge",
    color: "bg-green-50 border-green-200 hover:border-green-400",
    badgeColor: "bg-green-100 text-green-700",
    content: `• Discharge date: _
• Reason for discharge: [goals met / patient/family request / non-compliance / hospitalization / deceased]
• Final vital signs: BP _/_, HR _, RR _, O2 _%, Temp _°F, Wt _ lbs
• Discharge disposition: [home / hospital / SNF / AL / other]
• Goals at discharge: [met / partially met / not met] — summary: _
• Patient/caregiver demonstrated ability to manage: [self-care tasks]
• Final education provided: [topics covered]
• Discharge instructions given — patient/caregiver verbalized understanding
• MD notified of discharge
• Follow-up appointments: [PCP / specialist] scheduled for _
• Community resources provided: [home health aide / DME / meals on wheels / etc.]`,
  },
  {
    id: "wound_care",
    label: "Wound Care",
    visitType: "routine_visit",
    color: "bg-red-50 border-red-200 hover:border-red-400",
    badgeColor: "bg-red-100 text-red-700",
    content: `• Vital signs: BP _/_, HR _, O2 _%, Temp _°F
• Wound location: [anatomical site]
• Wound measurements: _ cm (L) x _ cm (W) x _ cm (D)
• Wound bed: [granulating / slough present / eschar / clean]
• Wound edges: [well-defined / rolled / undermining _cm at _ o'clock position]
• Periwound skin: [intact / macerated / erythema _ cm margin / induration]
• Drainage: [none / minimal / moderate / heavy] — [serous / serosanguineous / purulent]
• Odor: [none / present]
• Treatment performed: [irrigation with NS / debridement / dressing: _]
• Homebound status: unable to leave home without considerable effort due to wound management needs
• Skilled need: wound assessment and treatment requiring skilled nursing
• Patient/caregiver educated on wound care, signs of infection
• Pain during procedure: _/10
• Plan: next dressing change _, MD to be notified if [parameters]`,
  },
  {
    id: "prn_visit",
    label: "PRN / Unscheduled",
    visitType: "prn",
    color: "bg-orange-50 border-orange-200 hover:border-orange-400",
    badgeColor: "bg-orange-100 text-orange-700",
    content: `• Reason for PRN visit: [patient/caregiver call, change in condition, _]
  • Onset of symptoms: [time / date]
  • Current vital signs: BP _/_, HR _, RR _, O2 _%, Temp _°F, Wt _ lbs
  • Comparison to baseline: [stable / changed — detail: _]
  • Clinical assessment: [findings]
  • Interventions performed: _
  • MD notification: [yes / no] — if yes, MD [name] notified at [time], orders received: _
  • Patient response to interventions: _
  • ER / hospitalization: [not indicated / patient sent to ER / hospitalized]
  • Patient/caregiver education: _
  • Plan: [continue current plan / increase visit frequency / modified orders per MD]`,
  },
  ];

export default function NoteTemplateSelector({ onSelect, currentVisitType }) {
  const [open, setOpen] = useState(false);

  const filtered = currentVisitType
    ? TEMPLATES.filter(t => t.visitType === currentVisitType)
    : TEMPLATES;

  const handleSelect = (template) => {
    onSelect(template.content, template.visitType);
    setOpen(false);
    // Track template usage analytics
    base44.analytics.track({
      eventName: "note_template_used",
      properties: { template_id: template.id, template_label: template.label, visit_type: template.visitType }
    });
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 sm:py-2.5 bg-gradient-to-r from-navy-50 to-indigo-50 hover:from-navy-100 hover:to-indigo-100 transition-colors min-h-[48px] sm:min-h-0"
      >
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-navy-600" />
          <span className="text-sm font-semibold text-navy-700">Start from a Template</span>
          <span className="text-xs text-navy-400 hidden sm:inline">pre-fill common visit types</span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-navy-500" /> : <ChevronDown className="w-4 h-4 text-navy-500" />}
      </button>

      {open && (
        <div className="divide-y divide-slate-100">
          {filtered.length === 0 && (
            <p className="px-4 py-3 text-xs text-slate-400 italic">No templates for this visit type. Try "All Visit Types".</p>
          )}
          {filtered.map(template => (
            <div key={template.id} className={`border-l-4 ${template.color} p-3 flex items-center justify-between gap-3`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <FileText className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <span className="text-sm font-semibold text-slate-800">{template.label}</span>
                  <Badge className={`text-xs ${template.badgeColor}`}>{template.visitType.replace(/_/g, " ")}</Badge>
                </div>
                <p className="text-xs text-slate-500 font-mono line-clamp-1 hidden sm:block">{template.content.split("\n")[0].replace("• ", "")}</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0 h-10 sm:h-8 px-4 sm:px-3 text-sm sm:text-xs border-slate-300 hover:border-indigo-400 hover:text-indigo-600 min-w-[60px] active:scale-95"
                onClick={() => handleSelect(template)}
              >
                Use
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}