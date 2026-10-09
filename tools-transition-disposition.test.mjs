import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACTIVE_DISPOSITIONS, ACTIVITY_TRAIL_MIGRATION, AUDITED_ENTITIES, DISPOSITIONS, FORMAT, FORMAT_VERSION,
  CHART_SCOPE_EVIDENCE, MUTATING, PORT_BLOCKERS, RETENTION_BASES, checkCoverage, classifyPortBlocker,
  discoverActivityTrail, discoverChartScope,
  discoverCapabilities, discoverEntityPolicies, discoverEvidence, discoverInertFunctions, discoverIntegrations,
  discoverPausedFunctions, discoverPolicylessEntities, discoverPortBlockers, discoverPortedFunctions,
  classifyWithoutEntities, discoverEntityFreeBlockers,
  entitiesTouched, isInertFunction, isPausedFunction, isRefusingHandler, main, parseManifest,
  discoverClaimsOnlyFunctions, TRUSTED_CLAIMS_FENCE,
  invokedFunctions, classifyWithoutInvocations, discoverInvocationFreeBlockers,
  portQueueLine, writtenColumns, maskLiteralsAndComments,
  markdownPages, portQueueQuotations,
} from './tools-transition-disposition.mjs';
import { PROFILE_SELF_WRITABLE, RECORD_MIGRATION_FILE } from './tools-entity-schema-plan.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)));
const manifest = (patch = {}) => ({
  format: FORMAT, version: FORMAT_VERSION, review_state: 'proposed', retention: {},
  functions: { alpha: 'port' }, entities: { Beta: 'broker' },
  workflows: { 'Gamma.jsonc': 'preserved_paused' }, integrations: { InvokeLLM: 'port' },
  ...patch,
});
const retired = (patch = {}) => manifest({ entities: { Beta: 'retire' }, ...patch });
const capabilities = (patch = {}) => ({
  functions: ['alpha'], entities: ['Beta'], workflows: ['Gamma.jsonc'], integrations: ['InvokeLLM'], ...patch,
});

test('every repository capability carries exactly one disposition', () => {
  // The committed manifest is the gate: a new function, entity, workflow or
  // Core integration fails this test until it is classified.
  const raw = readFileSync(resolve(repository, 'tools-transition-disposition.json'), 'utf8');
  const report = checkCoverage(discoverCapabilities(repository), parseManifest(raw));
  assert.deepEqual(report.missing_disposition, []);
  assert.deepEqual(report.unknown_capability, []);
  assert.equal(report.coverage_complete, true);
  assert.ok(report.families.functions.capabilities > 250);
  assert.ok(report.families.entities.capabilities > 250);
});

test('no committed disposition contradicts the source it describes', () => {
  const raw = readFileSync(resolve(repository, 'tools-transition-disposition.json'), 'utf8');
  const report = checkCoverage(discoverCapabilities(repository), parseManifest(raw), discoverEvidence(repository));
  assert.deepEqual(report.contradicted_disposition, []);
  assert.equal(report.evidence_consistent, true);
  // The check must be looking at a real population, not an empty one. The
  // floor guards against a discovery that finds nothing; it is not a count to
  // hold. The owner's 2026-10-08 releases took the population below the 25 it
  // used to name, because each released endpoint does work again; the
  // e-signature release alone retired fifteen static 503 stubs. What remains
  // inert is deliberate (the PDGM payment trio, one retired endpoint and one
  // maintenance cleanup), so the floor asks only that discovery found any.
  assert.ok(report.inert_functions > 0, `only ${report.inert_functions} inert functions found`);
});

test('every retirement says where its existing rows go', () => {
  const raw = readFileSync(resolve(repository, 'tools-transition-disposition.json'), 'utf8');
  const committed = parseManifest(raw);
  const report = checkCoverage(discoverCapabilities(repository), committed, discoverEvidence(repository));
  assert.deepEqual(report.retention_unspecified, [], 'a retired entity has no retention basis');
  assert.deepEqual(report.retention_unused, [], 'a retention basis names something that is not retired');
  assert.equal(report.retention_settled, true);
  // Retiring a table is a decision about the target store, never a deletion:
  // the access and security records keep the full HIPAA documentation period.
  for (const name of ['AuditTrail', 'SecurityLog', 'UserActivity', 'ArchivedRecord', 'SystemLog',
    'AnomalyAlert', 'TimeSavings']) {
    assert.equal(committed.entities[name], 'retire', `${name} should be retired`);
    assert.deepEqual(committed.retention[name], { basis: 'archive', years: 6 },
      `${name} must keep its rows for the full period`);
  }
  // A mirror of somebody else's record names the system that holds it.
  for (const name of ['Subscription', 'SubscriptionSettings']) {
    assert.equal(committed.retention[name].basis, 'external_system_of_record');
    assert.ok(committed.retention[name].system.trim().length > 0);
  }
});

test('a retirement with nowhere for its rows fails the gate', () => {
  const report = checkCoverage(capabilities(), retired(), { inertFunctions: [] });
  assert.deepEqual(report.retention_unspecified, ['entities:Beta']);
  assert.equal(report.retention_settled, false);
  assert.equal(report.census_ready, false);
  // Naming where they go settles it.
  const settled = checkCoverage(capabilities(), retired({ retention: { Beta: { basis: 'archive', years: 6 } } }));
  assert.deepEqual(settled.retention_unspecified, []);
  assert.equal(settled.retention_settled, true);
});

test('a retention basis for something that is not retired is reported', () => {
  const report = checkCoverage(capabilities(), manifest({ retention: { Beta: { basis: 'archive', years: 6 } } }));
  assert.deepEqual(report.retention_unused, ['entities:Beta']);
  assert.equal(report.retention_settled, false);
});

test('an unsettled retirement blocks the census even when owners accepted', () => {
  const report = checkCoverage(capabilities(), retired({ review_state: 'accepted' }), { inertFunctions: [] });
  assert.equal(report.coverage_complete, true);
  assert.equal(report.evidence_consistent, true);
  assert.equal(report.census_ready, false, 'retention must be settled before the census is usable');
  assert.equal(checkCoverage(capabilities(), retired({
    review_state: 'accepted', retention: { Beta: { basis: 'none', years: 0 } },
  })).census_ready, true);
});

test('the retention bases are the exact reviewed set', () => {
  assert.deepEqual([...RETENTION_BASES].sort(), ['archive', 'external_system_of_record', 'none']);
});

test('a fail-closed endpoint is never declared port, broker or hub', () => {
  // These are quarantined, paused or retired in the repository: each serves one
  // constant response and reaches nothing. Declaring any of them active would
  // send a reviewer to port an endpoint that has no behavior left to port.
  const declared = parseManifest(readFileSync(resolve(repository, 'tools-transition-disposition.json'), 'utf8')).functions;
  const inert = discoverInertFunctions(repository);
  // runSecurityAudit, generateDischargeSummary, generatePatientEducation,
  // analyzeDocument, analyzeNursePerformance and getUserActivityLog left this
  // list on 2026-10-08 (owner decision): they do work again and keep their
  // preserved_paused disposition.
  for (const name of ['getPatientContext']) {
    assert.ok(inert.includes(name), `${name} should be detected as inert`);
    assert.equal(ACTIVE_DISPOSITIONS.includes(declared[name]), false,
      `${name} is declared ${declared[name]} but performs no work`);
  }
  // The retired endpoint is retired, not merely paused.
  assert.equal(declared.getPatientContext, 'retire');
  // Restored by the owner on 2026-10-08 and doing work again; they keep
  // `preserved_paused` (Base44-hosted, not new port work), so the port queue
  // does not move. analyzeClinicalData, autoAssignNurseToPatient and
  // computeOutcomeMeasures joined them the same day ("turn everything on").
  for (const name of [
    'analyzeNursePerformance', 'getUserActivityLog',
    'analyzeClinicalData', 'autoAssignNurseToPatient', 'computeOutcomeMeasures',
  ]) {
    assert.equal(inert.includes(name), false, `${name} performs work again`);
    assert.equal(declared[name], 'preserved_paused');
  }
  // trackUserLogin was a constant 503 and records the caller's own sign-in
  // again (owner decision, 2026-10-08); markSmsRead is the new SmsMessage
  // read-marker. Both keep or take `preserved_paused`, so the port queue does
  // not move.
  for (const name of ['trackUserLogin', 'markSmsRead']) {
    assert.equal(inert.includes(name), false, `${name} performs work`);
    assert.equal(declared[name], 'preserved_paused');
  }
});

test('a handler that refuses from its first statement is paused, whatever gates it', () => {
  // The second pause shape, and the reason it needed finding: the flag check
  // looks for `const FLAG = false`, and nine modules here pause with no flag
  // at all — the refusal is simply the first statement of the handler, with
  // the real body unreachable below it. Six of them were carried `port` and
  // counted as writable work until this was measured.
  const paused = "Deno.serve(async (req) => {\n"
    + "  // SECURITY CONTAINMENT: keep the legacy bulk Patient writer unreachable.\n"
    + "  return Response.json({ error: 'paused' }, { status: 503 });\n"
    + "  try { const base44 = createClientFromRequest(req); } catch {}\n});";
  assert.equal(isRefusingHandler(paused), true);
  // A block comment says why just as often as a line comment does.
  assert.equal(isRefusingHandler('Deno.serve(async (req) => {\n/* paused */\nreturn x;\n});'), true);
  // And everything else is live. A guard, an assignment or an await FIRST
  // means some caller gets through, so the shape errs toward calling a module
  // live exactly as the flag check does.
  assert.equal(isRefusingHandler('Deno.serve(async (req) => { if (!ok) return deny; return run(); });'), false);
  assert.equal(isRefusingHandler('Deno.serve(async (req) => { const body = await req.json(); return run(body); });'), false);
  assert.equal(isRefusingHandler('Deno.serve(async (req) => { await audit(req); return deny; });'), false);
  // An expression-bodied handler has no first statement to inspect; that is
  // `isInertFunction`'s question, not this one's.
  assert.equal(isRefusingHandler('Deno.serve(req => handle(req, client));'), false);
  assert.equal(isRefusingHandler(null), false);
  // The six this found are carried paused now, and the gate refuses any of
  // them being called active again.
  const declared = parseManifest(readFileSync(
    resolve(repository, 'tools-transition-disposition.json'), 'utf8')).functions;
  const paused_names = discoverPausedFunctions(repository);
  for (const name of ['predictPatientRisks', 'predictiveRiskAnalysis']) {
    assert.ok(paused_names.includes(name), `${name} should be detected as paused`);
    assert.equal(ACTIVE_DISPOSITIONS.includes(declared[name]), false,
      `${name} is declared ${declared[name]} but refuses every caller`);
  }
  // Released by the owner on 2026-10-08 ("turn everything on"): no longer
  // refusing from the first statement, and kept `preserved_paused` (Base44-
  // hosted, not new port work) so the port queue does not move.
  for (const name of ['calculateDataQualityScores', 'enforceDataCompleteness',
    'monitorClinicalDataForCarePlanUpdates']) {
    assert.equal(paused_names.includes(name), false, `${name} serves callers again`);
    assert.equal(declared[name], 'preserved_paused');
  }
  // The sixth, processDischargeReport, was released by the owner on
  // 2026-10-08 (admin-only, one agency). Its handler no longer refuses from
  // its first statement, and it keeps `preserved_paused` rather than moving
  // to `port`: it runs on Base44 and is not migration work this change adds.
  assert.equal(paused_names.includes('processDischargeReport'), false);
  assert.equal(declared.processDischargeReport, 'preserved_paused');
});

test('a module whose only entity is the retired trail is re-classified by what else it needs', () => {
  // `classifyPortBlocker` answers with the first thing it finds and entities
  // come first, which is right while the record store is the question. It
  // stops being right for a module whose only entity is one of D25's three
  // retired log tables: the trail IS that module's record half, already built.
  const withFile = "base44.asServiceRole.entities.UserActivity.create({});\nUploadFile({ file });";
  assert.equal(classifyPortBlocker(withFile), 'records_schema');
  assert.equal(classifyWithoutEntities(withFile), 'files');
  const withKey = "await base44.asServiceRole.entities.UserActivity.create({});\n"
    + "const k = Deno.env.get('OPENAI_API_KEY');";
  assert.equal(classifyWithoutEntities(withKey), 'external_secret');
  // Masking is not reordering. A module that reads a CHART and uploads a file
  // waits on the chart first, and this leaves that untouched — the refinement
  // only consults the entity-free verdict when every entity is an audited one.
  const withChart = "base44.entities.Patient.get(id);\nUploadFile({ file });";
  assert.equal(classifyPortBlocker(withChart), 'records_schema');
  // A module with nothing else to wait on stays where it was.
  assert.equal(classifyWithoutEntities('base44.entities.UserActivity.create({})'), 'none');
  assert.equal(classifyWithoutEntities(null), 'records_schema');
  // The discovery reads every module, so the evidence and the classifier
  // cannot drift apart.
  const entityFree = discoverEntityFreeBlockers(repository);
  assert.equal(entityFree.transcribeAudioWithWhisper, 'external_secret');
  assert.equal(entityFree.mergePDFs, 'files');
  // The verdict is about the MODULE, so it still reads the handout's send.
  // What took the handout out of that bucket is D81's port, not a change here:
  // a written capability is `none` whatever its original reaches.
  assert.equal(entityFree.generatePatientHandout, 'core_integration');
  // And the four it actually found are in the buckets that describe them.
  const report = checkCoverage(
    discoverCapabilities(repository),
    parseManifest(readFileSync(resolve(repository, 'tools-transition-disposition.json'), 'utf8')),
    discoverEvidence(repository),
  );
  for (const [name, blocker] of [['mergePDFs', 'files'], ['reorderDeletePDFPages', 'files'],
    ['generatePatientHandout', 'none'],
    ['transcribeAudioWithWhisper', 'external_secret']]) {
    assert.ok(report.port_blockers[blocker].includes(name),
      `${name} should wait on ${blocker}`);
    assert.equal(report.port_blockers.records_schema.includes(name), false);
  }
});

/**
 * The port-queue readings in this tree that are deliberately NOT current.
 *
 * Every one is a dated before/after: prose recording what a bucket used to say
 * in order to explain what moved it. They cannot be told from a stale copy by
 * their figures — that is the whole difficulty — so they are declared here with
 * a reason, and anything else quoting a reading has to agree with the tool.
 *
 * This list grows only when somebody writes a new before/after, which is rare
 * and deliberate. The list it replaces grew every time somebody wrote a page,
 * which is silent, and it omitted three pages that way.
 */
