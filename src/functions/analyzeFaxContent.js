import { base44 } from '@/api/base44Client';

export const analyzeFaxContent = (payload = {}) => base44.functions.invoke('analyzeFaxContent', payload);
