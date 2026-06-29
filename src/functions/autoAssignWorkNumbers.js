import { base44 } from '@/api/base44Client';

export const autoAssignWorkNumbers = (payload = {}) => base44.functions.invoke('autoAssignWorkNumbers', payload);
