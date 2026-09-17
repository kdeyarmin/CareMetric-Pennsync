import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '@/test/axeHelpers';
import ProviderCsvImport from './ProviderCsvImport';

const { imported, toast, gate, coreUpload } = vi.hoisted(() => ({
  imported: vi.fn(), toast: { success: vi.fn(), error: vi.fn() },
  gate: { capture: vi.fn(), assert: vi.fn(), current: true }, coreUpload: vi.fn(),
}));
vi.mock('@/functions/importProvidersCsv', () => ({ importProvidersCsv: imported }));
vi.mock('@/lib/tenantSdkRealmGate', () => ({ captureTenantSdkRealmLease: gate.capture, assertTenantSdkRealmLeaseCurrent: gate.assert }));
vi.mock('@/api/base44Client', () => ({ base44: { integrations: { Core: { UploadFile: coreUpload } } } }));
vi.mock('sonner', () => ({ toast }));
const fixture = 'physician_name,fax_number\n"Smith, Jane",8145550123';
const result = { success: true, created_providers: 1, updated_providers: 0, skipped_rows: 0 };
function file(text = fixture, name = 'providers.csv') {
  const value = new File([text], name, { type: 'text/csv' });
  Object.defineProperty(value, 'arrayBuffer', { value: vi.fn(async () => new TextEncoder().encode(text).buffer) });
  return value;
}
const select = value => fireEvent.change(screen.getByLabelText('Provider CSV file'), { target: { files: [value] } });
const deferred = () => {
  let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve };
};
beforeEach(() => {
  vi.clearAllMocks(); gate.current = true;
  gate.capture.mockImplementation(() => { if (!gate.current) throw new Error('closed'); return 'lease'; });
  gate.assert.mockImplementation(() => { if (!gate.current) throw new Error('closed'); });
  imported.mockResolvedValue({ data: result });
});

describe('direct provider CSV import', () => {
  it('sends CSV text to the authorized parser without a storage integration', async () => {
    const callback = vi.fn(); render(<ProviderCsvImport onImported={callback} />); const csv = file(); select(csv);
    await waitFor(() => expect(callback).toHaveBeenCalledWith(result));
    expect(imported).toHaveBeenCalledExactlyOnceWith({ csv_text: fixture });
    expect(csv.arrayBuffer).toHaveBeenCalledOnce(); expect(coreUpload).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('Imported 1 providers');
    expect(screen.getByRole('button', { name: 'Import Provider CSV' })).toBeEnabled();
  });
  it('retains the 10 MB input cap before reading or invoking the importer', async () => {
    render(<ProviderCsvImport />); const csv = file(); Object.defineProperty(csv, 'size', { value: 10 * 1024 * 1024 + 1 }); select(csv);
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(csv.arrayBuffer).not.toHaveBeenCalled(); expect(imported).not.toHaveBeenCalled(); expect(coreUpload).not.toHaveBeenCalled();
  });
  it('invalid extensions fail before any integration', async () => {
    render(<ProviderCsvImport />); const csv = file(fixture, 'providers.exe'); select(csv);
    expect(toast.error).toHaveBeenCalled(); expect(csv.arrayBuffer).not.toHaveBeenCalled(); expect(imported).not.toHaveBeenCalled();
  });
  it('does not silently replace invalid UTF-8 or upload it through a fallback', async () => {
    render(<ProviderCsvImport />); const csv = new File([new Uint8Array([0xff, 0xfe])], 'providers.csv', { type: 'text/csv' });
    Object.defineProperty(csv, 'arrayBuffer', { value: async () => new Uint8Array([0xff, 0xfe]).buffer }); select(csv);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('The CSV could not be read. Re-export it as UTF-8 and try again.'));
    expect(imported).not.toHaveBeenCalled(); expect(coreUpload).not.toHaveBeenCalled();
  });
  it('only sends one mutation while a prior import is running', async () => {
    const finish = deferred(); imported.mockReturnValue(finish.promise);
    render(<ProviderCsvImport />); select(file());
    await waitFor(() => expect(imported).toHaveBeenCalledOnce());
    expect(screen.getByLabelText('Provider CSV file')).toBeDisabled(); select(file());
    await act(async () => { finish.resolve({ data: result }); await finish.promise; });
    expect(imported).toHaveBeenCalledOnce(); expect(coreUpload).not.toHaveBeenCalled();
  });
  it('withholds read results if the user switches workspace before the file finishes loading', async () => {
    const finish = deferred(); const csv = file(); csv.arrayBuffer.mockReturnValue(finish.promise);
    render(<ProviderCsvImport />); select(csv); gate.current = false;
    await act(async () => { finish.resolve(new TextEncoder().encode(fixture).buffer); await finish.promise; });
    expect(imported).not.toHaveBeenCalled(); expect(toast.success).not.toHaveBeenCalled(); expect(toast.error).not.toHaveBeenCalled();
  });
  it('does not submit data read after the component unmounts', async () => {
    const finish = deferred(); const csv = file(); csv.arrayBuffer.mockReturnValue(finish.promise);
    const view = render(<ProviderCsvImport />); select(csv); view.unmount();
    await act(async () => { finish.resolve(new TextEncoder().encode(fixture).buffer); await finish.promise; });
    expect(imported).not.toHaveBeenCalled(); expect(coreUpload).not.toHaveBeenCalled();
  });
  it('does not show success or invoke callbacks after a late response for a revoked workspace', async () => {
    const finish = deferred(); imported.mockReturnValue(finish.promise); const callback = vi.fn();
    render(<ProviderCsvImport onImported={callback} />); select(file()); await waitFor(() => expect(imported).toHaveBeenCalledOnce());
    gate.current = false;
    await act(async () => { finish.resolve({ data: result }); await finish.promise; });
    expect(callback).not.toHaveBeenCalled(); expect(toast.success).not.toHaveBeenCalled(); expect(toast.error).not.toHaveBeenCalled();
  });
  it('an uncertain save tells the user to reconcile instead of retrying through paid storage', async () => {
    imported.mockRejectedValue(new Error('internal provider detail')); const callback = vi.fn();
    render(<ProviderCsvImport onImported={callback} />); select(file());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Import was not fully confirmed. Refresh the provider directory before retrying.'));
    expect(imported).toHaveBeenCalledOnce(); expect(coreUpload).not.toHaveBeenCalled(); expect(callback).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
  it.each([{ success: false }, { ...result, created_providers: -1 }, { ...result, updated_providers: '1' }])('rejects incomplete result metadata %j', async metadata => {
    imported.mockResolvedValue({ data: metadata }); const callback = vi.fn();
    render(<ProviderCsvImport onImported={callback} />); select(file());
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(callback).not.toHaveBeenCalled(); expect(toast.success).not.toHaveBeenCalled();
  });
  it('has a labeled file picker and no serious accessibility violations', async () => {
    const { container } = render(<ProviderCsvImport />);
    await expectNoAxeViolations(container);
  });
});
