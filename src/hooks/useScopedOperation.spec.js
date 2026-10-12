import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import useScopedOperation from './useScopedOperation';
describe('record-scoped continuations', () => {
  it('blocks overlapping operations and retires completed tokens', () => {
    const { result } = renderHook(() => useScopedOperation('A'));
    const token = result.current.begin();
    expect(result.current.begin()).toBeNull();
    expect(result.current.isCurrent(token)).toBe(true);
    result.current.finish(token);
    expect(result.current.isCurrent(token)).toBe(false);
    const next = result.current.begin();
    result.current.finish(token);
    expect(result.current.isCurrent(next)).toBe(true);
  });
  it('does not revive a token when returning to the previous patient', () => {
    const { result, rerender } = renderHook(({ id }) => useScopedOperation(id), { initialProps: { id: 'A' } });
    const token = result.current.begin();
    act(() => rerender({ id: 'B' }));
    act(() => rerender({ id: 'A' }));
    expect(result.current.isCurrent(token)).toBe(false);
    expect(result.current.begin()).not.toBeNull();
  });
  it('retires operations on unmount', () => {
    const { result, unmount } = renderHook(() => useScopedOperation('A'));
    const token = result.current.begin();
    unmount();
    expect(result.current.isCurrent(token)).toBe(false);
  });
});