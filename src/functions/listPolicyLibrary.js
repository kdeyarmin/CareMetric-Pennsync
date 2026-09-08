import { base44 } from '@/api/base44Client';

export const listPolicyLibrary = (payload = {}) =>
  base44.functions.invoke('listPolicyLibrary', payload);
