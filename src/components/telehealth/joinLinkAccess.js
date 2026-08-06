// Staff-side access to the patient's telehealth invite link, now that the join
// token is stored hashed at rest (TelehealthSession.join_token_hash) instead of
// in plaintext inside invite_link.
//
// The raw link exists in exactly two places: the message sent to the patient,
// and this tab's in-memory cache (seeded at session creation, or by a mint).
// When neither is available — e.g. after a reload — an authorized staff member
// mints a fresh token via rotateTelehealthJoinToken. Rotation invalidates any
// previously issued token for the session, which is the intended trade: the
// link you are about to copy/text is the live capability.

import { rotateTelehealthJoinToken } from '@/functions/rotateTelehealthJoinToken';
import { hostedAbsoluteUrl } from '@/lib/assetPath';
import { ROUTER_PATHS } from '@/routes';
import { buildPatientJoinLink } from './telehealthUtils';

const linkCache = new Map(); // room_name -> raw patient invite link (this tab only)

/** Seed the cache with the link minted at session creation. */
export function rememberJoinLink(roomName, link) {
  if (roomName && link) linkCache.set(roomName, link);
}

/**
 * Resolve the patient invite link for a session: this tab's cached raw link,
 * the legacy plaintext invite_link (pre-hash sessions — don't rotate those, the
 * patient may already hold that exact link), or a freshly minted token.
 * @returns {Promise<string>}
 */
export async function getPatientJoinLink(session) {
  const cached = linkCache.get(session?.room_name);
  if (cached) return cached;
  if (session?.invite_link) return session.invite_link;
  let res;
  try {
    res = await rotateTelehealthJoinToken({ session_id: session?.id });
  } catch (err) {
    // The SDK throws on non-2xx; surface the backend's message (403/404/409).
    throw new Error(err?.response?.data?.error || err?.message || "Couldn't generate a join link", {
      cause: err,
    });
  }
  const token = res?.data?.token;
  if (!token) throw new Error(res?.data?.error || "Couldn't generate a join link");
  const link = buildPatientJoinLink(
    hostedAbsoluteUrl('/', { routerPaths: ROUTER_PATHS }),
    session.room_name,
    token,
  );
  rememberJoinLink(session.room_name, link);
  return link;
}
