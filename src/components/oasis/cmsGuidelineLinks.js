// Curated CMS reference links for the Comprehensive OASIS Review.
//
// The review LLM is asked to cite CMS regulations and returns a guideline URL
// with each finding. Those AI-supplied URLs are unreliable — safe-looking links
// routinely 404 or point at the wrong regulation. A citation like
// "42 CFR 484.55" is deterministic, though: the official eCFR section URL can
// be built from the citation itself. This module prefers that derived official
// link, falls back to the AI link only when it is at least scheme-safe, and
// finally falls back to a topic-level official page so a real citation is never
// rendered linkless.
//
// Pure (aside from isSafeExternalUrl's use of window.location for relative
// URLs) and unit-tested in cmsGuidelineLinks.spec.js.

import { isSafeExternalUrl } from "@/components/utils/security";

// Official topic pages (stable CMS.gov landing pages, not deep links).
export const HH_QUALITY_REPORTING_URL =
  "https://www.cms.gov/medicare/quality/home-health";
export const OASIS_DATA_SETS_URL =
  "https://www.cms.gov/medicare/quality/home-health/oasis-data-sets";
export const HH_COPS_PART_484_URL =
  "https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-484";

/**
 * Derive the official eCFR URL from a "42 CFR 484.55"-style citation found in
 * free text. Returns null when the text carries no parseable CFR citation.
 * Handles optional "§"/"section", part-only citations ("42 CFR Part 484"), and
 * ignores any subsection suffix ("484.55(b)(2)" → section 484.55).
 */
export function ecfrUrlFromCitation(text) {
  const raw = String(text || "");
  const section = raw.match(/42\s*C\.?F\.?R\.?\s*(?:§+\s*|section\s+)?(\d{3})\.(\d+)/i);
  if (section) {
    return `https://www.ecfr.gov/current/title-42/section-${section[1]}.${section[2]}`;
  }
  const part = raw.match(/42\s*C\.?F\.?R\.?\s*(?:§+\s*)?part\s+(\d{3})/i);
  if (part) {
    // Part-level link. Part 484 (the home health CoPs) has a canonical deep
    // path; other parts use eCFR's part search-by-citation form.
    if (part[1] === "484") return HH_COPS_PART_484_URL;
    return `https://www.ecfr.gov/current/title-42/part-${part[1]}`;
  }
  return null;
}

/**
 * Resolve the best reference link for an AI review finding.
 *
 * Precedence:
 *   1. Official eCFR link derived from the CFR citation in `regulationText`.
 *   2. The AI-supplied link, when scheme-safe.
 *   3. A curated official topic page matched from `regulationText`
 *      (OASIS guidance / quality reporting / home health CoPs).
 *   4. null — render no link.
 *
 * @param {string} regulationText  The finding's cited regulation/topic text.
 * @param {string} aiLink          The LLM-supplied URL for the finding.
 * @returns {string|null}
 */
export function resolveCmsGuidelineLink(regulationText, aiLink) {
  const official = ecfrUrlFromCitation(regulationText);
  if (official) return official;
  // The AI link must be an ABSOLUTE web URL: isSafeExternalUrl alone treats any
  // bare string as a safe site-relative path, which for an AI-invented "CMS
  // guideline" would link into this SPA instead of an external reference.
  const aiHref = String(aiLink || "");
  if (/^https?:\/\//i.test(aiHref) && isSafeExternalUrl(aiHref)) return aiHref;
  const topic = String(regulationText || "");
  // Acronyms are matched as whole words: an unanchored "CoP" also matches
  // COPD — one of the most common home health diagnoses — and "scope", which
  // routed ordinary clinical text to the Conditions of Participation link.
  if (/oasis/i.test(topic)) return OASIS_DATA_SETS_URL;
  if (/quality|star\s*rating|\bqrp\b/i.test(topic)) return HH_QUALITY_REPORTING_URL;
  if (/conditions?\s+of\s+participation|\bCoPs?\b/i.test(topic)) return HH_COPS_PART_484_URL;
  return null;
}
