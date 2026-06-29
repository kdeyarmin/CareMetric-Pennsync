import { base44 } from '@/api/base44Client';

export const gradeTrainingAttempt = (payload = {}) => base44.functions.invoke('gradeTrainingAttempt', payload);
