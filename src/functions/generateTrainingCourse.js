import { base44 } from '@/api/base44Client';

// Raw single-phase invoke. The backend is phased (outline / module / assessment /
// finalize) because a full course generation cannot fit in one function
// invocation window — use generateTrainingCourseStepwise below, which drives
// the phases in order.
export const generateTrainingCourse = (payload = {}) => base44.functions.invoke('generateTrainingCourse', payload);

const phaseErrorMessage = (err) =>
  err?.response?.data?.error || err?.data?.error || err?.message || 'Course generation failed.';

// Run one phase, retrying once on transient failures (network drop or 5xx —
// e.g. the LLM flaked). Semantic 4xx errors are not retried. Backend phases
// are idempotent, so a retry after an ambiguous failure cannot duplicate content.
const runPhase = async (payload) => {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await generateTrainingCourse(payload);
      const data = response?.data || response;
      if (data?.error) throw new Error(data.error);
      return data;
    } catch (err) {
      lastErr = err;
      const status = err?.response?.status;
      if (status && status < 500) break;
    }
  }
  const wrapped = new Error(phaseErrorMessage(lastErr));
  wrapped.cause = lastErr;
  wrapped.response = lastErr?.response;
  throw wrapped;
};

/**
 * Generate a complete AI training course by orchestrating the backend phases:
 * outline → one call per module → assessment → finalize. Each backend call
 * makes at most one bounded LLM call, so no request outlives the platform's
 * function execution window (the cause of the old "500 after a long spinner").
 *
 * @param {object} params - generation parameters (topic, audience_roles, ...).
 * @param {(progress: {step: number, totalSteps: number, label: string}) => void} [onProgress]
 * @returns finalize result: { course_id, title, status, video_generation_status, ... }
 * @throws Error with `.course_id` set when a draft was already created, so the
 *         caller can point the admin at the partial draft.
 */
export async function generateTrainingCourseStepwise(params = {}, onProgress) {
  onProgress?.({ step: 1, totalSteps: 4, label: 'Designing the course outline…' });
  const outline = await runPhase({ ...params, phase: 'outline' });

  const moduleCount = outline.module_count || 1;
  const totalSteps = moduleCount + 3;
  const courseId = outline.course_id;

  const withCourseId = (err) => {
    err.course_id = courseId;
    err.course_title = outline.title;
    return err;
  };

  try {
    for (let i = 0; i < moduleCount; i++) {
      onProgress?.({
        step: i + 2,
        totalSteps,
        label: moduleCount > 1 ? `Writing lesson ${i + 1} of ${moduleCount}…` : 'Writing the lesson content…',
      });
      await runPhase({ phase: 'module', course_id: courseId, module_index: i });
    }

    onProgress?.({ step: moduleCount + 2, totalSteps, label: 'Building the quiz and knowledge checks…' });
    await runPhase({ phase: 'assessment', course_id: courseId });

    onProgress?.({ step: moduleCount + 3, totalSteps, label: 'Finishing up…' });
    return await runPhase({
      phase: 'finalize',
      course_id: courseId,
      generate_videos: !!params.generate_videos,
      video_avatar_id: params.video_avatar_id || '',
      video_voice_id: params.video_voice_id || '',
    });
  } catch (err) {
    throw withCourseId(err);
  }
}

/**
 * Finish an AI course generation that was interrupted mid-run (e.g. a module
 * or assessment phase failed after the draft was created). Re-runs only the
 * missing phases against the params stored in the course's ai_prompt_json —
 * the backend phases are idempotent, so this cannot duplicate content.
 *
 * @param {object} course - the partial TrainingCourse record (needs id, title, ai_prompt_json).
 * @param {{ missingModuleIndexes?: number[], regenerateAssessment?: boolean }} plan
 * @param {(progress: {step: number, totalSteps: number, label: string}) => void} [onProgress]
 * @returns finalize result: { course_id, title, status, video_generation_status, ... }
 */
export async function resumeTrainingCourseStepwise(course, plan = {}, onProgress) {
  const { missingModuleIndexes = [], regenerateAssessment = false } = plan;
  const params = course?.ai_prompt_json || {};
  const courseId = course?.id;
  if (!courseId) throw new Error('This course cannot be resumed.');

  const totalSteps = missingModuleIndexes.length + (regenerateAssessment ? 1 : 0) + 1;
  let step = 0;

  try {
    for (const moduleIndex of missingModuleIndexes) {
      step += 1;
      onProgress?.({ step, totalSteps, label: `Writing lesson ${moduleIndex + 1}…` });
      await runPhase({ phase: 'module', course_id: courseId, module_index: moduleIndex });
    }

    if (regenerateAssessment) {
      step += 1;
      onProgress?.({ step, totalSteps, label: 'Building the quiz and knowledge checks…' });
      await runPhase({ phase: 'assessment', course_id: courseId });
    }

    step += 1;
    onProgress?.({ step, totalSteps, label: 'Finishing up…' });
    return await runPhase({
      phase: 'finalize',
      course_id: courseId,
      generate_videos: !!params.generate_videos,
      video_avatar_id: params.video_avatar_id || '',
      video_voice_id: params.video_voice_id || '',
    });
  } catch (err) {
    err.course_id = courseId;
    err.course_title = course?.title;
    throw err;
  }
}
