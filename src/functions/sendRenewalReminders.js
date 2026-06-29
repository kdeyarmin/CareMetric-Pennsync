import { base44 } from '@/api/base44Client';

export const sendRenewalReminders = (payload = {}) =>
  base44.functions.invoke('sendRenewalReminders', payload);
