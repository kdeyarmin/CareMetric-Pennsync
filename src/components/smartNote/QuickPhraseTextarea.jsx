import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Sparkles, Loader2, User, Globe, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { expandClinicalPhrase } from "@/functions/expandClinicalPhrase";
import { DEFAULT_CLINICAL_PHRASES } from "@/components/clinical/defaultClinicalPhrases";
import { fetchAllClinicalTemplates } from "@/components/clinical/fetchAllClinicalTemplates";
import { detectPhraseTrigger, rankPhrases, applyExpansion, phraseNeedsPatient, normalizePhraseText, isPhraseVisible } from "./quickPhrase";

// Merge the agency's authored ClinicalLibraryTemplate records with the bundled
// offline defaults, so the picker works even before an agency seeds its library
// (and offline). A default is suppressed only when a template that is actually
// VISIBLE in this context shares its phrase — otherwise a hidden record (another
// nurse's private phrase, or a different patient's bound phrase) would silently
// remove the default even though rankPhrases filters that record right back out.
export function mergePhrases(templates, ctx) {
  const visible = (templates || []).filter((t) => isPhraseVisible(t, ctx));
  const seen = new Set(visible.map((t) => normalizePhraseText(t.phrase)));
  const defaults = DEFAULT_CLINICAL_PHRASES.filter((d) => !seen.has(normalizePhraseText(d.phrase)));
  return [...(templates || []), ...defaults];
}

