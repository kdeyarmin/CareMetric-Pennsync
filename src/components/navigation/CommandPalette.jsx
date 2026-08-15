import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router";
import { useScopedPatients } from '@/hooks/useScopedPatients';
import { createPageUrl } from "@/utils";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from "@/components/ui/command";
import { Brain, Send, CalendarDays, Mail, FileText, User } from "lucide-react";
import { buildPaletteEntries, paletteGroupFor, NAV_MANIFEST } from "@/lib/nav.manifest";

const RECENTS_KEY = "caremetric_recent_pages";
const MAX_RECENTS = 5;

// Verbs, not just destinations — the palette doubles as a "do things" bar so a
// user can start the common flows from one keystroke. Each action navigates to
// the page that begins the flow; `adminOnly` actions are filtered out for
// nurses (mirrors the route guard). `to` is a real route path so selecting an
// action can never dead-end.
const QUICK_ACTIONS = [
  { id: "start-smart-note", label: "Start a Smart Note", icon: Brain, to: "/SmartNoteAssistant", keywords: "new note chart document visit dictation scribe ai" },
  { id: "send-fax", label: "Send a fax", icon: Send, to: "/SendFax", keywords: "new outbound physician" },
  { id: "new-message", label: "New message", icon: Mail, to: "/Messages", keywords: "send inbox chat compose" },
  { id: "request-time-off", label: "Request time off", icon: CalendarDays, to: "/TimeOff", keywords: "pto leave vacation new request" },
  { id: "new-referral", label: "New referral / intake", icon: FileText, to: "/ReferralIntake", keywords: "admission patient new office", adminOnly: true },
];

function readRecents() {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function pushRecent(pageName) {
  try {
    const next = [pageName, ...readRecents().filter((name) => name !== pageName)].slice(0, MAX_RECENTS);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* ignore storage failures */
  }
}

const getCategory = (page) => page.category || paletteGroupFor(page.page);

export default function CommandPalette({ isAdmin, isSuperAdmin = false }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [recents, setRecents] = useState([]);
  const navigate = useNavigate();

  // Patients are the highest-frequency navigation target, so ⌘K doubles as a
  // "jump to chart" bar. Fetch the roster only while the palette is open (not on
  // every page load) and surface name/MRN matches once the user has typed ≥2
  // chars — server RLS still scopes the list to the user's assigned patients.
  const { data: patients = [] } = useScopedPatients({ sort: '-created_date', limit: 2000, enabled: open, staleTime: 60000 });

  const patientMatches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length < 2) return [];
    return patients
      .filter((p) => {
        if (!p) return false;
        const name = `${p.first_name || ""} ${p.last_name || ""}`.toLowerCase();
        const mrn = (p.medical_record_number || "").toLowerCase();
        return name.includes(q) || mrn.includes(q);
      })
      .slice(0, 8);
  }, [patients, search]);

  const handlePatient = useCallback((patientId) => {
    setOpen(false);
    navigate(`${createPageUrl("PatientDetails")}?id=${patientId}`);
  }, [navigate]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    const handleOpenEvent = () => setOpen(true);

    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("open-command-palette", handleOpenEvent);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("open-command-palette", handleOpenEvent);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setRecents(readRecents());
      setSearch("");
    }
  }, [open]);

  const pages = useMemo(() => buildPaletteEntries(NAV_MANIFEST, isAdmin, isSuperAdmin), [isAdmin, isSuperAdmin]);

  const pageByName = useMemo(() => {
    const map = new Map();
    pages.forEach((page) => map.set(page.page, page));
    return map;
  }, [pages]);

  const categories = useMemo(() => [...new Set(pages.map((page) => getCategory(page)))], [pages]);

  const handleSelect = useCallback((pageName) => {
    setOpen(false);
    pushRecent(pageName);
    navigate(`/${pageName}`);
  }, [navigate]);

  const handleAction = useCallback((to) => {
    setOpen(false);
    navigate(to);
  }, [navigate]);

  const quickActions = useMemo(
    () => QUICK_ACTIONS.filter((a) => (!a.adminOnly || isAdmin) && (!a.superAdminOnly || isSuperAdmin)),
    [isAdmin, isSuperAdmin],
  );

  const recentPages = recents.map((name) => pageByName.get(name)).filter(Boolean);
  const showRecents = !search.trim() && recentPages.length > 0;

  const renderItem = useCallback((page, prefix = "") => {
    const Icon = page.icon;
    return (
      <CommandItem
        key={`${prefix}${page.page}`}
        value={`${prefix}${page.label} ${(page.keywords ?? []).join(" ")}`}
        onSelect={() => handleSelect(page.page)}
        className="group flex cursor-pointer items-center gap-3 px-3 py-2.5"
      >
        <Icon className="h-4 w-4 flex-shrink-0 text-slate-400 transition-colors group-aria-selected:text-navy-600" />
        <span className="group-aria-selected:font-medium">{page.label}</span>
      </CommandItem>
    );
  }, [handleSelect]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg overflow-hidden border p-0 shadow-2xl">
        <div className="sr-only"><DialogTitle>Quick Navigation</DialogTitle></div>
        <Command className="rounded-lg" loop>
          <CommandInput
            value={search}
            onValueChange={setSearch}
            placeholder="Search pages, tools, reports…"
          />
          <CommandList className="max-h-[400px]">
            <CommandEmpty>No results found.</CommandEmpty>

            {quickActions.length > 0 && (
              <>
                <CommandGroup heading="Actions">
                  {quickActions.map((action) => {
                    const Icon = action.icon;
                    return (
                      <CommandItem
                        key={action.id}
                        value={`action ${action.label} ${action.keywords ?? ""}`}
                        onSelect={() => handleAction(action.to)}
                        className="group flex cursor-pointer items-center gap-3 px-3 py-2.5"
                      >
                        <Icon className="h-4 w-4 flex-shrink-0 text-navy-500 transition-colors group-aria-selected:text-navy-600" />
                        <span className="group-aria-selected:font-medium">{action.label}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
                <CommandSeparator />
              </>
            )}

            {patientMatches.length > 0 && (
              <>
                <CommandGroup heading="Patients">
                  {patientMatches.map((p) => (
                    <CommandItem
                      key={p.id}
                      value={`patient ${p.first_name || ""} ${p.last_name || ""} ${p.medical_record_number || ""} ${p.id}`}
                      onSelect={() => handlePatient(p.id)}
                      className="group flex cursor-pointer items-center gap-3 px-3 py-2.5"
                    >
                      <User className="h-4 w-4 flex-shrink-0 text-navy-500 transition-colors group-aria-selected:text-navy-600" />
                      <span className="group-aria-selected:font-medium">
                        {p.first_name} {p.last_name}
                      </span>
                      {p.medical_record_number && (
                        <span className="ml-auto text-xs text-slate-400">MRN {p.medical_record_number}</span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
                <CommandSeparator />
              </>
            )}

            {showRecents && (
              <>
                <CommandGroup heading="Recent">
                  {recentPages.map((page) => renderItem(page, "recent "))}
                </CommandGroup>
                <CommandSeparator />
              </>
            )}

            {categories.map((category, index) => (
              <div key={category}>
                {index > 0 && <CommandSeparator />}
                <CommandGroup heading={category}>
                  {pages
                    .filter((page) => getCategory(page) === category)
                    .map((page) => renderItem(page))}
                </CommandGroup>
              </div>
            ))}
          </CommandList>
          <div className="flex items-center gap-4 border-t px-3 py-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">↑↓</kbd> navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">↵</kbd> open
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">esc</kbd> close
            </span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}