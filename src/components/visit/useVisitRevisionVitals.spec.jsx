import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useVisitRevisionVitals } from './useVisitRevisionVitals';

const initial = {
  authorityKey: 'actor-a|membership-a-v7|visit-a|patient-a', ready: true,
  visit: { updated_date: '2026-09-17T15:30:00.000Z', vital_signs: { heart_rate: 73, pain_level: 0, weight: 147.5 } },
};
const newer = (vitalSigns) => ({ ...initial, visit: {
  updated_date: '2026-09-17T15:32:00.000Z', vital_signs: vitalSigns,
} });

describe('bound Visit vital revision lifecycle', () => {
  it('retains newer local edits during a confirmed write and admits only its exact normalized server snapshot', () => {
    const { result, rerender } = renderHook(useVisitRevisionVitals, { initialProps: initial });
    act(() => result.current.change({ heart_rate: 81, pain_level: null }));
    const written = result.current.values;
    const complete = result.current.markWritten;
    act(() => result.current.change({ heart_rate: 84 }));
    act(() => complete(written, true));
    expect(result.current.dirty).toBe(true);
    expect(result.current.values).toEqual({ heart_rate: 84, pain_level: null, weight: 147.5 });
    rerender(newer({ heart_rate: 81, weight: 147.5 }));
    expect(result.current.conflict).toBe(false);
    rerender(newer({ heart_rate: 81, weight: 160 }));
    expect(result.current.conflict).toBe(true);
    expect(result.current.values.weight).toBe(147.5);
  });

  it.each([false, true])('distinguishes unknown documentation from confirmed documentation with pending support: confirmed=%s', (documentationConfirmed) => {
    const { result, rerender } = renderHook(useVisitRevisionVitals, { initialProps: initial });
    act(() => result.current.change({ heart_rate: 81, pain_level: null }));
    act(() => result.current.markWritten(result.current.values, false, documentationConfirmed));
    rerender(newer({ heart_rate: 81, weight: 147.5 }));
    expect(result.current.conflict).toBe(!documentationConfirmed);
    expect(result.current.dirty).toBe(true);
    expect(result.current.values).toEqual({ heart_rate: 81, pain_level: null, weight: 147.5 });
    rerender(newer({ heart_rate: 81, weight: 160 }));
    expect(result.current.conflict).toBe(true);
  });

  it('withholds pending authority, rejects a stale editing callback, and discards edits on another binding', () => {
    const { result, rerender } = renderHook(useVisitRevisionVitals, { initialProps: initial });
    act(() => result.current.change({ heart_rate: 81 }));
    const staleChange = result.current.change;
    const lateWrite = result.current.markWritten;
    const oldValues = result.current.values;
    rerender({ ...initial, ready: false, visit: undefined });
    expect(result.current.values).toEqual({});
    act(() => staleChange({ heart_rate: 99 }));
    rerender(initial);
    expect(result.current.values.heart_rate).toBe(81);
    rerender({ ...initial, authorityKey: 'actor-b|membership-b-v1|visit-b|patient-b',
      visit: { ...initial.visit, vital_signs: { heart_rate: 62 } } });
    act(() => lateWrite(oldValues, true));
    expect(result.current.values).toEqual({ heart_rate: 62 });
    expect(result.current.dirty).toBe(false);
  });

  it('keeps an explicit clear through old-source rechecks and conflicts instead of restoring a newer baseline', () => {
    const { result, rerender } = renderHook(useVisitRevisionVitals, { initialProps: initial });
    act(() => result.current.clear());
    rerender({ ...initial, ready: false, visit: undefined });
    rerender(initial);
    expect(result.current.values).toEqual({});
    expect(result.current.dirty).toBe(true);
    rerender(newer({ heart_rate: 99, weight: 160 }));
    expect(result.current.values).toEqual({});
    expect(result.current.conflict).toBe(true);
  });
});
