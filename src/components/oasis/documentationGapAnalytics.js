// ADMIN-ONLY: documentation-gap patterns across CLOSED episodes.
//
// WHY THIS IS A SEPARATE MODULE FROM THE ENGINE
// `documentationGaps.js` is what clinicians see, one assessment at a time. This
// module aggregates the same findings across finished episodes for an
// administrator surface, and it accepts CLOSED episodes only.
//
// The closed-episode rule is the substantive constraint, not a technicality.
// "Across last quarter, ambulation was our most common note-versus-code
// mismatch" is management information: it tells an administrator where
// documentation training is worth investing in. A per-assessment target aimed
// at a nurse who is about to attest to an open assessment is not, and this
// module cannot produce one because it will not accept an open episode.
//
// It carries no payment, case-mix or reimbursement dimension at all (the
// former cohort revenue comparison was removed with the PDGM payment
// features). The output is counts, rates and cohort aggregates.
//
// Pure functions. No React, no SDK.

import { findDocumentationGaps, GAP_RULES, GAP_DIRECTIONS } from "./documentationGaps.js";

/** Statuses that mean the episode is finished and safe to analyse. */
const CLOSED_STATUSES = Object.freeze(["completed", "submitted", "discharged", "closed"]);

/** Minimum cohort size before a rate is reported at all. */
export const MIN_COHORT_FOR_RATE = 10;

/**
 * Whether an episode is closed.
 *
 * Fail-closed: anything unrecognised is OPEN. An episode that merely looks
 * finished is not evidence that it is.
 */
export function isClosedEpisode(episode) {
  const status = String(episode?.status || "").trim().toLowerCase();
  if (!CLOSED_STATUSES.includes(status)) return false;
  // A discharge date in the future (or absent on a discharge-type record) means
  // the episode is still moving.
  const end = episode?.episode_end || episode?.discharge_date || episode?.completed_date;
  if (!end) return false;
  const t = Date.parse(String(end));
  if (!Number.isFinite(t)) return false;
  return t <= Date.now();
}

/**
 * Aggregate documentation gaps across CLOSED episodes.
 *
 * @param {Array<{status?: string, episode_end?: string, documentation?: string, oasis?: object, clinician?: string}>} episodes
 * @returns {object} counts by item and direction, plus what was refused and why
 */
export function aggregateDocumentationGaps(episodes = []) {
  const byItem = new Map();
  for (const rule of GAP_RULES) {
    byItem.set(rule.item, {
      item: rule.item,
      label: rule.label,
      dimension: rule.dimension,
      suggests_more_dependence: 0,
      suggests_less_dependence: 0,
      total: 0,
    });
  }

  let analysed = 0;
  let excludedOpen = 0;
  const byClinician = new Map();

  for (const ep of Array.isArray(episodes) ? episodes : []) {
    if (!isClosedEpisode(ep)) { excludedOpen += 1; continue; }
    analysed += 1;
    const gaps = findDocumentationGaps({ documentation: ep.documentation, oasis: ep.oasis });
    for (const g of gaps) {
      const row = byItem.get(g.item);
      if (!row) continue;
      row[g.direction] += 1;
      row.total += 1;
      // Cohort, not individual: a per-nurse league table is how
      // "documentation training" turns into pressure to code high.
      const cohort = ep.clinician_cohort || ep.discipline || "unattributed";
      const c = byClinician.get(cohort) || { cohort, suggests_more_dependence: 0, suggests_less_dependence: 0, total: 0 };
      c[g.direction] += 1;
      c.total += 1;
      byClinician.set(cohort, c);
    }
  }

  const items = [...byItem.values()].sort((a, b) => b.total - a.total);
  const totals = GAP_DIRECTIONS.reduce((acc, d) => {
    acc[d] = items.reduce((n, i) => n + i[d], 0);
    return acc;
  }, {});

  return {
    episodes_analysed: analysed,
    episodes_excluded_open: excludedOpen,
    excluded_reason: excludedOpen
      ? `${excludedOpen} episode(s) excluded: gap-pattern analysis runs on closed episodes only.`
      : "",
    items,
    by_cohort: [...byClinician.values()].sort((a, b) => b.total - a.total),
    totals,
    // The symmetry of the finding set, surfaced rather than buried. A ratio far
    // from 1 is worth knowing about: it may be a real documentation habit, or it
    // may mean the rules have drifted one-way and need re-reading.
    direction_balance: totals.suggests_less_dependence > 0
      ? Math.round((totals.suggests_more_dependence / totals.suggests_less_dependence) * 100) / 100
      : null,
    cohort_too_small: analysed < MIN_COHORT_FOR_RATE,
  };
}

/**
 * Convert finished OASISUpload records into episode-shaped rows.
 *
 * An upload is NOT an episode, and the two vocabularies do not overlap: uploads
 * are `uploaded | analyzed | reviewed | archived` and carry only
 * `assessment_date`, while `isClosedEpisode()` looks for `completed`/`discharged`
 * and an end date. Passing uploads straight in therefore classified every one of
 * them as open, and the admin panel reported zero analysed episodes forever.
 *
 * The conversion is explicit rather than implicit — widening `isClosedEpisode()`
 * to accept upload statuses would have quietly loosened what "closed" means for
 * every caller. Only `reviewed` and `archived` qualify: those are documents a
 * human has finished with. `uploaded` and `analyzed` are still in flight.
 *
 * @param {Array} uploads OASISUpload rows
 */
export function uploadsToClosedEpisodes(uploads = []) {
  const FINISHED = ["reviewed", "archived"];
  return (Array.isArray(uploads) ? uploads : [])
    .filter((u) => u && FINISHED.includes(String(u.status || "").trim().toLowerCase()))
    .filter((u) => u.assessment_date)
    .map((u) => ({
      status: "completed",
      // The assessment date is the closest thing an upload has to an episode
      // end. `isClosedEpisode` still rejects it if it is unparseable or future.
      episode_end: u.assessment_date,
      documentation: u.analysis_results?.summary || u.notes || "",
      oasis: u.extracted_data || u.pdgm_data || null,
      clinician_cohort: u.discipline || "unattributed",
    }));
}
