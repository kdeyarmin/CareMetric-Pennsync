import { base44 } from '@/api/base44Client';

export const testTelnyxConnection = (payload = {}) => base44.functions.invoke('testTelnyxConnection', payload);
