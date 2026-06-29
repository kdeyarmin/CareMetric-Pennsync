import { base44 } from '@/api/base44Client';

export const generateUserManual = (payload = {}) => base44.functions.invoke('generateUserManual', payload);
