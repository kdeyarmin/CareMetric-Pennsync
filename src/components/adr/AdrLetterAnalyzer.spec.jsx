import { StrictMode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AdrLetterAnalyzer from './AdrLetterAnalyzer';

const { upload, analyze } = vi.hoisted(() => ({ upload: vi.fn(), analyze: vi.fn() }));
vi.mock('@/api/base44Client', () => ({ base44: { integrations: { Core: { UploadFile: upload } } } }));
vi.mock('@/lib/invokeLLM', () => ({ invokeLLM: vi.fn() }));
vi.mock('./adrAnalysis', () => ({ runAdrLetterAnalysis: analyze }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
const file = () => new File(['%PDF-1.7 synthetic'], 'synthetic.pdf', { type: 'application/pdf' });
beforeEach(() => {
  vi.clearAllMocks();
  upload.mockResolvedValue({ file_url: 'https://example.test/synthetic.pdf' });
});
it('blocks file input and drop entry while disabled', () => {
  render(<AdrLetterAnalyzer disabled />);
  fireEvent.change(screen.getByLabelText('Upload ADR or audit letter'), { target: { files: [file()] } });
  fireEvent.drop(screen.getByRole('button', { name: 'Upload the ADR or audit letter (PDF or scanned image)' }), { dataTransfer: { files: [file()] } });
  expect(upload).not.toHaveBeenCalled();
  expect(analyze).not.toHaveBeenCalled();
});
it('lets a started analysis finish after new work is disabled, including StrictMode effect replay', async () => {
  let finish;
  analyze.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const onComplete = vi.fn();
  const onProcessingChange = vi.fn();
  const { rerender } = render(<StrictMode><AdrLetterAnalyzer onComplete={onComplete} onProcessingChange={onProcessingChange} /></StrictMode>);
  fireEvent.change(screen.getByLabelText('Upload ADR or audit letter'), { target: { files: [file()] } });
  await waitFor(() => expect(analyze).toHaveBeenCalledOnce());
  rerender(<StrictMode><AdrLetterAnalyzer disabled onComplete={onComplete} onProcessingChange={onProcessingChange} /></StrictMode>);
  await act(async () => finish({ requested_items: [], audit_type: 'mac_adr' }));
  expect(upload).toHaveBeenCalledOnce();
  expect(onComplete).toHaveBeenCalledOnce();
  expect(onProcessingChange).toHaveBeenLastCalledWith(false);
});
