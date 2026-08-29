// Payer reimbursement table — import, matching, and episode estimation.
//
// The agency's PAYER RATE table (PayerRateConfig.payers) carries the agency's
// own contracted numbers: episodic rates, per-visit rates by discipline, and
// the visit counts each payer typically authorizes. NOTHING here is shipped or
// guessed — an admin imports the table (CSV) on the PDGM Rate Settings page,
// and the clinical-manager referral brief reads it to estimate the episode
// reimbursement for the referral's payer.
//
// Division of labor with the PDGM engine: Medicare FFS (and any payer marked
// payment_model "pdgm") is priced by the canonical backend `calculatePDGM`;
// this module estimates ONLY episodic / per-visit contract payers, so the two
// models never produce competing figures for the same payer.
//
// Pure + offline (unit-tested with `node --test`); no React, no Base44 SDK.

import { parseCsvRows } from "./caseMixWeightsLoader.js";

export const PAYER_TYPES = ["medicare_ffs", "medicare_advantage", "medicaid", "commercial", "other"];
export const PAYMENT_MODELS = ["episodic", "per_visit", "pdgm"];
export const PAYER_DISCIPLINES = ["SN", "PT", "OT", "ST", "MSW", "HHA"];

const posNum = (v) => {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

// ---------------------------------------------------------------------------
// CSV import
// ---------------------------------------------------------------------------

// Canonical column keys and the header spellings that map onto them.
// Headers are normalized (lowercase, alphanumeric) before lookup.
const HEADER_ALIASES = {
  payer_name: ["payername", "payer", "plan", "planname", "name", "insurance"],
  payer_type: ["payertype", "type", "coveragetype", "payerfamily"],
  payment_model: ["paymentmodel", "model", "paymenttype", "methodology"],
  episode_rate: ["episoderate", "episodicrate", "epirate", "episodepayment", "caserate"],
  episode_length_days: ["episodelengthdays", "episodedays", "episodelength", "perioddays"],
  auth_required: ["authrequired", "priorauth", "authorizationrequired", "requiresauth"],
  match_terms: ["matchterms", "keywords", "aliases", "matchkeywords"],
  notes: ["notes", "comments", "note"],
};
for (const d of PAYER_DISCIPLINES) {
  const dl = d.toLowerCase();
  HEADER_ALIASES[`per_visit_${dl}`] = [
    `pervisit${dl}`, `${dl}rate`, `${dl}pervisit`, `rate${dl}`, `visitrate${dl}`, `${dl}visitrate`,
  ];
  HEADER_ALIASES[`approved_${dl}`] = [
    `approved${dl}`, `${dl}approved`, `${dl}visits`, `authorized${dl}`, `auth${dl}`, `${dl}authvisits`, `approvedvisits${dl}`,
  ];
}

const normHeader = (h) => String(h ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Resolve a raw CSV header to its canonical key, or null when unrecognized. */
export function resolveHeader(raw) {
  const n = normHeader(raw);
  if (!n) return null;
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    if (n === normHeader(key) || aliases.includes(n)) return key;
  }
  return null;
}

function normalizePayerType(raw) {
  const v = String(raw ?? "").toLowerCase().replace(/[^a-z]/g, "_");
  if (PAYER_TYPES.includes(v)) return v;
  if (/advantage|part_?c|ma_?plan/.test(v)) return "medicare_advantage";
  if (/medicare/.test(v)) return "medicare_ffs";
  if (/medicaid|medical_assistance/.test(v)) return "medicaid";
  if (/commercial|private/.test(v)) return "commercial";
  return v ? "other" : null;
}

function normalizePaymentModel(raw) {
  const v = String(raw ?? "").toLowerCase().replace(/[^a-z]/g, "_");
  if (PAYMENT_MODELS.includes(v)) return v;
  if (/episod|case_?rate|flat/.test(v)) return "episodic";
  if (/visit|ffs|fee/.test(v)) return "per_visit";
  if (/pdgm|medicare_?pps|prospective/.test(v)) return "pdgm";
  return null;
}

/** Template CSV an admin can download, fill, and re-import. */
export function payerRatesCsvTemplate() {
  const headers = [
    "payer_name", "payer_type", "payment_model", "episode_rate", "episode_length_days",
    ...PAYER_DISCIPLINES.map((d) => `per_visit_${d.toLowerCase()}`),
    ...PAYER_DISCIPLINES.map((d) => `approved_${d.toLowerCase()}`),
    "auth_required", "match_terms", "notes",
  ];
  const examples = [
    ["Medicare (traditional)", "medicare_ffs", "pdgm", "", "30", "", "", "", "", "", "", "", "", "", "", "", "", "false", "medicare", "Priced by PDGM - no contract row needed"],
    ["Aetna Medicare Advantage", "medicare_advantage", "per_visit", "", "60", "165", "160", "160", "165", "140", "60", "10", "8", "4", "4", "2", "6", "true", "aetna", "Initial auth typically 10 SN / 8 PT"],
    ["Keystone First (Medicaid)", "medicaid", "per_visit", "", "60", "110", "105", "105", "110", "95", "45", "12", "6", "4", "2", "1", "8", "true", "keystone; medical assistance", ""],
    ["Highmark Commercial", "commercial", "episodic", "2400", "60", "", "", "", "", "", "", "8", "6", "4", "2", "1", "4", "true", "highmark; bcbs", ""],
  ];
  return [headers.join(","), ...examples.map((r) => r.join(","))].join("\n");
}

/**
 * Parse a payer-rates CSV into PayerRateConfig.payers rows.
 * Never guesses: unusable rows/values are reported in `errors`/`warnings`,
 * and a file with no usable rows returns ok:false.
 *
 * @param {string} csvText
 * @returns {{ ok: boolean, payers: Array, errors: string[], warnings: string[] }}
 */
export function parsePayerRatesCsv(csvText) {
  const errors = [];
  const warnings = [];
  let rows;
  try {
    rows = parseCsvRows(String(csvText ?? ""));
  } catch (err) {
    return { ok: false, payers: [], errors: [err.message || "Unparseable CSV"], warnings };
  }
  if (!rows || rows.length < 2) {
    return { ok: false, payers: [], errors: ["CSV needs a header row and at least one payer row."], warnings };
  }

  const header = rows[0].map(resolveHeader);
  if (!header.includes("payer_name")) {
    return {
      ok: false,
      payers: [],
      errors: ["No payer_name column found. Download the template for the expected columns."],
      warnings,
    };
  }
  rows[0].forEach((raw, i) => {
    if (String(raw ?? "").trim() && header[i] === null) {
      warnings.push(`Ignored unrecognized column "${raw}".`);
    }
  });

  const payers = [];
  const seen = new Set();
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    if (cells.every((c) => String(c ?? "").trim() === "")) continue; // blank line
    const rec = {};
    header.forEach((key, i) => {
      if (key) rec[key] = cells[i];
    });

    const rowNo = r + 1;
    const name = String(rec.payer_name ?? "").trim();
    if (!name) {
      errors.push(`Row ${rowNo}: missing payer_name — row skipped.`);
      continue;
    }
    const dedupeKey = name.toLowerCase();
    if (seen.has(dedupeKey)) {
      warnings.push(`Row ${rowNo}: duplicate payer "${name}" — later row skipped.`);
      continue;
    }
    seen.add(dedupeKey);

    const payerType = normalizePayerType(rec.payer_type);
    if (rec.payer_type && !payerType) warnings.push(`Row ${rowNo}: unrecognized payer_type "${rec.payer_type}" — stored as "other".`);
    const paymentModel = normalizePaymentModel(rec.payment_model);
    if (rec.payment_model && !paymentModel) warnings.push(`Row ${rowNo}: unrecognized payment_model "${rec.payment_model}" — stored as "per_visit".`);

    const perVisit = {};
    const approved = {};
    for (const d of PAYER_DISCIPLINES) {
      const dl = d.toLowerCase();
      const rate = posNum(rec[`per_visit_${dl}`]);
      if (rate !== null) perVisit[d] = rate;
      else if (String(rec[`per_visit_${dl}`] ?? "").trim()) warnings.push(`Row ${rowNo}: invalid per-visit ${d} rate "${rec[`per_visit_${dl}`]}" — ignored.`);
      const visits = posNum(rec[`approved_${dl}`]);
      if (visits !== null) approved[d] = Math.round(visits);
      else if (String(rec[`approved_${dl}`] ?? "").trim()) warnings.push(`Row ${rowNo}: invalid approved ${d} visits "${rec[`approved_${dl}`]}" — ignored.`);
    }

    const episodeRate = posNum(rec.episode_rate);
    if (String(rec.episode_rate ?? "").trim() && episodeRate === null) {
      warnings.push(`Row ${rowNo}: invalid episode_rate "${rec.episode_rate}" — ignored.`);
    }
    const model = paymentModel || "per_visit";
    if (model === "episodic" && episodeRate === null) {
      errors.push(`Row ${rowNo} (${name}): payment_model is episodic but episode_rate is missing — row skipped.`);
      seen.delete(dedupeKey);
      continue;
    }
    if (model === "per_visit" && Object.keys(perVisit).length === 0) {
      warnings.push(`Row ${rowNo} (${name}): per_visit model with no per-visit rates — reimbursement cannot be estimated until rates are added.`);
    }

    const episodeLength = posNum(rec.episode_length_days);
    const authRaw = String(rec.auth_required ?? "").trim().toLowerCase();
    payers.push({
      payer_name: name,
      payer_type: payerType || "other",
      payment_model: model,
      ...(episodeRate !== null ? { episode_rate: episodeRate } : {}),
      ...(episodeLength !== null ? { episode_length_days: episodeLength } : {}),
      per_visit_rates: perVisit,
      approved_visits: approved,
      auth_required: authRaw === "" ? true : !["false", "no", "0", "n"].includes(authRaw),
      match_terms: String(rec.match_terms ?? "")
        .split(/[;|]/)
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
      notes: String(rec.notes ?? "").trim(),
    });
  }

  if (payers.length === 0) {
    errors.push("No usable payer rows found.");
    return { ok: false, payers: [], errors, warnings };
  }
  return { ok: true, payers, errors, warnings };
}

