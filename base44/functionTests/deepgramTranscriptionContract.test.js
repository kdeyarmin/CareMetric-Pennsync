// Contract tests for the Deepgram transcription rebuild (R2 of the direct-AI
// migration, D227). R1 removed the closed provider account's calls and left
// the transcription functions failing closed; R2 wires Deepgram's prerecorded
// API (Nova-3 Medical) through the shared deepgramTranscribe helper inlined
// from base44/_shared/backendHelpers.mjs.
//
// These tests load the real entry sources with the tree's usual harness
// shape (SDK import replaced by a stub client, Deno.env backed by a plain
// map, relative .ts imports transpiled alongside), and mock global fetch —
// no live Deepgram or Anthropic call is ever made. They pin:
//   - the Deepgram request shape (model, diarization, keyterm prompting
//     bounded at 100 terms, Token auth, the audio bytes as the body);
//   - the response mapping each consumer relies on;
//   - R1's exact fail-closed refusal when DEEPGRAM_API_KEY is absent;
//   - provider failures surfacing as errors, never fabricated transcripts.
import assert from 'node:assert/strict';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { transpileTs } from '../../tools-transpile-ts.mjs';

const DEEPGRAM_URL = 'https://api.deepgram.com/v1/listen';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const DEEPGRAM_KEY = 'deepgram-test-key';
const ANTHROPIC_KEY = 'anthropic-test-key';

let sequence = 0;
async function loadHandler(functionName, { client, env = {} }) {
  const entryUrl = new URL(`../functions/${functionName}/entry.ts`, import.meta.url);
  const written = [];
  const emit = async (url, isEntry) => {
    let source = await readFile(url, 'utf8');
    if (isEntry) {
      source = source.replace(
        /import\s+\{[^}]*\}\s+from\s+'npm:@base44\/sdk@[^']*';?/,
        'const createClientFromRequest = globalThis.__deepgramClientFactory;',
      );
    }
    source = source.replace(
      /import\s+\{([^}]*)\}\s+from\s+'base44:runtime';?/g,
      (_, names) => `const {${names}} = globalThis.__deepgramRuntime;`,
    );
    const imports = [...source.matchAll(/from\s+'(\.{1,2}\/[^']+\.ts)'/g)].map((m) => m[1]);
    for (const specifier of new Set(imports)) {
      const dependency = await emit(new URL(specifier, url), false);
      source = source.replaceAll(`'${specifier}'`, `'${pathToFileURL(dependency).href}'`);
    }
    const file = join(
      tmpdir(),
      `deepgram_${functionName}_${process.pid}_${Date.now()}_${(sequence += 1)}.mjs`,
    );
    await writeFile(file, transpileTs(source).outputText);
    written.push(file);
    return file;
  };

  let handler;
  globalThis.__deepgramClientFactory = () => client;
  globalThis.__deepgramRuntime = { secrets: { get: () => undefined } };
  // Deno stays installed after the load (the integrationHealthContract
  // pattern): the handlers read Deno.env at call time, not at import time,
  // and each load replaces the previous load's env map wholesale.
  globalThis.Deno = {
    serve: (candidate) => { handler = candidate; },
    env: { get: (name) => env[name] },
  };
  try {
    await import(pathToFileURL(await emit(entryUrl, true)).href);
  } finally {
    await Promise.all(written.map((file) => unlink(file).catch(() => {})));
    delete globalThis.__deepgramClientFactory;
    delete globalThis.__deepgramRuntime;
  }
  assert.equal(typeof handler, 'function');
  return handler;
}

// Routes fetch calls by URL prefix; any unrouted call throws, so a test
// fails loudly if a function reaches a provider it should not have.
function routeFetch(routes) {
  const calls = [];
  const fetcher = async (url, options = {}) => {
    const href = String(url);
    calls.push({ href, options });
    for (const [prefix, respond] of routes) {
      if (href.startsWith(prefix)) return respond(href, options);
    }
    throw new Error(`Unexpected fetch: ${href}`);
  };
  return { calls, fetcher };
}

async function withFetch(fetcher, fn) {
  const previous = globalThis.fetch;
  globalThis.fetch = fetcher;
  try {
    return await fn();
  } finally {
    globalThis.fetch = previous;
  }
}

