import { describe, expect, it } from 'vitest';
import { formatVideoDuration, readGenerationResult, readVideoStatus } from './videoStudioResults';

const moduleRecord = { module_id: 'synthetic-module', title: 'Synthetic', video_status: 'none' };
describe('training video response contracts', () => {
  it('accepts both SDK-wrapped and direct status responses', () => {
    const result = { heygen_configured: true, modules: [moduleRecord] };
    expect(readVideoStatus(result)).toBe(result); expect(readVideoStatus({ data: result })).toBe(result);
    expect(readVideoStatus({ heygen_configured: false, modules: [] }).modules).toEqual([]);
  });
  it.each([null, {}, { success: false }, { error: 'PRIVATE_DETAIL' }, { heygen_configured: 'true', modules: [] },
    { heygen_configured: true, modules: [null] }, { heygen_configured: true, modules: [{}] }])('rejects unverified status without repeating private error text', value => {
    expect(() => readVideoStatus(value)).toThrow(/Training video/);
    try { readVideoStatus(value); } catch (error) { expect(error.message).not.toContain('PRIVATE_DETAIL'); }
  });
  it.each([-1, 0.5, '1', null, undefined, Number.NaN, 2])('does not confirm an invalid started count %s', started => {
    expect(() => readGenerationResult({ started, modules: [moduleRecord] })).toThrow();
  });
  it('retains zero and partial counts as facts rather than claiming all lessons started', () => {
    expect(readGenerationResult({ started: 0, modules: [] }).started).toBe(0);
    expect(readGenerationResult({ data: { started: 1, modules: [moduleRecord, { ...moduleRecord, module_id: 'b' }] } }).started).toBe(1);
  });
});
describe('video duration display', () => {
  it.each([[0, '0:00'], [0.3, '0:00'], [59.7, '1:00'], [119.7, '2:00'], [3600, '60:00'], ['90', '1:30']])('formats %s as %s without a :60 seconds rollover', (input, expected) => {
    expect(formatVideoDuration(input)).toBe(expected);
  });
  it.each([null, undefined, '', ' ', 'unknown', {}, true, -1, Infinity, NaN])('does not display invalid duration %s', value => {
    expect(formatVideoDuration(value)).toBeNull();
  });
});
