import { ShieldAlert, AlertTriangle, Info, CheckCircle2 } from "lucide-react";

const COMPLIANCE_RULES = [
  {
    id: "drug_education_gap",
    check: (a) => a.m2001 >= 1 && a.m2010 === 2,
    severity: "critical",
    title: "Drug Education Incomplete",
    message: "Drug regimen issues were found but patient/caregiver education was NOT completed — this is required for CMS compliance.",
    cms_ref: "M2001 + M2010",
  },
  {
    id: "fall_risk_ambulation",
    check: (a) => a.m1910 >= 1 && a.m1860 >= 2,
    severity: "critical",
    title: "Fall Risk + Impaired Ambulation",
    message: "Fall history with impaired ambulation documented — a comprehensive fall prevention protocol MUST be in the care plan.",
    cms_ref: "M1910 + M1860",
  },
  {
    id: "pressure_ulcer_protocol",
    check: (a) => a.m1306 === 1,
    severity: "critical",
    title: "Pressure Ulcer — Wound Protocol Required",
    message: "Unhealed pressure ulcer present — wound assessment must be documented at every visit for CMS compliance.",
    cms_ref: "M1306",
  },
  {
    id: "infected_surgical_wound",
    check: (a) => a.m1340 === 2,
    severity: "critical",
    title: "Infected Surgical Wound",
    message: "Infected/complicated surgical wound — physician notification must be documented within 24 hours.",
    cms_ref: "M1340",
  },
  {
    id: "cognitive_impairment_alone",
    check: (a) => a.m1700 >= 2 && a.m1100 === 0,
    severity: "critical",
    title: "Cognitive Impairment — Patient Lives Alone",
    message: "Significant cognitive impairment with no assistance available — a home safety and supervision plan is required.",
    cms_ref: "M1700 + M1100",
  },
  {
    id: "depression_screen_positive",
    check: (a) => a.m1730 >= 1,
    severity: "warning",
    title: "Positive Depression Screen",
    message: "PHQ-2 screen is positive — a full PHQ-9 assessment and psychosocial referral are required per CMS guidelines.",
    cms_ref: "M1730",
  },
  {
    id: "medication_management_deficit",
    check: (a) => a.m2020 >= 2,
    severity: "warning",
    title: "Medication Self-Management Deficit",
    message: "Patient cannot independently manage medications — medication management education must be included in the care plan.",
    cms_ref: "M2020",
  },
  {
    id: "terminal_prognosis_hospice",
    check: (a) => a.m0069 === 1,
    severity: "info",
    title: "Terminal Prognosis Documented",
    message: "Patient has a life expectancy ≤ 1 year — hospice eligibility discussion and documentation is required.",
    cms_ref: "M0069",
  },
];

const SEVERITY_CONFIG = {
  critical: {
    icon: ShieldAlert,
    bg: "bg-red-50", border: "border-red-200", text: "text-red-800", iconColor: "text-red-600",
    badgeBg: "bg-red-100", badgeText: "text-red-700",
  },
  warning: {
    icon: AlertTriangle,
    bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-800", iconColor: "text-amber-600",
    badgeBg: "bg-amber-100", badgeText: "text-amber-700",
  },
  info: {
    icon: Info,
    bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-800", iconColor: "text-blue-600",
    badgeBg: "bg-blue-100", badgeText: "text-blue-700",
  },
};

export function getComplianceIssues(answers) {
  return COMPLIANCE_RULES.filter(rule => {
    try { return rule.check(answers); } catch { return false; }
  });
}

export default function OASISComplianceWarnings({ issues }) {
  const hasAnswers = issues !== undefined;

  if (!issues || issues.length === 0) {
    return (
      <div className="p-4 text-center">
        {hasAnswers ? (
          <div className="flex items-center justify-center gap-2 text-green-700 bg-green-50 border border-green-200 rounded-lg p-3">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            <span className="text-xs font-medium">No compliance flags detected</span>
          </div>
        ) : (
          <p className="text-xs text-slate-400">Complete the assessment to see compliance flags</p>
        )}
      </div>
    );
  }

  const criticalCount = issues.filter(r => r.severity === "critical").length;
  const warningCount = issues.filter(r => r.severity === "warning").length;

  return (
    <div className="p-3 space-y-2">
      {/* Summary badges */}
      <div className="flex items-center gap-2 flex-wrap mb-1">
        {criticalCount > 0 && (
          <span className="text-xs font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">{criticalCount} Critical</span>
        )}
        {warningCount > 0 && (
          <span className="text-xs font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">{warningCount} Warning</span>
        )}
      </div>

      {issues.map(rule => {
        const cfg = SEVERITY_CONFIG[rule.severity];
        const Icon = cfg.icon;
        return (
          <div key={rule.id} className={`${cfg.bg} ${cfg.border} border rounded-lg p-3`}>
            <div className="flex items-start gap-2">
              <Icon className={`w-4 h-4 ${cfg.iconColor} flex-shrink-0 mt-0.5`} />
              <div className="flex-1 min-w-0">
                <p className={`text-xs font-bold ${cfg.text}`}>{rule.title}</p>
                <p className={`text-xs ${cfg.text} mt-0.5 leading-relaxed opacity-90`}>{rule.message}</p>
                <p className="text-[10px] text-slate-400 mt-1 font-mono">CMS Ref: {rule.cms_ref}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}