// Real Response objects throughout: the shared helper reads provider
// responses as bounded streams (body.getReader), so a plain-object mock
// without a body would fail for a reason the contract does not mean to pin.
const jsonResponse = (payload, status = 200) => new Response(JSON.stringify(payload), {
  status, headers: { 'Content-Type': 'application/json' },
});
const deepgramOk = (transcript, duration = 42.4) => jsonResponse({
  metadata: { duration },
  results: { channels: [{ alternatives: [{ transcript }] }] },
});
const deepgramFailure = (status = 500) => new Response('provider error', { status });
const anthropicText = (text) => jsonResponse({
  content: [{ type: 'text', text }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 10, output_tokens: 5 },
});

const MP4_BYTES = new Uint8Array([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
  0x00, 0x00, 0x02, 0x00, 0x69, 0x73, 0x6f, 0x6d, 0x61, 0x76, 0x63, 0x31,
]);
const WEBM_BYTES = new Uint8Array([
  0x1a, 0x45, 0xdf, 0xa3, 0x93, 0x42, 0x82, 0x88, 0x6d, 0x61, 0x74, 0x72,
  0x6f, 0x73, 0x6b, 0x61, 0x42, 0x87, 0x81, 0x01, 0x42, 0x85, 0x81, 0x01,
]);
const base64Of = (bytes) => Buffer.from(bytes).toString('base64');

const activeUser = {
  id: 'user-1', email: 'nurse@example.test', full_name: 'Nurse Example',
  role: 'user', is_active: true,
};
const adminUser = {
  id: 'admin-1', email: 'admin@example.test', full_name: 'Admin Example',
  role: 'admin', is_active: true,
};

const whisperClient = (user, activity) => ({
  auth: { me: async () => user },
  asServiceRole: {
    entities: {
      UserActivity: {
        create: async (record) => {
          activity.push(record);
          return { id: 'activity-1', ...record };
        },
      },
    },
  },
});
const entityFreeClient = (user) => ({
  auth: { me: async () => user },
  get asServiceRole() { throw new Error('entity-free function accessed service data'); },
});

const multipartRequest = (bytes, type, field = 'file') => {
  const form = new FormData();
  form.append(field, new File([bytes], 'recording', { type }));
  return new Request('https://example.test/transcribe', { method: 'POST', body: form });
};
const jsonRequest = (payload) => new Request('https://example.test/function', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

// ---------------------------------------------------------------------------
// transcribeAudioWithWhisper
// ---------------------------------------------------------------------------

test('transcribeAudioWithWhisper sends the Nova-3 Medical request and maps the response', async () => {
  const activity = [];
  const handler = await loadHandler('transcribeAudioWithWhisper', {
    client: whisperClient(activeUser, activity),
    env: { DEEPGRAM_API_KEY: DEEPGRAM_KEY },
  });
  const { calls, fetcher } = routeFetch([
    [DEEPGRAM_URL, async () => deepgramOk('Patient reports mild knee pain.')],
  ]);
  const response = await withFetch(fetcher, () => handler(multipartRequest(WEBM_BYTES, 'audio/webm')));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.text, 'Patient reports mild knee pain.');
  assert.equal(body.duration, 42.4);

  assert.equal(calls.length, 1);
  const url = new URL(calls[0].href);
  assert.equal(url.searchParams.get('model'), 'nova-3-medical');
  assert.equal(url.searchParams.get('diarize'), 'true');
  assert.equal(url.searchParams.get('smart_format'), 'true');
  assert.equal(url.searchParams.get('punctuate'), 'true');
  const keyterms = url.searchParams.getAll('keyterm');
  assert.ok(keyterms.length > 50 && keyterms.length <= 100, `keyterm count ${keyterms.length}`);
  assert.ok(keyterms.includes('Metformin'));
  assert.ok(keyterms.includes('Dyspnea'));
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, `Token ${DEEPGRAM_KEY}`);
  assert.equal(calls[0].options.headers['Content-Type'], 'audio/webm');
  assert.deepEqual(Array.from(calls[0].options.body), Array.from(WEBM_BYTES));
});

test('transcribeAudioWithWhisper sniffs the container when the upload type is empty', async () => {
  const handler = await loadHandler('transcribeAudioWithWhisper', {
    client: whisperClient(activeUser, []),
    env: { DEEPGRAM_API_KEY: DEEPGRAM_KEY },
  });
  const { calls, fetcher } = routeFetch([
    [DEEPGRAM_URL, async () => deepgramOk('Sniffed.')],
  ]);
  const response = await withFetch(fetcher, () => handler(multipartRequest(MP4_BYTES, '')));
  assert.equal(response.status, 200);
  assert.equal(calls[0].options.headers['Content-Type'], 'audio/mp4');
});

