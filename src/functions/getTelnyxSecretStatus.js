import { base44 } from '@/api/base44Client';

export const getTelnyxSecretStatus = (payload = {}) => base44.functions.invoke('getTelnyxSecretStatus', payload);
