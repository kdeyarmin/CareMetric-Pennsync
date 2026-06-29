import { base44 } from '@/api/base44Client';

export const getCommsDashboard = (payload = {}) => base44.functions.invoke('getCommsDashboard', payload);
