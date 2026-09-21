import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transpileTs } from '../../tools-transpile-ts.mjs';
import {
  TRIAGE_MODEL, buildTriagePrompt, triageReferral,
} from '../../services/pennsync-api/referral-triage.mjs';
import {
  SUPPLY_MODEL, SUPPLY_RESPONSE_SCHEMA, analyzeVisitSupplyUsage, buildSupplyPrompt,
} from '../../services/pennsync-api/visit-supply-usage.mjs';
import {
  MAX_CSV_BYTES, cleanPhone, cleanValue, formatProviderName, importProviders,
  normalizeHeader, parseCSV, shapeProviderRows, titleCase,
} from '../../services/pennsync-api/provider-import.mjs';
import {
  AUDIT_CODES, AUDIT_LIST_CODES, SUBJECT_KINDS,
} from '../../services/pennsync-api/audit.mjs';
import { RECORD_CONTRACTS } from '../../services/pennsync-api/record-contracts.mjs';
import {
  FOLLOW_UP_SCHEMA, buildFollowUpPrompt,
} from '../../services/pennsync-api/follow-up-tasks.mjs';
import { buildGenericPrompt, buildPersonalPrompt } from '../../services/pennsync-api/clinical-phrase.mjs';

/**
 * Every ported-handler test that has to READ its Base44 original.
 *
 * It lives here, beside the other `pennsyncApi*Parity` suites, for the reason
 * `services/pennsync-api/api.test.mjs` already gives about imports: the
 * Dockerfile copies that directory as its whole build context and runs
 * `node --test *.test.mjs` inside it, so nothing there can reach `../`. A file
 * READ of `base44/functions/...` breaks the image build exactly as an import
 * does — and the containment check measured only import specifiers until three
 * such reads had been written. That is D47's lesson again: when a check exists
 * to stop a class of mistake, re-derive the shapes from the tree rather than
 * from the check. It measures both now, and these tests moved here.
 *
 * What they prove is unchanged: a prompt, a schema, a request shape and six
 * text helpers are the ORIGINAL's, compared against it rather than against a
 * retyped copy.
 */
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../');
const ORIGINAL = 'base44/functions/analyzeVisitForSupplyUsage/entry.ts';
const PROVIDER_ORIGINAL = 'base44/functions/importProvidersCsv/entry.ts';
const ANALYSIS = {
  patient_name: 'Ada Lovelace', date_of_birth: '1815-12-10',
  primary_diagnosis: 'CHF exacerbation', urgency_level: 'HIGH',
};
const triageHarness = () => {
  const calls = [];
  const audits = [];
  return {
    calls,
    audits,
    params: { referralData: 'Referral from Dr Hopper for Ada Lovelace, DOB 1815-12-10.' },
    integration: async (operation, payload) => {
      calls.push({ operation, payload });
      return JSON.stringify(ANALYSIS);
    },
    audit: async (action, options) => {
      audits.push({ action, options });
      return { audit_event_id: 'evt-1' };
    },
  };
};
const EXTRACTION = {
  supplies: [
    { name: 'gauze 4x4', quantity: 2, unit: 'boxes', purpose: 'wound care' },
    { name: 'saline', quantity: 1, unit: 'bottles', purpose: 'irrigation' },
  ],
};
const supplyHarness = (overrides = {}) => {
  const calls = [];
  const contracts = [];
  return {
    calls,
    contracts,
    params: {
      visitId: 'visit-1', patientId: 'patient-1',
      visitNotes: 'Dressing change; used 2 boxes of gauze 4x4 and a bottle of saline.',
      ...overrides.params,
    },
    integration: async (operation, payload) => {
      calls.push({ operation, payload });
      return 'answer' in overrides ? overrides.answer : EXTRACTION;
    },
    contract: async (name, args) => {
      contracts.push({ name, args });
      return name === 'getVisitSupplyContext'
        ? { success: true, patient_id: args.patient_id, visit_id: args.visit_id }
        : { success: true, usageLogs: 2, alertsCreated: 0, alerts: [] };
    },
  };
};
const CSV = [
  'Physician Name,Title,Fax Number,Work Number,NPI,Specialty,Primary Organization Name',
  '"Smith, John, MD",MD,(215) 555-0100,215-555-0101,1234567890,Cardiology,Penn Cardiology',
  'jane doe,DO,215.555.0200,,0987654321,Geriatrics,',
  'No Fax Provider,MD,,215-555-0300,1111111111,,',
  ',MD,215-555-0400,,,,',
].join('\n');
const providerHarness = (overrides = {}) => {
  const contracts = [];
  return {
    contracts,
    params: overrides.params ?? { csv_text: CSV },
    contract: async (name, args) => {
      contracts.push({ name, args });
      return { success: true, created_providers: args.rows.length, updated_providers: 0 };
    },
  };
};

