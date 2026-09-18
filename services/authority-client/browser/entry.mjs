/* global document, window */
import { signIn, signOut } from './adapter.mjs';
import { listAuthorizedPatients } from '../../../src/functions/listAuthorizedPatients.js';
import { getAuthorizedPatient } from '../../../src/functions/getAuthorizedPatient.js';
import { getPatientDisplayName } from '../../../src/components/patient/patientDisplay.jsx';

const byId = id => document.getElementById(id);
const config = await fetch('/configuration', { cache: 'no-store', credentials: 'omit' }).then(response => response.json());
let epoch = 0;
let readGeneration = 0;
let cursor = null;
let actor = null;
const safeError = error => /^(AUTHORITY_[A-Z_]+|AUTHENTICATION_[A-Z_]+|STALE_AUTHORITY_SESSION|BROWSER_[A-Z_]+)$/.test(error?.message)
  ? error.message : 'BROWSER_READ_FAILED';
const clear = () => {
  readGeneration += 1;
  byId('roster').replaceChildren(); byId('detail').textContent = ''; cursor = null; byId('next').disabled = true;
};
const invalidate = () => { epoch += 1; actor = null; clear(); byId('identity').textContent = ''; };
const showError = (error, lease, read = readGeneration) => {
  if (lease === epoch && read === readGeneration) byId('status').textContent = safeError(error);
};
for (const value of config.actors) {
  const option = document.createElement('option'); option.value = value.name; option.textContent = value.name;
  byId('actor').append(option);
}
byId('login').addEventListener('submit', async event => {
  event.preventDefault(); invalidate(); const lease = epoch;
  const selected = config.actors.find(value => value.name === byId('actor').value);
  let password = byId('password').value; byId('password').value = '';
  byId('status').textContent = 'Signing in';
  try {
    const user = await signIn({ ...config.target, authUserId: selected.uuid, email: selected.email }, password);
    if (lease !== epoch) return;
    actor = selected; byId('identity').textContent = user.email; byId('agency').value = selected.agency;
    byId('status').textContent = 'Signed in';
  } catch (error) { showError(error, lease); } finally { password = null; }
});
byId('logout').addEventListener('click', async () => {
  invalidate(); const lease = epoch; byId('status').textContent = 'Signed out';
  try { await signOut(); } catch (error) { showError(error, lease); }
});
async function roster(next = false) {
  const lease = epoch; const requestedCursor = next ? cursor : null; clear();
  const read = readGeneration;
  byId('status').textContent = 'Loading roster';
  try {
    if (!actor) throw new Error('AUTHENTICATION_REQUIRED');
    const result = await listAuthorizedPatients({ agencyId: byId('agency').value, mode: 'page', purpose: 'roster',
      pageSize: 1, cursor: requestedCursor });
    if (lease !== epoch || read !== readGeneration) return;
    for (const patient of result.patients) {
      const item = document.createElement('li'); item.textContent = getPatientDisplayName(patient); item.dataset.patientId = patient.id;
      byId('roster').append(item);
    }
    cursor = result.page.next_cursor; byId('next').disabled = cursor === null;
    byId('status').textContent = result.patients.length ? 'Roster loaded' : 'No assigned patients';
  } catch (error) { showError(error, lease, read); }
}
byId('agency').addEventListener('input', clear);
byId('load').addEventListener('click', () => roster());
byId('next').addEventListener('click', () => roster(true));
byId('lookup').addEventListener('submit', async event => {
  event.preventDefault(); const lease = epoch; byId('detail').textContent = ''; byId('status').textContent = 'Loading patient';
  const read = ++readGeneration;
  try {
    if (!actor) throw new Error('AUTHENTICATION_REQUIRED');
    const result = await getAuthorizedPatient({ agencyId: byId('agency').value, patientId: byId('patient-id').value, purpose: 'display' });
    if (lease !== epoch || read !== readGeneration) return;
    byId('detail').textContent = getPatientDisplayName(result.patient); byId('status').textContent = 'Patient loaded';
  } catch (error) { showError(error, lease, read); }
});
// No token, session, cursor or patient content is persisted. A new document logs in again.
window.addEventListener('pagehide', () => { invalidate(); void signOut().catch(() => {}); });
byId('status').textContent = 'Signed out';
