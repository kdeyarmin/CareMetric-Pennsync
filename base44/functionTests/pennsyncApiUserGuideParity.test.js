import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { transpileTs } from '../../tools-transpile-ts.mjs';
import { buildUserGuide } from '../../services/pennsync-api/document-user-guide.mjs';
import {
  DEFAULT_GUIDE_TYPE, USER_GUIDE_PROMPTS, USER_GUIDE_SCHEMA, resolveGuideType,
} from '../../services/pennsync-api/user-guide-prompts.mjs';
import { GUIDE_TYPES } from '../../tools-user-guide-prompts.mjs';

/**
 * `generateUserGuidePDF` is the only port that both asks a model and renders,
 * so it is proved twice: the model call against the original's, and the drawing
 * against the original's drawing.
 *
 * Its eleven prompts were extracted rather than retyped (see
 * `tools-user-guide-prompts.mjs`), and this is what holds the extraction
 * honest: the committed data is compared with what the original produces now,
 * for every guide type, so it cannot drift from the source it came from.
 */
globalThis.Deno = globalThis.Deno || { serve() {}, env: { get: () => undefined } };

// Letter in millimetres, because that is the format the original constructs.
const PAGE_WIDTH = 215.9;
const PAGE_HEIGHT = 279.4;

/** Records every drawing call, and splits text the same way on both sides. */
function recorder() {
  const calls = [];
  const pages = [null, {}];
  const surface = {
    calls,
    // Both spellings: the original reads `.width`, other documents call
    // `getWidth()`, and a stub that offers only one silently yields undefined.
    internal: {
      pages,
      pageSize: {
        width: PAGE_WIDTH, height: PAGE_HEIGHT,
        getWidth: () => PAGE_WIDTH, getHeight: () => PAGE_HEIGHT,
      },
    },
    // Chunked at a fixed width rather than capped at two lines: a stub that
    // returns at most two lines can never overflow a page, so the page-break
    // test would pass on a port that had no page break in it at all. Both
    // sides split through this same stub, so parity still compares like
    // with like.
    splitTextToSize(text, width) {
      calls.push(['splitTextToSize', text, width]);
      const value = String(text);
      if (!value) return [value];
      const lines = [];
      for (let at = 0; at < value.length; at += 64) lines.push(value.slice(at, at + 64));
      return lines;
    },
    addPage(...args) { pages.push({}); calls.push(['addPage', ...args]); },
    getNumberOfPages() { calls.push(['getNumberOfPages']); return pages.length - 1; },
    output(...args) { calls.push(['output', ...args]); return new ArrayBuffer(8); },
  };
  for (const name of ['setFillColor', 'rect', 'circle', 'addImage', 'setTextColor',
    'setFontSize', 'setFont', 'text', 'setLineWidth', 'setDrawColor', 'setPage']) {
    surface[name] = (...args) => { calls.push([name, ...args]); };
  }
  return surface;
}

/**
 * Load the original with its client, PDF library and clock replaced, so the
 * same guide content renders into a recorder on both sides.
 */
