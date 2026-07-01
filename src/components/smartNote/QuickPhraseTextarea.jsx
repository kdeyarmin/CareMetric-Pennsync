import { useCallback, useEffect, useRef, useState } from "react";
import {
  detectTrigger,
  filterPhrases,
  applyExpansion,
  expansionTextFor,
  DEFAULT_QUICK_PHRASES,
} from "./quickPhrase.js";

// A controlled <textarea> with an inline quick-phrase menu. Typing a "/" slash
// command or a ".dot-token" (e.g. ".diabeticedu") opens a picker; selecting an
// entry inserts the expanded, compliant phrasing at the caret. The inserted text
// is generic/attestable (bracketed cues for specifics) and still flows through
// the downstream ConstrainedNoteReviewer / grounding pass, so anti-fabrication
// holds. The detection/insertion logic is the unit-tested pure module
// quickPhrase.js; this component is only the wiring + menu UI.
export default function QuickPhraseTextarea({
  value,
  onChange,
  phrases = DEFAULT_QUICK_PHRASES,
  placeholder,
  className,
  textareaRef,
  name,
  disabled = false,
  onExpand, // optional async (phrase) => string, e.g. backend expandClinicalPhrase
}) {
  const innerRef = useRef(null);
  const [menu, setMenu] = useState({ open: false, items: [], activeIndex: 0, range: null });
  const [pendingCaret, setPendingCaret] = useState(null);

  const setRefs = useCallback(
    (node) => {
      innerRef.current = node;
      if (typeof textareaRef === "function") textareaRef(node);
      else if (textareaRef) textareaRef.current = node;
    },
    [textareaRef],
  );

  const closeMenu = useCallback(() => setMenu((m) => (m.open ? { ...m, open: false } : m)), []);

  const refresh = useCallback(
    (text, caret) => {
      const trig = detectTrigger(text, caret);
      if (!trig) return closeMenu();
      const items = filterPhrases(phrases, trig.query);
      if (!items.length) return closeMenu();
      setMenu({ open: true, items, activeIndex: 0, range: trig });
    },
    [phrases, closeMenu],
  );

  const handleChange = (e) => {
    const next = e.target.value;
    onChange?.(next);
    refresh(next, e.target.selectionStart);
  };

  const select = useCallback(
    async (item) => {
      if (!item || !menu.range) return closeMenu();
      let expandedText = expansionTextFor(item);
      if (onExpand) {
        try {
          const resolved = await onExpand(item);
          if (resolved) expandedText = resolved;
        } catch {
          /* fall back to the local expansion */
        }
      }
      const { text, caret } = applyExpansion(value ?? "", menu.range, expandedText);
      onChange?.(text);
      setPendingCaret(caret);
      closeMenu();
    },
    [menu.range, onExpand, value, onChange, closeMenu],
  );

  const handleKeyDown = (e) => {
    if (!menu.open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setMenu((m) => ({ ...m, activeIndex: (m.activeIndex + 1) % m.items.length }));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setMenu((m) => ({ ...m, activeIndex: (m.activeIndex - 1 + m.items.length) % m.items.length }));
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      select(menu.items[menu.activeIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeMenu();
    }
  };

  // Restore the caret after a programmatic insertion (value updated by parent).
  useEffect(() => {
    if (pendingCaret == null) return;
    const el = innerRef.current;
    if (el) {
      el.focus();
      try {
        el.setSelectionRange(pendingCaret, pendingCaret);
      } catch {
        /* jsdom / unsupported — ignore */
      }
    }
    setPendingCaret(null);
  }, [pendingCaret, value]);

  return (
    <div className="relative">
      <textarea
        ref={setRefs}
        name={name}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={() => setTimeout(closeMenu, 120)}
        placeholder={placeholder}
        disabled={disabled}
        className={className}
      />
      {menu.open && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg py-1"
        >
          <li className="px-3 py-1 text-[10px] uppercase tracking-wide text-slate-400">
            Quick phrases — ↑↓ then Enter
          </li>
          {menu.items.map((it, idx) => (
            <li
              key={it.token}
              role="option"
              aria-selected={idx === menu.activeIndex}
              onMouseDown={(e) => {
                e.preventDefault(); // keep textarea focus; avoid blur closing first
                select(it);
              }}
              onMouseEnter={() => setMenu((m) => ({ ...m, activeIndex: idx }))}
              className={`cursor-pointer px-3 py-1.5 text-sm ${
                idx === menu.activeIndex ? "bg-navy-50 text-navy-800" : "text-slate-700"
              }`}
            >
              <span className="font-mono text-xs text-navy-600">.{it.token}</span>
              <span className="ml-2 text-slate-500">{it.phrase}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
