import { createStagingAuthorityClient, PORTED_FUNCTIONS, STAGING_APP_ID } from '../../services/authority-client/client.mjs';
import { createFeedSubscriber, feedFor, intervalSchedule } from './independentEntityFeeds.js';
import { routeFor } from './independentEntityRoutes.js';
import {
  CONTEXT_KEYS, MEMBERSHIP_KEYS, exact, failWith, refusingNamespace, pick, scopeOf, refusalFor,
} from './ownedBackendSeam.js';
import { createOwnedSessionPort, storedOwnedSessionEmail } from './ownedBackendSessionStore.js';

const EMAILS = Object.freeze(['admin-a', 'clinician-a', 'clinician-empty', 'admin-b']
  .map(name => `info+pennsync-${name}@caremetricai.com`));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Staging's published refusal code. Screens and the acceptance suites read it by name. */
const UNAVAILABLE = 'STAGING_OPERATION_UNAVAILABLE';
const fail = (code, status = 403) => failWith(code, status);
const contextKeys = CONTEXT_KEYS;
const membershipKeys = MEMBERSHIP_KEYS;
// `then` must read as absent: a function there would make the namespace, or an
// entity, a thenable, and `await base44.entities` would call it.
const NOT_AN_OPERATION = new Set(['then', 'toJSON']);
// Memoised per name, because the SDK's own objects are stable: a caller may
// hold `base44.entities.Patient` or one of its methods, and the realm gate
// caches its method facades by owner identity, so a fresh proxy per access
// would miss that cache on every call.
const refusingLevel = (resolve) => {
  const made = new Map();
  return new Proxy(Object.freeze({}), {
    get: (_target, name) => {
      if (typeof name !== 'string' || NOT_AN_OPERATION.has(name)) return undefined;
      if (!made.has(name)) made.set(name, resolve(name));
      return made.get(name);
    },
  });
};
/**
 * The entity namespace, which refuses exactly as before except where a route
 * is DECLARED.
 *
 * `serve` is the adapter's own `portedCall`, so a routed entity call carries
 * the same tenant fence, session lease and service contract as the function
 * call it becomes — this level adds no authorization and can remove none.
 * Everything without a declaration keeps the refusal above, unchanged, which
 * is what lets Stage J adopt one call site at a time.
 *
 * `subscribe` is the one entity operation a route cannot be: it returns an
 * unsubscribe FUNCTION synchronously, straight into a `useEffect` cleanup,
 * where every route here is promise-shaped. So it is declared as a feed
 * instead, and answered before the route lookup — a feed and a route for the
 * same entity operation cannot both exist, because `subscribe` is never a
 * route key. With no feed declared the refusal below is unchanged, which is
 * what lets this land before any entity has one.
 */
const routedEntities = (code, serve, configured) => refusingLevel(entity => refusingLevel(operation => (...args) => {
  // `configured` is the same condition `routesPorted` applies to a function
  // call: with no service to ask, a declared route is not a route. Refusing
  // here rather than inside `serve` keeps a misconfigured build answering
  // "unavailable" instead of a transport error.
  if (operation === 'subscribe') {
    const feed = configured() ? feedFor(entity) : null;
    // The UNDECLARED case keeps the existing rejection exactly, rather than
    // throwing: that behaviour is asserted today and no feed exists yet, so
    // this branch changes nothing until one is declared.
    if (!feed) return Promise.reject(refusalFor(code, 'entities', entity, operation));
    return createFeedSubscriber({ entity, feed, serve, schedule: intervalSchedule })(...args);
  }
  const route = configured() ? routeFor(entity, operation) : null;
  if (!route) return Promise.reject(refusalFor(code, 'entities', entity, operation));
  // `request` refuses an argument it cannot express, synchronously. Keep the
  // whole path promise-shaped: these stand in for SDK methods, and a caller
  // that gets a throw where every sibling rejects has to handle two shapes.
  let input;
  try { input = route.request(...args); } catch (error) { return Promise.reject(error); }
  // The call's own arguments reach `response` as well, because a route that
  // re-orders or narrows the answer has to know what was asked for to say
  // whether the page it got was the whole set.
  return serve(route.function, input).then(answer => route.response(answer, ...args));
}));

