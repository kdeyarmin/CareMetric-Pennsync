import { base44 } from '@/api/base44Client';

export const testAutomations = (payload = {}) => base44.functions.invoke('testAutomations', payload);
