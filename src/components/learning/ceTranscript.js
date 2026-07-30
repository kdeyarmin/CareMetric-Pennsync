/**
 * Continuing-education ledger for the Learning Center, modeled on how commercial
 * healthcare LMS transcripts (Relias, Home Care Institute) present credit:
 * completions grouped by credit year, with CE credit and clock (in-service)
 * hours totalled per year rather than a single lifetime number.
 *
 * Two different hour measures are tracked because they answer different
 * questions:
 *
 *   - CE credit hours  — what the learner can claim for licensure/CEU purposes.
 *                        Source of truth is TrainingCertificate.hours, copied
 *                        from TrainingCourse.ceu_hours when the certificate is
 *                        issued.
 *   - Training hours   — clock time spent, which is what the CMS aide in-service
 *                        rule is measured in. Source of truth is the course's
 *                        estimated_minutes, falling back to CE hours when a
 *                        course has no duration recorded.
 *
 * A course earning 1.0 CEU may run 90 minutes, so summing CE hours toward an
 * hours-of-training requirement would understate it. Keeping them separate is
 * what lets the transcript show "8.5 of 12 in-service hours" honestly.
 *
 * Pure functions only — no React, no SDK — so this is unit-testable and can be
 * reused by report/PDF code.
 */

/**
 * The federal aide in-service requirement (42 CFR §484.80(d)): home health
 * aides must complete at least 12 hours of in-service training in each 12-month
 * period. Agencies track this per aide and surveyors ask for it by name, so it
 * is the one hour-based bar the transcript renders as progress.
 */
export const AIDE_IN_SERVICE_RULE = Object.freeze({
  hours: 12,
  citation: '42 CFR §484.80(d)',
  label: 'Aide in-service training',
  description:
    'Aides must complete at least 12 hours of in-service training during each 12-month period.',
});

// Titles subject to the aide in-service rule. Matched against the free-text
// role fields the app already uses for role targeting (job_title first, the
// same precedence as AssignmentWizard and CourseForm).
const AIDE_ROLE_PATTERN =
  /(home (?:health|care) aide|hospice aide|personal care aide|certified nursing assistant|nursing assistant|\bhha\b|\bcna\b|\bpca\b|\baide\b)/i;

/** Round to one decimal without accumulating floating-point drift. */
const round1 = (value) => Math.round(value * 10) / 10;

/**
 * The role requirement that applies to a user, or null when none does.
 * Only the aide in-service rule is federally hour-based; licensed disciplines
 * carry state CE requirements that vary too much to assert here.
 */
export function getInServiceRequirement(user) {
  const haystack = [user?.job_title, user?.credentials, user?.credential_type, user?.role]
    .filter(Boolean)
    .join(' ');
  return AIDE_ROLE_PATTERN.test(haystack) ? AIDE_IN_SERVICE_RULE : null;
}

/**
 * The credit year a certificate falls in — the completion date when recorded,
 * otherwise the issue date.
 *
 * The year is read from the leading YYYY of an ISO string rather than through
 * `Date`, so a certificate always lands in the same credit year for every
 * viewer regardless of their timezone (a late-December completion must not slide
 * into the next year for a reader further west).
 */
export function creditYear(certificate) {
  const value = certificate?.completion_date || certificate?.issued_at;
  if (!value) return null;
  const iso = /^(\d{4})-\d{2}/.exec(String(value));
  if (iso) return Number(iso[1]);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getFullYear();
}

/**
 * Drop revoked and undated certificates, then keep one credit-earning record
 * per assignment (or per course within a credit year when an older certificate
 * carries no assignment id). A retake that issues a second certificate must not
 * award the hours twice, while a genuine annual renewal in a later year still
 * counts again.
 */
export function dedupeCreditRecords(certificates = []) {
  const seen = new Set();
  const kept = [];
  for (const certificate of certificates) {
    if (!certificate || certificate.revoked === true) continue;
    const year = creditYear(certificate);
    if (year === null) continue;
    const key = certificate.assignment_id
      ? `assignment:${certificate.assignment_id}`
      : `course:${certificate.course_id || certificate.course_title || certificate.id}:${year}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push({ certificate, year });
  }
  return kept;
}

/**
 * Build the full transcript summary.
 *
 * @param {object[]} certificates - the learner's TrainingCertificate records.
 * @param {object} [options]
 * @param {Record<string, object>} [options.coursesById] - published courses, for
 *   duration/category metadata the certificate doesn't carry.
 * @param {object} [options.user] - used to resolve the applicable hour requirement.
 * @param {Date} [options.now] - current date (injectable for tests).
 * @returns {{
 *   years: {year: number, ceHours: number, trainingHours: number, courseCount: number,
 *           byCategory: {category: string, hours: number}[]}[],
 *   currentYear: object|null,
 *   totalCeHours: number,
 *   totalTrainingHours: number,
 *   requirement: object|null,
 *   progress: {requiredHours: number, completedHours: number, remainingHours: number,
 *              percent: number, met: boolean}|null,
 * }}
 */
export function buildCeTranscript(certificates = [], { coursesById = {}, user = null, now = new Date() } = {}) {
  const byYear = new Map();

  for (const { certificate, year } of dedupeCreditRecords(certificates)) {
    const course = coursesById[certificate.course_id] || null;
    const ceHours = Number(certificate.hours) || Number(course?.ceu_hours) || 0;
    const minutes = Number(course?.estimated_minutes) || 0;
    const trainingHours = minutes > 0 ? minutes / 60 : ceHours;
    const category = certificate.training_category || course?.category || 'general';

    const bucket = byYear.get(year) || { year, ceHours: 0, trainingHours: 0, courseCount: 0, categories: new Map() };
    bucket.ceHours += ceHours;
    bucket.trainingHours += trainingHours;
    bucket.courseCount += 1;
    if (trainingHours > 0) {
      bucket.categories.set(category, (bucket.categories.get(category) || 0) + trainingHours);
    }
    byYear.set(year, bucket);
  }

  const years = [...byYear.values()]
    .sort((a, b) => b.year - a.year)
    .map((bucket) => ({
      year: bucket.year,
      ceHours: round1(bucket.ceHours),
      trainingHours: round1(bucket.trainingHours),
      courseCount: bucket.courseCount,
      byCategory: [...bucket.categories.entries()]
        .map(([category, hours]) => ({ category, hours: round1(hours) }))
        .sort((a, b) => b.hours - a.hours || a.category.localeCompare(b.category)),
    }));

  const thisYear = now.getFullYear();
  const currentYear = years.find((entry) => entry.year === thisYear) || null;
  const requirement = getInServiceRequirement(user);

  return {
    years,
    currentYear,
    totalCeHours: round1(years.reduce((sum, entry) => sum + entry.ceHours, 0)),
    totalTrainingHours: round1(years.reduce((sum, entry) => sum + entry.trainingHours, 0)),
    requirement,
    progress: requirement
      ? inServiceProgress(requirement, currentYear ? currentYear.trainingHours : 0)
      : null,
  };
}

/** Progress toward an hours-based requirement, capped at 100%. */
export function inServiceProgress(requirement, completedHours = 0) {
  const requiredHours = Number(requirement?.hours) || 0;
  const completed = round1(Math.max(Number(completedHours) || 0, 0));
  if (requiredHours <= 0) {
    return { requiredHours: 0, completedHours: completed, remainingHours: 0, percent: 100, met: true };
  }
  return {
    requiredHours,
    completedHours: completed,
    remainingHours: round1(Math.max(requiredHours - completed, 0)),
    percent: Math.min(Math.round((completed / requiredHours) * 100), 100),
    met: completed >= requiredHours,
  };
}
