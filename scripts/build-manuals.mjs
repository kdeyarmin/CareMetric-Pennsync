#!/usr/bin/env node
// build-manuals.mjs — generate the two branded PennSync manuals (HTML + PDF).
//
// Assembles a self-contained, print-optimized HTML file for each manual from the
// shared theme + content modules, then renders each to PDF with the pre-installed
// headless Chromium (driven over the DevTools protocol so we get real running
// headers/footers and page numbers).
//
//   node scripts/build-manuals.mjs            # build HTML + PDF for both manuals
//   node scripts/build-manuals.mjs --html     # HTML only (skip Chromium/PDF)
//
// See public/manuals/README.md for regeneration notes.

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  BRAND, htmlDocument, cover, toc, section, partDivider,
} from './manuals/theme.mjs';
import { userBlocks } from './manuals/content-user.mjs';
import { adminBlocks } from './manuals/content-admin.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT_DIR = join(ROOT, 'public', 'manuals');
const HTML_ONLY = process.argv.includes('--html');

/* ── Assembly ──────────────────────────────────────────────────────────────── */

const sheet = (inner, { pad = true } = {}) =>
  pad ? `<div class="sheet"><div class="pad">${inner}</div></div>` : `<div class="sheet">${inner}</div>`;

// Walk the ordered blocks, assigning sequential section numbers (parts are
// unnumbered) and producing both the rendered body and the TOC model.
function assemble({ coverCfg, tocCfg, blocks }) {
  let n = 0;
  const tocBlocks = [];
  const bodyParts = [sheet(cover(coverCfg), { pad: false })];

  const numbered = blocks.map((b) => {
    if (b.type === 'part') {
      tocBlocks.push(b);
      return { ...b };
    }
    n += 1;
    tocBlocks.push({ num: n, id: b.id, title: b.title, sub: b.sub || [] });
    return { ...b, num: n };
  });

  bodyParts.push(sheet(toc(tocBlocks, tocCfg)));

  for (const b of numbered) {
    if (b.type === 'part') {
      bodyParts.push(sheet(partDivider(b), { pad: false }));
    } else {
      bodyParts.push(sheet(section(b)));
    }
  }
  return bodyParts.join('\n');
}

/* ── DevTools-protocol PDF renderer ────────────────────────────────────────── */

const CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  process.env.CHROMIUM_BIN,
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
];