async function originalHelpers() {
  let source = await readFile(resolve(repository, PROVIDER_ORIGINAL), 'utf8');
  source = source.replace(/import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/, '');
  source = source.replace(/Deno\.serve\([\s\S]*$/, '');
  source += '\nexport { parseCSV, normalizeHeader, cleanValue, cleanPhone, titleCase, formatProviderName };\n';
  const file = join(tmpdir(), `providers_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(file, transpileTs(source).outputText);
  try { return await import(pathToFileURL(file).href); }
  finally { await unlink(file).catch(() => {}); }
}

test('the prompt is the original s, and the model is the one it names', async () => {
  const h = triageHarness();
  await triageReferral(h);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].operation, 'InvokeLLM');
  assert.equal(h.calls[0].payload.model, TRIAGE_MODEL);
  // Read from the original rather than asserted, so a reworded prompt fails
  // here instead of quietly changing what the model is asked.
  const original = readFileSync(resolve(repository,
    'base44/functions/triageReferralWithAI/entry.ts'), 'utf8');
  const start = original.indexOf('You are an expert home health triage nurse.');
  const end = original.indexOf('Return ONLY valid JSON, no markdown or explanation.');
  assert.ok(start > 0 && end > start, 'the original still carries the prompt');
  const prompt = buildTriagePrompt('REFERRAL');
  for (const line of original.slice(start, end).split('\n')) {
    const trimmed = line.trim();
    // The referral payload itself is interpolated, so its line differs.
    if (!trimmed || trimmed.startsWith('${')) continue;
    assert.ok(prompt.includes(trimmed), `the prompt lost: ${trimmed}`);
  }
  assert.ok(prompt.includes('REFERRAL'), 'and the referral is interpolated into it');
  // Nothing but the prompt and the model: no schema, no temperature.
  assert.deepEqual(Object.keys(h.calls[0].payload).sort(), ['model', 'prompt']);
});

test('the prompt and the schema are the original s, read from its source', async () => {
  const h = supplyHarness();
  await analyzeVisitSupplyUsage(h);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].operation, 'InvokeLLM');
  assert.equal(h.calls[0].payload.model, SUPPLY_MODEL);
  assert.deepEqual(Object.keys(h.calls[0].payload).sort(),
    ['model', 'prompt', 'response_json_schema']);
  const original = readFileSync(resolve(repository, ORIGINAL), 'utf8');
  const start = original.indexOf('You are a clinical documentation analyzer.');
  const end = original.indexOf('Return ONLY valid JSON array, no other text.');
  assert.ok(start > 0 && end > start, 'the original still carries the prompt');
  const prompt = buildSupplyPrompt('NOTES');
  for (const line of original.slice(start, end).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.includes('${')) continue;
    assert.ok(prompt.includes(trimmed), `the prompt lost: ${trimmed}`);
  }
  assert.ok(prompt.includes('Visit Notes: "NOTES"'), 'and the notes are interpolated');
  // The schema marks no field required, which is exactly why the contract
  // guards every one of them.
  assert.deepEqual(Object.keys(SUPPLY_RESPONSE_SCHEMA.properties.supplies.items.properties),
    ['name', 'quantity', 'unit', 'purpose']);
  assert.equal('required' in SUPPLY_RESPONSE_SCHEMA.properties.supplies.items, false);
  assert.ok(original.includes('response_json_schema'), 'the original passes one too');
});

test('the body keys stay the original s, because the SPA sends them', async () => {
  // D57 renamed `predictSupplyNeeds`'s `patientId` safely because nothing in
  // `src/` calls it. This one is called, and the SPA is shared between the two
  // backends, so the keys are read from the call site rather than chosen.
  const caller = readFileSync(resolve(repository, 'src/pages/SmartNoteAssistant.jsx'), 'utf8');
  assert.match(caller,
    /analyzeVisitForSupplyUsage\(\{\s*visitId,\s*visitNotes:\s*noteText,\s*patientId\s*\}\)/);
  const handlers = readFileSync(resolve(repository, 'services/pennsync-api/handlers.mjs'), 'utf8');
  const entry = handlers.slice(handlers.indexOf('analyzeVisitForSupplyUsage: Object.freeze({'));
  assert.match(entry.slice(0, entry.indexOf('}),')),
    /exactObject\(params, \['visitId', 'visitNotes', 'patientId'\]/);
});

test('every text helper is the original s, over a table of awkward inputs', async () => {
  const original = await originalHelpers();
  const names = ['Smith, John, MD', 'SMITH, john', 'jane   doe', '  ﻿O\'Brien  ',
    'van der berg', '', ',', 'Lee,', ', Grace', 'Ada'];
  for (const value of names) {
    assert.equal(formatProviderName(value), original.formatProviderName(value), value);
    assert.equal(titleCase(value), original.titleCase(value), value);
  }
  for (const value of ['Fax Number', 'NPI', '  Primary Organization Name  ', 'work_number',
    '', '---', 'Top Unit!', '﻿Physician Name']) {
    assert.equal(normalizeHeader(value), original.normalizeHeader(value), value);
  }
  for (const value of ['(215) 555-0100', '215.555.0200', ' +1 215 555 0300 ', '',
    '﻿1234', 'ext 5', null, undefined, 42]) {
    assert.equal(cleanPhone(value), original.cleanPhone(value), String(value));
    assert.equal(cleanValue(value), original.cleanValue(value), String(value));
  }
  const documents = [CSV, 'a,b\n1,2', 'a,b\r\n1,2\r\n', '"a,b",c\n"say ""hi""",2',
    'a\n\n\nb', '', 'only,one,row', '"unterminated,quote\n1,2',
    'a,b\n,\n1,2', 'a,b\n1,2\n'];
  for (const text of documents) {
    assert.deepEqual(parseCSV(text), original.parseCSV(text), JSON.stringify(text));
  }
});

test('exactly one source, and the legacy one is refused by name', async () => {
  // The partial port. Downloading a `file_url` means carrying Base44's own
  // storage allowlist into the service, which is what D56 measured.
  const original = await readFile(resolve(repository, PROVIDER_ORIGINAL), 'utf8');
  assert.match(original, /FILE_URL_ALLOWED_HOSTS/, 'the branch still downloads');
  assert.match(original, /A provider directory CSV needs no storage upload or AI integration/);
  for (const [params, code] of [
    [{ file_url: 'https://base44.app/x.csv' }, 'CSV_FILE_URL_UNSUPPORTED'],
    [{ csv_text: CSV, file_url: 'https://base44.app/x.csv' }, 'CSV_SOURCE_AMBIGUOUS'],
    [{}, 'CSV_SOURCE_AMBIGUOUS'],
    [{ csv_text: '' }, 'CSV_TEXT_REQUIRED'],
    [{ csv_text: '   ' }, 'CSV_TEXT_REQUIRED'],
    [{ csv_text: 42 }, 'CSV_TEXT_REQUIRED'],
  ]) {
    const h = providerHarness({ params });
    await assert.rejects(() => importProviders(h), error => error?.code === code,
      JSON.stringify(params));
    assert.equal(h.contracts.length, 0, 'and nothing reached the store');
  }
});

test('the ten megabyte bound is the original s, measured in bytes', async () => {
  assert.equal(MAX_CSV_BYTES, 10 * 1024 * 1024);
  const original = await readFile(resolve(repository, PROVIDER_ORIGINAL), 'utf8');
  assert.match(original, /const maxCsvBytes = 10 \* 1024 \* 1024;/);
  // Just inside by characters, over it by bytes: the original checks both and
  // so does this.
  const wide = `a,b\n${'é'.repeat(MAX_CSV_BYTES - 10)},x`;
  assert.ok(wide.length <= MAX_CSV_BYTES);
  const h = providerHarness({ params: { csv_text: wide } });
  await assert.rejects(() => importProviders(h), error => error?.code === 'CSV_TOO_LARGE');
});

test('a CSV with no data row is the original s own refusal', async () => {
  for (const text of ['Physician Name,Fax Number', '', '   ']) {
    assert.throws(() => shapeProviderRows(text), error => error?.code === 'CSV_EMPTY',
      JSON.stringify(text));
  }
});

const SQL = readFileSync(resolve(repository,
  'services/authority-store/supabase/record-migrations/20260920010000_activity_audit.sql'), 'utf8');
/** The codes one contract raises, read from that contract's own body. */
const raisedBy = (contract) => {
  const start = SQL.indexOf(`create function "pennsync_records".${contract}(`);
  assert.ok(start > 0, `${contract} is not in the migration`);
  const body = SQL.slice(start, SQL.indexOf('end $contract$;', start));
  return [...new Set([...body.matchAll(/message\s*=\s*'(PENNSYNC_AUDIT_[A-Z_]+)'/g)].map(m => m[1]))].sort();
};

test('the declared vocabulary matches the contract it fronts', () => {
  // Read from the migration rather than trusted, and per contract rather than
  // per file: a code the SQL raises that this module does not know becomes a
  // generic outage for the caller, and one it expects that nothing raises is a
  // branch that can never be taken. Checking the file as a whole misses the
  // second — `PENNSYNC_AUDIT_FORBIDDEN` is raised by the migration and cannot
  // reach an append, because reading the trail needs an administrator and
  // appending to it does not.
  const sql = SQL;
  assert.deepEqual(raisedBy('contract_activity_append'), [...AUDIT_CODES].sort());
  assert.deepEqual(raisedBy('contract_activity_list'), [...AUDIT_LIST_CODES].sort());
  // Between them the two lists account for every code the migration raises, so
  // a new refusal cannot be added to either contract unnoticed.
  const raised = [...new Set([...sql.matchAll(/message\s*=\s*'(PENNSYNC_AUDIT_[A-Z_]+)'/g)].map(m => m[1]))];
  assert.deepEqual(raised.sort(), [...new Set([...AUDIT_CODES, ...AUDIT_LIST_CODES])].sort());
  assert.ok(!AUDIT_CODES.includes('PENNSYNC_AUDIT_FORBIDDEN'));
  // And the subject kinds this module accepts are exactly the ones the table's
  // check constraint admits.
  // `in` and its list are on separate lines in the migration, so the gap is
  // part of the pattern rather than something to assume away.
  const constraint = sql.match(/"subject_kind" in\s*\(([^)]*)\)/)[1];
  assert.deepEqual([...constraint.matchAll(/'([a-z]+)'/g)].map(m => m[1]).sort(), [...SUBJECT_KINDS].sort());
});

const migration = file => readFileSync(resolve(repository,
  `services/authority-store/supabase/record-migrations/${file}`), 'utf8');
const PATIENT_SQL = migration('20260920060000_contract_patient_read.sql');
const VISIT_SQL = migration('20260920080000_contract_visit_read.sql');
const DOCUMENT_SQL = migration('20260920100000_contract_document_read.sql');
const CREATE_SQL = migration('20260920120000_contract_patient_create.sql');
/** The codes one SQL function raises, read from that function's own body. */
const refusalsOf = (sql, name, terminator) => {
  const start = sql.indexOf(`create function "pennsync_records".${name}(`);
  assert.ok(start > 0, `${name} is not in the migration`);
  const body = sql.slice(start, sql.indexOf(terminator, start));
  return new Set([...body.matchAll(/message\s*=\s*'(PENNSYNC_[A-Z_]+)'/g)].map(match => match[1]));
};

/**
 * Every contract's declared vocabulary against the SQL it fronts.
 *
 * Read from the migration rather than trusted, and per contract rather than
 * per file. A code the SQL raises that this module does not know reaches a
 * handler as a generic outage; a code this module expects that the contract it
 * calls cannot raise is a branch nothing can take, and it reads like a
 * guarantee somebody wrote. `CURSOR_UNKNOWN` is the one that would go wrong
 * here: only a page contract can raise it, and a flat list would have the id
 * batch and the single read claiming it too.
 *
 * Each family shares a gate, so the gate's refusals count for all of its
 * contracts — which is the point of having one: the order in which a caller
 * learns that they do not hold the agency, that the purpose does not exist,
 * and that their role is not admitted is decided once per family.
 */
const FAMILIES = [
  { sql: PATIENT_SQL, prefix: 'PENNSYNC_PATIENT_', gate: 'patient_purpose_gate', contracts: {
    listAuthorizedPatientsPage: 'contract_patient_list',
    listAuthorizedPatientsBatch: 'contract_patient_batch',
    getAuthorizedPatient: 'contract_patient_get',
  } },
  { sql: VISIT_SQL, prefix: 'PENNSYNC_VISIT_', gate: 'visit_purpose_gate', contracts: {
    listAuthorizedVisits: 'contract_visit_list',
    getAuthorizedVisit: 'contract_visit_get',
  } },
  { sql: DOCUMENT_SQL, prefix: 'PENNSYNC_DOCUMENT_', gate: 'document_purpose_gate', contracts: {
    listAuthorizedDocuments: 'contract_document_list',
    getAuthorizedDocument: 'contract_document_get',
  } },
  // The write has no shared gate: one contract, and every refusal is its own.
  { sql: CREATE_SQL, prefix: 'PENNSYNC_PATIENT_', gate: null, contracts: {
    createAuthorizedPatient: 'contract_patient_create',
  } },
];

test('each clinical contract declares exactly the refusals it can actually raise', () => {
  for (const family of FAMILIES) {
    const gate = family.gate === null
      ? new Set() : refusalsOf(family.sql, family.gate, 'end $gate$;');
    for (const [name, sqlName] of Object.entries(family.contracts)) {
      assert.deepEqual([...RECORD_CONTRACTS[name].codes].sort(),
        [...new Set([...gate, ...refusalsOf(family.sql, sqlName, 'end $contract$;')])].sort(), name);
    }
    // Only a page contract can end a walk, so only it may say so.
    for (const name of Object.keys(family.contracts).filter(entry => !/^list/.test(entry))) {
      assert.ok(!RECORD_CONTRACTS[name].codes.includes(`${family.prefix}CURSOR_UNKNOWN`), name);
    }
    // Between them the family's contracts account for every refusal its
    // migration raises, so a new one cannot be added unnoticed.
    const raised = new Set([...family.sql.matchAll(new RegExp(`message\\s*=\\s*'(${family.prefix}[A-Z_]+)'`, 'g'))]
      .map(match => match[1]));
    assert.deepEqual([...raised].sort(), [...new Set(Object.keys(family.contracts)
      .flatMap(name => RECORD_CONTRACTS[name].codes))].sort(), family.prefix);
  }
});

test('the patient family keeps the walk refusal to the capability that can walk', () => {
  // Read from the migration rather than trusted, and per contract rather than
  // per file. A code the SQL raises that this module does not know reaches a
  // handler as a generic outage; a code this module expects that the contract
  // it calls cannot raise is a branch nothing can take, and it reads like a
  // guarantee somebody wrote. `PENNSYNC_PATIENT_CURSOR_UNKNOWN` is the one
  // that would go wrong here: only the page contract can raise it, and a flat
  // list would have the id batch claiming it too.
  //
  // The three share a gate, so the gate's refusals count for all of them —
  // which is the point of having one: the order in which a caller learns that
  // they do not hold the agency, that the purpose does not exist, and that
  // their role is not admitted is decided once.
  // The id batch and the single read cannot page, so neither may claim the
  // refusal that ends a walk. Stated separately from the loop above because
  // it is the one place the three patient contracts genuinely differ.
  assert.ok(RECORD_CONTRACTS.listAuthorizedPatientsPage.codes
    .includes('PENNSYNC_PATIENT_CURSOR_UNKNOWN'));
  for (const name of ['listAuthorizedPatientsBatch', 'getAuthorizedPatient']) {
    for (const code of ['PENNSYNC_PATIENT_CURSOR_UNKNOWN', 'PENNSYNC_PATIENT_CURSOR_INVALID',
      'PENNSYNC_PATIENT_PAGE_SIZE_INVALID', 'PENNSYNC_PATIENT_STATUS_INVALID']) {
      assert.ok(!RECORD_CONTRACTS[name].codes.includes(code), `${name} cannot raise ${code}`);
    }
  }
});

test('the phrase prompts are the original s, both branches', async () => {
  const original = await readFile(resolve(repository,
    'base44/functions/expandClinicalPhrase/entry.ts'), 'utf8');
  const cases = [
    ['You are a home healthcare documentation assistant. Expand the following clinical phrase',
      'Expanded documentation:', buildGenericPrompt('PHRASE', null, null)],
    ['You are a home healthcare documentation assistant. Generate Medicare-compliant',
      'Expanded documentation:', buildPersonalPrompt(
        { ai_prompt_instructions: 'INSTRUCTIONS', expanded_text: '' }, 'CONTEXT', null)],
  ];
  for (const [head, tail, built] of cases) {
    const start = original.indexOf(head);
    const end = original.indexOf(tail, start);
    assert.ok(start > 0 && end > start, `the original still carries: ${head}`);
    for (const line of original.slice(start, end).split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.includes('${')) continue;
      assert.ok(built.includes(trimmed), `the prompt lost: ${trimmed}`);
    }
  }
});

test('the follow-up prompt and its enums are the original s', async () => {
  const original = await readFile(resolve(repository,
    'base44/functions/generateFollowUpTasks/entry.ts'), 'utf8');
  const start = original.indexOf('You are a home health/hospice clinical supervisor');
  const end = original.indexOf('Return JSON array of tasks.');
  assert.ok(start > 0 && end > start, 'the original still carries the prompt');
  const prompt = buildFollowUpPrompt('NOTE', 'CONTEXT', 'recert');
  for (const line of original.slice(start, end).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.includes('${')) continue;
    assert.ok(prompt.includes(trimmed), `the prompt lost: ${trimmed}`);
  }
  // The schema's enums are what the contract checks a model's answer against,
  // so they are read from the original rather than retyped.
  const properties = FOLLOW_UP_SCHEMA.properties.tasks.items.properties;
  for (const [field, values] of Object.entries({
    type: properties.type.enum, priority: properties.priority.enum,
    due_timeframe: properties.due_timeframe.enum,
  })) {
    for (const value of values) {
      assert.ok(original.includes(`"${value}"`), `${field} lost ${value}`);
    }
  }
  assert.deepEqual(properties.priority.enum, ['high', 'medium', 'low']);
});
