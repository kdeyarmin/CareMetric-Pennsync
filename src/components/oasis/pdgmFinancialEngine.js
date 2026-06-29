/**
 * pdgmFinancialEngine — pure (no React, no I/O) configuration logic for the PDGM
 * navigator's cost analysis.
 *
 * AutomatedPDGMNavigator is an LLM-driven orchestrator: the case-mix / functional
 * / comorbidity math lives in the model prompts, not in the component. The only
 * genuinely pure, reusable, testable piece is the agency-cost configuration
 * fallback, so that lives here (mirroring the oasisScoringEngine.js pattern of a
 * tested sibling module) rather than being inlined in the render.
 */

/** CMS-agnostic default agency cost assumptions used when no AgencySettings row
 *  exists yet. Pure data — safe to import anywhere. */
export const DEFAULT_AGENCY_COSTS = {
  avg_staff_hourly_rate: 45,
  training_cost_per_hour: 35,
  documentation_time_per_episode: 0.5,
  audit_staff_hourly_rate: 50,
  avg_episodes_per_year: 50,
  wage_index: 1.0,
};

/**
 * Resolve effective agency costs: the fetched AgencySettings row wins; otherwise
 * fall back to defaults. Deterministic — a nullish/absent settings row yields the
 * defaults so downstream cost math never reads undefined.
 *
 * @param {object|null|undefined} fetchedSettings AgencySettings row (or null)
 * @param {object} [defaults] fallback (DEFAULT_AGENCY_COSTS)
 * @returns {object} the effective cost config
 */
export function resolveAgencyCosts(fetchedSettings, defaults = DEFAULT_AGENCY_COSTS) {
  return fetchedSettings || defaults;
}
