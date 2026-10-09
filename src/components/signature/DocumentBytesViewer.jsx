import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

const MAX_RENDERED_PAGES = 40;

function detectDocumentKind(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 8) return null;
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'pdf';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  return null;
}

let pdfjsPromise = null;
function loadPdfjs() {
  // The parser runs from the app's own bundle on the main thread (pdf.js
  // uses globalThis.pdfjsWorker instead of spawning a worker script), so no
  // third-party or unminified script is loaded on a page that shows clinical
  // documents. Both modules load only when a PDF is actually shown.
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

function PdfPages({ bytes, title }) {
  const containerRef = useRef(null);
  const [state, setState] = useState({ status: 'loading', pages: 0, truncated: false });

  useEffect(() => {
    let cancelled = false;
    let task = null;
    const container = containerRef.current;
    if (!container) return undefined;
    container.replaceChildren();
    setState({ status: 'loading', pages: 0, truncated: false });
    loadPdfjs()
      .then(async (pdfjs) => {
        // pdf.js may transfer the buffer to its worker; hand it a copy.
        task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, disableAutoFetch: true });
        const pdf = await task.promise;
        const count = Math.min(pdf.numPages, MAX_RENDERED_PAGES);
        const width = Math.max(320, Math.min(container.clientWidth || 800, 1000));
        for (let number = 1; number <= count; number += 1) {
          if (cancelled) return;
          const page = await pdf.getPage(number);
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: (width / base.width) * (window.devicePixelRatio || 1) });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.width = '100%';
          canvas.className = 'block border border-slate-200 bg-white shadow-sm';
          canvas.setAttribute('role', 'img');
          canvas.setAttribute('aria-label', `${title} — page ${number} of ${pdf.numPages}`);
          container.appendChild(canvas);
          await page.render({ canvasContext: canvas.getContext('2d'), viewport, canvas }).promise;
        }
        if (!cancelled) setState({ status: 'ready', pages: pdf.numPages, truncated: pdf.numPages > count });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error', pages: 0, truncated: false });
      });
    return () => {
      cancelled = true;
      task?.destroy?.();
    };
  }, [bytes, title]);

  return (
    <div>
      {state.status === 'loading' && (
        <div className="flex items-center gap-2 py-6 text-sm text-slate-600" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Rendering document…
        </div>
      )}
      {state.status === 'error' && (
        <p className="py-4 text-sm text-red-700" role="alert">This document could not be displayed.</p>
      )}
      <div ref={containerRef} className="space-y-3" />
      {state.truncated && (
        <p className="mt-2 text-xs text-slate-600">
          Showing the first {MAX_RENDERED_PAGES} of {state.pages} pages.
        </p>
      )}
    </div>
  );
}

function ImagePage({ bytes, kind, title }) {
  const url = useMemo(() => URL.createObjectURL(new Blob([bytes], { type: kind })), [bytes, kind]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return <img src={url} alt={title} className="w-full border border-slate-200 bg-white" />;
}

/**
 * Show PDF or image bytes the caller already holds (a signer's reviewed copy or
 * a staff preview). Nothing here fetches, uploads or opens a window.
 */
export default function DocumentBytesViewer({ bytes, title = 'Document' }) {
  const kind = detectDocumentKind(bytes);
  if (!kind) {
    return <p className="text-sm text-red-700" role="alert">This file type cannot be displayed.</p>;
  }
  return (
    <div className="max-h-[70vh] overflow-y-auto rounded-md bg-slate-100 p-2" tabIndex={0} aria-label={title}>
      {kind === 'pdf'
        ? <PdfPages bytes={bytes} title={title} />
        : <ImagePage bytes={bytes} kind={kind} title={title} />}
    </div>
  );
}
