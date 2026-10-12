import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ lines: [], pages: 1, text: vi.fn(), download: vi.fn() }));
vi.mock('jspdf', () => ({ jsPDF: class {
  constructor() { this.internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 }, getNumberOfPages: () => mocks.pages }; }
  setFontSize() {} setFont() {} setTextColor() {} setDrawColor() {} line() {} setPage() {}
  splitTextToSize() { return mocks.lines; }
  text(...args) { mocks.text(...args); }
  addPage() { mocks.pages += 1; }
  output() { return new Blob(['test'], { type: 'application/pdf' }); }
} }));
vi.mock('html2canvas', () => ({ default: vi.fn() }));
vi.mock('@/lib/tenantSdkRealmGate', () => ({ isTenantSdkRealmOpen: () => true }));
vi.mock('@/lib/downloadBlob', () => ({ downloadAuthorityBoundBlob: mocks.download }));
import { exportToPDF } from './pdfExporter';
beforeEach(() => { mocks.pages = 1; mocks.text.mockClear(); mocks.download.mockReset().mockResolvedValue(true); });
describe('clinical narrative PDF pagination', () => {
  it('keeps every line within page bounds without dropping long notes', async () => {
    mocks.lines = Array.from({ length: 140 }, (_, index) => `Clinical line ${index}: SpO2 <90%`);
    await exportToPDF({ content: [{ type: 'text', text: 'Long note' }] });
    const chunks = mocks.text.mock.calls.filter(([text]) => Array.isArray(text));
    expect(chunks.flatMap(([lines]) => lines)).toEqual(mocks.lines);
    expect(mocks.pages).toBeGreaterThan(1);
    for (const [lines, , top] of chunks) expect(top + lines.length * 5).toBeLessThanOrEqual(272);
    expect(mocks.download).toHaveBeenCalledTimes(1);
  });
  it('keeps a short note on one page', async () => {
    mocks.lines = ['Short clinical note'];
    await exportToPDF({ content: [{ type: 'text', text: 'Short note' }] });
    expect(mocks.pages).toBe(1);
  });
});