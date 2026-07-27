// ADR packet-review post-processor — turns the AI verification pass
// (adrAnalysis.js PACKET_VERIFICATION_SCHEMA output) into the deterministic
// artifacts the rest of the feature consumes:
//
//   - normalized per-item results (statuses coerced, page numbers clamped to
//     the real packet page count, issues sanitized)
//   - the follow-up list: everything still missing or defective, with the CMS
//     citation, so staff know exactly what to chase before submitting
//   - an honest readiness verdict: a packet missing a condition-of-payment
//     document is NOT ready, no matter how much else is present
//   - the table-of-contents plan and key-page plan the generateAdrPacket
//     backend function renders (packet-relative page numbers; the function
//     adds the front-matter offset)
//
// The AI's findings are treated as untrusted input: this module never widens a
// claim ("found" without pages downgrades to "partial") and never invents one.
// Pure + offline (unit-tested with `node --test`); no React, no SDK, no `@/`
// imports.

const STATUSES = ["found", "partial", "missing", "not_applicable"];
const SEVERITIES = ["critical", "high", "medium"];

const asStatus = (s) => (STATUSES.includes(s) ? s : "missing");

/**
 * "not_applicable" is honored ONLY for conditional CMS-baseline items (e.g.
 * recertification on an initial episode, therapy reassessments when no therapy
 * was billed). Always-required conditions of payment and anything the letter
 * explicitly requested can never be N/A — the contractor asked for it.
 */
const canBeNotApplicable = (check) => check.source === "cms_baseline" && check.when !== "always";
const asSeverity = (s, fallback = "medium") => (SEVERITIES.includes(s) ? s : fallback);

/** Clamp AI-reported page numbers to real, unique, sorted 1-based pages. */
export function sanitizePages(pages, pageCount) {
  if (!Array.isArray(pages) || !Number.isInteger(pageCount) || pageCount < 1) return [];
  const clean = pages
    .map((p) => Number(p))
    .filter((p) => Number.isInteger(p) && p >= 1 && p <= pageCount);
  return [...new Set(clean)].sort((a, b) => a - b);
}

/**
 * Merge the checklist with the AI verification into normalized item results.
 * Checklist order is preserved; a checklist item the AI failed to report on
 * comes back as "missing" with a not-reviewed note (fail closed, never assume
 * presence). AI entries for unknown ids are ignored.
 *
 * @param {{ checklist: Array<object>, verification: object, pageCount: number }} opts
 * @returns {object} summary — see fields below
 */
