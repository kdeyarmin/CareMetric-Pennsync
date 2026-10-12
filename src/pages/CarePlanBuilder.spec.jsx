import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
const mocks = vi.hoisted(() => ({ filter: vi.fn(), create: vi.fn(), update: vi.fn(), error: vi.fn() }));
vi.mock('@/api/base44Client', () => ({ base44: { entities: { CarePlan: mocks }, auth: { me: vi.fn() } } }));
vi.mock('@/hooks/useScopedPatients', () => ({ useScopedPatients: () => ({ data: [{ id: 'a', first_name: 'Test', last_name: 'Patient' }] }) }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: {} }) }));
vi.mock('sonner', () => ({ toast: { error: mocks.error, success: vi.fn() } }));
vi.mock('@hello-pangea/dnd', () => ({ DragDropContext: ({ children, onDragEnd }) => <div>{children}<button onClick={() => onDragEnd({ source: { droppableId: 'library-test' }, destination: { droppableId: 'care-plan-canvas', index: 0 }, draggableId: 'item' })}>Add intervention</button></div> }));
vi.mock('@/components/carePlan/InterventionLibrary', () => ({ default: () => null, INTERVENTIONS_LIBRARY: [{ id: 'test', items: [{ id: 'item', name: 'Test care', description: 'Test intervention', frequency: 'Daily' }] }] }));
vi.mock('@/components/carePlan/CarePlanCanvas', () => ({ default: ({ onRemove }) => <button onClick={() => onRemove('item')}>Remove intervention</button> }));
vi.mock('@/components/carePlan/InterventionDetailPanel', () => ({ default: () => null }));
vi.mock('@/components/carePlan/AICarePlanAnalyzer', () => ({ default: () => null }));
vi.mock('@/components/ui/PageContainer', () => ({ default: ({ children }) => <div>{children}</div> }));
import CarePlanBuilder from './CarePlanBuilder';
beforeEach(() => {
  mocks.filter.mockReset().mockResolvedValue([]);
  mocks.create.mockReset().mockResolvedValue({ id: 'saved' });
  mocks.update.mockReset().mockResolvedValue({});
  mocks.error.mockReset();
});
async function prepare() {
  render(<CarePlanBuilder />);
  await userEvent.click(screen.getByRole('button', { name: 'Select Patient' }));
  await userEvent.click(screen.getByRole('button', { name: 'Test Patient' }));
  await userEvent.click(screen.getByRole('button', { name: 'Add intervention' }));
}
describe('care plan save safety', () => {
  it('does not reactivate a completed plan when saving an active intervention', async () => {
    await prepare();
    await userEvent.click(screen.getByRole('button', { name: 'Save Plan' }));
    await screen.findByRole('button', { name: 'Saved!' });
    expect(mocks.filter.mock.calls[0][0]).toEqual({ patient_id: 'a', status: 'active', problem: { $in: ['Test care'] } });
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it('keeps the patient and interventions fixed until saving finishes', async () => {
    let resolve;
    mocks.create.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    await prepare();
    await userEvent.click(screen.getByRole('button', { name: 'Save Plan' }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Test Patient' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Remove intervention' }));
    resolve({});
    expect(await screen.findByRole('button', { name: 'Saved!' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Remove intervention' }));
    expect(screen.queryByRole('button', { name: 'Saved!' })).not.toBeInTheDocument();
  });
  it('retains the draft after a failed intervention save', async () => {
    mocks.create.mockRejectedValue(new Error('Save refused'));
    await prepare();
    await userEvent.click(screen.getByRole('button', { name: 'Save Plan' }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining('Your draft is still here')));
    expect(screen.getByRole('button', { name: 'Save Plan' })).toBeEnabled();
  });
});