import { base44 } from '@/api/base44Client';

// Answer-free course/quiz questions for the learner-facing player. The correct
// answers are never sent to the browser (grading is server-side); see the backend
// function of the same name.
export const getCoursePlayerQuestions = (payload = {}) =>
  base44.functions.invoke('getCoursePlayerQuestions', payload);
