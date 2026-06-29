import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Bell, AlertCircle, CheckCircle, AlertTriangle, Info, ChevronDown, Sparkles } from "lucide-react";
import { format, differenceInDays } from "date-fns";

const TYPE_CONFIG = {
  urgent:  { border: "border-red-200",   bg: "bg-red-50",   bar: "bg-red-500",   icon: AlertCircle,   iconColor: "text-red-500"   },
  success: { border: "border-green-200", bg: "bg-green-50", bar: "bg-green-500", icon: CheckCircle,   iconColor: "text-green-600" },
  warning: { border: "border-amber-200", bg: "bg-amber-50", bar: "bg-amber-500", icon: AlertTriangle, iconColor: "text-amber-500" },
  info:    { border: "border-blue-200",  bg: "bg-blue-50",  bar: "bg-blue-500",  icon: Info,          iconColor: "text-blue-500"  },
};

const isNew = (date) => differenceInDays(new Date(), new Date(date)) <= 14;

function AnnouncementRow({ announcement }) {
  const cfg = TYPE_CONFIG[announcement.type] || TYPE_CONFIG.info;
  const Icon = cfg.icon;
  return (
    <div className={`relative flex gap-3 p-3.5 rounded-xl border ${cfg.border} ${cfg.bg} overflow-hidden`}>
      <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-xl ${cfg.bar}`} />
      <div className={`shrink-0 mt-0.5 ml-1 ${cfg.iconColor}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <h4 className="font-semibold text-slate-900 text-sm leading-tight flex items-center gap-1.5">
            {announcement.title}
            {isNew(announcement.created_date) && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded-full">
                <Sparkles className="w-2.5 h-2.5" /> New
              </span>
            )}
          </h4>
          <span className="shrink-0 text-xs text-slate-400 mt-0.5">
            {format(new Date(announcement.created_date), 'MMM d')}
          </span>
        </div>
        <p className="text-xs text-slate-600 mt-1 leading-relaxed whitespace-pre-wrap">{announcement.content}</p>
      </div>
    </div>
  );
}

export default function AnnouncementsWidget() {
  const [expanded, setExpanded] = useState(false);

  const { data: announcements = [], isLoading } = useQuery({
    queryKey: ['announcements'],
    queryFn: () => base44.entities.Announcement.filter({ is_active: true }, '-created_date'),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  if (isLoading || announcements.length === 0) return null;

  const newCount = announcements.filter((a) => isNew(a.created_date)).length;
  const latest = announcements[0];
  const rest = announcements.slice(1);
  const hasMore = rest.length > 0;

  return (
    <div className="mb-4 sm:mb-6 rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      {/* Compact header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100 bg-slate-50/60">
        <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-blue-100">
          <Bell className="w-4 h-4 text-blue-600" />
        </div>
        <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Announcements</h2>
        {newCount > 0 && (
          <span className="text-[10px] font-bold uppercase tracking-wide text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">
            {newCount} new
          </span>
        )}
        <span className="ml-auto text-xs font-medium text-slate-500">{announcements.length} total</span>
      </div>

      {/* Latest announcement always visible */}
      <div className="p-3">
        <AnnouncementRow announcement={latest} />

        {/* Remaining announcements collapse to keep the dashboard short */}
        {hasMore && expanded && (
          <div className="space-y-2.5 mt-2.5">
            {rest.map((a) => (
              <AnnouncementRow key={a.id} announcement={a} />
            ))}
          </div>
        )}

        {hasMore && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="w-full mt-2.5 flex items-center justify-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg py-2 transition-colors"
          >
            {expanded ? 'Show less' : `View ${rest.length} more announcement${rest.length > 1 ? 's' : ''}`}
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>
    </div>
  );
}