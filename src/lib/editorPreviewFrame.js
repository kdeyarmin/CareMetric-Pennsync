/**
 * Which parent frames may load the app.
 *
 * The owner decided on 2026-10-08 that the app may run inside the Base44
 * editor's preview panel. That decision names one parent, so it is read as
 * permission for that parent, not for every site on the web: an arbitrary
 * page framing the app would get a live clinical DOM and an origin that can
 * make API calls, which `e2e/secure-preview.spec.js` asserts must not happen.
 * Any other parent still gets the "Open a secure preview" notice.
 *
 * The parent is identified from `location.ancestorOrigins` (Chromium and
 * WebKit), which lists every ancestor and cannot be set by the page. Where a
 * browser does not provide it, the frame's referrer origin stands in, and an
 * absent or unparseable answer refuses.
 */

const EDITOR_HOST_SUFFIXES = Object.freeze(['base44.com', 'base44.app']);

export function isEditorPreviewOrigin(origin) {
  let url;
  try {
    url = new URL(String(origin || ''));
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  return EDITOR_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

/**
 * True when every ancestor of this frame is a Base44 editor origin. Pass the
 * frame's `location` and `document.referrer`.
 */
export function isTrustedEditorPreviewFrame(location, referrer) {
  const ancestors = location?.ancestorOrigins;
  if (ancestors && typeof ancestors.length === 'number') {
    if (ancestors.length === 0) return false;
    for (let index = 0; index < ancestors.length; index += 1) {
      if (!isEditorPreviewOrigin(ancestors[index])) return false;
    }
    return true;
  }
  return isEditorPreviewOrigin(referrer);
}
