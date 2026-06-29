import { base44 } from '@/api/base44Client';

export const analyzeNurseDeficits = (payload = {}) => base44.functions.invoke('analyzeNurseDeficits', payload);
