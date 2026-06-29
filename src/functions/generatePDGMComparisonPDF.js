import { base44 } from '@/api/base44Client';

export const generatePDGMComparisonPDF = (payload = {}) => base44.functions.invoke('generatePDGMComparisonPDF', payload);