// ---------------------------------------------------------------------------
// Matching a referral's payer to a configured row
// ---------------------------------------------------------------------------

/**
 * Find the configured payer row for a referral's insurance text + classified
 * payer type. When the payer classification is known, ONLY rows of that
 * payer_type are candidates ("never guesses across types" — a generic term
 * like "medicare" on the Medicare FFS row must not capture "Aetna Medicare
 * Advantage PPO"); within the candidates the LONGEST matching term wins, then
 * payer-name substring, then the sole row of the classified type. An
 * unclassified payer may match any row (still longest-term-first).
 *
 * @param {string} insuranceText the referral's insurance_primary text
 * @param {string} payerType classifyPayer() result ('medicare_ffs', …)
 * @param {Array} payers PayerRateConfig.payers
 * @returns {{ row: object|null, matchedBy: 'match_terms'|'payer_name'|'payer_type'|null }}
 */
export function matchPayerRow(insuranceText, payerType, payers) {
  const rows = Array.isArray(payers) ? payers : [];
  const text = String(insuranceText ?? "").toLowerCase();
  const classified = payerType && payerType !== "unknown";
  const pool = classified ? rows.filter((r) => r?.payer_type === payerType) : rows;

  if (text) {
    let best = null; // most specific (longest) matching term wins, not CSV order
    for (const row of pool) {
      for (const t of row?.match_terms || []) {
        const term = String(t ?? "").toLowerCase();
        if (term && text.includes(term) && (!best || term.length > best.term.length)) {
          best = { row, term };
        }
      }
    }
    if (best) return { row: best.row, matchedBy: "match_terms" };
    for (const row of pool) {
      const name = String(row?.payer_name ?? "").toLowerCase();
      if (name && (text.includes(name) || name.includes(text))) {
        return { row, matchedBy: "payer_name" };
      }
    }
  }
  if (classified && pool.length === 1) return { row: pool[0], matchedBy: "payer_type" };
  return { row: null, matchedBy: null };
}

