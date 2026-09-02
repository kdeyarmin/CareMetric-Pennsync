import { useId } from "react";
import { AlertTriangle, Lock } from "lucide-react";
import {
  codesForTimepoint,
  isApplicableAtTimepoint,
  V1_LEGACY_WARNING,
  v1Definition,
} from "./responseSchema/registry.js";

// Schema-driven OASIS response controls.
//
// The legacy form assumed every item was a radio list of numeric values. Four of
// the CMS-aligned items are not: M1100 is a published 3x5 matrix with codes
// 01–15, M1740 is check-all-that-apply with a mutually exclusive "none", M2401
// is a five-row grid, and several items carry non-numeric codes (NA, UK) that a
// numeric control cannot represent at all.
//
// So the control is driven by the DEFINITION, not by a shape hard-coded at the
// call site. It renders the shape the item declares, preserves codes exactly as
// strings, and starts blank — there is no default selection, because a
// pre-selected official response is a response nobody chose.

/** Every official control starts blank and requires an explicit action. */
const CHOOSE_PROMPT = "No response selected. Choose one from the wording in your EMR.";

/**
 * @param {object} props
 * @param {object} props.definition  A v2 response definition.
 * @param {string} props.timepoint   Resolved CMS time point (SOC/ROC/FU/TRN/DC).
 * @param {object|null} props.value  Structured response value, or null when unanswered.
 * @param {(value: object) => void} props.onChange
 * @param {boolean} [props.disabled]
 */
export default function OasisResponseControl({ definition, timepoint, value, onChange, disabled = false }) {
  const groupId = useId();
  if (!definition) return null;

  // Applicability is part of the control, not a separate check a caller might
  // forget: an item CMS does not collect at this time point is not answerable.
  if (!isApplicableAtTimepoint(definition, timepoint)) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p className="text-sm font-semibold text-slate-800">{heading(definition)}</p>
        <p className="mt-1 flex items-start gap-1.5 text-xs text-slate-600">
          <Lock className="mt-0.5 h-3 w-3 flex-shrink-0" aria-hidden="true" />
          <span>
            Not collected at {timepoint || "this assessment"} — CMS collects{" "}
            {definition.item_number} at {definition.timepoints.join(", ")}.
          </span>
        </p>
      </div>
    );
  }

  const codes = codesForTimepoint(definition, timepoint);
  const describedBy = `${groupId}-src`;

  return (
    <fieldset className="rounded-lg border border-slate-200 p-3" disabled={disabled}>
      <legend className="px-1 text-sm font-semibold text-slate-800">{heading(definition)}</legend>
      <p className="text-xs text-slate-600">{definition.prompt}</p>

      {definition.response_shape === "single" && (
        <SingleSelect groupId={groupId} codes={codes} value={value} onChange={onChange} describedBy={describedBy} />
      )}
      {definition.response_shape === "matrix_choice" && (
        <MatrixChoice groupId={groupId} definition={definition} codes={codes} value={value} onChange={onChange} describedBy={describedBy} />
      )}
      {definition.response_shape === "multi_select" && (
        <MultiSelect groupId={groupId} codes={codes} value={value} onChange={onChange} describedBy={describedBy} />
      )}
      {definition.response_shape === "grid" && (
        <Grid groupId={groupId} definition={definition} codes={codes} value={value} onChange={onChange} describedBy={describedBy} />
      )}

      {/* Announced to assistive tech when the answer changes, and readable by
          everyone: an unanswered official item must look unanswered. */}
      <p className="sr-only" role="status" aria-live="polite">
        {isAnswered(definition, value) ? "Response selected." : CHOOSE_PROMPT}
      </p>
      {!isAnswered(definition, value) && (
        <p className="mt-2 text-xs text-slate-500">{CHOOSE_PROMPT}</p>
      )}
      <p id={describedBy} className="mt-2 text-xs text-slate-400">
        {definition.item_number} · {definition.citation} · collected at {definition.timepoints.join(", ")}.
        PennSync is a companion reference and does not certify this response.
      </p>
    </fieldset>
  );
}

