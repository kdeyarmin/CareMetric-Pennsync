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
import { insightPrompt } from '../../services/pennsync-api/ai-report.mjs';
import { reportMetrics, reportTrend } from '../../services/pennsync-api/report-metrics.mjs';
import {
  FOLLOW_UP_SCHEMA, buildFollowUpPrompt,
} from '../../services/pennsync-api/follow-up-tasks.mjs';
import { buildGenericPrompt, buildPersonalPrompt } from '../../services/pennsync-api/clinical-phrase.mjs';
import {
  CHART_EXPORT_SCHEMA, buildChartPrompt,
} from '../../services/pennsync-api/chart-export.mjs';
import {
  bm25Score, buildBm25, extractSnippet, scoreCorpus, searchLimit, tokenize,
} from '../../services/pennsync-api/pdf-search.mjs';
import { buildReportText } from '../../services/pennsync-api/state-incident.mjs';
import {
  buildEventReviewPrompt, buildTrendPrompt,
} from '../../services/pennsync-api/clinical-analysis.mjs';
import {
  buildTaskSuggestionPrompt,
} from '../../services/pennsync-api/clinical-task-suggestions.mjs';
import {
  EXTRACTION_SCHEMA, buildExtractionPrompt, textAnchors,
} from '../../services/pennsync-api/clinical-extraction.mjs';

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
/**
 * A template's LITERAL text, with every balanced `${…}` cut out.
 *
 * Skipping lines that merely contain `${` is not enough: an interpolation can
 * span lines — `${JSON.stringify(visits.map(v => ({` opens one and several
 * lines of JavaScript follow inside it — so the regions are matched by brace
 * depth instead. Two prompt-parity tests share this; a second copy would be a
 * second thing to keep in step.
 */
const literal = text => {
  let out = ''; let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (depth === 0 && text[index] === '$' && text[index + 1] === '{') { depth = 1; index += 1; continue; }
    if (depth > 0) {
      if (text[index] === '{') depth += 1;
      else if (text[index] === '}') depth -= 1;
      continue;
    }
    out += text[index];
  }
  return out;
};

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

test('the two clinical analysis prompts are the originals, line for line', async () => {
  const patient = { patient_name: 'NAME', primary_diagnosis: 'DX', current_medications: [] };
  for (const [file, head, tail, built] of [
    ['base44/functions/analyzeClinicalEvents/entry.ts',
      'Analyze these clinical events for a patient',
      'Return ONLY valid JSON, no prose or code fences',
      buildEventReviewPrompt(patient, [])],
    ['base44/functions/analyzeClinicalTrends/entry.ts',
      "Analyze this patient's clinical data over time",
      'Return ONLY valid JSON, no prose or code fences',
      buildTrendPrompt(patient, [], [], [], [])],
  ]) {
    const original = await readFile(resolve(repository, file), 'utf8');
    const start = original.indexOf(head);
    const end = original.indexOf(tail, start);
    assert.ok(start > 0 && end > start, `the original still carries: ${head}`);
    for (const line of original.slice(start, end).split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.includes('${')) continue;
      assert.ok(built.includes(trimmed), `${file} prompt lost: ${trimmed}`);
    }
    // The JSON shape each one demands back is part of the prompt, and the
    // handler's field-by-field fallbacks are built from it.
    const shape = original.slice(end, original.indexOf('`\n', end));
    for (const key of [...shape.matchAll(/"([a-z_]+)":/g)].map(m => m[1])) {
      assert.ok(built.includes(`"${key}":`), `${file} shape lost: ${key}`);
    }
  }
});

test('the task-suggestion prompt is the original s, and it creates no task', async () => {
  const original = await readFile(resolve(repository,
    'base44/functions/analyzeAndGenerateClinicalTasks/entry.ts'), 'utf8');
  const start = original.indexOf('You are an expert clinical nurse supervisor');
  const end = original.indexOf('Return ONLY valid JSON, no prose or code fences', start);
  assert.ok(start > 0 && end > start, 'the original still carries the prompt');
  const built = buildTaskSuggestionPrompt({ patient: {}, visits: [], alerts: [], tasks: [] });
  for (const line of literal(original.slice(start, end)).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    assert.ok(built.includes(trimmed), `the prompt lost: ${trimmed}`);
  }
  // D64's claim about this capability, checked against the file rather than
  // remembered: it suggests tasks and creates none.
  assert.equal(/entities\s*\.\s*Task\s*\.\s*create/.test(original), false,
    'the original still creates no task');
  assert.match(original, /tasksWithDates/);
});