function findChrome() {
  for (const c of CHROME_CANDIDATES) {
    if (c && existsSync(c)) return c;
  }
  // Fall back to any chromium build under PLAYWRIGHT_BROWSERS_PATH.
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (existsSync(base)) {
    for (const d of readdirSync(base)) {
      if (d.startsWith('chromium-')) {
        const p = join(base, d, 'chrome-linux', 'chrome');
        if (existsSync(p)) return p;
      }
    }
  }
  return null;
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function launchChrome(chromePath) {
  const userDataDir = mkdtempSync(join(tmpdir(), 'pennsync-pdf-'));
  const proc = spawn(chromePath, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--hide-scrollbars', '--force-color-profile=srgb',
    '--remote-debugging-port=0', `--user-data-dir=${userDataDir}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  const wsUrl = new Promise((res, rej) => {
    let buf = '';
    const to = setTimeout(() => rej(new Error('Timed out waiting for Chromium DevTools endpoint')), 20000);
    proc.stderr.on('data', (d) => {
      buf += d.toString();
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(to); res(m[1]); }
    });
    proc.on('exit', (code) => { clearTimeout(to); rej(new Error('Chromium exited early (' + code + ')')); });
  });
  return { proc, wsUrl };
}

// Minimal CDP client over the browser WebSocket (flatten-session routing).
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.waiters = []; }
  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('WS connect failed')); });
    const cdp = new CDP(ws);
    ws.onmessage = (ev) => cdp._recv(JSON.parse(ev.data));
    return cdp;
  }
  _recv(msg) {
    if (msg.id && this.pending.has(msg.id)) {
      const { res, rej } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    } else if (msg.method) {
      this.waiters = this.waiters.filter((w) => {
        if (w.method === msg.method && (!w.sessionId || w.sessionId === msg.sessionId)) { w.res(msg.params); return false; }
        return true;
      });
    }
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify(payload)); });
  }
  once(method, sessionId) {
    return new Promise((res) => this.waiters.push({ method, sessionId, res }));
  }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

function headerFooter(manualTitle) {
  const year = new Date().getFullYear();
  const wrap = (inner) =>
    `<div style="font-family:'Segoe UI',Roboto,Arial,sans-serif;font-size:7px;color:#6b7688;width:100%;padding:0 16mm;display:flex;justify-content:space-between;align-items:center;">${inner}</div>`;
  return {
    headerTemplate: wrap(`<span style="font-weight:600;color:#5c687d;">${BRAND.full}</span><span>${manualTitle}</span>`),
    footerTemplate: wrap(`<span>© ${year} ${BRAND.platform} · Confidential</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>`),
  };
}

async function renderPDF(cdp, htmlPath, pdfPath, manualTitle) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, sessionId);
  const loaded = cdp.once('Page.loadEventFired', sessionId);
  await cdp.send('Page.navigate', { url: pathToFileURL(htmlPath).href }, sessionId);
  await loaded;
  await delay(700); // let the embedded font + layout settle
  const { headerTemplate, footerTemplate } = headerFooter(manualTitle);
  // transferMode:'ReturnAsStream' is required: returning the PDF inline embeds
  // the whole document as base64 in a single CDP WebSocket message, and once
  // that message exceeds ~4 MiB it is silently never delivered to Node's
  // WebSocket client — the build then waits forever on a PDF that already
  // rendered. Streaming reads the result in 1 MiB chunks instead.
  const { stream } = await cdp.send('Page.printToPDF', {
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate,
    footerTemplate,
    scale: 1,
    transferMode: 'ReturnAsStream',
  }, sessionId);
  const chunks = [];
  for (;;) {
    const r = await cdp.send('IO.read', { handle: stream, size: 1 << 20 }, sessionId);
    chunks.push(Buffer.from(r.data, r.base64Encoded ? 'base64' : 'utf8'));
    if (r.eof) break;
  }
  await cdp.send('IO.close', { handle: stream }, sessionId).catch(() => {});
  writeFileSync(pdfPath, Buffer.concat(chunks));
  await cdp.send('Target.closeTarget', { targetId });
}

/* ── Manual definitions ────────────────────────────────────────────────────── */

const MANUALS = [
  {
    file: 'PennSync-User-Manual',
    docTitle: 'PennSync User Manual',
    manualTitle: 'User Manual',
    coverCfg: {
      title: 'User Manual',
      audience: 'For clinical &amp; office staff — nurses, social workers, spiritual care, therapists, aides, and administrative team members',
      badges: ['Home Health', 'Hospice', 'Clinical & Office Staff', 'AI-Assisted Documentation'],
    },
    tocCfg: { title: 'Contents', subtitle: 'Everything you need to work confidently in PennSync, from your first sign-in to advanced AI documentation.' },
    blocks: () => userBlocks,
  },
  {
    file: 'PennSync-Facility-Admin-Manual',
    docTitle: 'PennSync Facility Administrator Manual',
    manualTitle: 'Facility Administrator Manual',
    coverCfg: {
      title: 'Facility Administrator Manual',
      audience: 'For facility administrators — everything your clinical team uses, plus the tools to run your agency',
      badges: ['User Guide Included', 'User & Staff Management', 'Compliance & Analytics', 'Agency Configuration'],
    },
    tocCfg: { title: 'Contents', subtitle: 'Part I is the complete end-user manual; Part II covers the facility-administration tools available to you.' },
    blocks: () => [
      { type: 'part', id: 'part-1', kicker: 'Part I', title: 'Using PennSync', blurb: 'As an administrator you are also a clinical user. Part I is the complete PennSync User Manual — the same day-to-day features your whole team relies on.' },
      ...userBlocks,
      { type: 'part', id: 'part-2', kicker: 'Part II', title: 'Administering Your Facility', blurb: 'The administrator toolset: managing users and credentials, back-office workflows, training, compliance, analytics, and agency configuration.' },
      ...adminBlocks,
    ],
  },
];

/* ── Main ──────────────────────────────────────────────────────────────────── */

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const built = [];

  for (const m of MANUALS) {
    const bodyHtml = assemble({ coverCfg: m.coverCfg, tocCfg: m.tocCfg, blocks: m.blocks() });
    const html = htmlDocument({ docTitle: m.docTitle, bodyHtml });
    const htmlPath = join(OUT_DIR, `${m.file}.html`);
    writeFileSync(htmlPath, html);
    built.push({ ...m, htmlPath });
    console.log(`✓ HTML  ${htmlPath}  (${(html.length / 1024).toFixed(0)} KB)`);
  }

  if (HTML_ONLY) { console.log('\n(--html) Skipping PDF render.'); return; }

  const chromePath = findChrome();
  if (!chromePath) { console.error('✗ No Chromium found — run with --html or set CHROME_BIN. Skipping PDFs.'); process.exitCode = 1; return; }

  const { proc, wsUrl } = launchChrome(chromePath);
  let cdp;
  try {
    cdp = await CDP.connect(await wsUrl);
    for (const b of built) {
      const pdfPath = join(OUT_DIR, `${b.file}.pdf`);
      await renderPDF(cdp, b.htmlPath, pdfPath, b.manualTitle);
      const kb = (statSync(pdfPath).size / 1024).toFixed(0);
      console.log(`✓ PDF   ${pdfPath}  (${kb} KB)`);
    }
  } finally {
    if (cdp) cdp.close();
    proc.kill('SIGKILL');
  }
  console.log('\nDone.');
}

main().catch((e) => { console.error(e); process.exit(1); });
