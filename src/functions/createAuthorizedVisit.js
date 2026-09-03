import { base44 } from '@/api/base44Client';

/**
 * Create a Visit through the tenant-authorizing backend broker.
 *
 * The optional client seam is used only by the one-release retired offline
 * queue, which already receives an injected Base44 functions client in tests.
 * All callers receive the canonical, server-stamped Visit row rather than the
 * Base44 function response envelope.
 */
export async function createAuthorizedVisit(payload, functions = null) {
  const response = functions
    ? await functions.invoke('createAuthorizedVisit', payload)
    : await base44.functions.invoke('createAuthorizedVisit', payload);
  const result = response?.data ?? response;
  if (!result?.visit?.id) {
    throw new Error(result?.error || 'Visit creation failed');
  }
  return result;
}
