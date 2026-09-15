import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useCsvImportPreview } from './useCsvImportPreview';

const csv = (name = 'rates.csv', text = async () => 'rows') => ({ name, type: 'text/csv', size: 4, text });
const parse = (text) => ({ ok: true, rows: [text] });
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

describe('CSV import preview lifecycle', () => {
  it('commits matching filename and parsed rows together', async () => {
    const { result } = renderHook(useCsvImportPreview);
    await act(async () => { await result.current.readFile(csv('new.csv'), parse); });
    expect(result.current.preview).toEqual({ fileName: 'new.csv', result: { ok: true, rows: ['rows'] } });
    expect(result.current.isReading).toBe(false);
  });

  it('clears an old valid preview immediately while reading another file', async () => {
    const { result } = renderHook(useCsvImportPreview);
    act(() => result.current.replacePreview({ fileName: 'old.csv', result: parse('old') }));
    const next = deferred();
    let pending;
    act(() => { pending = result.current.readFile(csv('new.csv', () => next.promise), parse); });
    expect(result.current.preview).toBeNull();
    expect(result.current.isReading).toBe(true);
    await act(async () => { next.resolve('new'); await pending; });
    expect(result.current.preview.fileName).toBe('new.csv');
  });

  it('a slower earlier file cannot overwrite a newer selection', async () => {
    const { result } = renderHook(useCsvImportPreview);
    const slow = deferred();
    let pending;
    act(() => { pending = result.current.readFile(csv('old.csv', () => slow.promise), parse); });
    await act(async () => { await result.current.readFile(csv('new.csv', async () => 'new'), parse); });
    await act(async () => { slow.resolve('old'); expect((await pending).status).toBe('superseded'); });
    expect(result.current.preview).toEqual({ fileName: 'new.csv', result: parse('new') });
  });

  it('bundled data supersedes a pending file read', async () => {
    const { result } = renderHook(useCsvImportPreview);
    const slow = deferred();
    let pending;
    act(() => { pending = result.current.readFile(csv('old.csv', () => slow.promise), parse); });
    act(() => result.current.replacePreview({ fileName: 'bundled', result: parse('official') }));
    await act(async () => { slow.resolve('old'); await pending; });
    expect(result.current.preview.fileName).toBe('bundled');
    expect(result.current.isReading).toBe(false);
  });

  it('read failures leave no old preview and return only a safe message', async () => {
    const { result } = renderHook(useCsvImportPreview);
    act(() => result.current.replacePreview({ fileName: 'old.csv', result: parse('old') }));
    let outcome;
    await act(async () => {
      outcome = await result.current.readFile(csv('bad.csv', async () => { throw new Error('PRIVATE_TEST_DETAIL'); }), parse);
    });
    expect(outcome.status).toBe('error');
    expect(outcome.message).not.toContain('PRIVATE_TEST_DETAIL');
    expect(result.current.preview).toBeNull();
    expect(result.current.isReading).toBe(false);
  });

  it('parser failures are caught without retaining a prior table', async () => {
    const { result } = renderHook(useCsvImportPreview);
    await act(async () => {
      const outcome = await result.current.readFile(csv(), () => { throw new Error('bad'); });
      expect(outcome.status).toBe('error');
    });
    expect(result.current.preview).toBeNull();
  });

  it.each([
    { name: 'rates.xlsx' }, { type: 'application/pdf' }, { size: 10 * 1024 * 1024 + 1 },
    { size: -1 }, { size: Number.NaN }, { text: undefined },
  ])('rejects invalid files without reading or preserving an old preview: %j', async (overrides) => {
    const { result } = renderHook(useCsvImportPreview);
    const reader = vi.fn(async () => 'rows');
    act(() => result.current.replacePreview({ fileName: 'old.csv', result: parse('old') }));
    await act(async () => {
      expect((await result.current.readFile({ ...csv('rates.csv', reader), ...overrides }, parse)).status).toBe('error');
    });
    expect(reader).not.toHaveBeenCalled();
    expect(result.current.preview).toBeNull();
  });

  it('unmount invalidates an outstanding read before parsing or updating', async () => {
    const { result, unmount } = renderHook(useCsvImportPreview);
    const slow = deferred();
    const parser = vi.fn(parse);
    let pending;
    act(() => { pending = result.current.readFile(csv('old.csv', () => slow.promise), parser); });
    unmount();
    slow.resolve('late');
    expect((await pending).status).toBe('superseded');
    expect(parser).not.toHaveBeenCalled();
  });

  it('a cancelled picker keeps the existing preview', async () => {
    const { result } = renderHook(useCsvImportPreview);
    act(() => result.current.replacePreview({ fileName: 'kept.csv', result: parse('kept') }));
    await act(async () => { expect((await result.current.readFile(null, parse)).status).toBe('cancelled'); });
    expect(result.current.preview.fileName).toBe('kept.csv');
  });
});
