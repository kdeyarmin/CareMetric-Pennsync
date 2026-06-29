import { base44 } from '@/api/base44Client';

export const submitIncidentReport = (payload = {}) => base44.functions.invoke('submitIncidentReport', payload);
