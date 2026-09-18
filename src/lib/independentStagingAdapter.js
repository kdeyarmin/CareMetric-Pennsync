import { createStagingAuthorityClient, STAGING_APP_ID } from '../../services/authority-client/client.mjs';

const EMAILS = Object.freeze(['admin-a', 'clinician-a', 'clinician-empty', 'admin-b']
  .map(name => `info+pennsync-${name}@caremetricai.com`));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (code, status = 403) => { const error = new Error(code); error.code = code; error.status = status; throw error; };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const contextKeys = ['user_id', 'user_email', 'membership_id', 'membership_key', 'membership_version',
  'agency_id', 'tenant_role', 'membership_status', 'is_platform_owner', 'agency'];
const membershipKeys = ['membership_id', 'membership_key', 'membership_version', 'agency_id',
  'tenant_role', 'membership_status', 'agency'];
const pick = (value, keys) => Object.fromEntries(keys.map(key => [key, value[key]]));
const scopeOf = context => pick(context, ['agency_id', 'membership_id', 'membership_version', 'tenant_role']);

export function readIndependentStagingConfig(env = {}) {
  if (!env.VITE_PENNSYNC_BACKEND || env.VITE_PENNSYNC_BACKEND === 'base44') return null;
  if (env.VITE_PENNSYNC_BACKEND !== 'independent-staging') fail('INVALID_STAGING_CONFIGURATION');
  let actors;
  try { actors = JSON.parse(env.VITE_PENNSYNC_STAGING_ACTORS); } catch { fail('INVALID_STAGING_CONFIGURATION'); }
  if (!exact(actors, EMAILS) || EMAILS.some(email => !UUID.test(actors[email]))
    || new Set(Object.values(actors)).size !== EMAILS.length) fail('INVALID_STAGING_CONFIGURATION');
  const target = { appId: STAGING_APP_ID, projectRef: env.VITE_PENNSYNC_STAGING_PROJECT_REF,
    projectUrl: env.VITE_PENNSYNC_STAGING_PROJECT_URL, publishableKey: env.VITE_PENNSYNC_STAGING_PUBLISHABLE_KEY };
  // Reuse the exact reviewed target/key pin. Construction performs no I/O.
  for (const email of EMAILS) createStagingAuthorityClient({ ...target, email, authUserId: actors[email] });
  return Object.freeze({ target: Object.freeze(target), actors: Object.freeze(actors) });
}

/** Finite adaptation of existing app contracts; never a generic SDK or entity proxy. */
export function createIndependentStagingAdapter(config, { fetchImpl = globalThis.fetch } = {}) {
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
  const signOut = async () => {
    generation++; signedIn = false;
    client = null;
    await Promise.all([...clients.values()].map(value => value.signOut()));
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
  const invoke = async (name, input = {}) => {
    if (name === 'getMyTenantContext') return getContext(input);
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
  const auth = Object.freeze({
    hasSession: () => signedIn,
    async signIn(email, password, signal) {
      const lease = ++generation; signedIn = false;
      client = null;
      await Promise.all([...clients.values()].map(value => value.signOut()));
      current(lease);
      const normalized = String(email).trim().toLowerCase();
      if (!Object.hasOwn(config.actors, normalized)) fail('STAGING_ACCOUNT_UNAVAILABLE', 401);
      if (signal?.aborted) fail('STALE_AUTHORITY_SESSION', 401);
      const next = clients.get(normalized) ?? createStagingAuthorityClient({ ...config.target, email: normalized,
        authUserId: config.actors[normalized] }, { fetchImpl });
      clients.set(normalized, next);
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
      functions: Object.freeze({ invoke }), entities: Object.freeze({}), integrations: Object.freeze({}),
      cleanup: () => { generation++; signedIn = false; for (const value of clients.values()) value.invalidate(); } }),
    authority: Object.freeze({ me, getMyTenantContext: getContext, listMyTenantMemberships: memberships }),
  });
}