test('the extraction prompt, schema and anchor search are the original s', async () => {
  const original = await readFile(resolve(repository,
    'base44/functions/extractClinicalEvents/entry.ts'), 'utf8');
  const start = original.indexOf('Extract ALL significant clinical events');
  const end = original.indexOf('IMPORTANT: For source_text', start);
  assert.ok(start > 0 && end > start, 'the original still carries the prompt');
  const prompt = buildExtractionPrompt('NOTE');
  for (const line of original.slice(start, end).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.includes('${')) continue;
    assert.ok(prompt.includes(trimmed), `the prompt lost: ${trimmed}`);
  }
  assert.match(prompt, /Visit Note:\nNOTE/);
  // Both enums are what the CONTRACT coerces against, so they are read from
  // the original rather than retyped.
  const items = EXTRACTION_SCHEMA.properties.events.items.properties;
  assert.deepEqual(items.severity.enum, ['low', 'medium', 'high', 'critical']);
  assert.equal(items.event_type.enum.length, 21);
  for (const value of items.event_type.enum) {
    assert.ok(original.includes(`"${value}"`), `event_type lost ${value}`);
  }
  // And the anchor search is the block it replaces, proved by running the
  // original's own logic over the same inputs.
  assert.match(original, /const index = nurse_notes\.indexOf\(sourceText\);/);
  assert.match(original, /const fuzzyIndex = lowerNotes\.indexOf\(lowerSource\);/);
  const note = 'Visit at 0900. Found on floor by bed.';
  for (const quote of ['  Found on floor  ', 'FOUND ON FLOOR', 'never said this']) {
    const sourceText = quote.trim();
    let expectedStart = note.indexOf(sourceText);
    if (expectedStart === -1) expectedStart = note.toLowerCase().indexOf(sourceText.toLowerCase());
    assert.deepEqual(textAnchors(note, quote), expectedStart === -1
      ? { text_anchor_start: null, text_anchor_end: null }
      : { text_anchor_start: expectedStart, text_anchor_end: expectedStart + sourceText.length },
    quote);
  }
});

test('every referral action accepts exactly the keys its original accepts', async () => {
  // The handler is pure routing, so the one thing worth proving about it is
  // that its per-action key sets ARE the original's `assertOnlyKeys` table.
  // Read from both files rather than retyped, so a key added upstream fails
  // here instead of being silently refused at the boundary.
  const original = await readFile(resolve(repository,
    'base44/functions/manageAuthorizedReferral/entry.ts'), 'utf8');
  const handler = readFileSync(resolve(repository,
    'services/pennsync-api/handlers.mjs'), 'utf8');
  const keys = text => [...text.matchAll(/'([a-z_]+)'/g)].map(match => match[1]).sort();
  const declared = Object.fromEntries([...original.matchAll(
    /assertOnlyKeys\(\s*(?:body,\s*)?\n?\s*\[([^\]]*)\][\s\S]{0,60}?'Referral ([a-z ]+)'/g)]
    .map(match => [match[2], keys(match[1])]));
  // All six, the multi-line `list` and `create` included.
  assert.deepEqual(Object.keys(declared).sort(),
    ['assignee list', 'create', 'delete', 'get', 'list', 'update']);
  assert.deepEqual(declared.list,
    ['action', 'agency_id', 'assigned_to', 'limit', 'patient_id', 'status']);
  assert.deepEqual(declared.get, ['action', 'agency_id', 'referral_id']);
  assert.deepEqual(declared.create, ['action', 'agency_id', 'client_request_id', 'referral']);
  assert.deepEqual(declared.update, ['action', 'agency_id', 'changes', 'referral_id']);
  assert.deepEqual(declared.delete, ['action', 'agency_id', 'referral_id']);
  assert.deepEqual(declared['assignee list'], ['action', 'agency_id']);

  const block = handler.slice(handler.indexOf('manageAuthorizedReferral: Object.freeze('),
    handler.indexOf('listAgencyRoster: Object.freeze('));
  const served = Object.fromEntries([...block.matchAll(
    /params\.action === '([a-z_]+)'\)\s*\{\s*exactObject\(params,\s*\[([^\]]*)\]/g)]
    .map(match => [match[1], keys(match[2])]));
  assert.deepEqual(Object.keys(served).sort(),
    ['create', 'delete', 'get', 'list', 'list_assignees', 'update']);
  // `agency_id` is the ENVELOPE's here rather than a body key — the service
  // takes it beside `params` — so it is the one name that drops out of each
  // set, and the rest must agree exactly.
  for (const [action, upstream] of [['list', 'list'], ['get', 'get'], ['create', 'create'],
    ['update', 'update'], ['delete', 'delete'], ['list_assignees', 'assignee list']]) {
    assert.deepEqual(served[action],
      declared[upstream].filter(key => key !== 'agency_id'), action);
  }

  // And the six RPCs this capability reaches are the six it declares: a
  // seventh contract entry with no action behind it would be unreachable.
  const referral = Object.keys(RECORD_CONTRACTS)
    .filter(name => /Referral/.test(name)).sort();
  assert.deepEqual(referral, ['archiveAuthorizedReferral', 'createAuthorizedReferral',
    'getAuthorizedReferral', 'listAuthorizedReferralAssignees', 'listAuthorizedReferrals',
    'updateAuthorizedReferral']);
  for (const name of referral) {
    assert.ok(block.includes(`contract('${name}'`), `${name} is reachable`);
    // One shared refusal vocabulary, because the six ARE one capability.
    assert.deepEqual(RECORD_CONTRACTS[name].codes, RECORD_CONTRACTS.listAuthorizedReferrals.codes);
    assert.ok(RECORD_CONTRACTS[name].codes.every(code => code.startsWith('PENNSYNC_REFERRAL_')));
  }
});