test('transcribeAudioWithWhisper logs the transcription with the provider duration', async () => {
  const activity = [];
  const handler = await loadHandler('transcribeAudioWithWhisper', {
    client: whisperClient(activeUser, activity),
    env: { DEEPGRAM_API_KEY: DEEPGRAM_KEY },
  });
  const { fetcher } = routeFetch([
    [DEEPGRAM_URL, async () => deepgramOk('Logged transcript.', 42.4)],
  ]);
  const response = await withFetch(fetcher, () => handler(multipartRequest(WEBM_BYTES, 'audio/webm')));
  assert.equal(response.status, 200);
  assert.equal(activity.length, 1);
  assert.equal(activity[0].action, 'audio_transcribed');
  assert.equal(activity[0].user_email, activeUser.email);
  assert.equal(activity[0].details.duration_seconds, 42);
  assert.equal(activity[0].details.transcription_length, 'Logged transcript.'.length);
});

test('transcribeAudioWithWhisper fails closed with R1\'s refusal when the key is absent', async () => {
  const handler = await loadHandler('transcribeAudioWithWhisper', {
    client: whisperClient(activeUser, []),
    env: {},
  });
  const { calls, fetcher } = routeFetch([]);
  const response = await withFetch(fetcher, () => handler(multipartRequest(WEBM_BYTES, 'audio/webm')));
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'Transcription provider not configured' });
  assert.equal(calls.length, 0);
});

test('transcribeAudioWithWhisper maps provider failure and malformed bodies to 502', async () => {
  const handler = await loadHandler('transcribeAudioWithWhisper', {
    client: whisperClient(activeUser, []),
    env: { DEEPGRAM_API_KEY: DEEPGRAM_KEY },
  });
  const failing = routeFetch([[DEEPGRAM_URL, async () => deepgramFailure(500)]]);
  const failed = await withFetch(failing.fetcher, () => handler(multipartRequest(WEBM_BYTES, 'audio/webm')));
  assert.equal(failed.status, 502);
  assert.deepEqual(await failed.json(), { error: 'Transcription failed' });

  const malformed = routeFetch([[DEEPGRAM_URL, async () => jsonResponse({ results: {} })]]);
  const bad = await withFetch(malformed.fetcher, () => handler(multipartRequest(WEBM_BYTES, 'audio/webm')));
  assert.equal(bad.status, 502);
  assert.deepEqual(await bad.json(), { error: 'Transcription failed' });
});

test('transcribeAudioWithWhisper returns an empty transcript as an empty success', async () => {
  const handler = await loadHandler('transcribeAudioWithWhisper', {
    client: whisperClient(activeUser, []),
    env: { DEEPGRAM_API_KEY: DEEPGRAM_KEY },
  });
  const { fetcher } = routeFetch([[DEEPGRAM_URL, async () => deepgramOk('', 3)]]);
  const response = await withFetch(fetcher, () => handler(multipartRequest(WEBM_BYTES, 'audio/webm')));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { text: '', duration: 3 });
});

