import { base44 } from '@/api/base44Client';

export const submitSignerSignature = (payload = {}) => base44.functions.invoke('submitSignerSignature', payload);
