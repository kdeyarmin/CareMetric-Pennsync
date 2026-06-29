import { useEffect, useState } from "react";
import { Signal, Wifi, BatteryFull } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * PhoneFrame — a device-shaped shell that makes the Phone Center and Messages
 * read like a real phone: a bezel with a notch, a status bar (live clock +
 * signal/wifi/battery), a fixed-height screen that scrolls internally, and an
 * optional bottom tab bar for navigating between app screens.
 *
 * Each *screen* renders its own top bar (PhoneTopBar) and scroll body, so the
 * frame only owns the device chrome — exactly like the real thing where every
 * app draws its own navigation bar inside the same hardware.
 *
 * Props:
 *  • tabs?        [{ key, label, icon, badge }]  — omit for a tab-less app
 *  • activeTab / onTabChange                     — controlled tab state
 *  • children                                    — the active screen
 */
export default function PhoneFrame({ tabs, activeTab, onTabChange, children, className }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);
  const time = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  return (
    <div className={cn("mx-auto w-full max-w-[27rem]", className)}>
      {/* Bezel */}
      <div className="relative rounded-[2.3rem] bg-slate-900 p-2 shadow-[0_30px_70px_-15px_rgba(15,23,42,0.45)] sm:p-2.5">
        {/* Notch */}
        <div className="pointer-events-none absolute left-1/2 top-2 z-20 h-6 w-32 -translate-x-1/2 rounded-b-2xl bg-slate-900 sm:top-2.5" />

        {/* Screen */}
        <div className="flex h-[78vh] min-h-[560px] max-h-[860px] flex-col overflow-hidden rounded-[1.8rem] bg-slate-50">
          {/* Status bar */}
          <div className="flex flex-shrink-0 items-center justify-between bg-white px-6 pb-1 pt-2 text-slate-900">
            <span className="text-[13px] font-semibold tracking-tight">{time}</span>
            <div className="flex items-center gap-1.5">
              <Signal className="h-3.5 w-3.5" />
              <Wifi className="h-3.5 w-3.5" />
              <BatteryFull className="h-4 w-4" />
            </div>
          </div>

          {/* Active screen (renders its own PhoneTopBar + scroll body) */}
          <div className="relative flex min-h-0 flex-1 flex-col bg-slate-50">{children}</div>

          {/* Bottom tab bar */}
          {tabs?.length > 0 && (
            <div
              className="grid flex-shrink-0 border-t border-slate-200 bg-white/95 backdrop-blur"
              style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
            >
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const active = tab.key === activeTab;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => onTabChange?.(tab.key)}
                    className={cn(
                      "relative flex min-h-[56px] flex-col items-center justify-center gap-0.5 pb-1.5 pt-2 transition-colors active:scale-95",
                      active ? "text-blue-600" : "text-slate-400 hover:text-slate-600"
                    )}
                    aria-current={active ? "page" : undefined}
                  >
                    <div className="relative">
                      <Icon className={cn("h-[22px] w-[22px]", active && "fill-blue-600/10")} />
                      {tab.badge > 0 && (
                        <Badge className="absolute -right-2.5 -top-2 h-4 min-w-4 justify-center rounded-full border border-white bg-red-500 px-1 text-[10px] font-bold leading-none text-white">
                          {tab.badge > 99 ? "99+" : tab.badge}
                        </Badge>
                      )}
                    </div>
                    <span className={cn("text-[10px] font-medium leading-none", active && "font-semibold")}>
                      {tab.label}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * PhoneScreen — convenience wrapper for a screen's scrolling body. A screen
 * typically renders <PhoneTopBar/> then <PhoneScreen>…rows…</PhoneScreen>.
 */
export function PhoneScreen({ children, className }) {
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <div className="flex-1 overflow-y-auto overscroll-contain">{children}</div>
    </div>
  );
}

/**
 * PhoneEmptyState — the centered icon + message a phone shows for an empty list.
 */
export function PhoneEmptyState({ icon: Icon, title, hint }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
      {Icon && (
        <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-slate-100">
          <Icon className="h-8 w-8 text-slate-400" />
        </div>
      )}
      <p className="text-sm font-medium text-slate-600">{title}</p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}
