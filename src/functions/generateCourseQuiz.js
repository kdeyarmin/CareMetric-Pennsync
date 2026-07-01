import { base44 } from '@/api/base44Client';

export const generateCourseQuiz = (payload = {}) => base44.functions.invoke('generateCourseQuiz', payload);
