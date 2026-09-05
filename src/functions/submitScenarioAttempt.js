import { base44 } from '@/api/base44Client';

export const submitScenarioAttempt = (payload = {}) =>
  base44.functions.invoke('submitScenarioAttempt', payload);
