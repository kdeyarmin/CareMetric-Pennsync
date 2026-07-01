// theme.mjs — shared, print-optimized design system for the PennSync manuals.
//
// Exports the CSS (brand navy + gold, embedded Inter font) and a set of small
// HTML-builder helpers (cover, table of contents, sections, callouts, step
// lists, navigation-path chips, tables, FAQ, glossary, role badges). Both the
// User Manual and the Facility Administrator Manual are assembled from these so
// the two documents stay visually identical and never drift.

import { INTER_WOFF2 } from './font.data.mjs';
import { LOGO_DATA_URI } from './logo.data.mjs';

export const BRAND = {
  full: 'PennSync by CareMetric',
  product: 'PennSync',
  platform: 'CareMetric',
  version: '1.0',
  date: 'July 2026',
};

/* ── CSS ──────────────────────────────────────────────────────────────────── */

export const CSS = `
@font-face{
  font-family:'InterVariable';
  font-style:normal;
  font-weight:100 900;
  font-display:swap;
  src:url(${INTER_WOFF2}) format('woff2');
}

:root{
  --navy-950:#0d1628; --navy-900:#15223f; --navy-800:#1f3261; --navy-700:#213a76;
  --navy-600:#264491; --navy-500:#3557b0; --navy-200:#b6c9ee; --navy-100:#d8e3f7; --navy-50:#eef3fc;
  --gold-600:#a8741a; --gold-500:#c7901f; --gold-400:#dcab35; --gold-300:#e5c45c; --gold-100:#f6eecb; --gold-50:#fbf8ec;
  --ink:#111a2b; --slate:#334155; --muted:#5b6a7f; --line:#e4e9f1; --paper:#ffffff;
  --amber-700:#b45309; --amber-500:#f59e0b; --amber-50:#fff8ec;
  --green-700:#15803d; --green-500:#22c55e; --green-50:#effdf4;
}

*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{
  font-family:'InterVariable',-apple-system,'Segoe UI',Roboto,'Liberation Sans',system-ui,sans-serif;
  color:var(--ink); font-size:10.5pt; line-height:1.62; font-weight:400;
  -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility;
  background:#e9edf4;
}
a{color:var(--navy-600); text-decoration:none}
p{margin:0 0 10px}
strong{font-weight:700; color:var(--ink)}
small{font-size:8.5pt}

/* Screen: render the document as a centered "paper" stack. */
@media screen{
  .doc{max-width:860px; margin:28px auto; padding:0 16px}
  .sheet{background:var(--paper); box-shadow:0 10px 40px rgba(13,22,40,.14); border-radius:10px; overflow:hidden; margin-bottom:26px}
  .sheet .pad{padding:46px 54px}
}
@media print{
  body{background:#fff}
  .doc{max-width:none; margin:0; padding:0}
  .sheet{box-shadow:none; border-radius:0; margin:0}
  .sheet .pad{padding:0}
  .cover{break-after:page}
  .toc-wrap{break-after:page}
  .part{break-before:page; break-after:page}
  .sec{break-before:page}
  .sec--cont{break-before:auto}
  h2,h3,h4{break-after:avoid}
  .callout,.steps li,.tbl,.glance,.faq-i,.gloss-i,figure{break-inside:avoid}
  @page{ size:Letter; margin:18mm 16mm 20mm; }
  @page:first{ margin:0; }
}

/* ── Cover ─────────────────────────────────────────────────────────────────── */
.cover{
  position:relative; background:#20366c;
  background-image:radial-gradient(125% 95% at 80% 6%, rgba(86,124,205,.60) 0%, rgba(32,54,108,0) 55%),
                   radial-gradient(95% 85% at 4% 102%, rgba(53,87,176,.55) 0%, rgba(32,54,108,0) 60%),
                   linear-gradient(180deg, #25407e 0%, #1c2f5e 100%);
  color:#fff; text-align:center;
}
@media screen{ .cover{border-radius:10px 10px 0 0} }
.cover-inner{ padding:96px 64px 84px; display:flex; flex-direction:column; align-items:center; min-height:9.3in; justify-content:center }
@media screen{ .cover-inner{min-height:auto; padding:80px 48px 72px} }
@media print{ .cover{min-height:100vh} .cover-inner{min-height:100vh; box-sizing:border-box} }
.cover .logo{
  width:176px; height:176px; margin-bottom:34px; display:block;
  filter:drop-shadow(0 20px 42px rgba(0,0,0,.5));
}
.cover .wordmark{font-size:34px; font-weight:800; letter-spacing:-.5px; margin:0}
.cover .wordmark .sync{color:var(--gold-400)}
.cover .byline{ text-transform:uppercase; letter-spacing:4px; font-size:11px; font-weight:600; color:var(--navy-100); margin-top:6px }
.cover .rule{width:74px; height:4px; border-radius:3px; background:var(--gold-400); margin:34px 0}
.cover h1{font-size:40px; line-height:1.1; font-weight:800; margin:0; max-width:9in}
.cover .audience{margin-top:18px; font-size:15px; color:var(--navy-100); max-width:6.6in}
.cover .badge-row{margin-top:34px; display:flex; gap:10px; flex-wrap:wrap; justify-content:center}
.cover .cbadge{ border:1px solid rgba(255,255,255,.28); border-radius:999px; padding:7px 16px; font-size:12px; color:#eef3fc; font-weight:500 }
.cover .meta{ margin-top:44px; font-size:12px; color:var(--navy-200); letter-spacing:.3px }
.cover .confidential{ position:absolute; bottom:26px; left:0; right:0; font-size:9.5px; letter-spacing:1.5px; text-transform:uppercase; color:rgba(214,227,247,.6) }

/* ── Section chrome ────────────────────────────────────────────────────────── */
.sec{padding-top:6px}
.sec-head{display:flex; align-items:center; gap:16px; margin:0 0 8px; padding-bottom:16px; border-bottom:2px solid var(--line)}
.sec-num{
  flex:0 0 auto; width:42px; height:42px; border-radius:11px;
  background:var(--navy-800); color:var(--gold-400); font-weight:800; font-size:18px;
  display:flex; align-items:center; justify-content:center;
}
.sec-head h2{margin:0; font-size:24px; font-weight:800; color:var(--navy-800); letter-spacing:-.3px}
.sec-intro{color:var(--slate); font-size:11pt; margin:14px 0 18px}
h3{font-size:16px; font-weight:750; color:var(--navy-700); margin:26px 0 8px}
h3 .h3-eyebrow{display:block; font-size:10px; letter-spacing:2px; text-transform:uppercase; color:var(--gold-600); font-weight:700; margin-bottom:3px}
h4{font-size:12.5px; font-weight:700; color:var(--navy-800); margin:16px 0 6px; text-transform:uppercase; letter-spacing:.4px}
ul,ol{margin:6px 0 12px; padding-left:20px}
li{margin:4px 0}
ul.tight li{margin:2px 0}
ul.feat{list-style:none; padding-left:0}
ul.feat li{position:relative; padding-left:20px; margin:6px 0}
ul.feat li::before{content:''; position:absolute; left:2px; top:8px; width:7px; height:7px; border-radius:2px; background:var(--gold-400)}

/* ── Part divider ──────────────────────────────────────────────────────────── */
.part{background:var(--navy-800); color:#fff}
@media screen{ .part{border-radius:10px} }
.part-inner{padding:120px 64px; min-height:8.4in; display:flex; flex-direction:column; justify-content:center}
@media screen{ .part-inner{min-height:auto; padding:72px 54px} }
.part .kicker{text-transform:uppercase; letter-spacing:5px; font-size:12px; font-weight:700; color:var(--gold-400)}
.part h2{font-size:38px; font-weight:800; margin:14px 0 0; max-width:8in; line-height:1.12}
.part .blurb{margin-top:18px; font-size:15px; color:var(--navy-100); max-width:6.4in; line-height:1.6}
.part .prule{width:70px; height:4px; background:var(--gold-400); border-radius:3px; margin-top:26px}

/* ── Table of contents ─────────────────────────────────────────────────────── */
.toc-wrap{padding-top:6px}
.toc-title{font-size:26px; font-weight:800; color:var(--navy-800); margin:0 0 4px}
.toc-sub{color:var(--muted); margin:0 0 22px; font-size:11pt}
.toc-part{margin:22px 0 8px; font-size:11px; letter-spacing:3px; text-transform:uppercase; color:var(--gold-600); font-weight:700; border-top:1px solid var(--line); padding-top:16px}
.toc-row{display:flex; align-items:baseline; gap:10px; margin:7px 0}
.toc-row .tnum{flex:0 0 auto; color:var(--navy-600); font-weight:700; width:22px}
.toc-row .tname{flex:0 0 auto; color:var(--ink); font-weight:600}
.toc-row .tdots{flex:1 1 auto; border-bottom:1px dotted #cbd5e1; transform:translateY(-3px)}
.toc-sublist{margin:2px 0 6px 32px}
.toc-sublist .tsub{display:flex; align-items:baseline; gap:8px; margin:3px 0; color:var(--slate); font-size:10pt}
.toc-sublist .tsub::before{content:'–'; color:var(--gold-500)}

/* ── Callouts ──────────────────────────────────────────────────────────────── */
.callout{display:flex; gap:13px; padding:14px 16px; border-radius:10px; margin:14px 0; border:1px solid var(--line); background:#fbfcfe}
.callout .ci{flex:0 0 auto; width:24px; height:24px; border-radius:7px; display:flex; align-items:center; justify-content:center; font-size:14px; font-weight:800; color:#fff; line-height:1}
.callout .ct{font-weight:750; margin:0 0 3px; font-size:11pt}
.callout .cx{color:var(--slate)} .callout .cx :last-child{margin-bottom:0}
.callout-tip{background:var(--gold-50); border-color:var(--gold-300)} .callout-tip .ci{background:var(--gold-500)} .callout-tip .ct{color:var(--gold-600)}
.callout-note{background:var(--navy-50); border-color:var(--navy-100)} .callout-note .ci{background:var(--navy-600)} .callout-note .ct{color:var(--navy-700)}
.callout-important{background:var(--amber-50); border-color:#fcd9a5} .callout-important .ci{background:var(--amber-500)} .callout-important .ct{color:var(--amber-700)}
.callout-best{background:var(--green-50); border-color:#b6ebc7} .callout-best .ci{background:var(--green-500)} .callout-best .ct{color:var(--green-700)}

/* ── Navigation path chips ─────────────────────────────────────────────────── */
.navpath{display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin:12px 0 4px}
.navpath .np{background:var(--navy-800); color:#fff; font-size:10.5px; font-weight:600; padding:4px 11px; border-radius:7px; white-space:nowrap}
.navpath .np.first{background:var(--gold-400); color:var(--navy-900)}
.navpath .sep{color:var(--navy-300,#88a5e0); font-weight:800}
.navpath-label{font-size:9px; text-transform:uppercase; letter-spacing:1.5px; color:var(--muted); font-weight:700; margin-right:2px}

/* ── Steps ─────────────────────────────────────────────────────────────────── */
ol.steps{list-style:none; counter-reset:step; padding-left:0; margin:14px 0}
ol.steps li{counter-increment:step; position:relative; padding-left:44px; margin:0 0 12px; min-height:30px}
ol.steps li::before{
  content:counter(step); position:absolute; left:0; top:0; width:30px; height:30px; border-radius:50%;
  background:var(--navy-800); color:#fff; font-weight:800; font-size:13px; display:flex; align-items:center; justify-content:center;
}
ol.steps li:last-child::before{background:var(--gold-400); color:var(--navy-900)}
ol.steps li .st{font-weight:700; display:block; margin-top:4px}
ol.steps li .sd{color:var(--slate)}

/* ── At-a-glance card ──────────────────────────────────────────────────────── */
.glance{border:1px solid var(--navy-100); background:linear-gradient(180deg,#fff, #f7faff); border-radius:11px; padding:4px 18px 10px; margin:16px 0}
.glance .gh{font-size:10px; letter-spacing:2px; text-transform:uppercase; color:var(--gold-600); font-weight:800; margin:14px 0 6px}
.glance dl{margin:0}
.glance .grow{display:flex; gap:14px; padding:7px 0; border-top:1px solid #eef2f8}
.glance .grow:first-of-type{border-top:none}
.glance dt{flex:0 0 34%; font-weight:700; color:var(--navy-700); margin:0}
.glance dd{flex:1 1 auto; margin:0; color:var(--slate)}

/* ── Tables ────────────────────────────────────────────────────────────────── */
table.tbl{width:100%; border-collapse:collapse; margin:14px 0; font-size:10pt}
table.tbl th{background:var(--navy-800); color:#fff; text-align:left; padding:9px 12px; font-weight:700; font-size:9.5pt; letter-spacing:.2px}
table.tbl th:first-child{border-radius:8px 0 0 0} table.tbl th:last-child{border-radius:0 8px 0 0}
table.tbl td{padding:8px 12px; border-bottom:1px solid var(--line); vertical-align:top; color:var(--slate)}
table.tbl tr:nth-child(even) td{background:#f8fafd}
table.tbl td strong{color:var(--navy-800)}

/* ── FAQ ───────────────────────────────────────────────────────────────────── */
.faq-i{border-left:4px solid var(--gold-400); background:#f8fafd; border-radius:0 9px 9px 0; padding:12px 16px; margin:10px 0}
.faq-q{font-weight:750; color:var(--navy-800); margin:0 0 4px}
.faq-a{margin:0; color:var(--slate)}

/* ── Glossary ──────────────────────────────────────────────────────────────── */
dl.gloss{margin:14px 0}
.gloss-i{display:flex; gap:16px; padding:9px 0; border-bottom:1px solid var(--line)}
.gloss-i dt{flex:0 0 26%; font-weight:750; color:var(--navy-700); margin:0}
.gloss-i dd{flex:1 1 auto; margin:0; color:var(--slate)}

/* ── Role badges & keycaps ─────────────────────────────────────────────────── */
.roles{display:inline-flex; gap:6px; flex-wrap:wrap; vertical-align:middle}
.role{font-size:9px; font-weight:800; letter-spacing:.6px; text-transform:uppercase; padding:3px 9px; border-radius:999px}
.role-nurse{background:var(--navy-50); color:var(--navy-700); border:1px solid var(--navy-100)}
.role-facility-admin{background:var(--gold-50); color:var(--gold-600); border:1px solid var(--gold-300)}
.role-super-admin{background:#f1f5f9; color:#475569; border:1px solid #e2e8f0}
.roleline{display:flex; align-items:center; gap:8px; margin:6px 0 2px}
.roleline .rl-label{font-size:9px; text-transform:uppercase; letter-spacing:1.5px; color:var(--muted); font-weight:700}
.kbd{font-family:'Liberation Mono',ui-monospace,monospace; font-size:9.5pt; background:#f1f5f9; border:1px solid #d5deea; border-bottom-width:2px; border-radius:5px; padding:1px 7px; color:var(--navy-800); font-weight:600}

/* ── Two-column feature grid ───────────────────────────────────────────────── */
.grid2{display:grid; grid-template-columns:1fr 1fr; gap:14px; margin:14px 0}
.mini{border:1px solid var(--line); border-radius:10px; padding:13px 15px; background:#fff}
.mini h4{margin:0 0 5px; color:var(--navy-700); text-transform:none; letter-spacing:0; font-size:12pt}
.mini p{margin:0; color:var(--slate); font-size:10pt}
.lead{font-size:11.5pt; color:var(--slate); margin:0 0 14px}
.divider-sm{height:1px; background:var(--line); margin:22px 0}

/* ── Figures (illustrative UI diagrams) ────────────────────────────────────── */
figure.fig{margin:18px 0 20px; break-inside:avoid}
.fig .frame{border:1px solid var(--line); border-radius:12px; overflow:hidden; box-shadow:0 10px 26px rgba(13,22,40,.10)}
.fig figcaption{margin-top:9px; font-size:9.5pt; color:var(--muted); text-align:center; line-height:1.4}
.fig figcaption .flabel{color:var(--gold-600); font-weight:800; text-transform:uppercase; letter-spacing:1.2px; margin-right:7px}
.illus-note{font-size:8.5pt; color:var(--muted); font-style:italic; text-align:center; margin:-12px 0 16px}

/* Mock app window */
.uiwin{background:#fff; font-size:9.5px}
.uiwin .titlebar{display:flex; align-items:center; gap:6px; padding:8px 12px; background:#eef2f8; border-bottom:1px solid var(--line)}
.uiwin .dot{width:9px; height:9px; border-radius:50%}
.uiwin .dot.r{background:#f87171} .uiwin .dot.y{background:#fbbf24} .uiwin .dot.g{background:#34d399}
.uiwin .tb-title{margin-left:8px; font-size:9pt; color:var(--muted); font-weight:600}
.uiwin .shell{display:grid; grid-template-columns:172px 1fr}
.uiwin .side{background:var(--navy-800); color:#fff; padding:12px 10px}
.uiwin .side .brand{display:flex; align-items:center; gap:6px; font-weight:800; font-size:12px; margin-bottom:10px}
.uiwin .side .brand .sync{color:var(--gold-400)}
.uiwin .side .cat{font-size:7px; letter-spacing:1.4px; text-transform:uppercase; color:#8aa0cf; margin:9px 0 3px}
.uiwin .side .nav{display:flex; align-items:center; gap:7px; padding:5px 8px; border-radius:6px; font-size:9.5px; color:#dbe4f5; margin:1px 0}
.uiwin .side .nav .ic{width:11px; height:11px; border-radius:3px; background:rgba(255,255,255,.22); flex:0 0 auto}
.uiwin .side .nav.active{background:rgba(220,171,53,.20); color:#fff; font-weight:600}
.uiwin .side .nav.active .ic{background:var(--gold-400)}
.uiwin .main{display:flex; flex-direction:column}
.uiwin .topbar{display:flex; align-items:center; justify-content:space-between; padding:9px 14px; border-bottom:1px solid var(--line); background:#fff}
.uiwin .crumb{font-size:9px; color:var(--muted)} .uiwin .crumb b{color:var(--navy-700)}
.uiwin .tools{display:flex; align-items:center; gap:8px}
.uiwin .search{display:flex; align-items:center; gap:6px; border:1px solid var(--line); border-radius:999px; padding:4px 11px; font-size:8.5px; color:var(--muted)}
.uiwin .kbdmini{background:#eef2f8; border:1px solid #d5deea; border-radius:4px; padding:0 4px; font-size:7.5px; font-weight:700; color:var(--navy-700)}
.uiwin .bell{width:20px; height:20px; border-radius:50%; background:#eef2f8; position:relative}
.uiwin .bell::after{content:''; position:absolute; top:3px; right:3px; width:6px; height:6px; border-radius:50%; background:var(--gold-500)}
.uiwin .content{padding:14px; background:#f6f8fc; flex:1}
.uiwin .h{height:11px; border-radius:4px; background:#dbe4f2; margin-bottom:9px}
.uiwin .card{background:#fff; border:1px solid var(--line); border-radius:8px; padding:11px; margin-bottom:9px}
.uiwin .bar{height:8px; border-radius:4px; background:#e7edf6; margin:5px 0}
.uiwin .row2{display:grid; grid-template-columns:1fr 1fr; gap:9px}
.uiwin .pill{display:inline-block; font-size:8px; font-weight:700; padding:2px 8px; border-radius:999px; background:var(--navy-50); color:var(--navy-700)}
.uiwin .pill.gold{background:var(--gold-100); color:var(--gold-600)}
.uiwin .btn{display:inline-block; font-size:8.5px; font-weight:700; color:#fff; background:var(--navy-700); border-radius:6px; padding:5px 12px}
.uiwin .btn.gold{background:var(--gold-400); color:var(--navy-900)}
.uiwin .tabs{display:flex; gap:14px; border-bottom:1px solid var(--line); padding:0 14px; background:#fff}
.uiwin .tab{font-size:9px; color:var(--muted); padding:9px 0; border-bottom:2px solid transparent}
.uiwin .tab.on{color:var(--navy-800); font-weight:700; border-bottom-color:var(--gold-400)}

/* Annotation badge + legend */
.anno{display:inline-flex; align-items:center; justify-content:center; width:15px; height:15px; border-radius:50%; background:var(--gold-400); color:var(--navy-900); font-size:9px; font-weight:800; vertical-align:middle; margin-left:4px}
ul.legend{list-style:none; padding:0; margin:12px 0 0; display:grid; grid-template-columns:1fr 1fr; gap:6px 20px}
ul.legend li{font-size:10pt; color:var(--slate); display:flex; gap:8px; align-items:baseline}
ul.legend .anno{margin-left:0; flex:0 0 auto; position:relative; top:2px}

/* Step flow pipeline */
.flow{display:flex; flex-wrap:wrap; gap:9px; margin:14px 0}
.flow .fstep{flex:1 1 0; min-width:120px; border:1px solid var(--navy-100); border-radius:11px; padding:11px 12px; background:linear-gradient(180deg,#fff,#f6faff)}
.flow .fstep .fn{width:23px; height:23px; border-radius:50%; background:var(--navy-800); color:#fff; font-weight:800; font-size:11px; display:flex; align-items:center; justify-content:center; margin-bottom:7px}
.flow .fstep:last-child .fn{background:var(--gold-400); color:var(--navy-900)}
.flow .fstep h5{margin:0 0 3px; font-size:10.5pt; color:var(--navy-800); font-weight:750}
.flow .fstep p{margin:0; font-size:9pt; color:var(--slate); line-height:1.45}
`;

