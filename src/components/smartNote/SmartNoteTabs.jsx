import { Sparkles, ClipboardList, FileText, TrendingUp } from "lucide-react";

export const SMART_NOTE_TABS = [
  { id: "builder", label: "Note Builder", icon: Sparkles, color: "indigo" },
  { id: "drafter", label: "Draft from Vitals", icon: ClipboardList, color: "violet" },
  { id: "summary", label: "Visit Summary", icon: FileText, color: "purple" },
  { id: "trends", label: "Vital Trends", icon: TrendingUp, color: "cyan" },
];

export default function SmartNoteTabs({ activeTab, setActiveTab }) {
  const tabColorMap = { indigo: "bg-indigo-600", violet: "bg-navy-600", purple: "bg-navy-600", emerald: "bg-emerald-600", cyan: "bg-navy-600" };
  const tabHoverMap = { indigo: "hover:bg-indigo-50 hover:text-indigo-700", violet: "hover:bg-navy-50 hover:text-navy-700", purple: "hover:bg-navy-50 hover:text-navy-700", emerald: "hover:bg-emerald-50 hover:text-emerald-700", cyan: "hover:bg-navy-50 hover:text-navy-700" };

  return (
    <div role="tablist" aria-label="Smart Note sections" className="flex bg-white border border-slate-200 rounded-xl p-1 shadow-sm gap-1 overflow-x-auto">
      {SMART_NOTE_TABS.map(tab => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs sm:text-sm font-semibold transition-all min-h-[44px] whitespace-nowrap px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-1 ${isActive ? `${tabColorMap[tab.color]} text-white shadow-sm` : `text-slate-500 ${tabHoverMap[tab.color]}`}`}
          >
            <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
            <span className="hidden sm:inline">{tab.label}</span>
            <span className="sm:hidden">{tab.label.split(" ")[0]}</span>
          </button>
        );
      })}
    </div>
  );
}