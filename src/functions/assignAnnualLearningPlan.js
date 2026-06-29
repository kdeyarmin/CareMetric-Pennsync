import { base44 } from '@/api/base44Client';

export const assignAnnualLearningPlan = (payload = {}) => base44.functions.invoke('assignAnnualLearningPlan', payload);
