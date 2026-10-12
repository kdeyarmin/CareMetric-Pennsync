/**
 * The same competency gate gradeTrainingAttempt enforces. An assignment value
 * may only make the gate stricter than the course: a higher pass mark, a lower
 * attempt cap, a longer cooldown.
 */
export function competencyGate({ assignment, course } = {}) {
  const courseRetake = (course && typeof course.retake_settings_json === 'object' && course.retake_settings_json) || {};
  const courseFloor = Number(course?.passing_score ?? courseRetake.passing_threshold) || 80;
  const passingScore = Math.max(courseFloor, Number(assignment?.passing_score_required) || 0);
  const attemptCaps = [assignment?.max_attempts, courseRetake.max_attempts]
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0);
  const maxAttempts = attemptCaps.length ? Math.min(...attemptCaps) : null;
  const waitHours = Math.max(
    Number(assignment?.waiting_period_hours) || 0,
    Number(courseRetake.waiting_period_hours) || 0,
  );
  return { passingScore, maxAttempts, waitHours };
}

/** Instant the server will accept another attempt, or 0 when there is no wait. */
export function retakeEligibleAt(waitHours, submittedAt) {
  const wait = Number(waitHours) || 0;
  if (wait <= 0) return 0;
  const submittedMs = submittedAt == null ? NaN : new Date(submittedAt).getTime();
  if (!Number.isFinite(submittedMs)) return null;
  return submittedMs + wait * 3_600_000;
}

/**
 * Whole hours until a failed attempt may be retaken. 0 means the button can
 * be offered; the grader still rejects a retry that arrives early.
 */
export function retakeWaitRemainingHours(waitHours, submittedAt, now = Date.now()) {
  const wait = Number(waitHours) || 0;
  if (wait <= 0) return 0;
  const eligibleAt = retakeEligibleAt(waitHours, submittedAt);
  if (eligibleAt == null) return Math.ceil(wait);
  const remaining = eligibleAt - now;
  if (remaining <= 0) return 0;
  return Math.ceil(remaining / 3_600_000);
}
