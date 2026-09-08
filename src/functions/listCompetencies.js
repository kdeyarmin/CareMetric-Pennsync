import { base44 } from '@/api/base44Client';

export const listCompetencies = (payload = {}) =>
  base44.functions.invoke('listCompetencies', payload);
