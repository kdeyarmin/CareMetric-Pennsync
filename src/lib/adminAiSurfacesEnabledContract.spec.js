import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import { appendBriefingSection } from '@/components/referral/briefingSections';

// 2026-10-08 owner decision ("turn everything on"): the admin, reporting and
// AI surfaces below were paused behind static flags and are on again. These
// assertions pin the WORKING behaviour that replaced each pause, so a surface
// cannot quietly fall back to a stub or lose the guard it was re-enabled with.
const read = (relativePath) => readFileSync(path.join(process.cwd(), relativePath), 'utf8');

describe('AI admission documentation', () => {
  const assistant = read('src/components/clinical/AIAdmissionDocumentationAssistant.jsx');
  const processor = read('src/components/hub-tabs/ReferralProcessor.jsx');

  it('renders the assistant itself rather than a pause notice', () => {
    expect(assistant).not.toContain('AI_ADMISSION_DOCUMENTATION_ENABLED');
    expect(assistant).not.toContain('AI Admission Documentation Paused');
    expect(assistant).toMatch(/export default function AIAdmissionDocumentationAssistant\(\{/);
    expect(assistant).toContain('The AI response contained no usable documentation sections');
  });

  it('hands an accepted section to the referral briefing instead of a no-op', () => {
    expect(processor).toContain('saveLabel="Add to Nurse Briefing"');
    expect(processor).toMatch(/onSaveSection=\{\(title, content\) => \{[\s\S]{0,200}setAdmissionNote\(\(current\) => appendBriefingSection\(current, title, content\)\)/);
    expect(processor).not.toMatch(/onSaveSection=\{\(\) => \{\s*\}\}/);
  });

  it('appends sections in order under a heading', () => {
    expect(appendBriefingSection('', 'Homebound status', ' Unable to leave home. ')).toBe(
      'HOMEBOUND STATUS\nUnable to leave home.',
    );
    expect(appendBriefingSection('EARLIER\ntext', '', 'More')).toBe(
      'EARLIER\ntext\n\nADMISSION DOCUMENTATION\nMore',
    );
  });
});
