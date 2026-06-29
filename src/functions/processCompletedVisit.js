import { base44 } from '@/api/base44Client';

export const processCompletedVisit = (payload = {}) => base44.functions.invoke('processCompletedVisit', payload);
