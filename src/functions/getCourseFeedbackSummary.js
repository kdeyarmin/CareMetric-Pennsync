import { base44 } from '@/api/base44Client';

export const getCourseFeedbackSummary = (payload = {}) =>
  base44.functions.invoke('getCourseFeedbackSummary', payload);