test('the chart export prompt is the original s, interpolation for interpolation', async () => {
  const original = await readFile(resolve(repository,
    'base44/functions/generatePatientChartPDF/entry.ts'), 'utf8');
  const start = original.indexOf('const prompt = `');
  const template = original.slice(start + 'const prompt = `'.length, original.indexOf('`;', start));
  assert.ok(template.length > 2000, 'the original still carries the prompt');
  // A chart whose every field is present, so each interpolation lands on a
  // value and the two sides can be compared line by line.
  const patient = {
    first_name: 'Ada', middle_name: 'Q', last_name: 'Lovelace', date_of_birth: '1815-12-10',
    medical_record_number: 'MRN-1', address: '1 Main St', phone: '555-0100',
    email: 'ada@example.invalid', physician_name: 'Dr Who', physician_phone: '555-0199',
    physician_email: 'dr@example.invalid', emergency_contact_name: 'Next Kin',
    emergency_contact_phone: '555-0111', emergency_contact_relationship: 'sibling',
    primary_diagnosis: 'CHF', secondary_diagnoses: ['COPD'], allergies: 'Penicillin',
    past_medical_history: ['Stroke 2019'],
    baseline_vitals: { blood_pressure_systolic: 120, blood_pressure_diastolic: 80,
      heart_rate: 72, respiratory_rate: 16, temperature: 98.6, oxygen_saturation: 97,
      weight: 150, height: 64, bmi: 25.8 },
    functional_status: { ambulation: 'walker', adl_independence: 'partial',
      cognitive_status: 'alert', fall_risk: 'high' },
    social_history: { living_situation: 'alone', primary_language: 'Welsh',
      support_system: 'daughter', smoking_status: 'former' },
    advance_directives: { has_living_will: true, has_healthcare_proxy: false,
      dnr_status: true },
  };
  const visits = [{ visit_date: '2026-07-01', visit_type: 'skilled_nursing' }];
  const incidents = [{ incident_date: '2026-06-16', incident_type: 'fall', severity: 'high' }];
  const built = buildChartPrompt({ patient, visits, incidents });
  // Every literal RUN of the original's template survives, run by run rather
  // than line by line: this template interpolates mid-line
  // (`BP: ${systolic}/${diastolic}`), so a stripped LINE reads `BP: /` and is
  // in neither prompt. The runs between interpolations are what both sides
  // must share, and the values are asserted below.
  const runs = literal(template.replace(/\$\{/g, '\u0000${')).split('\u0000')
    .map(run => run.trim()).filter(run => /[A-Za-z]/.test(run) && run.length >= 3);
  assert.ok(runs.length > 30, `only ${runs.length} literal runs found`);
  for (const run of runs) {
    for (const line of run.split('\n').map(part => part.trim()).filter(Boolean)) {
      assert.ok(built.includes(line), `the prompt lost: ${line}`);
    }
  }
  // And every value the original would have printed is printed.
  for (const expected of ['Name: Ada Q Lovelace', 'DOB: 1815-12-10', 'MRN: MRN-1',
    'Address: 1 Main St', 'Phone: 555-0100', 'Email: ada@example.invalid',
    'Name: Dr Who', 'Phone: 555-0199', 'Email: dr@example.invalid',
    'Name: Next Kin', 'Phone: 555-0111', 'Relationship: sibling',
    'Primary Diagnosis: CHF', 'Secondary Diagnoses: COPD', 'Allergies: Penicillin',
    'Past Medical History: Stroke 2019', 'BP: 120/80', 'HR: 72 bpm', 'RR: 16 rpm',
    'Temp: 98.6F', 'O2 Sat: 97%', 'Weight: 150 lbs', 'Height: 64 inches', 'BMI: 25.8',
    'Ambulation: walker', 'ADL Independence: partial', 'Cognitive Status: alert',
    'Fall Risk: high', 'Living Situation: alone', 'Primary Language: Welsh',
    'Support System: daughter', 'Smoking Status: former', 'Has Living Will: Yes',
    'Has Healthcare Proxy: No', 'DNR Status: Yes', 'RECENT VISITS (1):',
    '1. 2026-07-01: skilled_nursing', 'CLINICAL INCIDENTS (1):',
    '1. 2026-06-16: fall (high)']) {
    assert.ok(built.includes(expected), `the prompt lost: ${expected}`);
  }
  // The response schema is the original's, field for field.
  const schemaStart = original.indexOf('response_json_schema: {');
  const schema = original.slice(schemaStart, original.indexOf('});', schemaStart));
  for (const key of ['document_content', 'page_count',
    'Full formatted content for the document', 'Estimated page count']) {
    assert.ok(schema.includes(key), `the schema lost ${key}`);
  }
  assert.deepEqual(Object.keys(CHART_EXPORT_SCHEMA.properties), ['document_content', 'page_count']);
  assert.equal(CHART_EXPORT_SCHEMA.properties.page_count.type, 'number');
  // And the original really does render no PDF, despite its name.
  assert.equal(/jsPDF|new Blob|application\/pdf/.test(original), false,
    'the original still renders no PDF');
});

test('the BM25 scorer is the original s, run against it rather than against retyped numbers', async () => {
  // D57's rule. Asserting a table of expected scores would prove the port
  // agrees with numbers somebody typed; this lifts the original's own block
  // out of `entry.ts` and runs both over the same corpus. Perturb any constant
  // in either and this fails.
  const original = await readFile(resolve(repository,
    'base44/functions/searchPDFs/entry.ts'), 'utf8');
  const start = original.indexOf('const TOKEN_RE =');
  const end = original.indexOf('Deno.serve(');
  assert.ok(start > 0 && end > start, 'the original still carries the scoring block');
  const snippetStart = original.indexOf('function extractSnippet(');
  assert.ok(snippetStart > end, 'the snippet helper is below the handler');
  const block = original.slice(start, end) + original.slice(snippetStart);
  const file = join(tmpdir(), `pdfsearch_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(file, transpileTs(
    `${block}\nexport { tokenize, buildBm25, bm25Score, extractSnippet };`).outputText);
  let theirs;
  try { theirs = await import(pathToFileURL(file).href); }
  finally { await unlink(file).catch(() => {}); }

  // A corpus with the properties BM25 actually depends on: different lengths,
  // a term in every document, a term in one, and a document with no text.
  const documents = [
    { id: 'a', extracted_text: 'wound care consent signed by the patient today',
      keywords: ['wound'], page_contents: [{ page_number: 1, text: 'wound care consent' }] },
    { id: 'b', extracted_text: 'wound wound wound dressing changed at the nursing visit '
      + 'and the wound was clean and dry throughout the entire documented encounter',
      keywords: [], page_contents: [{ page_number: 2, text: 'wound dressing changed' }] },
    { id: 'c', extracted_text: 'ambulation improved with a walker', keywords: ['mobility'],
      page_contents: null },
    { id: 'd', extracted_text: '', keywords: ['wound', 'consent'], page_contents: [] },
    { id: 'e', extracted_text: 'consent form for wound photography', keywords: ['consent'],
      page_contents: [{ page_number: 1, text: 'consent form' }] },
  ];

  for (const query of ['wound', 'wound care', 'consent', 'ambulation walker',
    'nothing matches this', 'WOUND CARE', 'wound-care']) {
    const terms = [...new Set(theirs.tokenize(query))];
    assert.deepEqual(tokenize(query), theirs.tokenize(query), `tokenize: ${query}`);
    const mine = buildBm25(documents.map(doc => ({ text: doc.extracted_text || '' })));
    const model = theirs.buildBm25(documents.map(doc => ({ text: doc.extracted_text || '' })));
    assert.equal(mine.N, model.N);
    assert.deepEqual(mine.docLen, model.docLen);
    assert.equal(mine.avgdl, model.avgdl);
    for (let index = 0; index < documents.length; index += 1) {
      assert.equal(bm25Score(mine, index, terms), theirs.bm25Score(model, index, terms),
        `score ${query} #${index}`);
    }
    for (const text of [documents[0].extracted_text, documents[1].extracted_text, '', null]) {
      assert.equal(extractSnippet(text, query), theirs.extractSnippet(text, query),
        `snippet ${query}`);
    }
  }

  // And the composite the handler builds on top — phrase and keyword boosts,
  // the fuzzy gate, the page matches and the sort — reproduced from the
  // original's own pieces rather than from this port's.
  for (const [query, fuzzy] of [['wound', true], ['wound care', true], ['wound care', false],
    ['consent', false], ['ambulation', true]]) {
    const queryLower = query.toLowerCase();
    const terms = [...new Set(theirs.tokenize(query))];
    const model = theirs.buildBm25(documents.map(doc => ({ text: doc.extracted_text || '' })));
    const expected = documents.map((doc, index) => {
      const bm = theirs.bm25Score(model, index, terms);
      const matched = terms.filter(term => (model.tf[index]?.get(term) || 0) > 0);
      const exactPhrase = Boolean(queryLower)
        && (doc.extracted_text || '').toLowerCase().includes(queryLower);
      const keywordMatches = (Array.isArray(doc.keywords) ? doc.keywords : [])
        .map(keyword => String(keyword || '').toLowerCase())
        .filter(keyword => keyword
          && (keyword.includes(queryLower) || queryLower.includes(keyword)));
      const total = bm + (exactPhrase ? 100 : 0) + keywordMatches.length * 5;
      if (!(bm > 0 || exactPhrase || keywordMatches.length > 0)) return null;
      if (!fuzzy && !exactPhrase && !(terms.length > 0 && matched.length === terms.length)) {
        return null;
      }
      return { id: doc.id, search_score: Math.round(total * 100) / 100 };
    }).filter(Boolean).sort((left, right) => right.search_score - left.search_score);
    assert.deepEqual(
      scoreCorpus(documents, { query, fuzzy, limit: 50 })
        .map(row => ({ id: row.id, search_score: row.search_score })),
      expected, `${query} fuzzy=${fuzzy}`);
  }

  // The clamp is the original's, read from its own expression.
  assert.match(original, /Math\.min\(Math\.max\(Math\.floor\(Number\(rawLimit\) \|\| 50\), 1\), 200\)/);
  for (const raw of [500000, -4, 0, undefined, '25', 25.9, 'nonsense', 200, 201]) {
    assert.equal(searchLimit(raw),
      Math.min(Math.max(Math.floor(Number(raw) || 50), 1), 200), String(raw));
  }
});

