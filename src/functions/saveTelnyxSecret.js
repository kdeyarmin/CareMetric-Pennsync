import { base44 } from '@/api/base44Client';

export const saveTelnyxSecret = (payload = {}) => base44.functions.invoke('saveTelnyxSecret', payload);
