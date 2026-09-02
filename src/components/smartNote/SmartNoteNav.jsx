import { PenLine, ClipboardCheck, CheckCircle2, ClipboardList, FileText, TrendingUp, ArrowLeft } from "lucide-react";

/**
 * One navigation bar for the Smart Note page.
 *
 * This replaces two adjacent, unrelated controls: a four-item tab bar and, just
 * below it, a two-step progress indicator. Nothing said how they related, and
 * three of the four "tabs" were not steps in the note flow at all — they are
 * side tools. So the bar now says that outright: the note flow's progress on the
 * left, the tools subordinate on the right, and a way back to the note whenever
 * a tool is open. Same `step` and `activeTab` values as before.
 */
const STEPS = [
  { label: "Write", icon: PenLine },
  { label: "Review & Generate", icon: ClipboardCheck },
];

export const SMART_NOTE_TOOLS = [
  { id: "drafter", label: "Structured draft", icon: ClipboardList },
  { id: "summary", label: "Visit summary", icon: FileText },
  { id: "trends", label: "Vital trends", icon: TrendingUp },
];

function Steps({ step }) {
  return (
    <ol className="flex items-center gap-1" aria-label="Smart Note progress">
      {STEPS.map((s, i) => {
        const n = i + 1;
        const active = step === n;
        const done = step > n;
        return (
          <li key={n} className="flex items-center">
            <div
              aria-current={active ? "step" : undefined}
              aria-label={s.label}
              className={`flex items-center gap-1.5 text-xs font-semibold ${active ? "text-indigo-700" : done ? "text-green-600" : "text-slate-400"}`}
            >
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${active ? "bg-indigo-600 text-white" : done ? "bg-green-500 text-white" : "bg-slate-200 text-slate-500"}`}
              >
                {done ? <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> : n}
              </span>
              <span className="hidden sm:inline">{s.label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <span className="w-4 sm:w-8 h-0.5 bg-slate-200 mx-1 overflow-hidden" aria-hidden="true">
                <span className={`block h-full transition-all duration-500 ${done ? "bg-green-400 w-full" : "w-0"}`} />
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export default function SmartNoteNav({ step, activeTab, setActiveTab }) {
  const openTool = SMART_NOTE_TOOLS.find((t) => t.id === activeTab) || null;

  return (
    <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-sm">
      <div className="flex-1 min-w-0">
        {openTool ? (
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => setActiveTab("builder")}
              className="flex items-center gap-1.5 text-xs font-semibold text-indigo-700 hover:text-indigo-800 hover:underline min-h-[44px] sm:min-h-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded"
            >
              <ArrowLeft className="w-4 h-4 shrink-0" aria-hidden="true" /> Back to note
            </button>
            <span className="text-xs text-slate-400 shrink-0" aria-hidden="true">·</span>
            <span className="text-xs font-semibold text-slate-600 truncate">{openTool.label}</span>
          </div>
        ) : (
          <Steps step={step} />
        )}
      </div>

      <div className="flex items-center gap-1 shrink-0 border-l border-slate-200 pl-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 hidden lg:inline">Tools</span>
        {SMART_NOTE_TOOLS.map((tool) => {
          const Icon = tool.icon;
          const isOpen = activeTab === tool.id;
          return (
            <button
              key={tool.id}
              type="button"
              aria-pressed={isOpen}
              aria-label={tool.label}
              onClick={() => setActiveTab(isOpen ? "builder" : tool.id)}
              title={tool.label}
              className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors min-h-[44px] sm:min-h-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${isOpen ? "bg-indigo-50 text-indigo-700" : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"}`}
            >
              <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span className="hidden md:inline">{tool.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
