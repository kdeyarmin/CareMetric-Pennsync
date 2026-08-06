import { base44 } from '@/api/base44Client';

export const sendFax = async (payload = {}) => {
  const res = await base44.functions.invoke('sendFax', payload);
  const data = res?.data ?? res;
  if (data?.error) throw new Error(data.error);
  return data;
};
