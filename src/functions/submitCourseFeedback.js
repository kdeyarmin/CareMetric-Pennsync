import { base44 } from '@/api/base44Client';

export const submitCourseFeedback = (payload = {}) =>
  base44.functions.invoke('submitCourseFeedback', payload);
