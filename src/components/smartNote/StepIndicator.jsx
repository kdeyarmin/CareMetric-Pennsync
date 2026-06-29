import { FileText, ClipboardCheck, CheckCircle2 } from "lucide-react";

const STEPS = [
  { label: "Write", icon: FileText },
  { label: "Review & Generate", icon: ClipboardCheck },
];

export default function StepIndicator({ step }) {
  return (
    <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl px-4 py-2.5 shadow-sm">
      {STEPS.map((s, i) => {
        const n = i + 1;
        const active = step === n;
        const done = step > n;
        return (
          <div key={n} className="flex items-center">
            <div className={`flex items-center gap-1.5 text-xs font-semibold ${active ? "text-indigo-700" : done ? "text-green-600" : "text-slate-400"}`}>
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${active ? "bg-indigo-600 text-white" : done ? "bg-green-500 text-white" : "bg-slate-200 text-slate-500"}`}>
                {done ? <CheckCircle2 className="w-3.5 h-3.5" /> : n}
              </div>
              <span className="hidden sm:inline">{s.label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className="flex-1 h-0.5 bg-slate-200 mx-1">
                <div className={`h-full ${step > n ? "bg-green-400 w-full" : "w-0"} transition-all duration-500`} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}