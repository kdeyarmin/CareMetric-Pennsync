import { base44 } from '@/api/base44Client';

export async function manageVehicleMaintenance(action, payload = {}) {
  try {
    const result = await base44.functions.invoke('manageVehicleMaintenance', { ...payload, action });
    if (result?.data?.success !== true) {
      throw new Error(result?.data?.error || 'Vehicle Maintenance returned an incomplete response.');
    }
    return result.data;
  } catch (error) {
    const detail = error?.response?.data?.error;
    if (typeof detail === 'string') throw new Error(detail.slice(0, 600));
    throw error;
  }
}

export function vehicleRequestId() {
  if (!globalThis.crypto?.randomUUID) throw new Error('Use an up-to-date secure browser to save a vehicle record.');
  return globalThis.crypto.randomUUID();
}