export function summarizePacketVerification({ checklist = [], verification = {}, pageCount = 0 } = {}) {
  const byId = new Map();
  for (const entry of Array.isArray(verification.items) ? verification.items : []) {
    if (entry && typeof entry.id === "string" && !byId.has(entry.id)) byId.set(entry.id, entry);
  }

  const items = checklist.map((check) => {
    const reported = byId.get(check.id);
    const pages = sanitizePages(reported?.pages, pageCount);
    let status = asStatus(reported?.status);
    // Never widen an AI claim: "found" with no verifiable page reference is at
    // best partial — the reviewer could not be pointed at the evidence.
    if (status === "found" && pages.length === 0) status = "partial";
    const issues = (Array.isArray(reported?.issues) ? reported.issues : [])
      .filter((i) => i && typeof i.problem === "string" && i.problem.trim())
      .map((i) => ({
        severity: asSeverity(i.severity),
        problem: i.problem.trim(),
        page: sanitizePages([i.page], pageCount)[0] ?? null,
      }));
    // Fail closed on an out-of-bounds N/A claim: always-required and
    // letter-requested items cannot be waived by the AI.
    if (status === "not_applicable" && !canBeNotApplicable(check)) {
      status = "missing";
      issues.push({
        severity: asSeverity(check.severity, "high"),
        problem:
          "The automated review marked this not applicable, but it is always required (or was explicitly requested by the letter) — locate the document or confirm the gap.",
        page: null,
      });
    }
    if (!reported) {
      issues.push({
        severity: asSeverity(check.severity, "high"),
        problem: "Not addressed by the automated review — verify manually before submitting.",
        page: null,
      });
    }
    return {
      id: check.id,
      seq: check.seq,
      title: check.title,
      category: check.category,
      severity: check.severity,
      citation: check.citation,
      source: check.source,
      when: check.when,
      status,
      pages,
      evidence: typeof reported?.evidence === "string" ? reported.evidence.trim() : "",
      na_reason:
        status === "not_applicable" && typeof reported?.na_reason === "string" ? reported.na_reason.trim() : "",
      issues,
      reviewer_note: typeof reported?.reviewer_note === "string" ? reported.reviewer_note.trim() : "",
      reviewed: Boolean(reported),
    };
  });

  // A "missing" verdict has no evidence pages by definition — AI-supplied page
  // numbers on a missing item would print a TOC page reference and a red
  // KEY ITEM frame pointing the Medicare reviewer at evidence the
  // verification itself says is absent.
  for (const it of items) {
    if (it.status === "missing" && it.pages.length) it.pages = [];
  }

  const missing = items.filter((it) => it.status === "missing");
  const partial = items.filter((it) => it.status === "partial");
  const notApplicable = items.filter((it) => it.status === "not_applicable");
  const found = items.filter((it) => it.status === "found");

  const followUps = [];
  for (const it of items) {
    if (it.status === "missing") {
      followUps.push({
        id: `${it.id}_missing_${it.seq}`,
        item_id: it.id,
        severity: it.severity,
        title: it.title,
        action: `Obtain and add: ${it.title}`,
        why: it.reviewed
          ? "Not found anywhere in the uploaded packet."
          : "The automated review did not cover this item — locate it or confirm it is present.",
        citation: it.citation,
      });
    }
    for (const issue of it.issues) {
      // The synthetic not-reviewed issue is already covered by the missing entry.
      if (!it.reviewed && it.status === "missing" && issue.problem.startsWith("Not addressed")) continue;
      followUps.push({
        id: `${it.id}_issue_${followUps.length}`,
        item_id: it.id,
        severity: issue.severity,
        title: it.title,
        action: `Fix before submitting: ${issue.problem}`,
        why: issue.page ? `Observed on packet page ${issue.page}.` : "Observed during the packet review.",
        citation: it.citation,
      });
    }
  }
  const sevRank = { critical: 0, high: 1, medium: 2 };
  followUps.sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || a.title.localeCompare(b.title));

  // Readiness: missing/defective conditions of payment block submission-ready
  // status outright; everything else degrades the score.
  const blocking = [];
  for (const it of items) {
    // A document the contractor requested BY NAME in the letter also blocks
    // when missing, whatever its severity — omitting it invites denial even
    // if it isn't a condition of payment.
    const letterRequested = it.source && it.source !== "cms_baseline";
    if (it.severity !== "critical") {
      if (letterRequested && it.status === "missing") {
        blocking.push({ id: it.id, title: it.title, reason: "missing_letter_item", citation: it.citation });
      }
      continue;
    }
    if (it.status === "missing") blocking.push({ id: it.id, title: it.title, reason: "missing", citation: it.citation });
    else if (it.status === "partial") blocking.push({ id: it.id, title: it.title, reason: "incomplete", citation: it.citation });
    else if (it.issues.some((i) => i.severity === "critical")) {
      blocking.push({ id: it.id, title: it.title, reason: "critical_issue", citation: it.citation });
    }
  }

  let score = 100;
  for (const it of items) {
    if (it.status === "not_applicable") continue; // waived conditional item — no penalty
    const weight = it.severity === "critical" ? 25 : it.severity === "high" ? 12 : 5;
    if (it.status === "missing") score -= weight;
    else if (it.status === "partial") score -= Math.ceil(weight / 2);
    for (const issue of it.issues) {
      // Synthetic issues (not-reviewed, or an N/A claim fail-closed to missing)
      // are already priced via the status deduction above.
      if (!it.reviewed || issue.problem.startsWith("The automated review marked this not applicable")) continue;
      score -= issue.severity === "critical" ? 10 : issue.severity === "high" ? 5 : 2;
    }
  }
  score = Math.max(0, Math.min(100, score));
  const level = blocking.length > 0 ? "not_ready" : followUps.length > 0 ? "needs_attention" : "ready";

  // TOC plan: packet-relative start pages for everything locatable, in packet
  // order (missing items are listed last so the reviewer sees the gap).
  const located = items
    .filter((it) => it.pages.length > 0)
    .sort((a, b) => a.pages[0] - b.pages[0] || a.seq - b.seq);
  const unlocated = items.filter((it) => it.pages.length === 0);
  const toc = [
    ...located.map((it) => ({
      item_id: it.id,
      title: it.title,
      citation: it.citation,
      status: it.status,
      severity: it.severity,
      packet_page: it.pages[0],
    })),
    ...unlocated.map((it) => ({
      item_id: it.id,
      title: it.title,
      citation: it.citation,
      status: it.status,
      severity: it.severity,
      packet_page: null,
    })),
  ];

  // Key pages: where critical/high evidence starts — the generator draws the
  // red attention frame + label on these so the reviewer lands on them fast.
  const keyByPage = new Map();
  for (const it of located) {
    if (it.severity === "medium" || it.status === "not_applicable") continue;
    const page = it.pages[0];
    if (!keyByPage.has(page)) keyByPage.set(page, []);
    keyByPage.get(page).push(`${it.title} — ${it.citation}`);
  }
  const keyPages = [...keyByPage.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([packet_page, labels]) => ({ packet_page, labels }));

  return {
    items,
    missing_count: missing.length,
    partial_count: partial.length,
    found_count: found.length,
    na_count: notApplicable.length,
    follow_ups: followUps,
    readiness: { score, level, blocking },
    toc,
    key_pages: keyPages,
    overall_observations: (Array.isArray(verification.overall_observations)
      ? verification.overall_observations
      : []
    ).filter((o) => typeof o === "string" && o.trim()),
    unreadable_pages: sanitizePages(verification.unreadable_pages, pageCount),
    page_count: Number.isInteger(pageCount) && pageCount > 0 ? pageCount : 0,
    ai_confidence: typeof verification.confidence === "number"
      ? Math.max(0, Math.min(100, verification.confidence))
      : null,
  };
}

/**
 * Shape the summary for persistence on AdrAuditCase.verification_summary —
 * strips nothing today but is the single seam if the entity shape diverges.
 */
export function toPersistedVerification(summary) {
  return {
    page_count: summary.page_count,
    found_count: summary.found_count,
    partial_count: summary.partial_count,
    missing_count: summary.missing_count,
    na_count: summary.na_count,
    readiness: summary.readiness,
    items: summary.items,
    follow_ups: summary.follow_ups,
    toc: summary.toc,
    key_pages: summary.key_pages,
    overall_observations: summary.overall_observations,
    unreadable_pages: summary.unreadable_pages,
    ai_confidence: summary.ai_confidence,
  };
}
