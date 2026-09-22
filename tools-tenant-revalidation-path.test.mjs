import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BOOTSTRAP_IMPORTER, REVALIDATION_CONTRACT, RevalidationError, censusRevalidation,
  checkRevalidation, initializerAbove, revalidationCallsIn,
} from './tools-tenant-revalidation-path.mjs';

/**
 * The revalidation seam, held to the shape that makes it a revalidation.
 *
 * The go-live plan predicted a bare `getMyTenantContext()` would REFUSE on the
 * routed path. It no longer does: `portedCall` supplies the tenant from the
 * bound principal, so the call succeeds carrying no `expectedMembershipId` and
 * no `expectedMembershipVersion` — the two values the answer is checked
 * against. `src/lib/independentStagingAdapter.spec.js` proves that behaviour
 * against the staging fixture. These tests hold the shape that keeps it from
 * arising: what counts as a call site, what counts as a trusted request, and
 * that the pre-tenant seam stays fenced to one importer.
 */
const REPOSITORY = resolve(fileURLToPath(new URL('.', import.meta.url)));
const callsIn = source => revalidationCallsIn({ path: 'src/hooks/useThing.js', source });

const HOOK = `import { trustedTenantRequest } from '@/lib/trustedTenantRequest';
export function useThing(user) {
  const tenantRequest = useMemo(
    () => trustedTenantRequest(user, null),
    [user],
  );
  return getMyTenantContext(tenantRequest.options);
}
`;

test('the helper output read through options is the shape the gate accepts', () => {
  const [call] = callsIn(HOOK);
  assert.equal(call.shape, 'trusted');
  assert.equal(call.argument, 'tenantRequest.options');
  assert.equal(call.line, 7);
});

test('a bare call is the silent no-op, not a refusal, and is named as one', () => {
  const [call] = callsIn('const x = await getMyTenantContext();');
  assert.equal(call.shape, 'bare');
  assert.equal(call.argument, '');
});

test('a hand-built options object is unverified even when it names an agency', () => {
  // It may be right today. It is not the frozen output of the helper, so
  // nothing keeps it carrying the membership expectations tomorrow.
  const [call] = callsIn("getMyTenantContext({ agencyId: agency.id });");
  assert.equal(call.shape, 'unverified');
});

test('options read from something the helper did not produce is unverified', () => {
  const [call] = callsIn(`const tenantRequest = buildRequestSomehow(user);
getMyTenantContext(tenantRequest.options);`);
  assert.equal(call.shape, 'unverified');
});

test('a member call on a transport client is not a call site of the seam', () => {
  assert.deepEqual(callsIn('tenantAuthorityClient.getMyTenantContext(payload);'), []);
});

test('the exported definition is not a call site of itself', () => {
  assert.deepEqual(callsIn('export function getMyTenantContext(options = {}) { return 1; }'), []);
});

test('the name inside a string or a comment is not a call site', () => {
  // `invoke('getMyTenantContext', payload)` is how the seam module reaches its
  // transport, and a scan that read strings would count it as a bare call.
  assert.deepEqual(callsIn("base44.functions.invoke('getMyTenantContext', payload);"), []);
  assert.deepEqual(callsIn('// getMyTenantContext() would be bare here\nconst a = 1;'), []);
});

test('a multi-line initializer is read whole rather than one line of it', () => {
  const initializer = initializerAbove(HOOK, 'tenantRequest', HOOK.indexOf('return'));
  assert.match(initializer, /trustedTenantRequest\(user, null\)/);
});

test('the nearest declaration above the call is the binding it holds', () => {
  const source = `const request = trustedTenantRequest(user);
{
  const request = notTheHelper(user);
  getMyTenantContext(request.options);
}`;
  const [call] = callsIn(source);
  assert.equal(call.shape, 'unverified');
});

test('an identifier with no declaration at all is unverified, not trusted', () => {
  const [call] = callsIn('getMyTenantContext(imported.options);');
  assert.equal(call.shape, 'unverified');
});

test('the committed tree carries only trusted revalidation calls', () => {
  const census = checkRevalidation(REPOSITORY);
  assert.equal(census.contract, REVALIDATION_CONTRACT);
  assert.deepEqual(census.untrusted, []);
  assert.equal(census.bare, 0);
  assert.equal(census.unverified, 0);
  // The six revalidation hooks the plan names. A seventh is welcome and moves
  // this number; one that is not trusted fails the gate above instead.
  assert.ok(census.trusted >= 6, `expected the revalidation hooks, got ${census.trusted}`);
  assert.equal(census.trusted, census.revalidation_call_sites);
});

test('the pre-tenant seam stays fenced to the realm that opens it', () => {
  const census = censusRevalidation(REPOSITORY);
  assert.deepEqual(census.bootstrap_importers, [BOOTSTRAP_IMPORTER]);
});

