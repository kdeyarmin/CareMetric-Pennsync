import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import {
  audioFileExtension,
  audioRecorderOptions,
  pickAudioRecorderMimeType,
  recordedAudioType,
} from './audioRecordingFormat.js';

const recorderSupporting = (...types) => ({ isTypeSupported: (type) => types.includes(type) });

describe('pickAudioRecorderMimeType', () => {
  it('prefers webm/opus where Chromium and iOS 18.4+ offer it', () => {
    expect(pickAudioRecorderMimeType(recorderSupporting('audio/webm;codecs=opus', 'audio/webm', 'audio/mp4')))
      .toBe('audio/webm;codecs=opus');
  });

  it('falls back to mp4 on WebKit builds without webm (iOS before 18.4)', () => {
    expect(pickAudioRecorderMimeType(recorderSupporting('audio/mp4'))).toBe('audio/mp4');
  });

  it('lets the browser choose when it can answer nothing', () => {
    expect(pickAudioRecorderMimeType(recorderSupporting())).toBe('');
    expect(pickAudioRecorderMimeType({})).toBe('');
    expect(pickAudioRecorderMimeType(undefined)).toBe('');
    expect(pickAudioRecorderMimeType({ isTypeSupported: () => { throw new Error('nope'); } })).toBe('');
  });

  it('never passes an empty mimeType to the constructor', () => {
    expect(audioRecorderOptions('')).toBeUndefined();
    expect(audioRecorderOptions('audio/mp4')).toEqual({ mimeType: 'audio/mp4' });
  });
});

describe('recordedAudioType / audioFileExtension', () => {
  it('labels a recording with what the recorder produced', () => {
    expect(recordedAudioType({ mimeType: 'audio/mp4' })).toBe('audio/mp4');
    expect(recordedAudioType({ mimeType: 'audio/webm;codecs=opus' })).toBe('audio/webm');
    expect(recordedAudioType({ mimeType: '' })).toBe('audio/webm');
    expect(recordedAudioType(null, 'audio/mp4')).toBe('audio/mp4');
    expect(recordedAudioType({ mimeType: 'video/mp4' })).toBe('audio/webm');
  });

  it('names the file to match its type', () => {
    expect(audioFileExtension('audio/mp4')).toBe('mp4');
    expect(audioFileExtension('audio/webm;codecs=opus')).toBe('webm');
    expect(audioFileExtension('audio/mpeg')).toBe('mp3');
    expect(audioFileExtension('audio/aac')).toBe('m4a');
    expect(audioFileExtension('')).toBe('webm');
    expect(audioFileExtension('audio/../x')).toBe('webm');
  });
});

describe('the recorders use it', () => {
  // The defect was a literal in three components; a source check is what sees
  // a literal come back.
  const read = (file) => readFileSync(path.join(process.cwd(), file), 'utf8');

  it.each([
    'src/components/smartNote/WhisperTranscriber.jsx',
    'src/components/smartNote/VisitAudioRecorder.jsx',
    'src/components/visit/AudioRecorder.jsx',
  ])('%s neither forces nor assumes webm', (file) => {
    const source = read(file);
    expect(source).toMatch(/pickAudioRecorderMimeType\(\)/);
    expect(source).not.toMatch(/mimeType:\s*['"]audio\/webm['"]/);
    expect(source).not.toMatch(/new Blob\([^)]*\{\s*type:\s*['"]audio\/webm['"]/);
    expect(source).not.toMatch(/\.webm['"`]/);
  });
});
