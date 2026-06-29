import { base44 } from '@/api/base44Client';

export const generateFaxCoverPage = (payload = {}) => base44.functions.invoke('generateFaxCoverPage', payload);
