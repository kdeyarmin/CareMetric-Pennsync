import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { transpileTs } from '../../tools-transpile-ts.mjs';

async function loadHandler(functionName, {
  user,
  faxRows = [],
  contactRows = [],
  ruleRows = [],
  aiResponses = [],
  superAdminEmail = '',
} = {}) {
  let source = await readFile(
    new URL(`../functions/${functionName}/entry.ts`, import.meta.url),
    'utf8',
  );
  source = source.replace(
    /import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/,
    'const createClientFromRequest = globalThis.__faxTenantMakeClient;',
  );

  const temporaryModule = join(
    tmpdir(),
    `fax_tenant_${functionName}_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`,
  );
  await writeFile(temporaryModule, transpileTs(source).outputText);

  const calls = {
    bodyReads: 0,
    faxQueries: [],
    contactQueries: [],
    ruleQueries: [],
    ruleUpdates: [],
    llm: [],
  };
  const responses = [...aiResponses];
  const client = {
    auth: { me: async () => user },
    asServiceRole: {
      entities: {
        FaxLog: {
          filter: async (...args) => {
            calls.faxQueries.push(args);
            return faxRows;
          },
        },
        FaxContact: {
          filter: async (...args) => {
            calls.contactQueries.push(args);
            return contactRows;
          },
          list: async () => {
            throw new Error('FaxContact.list must never perform a global read');
          },
        },
        FaxPriorityRule: {
          filter: async (...args) => {
            calls.ruleQueries.push(args);
            return ruleRows;
          },
          update: async (...args) => {
            calls.ruleUpdates.push(args);
            return {};
          },
        },
      },
      integrations: {
        Core: {
          InvokeLLM: async (args) => {
            calls.llm.push(args);
            return responses.shift() ?? {};
          },
        },
      },
    },
  };

  let handler;
  globalThis.__faxTenantMakeClient = () => client;
  globalThis.Deno = {
    serve: (candidate) => { handler = candidate; },
    env: { get: (name) => (name === 'SUPER_ADMIN_EMAIL' ? superAdminEmail : undefined) },
  };
  try {
    await import(pathToFileURL(temporaryModule).href);
  } finally {
    await unlink(temporaryModule).catch(() => {});
  }
  return { handler, calls };
}

async function invoke(handler, calls, body) {
  const response = await handler({
    json: async () => {
      calls.bodyReads += 1;
      return body;
    },
  });
  return { response, json: await response.json() };
}

test('both fax analyzers fail closed before reads when authenticated identity has no email', async () => {
  for (const functionName of ['analyzeFaxContent', 'analyzeFaxPriority']) {
    const { handler, calls } = await loadHandler(functionName, {
      user: { id: 'no-email', role: 'admin', account_type: 'super_admin', is_active: true },
      faxRows: [{ id: 'fax-1', sent_by: 'victim@example.com', ocr_text: 'PHI' }],
      ruleRows: [{ id: 'foreign', user_email: 'victim@example.com', is_active: true }],
    });
    const { response } = await invoke(handler, calls, {
      fax_log_id: 'fax-1',
      document_name: 'STAT results',
    });

    assert.equal(response.status, 403, functionName);
    assert.equal(calls.bodyReads, 0, `${functionName} must reject before parsing caller input`);
    assert.deepEqual(calls.faxQueries, [], functionName);
    assert.deepEqual(calls.contactQueries, [], functionName);
    assert.deepEqual(calls.ruleQueries, [], functionName);
    assert.deepEqual(calls.llm, [], functionName);
  }
});

test('mutable admin and agency claims cannot authorize cross-owner fax content', async () => {
  const callers = [
    {
      email: 'attacker@example.com',
      role: 'user',
      account_type: 'super_admin',
      agency_name: 'Victim Agency',
      is_active: true,
    },
    {
      email: 'attacker@example.com',
      role: 'admin',
      account_type: 'super_admin',
      agency_name: '',
      is_active: true,
    },
  ];

  for (const user of callers) {
    const { handler, calls } = await loadHandler('analyzeFaxContent', {
      user,
      superAdminEmail: 'platform-owner@example.com',
      faxRows: [{ id: 'fax-1', sent_by: 'victim@example.com', ocr_text: 'private content' }],
    });
    const { response } = await invoke(handler, calls, {
      fax_log_id: 'fax-1',
      analysis_type: 'contacts',
    });

    assert.equal(response.status, 403);
    assert.equal(calls.faxQueries.length, 1);
    assert.deepEqual(calls.contactQueries, []);
    assert.deepEqual(calls.llm, []);
  }
});

