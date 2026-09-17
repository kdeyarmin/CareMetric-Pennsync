import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import ADRCenter from './ADRCenter';
import { expectNoAxeViolations } from '@/test/axeHelpers';

const { list, create, update, remove, patientQuery, analysis } = vi.hoisted(() => ({
  list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), patientQuery: { current: {} }, analysis: { finish: null },
}));
vi.mock('@/api/base44Client', () => ({ base44: { entities: { AdrAuditCase: { list, create, update, delete: remove } } } }));
vi.mock('@/hooks/useScopedPatients', () => ({ useScopedPatients: () => patientQuery.current }));
vi.mock('@/components/ui/PageHeader', () => ({ default: ({ title, actions }) => <header><h1>{title}</h1>{actions}</header> }));
vi.mock('@/components/ui/PageContainer', () => ({ default: ({ children }) => <main>{children}</main> }));
vi.mock('@/components/ui/SearchablePatientSelect', () => ({ default: ({ onValueChange }) => <button onClick={() => onValueChange('patient-a')}>Synthetic patient picker</button> }));
vi.mock('@/components/adr/AdrLetterAnalyzer', () => ({ default: ({ onProcessingChange, onComplete, disabled }) => <button disabled={disabled} onClick={() => {
  onProcessingChange(true);
  // Capture the original props, like the real async upload callback does.
  analysis.finish = () => { onProcessingChange(false); onComplete({ letterFileUrl: 'https://example.test/synthetic.pdf', analysis: { patient_name: 'Synthetic' }, checklist: [] }); };
}}>Start synthetic analysis</button> }));
vi.mock('@/components/adr/AdrChecklistPanel', () => ({ default: () => <p>Case checklist</p> }));
vi.mock('@/components/adr/AdrPacketVerifier', () => ({ default: () => <p>Packet verifier</p> }));
vi.mock('@/components/adr/AdrSubmissionPanel', () => ({ default: () => <p>Case submission</p> }));

const syntheticCase = { id: 'case-a', case_name: 'Synthetic audit case', status: 'packet_generated' };
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const element = <MemoryRouter><QueryClientProvider client={client}><ADRCenter /></QueryClientProvider></MemoryRouter>;
  return { client, ...render(element) };
}
beforeEach(() => {
  vi.clearAllMocks();
  list.mockResolvedValue([syntheticCase]);
  patientQuery.current = { data: [], isSuccess: true, isPending: false, isError: false, refetch: vi.fn(), retry: vi.fn() };
});

