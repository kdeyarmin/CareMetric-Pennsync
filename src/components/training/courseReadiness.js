export function getCourseReadiness(course, modules = [], questions = []) {
  const lessonCount = modules.length;
  const questionCount = questions.filter((question) => question.active !== false).length;
  const videoRequested = course?.ai_prompt_json?.generate_videos === true;
  const completedVideoCount = modules.filter((module) => module.video_status === "completed").length;
  const processingVideoCount = modules.filter((module) => module.video_status === "processing").length;
  const videosReady = lessonCount > 0 && completedVideoCount === lessonCount;
  const requiresCertificate = course?.ai_generated === true;

  const blockers = [];
  if (lessonCount === 0) blockers.push("Add at least one lesson.");
  if (questionCount === 0) blockers.push("Add end-of-course quiz questions.");
  if (requiresCertificate && course?.enable_certificate === false) {
    blockers.push("Enable a certificate for this AI-generated course.");
  }

  return {
    lessonCount,
    questionCount,
    videoRequested,
    completedVideoCount,
    processingVideoCount,
    videosReady,
    blockers,
    readyForReview: blockers.length === 0,
  };
}
