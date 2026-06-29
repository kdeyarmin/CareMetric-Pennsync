import { base44 } from '@/api/base44Client';

export const startTrainingAssignment = (payload = {}) => base44.functions.invoke('startTrainingAssignment', payload);
