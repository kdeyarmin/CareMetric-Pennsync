/** In-memory synthetic export fixture only. Never reads source records or writes plaintext exports. */
import { createHash } from 'node:crypto';
import { ARCHIVE_SOURCE_APPS, buildArchiveFromReader } from './tools-pennsync-archive.mjs';
export const IMPORT_APP = ARCHIVE_SOURCE_APPS.staging;
export const importActors = [
  ['admin-a', '6aac58fe36c13a1c49ba7cf8', 'agency-a', 'agency_admin'],
  ['clinician-a', '6aac58ff8ec706a643a7aa42', 'agency-a', 'clinician'],
  ['clinician-empty', '6aac58ffa5f6252bcf92f11f', 'agency-a', 'clinician'],
  ['admin-b', '6aac5900bf4098977893276d', 'agency-b', 'agency_admin'],
].map(([name, id, agency, role], i) => ({ name, id, agency, role,
  email: `info+pennsync-${name}@caremetricai.com`, uuid: `10000000-0000-4000-8000-00000000000${i + 1}` }));
export const importSha = value => createHash('sha256').update(value).digest('hex');
export const importId = n => n.toString(16).padStart(24, '0');

export async function syntheticImportArchive({ archiveDir, key, actors = importActors, statuses = ['active', 'trial'], alter = () => {} }) {
  const original = new Map();
  const decision = importSha('SYNTHETIC_IMPORT_FIXTURE_ONLY');
  const plan = { format: 'pennsync-supplied-export', version: 1, source_apps: [IMPORT_APP],
    snapshot_evidence_sha256: decision, collections: [], identities: {}, agencies: {}, files: [] };
  const source = {
    User: actors.map(a => ({ id: a.id, email: a.email })),
    Agency: ['A', 'B'].map((name, i) => ({ id: importId(10 + i), agency_name: `Synthetic Agency ${name}`, status: statuses[i] })),
    Patient: ['A', 'B'].map((name, i) => ({ id: importId(20 + i), agency_id: importId(10 + i), first_name: 'Synthetic', last_name: `Imported ${name}` })),
  };
  const identities = actors.map(a => ({ source_app_id: IMPORT_APP, user_id: a.id, target_subject: a.uuid, decision_sha256: decision }));
  const agencies = source.Agency.map((a, i) => ({ source_app_id: IMPORT_APP, agency_id: a.id, target_agency_id: `agency-${i ? 'b' : 'a'}`, decision_sha256: decision }));
  const save = (path, rows) => {
    const raw = Buffer.from(rows.map(r => ` ${JSON.stringify(r)}\r\n`).join(''));
    original.set(path, raw); return { path, bytes: raw.length, sha256: importSha(raw), rows: rows.length };
  };
  alter({ source, identities, agencies, plan, original });
  for (const [entity, records] of Object.entries(source)) plan.collections.push({ source_app_id: IMPORT_APP, entity,
    ...save(`${entity}.jsonl`, records), fields: Object.keys(records[0]), references: [], file_references: [], opaque_fields: [],
    scope: entity === 'User' ? { kind: 'principal' } : entity === 'Agency' ? { kind: 'agency_root' } : { kind: 'agency', pointer: '/agency_id' } });
  plan.identities = save('identities.jsonl', identities); plan.agencies = save('agencies.jsonl', agencies);
  const rawPlan = Buffer.from(JSON.stringify(plan, null, 2)); original.set('plan.json', rawPlan);
  await buildArchiveFromReader({ rawPlan, archiveDir, key, read: async function* (d) { yield original.get(d.path); } });
  return { archiveDir, key, expectedPlanSha256: importSha(rawPlan), original, plan, source };
}
