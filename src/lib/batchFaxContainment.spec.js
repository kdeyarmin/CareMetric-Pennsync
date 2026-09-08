import { readFileSync } from 'node:fs';
import process from 'node:process';
import { describe, expect, it } from 'vitest';

const read = (file) => readFileSync(`${process.cwd()}/${file}`, 'utf8');

describe('batch fax source containment', () => {
  it('keeps the routed tab explicit while collecting no clinical files', () => {
    const page = read('src/pages/SendFax.jsx');
    const sender = read('src/components/fax/BatchFaxSender.jsx');

    expect(page).toContain('<BatchFaxSender prefilledData={prefilledData} />');
    expect(sender).toMatch(/Batch fax unavailable/);
    expect(sender).not.toMatch(/type=["']file["']|FileReader|UploadFile|mergePDFs|sendFax/);
  });
});