// ---------------------------------------------------------------------------
// Episode reimbursement estimate for contract payers
// ---------------------------------------------------------------------------

/**
 * Planned visits per discipline for the 60-day episode, from a
 * visitPlanEstimator buildVisitPlan result (ordered frequencies preferred; AI
 * estimates as the labeled fallback). Returns {} when neither exists.
 */
export function plannedVisitsByDiscipline(visitPlan) {
  const out = {};
  if (visitPlan?.periods?.byDiscipline) {
    for (const [d, v] of Object.entries(visitPlan.periods.byDiscipline)) {
      const total = Number(v?.total);
      if (Number.isFinite(total) && total > 0 && PAYER_DISCIPLINES.includes(d)) out[d] = total;
    }
    // Total-only orders ("PT eval + 6 visits") have no weekly structure so
    // they sit outside byDiscipline's period math — but the visit COUNT is
    // known and must still be priced/costed for the episode.
    for (const order of visitPlan.periods.totalOnly || []) {
      const t = Number(order?.totalVisits);
      if (Number.isFinite(t) && t > 0 && PAYER_DISCIPLINES.includes(order?.discipline)) {
        out[order.discipline] = (out[order.discipline] || 0) + t;
      }
    }
    return out;
  }
  const ai = visitPlan?.aiEstimates;
  if (ai) {
    const sn = (ai.nursingFirst30 ?? 0) + (ai.nursingDays31to60 ?? 0);
    if (sn > 0) out.SN = sn;
    for (const [d, key] of [["PT", "pt"], ["OT", "ot"], ["ST", "st"], ["MSW", "msw"], ["HHA", "aide"]]) {
      if (ai[key] != null && ai[key] > 0) out[d] = ai[key];
    }
  }
  return out;
}

