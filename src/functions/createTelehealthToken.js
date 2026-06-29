import { base44 } from '@/api/base44Client';

export const createTelehealthToken = (payload = {}) => base44.functions.invoke('createTelehealthToken', payload);
