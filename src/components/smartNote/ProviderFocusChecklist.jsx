import React, { useState, useMemo } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertCircle, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";

const PROVIDER_FOCUS_CHECKLISTS = {
  MD: {
    admission: [
      { id: "hpi", section: "History of Present Illness", prompt: "Include temporal sequence, severity, and clinical relevance", critical: true },
      { id: "ros", section: "Review of Systems", prompt: "Document both positive and negative findings relevant to diagnosis", critical: true },
      { id: "pe", section: "Physical Examination", prompt: "Organ-system approach with specific findings (not just 'normal')", critical: true },
      { id: "past_hx", section: "Past Medical/Surgical History", prompt: "Document relevant conditions and surgeries with dates", critical: false },
      { id: "meds", section: "Medication List", prompt: "Include name, dose, frequency, indication, and allergies", critical: true },
      { id: "social", section: "Social History", prompt: "Tobacco, alcohol, drug use, living situation, occupation", critical: false },
      { id: "mdm", section: "Medical Decision Making", prompt: "Document complexity, differential diagnoses, clinical reasoning", critical: true },
      { id: "plan", section: "Assessment & Plan", prompt: "Clear orders, referrals, follow-up with clinical rationale", critical: true },
      { id: "codes", section: "Coding Elements", prompt: "Ensure documentation supports intended CPT/ICD-10 codes", critical: false }
    ],
    routine_visit: [
      { id: "vital_signs", section: "Vital Signs", prompt: "Temperature, BP, HR, RR, O2 sat, weight if applicable", critical: true },
      { id: "interval_hx", section: "Interval History", prompt: "Changes since last visit, symptom progression, medication compliance", critical: true },
      { id: "pe_focused", section: "Focused Physical Exam", prompt: "Examine areas relevant to chief complaint and assessment", critical: true },
      { id: "assessment", section: "Assessment", prompt: "Status of each active problem, new findings, complications", critical: true },
      { id: "plan_update", section: "Plan & Orders", prompt: "Any changes to medications, referrals, or follow-up", critical: true }
    ],
    recertification: [
      { id: "homebound_reverify", section: "Homebound Re-verification", prompt: "Document why patient remains unable to leave home", critical: true },
      { id: "skilled_need_current", section: "Current Skilled Need Justification", prompt: "Explain ongoing need for physician-ordered services", critical: true },
      { id: "progress_summary", section: "Progress Summary", prompt: "Compare current status to baseline and previous recert", critical: true },
      { id: "oasis_changes", section: "OASIS Changes", prompt: "Document any changes triggering new OASIS assessments", critical: true },
      { id: "physician_signature", section: "Physician Signature & Date", prompt: "Required for Medicare compliance", critical: true }
    ]
  },
  NP: {
    admission: [
      { id: "holistic_assess", section: "Holistic Assessment", prompt: "Physical, mental, functional, social, spiritual factors", critical: true },
      { id: "health_beliefs", section: "Health Beliefs & Values", prompt: "Patient and family health beliefs, readiness for change", critical: false },
      { id: "teach_back", section: "Teaching & Learning Needs", prompt: "Patient education provided and understanding demonstrated", critical: true },
      { id: "prevention", section: "Health Promotion & Prevention", prompt: "Counseling on diet, exercise, stress management, preventive care", critical: true },
      { id: "psychosocial", section: "Psychosocial Assessment", prompt: "Mental health, coping mechanisms, support systems, resources", critical: true },
      { id: "care_plan", section: "Collaborative Care Plan", prompt: "Goals, interventions, teaching, follow-up with team", critical: true },
      { id: "referrals", section: "Referrals & Resources", prompt: "Community resources, specialist referrals, support groups", critical: false }
    ],
    routine_visit: [
      { id: "vital_signs", section: "Vital Signs & Measurements", prompt: "BP, HR, RR, O2 sat, weight, other relevant metrics", critical: true },
      { id: "patient_response", section: "Patient Response to Care", prompt: "How patient is responding to plan, adherence, barriers", critical: true },
      { id: "education_follow", section: "Patient Education Follow-up", prompt: "Review previous teaching, assess understanding, reinforce", critical: true },
      { id: "holistic_focus", section: "Holistic Status Review", prompt: "Physical and psychosocial changes since last visit", critical: true },
      { id: "plan_adjust", section: "Plan Adjustments", prompt: "Any modifications based on patient response and feedback", critical: true }
    ]
  },
  RN: {
    admission: [
      { id: "homebound_assess", section: "Homebound Assessment", prompt: "Document specific reasons patient cannot leave home safely", critical: true },
      { id: "skilled_nursing", section: "Skilled Nursing Need", prompt: "Why RN skill level is required (not just aide-level care)", critical: true },
      { id: "comprehensive_assess", section: "Comprehensive Assessment", prompt: "Physical, mental, functional status; baseline vital signs", critical: true },
      { id: "medications", section: "Medication Review", prompt: "Allergies, current meds, reconciliation, teaching needs", critical: true },
      { id: "care_plan_initial", section: "Initial Care Plan", prompt: "Goals, interventions, frequency, expected outcomes, timeline", critical: true },
      { id: "patient_education", section: "Patient & Family Education", prompt: "Disease process, medications, diet, activity, safety, when to call", critical: true },
      { id: "safety_risk", section: "Safety & Risk Assessment", prompt: "Fall risk, infection risk, skin integrity, equipment needs", critical: true }
    ],
    routine_visit: [
      { id: "vital_signs", section: "Vital Signs", prompt: "Temp, BP, HR, RR, O2 sat - compare to baseline", critical: true },
      { id: "skilled_interv", section: "Skilled Interventions", prompt: "Detailed description of what was done and why", critical: true },
      { id: "patient_response", section: "Patient Response", prompt: "How patient tolerated intervention, any complications, progress", critical: true },
      { id: "assess_current", section: "Current Status Assessment", prompt: "Physical, mental, functional status; changes from last visit", critical: true },
      { id: "education_reinforcement", section: "Patient Education", prompt: "What was reinforced, patient/family understanding", critical: true },
      { id: "care_plan_adhere", section: "Care Plan Adherence", prompt: "Is patient following plan? Any barriers or adjustments needed?", critical: true },
      { id: "safety_update", section: "Safety Check", prompt: "Environment safe? Equipment working? Any new risks?", critical: false }
    ],
    discharge: [
      { id: "discharge_reason", section: "Reason for Discharge", prompt: "Goal achieved, patient request, referral to higher care, etc.", critical: true },
      { id: "final_status", section: "Final Patient Status", prompt: "Current physical, mental, functional status at discharge", critical: true },
      { id: "goals_status", section: "Goals Achievement", prompt: "Each goal: achieved, partially achieved, or not achieved with reason", critical: true },
      { id: "discharge_instr", section: "Discharge Instructions", prompt: "Written and verbal instructions provided to patient/family", critical: true },
      { id: "medications_final", section: "Final Medication List", prompt: "Current medications with any changes or new prescriptions", critical: true },
      { id: "follow_up", section: "Follow-up Care", prompt: "Physician visits, specialist referrals, equipment/supplies", critical: true },
      { id: "education_summary", section: "Education Summary", prompt: "Key topics covered, understanding verified", critical: true }
    ]
  }
};

