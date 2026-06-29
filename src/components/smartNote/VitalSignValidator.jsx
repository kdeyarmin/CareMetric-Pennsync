import { AlertTriangle } from "lucide-react";
import { extractVitals } from "@/components/smartNote/compliance/factExtraction";

const RULES = [
  { key: "bp_sys", label: "Systolic BP", check: v => v > 180, msg: v => `Systolic BP ${v} mmHg — hypertensive urgency threshold. Notify physician.`, severity: "critical" },
  { key: "bp_sys", label: "Systolic BP", check: v => v < 90, msg: v => `Systolic BP ${v} mmHg — hypotension. Assess for symptoms.`, severity: "critical" },
  { key: "bp_sys", label: "Systolic BP", check: v => v >= 160 && v <= 180, msg: v => `Systolic BP ${v} mmHg — elevated. Monitor closely.`, severity: "warning" },
  { key: "bp_dia", label: "Diastolic BP", check: v => v > 110, msg: v => `Diastolic BP ${v} mmHg — hypertensive urgency. Notify physician.`, severity: "critical" },
  { key: "hr", label: "Heart Rate", check: v => v > 120, msg: v => `HR ${v} bpm — tachycardia. Assess for cause.`, severity: "critical" },
  { key: "hr", label: "Heart Rate", check: v => v < 50, msg: v => `HR ${v} bpm — bradycardia. Assess for symptoms.`, severity: "critical" },
  { key: "hr", label: "Heart Rate", check: v => v >= 100 && v <= 120, msg: v => `HR ${v} bpm — elevated. Monitor.`, severity: "warning" },
  { key: "o2", label: "O2 Saturation", check: v => v < 88, msg: v => `O2 ${v}% — severe hypoxemia. Immediate action required.`, severity: "critical" },
  { key: "o2", label: "O2 Saturation", check: v => v >= 88 && v < 92, msg: v => `O2 ${v}% — below normal. Assess respiratory status.`, severity: "warning" },
  { key: "temp", label: "Temperature", check: v => v >= 100.4, msg: v => `Temp ${v}°F — fever. Assess for infection source.`, severity: "critical" },
  { key: "temp", label: "Temperature", check: v => v < 96.8, msg: v => `Temp ${v}°F — hypothermia. Notify physician.`, severity: "critical" },
  { key: "rr", label: "Respiratory Rate", check: v => v > 24, msg: v => `RR ${v} — tachypnea. Assess respiratory status.`, severity: "critical" },
  { key: "rr", label: "Respiratory Rate", check: v => v < 10, msg: v => `RR ${v} — bradypnea. Monitor closely.`, severity: "warning" },
];

export function useVitalValidation(noteText) {
  const vitals = extractVitals(noteText || "");
  const flags = [];

  for (const rule of RULES) {
    const val = vitals[rule.key];
    if (val !== undefined && rule.check(val)) {
      flags.push({ severity: rule.severity, message: rule.msg(val), label: rule.label });
    }
  }

  return { vitals, flags };
}

export default function VitalSignValidator({ noteText }) {
  const { flags } = useVitalValidation(noteText);

  if (!flags.length) return null;

  const critical = flags.filter(f => f.severity === "critical");
  const warnings = flags.filter(f => f.severity === "warning");

  return (
    <div className="rounded-xl border overflow-hidden shadow-sm">
      <div className="px-3 py-2 bg-red-50 border-b border-red-200 flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
        <span className="text-sm font-semibold text-red-700">Vital Sign Alerts Detected</span>
        <span className="text-xs text-red-400">review before submitting</span>
      </div>
      <div className="divide-y divide-slate-100 bg-white">
        {critical.map((f, i) => (
          <div key={i} className="flex items-start gap-2.5 px-3 py-2">
            <div className="mt-0.5 w-2 h-2 rounded-full bg-red-500 shrink-0" />
            <p className="text-xs text-red-800 font-medium">{f.message}</p>
          </div>
        ))}
        {warnings.map((f, i) => (
          <div key={i} className="flex items-start gap-2.5 px-3 py-2">
            <div className="mt-0.5 w-2 h-2 rounded-full bg-amber-400 shrink-0" />
            <p className="text-xs text-amber-800">{f.message}</p>
          </div>
        ))}
      </div>
    </div>
  );
}