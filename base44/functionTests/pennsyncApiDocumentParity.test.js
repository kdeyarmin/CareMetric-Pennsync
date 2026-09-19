import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { transpileTs } from '../../tools-transpile-ts.mjs';
import {
  BAG_TECHNIQUE_FILENAME, buildBagTechniqueChecklist,
} from '../../services/pennsync-api/documents.mjs';

/**
 * Drift guard for documents ported out of Base44.
 *
 * A rendered PDF cannot be compared byte for byte — jsPDF embeds a creation
 * timestamp and a document id, so two runs of the *same* code differ. What can
 * be compared exactly is the sequence of drawing calls, which is the document:
 * same calls in the same order with the same arguments means the same page.
 *
 * So both sides are driven by one recording surface. The Base44 original runs
 * for real — transpiled, its `Deno.serve` handler captured and invoked — rather
 * than being read or paraphrased, so this fails if either implementation
 * changes. The two known sources of non-determinism are removed at the source
 * and not normalised away afterwards: the date is taken from the original's own
 * output and handed to the port, and the logo fetch is stubbed per branch.
 *
 * The port deliberately differs in one way, and the second case below is why it
 * is safe: the original fetched its logo from Base44's storage bucket on every
 * request, and the port takes it as configuration. With no logo configured the
 * port must issue exactly the calls the original issued when that fetch failed
 * — the original's own fallback, not a new one.
 */
const ORIGINAL = new URL('../functions/generateBagTechniquePDF/entry.ts', import.meta.url);
const LOGO = 'data:image/png;base64,iVBORw0KGgo=';

/** Records every call in order. Both implementations draw on one of these. */
function recorder() {
  const calls = [];
  let pages = 1;
  const surface = {
    calls,
    // jsPDF wraps at a width the stub cannot know, so it splits deterministically
    // instead. Both sides see the same split, which is what parity needs; the
    // real wrapping is jsPDF's own and identical on both sides at render time.
    splitTextToSize(text, width) {
      calls.push(['splitTextToSize', text, width]);
      return String(text).length > 64 ? [String(text).slice(0, 64), String(text).slice(64)] : [String(text)];
    },
    addPage(...args) { pages += 1; calls.push(['addPage', ...args]); },
    getNumberOfPages() { calls.push(['getNumberOfPages']); return pages; },
    output(...args) { calls.push(['output', ...args]); return new ArrayBuffer(8); },
  };
  for (const name of ['setFillColor', 'rect', 'addImage', 'setTextColor', 'setFontSize',
    'setFont', 'text', 'setLineWidth', 'setDrawColor', 'setPage']) {
    surface[name] = (...args) => { calls.push([name, ...args]); };
  }
  return surface;
}

/**
 * Transpile the Deno original, stub what it imports and reaches for, and return
 * its captured request handler.
 */
