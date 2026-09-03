import { base44 } from '@/api/base44Client';

export async function sendMessage(payload = {}) {
  const response = await base44.functions.invoke('sendMessage', payload);
  return response?.data ?? response;
}