describe('ADR case read reliability', () => {
  it('does not present an in-flight case load as empty or show zero totals', () => {
    list.mockReturnValue(new Promise(() => {}));
    mount();
    expect(screen.getByText('Loading ADR cases...')).toBeInTheDocument();
    expect(screen.queryByText('No ADR cases yet')).not.toBeInTheDocument();
    expect(screen.queryByText('Open cases')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New ADR Case' })).toBeDisabled();
  });

  it('keeps an active analyzer mounted and preserves its result through a case refresh failure', async () => {
    const { client } = mount();
    await screen.findByRole('button', { name: 'Open' });
    fireEvent.click(screen.getByRole('button', { name: 'New ADR Case' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start synthetic analysis' }));
    list.mockRejectedValue(new Error('Unavailable'));
    await act(() => client.invalidateQueries({ queryKey: ['adrCases'] }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start synthetic analysis' })).toBeDisabled());
    await act(async () => analysis.finish());
    expect(create).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Retry save' })).toBeDisabled();
    list.mockResolvedValue([syntheticCase]);
    await act(() => client.invalidateQueries({ queryKey: ['adrCases'] }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry save' })).toBeEnabled());
    create.mockResolvedValue(syntheticCase);
    fireEvent.click(screen.getByRole('button', { name: 'Retry save' }));
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('shows a retryable read failure rather than an empty caseload', async () => {
    list.mockRejectedValue(new Error('Private backend details'));
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('ADR cases are unavailable');
    expect(screen.queryByText('No ADR cases yet')).not.toBeInTheDocument();
    expect(screen.queryByText('Open cases')).not.toBeInTheDocument();
    expect(screen.queryByText('Private backend details')).not.toBeInTheDocument();
    list.mockResolvedValue([]);
    fireEvent.click(screen.getByRole('button', { name: 'Retry ADR cases' }));
    expect(await screen.findByText('No ADR cases yet')).toBeInTheDocument();
    expect(screen.getByText('Open cases')).toBeInTheDocument();
  });

  it('hides cached case details and actions when revalidation fails, then recovers the selection', async () => {
    const { client } = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }));
    expect(screen.getByText('Case checklist')).toBeInTheDocument();
    list.mockRejectedValue(new Error('Access denied'));
    await act(() => client.invalidateQueries({ queryKey: ['adrCases'] }));
    expect(await screen.findByRole('alert')).toHaveTextContent('ADR cases are unavailable');
    expect(screen.queryByText('Synthetic audit case')).not.toBeInTheDocument();
    expect(screen.queryByText('Case checklist')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark submitted' })).not.toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
    list.mockResolvedValue([syntheticCase]);
    fireEvent.click(screen.getByRole('button', { name: 'Retry ADR cases' }));
    expect(await screen.findByText('Case checklist')).toBeInTheDocument();
  });

  it.each([{ records: [] }, null, [null], [{ id: '' }], [syntheticCase, syntheticCase]].map(rows => [rows]))('rejects malformed or ambiguous case collections (%j)', async (rows) => {
    list.mockResolvedValue(rows);
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('ADR cases are unavailable');
    expect(screen.queryByText('No ADR cases yet')).not.toBeInTheDocument();
    expect(screen.queryByText('Open cases')).not.toBeInTheDocument();
  });

  it('warns that a full 200-row window does not establish complete totals', async () => {
    list.mockResolvedValue(Array.from({ length: 200 }, (_, i) => ({ ...syntheticCase, id: `case-${i}` })));
    mount();
    expect(await screen.findByText(/Showing the 200 most recent accessible cases/)).toBeInTheDocument();
  });

  it.each(['pending', 'error'])('does not offer a patient link from a %s roster', async (state) => {
    patientQuery.current = { data: [], isSuccess: false, isPending: state === 'pending', isError: state === 'error', refetch: vi.fn(), retry: vi.fn() };
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }));
    expect(screen.queryByText('Synthetic patient picker')).not.toBeInTheDocument();
    expect(screen.getByText(state === 'pending' ? 'Loading patient charts...' : 'Patient charts are unavailable. Retry before changing the link.')).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
  });

  it('keeps the case details usable when only patient lookup fails', async () => {
    patientQuery.current = { data: [], isSuccess: false, isPending: false, isError: true, refetch: vi.fn(), retry: vi.fn() };
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry patient charts' }));
    await waitFor(() => expect(patientQuery.current.retry).toHaveBeenCalledOnce());
    expect(screen.getByText('Case checklist')).toBeInTheDocument();
  });

  it('does not restore a delete action for a case absent after recovery', async () => {
    const { client } = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete case Synthetic audit case' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    list.mockRejectedValue(new Error('Unavailable'));
    await act(() => client.invalidateQueries({ queryKey: ['adrCases'] }));
    expect(await screen.findByRole('alert')).toHaveTextContent('ADR cases are unavailable');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    list.mockResolvedValue([]);
    fireEvent.click(screen.getByRole('button', { name: 'Retry ADR cases' }));
    await screen.findByText('No ADR cases yet');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(remove).not.toHaveBeenCalled();
  });

  it('keeps the case list and read failure accessible', async () => {
    const { client, container } = mount();
    await screen.findByRole('button', { name: 'Open' });
    await expectNoAxeViolations(container);
    list.mockRejectedValue(new Error('Unavailable'));
    await act(() => client.invalidateQueries({ queryKey: ['adrCases'] }));
    await screen.findByRole('alert');
    await expectNoAxeViolations(container);
  });
});
