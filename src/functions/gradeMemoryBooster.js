import { base44 } from '@/api/base44Client';

// Server-side grading for memory-booster reviews. The booster renders the
// answer-free getCoursePlayerQuestions payload, so the correct answers (and the
// rationale) are only ever known to the backend; see the function of the same name.
export const gradeMemoryBooster = (payload = {}) => base44.functions.invoke('gradeMemoryBooster', payload);