/**
 * Estimate the episode MARGIN: revenue minus the agency's own per-discipline
 * visit costs (PayerRateConfig.visit_costs) × the planned visits. Costs the
 * agency hasn't entered are reported as uncosted, never guessed — and a
 * margin with uncosted disciplines is labeled a floor on cost (so a ceiling
 * on margin).
 *
 * @param {object} params
 * @param {number|null} params.revenue episode revenue estimate in dollars
 * @param {Record<string, number>} params.plannedVisits per-discipline planned visits
 * @param {Record<string, number>} params.visitCosts per-discipline cost per visit
 * @returns {{ estimable:boolean, totalCost:number|null, margin:number|null,
 *   marginPct:number|null, byDiscipline:Array, uncosted:string[], notes:string[] }}
 */
export function estimateEpisodeMargin({ revenue = null, plannedVisits = {}, visitCosts = {} } = {}) {
  const notes = [];
  const byDiscipline = [];
  const uncosted = [];
  let totalCost = 0;
  let costedAny = false;
  for (const d of PAYER_DISCIPLINES) {
    const visits = Number(plannedVisits?.[d]);
    if (!Number.isFinite(visits) || visits <= 0) continue;
    const cost = Number(visitCosts?.[d]);
    if (Number.isFinite(cost) && cost >= 0) {
      const subtotal = Math.round(cost * visits * 100) / 100;
      byDiscipline.push({ discipline: d, visits, costPerVisit: cost, subtotal });
      totalCost += subtotal;
      costedAny = true;
    } else {
      byDiscipline.push({ discipline: d, visits, costPerVisit: null, subtotal: null });
      uncosted.push(d);
    }
  }
  if (!costedAny) {
    return {
      estimable: false, totalCost: null, margin: null, marginPct: null, byDiscipline, uncosted,
      notes: [byDiscipline.length === 0
        ? "No planned visits to cost yet."
        : "No per-visit costs entered — add them in Admin → PDGM Rate Settings → Payer Reimbursement Table to see episode margin."],
    };
  }
  if (uncosted.length > 0) {
    notes.push(`No cost entered for ${uncosted.join(", ")} — the cost total is a floor (margin shown is a ceiling).`);
  }
  totalCost = Math.round(totalCost * 100) / 100;
  const margin = Number.isFinite(revenue) ? Math.round((revenue - totalCost) * 100) / 100 : null;
  const marginPct = margin !== null && revenue > 0 ? Math.round((margin / revenue) * 1000) / 10 : null;
  if (margin === null) notes.push("No revenue estimate available — showing visit cost only.");
  return { estimable: true, totalCost, margin, marginPct, byDiscipline, uncosted, notes };
}