test('transcribeAudioWithWhisper keeps its method, auth and multipart guards ahead of the provider', async () => {
  const env = { DEEPGRAM_API_KEY: DEEPGRAM_KEY };
  const { calls, fetcher } = routeFetch([]);
  const okHandler = await loadHandler('transcribeAudioWithWhisper', {
    client: whisperClient(activeUser, []), env,
  });
  const method = await withFetch(fetcher, () => okHandler(new Request('https://example.test/transcribe', { method: 'GET' })));
  assert.equal(method.status, 405);

  const noUser = await loadHandler('transcribeAudioWithWhisper', {
    client: whisperClient(null, []), env,
  });
  const unauthorized = await withFetch(fetcher, () => noUser(multipartRequest(WEBM_BYTES, 'audio/webm')));
  assert.equal(unauthorized.status, 401);

  const deactivated = await loadHandler('transcribeAudioWithWhisper', {
    client: whisperClient({ ...activeUser, is_active: false }, []), env,
  });
  const forbidden = await withFetch(fetcher, () => deactivated(multipartRequest(WEBM_BYTES, 'audio/webm')));
  assert.equal(forbidden.status, 403);

  const notMultipart = await withFetch(fetcher, () => okHandler(jsonRequest({})));
  assert.equal(notMultipart.status, 400);
  assert.deepEqual(await notMultipart.json(), {
    error: "Request must be multipart/form-data with a 'file' field",
  });

  const emptyForm = new FormData();
  const noFile = await withFetch(fetcher, () => okHandler(
    new Request('https://example.test/transcribe', { method: 'POST', body: emptyForm }),
  ));
  assert.equal(noFile.status, 400);
  assert.deepEqual(await noFile.json(), { error: 'No audio file provided' });
  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------------------
// transcribeAndGenerateSOAPNote
// ---------------------------------------------------------------------------

const SOAP_JSON = JSON.stringify({
  subjective: 'Patient reports mild knee pain.',
  objective: 'Knee range of motion full.',
  assessment: 'Mild knee strain.',
  plan: 'Rest and recheck in one week.',
});

test('transcribeAndGenerateSOAPNote transcribes with Deepgram and structures with claude-opus-5-5', async () => {
  const handler = await loadHandler('transcribeAndGenerateSOAPNote', {
    client: entityFreeClient(activeUser),
    env: { DEEPGRAM_API_KEY: DEEPGRAM_KEY, ANTHROPIC_API_KEY: ANTHROPIC_KEY },
  });
  const { calls, fetcher } = routeFetch([
    [DEEPGRAM_URL, async () => deepgramOk('Patient reports mild knee pain.')],
    [ANTHROPIC_URL, async () => anthropicText(SOAP_JSON)],
  ]);
  const response = await withFetch(fetcher, () => handler(jsonRequest({
    audio_base64: base64Of(WEBM_BYTES), mime_type: 'audio/webm',
  })));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.data.subjective, 'Patient reports mild knee pain.');
  assert.equal(body.data.plan, 'Rest and recheck in one week.');
  assert.equal(body.data.raw_transcript, 'Patient reports mild knee pain.');

  const deepgramCall = calls.find((call) => call.href.startsWith(DEEPGRAM_URL));
  assert.equal(deepgramCall.options.headers['Content-Type'], 'audio/webm');
  assert.deepEqual(Array.from(deepgramCall.options.body), Array.from(WEBM_BYTES));

  const anthropicCall = calls.find((call) => call.href.startsWith(ANTHROPIC_URL));
  const anthropicBody = JSON.parse(anthropicCall.options.body);
  assert.equal(anthropicBody.model, 'claude-opus-5-5');
  assert.ok(anthropicBody.messages[0].content.includes('Patient reports mild knee pain.'));
});

test('transcribeAndGenerateSOAPNote sniffs WebM when mime_type is omitted', async () => {
  const handler = await loadHandler('transcribeAndGenerateSOAPNote', {
    client: entityFreeClient(activeUser),
    env: { DEEPGRAM_API_KEY: DEEPGRAM_KEY, ANTHROPIC_API_KEY: ANTHROPIC_KEY },
  });
  const { calls, fetcher } = routeFetch([
    [DEEPGRAM_URL, async () => deepgramOk('Sniffed transcript.')],
    [ANTHROPIC_URL, async () => anthropicText(SOAP_JSON)],
  ]);
  const response = await withFetch(fetcher, () => handler(jsonRequest({
    audio_base64: base64Of(WEBM_BYTES),
  })));
  assert.equal(response.status, 200);
  const deepgramCall = calls.find((call) => call.href.startsWith(DEEPGRAM_URL));
  assert.equal(deepgramCall.options.headers['Content-Type'], 'audio/webm');
});

test('transcribeAndGenerateSOAPNote short-circuits transcription for a supplied transcript', async () => {
  const handler = await loadHandler('transcribeAndGenerateSOAPNote', {
    client: entityFreeClient(activeUser),
    env: { ANTHROPIC_API_KEY: ANTHROPIC_KEY },
  });
  const { calls, fetcher } = routeFetch([
    [ANTHROPIC_URL, async () => anthropicText(SOAP_JSON)],
  ]);
  const response = await withFetch(fetcher, () => handler(jsonRequest({
    transcript: 'Caller supplied transcript.',
  })));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data.raw_transcript, 'Caller supplied transcript.');
  assert.equal(calls.length, 1);
  assert.ok(calls[0].href.startsWith(ANTHROPIC_URL));
});

