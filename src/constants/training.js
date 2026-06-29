/**
 * Training / learning constants.
 *
 * `DEFAULT_PASSING_SCORE` is the canonical pass mark (percent) used when a quiz
 * or in-service is not tied to a TrainingAssignment that carries its own
 * `passing_score_required`. Graded assignment flows (TrainingCoursePlayer,
 * MyAnnualEducationDashboard) should always prefer the assignment's
 * `passing_score_required`; the standalone practice quizzes use this default so
 * the same score never reads "passed" in one component and "failed" in another.
 */
export const DEFAULT_PASSING_SCORE = 80;
