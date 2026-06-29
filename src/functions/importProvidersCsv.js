import { base44 } from '@/api/base44Client';

export const importProvidersCsv = (payload = {}) => base44.functions.invoke('importProvidersCsv', payload);
