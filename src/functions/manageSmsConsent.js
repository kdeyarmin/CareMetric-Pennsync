import { base44 } from '@/api/base44Client';

export const manageSmsConsent = (payload = {}) => base44.functions.invoke('manageSmsConsent', payload);