test('transcribeAndGenerateSOAPNote fails closed on audio when the Deepgram key is absent', async () => {
  const handler = await loadHandler('transcribeAndGenerateSOAPNote', {
    client: entityFreeClient(activeUser),
    env: { ANTHROPIC_API_KEY: ANTHROPIC_KEY },
  });
  const { calls, fetcher } = routeFetch([]);
  const response = await withFetch(fetcher, () => handler(jsonRequest({
    audio_base64: base64Of(WEBM_BYTES), mime_type: 'audio/webm',
  })));
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'Transcription provider not configured' });
  assert.equal(calls.length, 0);
});

test('transcribeAndGenerateSOAPNote maps a Deepgram failure to 502 and never reaches Anthropic', async () => {
  const handler = await loadHandler('transcribeAndGenerateSOAPNote', {
    client: entityFreeClient(activeUser),
    env: { DEEPGRAM_API_KEY: DEEPGRAM_KEY, ANTHROPIC_API_KEY: ANTHROPIC_KEY },
  });
  const { calls, fetcher } = routeFetch([
    [DEEPGRAM_URL, async () => deepgramFailure(503)],
  ]);
  const response = await withFetch(fetcher, () => handler(jsonRequest({
    audio_base64: base64Of(WEBM_BYTES), mime_type: 'audio/webm',
  })));
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'Transcription failed' });
  assert.equal(calls.filter((call) => call.href.startsWith(ANTHROPIC_URL)).length, 0);
});

test('transcribeAndGenerateSOAPNote keeps its payload and Anthropic guards', async () => {
  const handler = await loadHandler('transcribeAndGenerateSOAPNote', {
    client: entityFreeClient(activeUser),
    env: { DEEPGRAM_API_KEY: DEEPGRAM_KEY },
  });
  const { fetcher } = routeFetch([]);
  const empty = await withFetch(fetcher, () => handler(jsonRequest({})));
  assert.equal(empty.status, 400);
  assert.deepEqual(await empty.json(), { error: 'No audio provided' });

  const noAnthropic = await withFetch(fetcher, () => handler(jsonRequest({
    transcript: 'Ready-made transcript.',
  })));
  assert.equal(noAnthropic.status, 500);
  assert.deepEqual(await noAnthropic.json(), { error: 'Anthropic API key not configured' });
});

// ---------------------------------------------------------------------------
// generateNoteFromRecording
// ---------------------------------------------------------------------------

const RECORDING_URL = 'https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/694ec16e72e01b60d22f7cbf/recording.mp4';
const NOTE_REQUEST = {
  audio_url: RECORDING_URL,
  patient_id: 'patient-1',
  agency_id: 'agency-1',
  visit_type: 'skilled_nursing',
  diagnosis: 'CHF',
};
const recordingResponse = () => new Response(MP4_BYTES, {
  status: 200, headers: { 'Content-Type': 'audio/mp4' },
});
const noteClient = (user, authorized = true) => ({
  auth: { me: async () => user },
  functions: {
    invoke: async (name, payload) => {
      assert.equal(name, 'getAuthorizedPatient');
      if (!authorized) return { data: { success: false } };
      return {
        data: {
          success: true,
          purpose: 'visit_summary',
          scope: { agency_id: payload.agency_id },
          patient: {
            id: payload.patient_id, first_name: 'Jane', last_name: 'Doe',
            date_of_birth: '1950-01-02',
          },
        },
      };
    },
  },
  get asServiceRole() { throw new Error('generateNoteFromRecording accessed service data'); },
});

