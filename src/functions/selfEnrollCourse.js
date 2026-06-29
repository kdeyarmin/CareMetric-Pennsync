import { base44 } from '@/api/base44Client';

export const selfEnrollCourse = (payload = {}) => base44.functions.invoke('selfEnrollCourse', payload);