export function readIndependentStagingConfig(env = {}) {
  if (!env.VITE_PENNSYNC_BACKEND || env.VITE_PENNSYNC_BACKEND === 'base44') return null;
  // `independent` is a KNOWN mode this reader does not serve, so it answers
  // null -- "not mine" -- rather than refusing. The distinction is load-bearing:
  // `independentStagingSession.js` calls this reader first and unconditionally,
  // so throwing here stopped module evaluation and a production build could not
  // boot at all. Returning null for a known sibling mode, rather than reordering
  // the two calls, is what makes both readers safe in EITHER order and at every
  // other call site; reordering would only have moved the hazard.
  //
  // A value that is neither still fails closed, which is the behaviour this line
  // exists for: a typo in the mode name must not quietly select the Base44 path.
  if (env.VITE_PENNSYNC_BACKEND === 'independent') return null;
  if (env.VITE_PENNSYNC_BACKEND !== 'independent-staging') fail('INVALID_STAGING_CONFIGURATION');
  let actors;
  try { actors = JSON.parse(env.VITE_PENNSYNC_STAGING_ACTORS); } catch { fail('INVALID_STAGING_CONFIGURATION'); }
  if (!exact(actors, EMAILS) || EMAILS.some(email => !UUID.test(actors[email]))
    || new Set(Object.values(actors)).size !== EMAILS.length) fail('INVALID_STAGING_CONFIGURATION');
  const target = { appId: STAGING_APP_ID, projectRef: env.VITE_PENNSYNC_STAGING_PROJECT_REF,
    projectUrl: env.VITE_PENNSYNC_STAGING_PROJECT_URL, publishableKey: env.VITE_PENNSYNC_STAGING_PUBLISHABLE_KEY,
    // Optional: with it unset no ported handler is reachable and `invoke`
    // fails closed exactly as it did before. The client pins the value against
    // a fixed pair, so a wrong one fails construction below rather than
    // pointing a caller's bearer at a host we do not run.
    apiUrl: env.VITE_PENNSYNC_API_URL || null };
  // Reuse the exact reviewed target/key pin. Construction performs no I/O.
  for (const email of EMAILS) createStagingAuthorityClient({ ...target, email, authUserId: actors[email] });
  return Object.freeze({ target: Object.freeze(target), actors: Object.freeze(actors) });
}

/** Finite adaptation of existing app contracts; never a generic SDK or entity proxy. */
/** The device half of staying signed in. See the production adapter's copy. */
const DEVICE = Object.freeze({ email: storedOwnedSessionEmail, port: createOwnedSessionPort });

