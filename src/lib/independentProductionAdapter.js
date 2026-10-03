import {
  createProductionAuthorityClient, PORTED_FUNCTIONS, validateProductionDeployment,
} from '../../services/authority-client/client.mjs';
import {
  CONTEXT_KEYS, MEMBERSHIP_KEYS, exact, failWith, refusingNamespace, routedEntities, pick,
} from './ownedBackendSeam.js';
import { createOwnedSessionPort, storedOwnedSessionEmail } from './ownedBackendSessionStore.js';

/**
 * The production mode: the app's own sign-in, against a real Supabase project
 * and the owned business API, for real staff.
 *
 * This is the mode `docs/RAILWAY_GO_LIVE_PLAN_2026-09-21.md` names in Stage J
 * ("the independent adapter becomes the default under
 * `VITE_PENNSYNC_BACKEND=independent`") and that the build rejected until now:
 * `readIndependentStagingConfig` accepted exactly `base44` and
 * `independent-staging`, so the value the plan's own exit criterion depends on
 * failed configuration. Without it the hosting move cannot complete, because the
 * app's sign-in is still `base44.auth.redirectToLogin` to a Base44-hosted page
 * and our own host answering `/login` with the app shell would break it.
 *
 * What this is NOT. It is not the staging mode with the pins taken out: the
 * synthetic workflows (the `staging_*` referral actions, the synthetic patient
 * roster, the projection that refuses a name not beginning `Synthetic `) are
 * absent here rather than widened, and staging keeps every one of them exactly
 * as it had them. And it is not Stage J: an entity call reaches the owned store
 * only where `independentEntityRoutes.js` DECLARES a route onto a ported
 * handler, and everything undeclared refuses by name, which is the same seam
 * staging has and the thing Stage J adopts one call site at a time.
 *
 * Nothing in this module is reachable unless a build sets the mode, and the
 * default is still `base44`.
 */

/** Production's published refusal code, distinct from staging's by design. */
const UNAVAILABLE = 'PENNSYNC_OPERATION_UNAVAILABLE';
const fail = (code, status = 403) => failWith(code, status);

/**
 * The build's own configuration, read rather than pinned.
 *
 * `readIndependentStagingConfig` pins the app id in code and enumerates two
 * project pairs, because staging is one reviewed environment. A production
 * deployment's app id, project and service origin are properties OF THE
 * DEPLOYMENT, so they arrive as build configuration and are checked for shape
 * and for agreement with each other — the project origin has to be derivable
 * from the project reference, and the staging app and store are refused by
 * name so a build cannot select production mode and then stand on synthetic
 * rows.
 *
 * It fails closed: anything missing or malformed throws here, before a Base44
 * client could be constructed, exactly as the staging reader does.
 */
export function readIndependentProductionConfig(env = {}) {
  if (env.VITE_PENNSYNC_BACKEND !== 'independent') return null;
  const target = {
    appId: env.VITE_PENNSYNC_APP_ID,
    projectRef: env.VITE_PENNSYNC_PROJECT_REF,
    projectUrl: env.VITE_PENNSYNC_PROJECT_URL,
    publishableKey: env.VITE_PENNSYNC_PUBLISHABLE_KEY,
    // Required here, unlike staging, where it is optional because an unset
    // value simply leaves every ported name refusing. A production build with
    // no business API has no backend at all.
    apiUrl: env.VITE_PENNSYNC_API_URL,
  };
  // Construction performs no I/O; this is the configuration check, run at module
  // load so a misconfigured build is refused rather than discovered at sign-in.
  return Object.freeze({ target: validateProductionDeployment(target) });
}

/**
 * Finite adaptation of existing app contracts; never a generic SDK or entity
 * proxy. The surface mirrors the staging adapter's so `base44Client.js`,
 * `AuthContext` and `SignInScreen` hold one shape rather than two.
 */
