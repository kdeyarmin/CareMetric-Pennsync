// TEST BUILD ONLY: an esbuild alias redirects two unchanged read wrappers here.
// This module is not imported by the production frontend or its backend selector.
import { createStagingAuthorityClient } from '../client.mjs';

let client = null;
let generation = 0;
const fail = code => { throw new Error(code); };
const current = lease => { if (lease !== generation) fail('STALE_AUTHORITY_SESSION'); };

export async function signOut() {
  generation += 1;
  const old = client; client = null;
  if (old) await old.signOut();
}

export async function signIn(config, password) {
  const old = client; client = null; generation += 1;
  const lease = generation;
  // Invalidate immediately, including requests waiting for a genuine response.
  if (old) await old.signOut();
  current(lease);
  const next = createStagingAuthorityClient(config);
  client = next;
  try {
    const identity = await next.signIn(password); current(lease); return identity;
  } catch (error) {
    next.invalidate(); if (client === next) client = null; throw error;
  }
}

function projection(patient) {
  // Explicit synthetic name projection only: no invented clinical fields.
  if (!/^Synthetic Patient [AB][12]$/.test(patient.display_name)) fail('BROWSER_SYNTHETIC_PROJECTION_INVALID');
  return { id: patient.id, first_name: 'Synthetic', last_name: patient.display_name.slice('Synthetic '.length) };
}
const scopeOf = context => ({ agency_id: context.agency_id, membership_id: context.membership_id,
  membership_version: context.membership_version, tenant_role: context.tenant_role });

async function invoke(name, input) {
  const active = client; const lease = generation;
  if (!active) fail('AUTHENTICATION_REQUIRED');
  if (name === 'listAuthorizedPatients') {
    if (input.mode !== 'page' || input.purpose !== 'roster' || input.sort !== 'id_asc'
      || Object.keys(input).some(key => !['agency_id', 'mode', 'purpose', 'sort', 'page_size', 'cursor'].includes(key))) {
      fail('BROWSER_UNSUPPORTED_PATIENT_READ');
    }
    if (input.cursor) {
      const context = await active.rpc('context', { p_agency_id: input.agency_id }); current(lease);
      const cursor = input.cursor;
      if (cursor.subject_user_id !== context.user_id || cursor.membership_id !== context.membership_id
        || cursor.membership_version !== context.membership_version || cursor.tenant_role !== context.tenant_role) {
        fail('BROWSER_STALE_PATIENT_CURSOR');
      }
    }
    const result = await active.rpc('patients', { p_agency_id: input.agency_id, p_limit: input.page_size,
      p_after_id: input.cursor?.after_id ?? null }); current(lease);
    const scope = scopeOf(result.context);
    // Check again against authority acquired by the same transaction as the rows.
    if (input.cursor && (input.cursor.membership_id !== scope.membership_id
      || input.cursor.membership_version !== scope.membership_version || input.cursor.tenant_role !== scope.tenant_role
      || input.cursor.subject_user_id !== result.context.user_id)) fail('BROWSER_STALE_PATIENT_CURSOR');
    const next = result.next_cursor === null ? null : { version: 1, after_id: result.next_cursor,
      agency_id: input.agency_id, purpose: 'roster', status: null, sort: 'id_asc', page_size: input.page_size,
      subject_user_id: result.context.user_id, ...scope };
    return { data: { success: true, mode: 'page', purpose: 'roster', patients: result.items.map(projection), scope,
      page: { page_size: input.page_size, sort: 'id_asc', after_id: input.cursor?.after_id ?? null,
        has_more: next !== null, next_cursor: next } } };
  }
  if (name === 'getAuthorizedPatient') {
    if (input.purpose !== 'display' || Object.keys(input).some(key => !['agency_id', 'patient_id', 'purpose'].includes(key))) {
      fail('BROWSER_UNSUPPORTED_PATIENT_READ');
    }
    const result = await active.rpc('patient', { p_agency_id: input.agency_id, p_patient_id: input.patient_id });
    current(lease);
    return { data: { success: true, purpose: 'display', patient: projection(result.patient), scope: scopeOf(result.context) } };
  }
  fail('BROWSER_UNSUPPORTED_FUNCTION');
}

export const base44 = Object.freeze({ functions: Object.freeze({ invoke }) });
