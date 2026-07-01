import { base44 } from '@/api/base44Client';

export const saveVisitPointConfig = (payload = {}) => base44.functions.invoke('saveVisitPointConfig', payload);
