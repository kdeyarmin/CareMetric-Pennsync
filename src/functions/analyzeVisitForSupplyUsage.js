import { base44 } from '@/api/base44Client';

export const analyzeVisitForSupplyUsage = (payload = {}) => base44.functions.invoke('analyzeVisitForSupplyUsage', payload);