/* ── HTML builder helpers ─────────────────────────────────────────────────── */

export function esc(s = '') {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function cover({ title, audience, badges = [] }) {
  return `<section class="cover">
    <div class="cover-inner">
      <img class="logo" src="${LOGO_DATA_URI}" alt="PennSync by CareMetric logo">
      <p class="wordmark">Penn<span class="sync">Sync</span></p>
      <div class="byline">by ${BRAND.platform}</div>
      <div class="rule"></div>
      <h1>${title}</h1>
      <p class="audience">${audience}</p>
      <div class="badge-row">${badges.map((b) => `<span class="cbadge">${b}</span>`).join('')}</div>
      <div class="meta">Version ${BRAND.version} &nbsp;·&nbsp; ${BRAND.date} &nbsp;·&nbsp; ${BRAND.full}</div>
    </div>
    <div class="confidential">Confidential · For authorized ${BRAND.product} users only</div>
  </section>`;
}

export function partDivider({ id, kicker, title, blurb }) {
  return `<section class="part" id="${id}">
    <div class="part-inner">
      <div class="kicker">${kicker}</div>
      <h2>${title}</h2>
      <div class="prule"></div>
      <p class="blurb">${blurb}</p>
    </div>
  </section>`;
}

// Builds the linked Table of Contents from the ordered list of blocks.
export function toc(blocks, { title, subtitle }) {
  let out = `<div class="toc-wrap"><h2 class="toc-title">${title}</h2><p class="toc-sub">${subtitle}</p>`;
  for (const b of blocks) {
    if (b.type === 'part') {
      out += `<div class="toc-part">${b.kicker} — ${b.title}</div>`;
    } else {
      out += `<div class="toc-row"><span class="tnum">${b.num}</span><a class="tname" href="#${b.id}">${b.title}</a><span class="tdots"></span></div>`;
      if (b.sub && b.sub.length) {
        out += `<div class="toc-sublist">${b.sub
          .map((s) => `<a class="tsub" href="#${s.id}">${s.title}</a>`)
          .join('')}</div>`;
      }
    }
  }
  return out + '</div>';
}

export function section({ id, num, title, html }) {
  return `<section class="sec" id="${id}">
    <div class="sec-head"><span class="sec-num">${num}</span><h2>${title}</h2></div>
    ${html}
  </section>`;
}

export function callout(type, title, body) {
  const glyph = { tip: '★', note: 'i', important: '!', best: '✓' }[type] || '•';
  return `<div class="callout callout-${type}"><span class="ci">${glyph}</span><div><p class="ct">${title}</p><div class="cx">${body}</div></div></div>`;
}

export function navpath(parts) {
  const chips = parts
    .map((p, i) => `<span class="np${i === 0 ? ' first' : ''}">${esc(p)}</span>`)
    .join('<span class="sep">▸</span>');
  return `<div class="navpath"><span class="navpath-label">Go to</span>${chips}</div>`;
}

// steps: array of ["Bold lead", "description"] or plain "text"
export function steps(items) {
  const li = items
    .map((it) => {
      if (Array.isArray(it)) return `<li><span class="st">${it[0]}</span><span class="sd">${it[1]}</span></li>`;
      return `<li><span class="sd">${it}</span></li>`;
    })
    .join('');
  return `<ol class="steps">${li}</ol>`;
}

export function glance(title, rows) {
  const body = rows.map(([k, v]) => `<div class="grow"><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  return `<div class="glance"><div class="gh">${title}</div><dl>${body}</dl></div>`;
}

export function table(headers, rows) {
  const head = headers.map((h) => `<th>${h}</th>`).join('');
  const body = rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('');
  return `<table class="tbl"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

export function faq(items) {
  return items.map((f) => `<div class="faq-i"><p class="faq-q">${f.q}</p><p class="faq-a">${f.a}</p></div>`).join('');
}

export function glossary(items) {
  return `<dl class="gloss">${items
    .map((g) => `<div class="gloss-i"><dt>${g.term}</dt><dd>${g.def}</dd></div>`)
    .join('')}</dl>`;
}

export function roles(...labels) {
  return `<span class="roles">${labels
    .map((l) => `<span class="role role-${l.toLowerCase().replace(/\s+/g, '-')}">${l}</span>`)
    .join('')}</span>`;
}

export function roleLine(...labels) {
  return `<div class="roleline"><span class="rl-label">Who can use this</span>${roles(...labels)}</div>`;
}

export function grid2(cards) {
  return `<div class="grid2">${cards
    .map((c) => `<div class="mini"><h4>${c.h}</h4><p>${c.p}</p></div>`)
    .join('')}</div>`;
}

export function kbd(s) {
  return `<span class="kbd">${s}</span>`;
}

// figure: wraps an illustrative UI mock in a captioned frame.
export function figure(caption, body) {
  return `<figure class="fig"><div class="frame">${body}</div><figcaption><span class="flabel">Figure</span>${caption}</figcaption></figure>`;
}

// legend: numbered key that pairs with .anno badges in a mock.
export function legend(items) {
  return `<ul class="legend">${items
    .map((t, i) => `<li><span class="anno">${i + 1}</span><span>${t}</span></li>`)
    .join('')}</ul>`;
}

// flow: a left-to-right numbered pipeline of steps (wraps on print).
export function flow(steps) {
  return `<div class="flow">${steps
    .map((s, i) => `<div class="fstep"><div class="fn">${i + 1}</div><h5>${s.h}</h5><p>${s.p}</p></div>`)
    .join('')}</div>`;
}

const A = (n) => `<span class="anno">${n}</span>`;
const sideNav = (label, active = false) =>
  `<div class="nav${active ? ' active' : ''}"><span class="ic"></span>${label}</div>`;

// Illustrative mock of the PennSync workspace (sidebar, breadcrumbs, search, alerts).
export function mockWorkspace() {
  return `<div class="uiwin">
    <div class="titlebar"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span><span class="tb-title">${BRAND.full}</span></div>
    <div class="shell">
      <div class="side">
        <div class="brand">Penn<span class="sync">Sync</span>${A(1)}</div>
        <div class="cat">Overview</div>
        ${sideNav('Dashboard')}
        <div class="cat">Patient Care</div>
        ${sideNav('Patients', true)}
        ${sideNav('OASIS Center')}
        ${sideNav('Incidents')}
        ${sideNav('Patient Education')}
        <div class="cat">Documentation</div>
        ${sideNav('Clinical Notes')}
        <div class="cat">Communication</div>
        ${sideNav('Messages')}
        ${sideNav('Phone Center')}
      </div>
      <div class="main">
        <div class="topbar">
          <div class="crumb"><b>Patients</b> &nbsp;▸&nbsp; Patient Details${A(2)}</div>
          <div class="tools"><span class="search"><span class="kbdmini">Cmd</span><span class="kbdmini">K</span> &nbsp;Search patients &amp; pages…${A(3)}</span><span class="bell"></span>${A(4)}</div>
        </div>
        <div class="content">
          <div class="h" style="width:38%"></div>
          <div class="row2">
            <div class="card"><span class="pill">Active</span><div class="bar" style="width:80%"></div><div class="bar" style="width:60%"></div></div>
            <div class="card"><span class="pill gold">AI summary</span><div class="bar" style="width:70%"></div><div class="bar" style="width:85%"></div></div>
          </div>
          <div class="card"><div class="bar" style="width:55%"></div><div class="bar" style="width:40%"></div></div>
        </div>
      </div>
    </div>
  </div>`;
}

// Illustrative mock of the Smart Note screen.
export function mockSmartNote() {
  return `<div class="uiwin">
    <div class="titlebar"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span><span class="tb-title">Clinical Notes — Smart Note</span></div>
    <div class="content" style="background:#fff; padding:16px">
      <div class="card"><span class="pill">Patient</span>${A(1)}<div class="bar" style="width:45%; margin-top:6px"></div></div>
      <div class="card"><span class="pill">Vitals</span>${A(2)}
        <div class="row2" style="margin-top:6px"><div class="bar" style="width:100%"></div><div class="bar" style="width:100%"></div></div>
        <div class="row2"><div class="bar" style="width:100%"></div><div class="bar" style="width:100%"></div></div>
      </div>
      <div class="row2">
        <div class="card"><span class="pill">Your observations</span>${A(3)}<div class="bar" style="width:90%; margin-top:6px"></div><div class="bar" style="width:80%"></div><div class="bar" style="width:85%"></div></div>
        <div class="card" style="background:#f6faff; border-color:var(--navy-100)"><span class="pill gold">AI compliance &amp; polish</span>${A(4)}<div class="bar" style="width:95%; margin-top:6px; background:#dbe7fb"></div><div class="bar" style="width:88%; background:#dbe7fb"></div><div class="bar" style="width:70%; background:#dbe7fb"></div></div>
      </div>
      <div style="text-align:right; margin-top:4px"><span class="btn gold">Save note${A(5)}</span></div>
    </div>
  </div>`;
}

// Illustrative mock of the OASIS Center tab bar.
export function mockOasisTabs() {
  return `<div class="uiwin">
    <div class="titlebar"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span><span class="tb-title">OASIS Center</span></div>
    <div class="tabs">
      <div class="tab on">Assessment</div><div class="tab">Analyze</div><div class="tab">Review &amp; Approve</div>
      <div class="tab">Clinical</div><div class="tab">Quality</div>
    </div>
    <div class="content" style="background:#fff">
      <div class="card"><span class="pill gold">AI pre-fill</span><div class="bar" style="width:70%; margin-top:6px"></div><div class="bar" style="width:82%"></div></div>
      <div class="card"><div class="bar" style="width:60%"></div><div class="bar" style="width:48%"></div></div>
      <div style="text-align:right"><span class="btn">Save draft</span> &nbsp; <span class="btn gold">Submit</span></div>
    </div>
  </div>`;
}

// Wrap assembled body HTML into a complete, self-contained HTML document.
export function htmlDocument({ docTitle, bodyHtml }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(docTitle)}</title>
<meta name="description" content="${esc(docTitle)} — ${BRAND.full}">
<style>${CSS}</style>
</head>
<body>
<div class="doc">
${bodyHtml}
</div>
</body>
</html>`;
}
