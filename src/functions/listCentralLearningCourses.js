import { base44 } from '@/api/base44Client';

export const listCentralLearningCourses = (payload = {}) =>
  base44.functions.invoke('listCentralLearningCourses', payload);