const HISTORICAL_PORT_QUEUE_READINGS = [
  {
    page: 'docs/BASE44_EXIT_DECISIONS_2026-09-19.md',
    reading: 'records_schema=94',
    reason: 'D25\'s before column: what the queue said when any entity access counted as waiting on the store',
  },
  {
    page: 'docs/BASE44_EXIT_DECISIONS_2026-09-19.md',
    reading: 'entity_not_carried=34 entity_authorization=34 records_schema=25',
    reason: 'the after column beside it, showing the redistribution rather than the total moving',
  },
  {
    page: 'docs/BASE44_TO_RAILWAY_TRANSITION_PLAN_2026-09-19.md',
    reading: 'entity_not_carried=7 entity_authorization=8 patient_access_model=0 records_schema=0 '
      + 'files=12 ported_function=0 core_integration=2 pdf_rendering=0 external_secret=2 none=73',
    reason: 'the row\'s own "it read, when this row was written" reading, kept to show the ten buckets the current line omits when empty',
  },
  {
    page: 'docs/BASE44_TO_RAILWAY_TRANSITION_PLAN_2026-09-19.md',
    reading: 'records_schema=94 files=4 ported_function=1 core_integration=1 pdf_rendering=0 external_secret=1 none=10',
    reason: 'the same row\'s "it began as" reading, the origin every later correction is measured against',
  },
  {
    page: 'docs/BASE44_TO_RAILWAY_TRANSITION_PLAN_2026-09-19.md',
    reading: 'records_schema=80',
    reason: 'the queue an earlier conclusion was true of, quoted to say why that conclusion expired',
  },
  // D223's three, which arrived in this list the moment the pages became
  // discovered rather than listed: the decisions document was in the tree
  // carrying them before this check could see it, so they are not new prose
  // somebody wrote past a gate. That is the discovery change working — a
  // roster would have gone on omitting them — and it is also why the entry
  // itself said "nothing in this tree reads this document at all", which was
  // true when it was written and is now false. **That sentence has since been
  // corrected in the entry itself**, in the same change that added the fourth
  // reading below; the readings are declared here either way, because they are
  // dated before/afters and not stale copies.
  // The entry that USED to sit here declared `entity_authorization=5 files=12
  // external_secret=2 none=79` as D223's dated reading, and it was right on a
  // tree without this port. With the duty contract present that reading IS the
  // measurement, quotations equal to the measurement are skipped before any
  // declaration is consulted, and a declaration nothing matches fails the
  // check below. So the entry went, and the one under it arrived: on main the
  // footnote's OTHER figure was the live measurement and needed no
  // declaration, and here it is the historical one. Both readings are correct
  // and which of them is history depends on the tree, so expect this pair to
  // swap again the next time a port moves `entity_authorization`.
  // **The swap the comment above predicted has HAPPENED, on this tree.** That
  // paragraph said the pair would trade places the next time a port moved the
  // queue, and this change moves `files` 12 → 9 and `none` 79 → 82: the three
  // file capabilities ported, and the duty toggle this branch carried was
  // WITHDRAWN in favour of the contract `main` already holds. So D223's reading
  // is history again rather than the measurement, and the entry that was
  // removed when it became the measurement is back, unchanged. It was deleted
  // for being correct, not for being wrong, which is why restoring it is the
  // resolution and not a regression.
  {
    page: 'docs/BASE44_EXIT_DECISIONS_2026-09-19.md',
    reading: 'entity_authorization=5 files=12 external_secret=2 none=79',
    reason: 'D223\'s own dated reading, from `--summary` at the head that decision was written '
      + 'on, which is history again now that the file ports have moved `files` and `none`',
  },
  {
    page: 'docs/BASE44_EXIT_DECISIONS_2026-09-19.md',
    reading: 'entity_authorization=6 files=12 external_secret=2 none=78',
    reason: 'the collector\'s footnote reading on `00ccac41` and on the collection branch, '
      + 'quoted to show one instrument answering on three trees rather than two reports disagreeing',
  },
  // The FOURTH, which D223's three do not cover and which is undeclared without
  // it: the collector's footnote reproduces the OTHER figure in circulation as
  // well, to show that two readings fifteen minutes apart were one instrument
  // over three trees rather than a disagreement. It is the reading on
  // `00ccac41`, and declaring only the `d8c6be2b` pair leaves it failing.
  {
    page: 'docs/BASE44_EXIT_DECISIONS_2026-09-19.md',
    reading: 'entity_authorization=6 files=12 external_secret=2 none=78',
    reason: 'the same footnote reproducing the figure on `00ccac41` from the collector\'s own '
      + 'seat, which is what establishes the two were never in conflict',
  },
  {
    page: 'docs/BASE44_EXIT_DECISIONS_2026-09-19.md',
    reading: 'entity_authorization=5 files=12',
    reason: 'the first half of the collector\'s footnote reproducing that same reading from its '
      + 'own seat, which wraps mid-line, so the parser sees one quotation in two pieces',
  },
  {
    page: 'docs/BASE44_EXIT_DECISIONS_2026-09-19.md',
    reading: 'external_secret=2 none=79',
    reason: 'the second half of that wrapped footnote line, declared separately for the same '
      + 'reason: a quotation is per line, and neither half on its own is a reading of anything',
  },
  // And the swap the comment above predicted, arriving one port later and from
  // the other direction: this port moves `files` rather than
  // `entity_authorization`, so D223's own entry line stops being the
  // measurement while both halves of the footnote keep the standing they had.
  // It is a dated reading and says so in its own words — "at the head this
  // change was written on" — so it is declared rather than corrected. The
  // figure in a sentence that claims the present tense was corrected instead,
  // on the three pages carrying one.
  {
    page: 'docs/BASE44_EXIT_DECISIONS_2026-09-19.md',
    reading: 'entity_authorization=5 files=12 external_secret=2 none=79',
    reason: "D223's own reading at the head it was written on, which this port's `files` 12 → 11 "
      + 'turns into history without touching what D223 measured',
  },
];

test('the pages carrying the port queue carry what the tool measures', () => {
  // D79 fixed two stale bucket descriptions with assertions rather than better
  // prose, and the prose about the buckets then went stale the same way: the
  // page said "the `none` bucket has nothing startable left: it is 73" while
  // D84 had deliberately moved three capabilities into `records_schema`, and
  // its parenthetical still listed `entity_not_carried` 7 and
  // `core_integration` 2, both of which are 0. Nothing failed, because nothing
  // compared the page with the tool. A reader acting on that sentence would
  // have concluded the queue was exhausted while three ports waited.
  const report = checkCoverage(
    discoverCapabilities(repository),
    parseManifest(readFileSync(resolve(repository, 'tools-transition-disposition.json'), 'utf8')),
    discoverEvidence(repository),
  );
  const line = portQueueLine(report);

  // The go-live plan restates this queue for a reader deciding where the
  // finish line is, and #250 pinned AGENTS.md while leaving that page
  // unguarded: on 2026-09-23 it still read `records_schema=3 ... none=75`
  // against a measured `none=78` with `records_schema` empty, so it told a
  // reader three ports were waiting that had all been written. The remedy both
  // times was to add a page to a literal list, and the list then omitted a
  // third: the transition plan carried `entity_authorization=7` against a
  // measured 6, in TWO places, with every suite green. A roster of pages is a
  // mechanism for omitting the next page, so the pages are discovered now and
  // only the history below is declared.
  // The transition plan was nearly pinned here as a third page, and was not,
  // because what it needed was a sentence deleted rather than a pin. Two of its
  // clauses claimed the figure was held to the tool when only these two pages
  // were; the discovery walk below already catches a copy that has gone WRONG
  // there, which is the case that bites, so a pin would have bought only the
  // case where somebody removes the line. Against that: pinning a page makes a
  // MISSING line fail, which reds every open branch's merge ref at once on a
  // base state nobody caused. The false clauses are gone from that page and no
  // pin was added.
  for (const path of ['AGENTS.md', 'docs/RAILWAY_GO_LIVE_PLAN_2026-09-21.md']) {
    const page = readFileSync(resolve(repository, path), 'utf8');
    assert.ok(page.includes(line),
      `${path} does not carry the measured port queue.\n  measured: ${line}\n`
      + '  Update the port-queue line there, and the decisions doc\'s ledger line,\n'
      + '  in the SAME change as whatever moved the queue.');
  }

  // Everywhere ELSE the reading is quoted, discovered rather than named. A run
  // that is not the measured payload must be a reading somebody declared as
  // history, with its reason — and the reason is the deliverable, because the
  // figures alone cannot say whether a run is a dated before/after or a copy
  // that went stale. That is why history is declared and pages are not.
  const payload = line.replace(/^port queue: /, '');
  const declared = new Map(HISTORICAL_PORT_QUEUE_READINGS.map(
    entry => [`${entry.page}\u0000${entry.reading}`, entry.reason]));
  const seen = new Set();
  const undeclared = [];
  for (const page of markdownPages(repository)) {
    const text = readFileSync(resolve(repository, page), 'utf8');
    for (const quotation of portQueueQuotations(text, Object.keys(report.port_blockers))) {
      if (quotation.reading === payload) continue;
      const key = `${page}\u0000${quotation.reading}`;
      if (declared.has(key)) { seen.add(key); continue; }
      undeclared.push(`  ${page}:${quotation.line}\n    ${quotation.reading}`);
    }
  }
  assert.deepEqual(undeclared, [],
    'a page quotes a port-queue reading that is neither the measurement nor declared history:\n'
    + `${undeclared.join('\n')}\n`
    + `  measured: ${payload}\n`
    + '  If it is meant to be current, update it — and note that a stale copy can sit\n'
    + '  mid-sentence with only the `port queue:` prefix missing, in the same sentence\n'
    + '  that tells the reader to run the tool. If it is a dated before/after, add it to\n'
    + '  HISTORICAL_PORT_QUEUE_READINGS with a reason.');

  // A declaration nothing matches is a stale exemption, which is the failure
  // mode an exemption list has: it outlives the text it was written for and
  // then covers whatever drifts into its shape next.
  assert.deepEqual([...declared.keys()].filter(key => !seen.has(key)).map(key => key.split('\u0000').join(': ')), [],
    'HISTORICAL_PORT_QUEUE_READINGS names a reading no page carries; remove the entry');
  const page = readFileSync(resolve(repository, 'AGENTS.md'), 'utf8');

  // The counts alone would pass a swap — one capability into a bucket and one
  // out leaves every number where it was — so the startable set is pinned by
  // NAME as well. This is the state the test exists to stop anybody asserting
  // in prose: D79 wrote "nothing startable left" into AGENTS.md, D84 then moved
  // three capabilities back in, and nothing failed. The bucket reached zero
  // again at D91 and is back at one, on a correction to `writtenColumns` rather
  // than on a decision.
  assert.deepEqual(report.port_blockers.records_schema, [],
    'the startable set changed; re-read what each entry now waits on and move AGENTS.md with it');
  for (const name of report.port_blockers.records_schema) {
    assert.ok(page.includes(name), `AGENTS.md should name ${name} as startable`);
  }
});

test('a reading is grouped by what separates its tokens, not by its line', () => {
  const buckets = ['entity_not_carried', 'entity_authorization', 'records_schema', 'files', 'none'];

  // The form, and the form with its prefix removed, are the same reading: the
  // prefix is exactly the half the transition plan's mid-sentence copy dropped,
  // so keying on it would have read a complete stale payload as prose.
  assert.deepEqual(portQueueQuotations('port queue: files=12 none=78', buckets),
    [{ line: 1, reading: 'files=12 none=78' }]);
  assert.deepEqual(portQueueQuotations('it now reads `files=12 none=78`, and the tool', buckets),
    [{ line: 1, reading: 'files=12 none=78' }]);

  // A table's BEFORE column is a different reading from its AFTER column, and a
  // cell boundary is what says so. Group them and the decisions document's
  // before/after row becomes one nonsensical run that no declaration matches.
  assert.deepEqual(portQueueQuotations('| records_schema=94 | **files=4**, none=10 |', buckets),
    [{ line: 1, reading: 'records_schema=94' }, { line: 1, reading: 'files=4 none=10' }]);

  // Prose between two tokens ends the run for the same reason.
  assert.deepEqual(portQueueQuotations('files=12 today, and none=78 after the ports landed', buckets),
    [{ line: 1, reading: 'files=12' }, { line: 1, reading: 'none=78' }]);

  // Line numbers are reported so a failure can be opened, and a bucket name
  // without a count is not a reading — the prose names buckets constantly.
  assert.deepEqual(portQueueQuotations('one\ntwo none=78\n', buckets),
    [{ line: 2, reading: 'none=78' }]);
  assert.deepEqual(portQueueQuotations('the `files` bucket is empty', buckets), []);
});

