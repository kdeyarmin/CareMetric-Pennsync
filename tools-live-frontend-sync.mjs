// Checks whether the published Base44 frontend was built from current source.
//
// Usage:  node tools-live-frontend-sync.mjs [https://caremetricai.base44.app]
//
// It downloads the live site's main JS bundle and looks for string literals
// that only exist in specific recent commits of this repo. Every marker present
// => the live build is current. Any marker missing => the GitHub → Base44 sync
// has not published that commit yet. Exit code 1 on drift so CI can gate on it.

const DEFAULT_ORIGIN = 'https://caremetricai.base44.app';

// Add a row whenever a user-visible string changes in a non-lazy module
// (App.jsx, SignInScreen.jsx, Layout.jsx, src/lib/*). Keep the newest first.
const MARKERS = [
  { since: '2026-09-01', text: 'This Base44 app has not been deployed yet', file: 'src/App.jsx' },
  { since: '2026-08-27', text: 'getScopedPatientAlerts', file: 'src/components/Layout.jsx' },
  { since: '2026-08-06', text: 'Confirm sign-in link', file: 'src/components/auth/SignInScreen.jsx' },
  { since: '2026-07-31', text: 'created_offline', file: 'src/lib/offlineMigration.js' },
];

const origin = (process.argv[2] || DEFAULT_ORIGIN).replace(/\/$/, '');

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.text();
}

const html = await fetchText(`${origin}/`);
const match = html.match(/<script[^>]+src="\.?\/?(assets\/index-[^"]+\.js)"/);
if (!match) {
  console.error(`Could not find the main bundle in ${origin}/ — is the site up?`);
  process.exit(2);
}
const bundleUrl = `${origin}/${match[1]}`;
const bundle = await fetchText(bundleUrl);

console.log(`Live bundle: ${bundleUrl} (${(bundle.length / 1024).toFixed(0)} KB)\n`);

let drift = false;
for (const m of MARKERS) {
  const present = bundle.includes(m.text);
  if (!present) drift = true;
  console.log(`${present ? 'OK      ' : 'MISSING '} ${m.since}  "${m.text}"  (${m.file})`);
}

console.log();
if (drift) {
  const oldest = MARKERS.filter((m) => !bundle.includes(m.text)).at(-1);
  console.log(`DRIFT: live frontend predates ${oldest.since}. Re-sync GitHub → Base44 and publish.`);
  process.exit(1);
}
console.log('Live frontend is current with the newest marker.');
