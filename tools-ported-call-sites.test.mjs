import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CALL_SITE_CONTRACT, CallSiteError, callText, censusCallSites, checkCallSites, codeOnly,
  readExpectations, reachesIn,
} from './tools-ported-call-sites.mjs';

/**
 * The tenant gap, measured rather than quoted.
 *
 * The transition plan names four call sites that invoke a ported capability
 * without an `agency_id`. That was true of an adapter routing eleven names;
 * it routed seventy-four when this was written. These tests hold the
 * measurement honest — what
 * counts as a reach, what counts as naming a tenant, and what is not evidence
 * either way.
 */
const REPOSITORY = resolve(fileURLToPath(new URL('.', import.meta.url)));
const names = ['createAuthorizedPatient', 'getMyTenantContext'];

const sitesIn = source => reachesIn({ path: 'src/x.jsx', source, names });

test('a payload naming the tenant is counted as naming it', () => {
  const [site] = sitesIn("base44.functions.invoke('createAuthorizedPatient', { agency_id: id, a: 1 });");
  assert.equal(site.capability, 'createAuthorizedPatient');
  assert.equal(site.tenant, 'named');
  assert.equal(site.routed, true);
});

test('an object payload with no tenant is counted as absent', () => {
  const [site] = sitesIn("base44.functions.invoke('createAuthorizedPatient', { first_name: 'A' });");
  assert.equal(site.tenant, 'absent');
});

test('a call with no payload at all is absent, not indeterminate', () => {
  const [site] = sitesIn("base44.functions.invoke('createAuthorizedPatient');");
  assert.equal(site.tenant, 'absent');
});

test('a payload passed as a variable claims nothing', () => {
  const [site] = sitesIn("base44.functions.invoke('createAuthorizedPatient', payload);");
  // It may or may not carry a tenant; this cannot read it, so it says so
  // rather than guessing in either direction.
  assert.equal(site.tenant, 'indeterminate');
});

test('the raw client is not a routed reach, because the adapter is not in that path', () => {
  const [site] = sitesIn("rawBase44.functions.invoke('getMyTenantContext', payload);");
  assert.equal(site.routed, false);
  // `src/api/base44Client.js` keeps two of these deliberately: they bootstrap
  // the tenant, so counting them would have overstated the gap by the exact
  // calls that cannot name one.
  assert.equal(site.capability, 'getMyTenantContext');
});

test('a nested call in the payload does not truncate the scan', () => {
  const [site] = sitesIn(
    "base44.functions.invoke('createAuthorizedPatient', { id: makeId(1, 2), agency_id: a });");
  // Stopping at the first `)` would end inside `makeId` and miss the tenant.
  assert.equal(site.tenant, 'named');
});

test('a bracket inside a string or comment cannot close the call', () => {
  const [site] = sitesIn(
    "base44.functions.invoke('createAuthorizedPatient', { note: ')', /* ) */ agency_id: a });");
  assert.equal(site.tenant, 'named');
});

test('a tenant named inside a string or a comment is not a tenant the request carries', () => {
  // `text.includes('agency_id')` read the raw call text, so a ratchet could
  // count these as named and silently drop a site that refuses at runtime.
  for (const source of ["base44.functions.invoke('createAuthorizedPatient', { note: 'agency_id' });",
    "base44.functions.invoke('createAuthorizedPatient', { /* agency_id */ a: 1 });",
    "base44.functions.invoke('createAuthorizedPatient', { a: 1 }); // agency_id"]) {
    assert.equal(sitesIn(source)[0].tenant, 'absent', source);
  }
  // And the real forms still count, including shorthand.
  for (const source of ["base44.functions.invoke('createAuthorizedPatient', { agency_id: a });",
    "base44.functions.invoke('createAuthorizedPatient', { agency_id });"]) {
    assert.equal(sitesIn(source)[0].tenant, 'named', source);
  }
});

test('blanking preserves offsets so a reported line does not shift', () => {
  const source = "const x = 'aa';\nbase44.functions.invoke('createAuthorizedPatient', { agency_id: a });";
  assert.equal(codeOnly(source).length, source.length);
  assert.equal(sitesIn(source)[0].line, 2);
});

test('an unbalanced call refuses rather than reporting a truncated payload', () => {
  let failure = null;
  try { callText("invoke('x', { a: 1 ", 6); } catch (error) { failure = error; }
  assert.ok(failure instanceof CallSiteError);
  assert.equal(failure.code, 'CALL_SITE_UNBALANCED');
});

test('the committed census is what the gate expects', () => {
  const census = checkCallSites(REPOSITORY);
  assert.equal(census.contract, CALL_SITE_CONTRACT);
  assert.deepEqual(census.absent, readExpectations(REPOSITORY).absent);
});

test('the gap is the measured number and not the documented four', () => {
  const census = censusCallSites(REPOSITORY);
  // The figure this tool exists to correct. If a port genuinely fixes call
  // sites this drops and the expectations file has to be rewritten, which is
  // the ratchet working rather than a failure.
  assert.ok(census.absent.length > 50,
    `expected the real gap, got ${census.absent.length} — if this shrank, rerun --write`);
  assert.equal(census.tenant_named + census.absent.length, census.call_sites);
  assert.equal(census.unrouted_call_sites, 2);
});