/**
 * The device half of staying signed in, injectable so a test supplies its own.
 *
 * `email` answers whose session this device holds and never the credential; the
 * token reaches the authority client through a port bound to that address, so no
 * code in this module ever holds it.
 */
const DEVICE = Object.freeze({ email: storedOwnedSessionEmail, port: createOwnedSessionPort });

export function createIndependentProductionAdapter(config,
  { fetchImpl = globalThis.fetch, boundTenant = () => null, device = DEVICE } = {}) {
  let client = null;
  let generation = 0;
  let signedIn = false;
  // Keyed by address so a retry of a known late cleanup failure can still reach
  // the instance that holds the credential, which is the reason the staging
  // adapter retains its four. Production sees one address per person, so this
  // grows only when somebody signs in as somebody else in the same document —
  // and that is precisely the case whose old session must still be revocable.
  const clients = new Map();
  const current = lease => { if (lease !== generation) fail('STALE_AUTHORITY_SESSION', 401); };
  const rpc = async (name, input) => {
    const active = client, lease = generation;
    if (!active || !signedIn) fail('AUTHENTICATION_REQUIRED', 401);
    const result = await active.rpc(name, input);
    current(lease);
    return result;
  };
  /**
   * End the session. `forget` false closes the realm and leaves the device able
   * to resume, which is what the app's own realm expiry means; the default
   * forgets, because that is what a person signing out means.
   */
  const signOut = async ({ forget = true } = {}) => {
    generation++; signedIn = false;
    client = null;
    await Promise.all([...clients.values()].map(value => value.signOut({ forget })));
  };
  /** Construct, or reuse, the client for one address with its device port. */
  const clientFor = address => {
    const next = clients.get(address)
      ?? createProductionAuthorityClient({ ...config.target, email: address },
        { fetchImpl, sessionStore: device.port(address) });
    clients.set(address, next);
    return next;
  };
  const me = async () => {
    const result = await rpc('memberships', {});
    // The legacy principal the rest of the app is bound to, never the native
    // UUID, which stays private to this adapter.
    return { id: result.user_id, email: result.user_email };
  };
  /**
   * The acting tenant, and the one place production differs from staging in what
   * it will accept.
   *
   * Staging refuses a call that names no agency, because a staging caller is
   * always driving a scripted flow that knows its tenant. A production boot does
   * not: the first thing the app does after sign-in is ask which agencies this
   * person holds, and only then resolve one. So `agency_id` is required here
   * too — `getMyTenantContext` cannot be answered without it — and the
   * memberships listing, which precedes any tenant, is the authority store's own
   * RPC rather than a business-API call, because that service requires an
   * agency on every request by design.
   */
  const getContext = async (payload = {}) => {
    if (!payload.agency_id || Object.keys(payload).some(key =>
      !['agency_id', 'expected_membership_id', 'expected_membership_version'].includes(key))) {
      fail('PENNSYNC_TENANT_SELECTION_REQUIRED');
    }
    const result = await rpc('context', { p_agency_id: payload.agency_id });
    if ((payload.expected_membership_id !== undefined || payload.expected_membership_version !== undefined)
      && (payload.expected_membership_id !== result.membership_id
        || payload.expected_membership_version !== result.membership_version)) {
      fail('PENNSYNC_MEMBERSHIP_CHANGED');
    }
    return { data: { tenant_context: pick(result, CONTEXT_KEYS) } };
  };
  const memberships = async () => {
    const result = await rpc('memberships', {});
    return { data: {
      subject: { user_id: result.user_id, user_email: result.user_email, is_platform_owner: false },
      memberships: result.memberships.map(value => pick(value, MEMBERSHIP_KEYS)),
    } };
  };
  /**
   * A ported handler as this caller.
   *
   * The tenant fence is the staging adapter's, for the reason recorded there:
   * the ported service requires a current agency membership where its Base44
   * original accepted any authenticated caller, and adding `agency_id` at each
   * call site would add a key to a payload the LIVE Base44 original also
   * receives — roughly a third of those originals reject an unknown key. So the
   * tenant is supplied here, where it reaches only the owned service, and only
   * when the call site named none: a site that named one has made the choice
   * even when it named it badly, so the key's PRESENCE decides and an explicit
   * falsy value falls to the refusal rather than being replaced.
   */
  const portedCall = async (name, input) => {
    const { agency_id: supplied, ...params } = input;
    const agencyId = Object.hasOwn(input, 'agency_id')
      ? supplied
      : (boundTenant()?.agency_id ?? null);
    if (!agencyId) fail('PENNSYNC_TENANT_SELECTION_REQUIRED');
    const active = client, lease = generation;
    if (!active || !signedIn) fail('AUTHENTICATION_REQUIRED', 401);
    const result = await active.callFunction(name, agencyId, params);
    current(lease);
    return result;
  };
  const invoke = async (name, input = {}) => {
    // The two authority capabilities are answered from the store directly, as
    // they are in staging: `listMyTenantMemberships` precedes any tenant and the
    // business API has no request that does not name one.
    if (name === 'getMyTenantContext') return getContext(input);
    if (name === 'listMyTenantMemberships') {
      if (!exact(input, [])) fail(UNAVAILABLE);
      return memberships();
    }
    if (!Object.hasOwn(PORTED_FUNCTIONS, name)) fail(UNAVAILABLE);
    return { data: await portedCall(name, input) };
  };
  /**
   * The fetch-shaped surface, which is how the app downloads a document.
   *
   * `UserGuides.jsx` and `Help.jsx` call `functions.fetch` rather than `invoke`
   * because the axios-based invoke wrapper decodes PDF bytes as UTF-8 and
   * corrupts them. Both paths go through `portedCall`, so the agency requirement
   * and the session fence cannot drift between them.
   */
  const fetchFunction = async (name, init = {}) => {
    let input;
    try { input = init.body ? JSON.parse(init.body) : {}; }
    catch { fail(UNAVAILABLE); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail(UNAVAILABLE);
    if (!Object.hasOwn(PORTED_FUNCTIONS, name)) fail(UNAVAILABLE);
    const result = await portedCall(name, input);
    const bytes = result instanceof Uint8Array
      ? result : new TextEncoder().encode(JSON.stringify(result));
    return Object.freeze({
      ok: true,
      status: 200,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    });
  };

  const auth = Object.freeze({
    hasSession: () => signedIn,
    /**
     * Take up a session this device already holds, with no password.
     *
     * Answers false for every outcome that is not a live session — nothing
     * stored, a spent token, a service that cannot be reached — because a boot
     * that cannot resume is a boot that shows the sign-in form, which is what the
     * Base44 path does with a token its backend refuses. The client decides
     * whether the device record survives the attempt; nothing here does.
     */
    async resume() {
      const address = device.email();
      if (!address) return false;
      const lease = ++generation; signedIn = false;
      client = null;
      let next = null;
      // Whether the throw came from CONSTRUCTING a client for the stored address,
      // which is the only failure that justifies removing the record. See the
      // catch.
      let constructing = false;
      try {
        // Realm-closing, not forgetting: this is a boot, and the record being read
        // is the one thing that must survive it.
        await Promise.all([...clients.values()].map(value => value.signOut({ forget: false })));
        current(lease);
        constructing = true;
        next = clientFor(address);
        constructing = false;
        client = next;
        const identity = await next.resume();
        current(lease);
        if (!identity) { if (client === next) client = null; return false; }
        signedIn = true;
        return true;
      } catch {
        // Nothing propagates. A boot is not a request somebody made, so there is
        // nobody to report to: the answer is the sign-in form either way. The one
        // thing a failure here must not do is leave this adapter believing it has
        // a session.
        if (client === next && generation === lease) { client = null; signedIn = false; }
        // A stored address the client itself will not accept can never resume, so
        // it is removed rather than retried on every boot. The client clears the
        // record for its own refusals; this covers the one it never reached.
        //
        // AND ONLY THAT ONE. `if (!next)` also caught a lease fenced by a newer
        // boot — `current(lease)` throws STALE_AUTHORITY_SESSION before
        // `clientFor` runs — so two overlapping boots, which StrictMode's
        // double-invoked effects produce, deleted the record with nothing having
        // reached the provider and nothing having refused anything. A reviewer
        // measured it: no exchange, no logout, no record. It also contradicted the
        // client's own KEEP_ON, which lists that code as a keep.
        if (constructing) device.port(address).clear();
        return false;
      }
    },
    /**
     * Sign in as a real staff account.
     *
     * The address is the caller's, not an entry in a pinned map, so the client
     * is constructed HERE with it — and the abort/lease discipline is the
     * staging adapter's, including the `cancel` callback fenced to its own
     * attempt so a newer login cannot be revoked by an older one's cleanup.
     */
    async signIn(email, password, signal) {
      const lease = ++generation; signedIn = false;
      client = null;
      await Promise.all([...clients.values()].map(value => value.signOut()));
      current(lease);
      const normalized = String(email ?? '').trim().toLowerCase();
      if (signal?.aborted) fail('STALE_AUTHORITY_SESSION', 401);
      // A malformed address is refused by the client's own target validation,
      // before any request leaves the browser.
      const next = clientFor(normalized);
      client = next;
      const cancel = () => {
        if (generation !== lease) return;
        generation++; signedIn = false; client = null;
        void next.signOut().catch(() => {});
      };
      signal?.addEventListener('abort', cancel, { once: true });
      try {
        await next.signIn(password); current(lease);
        if (signal?.aborted) fail('STALE_AUTHORITY_SESSION', 401);
        signedIn = true;
      } catch (error) {
        // The client cleans this attempt's own candidate. A stale outer catch
        // must never sign out a newer login on that instance.
        if (client === next && generation === lease) client = null;
        throw error;
      } finally { signal?.removeEventListener('abort', cancel); }
    },
    /**
     * Set a staff account's password from an invitation or recovery link.
     *
     * The address is TYPED by the person rather than read out of the link, so a
     * link carries no identity and nothing has to put an address in a URL. The
     * client is constructed with it here, exactly as `signIn` does.
     *
     * It deliberately leaves this adapter SIGNED OUT, and `client` null, on
     * success as well as on failure: the underlying method revokes the grant a
     * link bought, and binding it here would undo the one property that method
     * exists for — a link never becomes a session. The caller signs in
     * afterwards with the password they just set.
     */
    async setPasswordFromLink(email, type, tokenHash, password) {
      const lease = ++generation; signedIn = false;
      client = null;
      await Promise.all([...clients.values()].map(value => value.signOut()));
      current(lease);
      const normalized = String(email ?? '').trim().toLowerCase();
      const next = clients.get(normalized)
        ?? createProductionAuthorityClient({ ...config.target, email: normalized }, { fetchImpl });
      clients.set(normalized, next);
      try { return await next.setPasswordFromLink(type, tokenHash, password); }
      finally { signedIn = false; client = null; }
    },
    signOut,
  });
  const unavailable = () => fail(UNAVAILABLE);
  return Object.freeze({
    auth,
    raw: Object.freeze({
      auth: Object.freeze({ me, logout: signOut, redirectToLogin: unavailable, setToken: unavailable }),
      functions: Object.freeze({ invoke, fetch: fetchFunction }),
      entities: routedEntities(UNAVAILABLE, portedCall, () => true),
      integrations: refusingNamespace(UNAVAILABLE, 'integrations'),
      cleanup: () => {
        generation++; signedIn = false;
        for (const value of clients.values()) value.invalidate();
      },
    }),
    authority: Object.freeze({ me, getMyTenantContext: getContext, listMyTenantMemberships: memberships }),
  });
}