test('generateNoteFromRecording transcribes the recording with Deepgram and feeds both note legs', async () => {
  const handler = await loadHandler('generateNoteFromRecording', {
    client: noteClient(adminUser),
    env: { DEEPGRAM_API_KEY: DEEPGRAM_KEY, ANTHROPIC_API_KEY: ANTHROPIC_KEY },
  });
  const noteText = 'Subjective: Patient describes intermittent chest tightness.';
  const suggestionsText = JSON.stringify({
    suggestions: [{
      treatment: 'Rest', rationale: 'Recovery', category: 'education', confidence: 90,
    }],
  });
  const { calls, fetcher } = routeFetch([
    [RECORDING_URL, async () => recordingResponse()],
    [DEEPGRAM_URL, async () => deepgramOk('Patient describes intermittent chest tightness.')],
    [ANTHROPIC_URL, async (_href, options) => anthropicText(
      String(options.body).includes('treatment suggestions') ? suggestionsText : noteText,
    )],
  ]);
  const response = await withFetch(fetcher, () => handler(jsonRequest(NOTE_REQUEST)));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.data.transcription, 'Patient describes intermittent chest tightness.');
  assert.equal(body.data.generatedNote, noteText);
  assert.deepEqual(body.data.treatmentSuggestions, [{
    treatment: 'Rest', rationale: 'Recovery', category: 'education', confidence: 90,
  }]);
  assert.equal(body.data.metadata.patientId, 'patient-1');
  assert.equal(body.data.metadata.visitType, 'skilled_nursing');

  const deepgramCall = calls.find((call) => call.href.startsWith(DEEPGRAM_URL));
  assert.equal(deepgramCall.options.headers['Content-Type'], 'audio/mp4');
  assert.equal(new URL(deepgramCall.href).searchParams.get('model'), 'nova-3-medical');
  const anthropicCalls = calls.filter((call) => call.href.startsWith(ANTHROPIC_URL));
  assert.equal(anthropicCalls.length, 2);
  assert.ok(String(anthropicCalls[0].options.body)
    .includes('Patient describes intermittent chest tightness.'));
});

test('generateNoteFromRecording fails closed in its own envelope when the Deepgram key is absent', async () => {
  const handler = await loadHandler('generateNoteFromRecording', {
    client: noteClient(adminUser),
    env: { ANTHROPIC_API_KEY: ANTHROPIC_KEY },
  });
  const { calls, fetcher } = routeFetch([
    [RECORDING_URL, async () => recordingResponse()],
  ]);
  const response = await withFetch(fetcher, () => handler(jsonRequest(NOTE_REQUEST)));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    success: false,
    error: 'Clinical audio processing is unavailable. Verify chart access and try again.',
  });
  // The recording itself was fetched; neither provider was called.
  assert.equal(calls.length, 1);
  assert.ok(calls[0].href.startsWith(RECORDING_URL));
});

test('generateNoteFromRecording masks a Deepgram provider failure in its unavailable envelope', async () => {
  const handler = await loadHandler('generateNoteFromRecording', {
    client: noteClient(adminUser),
    env: { DEEPGRAM_API_KEY: DEEPGRAM_KEY, ANTHROPIC_API_KEY: ANTHROPIC_KEY },
  });
  const { fetcher } = routeFetch([
    [RECORDING_URL, async () => recordingResponse()],
    [DEEPGRAM_URL, async () => deepgramFailure(500)],
  ]);
  const response = await withFetch(fetcher, () => handler(jsonRequest(NOTE_REQUEST)));
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    success: false,
    error: 'Clinical audio processing is unavailable. Verify chart access and try again.',
  });
});

test('generateNoteFromRecording keeps its field, URL and chart-access guards ahead of transcription', async () => {
  const env = { DEEPGRAM_API_KEY: DEEPGRAM_KEY, ANTHROPIC_API_KEY: ANTHROPIC_KEY };
  const { calls, fetcher } = routeFetch([]);
  const handler = await loadHandler('generateNoteFromRecording', {
    client: noteClient(adminUser), env,
  });
  const missing = await withFetch(fetcher, () => handler(jsonRequest({})));
  assert.equal(missing.status, 400);
  assert.deepEqual(await missing.json(), {
    error: 'Missing required fields: audio_url, patient_id, visit_type',
  });

  const foreign = await withFetch(fetcher, () => handler(jsonRequest({
    ...NOTE_REQUEST, audio_url: 'https://example.com/evil.mp4',
  })));
  assert.equal(foreign.status, 400);
  assert.deepEqual(await foreign.json(), {
    error: 'An audio upload belonging to this app is required.',
  });

  const deniedHandler = await loadHandler('generateNoteFromRecording', {
    client: noteClient(adminUser, false), env,
  });
  const denied = await withFetch(fetcher, () => deniedHandler(jsonRequest(NOTE_REQUEST)));
  assert.equal(denied.status, 403);
  assert.deepEqual(await denied.json(), {
    error: 'Patient chart access could not be verified.',
  });
  assert.equal(calls.length, 0);
});
