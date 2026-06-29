import { base44 } from '@/api/base44Client';

export const processOASISBatch = (payload = {}) => base44.functions.invoke('processOASISBatch', payload);