/**
 * Estimate the episode reimbursement for a CONTRACT payer row (episodic or
 * per-visit). PDGM-model payers return estimable:false — calculatePDGM is the
 * only pricing source for those (see the module header).
 *
 * @returns {{
 *   estimable: boolean, model: string|null, amount: number|null,
 *   basis: string|null, perVisitBreakdown: Array, authComparison: Array,
 *   notes: string[],
 * }}
 */
export function estimatePayerEpisode(payerRow, visitPlan) {
  const notes = [];
  if (!payerRow) {
    return { estimable: false, model: null, amount: null, basis: null, perVisitBreakdown: [], authComparison: [], notes: ["No payer rate row configured for this payer — import the payer table in Admin → PDGM Rate Settings."] };
  }
  const model = payerRow.payment_model || "per_visit";
  const planned = plannedVisitsByDiscipline(visitPlan);
  const approved = payerRow.approved_visits || {};

  // Planned-vs-authorized comparison applies to every model.
  const authComparison = PAYER_DISCIPLINES
    .filter((d) => planned[d] != null || approved[d] != null)
    .map((d) => ({
      discipline: d,
      planned: planned[d] ?? 0,
      approved: approved[d] ?? null,
      over: approved[d] != null && (planned[d] ?? 0) > approved[d],
    }));
  for (const c of authComparison) {
    if (c.over) {
      notes.push(`${c.discipline}: planned ${c.planned} visits exceeds the typically-authorized ${c.approved} — request additional authorization before scheduling beyond it.`);
    }
  }

  if (model === "pdgm") {
    return { estimable: false, model, amount: null, basis: null, perVisitBreakdown: [], authComparison, notes: [...notes, "PDGM-model payer — the reimbursement estimate comes from the PDGM calculation, not the contract table."] };
  }

  if (model === "episodic") {
    const amount = Number.isFinite(payerRow.episode_rate) ? payerRow.episode_rate : null;
    if (amount === null) notes.push("Episodic payer with no episode_rate configured — add it to the payer table.");
    return {
      estimable: amount !== null,
      model,
      amount,
      basis: amount !== null ? `Contracted episodic rate${payerRow.episode_length_days ? ` per ${payerRow.episode_length_days}-day episode` : ""}` : null,
      perVisitBreakdown: [],
      authComparison,
      notes,
    };
  }

  // per_visit: rate × planned visits per discipline; disciplines without a
  // configured rate are reported, never guessed.
  const rates = payerRow.per_visit_rates || {};
  const perVisitBreakdown = [];
  let amount = 0;
  let priced = 0;
  for (const d of PAYER_DISCIPLINES) {
    const visits = planned[d];
    if (!visits) continue;
    const rate = rates[d];
    if (Number.isFinite(rate)) {
      const subtotal = Math.round(rate * visits * 100) / 100;
      perVisitBreakdown.push({ discipline: d, visits, rate, subtotal });
      amount += subtotal;
      priced += 1;
    } else {
      perVisitBreakdown.push({ discipline: d, visits, rate: null, subtotal: null });
      notes.push(`No contracted ${d} per-visit rate configured — ${d} visits are excluded from the estimate.`);
    }
  }
  if (Object.keys(planned).length === 0) {
    notes.push("No planned visits to price yet — the estimate needs ordered frequencies or the AI visit estimate.");
  }
  const estimable = priced > 0;
  return {
    estimable,
    model,
    amount: estimable ? Math.round(amount * 100) / 100 : null,
    basis: estimable ? "Contracted per-visit rates × planned visits (60-day episode)" : null,
    perVisitBreakdown,
    authComparison,
    notes,
  };
}
