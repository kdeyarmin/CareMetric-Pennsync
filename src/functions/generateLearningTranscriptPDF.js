import { base44 } from '@/api/base44Client';

export const generateLearningTranscriptPDF = (payload = {}) =>
  base44.functions.invoke('generateLearningTranscriptPDF', payload);
