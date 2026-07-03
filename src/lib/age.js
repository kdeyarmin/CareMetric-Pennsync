import { calculateAge, formatAge as formatLocalAge } from "./dateLocal.js";

/**
 * Backwards-compatible age helper for callers that expect NaN on invalid DOBs.
 * The canonical date parsing and completed-year math live in dateLocal.js.
 */
export function computeAge(dob, now = new Date()) {
  const age = calculateAge(dob, now);
  return age == null ? NaN : age;
}

export function formatAge(dob, now = new Date(), fallback = "Unknown") {
  return formatLocalAge(dob, now, fallback);
}