async function loadOriginal(surface, guideContent) {
  let source = await readFile(new URL('../functions/generateUserGuidePDF/entry.ts', import.meta.url), 'utf8');
  source = source.replace(/import\s+\{\s*jsPDF\s*\}\s+from\s+'npm:jspdf@[^']*';?/,
    'const jsPDF = function () { return globalThis.__surface; };');
  source = source.replace(/import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?/,
    `const createClientFromRequest = () => ({
       auth: { me: async () => ({ id: 'synthetic-user', is_active: true }) },
       integrations: { Core: { InvokeLLM: async (argument) => {
         globalThis.__calls.push(argument); return globalThis.__content;
       } } },
     });`);
  const js = transpileTs(source).outputText;
  const file = join(tmpdir(), `guideparity_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  let handler = null;
  const previous = globalThis.Deno.serve;
  globalThis.Deno = { ...globalThis.Deno, serve: fn => { handler = fn; } };
  globalThis.__surface = surface;
  globalThis.__content = guideContent;
  globalThis.__calls = [];
  await writeFile(file, js);
  try { await import(pathToFileURL(file).href); }
  finally { await unlink(file).catch(() => {}); globalThis.Deno.serve = previous; }
  assert.ok(handler, 'the original did not register a handler');
  return handler;
}

async function driveOriginal(guideType, guideContent) {
  const surface = recorder();
  const handler = await loadOriginal(surface, guideContent);
  const response = await handler(new Request('https://synthetic.invalid/', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ guide_type: guideType }),
  }));
  return { surface, response, calls: globalThis.__calls };
}

const CONTENT = {
  title: 'Synthetic Guide',
  sections: [
    {
      heading: 'Getting started',
      content: 'A section body long enough that the deterministic split puts it across two lines for certain.',
      subsections: [
        {
          subheading: 'First steps',
          steps: ['Open the page', 'A step long enough that the deterministic split puts it across two lines too'],
          notes: ['A tip worth calling out', 'A second tip, longer, so the box height depends on the line count'],
        },
      ],
    },
    // Every level is optional in the model's answer, and the original tolerates
    // each absence rather than failing.
    { heading: 'Bare section' },
    { heading: 'Empty subsections', subsections: [] },
    { heading: 'Subsection with nothing', subsections: [{ subheading: 'Alone' }] },
  ],
};

test('every extracted prompt is still exactly what the original sends', async () => {
  for (const guideType of GUIDE_TYPES) {
    const original = await driveOriginal(guideType, CONTENT);
    assert.equal(original.calls.length, 1);
    assert.deepEqual(Object.keys(original.calls[0]).sort(), ['prompt', 'response_json_schema']);
    // The original passes no model selector here; its comment says the default
    // avoids the 120s timeout the large all_features prompt otherwise hits.
    assert.equal(original.calls[0].prompt, USER_GUIDE_PROMPTS[guideType],
      `the committed prompt for ${guideType} has drifted from the original`);
    assert.deepEqual(original.calls[0].response_json_schema, USER_GUIDE_SCHEMA);
  }
});

test('an unknown guide type resolves the way the original resolves it', async () => {
  for (const guideType of [undefined, null, '', 'nope', '../../etc/passwd', 'all_features"; drop']) {
    const original = await driveOriginal(guideType, CONTENT);
    // It reaches the download filename, so an unresolved value could mislabel
    // the file or carry into the Content-Disposition header.
    assert.equal(original.calls[0].prompt, USER_GUIDE_PROMPTS[DEFAULT_GUIDE_TYPE]);
    assert.equal(resolveGuideType(guideType), DEFAULT_GUIDE_TYPE);
    assert.match(original.response.headers.get('content-disposition') || '',
      /^attachment; filename="all_features_guide\.pdf"$/);
  }
  for (const guideType of GUIDE_TYPES) assert.equal(resolveGuideType(guideType), guideType);
});

test('the ported render draws exactly what the original drew', async () => {
  const original = await driveOriginal('smart_notes', CONTENT);
  const ported = recorder();
  // The original reads the clock while rendering; the port takes both stamps
  // from the caller, so the comparison fixes them to what the original saw.
  const now = new Date();
  buildUserGuide(ported, CONTENT, { generatedOn: now.toLocaleDateString(), year: now.getFullYear() });
  // The original ends with `output('arraybuffer')`; the port leaves that to its
  // handler, so the drawing is compared without it.
  const drawn = original.surface.calls.filter(call => call[0] !== 'output');
  assert.deepEqual(ported.calls, drawn);
  assert.ok(ported.calls.length > 40, 'expected a substantial call sequence');
});

test('a guide the model answered thinly still renders a cover and a footer', async () => {
  for (const content of [{}, { title: 'Only a title' }, { sections: [] }, { title: 'X', sections: null }]) {
    const original = await driveOriginal('care_plans', content);
    const ported = recorder();
    const now = new Date();
    buildUserGuide(ported, content, { generatedOn: now.toLocaleDateString(), year: now.getFullYear() });
    assert.deepEqual(ported.calls, original.surface.calls.filter(call => call[0] !== 'output'));
    assert.ok(ported.calls.some(call => call[0] === 'text'), 'a cover and footer are still drawn');
  }
});

test('a block taller than a page breaks per line rather than drawing off the edge', async () => {
  // The original checks before each line, not once per block, and its comment
  // says why: a single up-front check cannot catch a block taller than a page.
  // Model output is long, so this is the common case rather than the rare one.
  const long = { title: 'Long', sections: [{ heading: 'H', content: 'x'.repeat(4000) }] };
  const original = await driveOriginal('all_features', long);
  const ported = recorder();
  const now = new Date();
  buildUserGuide(ported, long, { generatedOn: now.toLocaleDateString(), year: now.getFullYear() });
  assert.deepEqual(ported.calls, original.surface.calls.filter(call => call[0] !== 'output'));
  assert.ok(ported.calls.some(call => call[0] === 'addPage'), 'the long block should have broken a page');
});