test('markdown pages are discovered, including from a directory sources skip', async () => {
  // The roster this replaced omitted three pages, so the walk is proved rather
  // than assumed: a page added anywhere has to appear without anything being
  // told about it. Test directories are deliberately NOT skipped, because
  // skipping one is how the same omission comes back a level down.
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const root = mkdtempSync(resolve(tmpdir(), 'pennsync-pages-'));
  try {
    writeFileSync(resolve(root, 'README.md'), '');
    mkdirSync(resolve(root, 'docs'));
    writeFileSync(resolve(root, 'docs/deep.md'), '');
    mkdirSync(resolve(root, 'tests'));
    writeFileSync(resolve(root, 'tests/fixture.md'), '');
    mkdirSync(resolve(root, 'node_modules'));
    writeFileSync(resolve(root, 'node_modules/vendor.md'), '');
    writeFileSync(resolve(root, 'notes.txt'), '');
    assert.deepEqual(markdownPages(root).sort(),
      ['README.md', 'docs/deep.md', 'tests/fixture.md']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  // And the real tree's pages include the three that carry the reading, so the
  // walk this test proves is the one the pin above actually runs.
  const pages = markdownPages(repository);
  for (const page of ['AGENTS.md', 'docs/RAILWAY_GO_LIVE_PLAN_2026-09-21.md',
    'docs/BASE44_TO_RAILWAY_TRANSITION_PLAN_2026-09-19.md']) {
    assert.ok(pages.includes(page), `${page} was not discovered`);
  }
});

test('inertness is read from what the module can do, not from its wording', () => {
  const stub = "Deno.serve(() => Response.json({ error: 'paused' }, { status: 503 }));";
  assert.equal(isInertFunction(stub), true);
  // A constant 200 with no work is just as inert as a constant 503.
  assert.equal(isInertFunction("Deno.serve(async (_req) => Response.json({ success: true, skipped: 'disabled' }));"), true);
  // Anything that can reach a client, the network, the environment or a
  // promise is live, however paused its comment claims to be.
  assert.equal(isInertFunction("// paused\nimport { createClientFromRequest } from 'npm:@base44/sdk';\nDeno.serve(() => Response.json({}));"), false);
  assert.equal(isInertFunction('Deno.serve(async () => { await base44.entities.Patient.list(); });'), false);
  assert.equal(isInertFunction("Deno.serve(async () => { const r = await fetch('https://example.test'); return r; });"), false);
  assert.equal(isInertFunction("Deno.serve(() => Response.json({ key: Deno.env.get('X') }));"), false);
  // Branching on the method alone is still one constant answer per method.
  assert.equal(isInertFunction('Deno.serve((req) => (req.method === "POST" '
    + '? Response.json({ paused: true }, { status: 503 }) : Response.json({}, { status: 405 })));'), true);
  // Reading anything else from the request means the answer varies with the
  // caller, so a synchronous endpoint that needs no await is still live.
  assert.equal(isInertFunction('Deno.serve((req) => Response.json({ echo: new URL(req.url).searchParams.get("q") }));'), false);
  assert.equal(isInertFunction('Deno.serve((_req) => Response.json({ h: _req.headers.get("x") }));'), false);
  assert.equal(isInertFunction('Deno.serve((request) => Response.json({ u: request.url }));'), false);
  // Not an endpoint at all.
  assert.equal(isInertFunction('export const helper = () => 1;'), false);
  assert.equal(isInertFunction(null), false);
});

test('every function the detector calls inert serves one constant response', () => {
  // A false positive is the dangerous direction: it would push a live handler
  // out of port. Nothing currently detected reads its request beyond a method
  // check, so each really does answer every caller identically.
  for (const name of discoverInertFunctions(repository)) {
    const source = readFileSync(resolve(repository, 'base44/functions', name, 'entry.ts'), 'utf8');
    const reads = [...source.matchAll(/\b_?req(?:uest)?\s*\.\s*(\w+)/g)].map(match => match[1]);
    assert.deepEqual(reads.filter(property => property !== 'method'), [], `${name} reads its request`);
  }
});

test('an inert function declared active is reported and fails the gate', () => {
  const evidence = { inertFunctions: ['alpha'] };
  for (const value of ACTIVE_DISPOSITIONS) {
    const report = checkCoverage(capabilities(), manifest({ functions: { alpha: value } }), evidence);
    assert.equal(report.evidence_consistent, false);
    assert.equal(report.contradicted_disposition.length, 1);
    assert.match(report.contradicted_disposition[0], new RegExp(`^functions:alpha declared ${value} `));
    assert.equal(report.census_ready, false);
  }
  // Carrying it paused or retiring it are both consistent readings.
  for (const value of ['preserved_paused', 'retire', 'undecided']) {
    assert.deepEqual(checkCoverage(capabilities(), manifest({ functions: { alpha: value } }), evidence).contradicted_disposition, []);
  }
  // Only functions carry this evidence; a same-named entity is untouched.
  assert.deepEqual(checkCoverage(capabilities({ functions: [], entities: ['alpha'] }),
    manifest({ functions: {}, entities: { alpha: 'port' } }), evidence).contradicted_disposition, []);
});

test('a broker function is held to what the family can actually serve', () => {
  const reach = name => ({ entityReach: { alpha: name } });
  const entities = { entities: { Config: 'broker', Patient: 'port' } };
  const declare = extra => manifest({ functions: { alpha: 'broker' }, ...entities, ...extra });

  // Inside the family: every entity it touches is one the family serves.
  assert.deepEqual(checkCoverage(capabilities(), declare(),
    reach({ names: ['Config'], dynamic: false })).contradicted_disposition, []);

  // Outside it. This is the real shape of the finding: `getDashboardData` was
  // declared `broker` while reading every active patient.
  const outside = checkCoverage(capabilities(), declare(), reach({ names: ['Config', 'Patient'], dynamic: false }));
  assert.deepEqual(outside.contradicted_disposition,
    ['functions:alpha declared broker but reaches Patient, which the family does not serve']);
  assert.equal(outside.census_ready, false);

  // A computed key names a set nothing here can enumerate, so it can never be
  // shown to stay inside the family — and it is not excused by the names that
  // WERE found.
  assert.match(checkCoverage(capabilities(), declare(),
    reach({ names: ['Config'], dynamic: true })).contradicted_disposition[0], /indexes the entity namespace dynamically/);

  // The family serves entities. Touching none means something else is the
  // replacement, whatever it is.
  assert.deepEqual(checkCoverage(capabilities(), declare(), reach({ names: [], dynamic: false })).contradicted_disposition,
    ['functions:alpha declared broker but touches no entity the family could serve']);

  // Every other disposition is free of this: `port` is a reviewed contract per
  // capability, which is exactly what a function reaching a clinical table needs.
  for (const value of ['port', 'hub', 'preserved_paused', 'retire']) {
    assert.deepEqual(checkCoverage(capabilities(), manifest({ functions: { alpha: value }, ...entities }),
      reach({ names: ['Patient'], dynamic: false })).contradicted_disposition, []);
  }
  // A module nobody could read is skipped, as it is by the inert and paused checks.
  assert.deepEqual(checkCoverage(capabilities(), declare(), { entityReach: {} }).contradicted_disposition, []);
});

test('the entity reach of a module is read through every access form it uses', () => {
  const known = new Set(['Patient', 'Visit', 'Agency', 'Config']);
  const reach = (source) => entitiesTouched(source, known);
  // The plain form, which a first version of this found on its own.
  assert.deepEqual(reach('await base44.entities.Patient.filter({})'),
    { names: ['Patient'], dynamic: false, writes: [], writeColumns: {} });
  assert.deepEqual(reach('base44.asServiceRole.entities.Visit.list()'),
    { names: ['Visit'], dynamic: false, writes: [], writeColumns: {} });
  // Destructuring, which it did not. Aliasing a destructured name too.
  assert.deepEqual(reach('const { Patient, Agency: A } = base44.entities;'),
    { names: ['Agency', 'Patient'], dynamic: false, writes: [], writeColumns: {} });
  // Aliasing the NAMESPACE, which is how `getDashboardData` reads every active
  // patient while containing no occurrence of `entities.Patient`. A scan that
  // misses this reported six functions as staying inside the family when the
  // real number was zero.
  assert.deepEqual(reach('const sr = base44.asServiceRole.entities;\nawait sr.Patient.filter({});\nsr.Visit.list();'),
    { names: ['Patient', 'Visit'], dynamic: false, writes: [], writeColumns: {} });
  assert.deepEqual(reach('const e = base44.entities\ne.Config.list()'),
    { names: ['Config'], dynamic: false, writes: [], writeColumns: {} });
  // Dynamic access, through either the namespace or an alias of it.
  assert.equal(reach('base44.entities[name].filter({})').dynamic, true);
  assert.equal(reach('const sr = base44.entities;\nsr[name].list()').dynamic, true);
  // Names that are not entities do not become findings, and a module that
  // touches nothing says so rather than throwing.
  assert.deepEqual(reach('const sr = base44.entities;\nsr.Promise.resolve()'),
    { names: [], dynamic: false, writes: [], writeColumns: {} });
  assert.deepEqual(reach('await base44.integrations.Core.SendEmail({})'),
    { names: [], dynamic: false, writes: [], writeColumns: {} });
  for (const value of [null, undefined, 42, {}]) {
    assert.deepEqual(entitiesTouched(value, known), { names: [], dynamic: false, writes: [] });
  }
});

test('which entities a module WRITES is read separately from which it touches', () => {
  // Reading a table and writing one stopped being the same question when a
  // table could be readable and unwritable at once: `User` under D23, and
  // every `global` reference table, which was always so and was never
  // reported.
  const known = new Set(['Patient', 'Visit', 'User']);
  const reach = (source) => entitiesTouched(source, known);
  for (const operation of MUTATING) {
    assert.deepEqual(reach(`base44.entities.Patient.${operation}({})`).writes, ['Patient'], operation);
  }
  // Reading is not writing, however many times it is read.
  for (const operation of ['filter', 'list', 'get', 'findOne', 'count']) {
    assert.deepEqual(reach(`base44.entities.Patient.${operation}({})`).writes, [], operation);
  }
  // The write is found through every access form the names are, because it is
  // the name that is matched rather than the expression that produced it.
  assert.deepEqual(reach('const { User } = base44.entities;\nawait User.update(id, {});').writes, ['User']);
  assert.deepEqual(reach('const sr = base44.asServiceRole.entities;\nsr.Visit.create({});').writes, ['Visit']);
  // One module, two entities, one of them written.
  const mixed = reach('await base44.entities.Patient.filter({});\nawait base44.entities.User.update(id, {});');
  assert.deepEqual(mixed,
    { names: ['Patient', 'User'], dynamic: false, writes: ['User'], writeColumns: { User: [] } });
  // WHICH columns, which became a question when D82 made `user` writable in
  // part. Top-level keys of an object literal, and nothing deeper: a nested
  // object is one column holding JSON, so its keys are not columns of this
  // table and a scan that walked into them would report `duty_status` as
  // written by a module that only logged it.
  assert.deepEqual(
    reach("base44.entities.User.update(id, { duty_status: 'off_duty', duty_on_since: null })").writeColumns,
    { User: ['duty_on_since', 'duty_status'] });
  assert.deepEqual(
    reach('base44.entities.User.create({ role: 1, details: { duty_status: 2, nested: { role: 3 } } })').writeColumns,
    { User: ['details', 'role'] });
  // A shorthand key names its column as plainly as a written one does.
  assert.deepEqual(reach('base44.entities.User.update(id, { phone })').writeColumns, { User: ['phone'] });
  // Unknown is not empty, and the two shapes that produce it both occur here:
  // a payload assembled elsewhere, and a conditional spread.
  assert.equal(reach('await base44.entities.User.update(id, updates);').writeColumns.User, null,
    'a payload assembled elsewhere cannot be read');
  assert.equal(reach("base44.entities.User.update(id, { role: 'user', ...(x && { phone: y }) })").writeColumns.User,
    null, 'a spread hides whatever it carries');
  // Two calls on one entity are one answer, and either of them being opaque
  // makes the whole answer opaque.
  assert.deepEqual(reach('base44.entities.User.update(a, { phone: 1 });\nbase44.entities.User.update(b, { role: 2 });')
    .writeColumns, { User: ['phone', 'role'] });
  assert.equal(reach('base44.entities.User.update(a, { phone: 1 });\nbase44.entities.User.update(b, payload);')
    .writeColumns.User, null);
  // A name that is not an entity cannot become a write, and neither can a
  // method that merely shares a word with one.
  assert.deepEqual(reach('const rows = [];\nrows.update();\nawait base44.entities.Patient.list()').writes, []);
});

test('what the record store permits per entity is read from the policies it emits', () => {
  // It used to be inferred from the tenant path — "kind is `profile_claim`"
  // standing in for "has no policy" — which was true only while a profile
  // claim was the one thing that produced a table with none. D23 ends that,
  // and an inference that could not tell "no policy" from "read-only" would
  // have reported all 39 of `User`'s `port` readers unblocked along with the 7
  // that write it.
  const permits = discoverEntityPolicies(repository);
  // 164, not 156: this reads the EMITTED policies, so the eight D7 schema-only
  // OASIS tables are in it the moment they are emitted. That is correct and is
  // not the same as their being servable — permitting a write says what the
  // store would allow a definer contract to do, never that a capability exists
  // to do it, and `tools-frontend-destination` keeps those two apart.
  //
  // 170, not 164: D7's six fax and phone tables, read the same way and with
  // the same caveat. All six are servable by nothing at all today — the
  // generic broker family serves `broker` alone and D16's ceiling refuses
  // every one of them on its own account — so this figure moving is exactly
  // the distinction above arriving a second time.
  assert.equal(Object.keys(permits).length, 170, 'every entity with a table is accounted for');
  assert.deepEqual(discoverPolicylessEntities(repository), [], 'nothing is unreadable any more');
  const readOnly = Object.keys(permits).filter(entity => permits[entity].read && !permits[entity].write).sort();
  // The eight platform reference tables. `User` left this list with D82: the
  // roster is now writable, and `discoverColumnNarrowing` is what says how far.
  assert.deepEqual(readOnly, ['AIModelConfiguration', 'CitationLibrary', 'ComplianceRule', 'MedicareComplianceRule',
    'MedicareGuideline', 'NewFeature', 'ProviderSettings', 'ServiceCode']);
  assert.deepEqual(permits.User, { read: true, write: true });
  assert.deepEqual(permits.Patient, { read: true, write: true });
  // A tree with no record store says nothing rather than guessing, because an
  // empty answer here would read as "everything is permitted".
  assert.deepEqual(discoverEntityPolicies(resolve(repository, 'services')), {});
});

test('D84: a settled leg excuses that leg and cannot outlive it', () => {
  // The entry is not a note. It changes what the queue reports, so the thing
  // that matters about it is what happens when it stops being true — which is
  // the shape this repository has now got wrong nine times, always the same
  // way: nothing fails, so nothing surfaces it.
  const legs = (entry) => ({ Going: { ...entry } });
  const declare = (over = {}) => manifest({
    functions: { alpha: 'port' },
    entities: { Kept: 'port', Going: 'hub' },
    ...over,
  });
  const reach = { entityReach: { alpha: { names: ['Kept', 'Going'], dynamic: false, writes: [] } } };
  const run = (over) => checkCoverage(capabilities(), declare(over),
    { portBlockers: { alpha: 'records_schema' }, ...reach });
  const bucket = (report) =>
    Object.entries(report.port_blockers).filter(([, names]) => names.length).map(([key]) => key);
  const settled = {
    alpha: { entities: ['Going'], served_by: 'somewhere that exists', because: 'a'.repeat(40) },
  };

  // Without an entry, one leg into a leaving domain holds the whole capability.
  assert.deepEqual(bucket(run()), ['entity_not_carried']);
  // With one, only that leg is excused, and what is left is the port itself.
  assert.deepEqual(bucket(run({ uncarried_legs: settled })), ['records_schema']);
  assert.deepEqual(run({ uncarried_legs: settled }).uncarried_legs_unused, []);

  // And the four ways it can stop being true, each of which must fail rather
  // than go on excusing something.
  const stale = (over) => run({ uncarried_legs: over }).uncarried_legs_unused;
  assert.deepEqual(stale({ alpha: { ...settled.alpha, entities: ['Kept'] } }), ['functions:alpha'],
    'an entity that is carried after all is not a leg to settle');
  assert.deepEqual(stale({ alpha: { ...settled.alpha, entities: ['Going', 'Absent'] } }), ['functions:alpha'],
    'an entity the module does not reach is a leg that moved');
  assert.deepEqual(stale({ beta: settled.alpha }), ['functions:beta'],
    'an entry for a capability that is not a port here');
  // A capability whose own disposition changed takes its entry with it.
  const retired = checkCoverage(capabilities(),
    manifest({ functions: { alpha: 'retire' }, entities: { Kept: 'port', Going: 'hub' },
      uncarried_legs: settled, retention: {} }),
    { portBlockers: { alpha: 'records_schema' }, ...reach });
  assert.deepEqual(retired.uncarried_legs_unused, ['functions:alpha']);
  // A stale entry blocks the census, the way an unspecified retention does.
  assert.equal(run({ uncarried_legs: { beta: settled.alpha } }).census_ready, false);
});

test('a module that writes a read-only table is still blocked; one that only reads it is not', () => {
  const declare = () => manifest({ functions: { alpha: 'port' }, entities: { Kept: 'port', Reference: 'port' } });
  const permits = { Kept: { read: true, write: true }, Reference: { read: true, write: false } };
  const queue = (evidence) => {
    const report = checkCoverage(capabilities(), declare(),
      { portBlockers: { alpha: 'records_schema' }, entityPolicies: permits, ...evidence });
    return Object.entries(report.port_blockers).filter(([, names]) => names.length).map(([key]) => key);
  };
  const touch = (names, writes) => ({ entityReach: { alpha: { names, dynamic: false, writes } } });
  assert.deepEqual(queue(touch(['Reference'], [])), ['records_schema'], 'reading a reference table is fine');
  assert.deepEqual(queue(touch(['Reference'], ['Reference'])), ['entity_authorization'], 'writing one is not');
  assert.deepEqual(queue(touch(['Kept'], ['Kept'])), ['records_schema'], 'writing a writable table is fine');
  // The read-only refusal applies per entity: a module writing the writable
  // one and reading the reference one is not held by either.
  assert.deepEqual(queue(touch(['Kept', 'Reference'], ['Kept'])), ['records_schema']);
  assert.deepEqual(queue(touch(['Kept', 'Reference'], ['Kept', 'Reference'])), ['entity_authorization']);
  // Absent evidence changes nothing rather than blocking everything: a tool
  // that cannot see the policies must not invent a refusal.
  assert.deepEqual(Object.entries(checkCoverage(capabilities(), declare(),
    { portBlockers: { alpha: 'records_schema' }, ...touch(['Reference'], ['Reference']) }).port_blockers)
    .filter(([, names]) => names.length).map(([key]) => key), ['records_schema']);
});

test('a contradiction blocks the census even when owners accepted', () => {
  const report = checkCoverage(capabilities(), manifest({ review_state: 'accepted' }), { inertFunctions: ['alpha'] });
  assert.equal(report.coverage_complete, true);
  assert.equal(report.census_ready, false);
});

test('the committed census is settled, and says only that', () => {
  assert.equal(main(['--summary'], { repository, log: () => {} }), 0);
  const raw = readFileSync(resolve(repository, 'tools-transition-disposition.json'), 'utf8');
  const report = checkCoverage(discoverCapabilities(repository), parseManifest(raw), discoverEvidence(repository));
  // Pinned so a new capability left undecided, or a retirement with nowhere for
  // its rows, takes the census down visibly instead of passing unnoticed.
  assert.equal(report.coverage_complete, true);
  assert.equal(report.evidence_consistent, true);
  assert.equal(report.retention_settled, true);
  assert.deepEqual(report.undecided, []);
  assert.equal(report.owner_review_complete, true);
  assert.equal(report.census_ready, true);
  // A settled census is not a migration. This tool reads the repository and has
  // never contacted a hosted app, so neither of these can become true here.
  assert.equal(report.hosted_inventory_reconciled, false);
  assert.equal(report.migration_authorized, false);
});

test('a capability without a disposition is reported as missing', () => {
  const report = checkCoverage(capabilities({ functions: ['alpha', 'delta'] }), manifest());
  assert.deepEqual(report.missing_disposition, ['functions:delta']);
  assert.equal(report.coverage_complete, false);
});

test('a manifest entry for a removed capability is reported as unknown', () => {
  const report = checkCoverage(capabilities({ entities: [] }), manifest());
  assert.deepEqual(report.unknown_capability, ['entities:Beta']);
  assert.equal(report.coverage_complete, false);
});

test('undecided entries block the census even when coverage is complete', () => {
  const report = checkCoverage(capabilities(), manifest({ functions: { alpha: 'undecided' } }));
  assert.equal(report.coverage_complete, true);
  assert.deepEqual(report.undecided, ['functions:alpha']);
  assert.equal(report.census_ready, false);
});

test('the census is ready only when owners accepted and nothing is undecided', () => {
  assert.equal(checkCoverage(capabilities(), manifest()).census_ready, false);
  assert.equal(checkCoverage(capabilities(), manifest({ review_state: 'accepted' })).census_ready, true);
  assert.equal(checkCoverage(capabilities(), manifest({
    review_state: 'accepted', entities: { Beta: 'undecided' },
  })).census_ready, false);
  // Repository coverage never implies hosted reconciliation or permission.
  const report = checkCoverage(capabilities(), manifest({ review_state: 'accepted' }));
  assert.equal(report.hosted_inventory_reconciled, false);
  assert.equal(report.migration_authorized, false);
});

for (const [name, raw] of Object.entries({
  malformed: '{',
  array: '[]',
  wrongFormat: JSON.stringify(manifest({ format: 'other' })),
  wrongVersion: JSON.stringify(manifest({ version: FORMAT_VERSION + 1 })),
  previousVersion: JSON.stringify(manifest({ version: FORMAT_VERSION - 1 })),
  unknownField: JSON.stringify({ ...manifest(), extra: true }),
  invalidReviewState: JSON.stringify(manifest({ review_state: 'signed' })),
  invalidDisposition: JSON.stringify(manifest({ functions: { alpha: 'maybe' } })),
  familyNotObject: JSON.stringify(manifest({ entities: [] })),
  retentionMissing: JSON.stringify((({ retention, ...rest }) => rest)(manifest())),
  retentionNotObject: JSON.stringify(manifest({ retention: [] })),
  retentionEntryNotObject: JSON.stringify(manifest({ retention: { Beta: 6 } })),
  retentionUnknownBasis: JSON.stringify(manifest({ retention: { Beta: { basis: 'forever', years: 6 } } })),
  retentionNegativeYears: JSON.stringify(manifest({ retention: { Beta: { basis: 'archive', years: -1 } } })),
  retentionFractionalYears: JSON.stringify(manifest({ retention: { Beta: { basis: 'archive', years: 6.5 } } })),
  retentionArchiveWithoutTime: JSON.stringify(manifest({ retention: { Beta: { basis: 'archive', years: 0 } } })),
  retentionYearsWithoutArchive: JSON.stringify(manifest({ retention: { Beta: { basis: 'none', years: 6 } } })),
  retentionExternalWithoutSystem: JSON.stringify(manifest({ retention: { Beta: { basis: 'external_system_of_record', years: 0 } } })),
  retentionExternalBlankSystem: JSON.stringify(manifest({ retention: { Beta: { basis: 'external_system_of_record', years: 0, system: '  ' } } })),
  // D84's block, under the same discipline `broker_ceiling` is under: a
  // settled leg that cannot name its entities, what serves them, or why, is
  // not a settled leg. The floor on `because` is the load-bearing one — a
  // reason nobody had to write is a reason nobody wrote.
  legsNotObject: JSON.stringify(manifest({ uncarried_legs: [] })),
  legsEntryNotObject: JSON.stringify(manifest({ uncarried_legs: { alpha: 'fine' } })),
  legsNoEntities: JSON.stringify(manifest({ uncarried_legs: { alpha: { entities: [], served_by: 'x', because: 'a'.repeat(30) } } })),
  legsEntityNotString: JSON.stringify(manifest({ uncarried_legs: { alpha: { entities: [7], served_by: 'x', because: 'a'.repeat(30) } } })),
  legsNoServedBy: JSON.stringify(manifest({ uncarried_legs: { alpha: { entities: ['Beta'], because: 'a'.repeat(30) } } })),
  legsBlankServedBy: JSON.stringify(manifest({ uncarried_legs: { alpha: { entities: ['Beta'], served_by: '  ', because: 'a'.repeat(30) } } })),
  legsNoReason: JSON.stringify(manifest({ uncarried_legs: { alpha: { entities: ['Beta'], served_by: 'x' } } })),
  legsShortReason: JSON.stringify(manifest({ uncarried_legs: { alpha: { entities: ['Beta'], served_by: 'x', because: 'because' } } })),
})) {
  test(`manifest rejects ${name}`, () => assert.throws(() => parseManifest(raw)));
}

test('what blocks a port is read from the module, not from a status note', () => {
  // Precedence runs from the most binding blocker to the least: a function that
  // both reads rows and renders a PDF cannot be written until the rows exist.
  assert.deepEqual([...PORT_BLOCKERS], ['entity_not_carried', 'entity_authorization', 'patient_access_model',
    'records_schema', 'files', 'ported_function', 'core_integration', 'pdf_rendering', 'external_secret', 'none']);
  // The first two are not properties of the module, so `classifyPortBlocker`
  // cannot see them: they depend on the dispositions of the entities it reads.
  // They are applied over its verdict in `checkCoverage`, and only ever over
  // `records_schema` — reaching a file or a Core integration stays true
  // whatever the rows turn out to be.
  assert.equal(classifyPortBlocker("await base44.entities.Patient.filter({})"), 'records_schema');
  assert.equal(classifyPortBlocker("base44.asServiceRole.entities.Visit.list()"), 'records_schema');
  // Dynamic access reads rows exactly as the dotted form does.
  assert.equal(classifyPortBlocker("await base44.entities[name].filter({})"), 'records_schema');
  // A Core integration is NOT a record blocker. This asserted 'records_schema'
  // until the functions were read: all twelve of them touch no entity at all,
  // so the queue was holding them behind a store they never use. Their blocker
  // is the integration runtime's brokered path, which is deployed and paused.
  assert.equal(classifyPortBlocker("await base44.integrations.Core.InvokeLLM({})"), 'core_integration');
  // A handler bound to the old file layer. The shared SSRF guard only admits
  // Base44's own storage hosts, so porting one verbatim would carry a Base44
  // dependency into the service the exit exists to remove.
  assert.equal(classifyPortBlocker("InvokeLLM({ file_urls: [fileUrl] })"), 'files');
  assert.equal(classifyPortBlocker("if (!isSafeFetchUrl(url)) return;"), 'files');
  assert.equal(classifyPortBlocker("await base44.integrations.Core.UploadFile({})"), 'files');
  // Precedence: a handler that reads rows AND a file waits on the store first.
  assert.equal(classifyPortBlocker("base44.entities.Patient.get(id)\nUploadFile({})"), 'records_schema');
  assert.equal(classifyPortBlocker("await base44.functions.manageAuthorizedReferral({})"), 'ported_function');
  // Precedence: reading a row outranks calling an integration.
  assert.equal(classifyPortBlocker("base44.entities.Patient.get(id)\nbase44.integrations.Core.InvokeLLM({})"),
    'records_schema');
  assert.equal(classifyPortBlocker("import { jsPDF } from 'npm:jspdf@2.5.2';"), 'pdf_rendering');
  assert.equal(classifyPortBlocker('const key = Deno.env.get("OPENAI_API_KEY");'), 'external_secret');
  assert.equal(classifyPortBlocker("const user = await base44.auth.me();"), 'none');
  // Precedence, stated as a case rather than left to reading order.
  assert.equal(classifyPortBlocker("import { jsPDF } from 'npm:jspdf@2.5.2';\nbase44.entities.Patient.get(id)"), 'records_schema');
  // Anything unreadable is treated as the most blocking, never as portable.
  assert.equal(classifyPortBlocker(null), 'records_schema');
});

test('a record blocker is refined by what the module actually reads', () => {
  const declare = extra => manifest({ functions: { alpha: 'port' },
    entities: { Kept: 'port', Gone: 'retire', Elsewhere: 'hub', Claim: 'port' }, ...extra });
  const queue = (evidence) => {
    const report = checkCoverage(capabilities(), declare(),
      { portBlockers: { alpha: 'records_schema' }, policylessEntities: ['Claim'], ...evidence });
    return Object.entries(report.port_blockers).filter(([, names]) => names.length).map(([key]) => key);
  };
  // An entity that gets no table here: the store arriving changes nothing.
  assert.deepEqual(queue({ entityReach: { alpha: { names: ['Kept', 'Gone'], dynamic: false } } }),
    ['entity_not_carried']);
  assert.deepEqual(queue({ entityReach: { alpha: { names: ['Elsewhere'], dynamic: false } } }),
    ['entity_not_carried']);
  // A carried entity with forced RLS and no policy — `User` in the real
  // manifest, which D14 left unreachable until a decision says how it is read.
  assert.deepEqual(queue({ entityReach: { alpha: { names: ['Kept', 'Claim'], dynamic: false } } }),
    ['entity_authorization']);
  // Not carried outranks unreadable: whether the capability survives at all
  // comes before how a table is read.
  assert.deepEqual(queue({ entityReach: { alpha: { names: ['Gone', 'Claim'], dynamic: false } } }),
    ['entity_not_carried']);
  // Everything carried and readable is still the store's to provide.
  assert.deepEqual(queue({ entityReach: { alpha: { names: ['Kept'], dynamic: false } } }), ['records_schema']);
  // A computed key names a set nothing can enumerate, so nothing is claimed
  // about it, and a module nobody read is left where the source put it.
  assert.deepEqual(queue({ entityReach: { alpha: { names: ['Gone'], dynamic: true } } }), ['records_schema']);
  assert.deepEqual(queue({ entityReach: {} }), ['records_schema']);

  // Only a `records_schema` verdict is ever refined. A handler that reads a
  // retired entity AND a file still waits on the file layer, because that stays
  // true whatever happens to the rows.
  for (const blocker of ['files', 'core_integration', 'external_secret', 'ported_function']) {
    const report = checkCoverage(capabilities(), declare(), {
      portBlockers: { alpha: blocker }, policylessEntities: ['Claim'],
      entityReach: { alpha: { names: ['Gone', 'Claim'], dynamic: false } },
    });
    assert.deepEqual(report.port_blockers[blocker], ['alpha'], `${blocker} must not be overridden`);
  }
});

test('a care-team dependency blocks until BOTH halves of D24 exist', () => {
  // D24 named two things and said neither is optional, and the reason is the
  // one that would not have been noticed: moving authority to
  // `pennsync_private.assignment` without carrying today's rows across means
  // every clinician loses access to their own patients at cutover. So the
  // queue asks for both, by looking at the files rather than asserting.
  const declare = () => manifest({ functions: { alpha: 'port' }, entities: { Kept: 'port' } });
  const queue = (chartScope) => {
    const report = checkCoverage(capabilities(), declare(),
      { portBlockers: { alpha: 'records_schema' }, careTeamDependents: ['alpha'], chartScope,
        entityReach: { alpha: { names: ['Kept'], dynamic: false, writes: [] } } });
    return Object.entries(report.port_blockers).filter(([, names]) => names.length).map(([key]) => key);
  };
  assert.deepEqual(queue(false), ['patient_access_model'], 'half of D24 is not D24');
  assert.deepEqual(queue(undefined), ['patient_access_model'], 'absent evidence is not a built prerequisite');
  assert.deepEqual(queue(true), ['records_schema'], 'with both, it is a port to write');
  // And the committed tree really has both, or the distribution above proves
  // nothing. Each is read from the file that provides it.
  assert.equal(discoverChartScope(repository), true);
  assert.equal(discoverChartScope(resolve(repository, 'services')), false);
  assert.match(readFileSync(resolve(repository, CHART_SCOPE_EVIDENCE.helper), 'utf8'),
    /caller_assigned_patients/);
  assert.match(readFileSync(resolve(repository, CHART_SCOPE_EVIDENCE.backfill), 'utf8'), /planBackfill/);
});

test('a retired log table blocks until there is somewhere to audit to', () => {
  // D25. The three log tables are dispositioned `retire`, which decided where
  // their EXISTING rows go and never whether the product keeps auditing. Read
  // the first way, a capability that writes one waits forever on a table that
  // is not coming; read the second, it is an ordinary port. This is the whole
  // difference, and the tool answers it by looking for the migration rather
  // than by asserting it.
  const declare = () => manifest({ functions: { alpha: 'port' },
    entities: { Kept: 'port', UserActivity: 'retire', SecurityLog: 'retire', SystemLog: 'retire', Gone: 'retire' } });
  const queue = (evidence) => {
    const report = checkCoverage(capabilities(), declare(),
      { portBlockers: { alpha: 'records_schema' }, ...evidence });
    return Object.entries(report.port_blockers).filter(([, names]) => names.length).map(([key]) => key);
  };
  for (const entity of AUDITED_ENTITIES) {
    assert.deepEqual(queue({ activityTrail: true, entityReach: { alpha: { names: ['Kept', entity], dynamic: false } } }),
      ['records_schema'], `${entity} has a successor`);
    assert.deepEqual(queue({ activityTrail: false, entityReach: { alpha: { names: ['Kept', entity], dynamic: false } } }),
      ['entity_not_carried'], `${entity} has nowhere to go without the trail`);
  }
  // Absent evidence is the same as no trail: a tool that assumed one would
  // report the queue as shorter than the tree it is reading can support.
  assert.deepEqual(queue({ entityReach: { alpha: { names: ['UserActivity'], dynamic: false } } }),
    ['entity_not_carried']);
  // The exemption is per entity, not per capability. A module that writes an
  // audit row AND reads a retired domain table still has nowhere to read from.
  assert.deepEqual(queue({ activityTrail: true,
    entityReach: { alpha: { names: ['UserActivity', 'Gone'], dynamic: false } } }), ['entity_not_carried']);
  // And it is tied to `retire`, not to the name. An entity going to the hub has
  // a different destination and a paused one has none, so neither is answered
  // by this table existing even under one of the three names.
  for (const disposition of ['hub', 'preserved_paused']) {
    const report = checkCoverage(capabilities(), manifest({ functions: { alpha: 'port' },
      entities: { Kept: 'port', UserActivity: disposition } }),
    { portBlockers: { alpha: 'records_schema' }, activityTrail: true,
      entityReach: { alpha: { names: ['UserActivity'], dynamic: false } } });
    assert.deepEqual(report.port_blockers.entity_not_carried, ['alpha'], `${disposition} is not the trail`);
  }
  // The committed manifest does disposition all three `retire`, which is what
  // makes the exemption above apply to anything at all.
  const committed = parseManifest(readFileSync(resolve(repository, 'tools-transition-disposition.json'), 'utf8'));
  for (const entity of AUDITED_ENTITIES) assert.equal(committed.entities[entity], 'retire', entity);
  // And it is the repository that answers it. The committed tree has the
  // migration; a tree without it gets the stricter verdict from the same code.
  assert.equal(discoverActivityTrail(repository), true);
  assert.equal(discoverActivityTrail(resolve(repository, 'services')), false);
  assert.ok(readFileSync(resolve(repository, ACTIVITY_TRAIL_MIGRATION), 'utf8').includes('activity_audit'));
});

test('a capability is held by the care-team question whatever its entities are', () => {
  const declare = () => manifest({ functions: { alpha: 'port' }, entities: { Kept: 'port', Gone: 'retire' } });
  // `chartScope: false` is the tree D24 was decided in and not yet built in.
  // With both halves present the bucket empties, which the case below proves
  // separately; here it stays false so the ranking is what is under test.
  const queue = (evidence) => {
    const report = checkCoverage(capabilities(), declare(),
      { portBlockers: { alpha: 'records_schema' }, careTeamDependents: ['alpha'], ...evidence });
    return Object.entries(report.port_blockers).filter(([, names]) => names.length).map(([key]) => key);
  };
  assert.deepEqual(queue({ entityReach: { alpha: { names: ['Kept'], dynamic: false } } }), ['patient_access_model']);
  // Unlike the two entity-disposition refinements, this one survives a computed
  // key: it is read from the source text, not from the entity set.
  assert.deepEqual(queue({ entityReach: { alpha: { names: ['Kept'], dynamic: true } } }), ['patient_access_model']);
  assert.deepEqual(queue({ entityReach: {} }), ['patient_access_model']);
  // An entity that gets no table still outranks it: whether the capability
  // survives comes before who may read a patient.
  assert.deepEqual(queue({ entityReach: { alpha: { names: ['Gone'], dynamic: false } } }), ['entity_not_carried']);
  // And a capability with no care-team dependency is untouched by it.
  const clean = checkCoverage(capabilities(), declare(),
    { portBlockers: { alpha: 'records_schema' }, careTeamDependents: [],
      entityReach: { alpha: { names: ['Kept'], dynamic: false } } });
  assert.deepEqual(clean.port_blockers.records_schema, ['alpha']);
});

test('the port queue is work that cannot start yet, and says why', async () => {
  // Reading the census as "86 ports awaiting review" would send someone to work
  // nothing in the repository can support. Exactly one of them was writable
  // without something the transition has not built, and it has been written.
  //
  // `records_schema` moves by work now rather than by reclassification: D26
  // ported `listAuthorizedPatients` and `getAuthorizedPatient`, the first two
  // capabilities that read clinical rows, and the visit and document pairs
  // followed on the same machinery. Then D28 found what only a WRITE could
  // show and `createAuthorizedPatient` followed it.
  // Then `updateAuthorizedPatient`, the first ported MUTATION, on the same
  // fenced-declaration machinery the reads use, the visit pair after it, and
  // the scoped alert pair — the first capabilities whose OWN authorization was
  // the `assigned_nurses` representation D21 and D24 threw out — and the note
  // history pair, whose table D32 made genuinely append-only first. Then
  // `managePatientCareTeamAssignment`, the one capability whose original is
  // PAUSED AT SOURCE: D33 re-enables its four mutations because the owned store
  // meets the three conditions the pause names, and it is the port that makes
  // D24 operable — until it, nothing could take a clinician off a care team.
  // Then the tenant-context pair, the first whose originals read nothing the
  // record store owns at all — `AgencyMembership` and `Agency` are the
  // authority store's own model, so what they needed was a contract over
  // `pennsync_private.membership` rather than a table in `pennsync_records`.
  // Then `manageAgencyMembership`, the write half of the same model and the
  // SECOND partial port: five of its six actions, with `provision` refused by
  // name because its own guard reserves it to the platform owner D14 and D22
  // removed.
  // Then `policyAcknowledgment`, the THIRD partial port: `acknowledge` is
  // served and `list` is not, because its gate is the Base44 built-in admin
  // that D31 already found has no performer left.
  // Then the AI content agreement pair, the FIRST port to write D25's
  // activity trail — every capability ported before it audited nothing.
  // Then the whole time-off domain in one change, which is four capabilities
  // that each answered the same authorization question a different way by
  // reading the carried `User` row D23 says decides nothing.
  // 76 → 74 → 72 → 70 → 69 → 68 → 67 → 66 → 64 → 62 → 61 → 59 → 58 → 57 →
  // Then `submitPersonnelCredential` ALONE — its sibling
  // `reviewPersonnelCredential` is the first WHOLE capability with no
  // performer left, so it stays in the queue until somebody decides who may
  // approve a credential.
  // Then `reviewPersonnelCredential`, the first port made under D40 — the
  // owner's decision that an `agency_admin` is the built-in admin's
  // successor, and the first deliberate WIDENING in the whole migration.
  // Then the invitation pair, which is ONE contract for two capabilities —
  // `resendInvitation` and `resendInvitationV2` are byte-identical apart
  // from a comment naming the second the production replacement.
  // Then the two agency configuration upserts, whose originals each rebuilt
  // their own SCOPE in JavaScript and each record a bug from it.
  // Then the incident pair, where D40's widening puts a REPORTER and a
  // REVIEWER in the same person for the first time — so the contract adds the
  // self-review refusal the platform tier used to make unnecessary.
  // Then `manageMyNotifications`, whose port found the defect in the one
  // before it: the incident fan-out stamped three of the six authority columns
  // this reader filters on, so its alerts were addressed to nobody.
  // Then `manageVehicleMaintenance`, TWO of whose eight actions needed no SQL
  // at all: `context` is D34's tenant memberships and `staff` is D22's roster.
  // Then a CORRECTION rather than a port: six capabilities carried `port` and
  // counted here refuse every caller from the first statement of their own
  // handler. The paused-at-source check could not see them because it looks
  // for a `const FLAG = false`, and these use no flag — the same failure that
  // check was written to fix, in a shape nobody re-measured.
  // Then `createNotification`, the writer half of the notification pair, which
  // moves the authority envelope into one facility both it and the incident
  // fan-out call — so there is one place left to get it wrong.
  // Then `checkExpiredInvitations`, whose HUMAN gate D40 answers and whose
  // MACHINE gate — a shared secret over every tenant — has no successor,
  // because nothing in this store is cross-tenant.
  // Then the two credential sweeps, which are TWO contracts rather than one
  // because the renewal original records why they must be: three crons once
  // shared a marker column with different tier sets, and whichever fired a
  // shared tier first consumed it for the others.
  // Then `checkAdrDeadlines`, the last of D49's four and the only one with
  // nothing paused — its reminder is a row rather than an email — which also
  // makes it the evidence for `notification_mint`: the original stamps none of
  // the six authority columns its own reader filters on.
  // Then the timesheet pair, the largest port so far, where almost nothing
  // the caller sends decides what they are paid.
  // Then `triageReferralWithAI`, the first port to sequence a brokered model
  // call and a write — the pattern the eleven model-backed ports left in this
  // bucket all need.
  // 55 → 51 → 50 → 49 → 48 → 46 → 44 → 42 → 41 → 40 → 36 → 35 → 34 → 32 → 31
  // Then `syncCMSRegulations`, the first whose write is a RECORD contract
  // rather than a trail append — and the first to check a MODEL's answers
  // against the columns' own constraints before storing them.
  // Then a SECOND correction rather than a port: four capabilities whose ONLY
  // entity is one of D25's three retired log tables were counted against the
  // record store, when the trail IS their record half and what they actually
  // wait on is the file layer, `Core.SendEmail` or a third-party key.
  // → 29 → 28 → 27 → 23, and 11 → 56 written.
  // Then D75 took the record bucket to ZERO on a correction, and D76 emptied
  // `ported_function` the same way: the queue reported the wait for sixty-eight
  // ports after D68 wrote the thing being waited for, because the rule reads
  // the SHAPE of the call and never asked who the callee was. Unlike the five
  // corrections before it, this one moved a capability from blocked to
  // startable rather than renaming its bucket — and it was written the same
  // day. → 71 → 72 written.
  // Then D81, the one D79 found startable while writing itself: the handout's
  // send sits behind the module's own release gate, so its document action
  // waited on nothing. `core_integration` 3 → 2, and 73 written. D86 wrote the
  // last two and `core_integration` is 0: both are capabilities whose entire
  // body is one send, so both ship as the caller gate plus the original's own
  // paused answer, and a bucket that was a release gate is now a released
  // decision with the gate inside the handler.
  const report = checkCoverage(
    discoverCapabilities(repository),
    parseManifest(readFileSync(resolve(repository, 'tools-transition-disposition.json'), 'utf8')),
    discoverEvidence(repository),
  );
  // Then D153, which moves a count DOWN without writing anything, and is the
  // first here to do so for this reason: `enforceStaffRoleIntegrity` was never
  // a port waiting to be written, it is a capability the owned store made
  // unnecessary, so it retires rather than shipping. `entity_authorization`
  // 7 → 6 and nothing moves to `none`, because nothing was written — the pair
  // of counts says "one fewer capability to carry", not "one more carried".
  // Read it beside D83, which took `MedicareGuideline`'s two writers out of
  // this same bucket the same way: a blocked port and a capability that is not
  // being carried are not the same thing, however alike they look in a count.
  // Then the first movements out of `files`, and they are PORTS rather than
  // corrections: `extractPatientDataFromDocument`, `extractClinicalDocument`
  // and `splitReferralPDF` ship, 12 → 9 and 78 → 81. What unblocked them was
  // not the byte copy. The bucket's name says "reads or writes an uploaded
  // file", and the discriminator is where the LOCATOR comes from: a copy
  // repoints carried rows, and those three take theirs from the request body
  // seconds after a browser upload, so there is no carried row to repoint. The
  // ports take the bytes and broker the upload themselves, which puts one
  // subject on both sides of the runtime's uploader-ownership fence.
  //
  // Read that off the EXPRESSION each argument is built from, never off the
  // call site's shape. `mergePDFs` was classified browser-minted from the
  // shape and is not: of its three reachable sites two upload a few lines
  // above the call, and `DocumentFaxSender.jsx` passes a carried `Document`'s
  // authorized download URL into a variable with the SAME NAME. It is in this
  // bucket for the ordinary reason.
  //
  // And `entity_authorization` 6 → 5 with `records_schema` 0 → 1, which is
  // neither a port nor a decision but a correction to the READER: see the
  // payload-assembly test below. Read the three kinds of movement together —
  // a capability that is not being carried, one carried by asking a different
  // question of the same module, and one that was never blocked at all.
  // Then D223, which moves the pair the ordinary way after three entries that
  // did not: `setNurseDutyStatus` is WRITTEN, so `entity_authorization` 6 → 5
  // and `none` 78 → 79 — one fewer blocked and one more carried, which is the
  // movement D153's comment above contrasts itself with. It moves because the
  // contract exists rather than because anything was reclassified: a ported
  // capability reaches `none` without the blocker classifier being consulted
  // at all.
  //
  // THREE movements land here at once and no two of them are the same kind, so
  // the distribution below is the TOOL'S answer on the merged tree rather than
  // any branch's figures adjusted by hand. Adding the deltas would have been
  // wrong in both directions.
  //
  // `files` 12 → 8 is two different things. THREE of the four are ports: this
  // branch took the bytes for document extraction, the clinical scanner and the
  // referral splitter, so each reaches `none`. The FOURTH is D153's third kind,
  // which leaves the queue SHORTER without anything having been written:
  // `processPatientFileUpdate` is dispositioned `preserved_paused` because it is
  // paused at source and its successor would be a widening nobody has decided,
  // so it is not a file-layer port waiting on the file layer. It moves to
  // NOTHING. D47's rule is what puts that one in its own change rather than a
  // later one: switching a capability off means changing its disposition in the
  // same change.
  //
  // So `none` is 82 — 79 plus this branch's three — and NOT 83, which is what a
  // reader counting four departures from `files` into `none` would write down.
  // The arithmetic only closes once the paused one is read as leaving the
  // population instead of crossing it.
  const counts = Object.fromEntries(Object.entries(report.port_blockers).map(([key, names]) => [key, names.length]));
  assert.deepEqual(counts, { entity_not_carried: 0, entity_authorization: 5, patient_access_model: 0,
    records_schema: 0, files: 8, ported_function: 0, core_integration: 0, pdf_rendering: 0,
    external_secret: 2, none: 82 });
  // The correction this distribution records: `records_schema` had come to mean
  // "touches an entity", and only 25 of those 94 were ever waiting on the
  // record store. Thirty-four read an entity that gets no table here at all,
  // and thirty-four read `User`, which carries forced RLS and no policy because
  // D14 deliberately left how it may be read undecided. Neither is helped by
  // the store existing.
  //
  // Then D25 halved the first of those. Of the 34, twenty-seven were held by a
  // retired log table and nothing else, and `retire` had decided where those
  // rows GO, never whether the product keeps auditing. With a trail to write
  // to they redistribute across the three buckets behind them, which is why
  // those grew while the total did not move. Seven remain, and each reads a
  // table from a domain that is actually going away rather than a log.
  //
  // D84 empties it, and by two different findings rather than one. Three of
  // the seven were in the wrong place entirely: `analyzeNurseDeficits` and
  // `analyzeRealTimePerformance` read training telemetry and nothing else, so
  // they follow D8 to the Hub, and `getCommsDashboard` was the last `port`
  // among twenty-seven SMS, fax and voice handlers — the read side of a domain
  // D7 carries paused. The other four are carried capabilities with one
  // uncarried LEG, each settled in the manifest with what serves it instead,
  // so the bucket stops reporting a whole capability as blocked on a schema
  // because two figures of one PDF come from a table that is leaving.
  assert.deepEqual(report.port_blockers.entity_not_carried, [],
    'a capability is held here only by a leg nobody has settled');
  // `acceptAiContentAgreement` writes `UserActivity` and reads nothing else
  // uncarried. It sat here for exactly as long as retiring the table was read
  // as retiring the obligation.
  assert.ok(!report.port_blockers.entity_not_carried.includes('acceptAiContentAgreement'));
  // D23 then emptied most of `entity_authorization` the same way. The bucket
  // meant "reads `User`, which has forced RLS and no policy"; the store now
  // gives `User` a read policy keyed on the authority store's roster, so what
  // is left is only what a read policy does not help:
  //
  // - the 6 that UPDATE a profile, which D23 deliberately leaves open. The
  //   roster policy is read-only, so nothing decided that question by
  //   accident. A seventh profile writer, `offboardUser`, reaches a table that
  //   gets no row here at all and is held by `entity_not_carried` first;
  // - two that write `MedicareGuideline`, a `global` reference table no tenant
  //   surface may write. That was always true and was never reported, because
  //   the classifier could not tell reading a table from writing one.
  //
  // Two of these left it by being MEASURED rather than decided:
  // `calculateDataQualityScores` and `enforceDataCompleteness` refuse every
  // caller from the first statement of their handler, so what blocked them was
  // never a profile write.
  //
  // D82 and D83 then corrected both halves of that paragraph, in opposite
  // directions. The two `MedicareGuideline` writers left by being
  // re-dispositioned: D83 says a `global` reference table is written by
  // migration and never at runtime, so neither is a caller-facing handler to
  // write. The six profile writers stayed although `user` became writable,
  // because D82 permits the caller's OWN row and a named column set, and every
  // one of them writes somebody else's row, a column outside that set, or a
  // payload nothing can read. `offboardUser` joined them: it was held by
  // `entity_not_carried` first, and D84 settled that leg.
  //
  // D153 then took a THIRD out the same way D83 took its two, and the reason
  // generalises past this bucket: `enforceStaffRoleIntegrity` reverted a
  // spoofed `User.staff_role`, and in this store the column is constrained on
  // both tables and writable by nobody, so the sweep has no work left rather
  // than no permission. Six remain that write somebody else's row, a column
  // outside D82's set, or a payload nothing can read.
  //
  // D223 then took `setNurseDutyStatus` out by WRITING it, which is the only
  // way a capability has left this bucket since D82: it was the one of the six
  // that writes the caller's own row and nothing but columns on D82's
  // allowlist, so it was the only one the self-write policy could ever admit.
  // The five that remain each need the administrative path D223 refuses, so
  // this list does not shrink again without a decision rather than a port.
  //
  // One note this branch adds, because the mechanism outlives its own port: the
  // capability that left was never blocked by the STORE. `writtenColumns` knew
  // one shape of a write payload — an object literal at the call — and not the
  // second, a local object assembled by member assignment and handed over, so
  // it answered `null` and the classifier read unknown as outside D82. The
  // three above are facts about the store; that one was a fact about the
  // READER, and it failed closed, which is why it survived so long.
  assert.deepEqual(report.port_blockers.entity_authorization,
    ['autoApproveInvitedUser', 'autoEndDutyDay', 'offboardUser',
      'userManagement', 'userManagementV2']);
  // ZERO. That is how many of the hundred are still waiting on the record
  // store, and it reached zero on a CORRECTION rather than on a port: D75
  // found that the last entry, `processCompletedVisit`, pauses at source with
  // a flag pinned `true` — the polarity this check did not know — so it
  // refuses every caller and was never startable. and the
  // number is still the point: `records_schema=94` said the record store was
  // what stood in front of the queue, and everything since has been finding
  // out what actually did. Nothing in the queue waits on a decision now, and
  // nothing waits on a shared prerequisite either — so from here the bucket
  // only falls by ports being written, which is what took it off 76.
  //
  // It went to 3, back to 0, and is 1, and every direction is the queue
  // reading correctly: D84 moved three capabilities OUT of
  // `entity_not_carried` by settling their one uncarried leg, D89, D90 and D91
  // then wrote all three, and `setNurseDutyStatus` arrived and left in one
  // change when `writtenColumns` learned to read a patch assembled before the
  // call. A
  // bucket that only ever falls is a bucket nobody can move work into, and one
  // that never falls is a queue nobody is clearing.
  //
  // The entry it holds now is the one worth reading twice, because it arrived
  // from `entity_authorization` rather than from a decision or a port: the
  // capability was never blocked, and the reader said it was.
  assert.deepEqual(report.port_blockers.records_schema, []);
  // The thirty-eight that left it are the ported capabilities that touch clinical rows
  // — D26's patient pair, then the visit and document pairs on the same
  // machinery, then the patient write and mutation, then the visit pair that
  // carries the SmartNote save — so they are also the proof that the D19
  // pattern carries PHI and not only configuration. `updateAuthorizedVisit`
  // is the first that is only PARTLY ported: four of its nine actions, with
  // the other five refused by name and reason. The
  // document pair additionally shows that `files` was never the blocker there:
  // no purpose discloses a locator. `managePatientCareTeamAssignment` is the
  // last of them and the odd one: its four mutations were refused at module
  // scope in the original, so porting it RE-ENABLES rather than reproduces.
  // The tenant-context pair is the counter-example to the bucket's own name:
  // `records_schema` had come to mean "touches an entity", and these two touch
  // only entities the AUTHORITY store already models natively.
  for (const name of ['listAuthorizedPatients', 'getAuthorizedPatient',
    'listAuthorizedVisits', 'getAuthorizedVisit',
    'listAuthorizedDocuments', 'getAuthorizedDocument', 'createAuthorizedPatient',
    'updateAuthorizedPatient', 'createAuthorizedVisit', 'updateAuthorizedVisit',
    'getScopedPatientAlerts', 'updateScopedPatientAlert',
    'appendPatientNoteHistory', 'getAuthorizedPatientNoteHistory',
    'managePatientCareTeamAssignment', 'getMyTenantContext', 'listMyTenantMemberships',
    'manageAgencyMembership', 'policyAcknowledgment',
    'acceptAiContentAgreement', 'getAiContentAgreementStatus',
    'submitTimeOffRequest', 'cancelTimeOffRequest', 'reviewTimeOffRequest',
    'getApprovedTimeOff', 'submitPersonnelCredential', 'reviewPersonnelCredential',
    'auditDataQuality', 'resendInvitation', 'resendInvitationV2',
    'saveVisitPointConfig', 'savePayrollProfile', 'predictSupplyNeeds',
    'analyzeVisitForSupplyUsage', 'importProvidersCsv', 'expandClinicalPhrase',
    'generateFollowUpTasks', 'analyzeClinicalEvents', 'analyzeClinicalTrends',
    'analyzeAndGenerateClinicalTasks', 'extractClinicalEvents']) {
    assert.ok(report.port_blockers.none.includes(name), `${name} is ported`);
    assert.ok(!report.port_blockers.records_schema.includes(name), name);
  }
  // D24's bucket is empty because both halves exist — not because the
  // dependency went away. The capabilities that authorize on care-team
  // membership are answerable now, and two of them have since been written:
  // the scoped alert pair, whose OWN authorization was the `assigned_nurses`
  // representation D21 and D24 threw out. `appendPatientNoteHistory` is the
  // same shape and is still waiting.
  assert.deepEqual(report.port_blockers.patient_access_model, []);
  for (const name of ['getScopedPatientAlerts', 'updateScopedPatientAlert',
    'appendPatientNoteHistory', 'getAuthorizedPatientNoteHistory']) {
    assert.ok(report.port_blockers.none.includes(name), `${name} is ported`);
  }
  // Twelve functions were counted against the record store until they were
  // read. Every one calls a Core integration and touches no entity row, so what
  // they waited on was the integration runtime's brokered path — already
  // deployed, and paused — not a store that does not exist. All twelve left:
  // five by being written, two by being reclassified paused, four by being
  // file-bound, and `generateUserGuidePDF` by being ported.
  //
  // The one here now arrived from the other direction. `sendWelcomeEmail` was
  // dispositioned `broker` and touches no entity at all — it sends mail through
  // `Core.SendEmail`, which no entity family can be the replacement for. The
  // function-side ceiling caught that, and `SendEmail` is not in the runtime's
  // brokered set, so it is a real blocker rather than a bookkeeping artefact.
  // `generatePatientHandout` joined it by the refinement above — its only
  // entity is `SystemLog` — and left it by being written (D81): the send was
  // one action of two, refused by the module's own gate, so the document half
  // never waited on the runtime at all.
  //
  // The last two left it the same way (D86), and the bucket is empty. What
  // made them writable was not the runtime brokering `SendEmail` — it still
  // does not — but noticing that a capability whose whole body is a send has a
  // refusal to ship, and that refusing it here is stronger than refusing it in
  // Base44: the port cannot send even if someone released the gate, because
  // `BROKERED_OPERATIONS` does not carry the operation. An empty bucket here
  // does NOT mean D56 was decided; it means nothing is waiting on that
  // decision to be written.
  assert.deepEqual(report.port_blockers.core_integration, []);
  for (const name of ['sendAccountReadyEmail', 'sendWelcomeEmail']) {
    assert.ok(report.port_blockers.none.includes(name), `${name} is written`);
  }
  // Named, because porting one of these verbatim would carry Base44's storage
  // host into the service. The `cmfile:` handles that replace those URLs DO
  // exist; what these wait on is the data copy that repoints carried `file_url`
  // rows at them — and `extractPatientDataFromDocument` left this list by not
  // needing one, because its locator came from the request body rather than
  // from a carried row, so the port takes the bytes and brokers the upload
  // itself.
  // `mergePDFs` and `reorderDeletePDFPages` join them by the refinement: each
  // touches `UserActivity` and nothing else, so the record store is not what
  // either is waiting for.
  // D65 moved six here from `records_schema`. The classifier returned the
  // record store first for a module that touches entities AND reaches the file
  // layer, which was right while the store was the question; it is built now,
  // with sixty-three ports over it, while the file layer is still a data
  // migration and thirty-one call sites. `records_schema` reads as "startable
  // today", and for these six it was not true.
  // `extractClinicalDocument` left on the port that shipped it, by the shape
  // its sibling established: the browser sends the BYTES and the handler
  // brokers the upload, so the capability never needed the carried `file_url`
  // rows the data migration is about. `splitReferralPDF` left the same way, in
  // the same change.
  //
  // `processPatientFileUpdate` LEFT this list for a DIFFERENT reason, and the
  // two departures are worth keeping apart because a count cannot tell them
  // apart: it is paused at source — preview goes to one configured address and
  // apply is 503 for everyone — so it was never a port waiting on `cmfile:`
  // handles. Its successor would be a widening nobody has decided, which is a
  // product answer rather than a data migration, so it is `preserved_paused`.
  // That is the shape D153 and D83 record from the other bucket: a blocked port
  // and a capability that is not being carried are not the same thing, however
  // alike they look in a count.
  assert.deepEqual(report.port_blockers.files, ['createAuthorizedDocument',
    'generateAdrPacket',
    'generateDynamicCoverSheet', 'generateNoteFromRecording', 'indexPDF', 'mergePDFs',
    'preparePDFWithPatientInfo', 'reorderDeletePDFPages']);
  assert.deepEqual(report.port_blockers.none,
    ['acceptAiContentAgreement', 'analyzeAndGenerateClinicalTasks',
      'analyzeClinicalEvents', 'analyzeClinicalTrends',
      'analyzeReferral', 'analyzeReferralIntake',
      'analyzeReferralPriority', 'analyzeVisitForSupplyUsage',
      'appendPatientNoteHistory', 'auditDataQuality', 'cancelTimeOffRequest',
      'checkAdrDeadlines', 'checkExpiredInvitations',
      'createAuthorizedPatient', 'createAuthorizedVisit', 'createNotification',
      'distributePolicyAcknowledgment',
      'expandClinicalPhrase',
      'extractClinicalDocument',
      'extractClinicalEvents',
      'extractPatientDataFromDocument',
      'extractReferralDataForSmartNote',
      'generateAIReport', 'generateBagTechniquePDF', 'generateFollowUpTasks',
      'generatePatientChartPDF', 'generatePatientHandout', 'generateReferralTasks',
      'generateSmartNoteGuide',
      'generateUserGuidePDF', 'generateUserManual', 'generateUserRosterPDF',
      'getAiContentAgreementStatus', 'getApprovedTimeOff',
      'getAuthorizedDocument', 'getAuthorizedPatient',
      'getAuthorizedPatientNoteHistory', 'getAuthorizedVisit', 'getDashboardData',
      'getMyTenantContext', 'getScopedPatientAlerts', 'importProvidersCsv',
      'listAuthorizedDocuments', 'listAuthorizedPatients', 'listAuthorizedVisits',
      'listMyTenantMemberships', 'listPolicyLibrary', 'manageAgencyMembership',
      'manageAuthorizedReferral', 'manageMyNotifications',
      'managePatientCareTeamAssignment', 'manageVehicleMaintenance',
      'matchPatientWithAI', 'policyAcknowledgment',
      'predictSupplyNeeds', 'resendInvitation', 'resendInvitationV2',
      'reviewPersonnelCredential', 'reviewTimeOffRequest', 'reviewTimesheet',
      'savePayrollProfile', 'saveVisitPointConfig', 'searchPDFs',
      'sendAccountReadyEmail', 'sendCredentialRenewalReminders',
      'sendExpirationNotifications', 'sendPersonnelExpirationNotifications',
      'sendWelcomeEmail', 'setNurseDutyStatus', 'splitReferralPDF',
      'submitIncidentReport',
      'submitPersonnelCredential', 'submitStateReportableIncident',
      'submitTimeOffRequest', 'submitTimesheet',
      'syncCMSRegulations', 'triageReferralWithAI',
      'updateAuthorizedPatient',
      'updateAuthorizedVisit', 'updateIncident', 'updateScopedPatientAlert',
      'validatePatientData'],
    'the set of written ports changed');
  // `listPolicyLibrary` is the first of these to read an entity row. Everything
  // before it either computed an answer, rendered a document or asked a model,
  // so the records bucket had never moved by a port being written — only by a
  // function being reclassified. It moves now.
  assert.ok(report.port_blockers.none.includes('listPolicyLibrary'));
  // D76. This read `['extractReferralDataForSmartNote']` for sixty-eight ports,
  // because `ported_function` answers on the SHAPE of the call and never asked
  // who the callee was. D68 wrote the callee.
  assert.deepEqual(report.port_blockers.ported_function, []);
  assert.ok(report.port_blockers.none.includes('extractReferralDataForSmartNote'));
  // All three emptied this bucket once the service adopted a PDF library and a
  // call-sequence parity test; nothing is waiting on a rendering decision now.
  assert.deepEqual(report.port_blockers.pdf_rendering, []);
  // `transcribeAudioWithWhisper` joins it the same way: its only entity is
  // `UserActivity`, and it reads `OPENAI_API_KEY` and calls the provider
  // directly rather than through the brokered runtime.
  assert.deepEqual(report.port_blockers.external_secret,
    ['transcribeAndGenerateSOAPNote', 'transcribeAudioWithWhisper']);
  // D87 measures what `external_secret` is standing on for these two, because
  // "a key from the environment" reads as one missing credential and is three
  // separate walls. The bucket name has been wrong here before, so each is an
  // assertion rather than a sentence:
  //
  // 1. There is no audio operation to broker. `OPERATIONS` is the runtime's
  //    whole vocabulary and a request for anything outside it is refused.
  // 2. The runtime holds no key for the provider either function calls, so
  //    even a brokered operation would have nothing to call with.
  // 3. The owned bucket admits no audio type, so the bytes could not be
  //    carried there whatever the reader model decided.
  //
  // The first two are what D87 designs around and the third is why the design
  // stops where it does. Any one of them falling away leaves the other two.
  const { MIME, OPERATIONS } = await import('./services/integration-runtime/contracts.mjs');
  assert.ok(!OPERATIONS.some(operation => /audio|transcri|speech/i.test(operation)),
    'no brokered operation carries audio');
  const runtimeSource = readFileSync(resolve(repository, 'services/integration-runtime/runtime.mjs'), 'utf8');
  assert.ok(!runtimeSource.includes('OPENAI_API_KEY'), 'the runtime holds no key for the transcription provider');
  assert.ok(![...MIME].some(type => type.startsWith('audio/')), 'the owned bucket admits no audio type');
  // The sum is every function dispositioned `port`, so nothing falls out of the
  // queue by being unclassifiable.
  assert.equal(Object.values(counts).reduce((total, value) => total + value, 0), report.families.functions.counts.port);
});

test('what holds each member of `entity_authorization` is measured, not described', async () => {
  // The bucket described itself by a rule it had stopped using. Its paragraph
  // said "reads a carried entity that has forced RLS and no policy. That is
  // `User`" and that what it counted was "a roster read waiting on that RPC" —
  // and by then `User` had a read policy, `discoverPolicylessEntities` was
  // empty, and the RPC had shipped as `contract_roster` with two handlers over
  // it. The sixth correction of that shape (D74) and the seventh (D75) each
  // found the same thing, so what stops the eighth is not better prose: it is
  // asserting which entity holds each member, so a rewrite that gets the
  // reason wrong fails here rather than being read and believed.
  const declared = parseManifest(readFileSync(resolve(repository, 'tools-transition-disposition.json'), 'utf8'));
  const evidence = discoverEvidence(repository);
  const report = checkCoverage(discoverCapabilities(repository), declared, evidence);
  const permits = evidence.entityPolicies;
  const narrowing = evidence.columnNarrowing;
  const scheduled = new Set(evidence.schedulerAuthFunctions);
  // A write the store will not take, measured two ways, because after D82 there
  // are two ways for a store to refuse one.
  //
  // `readOnly` is the original: forced RLS with a read policy and no write
  // policy, which is every `global` reference table and was `User` until D82.
  //
  // `outsideNarrowing` is the one D82 adds, and it is the reason this test was
  // rewritten rather than deleted. `user` is writable now, so a rule asking
  // only "may this table be written" would have reported all seven of its
  // writers unblocked on the day the policy landed — the ninth instance of
  // exactly the defect this file exists to catch, arriving from the other
  // direction. The narrowing is the caller's OWN row and a named column set, so
  // a write is covered only where the payload can be read, every column of it
  // is named, and there is a caller at all.
  const readOnly = (entity) => permits[entity] && permits[entity].read && !permits[entity].write;
  const outsideNarrowing = (name, entity, reach) => {
    const allowed = narrowing[entity];
    if (!allowed) return false;
    if (scheduled.has(name)) return true;
    const uses = (reach.writeColumns || {})[entity];
    return !Array.isArray(uses) || uses.some(column => !allowed.includes(column));
  };
  // Which entities a `port` capability writes and the store refuses, from the tree.
  const held = {};
  for (const [name, reach] of Object.entries(evidence.entityReach)) {
    if (declared.functions[name] !== 'port' || reach.dynamic) continue;
    const written = (reach.writes || [])
      .filter(entity => readOnly(entity) || outsideNarrowing(name, entity, reach)).sort();
    if (written.length) held[name] = written;
  }
  // One population now, where there were two. `MedicareGuideline` left when
  // D83 re-dispositioned its two writers: a `global` reference table is
  // written by migration and never at runtime, so neither
  // `fetchMedicareGuideline` nor `scheduledGuidelineSync` is a caller-facing
  // handler somebody has yet to write — and a blocked port and a capability
  // that is not being carried are not the same thing, however alike they look
  // in a count.
  assert.deepEqual([...new Set(Object.values(held).flat())].sort(), ['User']);
  const declaredNow = declared.functions;
  for (const name of ['fetchMedicareGuideline', 'scheduledGuidelineSync']) {
    assert.equal(declaredNow[name], 'retire', `${name} is not carried (D83)`);
  }
  // `enforceStaffRoleIntegrity` leaves the same way, and for the same kind of
  // reason: it is not a port somebody has yet to write, it is a capability the
  // owned store has made unnecessary. Its whole job was reverting a spoofed
  // `User.staff_role` to the accepted invitation's value, and its own comment
  // says why -- `account_type` is "a self-mutable custom User field and must
  // not let a user preserve a spoofed staff_role indefinitely". Both halves of
  // that job are now structural, which is what the two assertions below
  // measure rather than assert in prose:
  //
  //   - its validity check is a CHECK constraint. It counts a
  //     `skipped_invalid_invitation` for any staff_role outside its four, and
  //     `user_staff_role_allowed` / `user_invitation_staff_role_allowed`
  //     constrain the column to exactly those four on BOTH tables.
  //   - its revert can have no subject. `staff_role` is not in
  //     `PROFILE_SELF_WRITABLE`, so D82's guard refuses it, and no capability
  //     in the store writes `pennsync_records.user` at all -- the write path
  //     is built and has no caller. A column nothing can write cannot drift.
  //
  // So `preserved_paused` would be wrong here, not merely weaker: it asserts a
  // future in which we resume this, and resuming means re-introducing the
  // defect the constraint and the allowlist now prevent. That is this file's
  // own recurring finding -- a bucket keeping its name after the reason for it
  // has gone -- committed one level up, in the act of fixing an instance of it.
  assert.equal(declaredNow.enforceStaffRoleIntegrity, 'retire',
    'the store made this unnecessary rather than merely blocked');
  const recordStore = readFileSync(resolve(repository, RECORD_MIGRATION_FILE), 'utf8');
  for (const constraint of ['user_staff_role_allowed', 'user_invitation_staff_role_allowed']) {
    assert.ok(recordStore.includes(constraint),
      `${constraint} replaces its validity scan, so the store refuses at write `
      + 'what the sweep detected afterwards');
  }
  assert.ok(!PROFILE_SELF_WRITABLE.includes('staff_role'),
    'and the column it reverted is one nobody may write, so it cannot drift');
  // Five. `offboardUser` was held by `entity_not_carried` first until D84
  // settled that leg, so it arrives here where the measurement always said it
  // belonged. `setNurseDutyStatus` left: it was never an administrative write,
  // and it was here because `writtenColumns` could not read a patch assembled
  // into a local object before the call. Its six columns are all on
  // `PROFILE_SELF_WRITABLE`.
  //
  // The four that remain are held for TWO different reasons, and the split is
  // worth keeping because only one of them is a decision about D82's open
  // path. `userManagement` and `userManagementV2` write `role`, `staff_role`,
  // `full_name` and `credential_type`, none of which a person may assert about
  // themselves; `offboardUser` hands over a patch that reaches the call as a
  // parameter, so it is genuinely unreadable. `autoApproveInvitedUser` and
  // `autoEndDutyDay` write only allowlisted columns and are held by the OTHER
  // half of the rule — a `schedulerAuth` fence means there is no caller for a
  // self-scoped policy to admit, which is D49's open decision rather than
  // this one.
  const writesUser = Object.keys(held).filter(name => held[name].includes('User')).sort();
  assert.deepEqual(writesUser,
    ['autoApproveInvitedUser', 'autoEndDutyDay', 'offboardUser',
      'userManagement', 'userManagementV2'],
    'the administrative write path D82 leaves open');
  assert.equal(writesUser.length, 5);
  for (const scheduled of ['autoApproveInvitedUser', 'autoEndDutyDay']) {
    assert.ok(discoverEvidence(repository).schedulerAuthFunctions.includes(scheduled),
      `${scheduled} is held by its missing caller, not by its columns`);
  }
  assert.ok(writtenColumns(
    readFileSync(resolve(repository, 'base44/functions/userManagement/entry.ts'), 'utf8'), 'User')
    .some(column => !PROFILE_SELF_WRITABLE.includes(column)),
    'and these two are held by their columns, which are now readable');
  assert.deepEqual(report.port_blockers.entity_authorization.filter(name => !held[name]), [],
    'every member is held by a write this measured');
  // And what holds each of the six, named, so a later widening of the
  // allowlist has to come past this list rather than past a count.
  //
  // `autoEndDutyDay` is the one worth reading twice: both columns it writes
  // ARE in D82's allowlist, and it stays blocked because it has no caller —
  // `schedulerAuth` admits a shared secret, and "the caller's own row" admits a
  // shared secret to nothing. A rule written over columns alone would have
  // reported a nightly sweep of every on-duty person in the deployment as a
  // self-service profile edit.
  assert.deepEqual(evidence.entityReach.autoEndDutyDay.writeColumns.User, ['duty_on_since', 'duty_status']);
  assert.ok(scheduled.has('autoEndDutyDay') && !scheduled.has('setNurseDutyStatus'));
  assert.deepEqual(evidence.entityReach.enforceStaffRoleIntegrity.writeColumns.User, ['staff_role'],
    'a column nobody may assert about themselves');
  // Two of these were once four. `writtenColumns` now reads a patch assembled
  // into a local object before the call, so `userManagement` and its V2 are
  // held by their COLUMNS — `role`, `staff_role`, `full_name`,
  // `credential_type`, none of them assertable about oneself — rather than by
  // being unreadable, and `setNurseDutyStatus` left the bucket entirely. The
  // answer for the pair did not change and its REASON did, which is worth
  // pinning: a bucket can be right for a reason that is wrong.
  for (const opaque of ['autoApproveInvitedUser', 'offboardUser']) {
    assert.equal(evidence.entityReach[opaque].writeColumns.User, null,
      `${opaque} assembles its payload, so what it sets cannot be read here`);
  }
  for (const readable of ['userManagement', 'userManagementV2']) {
    assert.deepEqual(evidence.entityReach[readable].writeColumns.User,
      ['credential_type', 'full_name', 'phone', 'role', 'staff_role'],
      `${readable} is held by what it writes, not by what cannot be read`);
  }
  assert.ok(report.port_blockers.entity_authorization.includes('offboardUser'));
  assert.deepEqual(report.port_blockers.entity_not_carried, []);
  // The other half of the corrected paragraph: the read rule is a guard that
  // fires on nothing, and the RPC it said these were waiting for exists.
  assert.deepEqual(discoverPolicylessEntities(repository), []);
  const { HANDLER_NAMES } = await import('./services/pennsync-api/handlers.mjs');
  for (const handler of ['listAgencyRoster', 'getAgencyRosterMember']) {
    assert.ok(HANDLER_NAMES.includes(handler), `${handler} is the roster RPC the bucket said it was waiting for`);
  }
});

test('a retention basis is refused for a retired FUNCTION, not merely unnecessary', () => {
  // The scope of the retention check, pinned rather than left to a comment.
  //
  // `RETIRING_DISPOSITIONS`' own header says "every retired ENTITY also carries
  // a retention basis", which is exact and reads narrower than a skimming
  // reader takes it: the loop that enforces it is inside `if (family ===
  // 'entities')`, so a retired FUNCTION owes none. `enforceStaffRoleIntegrity`
  // is the first retired function this repository has, so this is the first
  // time the distinction has been reachable at all, and the next person to
  // retire one will read that header and believe they owe a basis.
  //
  // What makes this worth a test rather than a comment beside the comment: the
  // two statements differ in strength and only one of them is checkable.
  // "No entry is needed" is satisfied by a gate that never looks. "An entry is
  // REFUSED, by name" is satisfied only by a gate whose scope is real. So the
  // entry is planted and the refusal is read back — which is how this was
  // established in the first place, rather than by reading the `if`.
  const manifest = parseManifest(
    readFileSync(resolve(repository, 'tools-transition-disposition.json'), 'utf8'));
  assert.equal(manifest.functions.enforceStaffRoleIntegrity, 'retire',
    'this test is about a retired function, so it needs one to exist');
  assert.ok(!Object.hasOwn(manifest.retention, 'enforceStaffRoleIntegrity'),
    'the committed manifest carries no basis for it');

  // A WELL-FORMED entry, so what the gate objects to is the family and not the
  // shape. A malformed one would be rejected for the wrong reason and would
  // prove nothing about scope.
  const planted = {
    ...manifest,
    retention: {
      ...manifest.retention,
      enforceStaffRoleIntegrity: { basis: 'none', reason: 'operational rows only, planted by a test' },
    },
  };
  const report = checkCoverage(discoverCapabilities(repository), planted, discoverEvidence(repository));
  assert.ok(report.retention_unused.includes('entities:enforceStaffRoleIntegrity'),
    'a basis for a retired function is reported as unused, which is the gate saying '
    + 'the retention question is the entities family\'s and not every family\'s');
  assert.equal(report.retention_settled, false,
    'and it is blocking rather than advisory, so nobody can add one quietly');

  // The control, because a gate that rejected EVERY planted entry would satisfy
  // the assertions above while having no scope at all. A retired ENTITY's basis
  // is accepted, so the refusal above is about the family and not about the act
  // of planting.
  const [entity] = Object.keys(manifest.entities)
    .filter(name => manifest.entities[name] === 'retire').sort();
  assert.ok(entity, 'the control needs a retired entity to exist');
  assert.ok(Object.hasOwn(manifest.retention, entity),
    `${entity} is retired and carries a basis, which is the accepted case`);
  const settled = checkCoverage(discoverCapabilities(repository), manifest, discoverEvidence(repository));
  assert.deepEqual(settled.retention_unused, [],
    'the committed manifest has no unused basis, so the planted one above is the difference');
});

test('what `core_integration` blocks is measured per module, not assumed from the reach', () => {
  // The rule is `/\.\s*integrations\s*\./` and answers on the SHAPE of the
  // call — D76's defect, in the family next door. It never asks whether the
  // call sits on a path the module itself already refuses, and for one of the
  // three it does.
  //
  // The discriminator is D74's own words about `sendAccountReadyEmail`, whose
  // "whole body is one `Core.SendEmail`": does the module have a SUCCESS
  // answer that is not the integration's result? Where every success path goes
  // through the send, the send is the capability and the runtime is what it
  // waits on. Where one does not, the capability is a PARTIAL port — the shape
  // D42, D49, D50, D52, D54 and D73 already ship six times, with the delivery
  // paused and REPORTED as paused.
  const read = (name) => readFileSync(resolve(repository, 'base44/functions', name, 'entry.ts'), 'utf8');
  const coreReaches = (source) =>
    [...source.matchAll(/integrations\s*\.\s*Core\s*\.\s*([A-Za-z]+)/g)].map(match => match[1]);
  for (const name of ['generatePatientHandout', 'sendAccountReadyEmail', 'sendWelcomeEmail']) {
    assert.deepEqual([...new Set(coreReaches(read(name)))], ['SendEmail'],
      `${name} reaches a Core operation other than the send`);
  }
  // The two the bucket is right about: every success answer they can give is
  // the send's own confirmation.
  for (const name of ['sendAccountReadyEmail', 'sendWelcomeEmail']) {
    const successes = [...read(name).matchAll(/return Response\.json\(\{\s*success: true[^\n]*/g)].map(m => m[0]);
    assert.equal(successes.length, 1, `${name} has more than one success answer`);
    assert.match(successes[0], /email sent/, `${name}'s success answer is not the send's`);
  }
  // The one it is wrong about. Its single reach is inside an `action ===
  // 'email'` branch that the module's OWN gate refuses before any work is
  // done, and two success answers carry a rendered PDF instead.
  const handout = read('generatePatientHandout');
  const lines = handout.split('\n');
  const sendLine = lines.findIndex(line => /integrations\s*\.\s*Core\s*\.\s*SendEmail/.test(line));
  const guardLine = lines.findIndex(line => /if \(action === 'email' && !outboundDeliveryReleased\(\)\)/.test(line));
  const branchLine = lines.findLastIndex((line, index) =>
    index < sendLine && /if \(action === 'email'/.test(line));
  assert.ok(guardLine > 0 && guardLine < sendLine, 'the release gate no longer precedes the send');
  assert.ok(branchLine > guardLine, 'the send is no longer inside an action branch');
  assert.match(lines[guardLine + 1], /outboundDeliveryPausedResponse\('email'\)/,
    'the gate no longer refuses the email action');
  const pdfAnswers = [...handout.matchAll(/return Response\.json\(\{[^)]*\bpdf:/g)];
  assert.equal(pdfAnswers.length, 2, 'the document action no longer answers with a PDF');
  // So the document action waited on nothing: six sibling capabilities
  // already rendered a PDF in the ported service, its only entity is a retired
  // log table D25 gives a successor, and the email action is the owner
  // decision the six paused-delivery ports already record as paused. It was
  // WORK, not a decision — which is what `core_integration: 3` read as
  // denying — and D81 did it: the port serves the document and refuses the
  // send with the answer this gate gives.
  for (const sibling of ['generateBagTechniquePDF', 'generateUserRosterPDF', 'generatePatientChartPDF',
    'generateUserManual', 'generateSmartNoteGuide', 'generateUserGuidePDF', 'generatePatientHandout']) {
    assert.ok(discoverPortedFunctions(repository).includes(sibling), `${sibling} is a ported PDF`);
  }
});

test('nothing in the queue is startable and unwritten', async () => {
  // The milestone the counts do not state. `none` means "portable today", and
  // a reader takes a non-empty one as work available now — so the thing worth
  // asserting is that it is not: all 73 are written, and every capability left
  // is behind a decision or a phase rather than behind somebody's time.
  //
  // It runs in ONE direction only, and the first draft of this test claimed
  // two. A capability in `none` with no handler is startable work the queue
  // stopped surfacing, and that is checkable — sabotaging the registry path
  // fails this. The converse is not: `checkCoverage` sends a ported capability
  // to `none` without consulting `refine` at all, so "blocked, yet written"
  // cannot occur however wrong a blocker is, and an assertion against it
  // passes for a reason that has nothing to do with the queue being right.
  // That override has its own test ("nothing blocks a port that has
  // happened"); this one would only have looked like a second.
  const report = checkCoverage(
    discoverCapabilities(repository),
    parseManifest(readFileSync(resolve(repository, 'tools-transition-disposition.json'), 'utf8')),
    discoverEvidence(repository),
  );
  const { HANDLER_NAMES } = await import('./services/pennsync-api/handlers.mjs');
  const shipped = new Set(HANDLER_NAMES);
  assert.deepEqual(report.port_blockers.none.filter(name => !shipped.has(name)), [],
    'a capability the queue calls portable today has no handler');
  // The handlers over and above the queue are facilities rather than Base44
  // capabilities — they are not in `base44/functions`, so the queue never
  // counted them, and the list only grows as the frontend's own reads are
  // served. Two are the roster contract's (D22). One is the broker family's
  // only caller: the family serves the entities whose own schema plainly
  // permits a read, which is a disposition rather than a capability.
  //
  // Batch A's seven reference reads (D101), batch C's fourteen clinical
  // library, patient education and configuration capabilities, batch E's
  // ten screen records, batch D's fourteen over the operational tables and
  // the five compliance domains' read half, the provider directory's three
  // writes, and the telecom family's fifteen over the fax address book,
  // templates, retry policy, work numbers and transmission log, are the same
  // kind of thing for the same reason, and
  // they are why this list needs stating rather than deriving. The SPA called
  // `base44.entities.Physician.list(...)` and the rest straight through the
  // platform SDK, so there is no Base44 function to be the port of — what was
  // ported is the CALL, and what it succeeds is each entity's own `rls` block
  // rather than a module. The queue measures `base44/functions`, so it can
  // never count them and their absence from it is not a gap — which is exactly
  // why they are enumerated here, where a name arriving without a reviewed
  // contract has to come past this list.
  const facilities = [...shipped].filter(name => !report.port_blockers.none.includes(name)).sort();
  // The list is STATED, for the reason above. This only adds the half that is
  // checkable: a name with a Base44 function of its own is a port and belongs
  // in the queue, so it cannot reach this list by somebody forgetting which
  // kind it was.
  for (const name of facilities) {
    assert.ok(!existsSync(resolve(repository, 'base44/functions', name)),
      `${name} has a Base44 function, so it is a port and belongs in the queue`);
  }
  assert.deepEqual(facilities, [
    'bulkCreateFaxContacts', 'createAdrAuditCase', 'createAgencyTask',
    'createComplianceAudit', 'createFaxContact', 'createFaxTemplate',
    'createNoteConversion', 'createPhysician', 'deleteAdrAuditCase',
    'deleteDocumentTemplate', 'deleteFaxContact', 'deleteFaxTemplate',
    'deleteLibraryDocument', 'deleteOnCallShift', 'deletePdfTemplate', 'deletePhysician',
    'getAgencyRosterMember', 'getAgencySettings', 'getFaxRetryConfig',
    'getMyNotificationPreferences', 'listAdrAuditCases', 'listAgencyIncidents',
    'listAgencyPhoneNumbers', 'listAgencyRoster', 'listAgencyTasks',
    'listBrokeredRecords', 'listCarePlans', 'listChartClinicalEvents',
    'listChartRecommendations', 'listClinicalLibraryFolders',
    'listClinicalLibraryTemplates', 'listClinicalPathways', 'listComplianceAudits',
    'listCustomValidationRules', 'listDocumentTemplates', 'listEducationMaterials',
    'listFaceToFaceEncounters', 'listFaxContacts', 'listFaxLogs', 'listFaxTemplates',
    'listLibraryDocuments', 'listMedicareComplianceRules', 'listMedicareGuidelines',
    'listNoteConversions', 'listOcrCorrections', 'listOcrTrainingRuns',
    'listOnCallShifts', 'listPatientDocumentRecords', 'listPatientEducationAssignments',
    'listPdfTemplates', 'listPersonnelCredentials', 'listPhysicians',
    'listPolicyAcknowledgments', 'listSentEducationMaterials', 'listVisitPointConfigs',
    'lookupComplianceRule', 'manageClinicalLibraryFolder',
    'manageClinicalLibraryTemplate', 'manageClinicalPathway',
    'manageCustomValidationRule', 'manageEducationMaterial',
    'managePatientEducationAssignment', 'readAiConfiguration',
    'recordChartRecommendation', 'recordSentEducationMaterial', 'saveAgencySettings',
    'saveAiConfiguration', 'saveCarePlan', 'saveDocumentTemplate',
    'saveFaceToFaceEncounter', 'saveFaxRetryConfig', 'saveMyNotificationPreferences',
    'saveOnCallShift', 'savePdfTemplate', 'searchFaxLogs', 'updateAdrAuditCase',
    'updateComplianceAudit', 'updateFaxContact', 'updateFaxTemplate',
    'updateLibraryDocument', 'updatePhysician', 'useFaxTemplate',
  ]);
});

test('a function call is only a reason to wait while the callee is unported', () => {
  const invoked = invokedFunctions(`
    const a = await base44.functions.invoke('portedOne', {});
    const b = await base44.functions.fetch('/portedTwo', {});
  `);
  assert.deepEqual(invoked, { names: ['portedOne', 'portedTwo'], dynamic: false });
  // `fetch` addresses the function by PATH, so the leading slash is not part of
  // the name and a set that kept it would match nothing in the registry.
  assert.equal(invoked.names.includes('/portedTwo'), false);
});

test('a function set nothing can enumerate claims nothing', () => {
  // `testAutomations` invokes a name it was handed. Every reach is counted and
  // only the parsed shapes are named, so an unparsed one leaves the set
  // dynamic and the capability keeps waiting — the same rule `entityReach`
  // follows for a computed key, and the same direction: fail closed.
  assert.deepEqual(invokedFunctions(`
    const r = await base44.functions.invoke(fnName, {});
  `), { names: [], dynamic: true });
  assert.deepEqual(invokedFunctions(`
    await base44.functions.invoke('known', {});
    await base44.functions[pick]('other', {});
  `), { names: ['known'], dynamic: true });
  for (const value of [null, undefined, 42, {}]) {
    assert.deepEqual(invokedFunctions(value), { names: [], dynamic: true });
  }
});

test('the callee is read from the call, never from the module that holds it', () => {
  // `asServiceRole` never reaches this bucket — `classifyPortBlocker` answers
  // `records_schema` for it first — and the same regex is what counts reaches
  // here, so the two agree about what a reach is.
  assert.equal(classifyPortBlocker("await base44.functions.invoke('x', {});"), 'ported_function');
  assert.equal(classifyPortBlocker("await base44.asServiceRole.functions.invoke('x', {});"),
    'records_schema');
  assert.deepEqual(invokedFunctions("await base44.asServiceRole.functions.invoke('x', {});"),
    { names: [], dynamic: false });
});

test('what is left once the call is not the reason is asked, not assumed', () => {
  // The sibling of `classifyWithoutEntities`, masked the same way. It needs no
  // entity masking: `records_schema` and `files` are answered BEFORE
  // `ported_function`, so a module reaching this verdict has neither.
  assert.equal(classifyWithoutInvocations("await base44.functions.invoke('x', {});"), 'none');
  assert.equal(classifyWithoutInvocations(
    "await base44.functions.invoke('x', {}); await base44.integrations.Core.SendEmail({});"),
  'core_integration');
  assert.equal(classifyWithoutInvocations(
    "await base44.functions.invoke('x', {}); const k = Deno.env.get('OPENAI_API_KEY');"),
  'external_secret');
  // And the real module: nothing but the call was ever holding it.
  assert.equal(discoverInvocationFreeBlockers(repository).extractReferralDataForSmartNote, 'none');
});


test('what counts as already ported is read from the service, not maintained here', async () => {
  // The parse would be worth nothing if it could silently stop matching the
  // registry it reads, so it is checked against the module's own export.
  const { HANDLER_NAMES } = await import('./services/pennsync-api/handlers.mjs');
  const parsed = discoverPortedFunctions(repository);
  assert.deepEqual(parsed, [...HANDLER_NAMES].sort(), 'the registry parse drifted from the registry');
  assert.ok(parsed.length >= 2, 'the ported registry should not be empty');
  // A missing service is not an error: the classifier just reports everything
  // as blocked, which is the safe direction.
  assert.deepEqual(discoverPortedFunctions(resolve(repository, 'src')), []);
});

test('the port queue never decides the census', () => {
  // A port becoming possible, or being written, must not fail the gate. It moves
  // a count here and the plan's prose with it, nothing else.
  const evidence = { inertFunctions: [], portBlockers: { alpha: 'none' } };
  const ready = checkCoverage(capabilities(), manifest({ review_state: 'accepted' }), evidence);
  assert.equal(ready.census_ready, true);
  assert.deepEqual(ready.port_blockers.none, ['alpha']);
  const blocked = checkCoverage(capabilities(), manifest({ review_state: 'accepted' }),
    { inertFunctions: [], portBlockers: { alpha: 'records_schema' } });
  assert.equal(blocked.census_ready, true);
  assert.deepEqual(blocked.port_blockers.records_schema, ['alpha']);
  // Having been written outranks whatever its Base44 original still imports:
  // nothing blocks a port that has happened.
  const written = checkCoverage(capabilities(), manifest({ review_state: 'accepted' }),
    { inertFunctions: [], portBlockers: { alpha: 'records_schema' }, portedFunctions: ['alpha'] });
  assert.deepEqual(written.port_blockers.none, ['alpha']);
  assert.deepEqual(written.port_blockers.records_schema, []);
  // A function the evidence says nothing about is queued as the most blocking
  // rather than silently counted as ready to write.
  const unknown = checkCoverage(capabilities(), manifest({ review_state: 'accepted' }), { inertFunctions: [] });
  assert.deepEqual(unknown.port_blockers.records_schema, ['alpha']);
  // And only `port` is queued: a brokered or paused function is not waiting on this.
  const brokered = checkCoverage(capabilities(), manifest({ functions: { alpha: 'broker' } }), evidence);
  assert.deepEqual(Object.values(brokered.port_blockers).flat(), []);
});

test('every function the classifier calls portable really needs nothing but authority', () => {
  const blockers = discoverPortBlockers(repository);
  for (const [name, blocker] of Object.entries(blockers)) {
    if (blocker !== 'none') continue;
    const source = readFileSync(resolve(repository, 'base44/functions', name, 'entry.ts'), 'utf8');
    assert.doesNotMatch(source, /\.\s*entities\s*\.|asServiceRole|\.\s*integrations\s*\.|\bbase44\s*\.\s*functions\b/,
      `${name} reaches data but is queued as portable`);
    assert.doesNotMatch(source, /\bDeno\s*\.\s*env\s*\.\s*get\b/, `${name} reads a secret but is queued as portable`);
  }
});

test('accepted dispositions are the exact reviewed set', () => {
  assert.deepEqual([...DISPOSITIONS].sort(), ['broker', 'hub', 'port', 'preserved_paused', 'retire', 'undecided']);
  for (const value of DISPOSITIONS) assert.doesNotThrow(() => parseManifest(JSON.stringify(manifest({ functions: { alpha: value } }))));
});

test('discovered integrations include every adapter the external runtime implements', () => {
  const discovered = discoverIntegrations(repository);
  for (const operation of ['InvokeLLM', 'ExtractDataFromUploadedFile', 'SendEmail',
    'UploadFile', 'UploadPrivateFile', 'CreateFileSignedUrl']) {
    assert.ok(discovered.includes(operation), `missing ${operation}`);
  }
  // Discovered from source, not a hand-kept list.
  assert.ok(discovered.includes('GenerateImage'));
});

test('the command line refuses unknown arguments and an unavailable manifest', () => {
  const lines = [];
  assert.equal(main(['--apply'], { repository, log: value => lines.push(value) }), 2);
  assert.equal(JSON.parse(lines[0]).error, 'INVALID_ARGUMENTS');
  lines.length = 0;
  assert.equal(main([], { repository: resolve(repository, 'src'), log: value => lines.push(value) }), 2);
  assert.ok(JSON.parse(lines[0]).error);
});

test('a capability switched off at source cannot be carried as portable work', () => {
  const paused = `import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';
const FEATURE_ENABLED = false;
Deno.serve(async (req) => {
  if (!FEATURE_ENABLED) {
    return Response.json({ success: false, available: false, reason: 'feature_paused' }, { status: 409 });
  }
  const base44 = createClientFromRequest(req);
  return Response.json(await base44.entities.Patient.list());
});`;
  assert.equal(isPausedFunction(paused), true);
  // The flag is a const pinned false, so `if (!FLAG)` is always taken. That is
  // why this needs no heuristic: proving the branch returns proves every caller
  // is refused.
  assert.equal(isPausedFunction(paused.replace('= false', '= true')), false);
  // A guard that does not answer leaves the handler live.
  assert.equal(isPausedFunction(paused.replace(/return Response\.json\([^;]*;/, 'console.warn("paused");')), false);
  // A flag nothing branches on is not a pause.
  assert.equal(isPausedFunction("const FEATURE_ENABLED = false;\nDeno.serve(() => Response.json({}));"), false);
  assert.equal(isPausedFunction(null), false);

  // Separate from the inert check on purpose: a paused module still imports and
  // awaits, it simply never reaches any of it. Seven paused capabilities sat in
  // the port queue as writable work because the inert check could not see them.
  assert.equal(isInertFunction(paused), false);
});

test('every capability paused at source is carried paused rather than queued', () => {
  const pausedNames = discoverPausedFunctions(repository);
  const declared = parseManifest(readFileSync(resolve(repository, 'tools-transition-disposition.json'), 'utf8')).functions;
  // The owner released most paused capabilities on 2026-10-08 ("turn
  // everything on"). What stays paused is what the owner removed (risk
  // prediction, PDGM payment) and destructive one-off maintenance, so the
  // floor is the size of that set rather than of the old backlog.
  assert.ok(pausedNames.length >= 5, `expected the removed and maintenance set to stay paused, saw ${pausedNames.length}`);
  const carried = pausedNames.filter(name => ACTIVE_DISPOSITIONS.includes(declared[name]));
  assert.deepEqual(carried, [],
    'a paused handler declared port, broker or hub claims work that cannot be written');
});

test('the contradiction is reported rather than tolerated', () => {
  const manifest = parseManifest(readFileSync(resolve(repository, 'tools-transition-disposition.json'), 'utf8'));
  const [victim] = discoverPausedFunctions(repository);
  const drifted = { ...manifest, functions: { ...manifest.functions, [victim]: 'port' } };
  const report = checkCoverage(discoverCapabilities(repository), drifted, discoverEvidence(repository));
  assert.ok(report.contradicted_disposition.some(entry => entry.includes(victim) && entry.includes('paused at source')),
    `${victim} declared port should be contradicted`);
});

test('a capability whose only entities are the claims helper is not waiting on the record store', () => {
  // D74, and the fifth correction of this shape. The generated
  // `trustedCallerClaims` helper reads `AgencyMembership` and `Agency` to
  // answer ONE question — what tenant role does this caller hold — and the
  // ported service answers it from the request envelope. D34 settled that
  // those two are the authority store's native model.
  const claims = discoverClaimsOnlyFunctions(repository);
  // Measured, not asserted: the set is derived by removing the fence and
  // re-running the SAME extractor, so a module that also reads a real row
  // keeps its entities and is untouched.
  for (const name of claims) {
    const source = readFileSync(resolve(repository, 'base44/functions', name, 'entry.ts'), 'utf8');
    assert.ok(entitiesTouched(source).names.length > 0, `${name} touches entities`);
    const bare = entitiesTouched(source.replace(TRUSTED_CLAIMS_FENCE, ''));
    assert.deepEqual(bare.names, [], `${name} touches none outside the helper`);
    assert.equal(bare.dynamic, false, `${name} indexes no namespace`);
  }
  // The one the measurement finds. `sendAccountReadyEmail` was the second and
  // LEFT the set rather than being removed from it: it now reads `User` to
  // prove the recipient is a registered user in the caller's own agency, which
  // is the open-relay fix its sibling `sendWelcomeEmail` carries too, so its
  // entity reach is no longer the claims fence alone. D74's refinement is
  // unchanged and the assertions below still pin what it answers for that
  // capability — only its membership here moved, because the capability did.
  // `submitAppFeedback` (2026-10-08) joined it: its whole reach is the claims
  // fence plus one gated `Core.SendEmail` to the configured owner, and it is
  // carried `preserved_paused`, so it adds nothing to the port queue.
  // `generateCarePlanFromReferral` and `generateAdmissionNoteFromReferral`
  // (released 2026-10-08) joined too: they read no record at all, only the
  // claims fence that decides the caller holds an active membership, and both
  // are carried `preserved_paused`, so neither adds to the port queue.
  assert.deepEqual([...claims].sort(), [
    'autoImportPatients', 'generateAdmissionNoteFromReferral',
    'generateCarePlanFromReferral', 'submitAppFeedback',
  ]);

  const report = checkCoverage(
    discoverCapabilities(repository),
    parseManifest(readFileSync(resolve(repository, 'tools-transition-disposition.json'), 'utf8')),
    discoverEvidence(repository),
  );
  // `sendAccountReadyEmail`'s whole body is one `Core.SendEmail`, so reporting
  // it as startable-today said a capability could be written whose only work
  // is the send D56 has not decided. The refinement that fixed that is still
  // what runs here — the claims fence is authorization, not records — and the
  // capability has since been written (D86), so it reads `none`. The check
  // that matters is unchanged: whatever it reads, it is not `records_schema`,
  // because its two entity reads never wanted the record store.
  assert.equal(report.port_blockers.records_schema.includes('sendAccountReadyEmail'), false);
  assert.ok(report.port_blockers.none.includes('sendAccountReadyEmail'));
  // And the refinement itself, asked directly, still answers what it did: a
  // port of this capability that had NOT been written would read
  // `core_integration` rather than `records_schema`.
  assert.equal(discoverEntityFreeBlockers(repository).sendAccountReadyEmail, 'core_integration');
  // `autoImportPatients` is `preserved_paused` and in no bucket, so the
  // refinement changes nothing for it — which is the check that this fires
  // where it should and nowhere else.
  for (const names of Object.values(report.port_blockers)) {
    assert.equal(names.includes('autoImportPatients'), false);
  }
  // The bucket reached zero under D75, by finding the last entry had been
  // paused at source all along, went to 3 under D84 — which is the queue
  // working rather than failing, since those are carried capabilities whose
  // one uncarried leg now has a named successor — reached 0 again once D89,
  // D90 and D91 wrote all three, and went to 1 and back inside one change. A
  // count that only ever falls cannot represent work arriving, and one that
  // only ever rises is a queue nobody is clearing.
  //
  // That last entry arrived on a correction to `writtenColumns` rather than on
  // a decision: `setNurseDutyStatus` assembles its patch into a local object
  // before the call, which the reader could not see, so a capability whose six
  // columns are all on D82's allowlist was reported as writing something
  // outside it. It was written the same day it became visible, so the measured
  // line never carried it and only this comment records that it was there.
  //
  // The label on the last of them was wrong on this page until the module was
  // read. It was filed as carrying "two `Core.SendEmail` behind
  // `outboundDeliveryGate`"; it has ONE, and the branch it sits on is one the
  // module already refuses itself — D79's `generatePatientHandout` exactly, so
  // D81's partial shape served it. The other "SendEmail" was a docstring.
  assert.deepEqual(report.port_blockers.records_schema, []);
});

test('a flag pinned true pauses a handler exactly as one pinned false does', () => {
  // D75, and D47's failure for the third time — in a third shape, with the
  // same lesson: when a check exists to stop a class of mistake, re-derive the
  // shapes from the tree rather than from the check.
  const released = 'const RELEASED = false;\nif (!RELEASED) { return refusal(); }\n';
  const suspended = 'const THING_PAUSED = true;\nif (THING_PAUSED) { return refusal(); }\n';
  assert.equal(isPausedFunction(released), true, 'the shape D47 taught it');
  assert.equal(isPausedFunction(suspended), true, 'and the same pause written the other way');
  // Neither polarity fires without a RETURN in the guard's own branch: a flag
  // that merely logs is not a pause.
  assert.equal(isPausedFunction('const THING_PAUSED = true;\nif (THING_PAUSED) { log(); }\n'),
    false);
  // And a live flag is not a pause either way round.
  assert.equal(isPausedFunction('const RELEASED = true;\nif (!RELEASED) { return refusal(); }\n'),
    false, 'a true RELEASED with a negated guard is the live branch');

  // Thirteen modules in the tree used the flipped polarity, and the check saw
  // none of them. Twelve already carried `preserved_paused` because somebody
  // had read them; the thirteenth carried `port`. `deduplicatePatients` has
  // since been switched back ON at source by an owner decision (its flag now
  // reads `false`), so it is no longer detected as paused; it keeps
  // `preserved_paused` because that disposition answers the migration question,
  // not whether the Base44 handler serves, and a live handler under it
  // contradicts nothing.
  const paused = new Set(discoverPausedFunctions(repository));
  const manifest = parseManifest(
    readFileSync(resolve(repository, 'tools-transition-disposition.json'), 'utf8'));
  assert.equal(paused.has('deduplicatePatients'), false, 'the merge broker is live at source');
  assert.equal(manifest.functions.deduplicatePatients, 'preserved_paused');
  const flipped = ['createTelehealthToken',
    'generateMessageSuggestions', 'markMessageRead', 'messagingAssistant',
    'notifyUrgentMessage', 'processCompletedVisit',
    'saveOasisResponses', 'sendMessage', 'summarizeMessageThread'];
  // scheduleSms and dispatchScheduledSms were released by the owner on
  // 2026-10-08 and no longer pause; they keep the `preserved_paused`
  // disposition (Base44-hosted, no port-queue movement).
  // redriveFailedSms followed on the same day, once SmsMessage rows became
  // server-only and carry the provenance it re-proves; its flag is removed.
  for (const name of ['scheduleSms', 'dispatchScheduledSms', 'redriveFailedSms']) {
    assert.equal(paused.has(name), false, `${name} is released`);
    assert.equal(manifest.functions[name], 'preserved_paused');
  }
  // Released by the owner on 2026-10-08 ("approve everything"). A released
  // module keeps its flag, now pinned false, and must no longer read as paused;
  // its disposition stays `preserved_paused`, which the one-directional gate
  // permits for a live module.
  // saveOasisResponses joined them on the same date with the OASIS Center: its
  // writes are authorized by membership and the care-team table, and its
  // contract suite pins that rather than the pause. The two message AI
  // brokers, the assistant router, the urgent notifier and post-visit
  // processing followed on 2026-10-08 ("turn everything on").
  const releasedByOwner = new Set([
    'createTelehealthToken', 'markMessageRead', 'saveOasisResponses', 'sendMessage',
    'generateMessageSuggestions', 'messagingAssistant', 'notifyUrgentMessage',
    'processCompletedVisit', 'summarizeMessageThread',
  ]);
  for (const name of flipped) {
    const source = readFileSync(
      resolve(repository, 'base44/functions', name, 'entry.ts'), 'utf8');
    assert.equal(manifest.functions[name], 'preserved_paused',
      `${name} carries the disposition its source already had`);
    if (releasedByOwner.has(name)) {
      assert.match(source, /^const\s+[A-Z][A-Z0-9_]*_PAUSED\s*=\s*false\s*;/m, `${name} keeps its released flag`);
      assert.ok(!paused.has(name), `${name} is released and not detected as paused`);
      continue;
    }
    assert.match(source, /^const\s+[A-Z][A-Z0-9_]*\s*=\s*true\s*;/m, `${name} pins a flag`);
    assert.ok(paused.has(name), `${name} is detected as paused`);
  }
  // Every real module that paused with this polarity was released by the
  // owner on 2026-10-08, so none is left to exercise it, and the `suspended`
  // fixture at the top of this test is now what proves the shape is still
  // recognised. If a module ever pauses this way again it belongs in `flipped`.
  assert.equal(flipped.filter((name) => !releasedByOwner.has(name)).length, 0,
    'a module in `flipped` is paused again: it should be asserted paused above, not released');
  // D47's rule: switching a capability off means changing its disposition in
  // the same change. `processCompletedVisit` was switched off long ago and the
  // disposition never caught up, so the gate contradicted it until it did.
  assert.equal(manifest.functions.processCompletedVisit, 'preserved_paused');
});

test('a write payload assembled before the call is read, and only when every use is accounted for', () => {
  // The blind spot: `writtenColumns` knew ONE shape of a payload, an object
  // literal at the call, and the tree writes in two. `setNurseDutyStatus`
  // declares `const update = {}` and assigns six members before handing it
  // over — every one of them on D82's allowlist — and the reader answered
  // `null`, which the classifier reads as outside the narrowing. The
  // capability sat in `entity_authorization` on a fact about the READER.
  //
  // It is D7, D47 and D75's shape a fourth time and it failed in the opposite
  // DIRECTION: those three admitted what they should have refused, this one
  // refused what it should have admitted. Nothing was ever wrong; one
  // capability was merely reported unstartable, which is why it lasted.
  const assembled = [
    'const update = {};',
    "if (a) update.duty_status = 'on_duty';",
    'if (b) update.off_duty_message = clean;',
    'if (Object.keys(update).length === 0) return;',
    'await base44.asServiceRole.entities.User.update(target.id, update);',
  ].join('\n');
  assert.deepEqual(writtenColumns(assembled, 'User'),
    ['duty_status', 'off_duty_message']);

  // And it stays fail-closed. Each of these is a way the module could put a
  // column there that nothing here can name, so the answer is `null` — the
  // same answer the narrow reader gave, for a reason rather than by default.
  const refuses = {
    'a computed key': 'update[key] = 1;',
    'an assign into it': 'Object.assign(update, extra);',
    'handed to a helper': 'decorate(update);',
    'declared twice': '{ const update = {}; }',
  };
  for (const [label, line] of Object.entries(refuses)) {
    const sabotaged = assembled.replace('const update = {};', `const update = {};\n${line}`);
    assert.equal(writtenColumns(sabotaged, 'User'), null, `${label} should not be readable`);
  }
  // A payload that is not an object literal at all was never readable and is
  // not now.
  assert.equal(writtenColumns(assembled.replace('const update = {};', 'const update = build();'), 'User'),
    null);

  // A READ of the payload counts as a write, deliberately. Over-reporting a
  // column can only push a capability back toward `entity_authorization`,
  // which is the safe direction; missing one would admit a write nobody saw.
  const reads = assembled.replace('await base44',
    'log(update.is_approved);\nawait base44');
  assert.deepEqual(writtenColumns(reads, 'User'),
    ['duty_status', 'is_approved', 'off_duty_message']);

  // A DELETE names a row, never a payload. Resolving its argument would answer
  // "writes no columns" about a call that removes every one of them.
  assert.equal(writtenColumns('const row = {};\nawait entities.User.delete(row);', 'User'), null);
});

test('a scan for a name reads everything that spells the name', () => {
  // One line put `setNurseDutyStatus` out of reach of the fix above: it
  // refuses an empty patch with the message 'Nothing to update', and its
  // payload is called `update`. The identifier was right, the occurrence was
  // real, and it was in prose — D73's rule arriving at a string literal.
  //
  // The wider claim is the reusable one: the parts of a module that spell
  // things without meaning them are strings, comments and regular
  // expressions. Mask them once; an exclusion written for one shape is the
  // next shape's blind spot.
  const masked = maskLiteralsAndComments([
    "const update = {};",
    "update.duty_status = 'on_duty';",
    "// update.is_approved would be outside the allowlist",
    "if (!x) return json({ error: 'Nothing to update' });",
    "const pattern = /update\\.is_manager/;",
    'const note = `update.role`;',
    'await entities.User.update(id, update);',
  ].join('\n'));
  assert.equal(masked.length > 0, true);
  for (const hidden of ['is_approved', 'is_manager', 'role', 'Nothing to']) {
    assert.equal(masked.includes(hidden), false, `${hidden} should be masked`);
  }
  // Indices survive, or every offset computed against the mask would be wrong
  // about the source it came from.
  assert.equal(masked.indexOf('const update = {};'), 0);
  assert.equal(masked.split('\n').length, 7);
  // And the code around the masked parts is untouched.
  assert.equal(masked.includes('update.duty_status'), true);
  assert.equal(masked.includes('entities.User.update(id, update)'), true);
});
