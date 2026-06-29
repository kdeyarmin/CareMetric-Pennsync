import { base44 } from '@/api/base44Client';

export const generateTrainingCertificate = (payload = {}) => base44.functions.invoke('generateTrainingCertificate', payload);
