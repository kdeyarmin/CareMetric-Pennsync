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
