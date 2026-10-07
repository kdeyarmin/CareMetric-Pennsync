import { base44 } from '@/api/base44Client';

export const manageTelehealthSession = async (payload) =>
  (await base44.functions.invoke('manageTelehealthSession', payload)).data;