async function loadOriginalHandler(entry) {
  const source = await readFile(entry, 'utf8');
  assert.match(source, /Deno\.serve\(/, 'the original should register a Deno handler');
  const stripped = source.replace(/^import\s+\{[^}]*\}\s+from\s+'npm:[^']*';?\s*$/gm, '');
  assert.doesNotMatch(stripped, /from 'npm:/, 'every npm import should be stubbed');
  const preamble = `const { createClientFromRequest, jsPDF, capture } = globalThis.__documentParity;\n`
    + `const Deno = { serve: capture };\n`;
  const js = transpileTs(preamble + stripped).outputText;
  const temporary = join(tmpdir(), `docparity_${Date.now()}_${Math.random().toString(36).slice(2)}.mjs`);
  await writeFile(temporary, js);
  let handler = null;
  globalThis.__documentParity = {
    createClientFromRequest: () => ({ auth: { me: async () => ({ id: 'u1', is_active: true }) } }),
    jsPDF: function jsPDF() { return globalThis.__documentParity.surface; },
    capture: (fn) => { handler = fn; },
    surface: null,
  };
  try {
    await import(pathToFileURL(temporary).href);
  } finally { await unlink(temporary).catch(() => {}); }
  assert.ok(typeof handler === 'function', 'the handler should have been captured');
  return handler;
}

/** Run the original with the logo fetch either succeeding or failing. */
async function runOriginal(handler, { logo }) {
  const surface = recorder();
  globalThis.__documentParity.surface = surface;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    if (!logo) throw new Error('logo unavailable');
    return { blob: async () => ({ arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer }) };
  };
  try {
    const response = await handler(new Request('https://example.test/', { method: 'POST' }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/pdf');
    assert.match(response.headers.get('content-disposition'), new RegExp(BAG_TECHNIQUE_FILENAME));
  } finally { globalThis.fetch = realFetch; }
  return surface.calls;
}

/** The date the original stamped, so the port is asked for the same document. */
function generatedOn(calls) {
  const stamped = calls.find(call => call[0] === 'text' && /^Generated: /.test(String(call[1])));
  assert.ok(stamped, 'the original should stamp a generated date');
  return String(stamped[1]).replace(/^Generated: /, '');
}

test('the ported checklist issues the original\'s calls when a logo is configured', async () => {
  const handler = await loadOriginalHandler(ORIGINAL);
  const original = await runOriginal(handler, { logo: true });
  const surface = recorder();
  buildBagTechniqueChecklist(surface, { logoDataUrl: LOGO, generatedOn: generatedOn(original) });
  // The original also asks for the bytes; the port returns the surface and lets
  // its handler do that, so that one trailing call is the only difference.
  assert.deepEqual(original.at(-1), ['output', 'arraybuffer']);
  const drawn = original.slice(0, -1);
  // The logo differs only in the data URL the caller supplied, which is the
  // point of the change; every other argument must match exactly.
  const image = drawn.findIndex(call => call[0] === 'addImage');
  assert.ok(image >= 0, 'the original should add the logo image');
  assert.deepEqual(drawn[image].slice(2), ['PNG', 15, 8, 20, 20]);
  assert.match(String(drawn[image][1]), /^data:image\/png;base64,/);
  drawn[image] = ['addImage', LOGO, 'PNG', 15, 8, 20, 20];
  assert.deepEqual(surface.calls, drawn);
});

test('with no logo configured it issues the original\'s own fallback calls', async () => {
  const handler = await loadOriginalHandler(ORIGINAL);
  const original = await runOriginal(handler, { logo: false });
  const surface = recorder();
  buildBagTechniqueChecklist(surface, { generatedOn: generatedOn(original) });
  assert.deepEqual(surface.calls, original.slice(0, -1));
  // And the fallback really is the branch without the image, so a reader can
  // see that removing the Base44 fetch removed a fetch and nothing else.
  assert.equal(surface.calls.some(call => call[0] === 'addImage'), false);
});

test('the checklist content is carried verbatim, because a surveyor reads it', async () => {
  const handler = await loadOriginalHandler(ORIGINAL);
  const original = await runOriginal(handler, { logo: false });
  const surface = recorder();
  buildBagTechniqueChecklist(surface, { generatedOn: generatedOn(original) });
  const lines = calls => calls.filter(call => call[0] === 'splitTextToSize').map(call => call[1]);
  const carried = lines(surface.calls);
  assert.deepEqual(carried, lines(original));
  assert.equal(carried.length, 36, 'the number of checklist items changed');
  assert.ok(carried.includes('Perform hand hygiene'));
  assert.ok(carried.includes('Doff used gloves using Aseptic Non Touch Technique'));
});

test('a document that cannot be dated is refused rather than stamped with today', () => {
  // The original called `new Date()` inside the builder, which makes the same
  // request produce a different document on either side of midnight. The port
  // takes the day from its caller and will not invent one.
  for (const value of [undefined, null, '', 0, new Date()]) {
    assert.throws(() => buildBagTechniqueChecklist(recorder(), { generatedOn: value }), TypeError);
  }
});
