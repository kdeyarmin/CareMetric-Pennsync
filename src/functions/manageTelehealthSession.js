import { base44 } from '@/api/base44Client';

/**
 * Server-owned telehealth session broker. Every call names the caller's agency;
 * the backend authorizes it against the caller's exact active membership there.
 */
export const manageTelehealthSession = async (payload) =>
  (await base44.functions.invoke('manageTelehealthSession', payload)).data;
