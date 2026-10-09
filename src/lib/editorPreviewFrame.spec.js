import { describe, expect, it } from 'vitest';
import { isEditorPreviewOrigin, isTrustedEditorPreviewFrame } from './editorPreviewFrame';

const ancestors = (...origins) => ({ ancestorOrigins: Object.assign([...origins], { length: origins.length }) });

describe('isEditorPreviewOrigin', () => {
  it('admits the Base44 editor and preview hosts over https', () => {
    expect(isEditorPreviewOrigin('https://app.base44.com')).toBe(true);
    expect(isEditorPreviewOrigin('https://base44.com')).toBe(true);
    expect(isEditorPreviewOrigin('https://preview--caremetricai.base44.app')).toBe(true);
  });

  it('refuses look-alikes, plain http and anything unparseable', () => {
    expect(isEditorPreviewOrigin('https://evilbase44.com')).toBe(false);
    expect(isEditorPreviewOrigin('https://base44.com.evil.test')).toBe(false);
    expect(isEditorPreviewOrigin('http://app.base44.com')).toBe(false);
    expect(isEditorPreviewOrigin('http://127.0.0.1:4173')).toBe(false);
    expect(isEditorPreviewOrigin('')).toBe(false);
    expect(isEditorPreviewOrigin(undefined)).toBe(false);
    expect(isEditorPreviewOrigin('not a url')).toBe(false);
  });
});

describe('isTrustedEditorPreviewFrame', () => {
  it('admits a frame whose every ancestor is the editor', () => {
    expect(isTrustedEditorPreviewFrame(ancestors('https://app.base44.com'), '')).toBe(true);
    expect(isTrustedEditorPreviewFrame(ancestors('https://preview.base44.app', 'https://app.base44.com'), '')).toBe(true);
  });

  it('refuses when any ancestor is somebody else, whatever the referrer says', () => {
    expect(isTrustedEditorPreviewFrame(ancestors('https://attacker.test'), 'https://app.base44.com/')).toBe(false);
    expect(isTrustedEditorPreviewFrame(ancestors('https://app.base44.com', 'https://attacker.test'), '')).toBe(false);
    expect(isTrustedEditorPreviewFrame(ancestors(), 'https://app.base44.com/')).toBe(false);
  });

  it('falls back to the referrer only where the browser lists no ancestors', () => {
    expect(isTrustedEditorPreviewFrame({}, 'https://app.base44.com/apps/x/editor')).toBe(true);
    expect(isTrustedEditorPreviewFrame({}, 'https://attacker.test/')).toBe(false);
    expect(isTrustedEditorPreviewFrame({}, '')).toBe(false);
    expect(isTrustedEditorPreviewFrame(undefined, undefined)).toBe(false);
  });
});
