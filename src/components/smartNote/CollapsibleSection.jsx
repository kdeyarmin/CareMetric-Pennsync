import { useState, useEffect, useRef } from "react";
import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";

/**
 * A titled, card-styled disclosure for the supporting sections of Step 1.
 *
 * The write step used to stack five always-open cards above the editor, so the
 * box the nurse actually came to type in started below the fold. These sections
 * still hold everything they held before — they just no longer outrank the note.
 * The trigger keeps the section's status visible while collapsed (a count badge
 * and/or a short summary) so collapsing never hides that something needs doing.
 */
export default function CollapsibleSection({
  title,
  icon: Icon,
  badge = null,
  badgeVariant = "secondary",
  summary = null,
  defaultOpen = true,
  children,
  className = "",
}) {
  const [open, setOpen] = useState(defaultOpen);

  // Some defaults depend on data that arrives after mount (facility rules load
  // from the server), and a plain initial value would leave those sections shut
  // for good. Opening on a false→true flip fixes that. It deliberately never
  // force-closes, so a section the nurse collapsed by hand stays collapsed.
  const wasDefaultOpen = useRef(defaultOpen);
  useEffect(() => {
    if (defaultOpen && !wasDefaultOpen.current) setOpen(true);
    wasDefaultOpen.current = defaultOpen;
  }, [defaultOpen]);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={`bg-white border border-slate-200 rounded-xl shadow-sm ${className}`}
    >
      <CollapsibleTrigger className="w-full flex items-center gap-2 px-4 py-3 text-left rounded-xl hover:bg-slate-50 transition-colors min-h-[48px] sm:min-h-0">
        {Icon && <Icon className="w-4 h-4 text-navy-600 shrink-0" aria-hidden="true" />}
        <span className="text-sm font-semibold text-slate-700">{title}</span>
        {badge != null && <Badge variant={badgeVariant} className="shrink-0">{badge}</Badge>}
        <span className="flex-1" />
        {summary && <span className="text-xs text-slate-500 hidden sm:inline truncate max-w-[45%]">{summary}</span>}
        <ChevronDown
          className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-4 pb-4 pt-1">{children}</CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Initial open state for a section that is useful-but-secondary: expanded where
 * there is room, collapsed on a phone where it would push the editor off screen.
 * Read once as a useState initializer — this intentionally does not track resizes,
 * so a section the nurse opened or closed by hand stays that way.
 */
export function openOnDesktop() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia("(min-width: 768px)").matches;
}
