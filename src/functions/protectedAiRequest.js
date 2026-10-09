import { base44 } from '@/api/base44Client';
import { withTimeout } from '@/lib/aiCall';

export default async function protectedAiRequest(name, payload, timeoutMs = 300000) {
  try {
    return await withTimeout(base44.functions.invoke(name, payload).then(response => response.data), timeoutMs);
  } catch (error) {
    // An unsuccessful response may follow a billed invocation. Do not replay it.
    error.retryable = false;
    throw error;
  }
}