import { base44 } from '@/api/base44Client';

export const rotateTelehealthJoinToken = (payload = {}) => base44.functions.invoke('rotateTelehealthJoinToken', payload);