export default function ProviderFocusChecklist({
  providerType = "RN",
  visitType = "routine_visit",
  noteContent = "",
  onSectionClick = null
}) {
  const [checkedItems, setCheckedItems] = useState({});
  const [expandedSections, setExpandedSections] = useState({});

  const checklist = useMemo(() => {
    return PROVIDER_FOCUS_CHECKLISTS[providerType]?.[visitType] || [];
  }, [providerType, visitType]);

  const toggleCheck = (id) => {
    setCheckedItems(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const toggleExpand = (id) => {
    setExpandedSections(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const completenessScore = useMemo(() => {
    const critical = checklist.filter(item => item.critical).length;
    const criticalChecked = checklist
      .filter(item => item.critical && checkedItems[item.id])
      .length;
    return critical > 0 ? Math.round((criticalChecked / critical) * 100) : 0;
  }, [checkedItems, checklist]);

  const handleJumpToSection = (sectionName) => {
    if (onSectionClick) {
      onSectionClick(sectionName);
    } else {
      // Fallback: scroll to section in note if available
      const regex = new RegExp(`(${sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'i');
      if (noteContent && regex.test(noteContent)) {
        alert(`Navigate to: "${sectionName}"\n\nYou can now edit this section in the note.`);
      }
    }
  };

  if (checklist.length === 0) {
    return (
      <div className="bg-slate-50 p-3 rounded border border-slate-200 text-center">
        <p className="text-xs text-slate-600">
          No specific checklist available for {providerType} {visitType.replace(/_/g, ' ')}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between bg-white p-2 rounded border border-slate-200">
        <div>
          <p className="text-xs font-semibold text-slate-900">Critical Elements Completion</p>
          <p className="text-xs text-slate-600">
            {checklist.filter(item => item.critical && checkedItems[item.id]).length} of {checklist.filter(item => item.critical).length} completed
          </p>
        </div>
        <Badge 
          variant={completenessScore >= 80 ? "default" : completenessScore >= 50 ? "secondary" : "outline"}
          className="text-xs font-bold"
        >
          {completenessScore}%
        </Badge>
      </div>

      <div className="space-y-2 max-h-96 overflow-y-auto">
        {checklist.map((item) => (
          <div
            key={item.id}
            className={`rounded border transition-all ${
              checkedItems[item.id]
                ? "bg-green-50 border-green-200"
                : item.critical
                ? "bg-white border-slate-200 hover:bg-slate-50"
                : "bg-slate-50 border-slate-200"
            }`}
          >
            {/* Header */}
            <div className="flex items-start gap-2 p-2">
              <Checkbox
                checked={checkedItems[item.id] || false}
                onCheckedChange={() => toggleCheck(item.id)}
                className="mt-0.5 flex-shrink-0"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-xs font-medium text-slate-900">{item.section}</p>
                  {item.critical && (
                    <Badge variant="destructive" className="text-[10px] font-bold">CRITICAL</Badge>
                  )}
                  {checkedItems[item.id] && (
                    <CheckCircle2 className="w-3 h-3 text-green-600 flex-shrink-0" />
                  )}
                </div>
              </div>
              <button
                onClick={() => toggleExpand(item.id)}
                className="flex-shrink-0 text-slate-500 hover:text-slate-700 p-1"
              >
                {expandedSections[item.id] ? (
                  <ChevronUp className="w-3 h-3" />
                ) : (
                  <ChevronDown className="w-3 h-3" />
                )}
              </button>
            </div>

            {/* Expanded Prompt & Action */}
            {expandedSections[item.id] && (
              <div className="px-2 pb-2 space-y-2 border-t border-slate-200 pt-2">
                <div className="flex gap-2">
                  <AlertCircle className="w-3 h-3 text-blue-600 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-slate-700 leading-relaxed">{item.prompt}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleJumpToSection(item.section)}
                  className="w-full h-8 text-xs gap-1"
                >
                  <ExternalLink className="w-3 h-3" />
                  Jump to Section in Note
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>

      {completenessScore < 100 && (
        <div className="bg-amber-50 p-2 rounded border border-amber-200">
          <p className="text-xs font-semibold text-amber-900 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            {100 - completenessScore}% Remaining
          </p>
          <p className="text-xs text-amber-800 mt-1">
            Focus on completing critical elements marked above for compliance.
          </p>
        </div>
      )}
    </div>
  );
}