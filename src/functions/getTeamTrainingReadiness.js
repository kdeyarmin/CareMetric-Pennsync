import { base44 } from '@/api/base44Client';

export const getTeamTrainingReadiness = (payload = {}) =>
  base44.functions.invoke('getTeamTrainingReadiness', payload);