export function createIndependentStagingAdapter(config,
  { fetchImpl = globalThis.fetch, boundTenant = () => null, device = DEVICE } = {}) {
  let client = null;
  let generation = 0;
  let signedIn = false;
  // At most the four pinned actors. Retain instances for retry of a known late
  // cleanup failure even after their public login promise already rejected.
  const clients = new Map();
  const current = lease => { if (lease !== generation) fail('STALE_AUTHORITY_SESSION', 401); };
  const rpc = async (name, input) => {
    const active = client, lease = generation;
    if (!active || !signedIn) fail('AUTHENTICATION_REQUIRED', 401);
    const result = await active.rpc(name, input); current(lease); return result;
  };
  /**
   * End the session. `forget` false closes the realm and leaves the device able
   * to resume; the default forgets, because that is what signing out means.
   */
  const signOut = async ({ forget = true } = {}) => {
    generation++; signedIn = false;
    client = null;
    await Promise.all([...clients.values()].map(value => value.signOut({ forget })));
  };
  /**
   * Construct, or reuse, the client for one PINNED actor with its device port.
   *
   * The actor map is the gate: an address that is not one of the four has no
   * authority user id to pin, so it cannot produce a client at all. That is what
   * makes a tampered device record harmless here without a check of its own.
   */
  const clientFor = address => {
    if (!Object.hasOwn(config.actors, address)) fail('STAGING_ACCOUNT_UNAVAILABLE', 401);
    const next = clients.get(address) ?? createStagingAuthorityClient({ ...config.target, email: address,
      authUserId: config.actors[address] }, { fetchImpl, sessionStore: device.port(address) });
    clients.set(address, next);
    return next;
  };
  const me = async () => {
    const result = await rpc('memberships', {});
    // Native UUID remains private to the adapter. Existing app authority is
    // bound to the independently mapped legacy principal, never invented roles.
    return { id: result.user_id, email: result.user_email };
  };
  const getContext = async (payload = {}) => {
    if (!payload.agency_id || Object.keys(payload).some(key => !['agency_id', 'expected_membership_id', 'expected_membership_version'].includes(key))) {
      fail('STAGING_TENANT_SELECTION_REQUIRED');
    }
    const result = await rpc('context', { p_agency_id: payload.agency_id });
    if ((payload.expected_membership_id !== undefined || payload.expected_membership_version !== undefined)
      && (payload.expected_membership_id !== result.membership_id || payload.expected_membership_version !== result.membership_version)) {
      fail('STAGING_MEMBERSHIP_CHANGED');
    }
    return { data: { tenant_context: pick(result, contextKeys) } };
  };
  const memberships = async () => {
    const result = await rpc('memberships', {});
    return { data: { subject: { user_id: result.user_id, user_email: result.user_email, is_platform_owner: false },
      memberships: result.memberships.map(value => pick(value, membershipKeys)) } };
  };
  /**
   * One Base44 name, TWO capabilities — the only place that is true.
   *
   * `manageAuthorizedReferral` is the ported referral broker (`list`, `get`,
   * `list_assignees`, `create`, `update`, `delete`) AND the synthetic S3
   * staging flow, whose actions are all prefixed `staging_` and are served
   * from this adapter's own RPCs. `routesPorted` is keyed on the NAME, so
   * adding the broker to `PORTED_FUNCTIONS` sent every `staging_*` call to the
   * service instead — where the envelope is `{action, params}` with no
   * top-level `agency_id`, so each one failed `STAGING_TENANT_SELECTION_REQUIRED`.
   *
   * Every other special-cased name here is the SAME capability served two
   * ways, and shadowing it is the intended fallback. This one is not, so the
   * action decides. The two sets are disjoint and the prefix is this adapter's
   * own invention, which is what makes it safe to read.
   */
  const stagingOwned = (name, input) => name === 'manageAuthorizedReferral'
    && typeof input?.action === 'string' && input.action.startsWith('staging_');

  /**
   * A ported handler, if the app has been pointed at the service. Everything
   * about this path is explicit: the name has to be one the service serves,
   * the call site has to supply `agency_id` — the ported service requires a
   * current agency membership where its Base44 original accepted any
   * authenticated caller — and with no service configured every name falls
   * through to the same refusal any unsupported name gets.
   */
  const routesPorted = (name, input) => Object.hasOwn(PORTED_FUNCTIONS, name)
    && !!config.target.apiUrl && !stagingOwned(name, input);
  /**
   * The tenant a ported call carries, and a REVERSAL of a recorded decision.
   *
   * The transition plan says this adapter "refuses rather than choosing a
   * tenant on the caller's behalf, which is the point", and that the fix
   * belongs at each call site. Measuring it moved the ground under that: the
   * adapter routed 70 call sites across 52 capabilities and 3 named a tenant,
   * so the recorded plan was 67 edits (`check:ported-call-sites` carries the
   * live count) — and each edit adds a key to a payload
   * the LIVE Base44 original also receives, because `src/functions/*` wrappers
   * serve both backends.
   *
   * That is the part that makes the call-site fix unsafe rather than merely
   * large. Roughly a third of those originals reject an unknown key outright
   * and there is no trustworthy way to tell which: a first scan here called
   * `createAuthorizedPatient` tolerant, and it rejects unknown keys at
   * `entry.ts:149` with a `for (const key of Object.keys(body))` loop the scan
   * did not know. Widening the scan found more shapes, which is the same
   * lesson D47 and D75 record — when a check exists to stop a class of
   * mistake, re-derive the shapes from the tree rather than from the check —
   * and it is exactly why "no rejection shape found" cannot be read as proof
   * of tolerance. Adding `agency_id` on that evidence would break patient
   * creation in production.
   *
   * So the tenant is supplied HERE, where it reaches only the ported service
   * and can never touch a Base44 payload. What it supplies is not an
   * invention: `boundTenant` is wired to `getActiveTrustedTenantContext` by
   * `independentStagingSession.js`, the composition root, rather than imported
   * here — this module is also loaded under plain `node --test`, where a `@/`
   * alias does not resolve, which is why every import in it is relative. It is
   * the principal AuthContext
   * already bound and validated, the same source the six revalidation hooks
   * use through `trustedTenantRequest`, and its own contract states that it is
   * not an authorization grant because the server independently re-checks the
   * principal and membership before work and before disclosure.
   *
   * A call site that names its tenant still decides — this only answers the
   * case where none was named — and with no bound principal at all the
   * original refusal stands, because then there genuinely is no tenant to act
   * as.
   */
  const portedCall = async (name, input) => {
    const { agency_id: supplied, ...params } = input;
    // Only an ABSENT tenant falls back. A call site that named one has made
    // the choice even when it named it badly: `agency_id: null` is a lookup
    // that produced nothing, and answering that with the bound agency would
    // act on a tenant nobody chose. `||` did exactly that, so the key's
    // presence decides and an explicit falsy value falls to the refusal below.
    const agencyId = Object.hasOwn(input, 'agency_id')
      ? supplied
      : (boundTenant()?.agency_id ?? null);
    if (!agencyId) fail('STAGING_TENANT_SELECTION_REQUIRED');
    const active = client, lease = generation;
    if (!active || !signedIn) fail('AUTHENTICATION_REQUIRED', 401);
    const result = await active.callFunction(name, agencyId, params);
    current(lease);
    return result;
  };

  const invoke = async (name, input = {}) => {
    if (routesPorted(name, input)) return { data: await portedCall(name, input) };
    if (name === 'getMyTenantContext') return getContext(input);
    if (name === 'manageAuthorizedReferral') {
      if (!exact(input, ['action','params'])) fail('STAGING_OPERATION_UNAVAILABLE');
      if (input.action === 'staging_list') return { data:await rpc('s3_list',input.params) };
      if (input.action === 'staging_roster') return { data:await rpc('referral_patients',input.params) };
      if (input.action === 'staging_prepare') {
        if (!exact(input.params,['p_agency_id','p_patient_id'])) fail('STAGING_OPERATION_UNAVAILABLE');
        const result = await rpc('referral_patient', input.params);
        if (!['agency_admin','manager','office_staff'].includes(result.context.tenant_role)) fail('STAGING_OPERATION_UNAVAILABLE');
        return { data:result };
      }
      const method = { staging_create:'s3_create', staging_confirm:'s3_confirm', staging_read:'s3_read' }[input.action];
      if (!method) fail('STAGING_OPERATION_UNAVAILABLE');
      return { data:await rpc(method,input.params) };
    }
    if (name === 'getAuthorizedPatient') {
      if (!exact(input, ['agency_id', 'patient_id', 'purpose']) || !['display', 'smart_note_context'].includes(input.purpose)) {
        fail('STAGING_OPERATION_UNAVAILABLE');
      }
      const result = await rpc('patient_context', { p_agency_id: input.agency_id, p_patient_id: input.patient_id, p_purpose: input.purpose });
      return { data: { success: true, purpose: result.purpose, patient: result.patient, scope: result.scope } };
    }
    if (name === 'listAuthorizedVisits') {
      const keys = ['agency_id','patient_id','purpose','sort','page_size','cursor', ...(Object.hasOwn(input, 'status') ? ['status'] : [])];
      if (!exact(input, keys) || input.purpose !== 'schedule' || input.sort !== 'id_asc') fail('STAGING_OPERATION_UNAVAILABLE');
      const result = await rpc('visits_schedule', { p_agency_id: input.agency_id, p_patient_id: input.patient_id,
        p_status: input.status ?? null, p_page_size: input.page_size, p_cursor: input.cursor });
      return { data: { success: true, purpose: result.purpose, visits: result.visits, scope: result.scope, page: result.page } };
    }
    if (name === 'getAuthorizedVisit') {
      if (!exact(input, ['agency_id', 'visit_id', 'purpose']) || input.purpose !== 'documentation') {
        fail('STAGING_OPERATION_UNAVAILABLE');
      }
      const requestedVisitId = input.visit_id;
      const result = await rpc('visit_documentation', { p_agency_id: input.agency_id, p_visit_id: requestedVisitId });
      // The strict client already bound the canonical server UUID to this request.
      // Preserve its captured spelling for the legacy wrapper's opaque-ID equality.
      return { data: { success: true, purpose: result.purpose,
        visit: { ...result.visit, id: requestedVisitId }, scope: result.scope } };
    }
    if (name !== 'listAuthorizedPatients' || input.mode !== 'page' || input.purpose !== 'roster'
      || input.sort !== 'id_asc' || Object.keys(input).some(key => !['agency_id', 'mode', 'purpose', 'sort', 'page_size', 'cursor'].includes(key))) {
      fail('STAGING_OPERATION_UNAVAILABLE');
    }
    const result = await rpc('patients', { p_agency_id: input.agency_id, p_limit: input.page_size,
      p_after_id: input.cursor?.after_id ?? null });
    const scope = scopeOf(result.context);
    const expectedCursor = after => ({ version: 1, after_id: after, agency_id: input.agency_id,
      purpose: 'roster', status: null, sort: 'id_asc', page_size: input.page_size,
      subject_user_id: result.context.user_id, ...scope });
    if (input.cursor && (!exact(input.cursor, Object.keys(expectedCursor(input.cursor.after_id)))
      || Object.entries(expectedCursor(input.cursor.after_id)).some(([key, value]) => input.cursor[key] !== value))) {
      fail('STAGING_PATIENT_CURSOR_CHANGED');
    }
    const patients = result.items.map(patient => {
      if (!patient.display_name.startsWith('Synthetic ')) fail('STAGING_PATIENT_PROJECTION_INVALID');
      return { id: patient.id, first_name: 'Synthetic', last_name: patient.display_name.slice('Synthetic '.length) };
    });
    return { data: { success: true, mode: 'page', purpose: 'roster', patients, scope,
      page: { page_size: input.page_size, sort: 'id_asc', after_id: input.cursor?.after_id ?? null,
        has_more: result.next_cursor !== null, next_cursor: result.next_cursor === null ? null : expectedCursor(result.next_cursor) } } };
  };
  /**
   * The fetch-shaped surface, which is how the app downloads a document.
   *
   * `UserGuides.jsx` and `Help.jsx` deliberately call `functions.fetch` rather
   * than `invoke` because the axios-based invoke wrapper decodes PDF bytes as
   * UTF-8 and corrupts them. This adapter exposed no `fetch` at all, so those
   * flows could not reach the ported document handlers however they were
   * configured — adding routing to `invoke` alone left three of the eleven
   * unreachable from the only call sites that use them.
   *
   * Both paths go through `portedCall`, so the agency requirement and the
   * session fence cannot drift between them.
   */
  const fetchFunction = async (name, init = {}) => {
    // Parsed BEFORE the gate, because the gate now reads the action: this path
    // never carries a `staging_*` one, and a gate that could not see the body
    // would be one call site deciding differently from the other.
    let input;
    try { input = init.body ? JSON.parse(init.body) : {}; }
    catch { fail('STAGING_OPERATION_UNAVAILABLE'); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('STAGING_OPERATION_UNAVAILABLE');
    if (!routesPorted(name, input)) fail('STAGING_OPERATION_UNAVAILABLE');
    const result = await portedCall(name, input);
    // A document answers with its bytes; a JSON handler reached this way is
    // encoded, so the surface stays a faithful transport either way.
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
     * Take up a session this device already holds. See the production adapter's
     * copy for why nothing propagates; the only difference here is that the actor
     * map refuses an address that is not one of the four.
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
        if (client === next && generation === lease) { client = null; signedIn = false; }
        // Only a stored address `clientFor` itself refuses — here, one that is not
        // a pinned synthetic actor. A lease fenced by a newer boot throws before
        // `clientFor` runs, and clearing there deleted a live record with nothing
        // having reached the provider; see the production adapter's note.
        if (constructing) device.port(address).clear();
        return false;
      }
    },
    async signIn(email, password, signal) {
      const lease = ++generation; signedIn = false;
      client = null;
      await Promise.all([...clients.values()].map(value => value.signOut()));
      current(lease);
      const normalized = String(email).trim().toLowerCase();
      if (!Object.hasOwn(config.actors, normalized)) fail('STAGING_ACCOUNT_UNAVAILABLE', 401);
      if (signal?.aborted) fail('STALE_AUTHORITY_SESSION', 401);
      const next = clientFor(normalized);
      client = next;
      const cancel = () => {
        if (generation !== lease) return;
        generation++; signedIn = false; client = null;
        // This callback belongs to this exact still-current attempt. A newer
        // login fences it out before it could revoke the reused actor client.
        void next.signOut().catch(() => {});
      };
      signal?.addEventListener('abort', cancel, { once: true });
      try {
        await next.signIn(password); current(lease);
        if (signal?.aborted) fail('STALE_AUTHORITY_SESSION', 401);
        signedIn = true;
      } catch (error) {
        // The strict client cleans this attempt's known candidate itself. A
        // stale outer catch must never sign out a newer login on that instance.
        if (client === next && generation === lease) client = null;
        throw error;
      } finally { signal?.removeEventListener('abort', cancel); }
    },
    signOut,
  });
  const unavailable = () => fail('STAGING_OPERATION_UNAVAILABLE');
  return Object.freeze({ auth,
    raw: Object.freeze({ auth: Object.freeze({ me, logout: signOut, redirectToLogin: unavailable, setToken: unavailable }),
      functions: Object.freeze({ invoke, fetch: fetchFunction }),
      entities: routedEntities(UNAVAILABLE, portedCall, () => !!config.target.apiUrl),
      integrations: refusingNamespace(UNAVAILABLE, 'integrations'),
      cleanup: () => { generation++; signedIn = false; for (const value of clients.values()) value.invalidate(); } }),
    authority: Object.freeze({ me, getMyTenantContext: getContext, listMyTenantMemberships: memberships }),
  });
}
