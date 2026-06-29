import { AlertTriangle, Brain, CheckCircle2 } from "lucide-react";

const REASONING_RULES = [
  {
    id: "bedfast_vs_ambulation",
    severity: "critical",
    title: "Transfer and ambulation conflict",
    check: (a) => a.m1850 === 4 && a.m1860 !== undefined && a.m1860 <= 4,
    explanation: "The patient is documented as bedfast for transfers, but the ambulation score suggests the patient can still move around on foot or by wheelchair more independently.",
    suggestion: "Recheck whether the patient is truly bedfast. If the patient cannot get out of bed, the ambulation score usually needs to reflect that level of dependence as well."
  },
  {
    id: "bedfast_vs_toilet_transfer",
    severity: "critical",
    title: "Bedfast status conflicts with toilet transfer ability",
    check: (a) => a.m1850 === 4 && a.m1840 !== undefined && a.m1840 <= 2,
    explanation: "A bedfast patient would not usually be documented as mostly independent with toilet transfer ability.",
    suggestion: "Confirm whether the patient is actually able to transfer to the toilet or bedside commode. If not, the toilet transfer item should likely reflect total dependence."
  },
  {
    id: "grooming_vs_bathing",
    severity: "high",
    title: "Bathing appears easier than grooming",
    check: (a) => a.m1800 === 3 && a.m1830 !== undefined && a.m1830 <= 1,
    explanation: "The patient is documented as totally dependent for grooming, but nearly independent for bathing. That combination is unusual because bathing generally requires at least equal or greater effort.",
    suggestion: "Review whether grooming was overscored or bathing was underscored. Choose the score that best matches the patient’s actual day-to-day function."
  },
  {
    id: "lives_alone_vs_med_management",
    severity: "high",
    title: "Medication dependence without available support",
    check: (a) => a.m1100 === 0 && a.m2020 !== undefined && a.m2020 >= 2,
    explanation: "The patient lives alone with no assistance available, but the medication item shows the patient cannot safely manage oral medications independently.",
    suggestion: "Clarify whether support is actually available, or document the medication safety risk and the plan for supervision, teaching, or escalation."
  },
  {
    id: "cognition_vs_lives_alone",
    severity: "high",
    title: "Cognitive impairment with no support in the home",
    check: (a) => a.m1100 === 0 && a.m1700 !== undefined && a.m1700 >= 2,
    explanation: "The patient is documented as living alone with no assistance, but also has significant cognitive impairment that may affect safe decision-making.",
    suggestion: "Reassess the living situation and supervision plan. If the patient truly lives alone, document the safety concerns and who was notified."
  },
  {
    id: "dyspnea_vs_low_risk",
    severity: "medium",
    title: "High dyspnea with low hospitalization risk",
    check: (a) => a.m1400 !== undefined && a.m1400 >= 3 && a.m1033 === 0,
    explanation: "The patient has severe shortness of breath, but the hospitalization risk is scored low. Those findings may not align clinically.",
    suggestion: "Review the hospitalization risk score and respiratory picture together. If dyspnea is frequent or severe, a higher risk level may be more appropriate."
  },
  {
    id: "fall_history_vs_full_independence",
    severity: "medium",
    title: "Fall history with fully independent mobility",
    check: (a) => a.m1910 !== undefined && a.m1910 >= 2 && a.m1860 === 0 && a.m1850 === 0,
    explanation: "The patient has repeated falls or a serious fall history, but mobility and transfers are both scored as fully independent.",
    suggestion: "Double-check whether the functional scores fully reflect the current fall risk, balance issues, or need for supervision."
  }
];

export function getClinicalReasoningIssues(answers) {
  return REASONING_RULES.filter((rule) => {
    try {
      return rule.check(answers);
    } catch {
      return false;
    }
  });
}

const severityClasses = {
  critical: "bg-red-50 border-red-200 text-red-900",
  high: "bg-amber-50 border-amber-200 text-amber-900",
  medium: "bg-blue-50 border-blue-200 text-blue-900",
};

export default function OASISClinicalReasoningEngine({ issues = [] }) {
  if (!issues.length) {
    return (
      <div className="p-4 text-center">
        <div className="flex items-center justify-center gap-2 text-green-700 bg-green-50 border border-green-200 rounded-lg p-3">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          <span className="text-xs font-medium">No obvious clinical logic conflicts detected</span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 space-y-3">
      {issues.map((issue) => (
        <div key={issue.id} className={`border rounded-lg p-3 ${severityClasses[issue.severity] || severityClasses.medium}`}>
          <div className="flex items-start gap-2 mb-2">
            <Brain className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-bold uppercase tracking-wide">{issue.title}</p>
              <p className="text-xs mt-1 leading-relaxed opacity-90">{issue.explanation}</p>
            </div>
          </div>
          <div className="ml-6 flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <p className="text-xs leading-relaxed font-medium">Suggested reconciliation: {issue.suggestion}</p>
          </div>
        </div>
      ))}
    </div>
  );
}