function heading(definition) {
  return definition.item_number ? `${definition.item_number} — ${definition.title}` : definition.title;
}

function isAnswered(definition, value) {
  if (!value || typeof value !== "object") return false;
  if (definition.response_shape === "multi_select") return Array.isArray(value.codes) && value.codes.length > 0;
  if (definition.response_shape === "grid") {
    return Array.isArray(value.rows) && value.rows.length === (definition.rows || []).length;
  }
  return typeof value.code === "string" && value.code.length > 0;
}

function SingleSelect({ groupId, codes, value, onChange, describedBy }) {
  return (
    <div className="mt-2 space-y-1.5" role="radiogroup" aria-describedby={describedBy}>
      {codes.map((c) => {
        const id = `${groupId}-${c.code}`;
        return (
          <label key={c.code} htmlFor={id} className="flex cursor-pointer items-start gap-2 rounded p-1.5 text-sm hover:bg-slate-50">
            <input
              id={id}
              type="radio"
              name={groupId}
              className="mt-1 h-4 w-4 flex-shrink-0"
              // Codes are compared as STRINGS. A numeric value attribute would
              // turn "01" into "1" on the way back out of the DOM.
              value={c.code}
              checked={value?.code === c.code}
              onChange={() => onChange({ code: c.code })}
            />
            <span className="text-slate-700"><span className="font-mono font-semibold">{c.code}</span> — {c.label}</span>
          </label>
        );
      })}
    </div>
  );
}

