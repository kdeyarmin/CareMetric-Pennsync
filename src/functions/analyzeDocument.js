import { base44 } from '@/api/base44Client';

export const analyzeDocument = (payload = {}) => base44.functions.invoke('analyzeDocument', payload);
