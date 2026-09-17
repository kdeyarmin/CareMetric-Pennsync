import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { run, copyError } = vi.hoisted(() => ({ run: vi.fn(), copyError: vi.fn() }));
vi.mock('@/hooks/useAICall', () => ({ useAICall: () => ({ run, loading: false }) }));
vi.mock('sonner', () => ({ toast: { error: copyError } }));
vi.mock('@/hooks/useAuthorizedVisits', () => ({
  useAuthorizedVisits: () => ({ data: [{ id: 'synthetic-visit', nurse_notes: 'Synthetic note.', visit_date: '2026-09-17', visit_type: 'routine' }] }),
}));
import DocumentDraftManager from './DocumentDraftManager';
import SmartNotesContextPanel from './SmartNotesContextPanel';
import PersonalizedEducationGenerator from '../education/PersonalizedEducationGenerator';

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
let writeText;
beforeEach(() => {
  writeText = vi.fn();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  copyError.mockReset();
  run.mockResolvedValue({ title: 'Synthetic education', introduction: 'Synthetic introduction', sections: [], summary: 'Synthetic summary' });
});
afterEach(() => {
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else delete navigator.clipboard;
});

const scenarios = [
  ['document draft', async () => {
    render(<DocumentDraftManager generatedContent="Synthetic draft." documentType="test" patientName="Example" />);
    return screen.getByRole('button', { name: /^Copy$/ });
  }],
  ['visit-note snippet', async () => {
    render(<SmartNotesContextPanel patientId="synthetic-patient" />);
    return screen.getByRole('button', { name: /^Copy$/ });
  }],
  ['patient education', async () => {
    render(<PersonalizedEducationGenerator patient={{ id: 'synthetic-patient', first_name: 'Synthetic', last_name: 'Example' }} />);
    fireEvent.click(screen.getByRole('button', { name: /^Generate Education Material/ }));
    return screen.findByRole('button', { name: /^Copy All$/ });
  }],
];

describe.each(scenarios)('%s copy confirmation', (_name, mount) => {
  it('waits for browser confirmation before showing Copied', async () => {
    let finish;
    writeText.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    fireEvent.click(await mount());
    expect(writeText).toHaveBeenCalledTimes(1);
    try {
      expect(screen.queryByRole('button', { name: /^Copied!?$/ })).not.toBeInTheDocument();
    } finally {
      await act(async () => finish());
    }
    expect(screen.getByRole('button', { name: /^Copied!?$/ })).toBeInTheDocument();
    expect(copyError).not.toHaveBeenCalled();
  });

  it('reports a rejected copy without a false success and allows retry', async () => {
    const denied = Promise.reject(new Error('Synthetic clipboard denial'));
    void denied.catch(() => {});
    writeText.mockReturnValueOnce(denied).mockResolvedValueOnce(undefined);
    const button = await mount();
    fireEvent.click(button);
    await waitFor(() => expect(copyError).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: /^Copied!?$/ })).not.toBeInTheDocument();
    fireEvent.click(button);
    expect(await screen.findByRole('button', { name: /^Copied!?$/ })).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledTimes(2);
  });
});
