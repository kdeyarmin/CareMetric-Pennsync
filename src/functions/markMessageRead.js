import { base44 } from '@/api/base44Client';

export async function markMessageRead(id) {
  const response = await base44.functions.invoke('markMessageRead', { id });
  return response?.data ?? response;
}