test('the state-reportable report text is the original s template', async () => {
  const original = await readFile(resolve(repository,
    'base44/functions/submitStateReportableIncident/entry.ts'), 'utf8');
  const start = original.indexOf('function buildReportText(p) {');
  const template = original.slice(start, original.indexOf('`.trim();', start));
  assert.ok(template.includes('STATE REPORTABLE EVENT REPORT'), 'the original still has it');
  const payload = { patient_id: 'patient-a1', patient_name: 'Ada Lovelace',
    event_date: '2026-06-15', event_time: '14:30', event_type: 'Injury of Unknown Origin',
    location_of_event: 'Bathroom', medications: 'Warfarin 5mg', diagnosis: 'CHF',
    factual_description: 'Found on floor.', followup_action: 'MD notified.',
    submitted_by_name: 'A Nurse', submitted_by_title: 'RN' };
  const built = buildReportText(payload, 'SUBMITTED-ON');
  for (const line of literal(template).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('function ') || trimmed === 'return `') continue;
    assert.ok(built.includes(trimmed), `the report lost: ${trimmed}`);
  }
  // Every interpolation lands where the original puts it.
  for (const expected of ['Patient: Ada Lovelace', 'Date of Event: 2026-06-15',
    'Time of Event: 14:30', 'Event Type: Injury of Unknown Origin',
    'Location of Event: Bathroom', 'Warfarin 5mg', 'CHF', 'Found on floor.',
    'MD notified.', 'Submitted By: A Nurse (RN)', 'Submitted On: SUBMITTED-ON']) {
    assert.ok(built.includes(expected), `the report lost: ${expected}`);
  }
  // The two-code event map is read from the original rather than retyped.
  const map = original.slice(original.indexOf('const STATE_EVENT_TO_INCIDENT_TYPE'),
    original.indexOf('};', original.indexOf('const STATE_EVENT_TO_INCIDENT_TYPE')));
  assert.deepEqual([...map.matchAll(/(\w+): '([a-z_]+)'/g)].map(m => [m[1], m[2]]),
    [['IE', 'hospitalized'], ['HC', 'medication_error']]);
  // Comments stripped: the contract's header NAMES both paused halves, and a
  // scan that counted those would fail on the explanation.
  const sql = readFileSync(resolve(repository, 'services/authority-store/supabase/'
    + 'record-migrations/20260920510000_contract_state_incident.sql'), 'utf8')
    .split('\n').filter(line => !line.trim().startsWith('--')).join('\n');
  assert.match(sql, /when 'IE' then 'hospitalized'/);
  assert.match(sql, /when 'HC' then 'medication_error'/);
  assert.match(sql, /else 'other'/);
  // And the two halves this port pauses really are the two the original has.
  assert.match(original, /base44\.functions\.invoke\('createAuthorizedDocument'/);
  assert.match(original, /integrations\.Core\.SendEmail\(/);
  assert.equal(/Core\.SendEmail|createAuthorizedDocument/.test(sql), false,
    'neither is reached from the contract');
});

/**
 * D91. The AI report's arithmetic, against the original's own functions.
 *
 * The proof is in two halves that meet at the aggregates. THIS half shows that
 * the ported path, fed the counts the contract returns, produces the same
 * report object the original produces from the rows those counts were counted
 * from. The other half — that the SQL really counts those rows that way — is
 * `services/authority-store/tests/contract-report-metrics.test.mjs`, against
 * the real migration, with every predicate sabotaged.
 *
 * Neither half proves the port alone, which is D45's rule: this one would pass
 * with a contract that counted the wrong rows, and that one would pass with a
 * bridge that added them up wrongly.
 */
const AI_REPORT_ORIGINAL = 'base44/functions/generateAIReport/entry.ts';

async function aiReportOriginal() {
  const source = readFileSync(resolve(repository, AI_REPORT_ORIGINAL), 'utf8');
  const start = source.indexOf('function calculateMetrics(data) {');
  const trend = source.indexOf('function calculateDailyTrend(');
  const end = source.indexOf('function generatePDFReport(');
  assert.ok(start > 0 && trend > start && end > trend,
    'the original still carries the arithmetic between calculateMetrics and generatePDFReport');
  const block = source.slice(start, source.indexOf('async function generateAIInsights('))
    + source.slice(trend, end);
  const file = join(tmpdir(), `aireport_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(file, transpileTs(
    `${block}\nexport { calculateMetrics, calculateDailyTrend };`).outputText);
  try { return await import(pathToFileURL(file).href); }
  finally { await unlink(file).catch(() => {}); }
}

/** A corpus with the properties the report's arithmetic depends on: a zero
 *  denominator, a null score that still counts, fractional scores, a nurse with
 *  no visits, a visit with no author, and two nurses who tie. */
function aiReportCorpus() {
  const day = n => `2026-09-${String(n).padStart(2, '0')}T08:00:00.000Z`;
  const nurse = 'nurse-a@example.invalid';
  const other = 'nurse-b@example.invalid';
  return {
    visits: [
      { created_by: nurse, status: 'completed' },
      { created_by: nurse, status: 'completed' },
      { created_by: nurse, status: 'scheduled' },
      { created_by: other, status: 'completed' },
      { created_by: other, status: 'completed' },
      { created_by: '', status: 'cancelled' },
    ],
    patients: [
      { status: 'active' }, { status: 'active' }, { status: 'discharged' },
    ],
    incidents: [
      { incident_type: 'fall' }, { incident_type: 'fall' },
      { incident_type: 'hospitalized' }, { incident_type: 'medication_error' },
      { incident_type: 'infection_suspected' },
    ],
    audits: [
      { status: 'passed', compliance_score: 88.5 },
      { status: 'flagged', compliance_score: 61.25 },
      { status: 'critical', compliance_score: 40 },
      { status: 'pending_review', compliance_score: null },
    ],
    trainings: [],
    noteConversions: [
      { nurse_email: nurse, quality_score: 70.5, compliance_improvement: 12.25,
        created_date: day(1) },
      { nurse_email: nurse, quality_score: 80, compliance_improvement: 7.5,
        created_date: day(1) },
      { nurse_email: other, quality_score: 65, compliance_improvement: 3,
        created_date: day(2) },
      { nurse_email: '', quality_score: null, compliance_improvement: null,
        created_date: day(3) },
    ],
    alerts: [
      { severity: 'critical', status: 'active' },
      { severity: 'critical', status: 'resolved' },
      { severity: 'high', status: 'active' },
    ],
    tasks: [
      { status: 'completed' }, { status: 'completed' }, { status: 'pending' },
    ],
    users: [
      { role: 'user', email: nurse },
      { role: 'user', email: other },
      { role: 'user', email: 'nurse-idle@example.invalid' },
    ],
  };
}

/** The aggregates `contract_report_metrics` returns, counted off the corpus
 *  with plain reductions. The SQL that has to agree with these is proved
 *  separately, against the real migration. */
function aiReportAggregates(corpus) {
  const group = (rows, key) => {
    const out = new Map();
    for (const row of rows) {
      const k = (row[key] ?? '').toString().trim().toLowerCase();
      if (!out.has(k)) out.set(k, []);
      out.get(k).push(row);
    }
    return [...out.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  };
  const count = (rows, test) => rows.filter(test).length;
  const sum = (rows, field) => rows.reduce((n, row) => n + (row[field] || 0), 0);
  const days = new Map();
  for (const note of corpus.noteConversions) {
    const key = note.created_date.slice(0, 10);
    days.set(key, (days.get(key) ?? 0) + 1);
  }
  return {
    visits_total: corpus.visits.length,
    visits_completed: count(corpus.visits, v => v.status === 'completed'),
    patients_total: corpus.patients.length,
    patients_active: count(corpus.patients, p => p.status === 'active'),
    falls: count(corpus.incidents, i => i.incident_type === 'fall'),
    hospitalizations: count(corpus.incidents, i => i.incident_type === 'hospitalized'),
    medication_errors: count(corpus.incidents, i => i.incident_type === 'medication_error'),
    audits_total: corpus.audits.length,
    audit_score_sum: sum(corpus.audits, 'compliance_score'),
    audits_passed: count(corpus.audits, a => a.status === 'passed'),
    audits_flagged: count(corpus.audits, a => a.status === 'flagged'),
    audits_critical: count(corpus.audits, a => a.status === 'critical'),
    notes_total: corpus.noteConversions.length,
    note_quality_sum: sum(corpus.noteConversions, 'quality_score'),
    note_improvement_sum: sum(corpus.noteConversions, 'compliance_improvement'),
    critical_alerts: count(corpus.alerts, a => a.severity === 'critical' && a.status === 'active'),
    tasks_total: corpus.tasks.length,
    tasks_completed: count(corpus.tasks, t => t.status === 'completed'),
    roster: corpus.users.map(u => u.email).sort(),
    roster_size: corpus.users.length,
    daily_notes: [...days.entries()].sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([dayKey, n]) => ({ day: dayKey, count: n })),
    nurse_visits: group(corpus.visits, 'created_by').map(([email, rows]) => ({
      email, total: rows.length, completed: count(rows, v => v.status === 'completed'),
    })),
    nurse_notes: group(corpus.noteConversions, 'nurse_email').map(([email, rows]) => ({
      email, count: rows.length,
      quality_sum: sum(rows, 'quality_score'),
      improvement_sum: sum(rows, 'compliance_improvement'),
    })),
    training_completed: 'served_by_hub',
    training_score: 'served_by_hub',
  };
}

test('the AI report is the original s arithmetic over the contract s counts', async () => {
  const theirs = await aiReportOriginal();
  const corpus = aiReportCorpus();
  const startDate = new Date('2026-08-31T00:00:00.000Z');
  const endDate = new Date('2026-09-05T00:00:00.000Z');

  const expected = theirs.calculateMetrics({
    ...corpus,
    dailyEnhancementTrend: theirs.calculateDailyTrend(
      corpus.noteConversions, startDate, endDate),
  });
  const actual = reportMetrics(aiReportAggregates(corpus), startDate, endDate);

  // The two training figures are the only fields that may differ, and they
  // differ on purpose: D84 settles that leg on the Support Hub, so the port
  // reports its absence where the original would print a zero.
  assert.equal(expected.staff_performance.training_completed, 0);
  assert.equal(expected.staff_performance.avg_training_score, 0);
  assert.equal(actual.staff_performance.training_completed, null);
  assert.equal(actual.staff_performance.avg_training_score, null);
  const strip = report => ({
    ...report,
    staff_performance: Object.fromEntries(Object.entries(report.staff_performance)
      .filter(([key]) => key !== 'training_completed' && key !== 'avg_training_score')),
  });
  assert.deepEqual(strip(actual), strip(expected));

  // Spelled out, so a reader can see the fields this is actually about rather
  // than trusting one deepEqual: the averages, the rates and the staff table.
  assert.equal(expected.overview.completion_rate, '66.7');
  assert.equal(expected.compliance.avg_score, '47.4');
  assert.equal(expected.patient_outcomes.fall_rate, '333.33');
  assert.equal(expected.ai_documentation.avg_quality_score, '53.9');
  assert.equal(expected.staff_performance.nurse_stats.length, 2);
  assert.equal(expected.staff_performance.nurse_stats[0].visits_completed, 2);
});

test('nothing a colleague could be identified by reaches the model', async () => {
  // D64. The original sends the whole metrics object to `InvokeLLM`, and
  // `nurse_stats` carries each top performer's name and address. The prompt
  // asks for trends and benchmarks; it has no use for who anybody is.
  const corpus = aiReportCorpus();
  const metrics = reportMetrics(aiReportAggregates(corpus),
    new Date('2026-08-31T00:00:00.000Z'), new Date('2026-09-05T00:00:00.000Z'));
  const prompt = insightPrompt(metrics, 'monthly_operations');
  for (const user of corpus.users) {
    assert.equal(prompt.includes(user.email), false,
      `${user.email} reached the prompt`);
  }
  // And the shape a model can actually use is still there.
  assert.ok(prompt.includes('"visits_completed"'));
  assert.ok(prompt.includes('"total_nurses": 3'));
  // The staff table itself is unchanged for the PDF, which goes to the
  // administrator whose own roster it is.
  assert.equal(metrics.staff_performance.nurse_stats[0].email, 'nurse-a@example.invalid');
});

test('the daily trend keeps its day in a zone west of UTC', async () => {
  // `calculateDailyTrend` buckets with `setHours(0, 0, 0, 0)`, which is LOCAL
  // time, while the contract counts by UTC day. In a UTC process the two agree
  // whatever instant the bridge picks, so a midnight stub passes every other
  // test in this file and shifts every bar a day back in any western zone —
  // which is where this service would actually run. Noon is what makes the two
  // frames agree, and this is the only test that can tell.
  const previous = process.env.TZ;
  process.env.TZ = 'America/New_York';
  try {
    const trend = reportTrend(
      { daily_notes: [{ day: '2026-09-01', count: 2 }, { day: '2026-09-03', count: 1 }] },
      new Date('2026-08-31T00:00:00.000Z'), new Date('2026-09-04T00:00:00.000Z'));
    const counted = Object.fromEntries(trend.map(d => [d.fullDate, d.count]));
    assert.equal(counted['2026-09-01'], 2, 'a note counted on the 1st belongs to the 1st');
    assert.equal(counted['2026-09-03'], 1);
    assert.equal(counted['2026-08-31'], 0, 'nothing may fall back a day');
    assert.equal(trend.reduce((n, d) => n + d.count, 0), 3, 'and nothing may fall out entirely');
  } finally {
    if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
  }
});

test('the carried report blocks are the original s text, with four named changes', async () => {
  // D81's rule for the handout templates, applied to arithmetic: the numbers in
  // `calculateMetrics` are figures an administrator acts on, so they are copied
  // rather than retyped, and this is what makes "copied" checkable. Every
  // adaptation is reconstructed here from the original, so a fifth one — or a
  // quietly edited average — fails rather than passing as a copy.
  const original = readFileSync(resolve(repository, AI_REPORT_ORIGINAL), 'utf8');
  const ported = readFileSync(resolve(repository,
    'services/pennsync-api/report-metrics-source.mjs'), 'utf8');

  const slice = (from, to) => {
    const start = original.indexOf(from);
    const end = original.indexOf(to);
    assert.ok(start > 0 && end > start, `the original still carries ${from}`);
    return original.slice(start, end);
  };
  const metrics = slice('function calculateMetrics(data) {', 'async function generateAIInsights(');
  const trend = slice('function calculateDailyTrend(', 'function generatePDFReport(');
  let pdf = original.slice(original.indexOf('function generatePDFReport('));

  // 1. The builder takes a jsPDF-shaped object instead of constructing one.
  pdf = pdf.replace(
    '  const { report_type, date_range_days, startDate, endDate, metricsData, aiInsights, user } = config;\n  \n  const doc = new jsPDF();\n',
    '  const { report_type, date_range_days, startDate, endDate, metricsData, aiInsights, user, generatedAt } = config;\n');
  // 3. Renamed and exported.
  pdf = pdf.replace('function generatePDFReport(config) {', 'export function buildAiReport(doc, config) {');
  // 2. The clock is supplied.
  pdf = pdf.replace("doc.text(`Generated: ${new Date().toLocaleString()}`, 105, 57, { align: 'center' });",
    'doc.text(`Generated: ${generatedAt}`, 105, 57, { align: \'center\' });');
  // 4. The two training lines render only when their figures are present (D84).
  pdf = pdf.replace(
    '  addText(`Training Completed: ${metricsData.staff_performance.training_completed}`, 9);\n'
    + '  addText(`Avg Training Score: ${metricsData.staff_performance.avg_training_score}/100`, 9);',
    '  if (metricsData.staff_performance.training_completed !== null) {\n'
    + '    addText(`Training Completed: ${metricsData.staff_performance.training_completed}`, 9);\n'
    + '  }\n'
    + '  if (metricsData.staff_performance.avg_training_score !== null) {\n'
    + '    addText(`Avg Training Score: ${metricsData.staff_performance.avg_training_score}/100`, 9);\n'
    + '  }');
  assert.equal(pdf.includes('new jsPDF'), false, 'adaptation 1 no longer applies to the original');
  assert.equal(pdf.includes('new Date().toLocaleString()'), false,
    'adaptation 2 no longer applies to the original');
  assert.ok(pdf.includes('training_completed !== null'), 'adaptation 4 no longer applies');

  const expected = `export ${metrics}\nexport ${trend}\n${pdf}`;
  const body = ported.slice(ported.indexOf('export function calculateMetrics(data) {'));
  assert.equal(body, expected,
    'services/pennsync-api/report-metrics-source.mjs has drifted from its original.\n'
    + 'Change the original and the carried copy together, or neither.');
});
