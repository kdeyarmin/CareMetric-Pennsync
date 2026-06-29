import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * PhoneTopBar — the navigation bar at the top of a phone screen.
 *
 * Two looks, matching how a real phone app works:
 *  • Root screens (`large`): a big, bold, left-aligned title (e.g. "Recents",
 *    "Messages") with an optional accessory on the right.
 *  • Drilled-in screens (`onBack` set): a back chevron on the left, a centered
 *    title (+ optional avatar / subtitle), like an open conversation.
 */
export default function PhoneTopBar({
  title,
  subtitle,
  onBack,
  backLabel = "Back",
  accessory,
  avatar,
  large = false,
  className,
}) {
  if (onBack) {
    return (
      <div
        className={cn(
          "flex flex-shrink-0 items-center gap-2 border-b border-slate-200/80 bg-white/85 px-2 py-2 backdrop-blur",
          className
        )}
      >
        <button
          type="button"
          onClick={onBack}
          className="flex min-h-[40px] items-center rounded-lg pl-1 pr-2 text-blue-600 transition-colors hover:bg-blue-50 active:scale-95"
        >
          <ChevronLeft className="h-6 w-6" />
          <span className="text-[15px] font-medium">{backLabel}</span>
        </button>
        <div className="flex min-w-0 flex-1 flex-col items-center">
          {avatar}
          <p className="max-w-full truncate text-sm font-semibold leading-tight text-slate-900">{title}</p>
          {subtitle && <p className="truncate text-[11px] leading-tight text-slate-500">{subtitle}</p>}
        </div>
        <div className="flex min-w-[44px] items-center justify-end">{accessory}</div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-shrink-0 items-end justify-between gap-2 border-b border-slate-200/70 bg-white/85 px-4 pb-2 pt-3 backdrop-blur",
        className
      )}
    >
      <div className="min-w-0">
        <h2 className={cn("truncate font-bold text-slate-900", large ? "text-2xl" : "text-lg")}>{title}</h2>
        {subtitle && <p className="truncate text-xs text-slate-500">{subtitle}</p>}
      </div>
      {accessory && <div className="flex flex-shrink-0 items-center gap-2 pb-0.5">{accessory}</div>}
    </div>
  );
}