test('configured protected platform admin is the only cross-owner content bypass', async () => {
  const { handler, calls } = await loadHandler('analyzeFaxContent', {
    user: { email: 'Platform-Owner@Example.com', role: 'admin', is_active: true },
    superAdminEmail: 'platform-owner@example.com',
    faxRows: [{ id: 'fax-1', sent_by: 'victim@example.com', ocr_text: 'private content' }],
    contactRows: [],
    aiResponses: [{ suggested_contacts: [] }],
  });
  const { response, json } = await invoke(handler, calls, {
    fax_log_id: 'fax-1',
    analysis_type: 'contacts',
  });

  assert.equal(response.status, 200);
  assert.equal(json.success, true);
  assert.deepEqual(calls.contactQueries[0], [
    { user_email: 'platform-owner@example.com' },
    '-created_date',
    500,
  ]);
});

test('fax contact suggestions use only normalized caller-owned rows', async () => {
  const { handler, calls } = await loadHandler('analyzeFaxContent', {
    user: { email: 'Owner@Example.com', role: 'user', is_active: true },
    faxRows: [{
      id: 'fax-1',
      sent_by: 'owner@EXAMPLE.com',
      ocr_text: 'Please route these records.',
      status: 'delivered',
    }],
    // Simulate a regressed backend returning a foreign row despite the query.
    contactRows: [
      {
        id: 'mine',
        user_email: 'OWNER@example.com',
        created_by: 'owner@example.com',
        name: 'Owned Clinic',
        organization: 'Owned Org',
        fax_number: '+17245550101',
      },
      {
        id: 'foreign',
        user_email: 'other@example.com',
        created_by: 'other@example.com',
        name: 'Foreign Clinic',
        organization: 'Foreign Org',
        fax_number: '+17245550102',
      },
      {
        id: 'forged-owner-field',
        user_email: 'owner@example.com',
        created_by: 'attacker@example.com',
        name: 'Poisoned Contact',
        organization: 'Attacker Org',
        fax_number: '+17245550103',
      },
    ],
    aiResponses: [{
      suggested_contacts: [
        { name: 'Owned Clinic', fax_number: '+17245550101', reason: 'mentioned' },
        { name: 'Foreign Clinic', fax_number: '+17245550102', reason: 'guessed' },
      ],
    }],
  });
  const { response, json } = await invoke(handler, calls, {
    fax_log_id: 'fax-1',
    analysis_type: 'contacts',
  });

  assert.equal(response.status, 200);
  assert.deepEqual(calls.contactQueries[0], [
    { user_email: 'owner@example.com' },
    '-created_date',
    500,
  ]);
  assert.match(calls.llm[0].prompt, /Owned Clinic/);
  assert.doesNotMatch(
    calls.llm[0].prompt,
    /Foreign Clinic|Foreign Org|\+17245550102|Poisoned Contact|Attacker Org|\+17245550103/,
  );
  assert.deepEqual(json.suggested_contacts[0], {
    name: 'Owned Clinic',
    fax_number: '+17245550101',
    reason: 'mentioned',
    contact_id: 'mine',
    matched: true,
  });
  assert.equal(json.suggested_contacts[1].contact_id, undefined);
  assert.equal(json.suggested_contacts[1].matched, false);
});

test('priority matching and counter updates ignore foreign rows returned by the backend', async () => {
  const { handler, calls } = await loadHandler('analyzeFaxPriority', {
    user: { email: 'Owner@Example.com', role: 'user', is_active: true },
    ruleRows: [
      {
        id: 'foreign-urgent',
        user_email: 'other@example.com',
        name: 'Foreign urgent rule',
        rule_type: 'keyword',
        pattern: 'routine',
        priority: 'urgent',
        is_active: true,
        match_count: 99,
      },
      {
        id: 'mine-low',
        user_email: 'OWNER@example.com',
        name: 'My low rule',
        rule_type: 'keyword',
        pattern: 'routine',
        priority: 'low',
        is_active: true,
        match_count: 2,
      },
    ],
  });
  const { response, json } = await invoke(handler, calls, {
    document_name: 'Routine update',
    to_number: '+17245550103',
    from_number: '+17245550104',
  });

  assert.equal(response.status, 200);
  assert.equal(json.priority, 'low');
  assert.equal(json.rule_id, 'mine-low');
  assert.deepEqual(calls.ruleQueries[0], [
    { is_active: true, user_email: 'owner@example.com' },
    '-created_date',
    100,
  ]);
  assert.deepEqual(calls.ruleUpdates, [['mine-low', { match_count: 3 }]]);
  assert.deepEqual(calls.llm, []);
});
