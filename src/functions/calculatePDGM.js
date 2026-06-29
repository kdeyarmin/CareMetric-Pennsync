import { base44 } from '@/api/base44Client';

export const calculatePDGM = (payload = {}) => base44.functions.invoke('calculatePDGM', payload);
