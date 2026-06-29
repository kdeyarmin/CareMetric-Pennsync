import { base44 } from '@/api/base44Client';

export const generateOASISReportPDF = (payload = {}) => base44.functions.invoke('generateOASISReportPDF', payload);