// A drop-in <textarea> replacement that adds inline quick-phrase expansion. The
// nurse types a "/" (or a ".dot-token") to open a picker of their clinical
// phrases; selecting one calls the hosted expandClinicalPhrase function and
// inserts the full Medicare-compliant text at the caret. Everything else behaves
// like a normal controlled textarea — the expanded text becomes ordinary note
// content that still flows through the constrained-scribe review before save, so
// the anti-fabrication guarantees are preserved.
//
// The parent owns `value`/`onChange`; this component owns only the trigger menu.
const QuickPhraseTextarea = forwardRef(function QuickPhraseTextarea(
  { value, onChange, patientId, patientName, visitType, userEmail, className, ...textareaProps },
  forwardedRef,
) {
  const areaRef = useRef(null);
  const queryClient = useQueryClient();
  const [trigger, setTrigger] = useState(null); // { trigger, query, start, end }
  const [activeIndex, setActiveIndex] = useState(0);
  const [expanding, setExpanding] = useState(false);
  const pendingCaretRef = useRef(null);
  // Start index of a trigger token the nurse dismissed with Escape. While the
  // caret stays inside that same token, re-detection (e.g. from the Escape keyup)
  // must not re-open the menu; a NEW token (different start) reopens normally.
  const dismissedStartRef = useRef(null);

  // Open the phrase picker without typing "/": insert a slash at the caret (with a
  // leading space if needed so it forms a valid trigger) and reuse the normal flow.
  const openQuickPhrases = useCallback(() => {
    const el = areaRef.current;
    if (!el) return;
    el.focus();
    const cur = el.value ?? "";
    const pos = typeof el.selectionStart === "number" ? el.selectionStart : cur.length;
    const needsSep = pos > 0 && !/\s/.test(cur[pos - 1]);
    const sep = needsSep ? " " : "";
    const slashPos = pos + sep.length;
    const newText = cur.slice(0, pos) + sep + "/" + cur.slice(pos);
    dismissedStartRef.current = null;
    pendingCaretRef.current = slashPos + 1;
    onChange?.(newText);
    setTrigger({ trigger: "/", query: "", start: slashPos, end: slashPos + 1 });
  }, [onChange]);

  // Expose focus (the parent calls .focus()) plus an imperative way to open the
  // picker from a toolbar button.
  useImperativeHandle(
    forwardedRef,
    () => ({ focus: () => areaRef.current?.focus(), openQuickPhrases }),
    [openQuickPhrases],
  );

  // Must use the SAME paging queryFn as the library manager / analytics /
  // phrase seeder: all four read the ['clinical-templates'] cache entry, so a
  // flat `list(sort, 200)` here silently truncated the shared cache whenever
  // this editor populated it first — which also broke the seeder's
  // "only create what's missing" check into creating duplicates.
  const { data: templates = [] } = useQuery({
    queryKey: ["clinical-templates"],
    queryFn: fetchAllClinicalTemplates,
    initialData: [],
    staleTime: 5 * 60 * 1000,
  });

  const phrases = useMemo(
    () => mergePhrases(templates, { email: userEmail, patientId }),
    [templates, userEmail, patientId],
  );
  const ranked = trigger
    ? rankPhrases(phrases, { query: trigger.query, visitType, patientId, email: userEmail, limit: 8 })
    : [];
  // Keep the menu quiet: only surface it for the bare "/" (discovery) or when the
  // typed query actually matches phrases. A non-matching query hides it entirely.
  const menuOpen = !expanding && !!trigger && (trigger.query.trim() === "" || ranked.length > 0);

  // Restore the caret after a controlled value update (expansion or plain typing).
  useLayoutEffect(() => {
    if (pendingCaretRef.current != null && areaRef.current) {
      const c = pendingCaretRef.current;
      pendingCaretRef.current = null;
      try {
        areaRef.current.setSelectionRange(c, c);
      } catch {
        /* selection APIs unavailable (jsdom / detached node) — non-fatal */
      }
    }
  }, [value]);

  useEffect(() => {
    setActiveIndex(0);
  }, [trigger?.query, trigger?.start]);

  const refreshTrigger = (el) => {
    if (!el) return;
    // Only track a trigger when there is no selection (a plain caret).
    if (el.selectionStart !== el.selectionEnd) {
      setTrigger(null);
      return;
    }
    const t = detectPhraseTrigger(el.value, el.selectionStart);
    if (!t) {
      // Caret left every trigger token — a future token may open freely.
      dismissedStartRef.current = null;
      setTrigger(null);
      return;
    }
    // Honor an Escape dismissal until the nurse starts a different token.
    if (dismissedStartRef.current === t.start) {
      setTrigger(null);
      return;
    }
    dismissedStartRef.current = null;
    setTrigger(t);
  };

  const handleChange = (e) => {
    onChange?.(e.target.value);
    refreshTrigger(e.target);
  };

  const closeMenu = () => setTrigger(null);

  const runExpansion = async (template) => {
    if (!template || !trigger) return;
    if (phraseNeedsPatient(template) && !patientId) {
      toast.error("Select a patient first — this phrase pulls patient-specific details.");
      return;
    }
    const range = trigger;

    // Offline default phrases (no library id) carry their own compliant text —
    // insert directly, no backend round-trip needed (works offline too).
    if (!template.id) {
      const cur = areaRef.current?.value ?? value ?? "";
      if (cur.slice(range.start, range.end) !== range.trigger + range.query) {
        toast.error("Couldn't place the phrase — please retype the trigger.");
        return;
      }
      const { text, caret } = applyExpansion(cur, range, template.expanded_text || template.phrase);
      pendingCaretRef.current = caret;
      onChange?.(text);
      closeMenu();
      toast.success("Phrase inserted");
      setTimeout(() => areaRef.current?.focus(), 0);
      return;
    }

    setExpanding(true);
    try {
      const res = await expandClinicalPhrase({
        phrase: template.phrase,
        patientId: patientId || undefined,
        contextData: {
          visitType,
          patientName: patientName || undefined,
          diagnosis: undefined,
        },
      });
      const expandedText = res?.data?.expandedText ?? res?.expandedText;
      if (!expandedText) {
        toast.error("Could not expand that phrase. Try again or type it manually.");
        return;
      }
      const current = areaRef.current?.value ?? value ?? "";
      // The textarea is locked (readOnly) during the round-trip, but guard anyway:
      // if the captured token no longer sits at [start,end) (e.g. a draft restore
      // fired mid-flight), abort rather than overwrite unrelated text.
      if (current.slice(range.start, range.end) !== range.trigger + range.query) {
        toast.error("Couldn't place the phrase — please retype the trigger.");
        return;
      }
      const { text, caret } = applyExpansion(current, range, expandedText);
      pendingCaretRef.current = caret;
      onChange?.(text);
      closeMenu();
      // Usage count / freshness: the backend bumped usage_count, so refetch soon.
      queryClient.invalidateQueries({ queryKey: ["clinical-templates"] });
      const src = res?.data?.source ?? res?.source;
      toast.success(src === "ai_generated" ? "Phrase expanded (AI-generated)" : "Phrase inserted");
      // Return focus to the textarea after the async round-trip.
      setTimeout(() => areaRef.current?.focus(), 0);
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || "Failed to expand phrase";
      toast.error(msg);
    } finally {
      setExpanding(false);
    }
  };

  const handleKeyDown = (e) => {
    if (!menuOpen) {
      // Forward to any parent-provided handler when the menu is closed.
      textareaProps.onKeyDown?.(e);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (ranked.length ? (i + 1) % ranked.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (ranked.length ? (i - 1 + ranked.length) % ranked.length : 0));
    } else if ((e.key === "Enter" || e.key === "Tab") && ranked[activeIndex]) {
      e.preventDefault();
      runExpansion(ranked[activeIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      // Remember which token was dismissed so the keyup that follows this same
      // keystroke doesn't immediately re-detect and re-open it.
      if (trigger) dismissedStartRef.current = trigger.start;
      closeMenu();
    } else {
      textareaProps.onKeyDown?.(e);
    }
  };

  // Strip our own handlers out of the passthrough so they don't get overridden.
  const { onKeyDown: _ignoredKeyDown, onSelect: _ignoredSelect, onClick: _ignoredClick, ...rest } = textareaProps;

  return (
    <div className="relative">
      <textarea
        {...rest}
        ref={areaRef}
        value={value}
        onChange={handleChange}
        readOnly={expanding}
        onKeyDown={handleKeyDown}
        onKeyUp={(e) => refreshTrigger(e.currentTarget)}
        onClick={(e) => refreshTrigger(e.currentTarget)}
        onBlur={(e) => {
          // Delay so a click on a menu item registers before the menu unmounts.
          setTimeout(() => setTrigger((t) => (document.activeElement === areaRef.current ? t : null)), 150);
          rest.onBlur?.(e);
        }}
        className={className}
      />

      {expanding && (
        <div className="absolute right-3 top-3 flex items-center gap-1.5 text-xs text-navy-600 bg-white/90 rounded px-2 py-1 shadow-sm">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Expanding…
        </div>
      )}

      {menuOpen && (
        <div
          className="absolute z-30 left-3 right-3 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden"
          // Keep focus in the textarea; act on mousedown so blur doesn't close first.
          onMouseDown={(e) => e.preventDefault()}
          role="listbox"
          aria-label="Quick phrases"
        >
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-navy-50 border-b border-navy-100 text-[11px] font-semibold text-navy-600 uppercase tracking-wide">
            <Sparkles className="w-3 h-3" /> Quick Phrases
            <span className="ml-auto font-normal normal-case text-navy-400">↑↓ Enter · Esc</span>
          </div>
          {ranked.length === 0 ? (
            <div className="px-3 py-3 text-xs text-slate-500">
              No matching phrases. Add them in the Clinical Library.
            </div>
          ) : (
            <ul className="max-h-64 overflow-y-auto py-1">
              {ranked.map((t, i) => (
                <li key={t.id || t.phrase}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === activeIndex}
                    onMouseEnter={() => setActiveIndex(i)}
                    onClick={() => runExpansion(t)}
                    className={cn(
                      "w-full text-left px-3 py-2 flex items-center gap-2 text-sm",
                      i === activeIndex ? "bg-navy-50" : "hover:bg-slate-50",
                    )}
                  >
                    <code className="font-mono text-navy-700 shrink-0">{t.phrase}</code>
                    <span className="text-[11px] text-slate-400 truncate">{t.category}</span>
                    <span className="ml-auto flex items-center gap-1 shrink-0">
                      {t.patient_id && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-navy-700 bg-navy-100 rounded px-1 py-0.5">
                          <User className="w-3 h-3" /> Patient
                        </span>
                      )}
                      {t.template_type === "patient_specific" && !t.patient_id && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-700 bg-amber-100 rounded px-1 py-0.5">
                          <Zap className="w-3 h-3" /> AI
                        </span>
                      )}
                      {t.is_agency_wide && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-700 bg-emerald-100 rounded px-1 py-0.5">
                          <Globe className="w-3 h-3" /> Agency
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="px-3 py-1.5 border-t border-slate-100 text-[10px] text-slate-400">
            Type <code className="font-mono">/</code> or <code className="font-mono">.shortcut</code> to trigger · inserted text is reviewed before save
          </div>
        </div>
      )}
    </div>
  );
});

export default QuickPhraseTextarea;
