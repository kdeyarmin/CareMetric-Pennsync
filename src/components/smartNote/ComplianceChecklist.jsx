import { Shield, CheckCircle2 } from 'lucide-react';

export default function ComplianceChecklist({ isHospice }) {
  const hospiceChecks = [
    "42 CFR §418 Hospice CoPs",
    "Terminal prognosis documentation",
    "Comfort-focused goals",
    "Symptom management (pain/dyspnea)",
    "IDG/IDT interdisciplinary notes",
    "Benefit period documentation",
    "Patient/family education",
    "Medication management",
    "Spiritual/psychosocial assessment",
    "Bereavement support",
    "Advance directives reviewed",
    "State hospice survey standards"
  ];

  const homeHealthChecks = [
    "Medicare 42 CFR Part 484",
    "Homebound status",
    "Skilled need justification",
    "Vitals + interpretation",
    "Patient response",
    "Education with teach-back",
    "Safety / fall risk",
    "Care plan progress",
    "Pain assessment",
    "Medication adherence",
    "State survey standards"
  ];

  const checks = isHospice ? hospiceChecks : homeHealthChecks;

  return (
    <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3">
      <p className="text-xs font-semibold text-indigo-700 mb-1.5 flex items-center gap-1.5">
        <Shield className="w-3.5 h-3.5" /> Medicare compliance checks performed:
      </p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-indigo-600">
        {checks.map((item, i) => (
          <span key={i} className="flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3 text-indigo-400 shrink-0" />{item}
          </span>
        ))}
      </div>
    </div>
  );
}