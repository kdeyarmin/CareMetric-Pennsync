/**
 * Reading the text layer of a referral packet PDF in the browser, for the
 * triage panel.
 *
 * Triage analyzes text, and `file.text()` on a PDF is binary mojibake. pdf.js
 * reads the text a digitally produced PDF carries (an EHR export, an e-fax)
 * without the document leaving the browser: no upload, no extra model call
 * and no new backend capability, so the panel's one triage call is unchanged.
 *
 * A scanned packet is page images with no text layer. Those pages come back
 * empty and are COUNTED rather than skipped silently, and so are pages left
 * out because the packet is too long — so the panel can say a packet was read
 * only in part instead of triaging half a referral as if it were the whole.
 */

/** Same ceiling Referral Intake states for an uploaded referral. */
export const PDF_TEXT_MAX_BYTES = 25 * 1024 * 1024;

/** Pages past this are not read; they are reported as unread. */
export const PDF_TEXT_MAX_PAGES = 100;

/**
 * The most packet text one triage call can carry. Both AI paths refuse a
 * prompt over 100,000 characters (`directInvokeLLM` in the Base44 function and
 * the integration runtime's `ai()`), and the triage prompt wraps the packet in
 * about 1,500 characters of its own, so this leaves headroom for that.
 */
export const PDF_TEXT_MAX_CHARS = 90_000;

export function isPdfFile(file) {
  const name = String(file?.name || '').toLowerCase();
  return file?.type === 'application/pdf' || name.endsWith('.pdf');
}

let pdfjsPromise = null;
function loadPdfjs() {
  // Same loading as the signing viewer (DocumentBytesViewer): the parser runs
  // from the app's own bundle on the main thread (pdf.js uses
  // globalThis.pdfjsWorker instead of spawning a worker script), so no
  // third-party script is loaded on a page that handles a referral, and
  // neither module loads until a PDF is actually picked.
  pdfjsPromise ||= Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs'),
  ]).then(([pdfjs, worker]) => {
    globalThis.pdfjsWorker ||= worker;
    return pdfjs;
  }).catch((error) => {
    pdfjsPromise = null;
    throw error;
  });
  return pdfjsPromise;
}

// Both AI paths refuse the whole prompt over a single control character other
// than tab, LF and CR, and PDF text layers carry them (form feeds, NULs).
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

/**
 * One page's text items as lines. pdf.js marks where the document ends a line
 * with `hasEOL`; marked-content items carry no `str` and are skipped.
 */
export function textItemsToString(items = []) {
  let text = '';
  for (const item of items) {
    if (typeof item?.str !== 'string') continue;
    text += item.str;
    if (item.hasEOL) text += '\n';
  }
  return text.replace(CONTROL_CHARACTERS, ' ').replace(/[ \t]+\n/g, '\n').trim();
}

const PAGE_SEPARATOR = '\n\n';

/**
 * The packet's text, page by page in order, plus the counts the caller needs
 * to tell a complete read from a partial one.
 *
 * Resolves `{ text, pageCount, emptyPages, unreadPages, cutPage }`:
 * - `emptyPages` — pages with no text layer (scanned images);
 * - `unreadPages` — pages left out because the packet passed `maxPages` or
 *   `maxChars`. Reading stops at the first page that does not fit, so what is
 *   sent is always the packet's opening pages and never a gap in the middle;
 * - `cutPage` — the number of a page whose end was cut off to fit `maxChars`,
 *   or null. Only the first page carrying text can be cut, and only when it
 *   alone is longer than the whole budget.
 * `text` is '' when no page read carried text. Rejects with pdf.js's own error
 * for a file it cannot open, which {@link describePdfTextError} turns into
 * words.
 */
export async function extractPdfText(file, {
  loadPdf = loadPdfjs,
  maxPages = PDF_TEXT_MAX_PAGES,
  maxChars = PDF_TEXT_MAX_CHARS,
} = {}) {
  const pdfjs = await loadPdf();
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data, isEvalSupported: false, disableAutoFetch: true });
  try {
    const pdf = await task.promise;
    const pageCount = pdf.numPages;
    let text = '';
    let emptyPages = 0;
    let pagesDone = 0;
    let cutPage = null;
    for (let number = 1; number <= Math.min(pageCount, maxPages); number += 1) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      page.cleanup?.();
      const pageText = textItemsToString(content.items);
      if (!pageText) {
        emptyPages += 1;
      } else {
        const next = text ? text + PAGE_SEPARATOR + pageText : pageText;
        if (next.length > maxChars) {
          // A first page longer than the whole budget is cut rather than
          // dropped, so a one-page dump still gets triaged — and reported as
          // cut, because the counts alone would read as a complete page.
          if (!text) {
            text = pageText.slice(0, maxChars);
            cutPage = number;
            pagesDone += 1;
          }
          break;
        }
        text = next;
      }
      pagesDone += 1;
    }
    return { text, pageCount, emptyPages, unreadPages: pageCount - pagesDone, cutPage };
  } finally {
    await task.destroy?.();
  }
}

/** What to tell the person when a PDF could not be opened at all. */
export function describePdfTextError(error) {
  if (error?.name === 'PasswordException') {
    return 'This PDF is password-protected. Remove the password and upload it again.';
  }
  if (error?.name === 'InvalidPDFException') {
    return 'This file could not be opened as a PDF. It may be damaged — try exporting or scanning it again.';
  }
  return 'Could not read this PDF. Try uploading it again, or use Referral Intake to extract from it.';
}
