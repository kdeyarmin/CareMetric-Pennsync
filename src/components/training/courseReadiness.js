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

  // An AI draft whose stored outline promises more lessons than exist (or that
  // has no quiz yet) was interrupted mid-generation — the idempotent backend
  // phases can finish it without starting over.
  const outlineModules = Array.isArray(course?.ai_prompt_json?.outline_modules)
    ? course.ai_prompt_json.outline_modules
    : [];
  const presentIndexes = new Set(
    modules
      .map((module) => Number(module.order_index))
      .filter((index) => Number.isFinite(index))
  );
  const missingModuleIndexes = outlineModules
    .map((_, index) => index)
    .filter((index) => !presentIndexes.has(index));
  const aiResumable =
    course?.ai_generated === true &&
    course?.status === "draft" &&
    outlineModules.length > 0 &&
    (missingModuleIndexes.length > 0 || questionCount === 0);

  return {
    lessonCount,
    questionCount,
    videoRequested,
    completedVideoCount,
    processingVideoCount,
    videosReady,
    blockers,
    readyForReview: blockers.length === 0,
    outlineModuleCount: outlineModules.length,
    missingModuleIndexes,
    aiResumable,
  };
}