/** A tree the gate passes, so a test can break one thing about it at a time. */
function intactTree(t) {
  const root = mkdtempSync(join(tmpdir(), 'revalidation-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'src/functions'), { recursive: true });
  mkdirSync(join(root, 'src/hooks'), { recursive: true });
  mkdirSync(join(root, 'src/lib'), { recursive: true });
  writeFileSync(join(root, 'src/functions/getMyTenantContext.js'),
    'export function getMyTenantContext(options = {}) { return options; }\n'
    + 'export function bootstrapMyTenantContext(options = {}) { return options; }\n');
  writeFileSync(join(root, 'src/hooks/useThing.js'), HOOK);
  writeFileSync(join(root, 'src/lib/AuthContext.jsx'),
    "import { bootstrapMyTenantContext } from '@/functions/getMyTenantContext';\n"
    + 'export const open = () => bootstrapMyTenantContext({});\n');
  return root;
}

test('the fixture tree the other refusals are measured against passes', (t) => {
  const census = checkRevalidation(intactTree(t));
  assert.equal(census.trusted, 1);
  assert.deepEqual(census.bootstrap_importers, [BOOTSTRAP_IMPORTER]);
});

test('a second importer of the pre-tenant seam is refused', (t) => {
  // The mirror-image defect: a caller reaching authority from outside the
  // realm that fences it.
  const root = intactTree(t);
  writeFileSync(join(root, 'src/lib/Elsewhere.jsx'),
    "import { bootstrapMyTenantContext } from '@/functions/getMyTenantContext';\n"
    + 'export const sneak = () => bootstrapMyTenantContext({});\n');
  let failure = null;
  try { checkRevalidation(root); } catch (error) { failure = error; }
  assert.ok(failure instanceof RevalidationError, `expected a refusal, got ${failure}`);
  assert.equal(failure.code, 'REVALIDATION_BOOTSTRAP_ESCAPED');
  assert.deepEqual(failure.detail.importers, ['src/lib/Elsewhere.jsx']);
});

test('the pre-tenant seam having no importer at all is refused too', (t) => {
  // It would mean `AuthContext` has stopped bootstrapping through the fenced
  // seam, which is the thing being fenced rather than a tidier tree.
  const root = intactTree(t);
  rmSync(join(root, 'src/lib/AuthContext.jsx'));
  let failure = null;
  try { checkRevalidation(root); } catch (error) { failure = error; }
  assert.ok(failure instanceof RevalidationError, `expected a refusal, got ${failure}`);
  assert.equal(failure.code, 'REVALIDATION_BOOTSTRAP_UNUSED');
});

test('a mention of the pre-tenant seam in prose is not an importer', (t) => {
  const root = intactTree(t);
  writeFileSync(join(root, 'src/lib/Notes.js'),
    '/** Authority is opened by bootstrapMyTenantContext, not here. */\n'
    + "export const note = 'bootstrapMyTenantContext';\n");
  assert.deepEqual(checkRevalidation(root).bootstrap_importers, [BOOTSTRAP_IMPORTER]);
});

test('a tree the seam has moved out of refuses rather than passing empty', (t) => {
  // A capability that moves or is renamed would otherwise turn this gate into
  // one that always passes, which is the failure mode a scanner-based check
  // has. It is the same lesson D47 and D75 record.
  const root = mkdtempSync(join(tmpdir(), 'revalidation-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'src/hooks'), { recursive: true });
  writeFileSync(join(root, 'src/hooks/useThing.js'), HOOK);
  let failure = null;
  try { checkRevalidation(root); } catch (error) { failure = error; }
  assert.ok(failure instanceof RevalidationError, `expected a refusal, got ${failure}`);
  assert.equal(failure.code, 'REVALIDATION_SEAM_MODULE_MISSING');
});

test('a tree with the seam module but no caller of it also refuses', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'revalidation-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'src/functions'), { recursive: true });
  writeFileSync(join(root, 'src/functions/getMyTenantContext.js'),
    'export function getMyTenantContext(options = {}) { return options; }\n');
  let failure = null;
  try { checkRevalidation(root); } catch (error) { failure = error; }
  assert.ok(failure instanceof RevalidationError, `expected a refusal, got ${failure}`);
  assert.equal(failure.code, 'REVALIDATION_NO_CALL_SITES');
});

test('a bare call in a tree with both seams is what the gate refuses', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'revalidation-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'src/functions'), { recursive: true });
  mkdirSync(join(root, 'src/hooks'), { recursive: true });
  writeFileSync(join(root, 'src/functions/getMyTenantContext.js'),
    'export function getMyTenantContext(options = {}) { return options; }\n');
  writeFileSync(join(root, 'src/hooks/useThing.js'),
    'export const useThing = () => getMyTenantContext();\n');
  let failure = null;
  try { checkRevalidation(root); } catch (error) { failure = error; }
  assert.ok(failure instanceof RevalidationError, `expected a refusal, got ${failure}`);
  assert.equal(failure.code, 'REVALIDATION_REQUEST_MISSING');
  assert.deepEqual(failure.detail.sites, ['src/hooks/useThing.js:1 (no argument)']);
});
