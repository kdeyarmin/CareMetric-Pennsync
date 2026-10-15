import { describe, it, expect, vi } from 'vitest';
import { jsPDF } from 'jspdf';
import {
  describePdfTextError,
  extractPdfText,
  isPdfFile,
  textItemsToString,
} from './referralPdfText';

// The app bundle loads the modern pdf.js build, which needs browser APIs Node
// lacks; the legacy build is the same parser for Node, so a real PDF goes
// through real text extraction here.
let legacyPdfjs = null;
const loadLegacyPdfjs = async () => {
  if (!legacyPdfjs) {
    const [pdfjs, worker] = await Promise.all([
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      import('pdfjs-dist/legacy/build/pdf.worker.mjs'),
    ]);
    globalThis.pdfjsWorker ||= worker;
    pdfjs.GlobalWorkerOptions.workerSrc ||= 'pdf.worker.mjs';
    legacyPdfjs = pdfjs;
  }
  return legacyPdfjs;
};

const pdfFile = (doc, name = 'packet.pdf') =>
  new File([doc.output('arraybuffer')], name, { type: 'application/pdf' });

// A stand-in for pdf.js whose pages carry the given text items, so the budget
// and counting rules can be checked page by page.
function fakePdfjs(pageItems) {
  const destroy = vi.fn(async () => {});
  return {
    destroy,
    load: async () => ({
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: pageItems.length,
          getPage: async (number) => ({
            getTextContent: async () => ({ items: pageItems[number - 1] }),
            cleanup: () => {},
          }),
        }),
        destroy,
      }),
    }),
  };
}
const fakeFile = { arrayBuffer: async () => new ArrayBuffer(8) };
const line = (str) => [{ str, hasEOL: false }];

describe('textItemsToString', () => {
  it('breaks lines where pdf.js marks an end of line and skips marked content', () => {
    const items = [
      { str: 'Patient: Jane Doe', hasEOL: true },
      { type: 'beginMarkedContent' },
      { str: 'Dx: CHF  ', hasEOL: true },
      { str: 'SN 3x/wk', hasEOL: false },
    ];
    expect(textItemsToString(items)).toBe('Patient: Jane Doe\nDx: CHF\nSN 3x/wk');
  });

  it('replaces control characters the AI call would refuse, keeping tabs and newlines', () => {
    const text = textItemsToString([{ str: 'A\u0000B\u000CC\tD', hasEOL: true }, { str: 'E', hasEOL: false }]);
    expect(text).toBe('A B C\tD\nE');
  });

  it('is empty for a page with no text layer', () => {
    expect(textItemsToString([])).toBe('');
    expect(textItemsToString([{ str: '  ', hasEOL: true }])).toBe('');
  });
});

describe('isPdfFile', () => {
  it('accepts a PDF by type or by extension', () => {
    expect(isPdfFile({ name: 'a.bin', type: 'application/pdf' })).toBe(true);
    expect(isPdfFile({ name: 'Packet.PDF', type: '' })).toBe(true);
    expect(isPdfFile({ name: 'notes.txt', type: 'text/plain' })).toBe(false);
    expect(isPdfFile(undefined)).toBe(false);
  });
});

describe('extractPdfText with a real PDF', () => {
  it('reads every page in order and counts a page with no text layer', async () => {
    const doc = new jsPDF();
    doc.text('Patient: Jane Doe  DOB 05/01/1950', 10, 10);
    doc.text('Dx: CHF exacerbation', 10, 20);
    doc.addPage();
    doc.rect(10, 10, 50, 50, 'F'); // stands in for a scanned page: marks, no text
    doc.addPage();
    doc.text('Orders: SN 3x/wk x 4 wks', 10, 10);

    const result = await extractPdfText(pdfFile(doc), { loadPdf: loadLegacyPdfjs });

    expect(result).toMatchObject({ pageCount: 3, emptyPages: 1, unreadPages: 0 });
    expect(result.text).toMatch(/Patient: Jane Doe\s+DOB 05\/01\/1950\nDx: CHF exacerbation/);
    expect(result.text.indexOf('Jane Doe')).toBeLessThan(result.text.indexOf('Orders: SN 3x/wk'));
  });

  it('answers empty text for a packet with no text layer at all', async () => {
    const doc = new jsPDF();
    doc.rect(10, 10, 50, 50, 'F');
    const result = await extractPdfText(pdfFile(doc), { loadPdf: loadLegacyPdfjs });
    expect(result).toEqual({ text: '', pageCount: 1, emptyPages: 1, unreadPages: 0 });
  });

  it("rejects with pdf.js's own error for a file that is not a PDF", async () => {
    const file = new File(['not a pdf'], 'fake.pdf', { type: 'application/pdf' });
    const error = await extractPdfText(file, { loadPdf: loadLegacyPdfjs }).catch((e) => e);
    expect(error?.name).toBe('InvalidPDFException');
    expect(describePdfTextError(error)).toMatch(/could not be opened as a PDF/);
  });
});

describe('extractPdfText limits', () => {
  it('stops at the first page that would pass the character budget and reports the rest unread', async () => {
    const pdfjs = fakePdfjs([line('a'.repeat(40)), line('b'.repeat(40)), line('c'.repeat(40))]);
    const result = await extractPdfText(fakeFile, { loadPdf: pdfjs.load, maxChars: 100 });
    // 40 + 2 (separator) + 40 fits; a third page would make 124.
    expect(result.text).toBe(`${'a'.repeat(40)}\n\n${'b'.repeat(40)}`);
    expect(result).toMatchObject({ pageCount: 3, emptyPages: 0, unreadPages: 1 });
    expect(pdfjs.destroy).toHaveBeenCalled();
  });

  it('cuts a first page longer than the whole budget instead of dropping it', async () => {
    const pdfjs = fakePdfjs([line('x'.repeat(250)), line('y')]);
    const result = await extractPdfText(fakeFile, { loadPdf: pdfjs.load, maxChars: 100 });
    expect(result.text).toBe('x'.repeat(100));
    expect(result).toMatchObject({ pageCount: 2, unreadPages: 1 });
  });

  it('reads no further than the page cap', async () => {
    const pdfjs = fakePdfjs([line('one'), [], line('three'), line('four')]);
    const result = await extractPdfText(fakeFile, { loadPdf: pdfjs.load, maxPages: 2 });
    expect(result).toEqual({ text: 'one', pageCount: 4, emptyPages: 1, unreadPages: 2 });
  });
});

describe('describePdfTextError', () => {
  it('names a password-protected PDF and falls back to a general message', () => {
    expect(describePdfTextError({ name: 'PasswordException' })).toMatch(/password-protected/);
    expect(describePdfTextError(new Error('boom'))).toMatch(/Could not read this PDF/);
  });
});
