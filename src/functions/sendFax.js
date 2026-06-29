import { base44 } from '@/api/base44Client';

export const sendFax = (payload = {}) => base44.functions.invoke('sendFax', payload);
