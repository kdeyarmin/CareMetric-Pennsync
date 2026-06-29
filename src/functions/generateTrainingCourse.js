import { base44 } from '@/api/base44Client';

export const generateTrainingCourse = (payload = {}) => base44.functions.invoke('generateTrainingCourse', payload);
