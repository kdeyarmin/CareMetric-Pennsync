import React, { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Search, X, User, FileText, CheckCircle, Calendar, Loader2 } from "lucide-react";

// Simple fuzzy match: returns true if all chars of query appear in order in str
function fuzzyMatch(str, query) {
  if (!query) return true;
  str = str.toLowerCase();
  query = query.toLowerCase();
  let qi = 0;
  for (let i = 0; i < str.length && qi < query.length; i++) {
    if (str[i] === query[qi]) qi++;
  }
  return qi === query.length;
}

// Score a match: higher = better (exact substring beats fuzzy)
function score(str, query) {
  if (!str || !query) return 0;
  const s = str.toLowerCase();
  const q = query.toLowerCase();
  if (s.includes(q)) return 2;
  if (fuzzyMatch(s, q)) return 1;
  return 0;
}

function highlight(text, query) {
  if (!text || !query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-200 text-yellow-900 rounded px-0.5">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

const CATEGORY_META = {
  patient:    { label: "Patient",     icon: User,         color: "text-blue-600",   bg: "bg-blue-50" },
  visit:      { label: "Visit",       icon: Calendar,     color: "text-purple-600", bg: "bg-purple-50" },
  task:       { label: "Task",        icon: CheckCircle,  color: "text-green-600",  bg: "bg-green-50" },
  careplan:   { label: "Care Plan",   icon: FileText,     color: "text-orange-600", bg: "bg-orange-50" },
};

export default function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState([]);
  const inputRef = useRef(null);
  const containerRef = useRef(null);
  const navigate = useNavigate();

  const { data: patients = [] } = useQuery({
    queryKey: ["search-patients"],
    queryFn: () => base44.entities.Patient.list(),
    staleTime: 60_000,
  });

  const { data: visits = [] } = useQuery({
    queryKey: ["search-visits"],
    queryFn: () => base44.entities.Visit.list("-visit_date", 200),
    staleTime: 60_000,
  });

  const { data: tasks = [] } = useQuery({
    queryKey: ["search-tasks"],
    queryFn: () => base44.entities.Task.list("-created_date", 200),
    staleTime: 60_000,
  });

  const { data: carePlans = [] } = useQuery({
    queryKey: ["search-careplans"],
    queryFn: () => base44.entities.CarePlan.list("-created_date", 200),
    staleTime: 60_000,
  });

  const runSearch = useCallback((q) => {
    if (!q || q.trim().length < 2) {
      setResults([]);
      return;
    }

    const hits = [];

    // Patients
    patients.forEach(p => {
      const fullName = `${p.first_name || ""} ${p.last_name || ""}`.trim();
      const fields = [fullName, p.medical_record_number, p.primary_diagnosis, p.phone, p.address];
      const best = Math.max(...fields.filter(Boolean).map(f => score(f, q)));
      if (best > 0) {
        hits.push({
          id: `patient-${p.id}`,
          type: "patient",
          title: fullName,
          subtitle: [p.primary_diagnosis, p.medical_record_number].filter(Boolean).join(" · "),
          score: best + (p.status === "active" ? 0.5 : 0),
          action: () => navigate(`${createPageUrl("PatientDetails")}?id=${p.id}`),
        });
      }
    });

    // Visits
    visits.forEach(v => {
      // Find patient name for context
      const pat = patients.find(p => p.id === v.patient_id);
      const patName = pat ? `${pat.first_name} ${pat.last_name}` : "";
      const fields = [v.nurse_notes, v.visit_type, patName, v.visit_date];
      const best = Math.max(...fields.filter(Boolean).map(f => score(f, q)));
      if (best > 0) {
        hits.push({
          id: `visit-${v.id}`,
          type: "visit",
          title: `${v.visit_type?.replace(/_/g, " ") || "Visit"} — ${patName || "Unknown patient"}`,
          subtitle: v.visit_date ? `${v.visit_date}${v.nurse_notes ? " · " + v.nurse_notes.slice(0, 60) + "..." : ""}` : "",
          score: best,
          action: () => navigate(`${createPageUrl("PatientDetails")}?id=${v.patient_id}`),
        });
      }
    });

    // Tasks
    tasks.forEach(t => {
      const fields = [t.title, t.description, t.status, t.priority];
      const best = Math.max(...fields.filter(Boolean).map(f => score(f, q)));
      if (best > 0) {
        hits.push({
          id: `task-${t.id}`,
          type: "task",
          title: t.title || "Untitled Task",
          subtitle: [t.status, t.priority, t.due_date].filter(Boolean).join(" · "),
          score: best,
          action: () => navigate(createPageUrl("Tasks")),
        });
      }
    });

    // Care Plans
    carePlans.forEach(cp => {
      const pat = patients.find(p => p.id === cp.patient_id);
      const patName = pat ? `${pat.first_name} ${pat.last_name}` : "";
      const fields = [cp.problem, cp.goal, patName, ...(cp.interventions || [])];
      const best = Math.max(...fields.filter(Boolean).map(f => score(f, q)));
      if (best > 0) {
        hits.push({
          id: `cp-${cp.id}`,
          type: "careplan",
          title: cp.problem || "Care Plan",
          subtitle: [patName, cp.goal?.slice(0, 60)].filter(Boolean).join(" · "),
          score: best,
          action: () => navigate(`${createPageUrl("PatientDetails")}?id=${cp.patient_id}`),
        });
      }
    });

    hits.sort((a, b) => b.score - a.score);
    setResults(hits.slice(0, 10));
  }, [patients, visits, tasks, carePlans, navigate]);

  useEffect(() => {
    const timer = setTimeout(() => runSearch(query), 150);
    return () => clearTimeout(timer);
  }, [query, runSearch]);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Keyboard shortcut: Cmd/Ctrl+K
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const handleSelect = (result) => {
    result.action();
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  };

  const isEmpty = query.trim().length >= 2 && results.length === 0;

  return (
    <div ref={containerRef} className="relative flex-1 max-w-xs sm:max-w-sm md:max-w-md lg:max-w-lg mx-2 sm:mx-4">
      {/* Search Input */}
      <div className="relative flex items-center">
        <Search className="absolute left-2.5 h-4 w-4 text-slate-400 pointer-events-none z-10" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Search patients, notes, tasks… (⌘K)"
          className="w-full pl-8 pr-8 py-1.5 text-sm bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white dark:focus:bg-slate-800 transition-all placeholder:text-slate-400 dark:text-slate-100"
        />
        {query && (
          <button
            onClick={() => { setQuery(""); setResults([]); inputRef.current?.focus(); }}
            className="absolute right-2 text-slate-400 hover:text-slate-600"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Dropdown */}
      {open && query.trim().length >= 2 && (
        <div className="absolute top-full left-0 right-0 mt-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl shadow-2xl z-[100] overflow-hidden max-h-96 overflow-y-auto">
          {isEmpty ? (
            <div className="flex flex-col items-center justify-center py-8 text-slate-400">
              <Search className="h-6 w-6 mb-2 opacity-50" />
              <p className="text-sm">No results for "{query}"</p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-700">
              {results.map((result) => {
                const meta = CATEGORY_META[result.type];
                const Icon = meta.icon;
                return (
                  <li key={result.id}>
                    <button
                      className="w-full flex items-start gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors text-left"
                      onClick={() => handleSelect(result)}
                    >
                      <div className={`flex-shrink-0 mt-0.5 p-1.5 rounded-md ${meta.bg}`}>
                        <Icon className={`h-3.5 w-3.5 ${meta.color}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">
                          {highlight(result.title, query)}
                        </p>
                        {result.subtitle && (
                          <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                            {result.subtitle}
                          </p>
                        )}
                      </div>
                      <span className={`flex-shrink-0 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${meta.bg} ${meta.color} mt-0.5`}>
                        {meta.label}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="px-4 py-2 border-t border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
            <p className="text-[10px] text-slate-400">
              {results.length} result{results.length !== 1 ? "s" : ""} · Press <kbd className="px-1 py-0.5 bg-slate-200 dark:bg-slate-700 rounded text-[10px]">Esc</kbd> to close
            </p>
          </div>
        </div>
      )}
    </div>
  );
}