function MatrixChoice({ groupId, definition, codes, value, onChange, describedBy }) {
  const { matrix } = definition;
  const byCell = new Map(codes.map((c) => [`${c.row_id}|${c.column_id}`, c]));
  return (
    // The grid scrolls inside its own container rather than widening the page.
    <div className="mt-2 overflow-x-auto">
      <table className="w-full min-w-[36rem] border-collapse text-sm" aria-describedby={describedBy}>
        <caption className="sr-only">{definition.prompt}</caption>
        <thead>
          <tr>
            <th scope="col" className="p-1.5 text-left text-xs font-semibold text-slate-600">{matrix.row_header}</th>
            {matrix.columns.map((col) => (
              <th key={col.column_id} scope="col" className="p-1.5 text-center text-xs font-semibold text-slate-600">
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.rows.map((row) => (
            <tr key={row.row_id} className="border-t border-slate-100">
              <th scope="row" className="p-1.5 text-left text-xs font-normal text-slate-700">{row.label}</th>
              {matrix.columns.map((col) => {
                const cell = byCell.get(`${row.row_id}|${col.column_id}`);
                if (!cell) return <td key={col.column_id} />;
                const id = `${groupId}-${cell.code}`;
                return (
                  <td key={col.column_id} className="p-1.5 text-center">
                    <label htmlFor={id} className="inline-flex cursor-pointer flex-col items-center gap-0.5">
                      <input
                        id={id}
                        type="radio"
                        name={groupId}
                        className="h-4 w-4"
                        value={cell.code}
                        checked={value?.code === cell.code}
                        onChange={() => onChange({ code: cell.code })}
                      />
                      <span className="font-mono text-xs text-slate-500">{cell.code}</span>
                      <span className="sr-only">{cell.label}</span>
                    </label>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MultiSelect({ groupId, codes, value, onChange, describedBy }) {
  const selected = Array.isArray(value?.codes) ? value.codes : [];
  const exclusive = codes.filter((c) => c.exclusive).map((c) => c.code);

  const toggle = (code) => {
    const isExclusive = exclusive.includes(code);
    if (selected.includes(code)) {
      onChange({ codes: selected.filter((c) => c !== code) });
      return;
    }
    // Selecting the mutually exclusive response clears the rest, and selecting
    // anything else clears it — enforced here as well as in the validator, so
    // the clinician sees the rule rather than hitting it on save.
    if (isExclusive) onChange({ codes: [code] });
    else onChange({ codes: [...selected.filter((c) => !exclusive.includes(c)), code] });
  };

  return (
    <div className="mt-2 space-y-1.5" role="group" aria-describedby={describedBy}>
      <p className="text-xs font-semibold text-slate-600">Check all that apply</p>
      {codes.map((c) => {
        const id = `${groupId}-${c.code}`;
        return (
          <label key={c.code} htmlFor={id} className="flex cursor-pointer items-start gap-2 rounded p-1.5 text-sm hover:bg-slate-50">
            <input
              id={id}
              type="checkbox"
              className="mt-1 h-4 w-4 flex-shrink-0"
              value={c.code}
              checked={selected.includes(c.code)}
              onChange={() => toggle(c.code)}
            />
            <span className="text-slate-700"><span className="font-mono font-semibold">{c.code}</span> — {c.label}</span>
          </label>
        );
      })}
      {exclusive.some((c) => selected.includes(c)) && (
        <p className="text-xs text-amber-700" role="status" aria-live="polite">
          This response cannot be combined with any other.
        </p>
      )}
    </div>
  );
}

function Grid({ groupId, definition, codes, value, onChange, describedBy }) {
  const rows = Array.isArray(value?.rows) ? value.rows : [];
  const codeFor = (rowId) => rows.find((r) => r.row_id === rowId)?.code;
  const setRow = (rowId, code) => {
    const next = rows.filter((r) => r.row_id !== rowId).concat([{ row_id: rowId, code }]);
    // Keep the published row order so a saved value reads like the instrument.
    next.sort((a, b) => definition.rows.findIndex((r) => r.row_id === a.row_id) - definition.rows.findIndex((r) => r.row_id === b.row_id));
    onChange({ rows: next });
  };
  const missing = definition.rows.filter((r) => !codeFor(r.row_id));

  return (
    <div className="mt-2 space-y-2" aria-describedby={describedBy}>
      <p className="text-xs font-semibold text-slate-600">Mark only one box in each row</p>
      {definition.rows.map((row) => {
        const name = `${groupId}-${row.row_id}`;
        return (
          <fieldset key={row.row_id} className="rounded border border-slate-100 p-2">
            <legend className="px-1 text-xs text-slate-700">{row.row_id}. {row.label}</legend>
            <div className="flex flex-wrap gap-3" role="radiogroup" aria-label={row.label}>
              {codes.map((c) => {
                const id = `${name}-${c.code}`;
                return (
                  <label key={c.code} htmlFor={id} className="flex cursor-pointer items-center gap-1.5 text-sm">
                    <input
                      id={id}
                      type="radio"
                      name={name}
                      className="h-4 w-4"
                      value={c.code}
                      checked={codeFor(row.row_id) === c.code}
                      onChange={() => setRow(row.row_id, c.code)}
                    />
                    <span className="text-slate-700"><span className="font-mono">{c.code}</span> {c.label}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        );
      })}
      {missing.length > 0 && (
        <p className="text-xs text-slate-500" role="status" aria-live="polite">
          {missing.length} row{missing.length > 1 ? "s" : ""} still to answer: {missing.map((r) => r.row_id).join(", ")}.
        </p>
      )}
    </div>
  );
}

/**
 * A saved LEGACY response, shown read-only with the label it was answered
 * under and a persistent warning. There is deliberately no edit, clone,
 * carry-forward, copy or convert affordance: none of those can be made safe,
 * because the code means something else on the official assessment.
 */
export function LegacyResponseNotice({ definitionId, storedValue }) {
  const def = v1Definition(definitionId);
  if (!def) return null;
  const option = def.options.find((o) => String(o.value) === String(storedValue));
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
      <p className="text-sm font-semibold text-slate-800">{def.label}</p>
      <p className="mt-1 text-sm text-slate-700">
        Recorded answer: <span className="font-medium">{option ? option.label : String(storedValue ?? "—")}</span>
      </p>
      <p className="mt-2 flex items-start gap-1.5 text-xs font-medium text-amber-900">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
        <span>{V1_LEGACY_WARNING}</span>
      </p>
    </div>
  );
}
