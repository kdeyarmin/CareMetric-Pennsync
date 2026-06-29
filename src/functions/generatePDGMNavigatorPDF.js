import { base44 } from '@/api/base44Client';

export const generatePDGMNavigatorPDF = (payload = {}) => base44.functions.invoke('generatePDGMNavigatorPDF', payload);
