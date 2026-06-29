import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
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
import { buildPaletteEntries, paletteGroupFor, NAV_MANIFEST } from "@/lib/nav.manifest";

const RECENTS_KEY = "pennsync_recent_pages";
const MAX_RECENTS = 5;

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
            <CommandEmpty>No pages found.</CommandEmpty>

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