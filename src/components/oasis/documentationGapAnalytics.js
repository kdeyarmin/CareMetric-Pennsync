// ADMIN-ONLY: documentation-gap patterns joined to closed-episode revenue.
//
// WHY THIS IS A SEPARATE MODULE FROM THE ENGINE
// `documentationGaps.js` has no concept of money and is what clinicians see.
// This module is where payment enters, and it is deliberately reachable only
// from an administrator surface (`canViewFinancials`) and only for CLOSED
// episodes.
//
// The closed-episode rule is the substantive constraint, not a technicality.
// "Across last quarter, ambulation was our most common note-versus-code
// mismatch, and those episodes grouped below cohort" is management information:
// it tells an administrator where documentation training is worth buying. "This
// open assessment would pay $340 more if M1860 were a 3" is a target attached
// to a specific patient and a specific nurse who is about to attest to it, and
// this module cannot produce that sentence because it will not accept an open
// episode.
//
// So there is no per-assessment uplift figure here, by construction. The output
// is counts, rates and cohort aggregates.
//
// Pure functions. No React, no SDK.

import { findDocumentationGaps, GAP_RULES, GAP_DIRECTIONS } from "./documentationGaps.js";

/** Statuses that mean the episode is finished and safe to analyse for revenue. */
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
 * @param {Array<{status?: string, episode_end?: string, documentation?: string, oasis?: object, clinician?: string, estimated_payment?: number, case_mix_weight?: number}>} episodes
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
      // Cohort, not individual: a per-nurse league table built from a revenue
      // view is how "documentation training" turns into pressure to code high.
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
      ? `${excludedOpen} episode(s) excluded: revenue analysis runs on closed episodes only.`
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
 * Case-mix and payment for the same CLOSED cohort, split by whether the episode
 * had an unresolved documentation gap.
 *
 * This is the honest form of "what do documentation gaps cost us": a cohort
 * comparison an administrator can act on by buying training. It deliberately
 * does NOT return a per-episode uplift, and it declines to report at all on a
 * cohort too small to mean anything.
 *
 * @param {Array} episodes closed episodes carrying `estimated_payment` / `case_mix_weight`
 */
export function compareCohortRevenue(episodes = []) {
  const withGaps = [];
  const withoutGaps = [];
  let excludedOpen = 0;

  for (const ep of Array.isArray(episodes) ? episodes : []) {
    if (!isClosedEpisode(ep)) { excludedOpen += 1; continue; }
    const gaps = findDocumentationGaps({ documentation: ep.documentation, oasis: ep.oasis });
    (gaps.length > 0 ? withGaps : withoutGaps).push(ep);
  }

  const mean = (rows, key) => {
    const vals = rows.map((r) => r[key]).filter((v) => typeof v === "number" && Number.isFinite(v));
    if (!vals.length) return null;
    return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
  };

  const reportable = withGaps.length >= MIN_COHORT_FOR_RATE && withoutGaps.length >= MIN_COHORT_FOR_RATE;
  return {
    episodes_excluded_open: excludedOpen,
    with_gaps: { count: withGaps.length, mean_payment: mean(withGaps, "estimated_payment"), mean_case_mix: mean(withGaps, "case_mix_weight") },
    without_gaps: { count: withoutGaps.length, mean_payment: mean(withoutGaps, "estimated_payment"), mean_case_mix: mean(withoutGaps, "case_mix_weight") },
    reportable,
    // Stated rather than implied. A difference between two self-selected
    // cohorts is not proof that closing the gaps would move the payment.
    caveat:
      "Cohort comparison on closed episodes. Episodes with documentation gaps differ from "
      + "those without in ways beyond the gap itself, so this shows where documentation is "
      + "weakest — not what recoding would earn. Nothing here is shown to clinical staff.",
    not_reportable_reason: reportable
      ? ""
      : `Cohort too small to report (need ${MIN_COHORT_FOR_RATE} closed episodes on each side).`,
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
      estimated_payment: u.estimated_payment,
      case_mix_weight: u.pdgm_data?.case_mix_weight,
    }));
}

/** Header shown above every admin revenue surface built from this module. */
export const ADMIN_REVENUE_NOTICE =
  "Administrator view. These figures are aggregate and retrospective, computed from closed "
  + "episodes. They are not shown to clinical staff, and no part of them reaches the "
  + "documentation-gap prompts clinicians see — those are triggered by the record, never by "
  + "payment.";
