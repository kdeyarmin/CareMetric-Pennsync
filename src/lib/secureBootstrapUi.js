// This module deliberately imports no React, SDK, auth, or application modules.
// A blocked frame must stay an inert launch surface, never a clinical preview.
const GUARD_FAILURE_CODES = new Set([
  'LINK_GUARD', 'FILE_INPUT_GUARD', 'FILE_DROP_GUARD',
  'CLIPBOARD_GUARD', 'STORAGE_LISTENER', 'APP_IMPORT', 'APP_MOUNT',
]);

export function detachedPreviewUrl(href) {
  try {
    const url = new URL(href);
    const localHttp = url.protocol === 'http:'
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || (url.protocol !== 'https:' && !localHttp)) return null;
    // Do not copy access tokens, return URLs, page state, patient identifiers,
    // or fragments into another browsing context. The new tab starts normally.
    return `${url.origin}/`;
  } catch {
    return null;
  }
}

export function renderSecureBootstrapNotice(documentObject, locationObject, failureCode) {
  const root = documentObject.getElementById('root');
  if (!root) return;
  const embedded = failureCode === 'FRAME_NOT_ALLOWED';
  const assetFailure = failureCode === 'APP_IMPORT' || failureCode === 'APP_MOUNT';
  const reason = embedded || GUARD_FAILURE_CODES.has(failureCode)
    ? failureCode : 'REQUIRED_GUARD';
  const shell = documentObject.createElement('main');
  shell.setAttribute('role', embedded ? 'status' : 'alert');
  shell.setAttribute('data-bootstrap-reason', reason);
  shell.style.cssText = 'min-height:100vh;display:grid;place-items:center;background:#f8fafc;padding:24px;font-family:system-ui,sans-serif;color:#0f172a';
  const card = documentObject.createElement('section');
  card.style.cssText = 'max-width:560px;border:1px solid #cbd5e1;border-radius:16px;background:white;padding:24px;box-shadow:0 10px 30px rgba(15,23,42,.08)';
  const heading = documentObject.createElement('h1');
  heading.textContent = embedded ? 'Open a secure preview'
    : assetFailure ? 'App could not finish loading' : 'Secure browser controls unavailable';
  heading.style.cssText = 'font-size:22px;font-weight:700;margin:0 0 12px';
  const message = documentObject.createElement('p');
  message.textContent = embedded
    ? 'PennSync opens outside the embedded editor to protect clinical information. Open the preview in its own tab, then sign in there. No patient data is loaded in this panel.'
    : assetFailure
      ? 'The application files could not finish loading. Reload to fetch the current release. Privacy protections remain active; no clinical workspace was opened.'
      : 'A required browser privacy control could not start. Reload this page in an up-to-date browser. No clinical workspace was opened.';
  message.style.cssText = 'font-size:15px;line-height:1.5;margin:0 0 20px;color:#475569';
  card.append(heading, message);

  if (embedded) {
    const href = detachedPreviewUrl(locationObject.href);
    if (href) {
      const link = documentObject.createElement('a');
      link.href = href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.referrerPolicy = 'no-referrer';
      link.textContent = 'Open preview in a new tab';
      link.style.cssText = 'display:inline-block;background:#1f3261;color:white;padding:12px 18px;border-radius:8px;font-weight:600;text-decoration:none';
      card.append(link);
    }
  } else {
    const retry = documentObject.createElement('button');
    retry.type = 'button';
    retry.textContent = 'Reload securely';
    retry.style.cssText = 'background:#1f3261;color:white;padding:12px 18px;border:0;border-radius:8px;font:inherit;font-weight:600;cursor:pointer';
    retry.addEventListener('click', () => locationObject.reload());
    const detail = documentObject.createElement('p');
    detail.textContent = `Support code: ${reason}`;
    detail.style.cssText = 'font-size:12px;color:#475569;margin:16px 0 0';
    card.append(retry, detail);
  }
  shell.append(card);
  root.replaceChildren(shell);
  documentObject.title = embedded
    ? 'Secure preview | PennSync by CareMetric'
    : assetFailure ? 'App loading error | PennSync by CareMetric'
      : 'Browser privacy check | PennSync by CareMetric';
}
