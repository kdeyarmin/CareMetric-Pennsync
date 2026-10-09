import { base44 } from '@/api/base44Client';

/**
 * The OASIS Center's record broker. Every OASIS record the center shares across
 * a care team or an agency — saved analyses, extraction reviews, supervisor
 * sign-off, the audit queue, automation rules and runs, OASIS-derived tasks,
 * match feedback, the pathway library and the compliance report — goes through
 * it. The server decides the caller's scope from the protected admin role, the
 * caller's own AgencyMembership and the care-team table; nothing sent from here
 * widens it.
 *
 * Resolves with the broker's JSON body and rejects with the server's message,
 * so a caller's catch can show what the broker actually refused.
 */
export async function manageOASISRecords(action, payload = {}) {
  try {
    const response = await base44.functions.invoke('manageOASISRecords', { ...payload, action });
    return response?.data ?? response;
  } catch (error) {
    const message = error?.response?.data?.error || error?.message || 'The OASIS request failed';
    const wrapped = new Error(message, { cause: error });
    wrapped.status = error?.response?.status ?? error?.status ?? null;
    throw wrapped;
  }
}

/** A stable per-browser key for one logical write, so a retry dedupes. */
export function oasisClientKey(...parts) {
  const text = parts.map((part) => String(part ?? '')).join('|');
  // FNV-1a, 32-bit, twice with different offsets: short, stable, and well under
  // the broker's identifier limit. Not a security boundary — the broker scopes
  // every key to the caller's own user id.
  const hash = (offset) => {
    let h = offset >>> 0;
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  };
  return `k${hash(0x811c9dc5)}${hash(0x01234567)}`;
}
