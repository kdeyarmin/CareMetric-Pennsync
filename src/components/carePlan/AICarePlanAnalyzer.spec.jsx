import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
const mocks = vi.hoisted(() => ({ run: vi.fn(), create: vi.fn() }));
vi.mock('@/hooks/useAICall', () => ({ useAICall: () => ({ run: mocks.run, loading: false }) }));
vi.mock('@/api/base44Client', () => ({ base44: { entities: { CarePlan: { create: input => mocks.create(input) } } } }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
import AICarePlanAnalyzer from './AICarePlanAnalyzer';
const props = { patientId: 'patient-a', patientName: 'Test A', diagnosis: 'Test diagnosis', assessmentData: { test: true } };
const report = { clinical_summary: 'Draft for patient A', personalized_interventions: [{ name: 'Test intervention', description: 'Test care', frequency: 'Daily' }] };
beforeEach(() => { mocks.run.mockReset().mockResolvedValue(report); mocks.create.mockReset().mockResolvedValue({}); });
describe('care plan analysis context', () => {
  it('renders incomplete optional sections without crashing', async () => {
    render(<AICarePlanAnalyzer {...props} />);
    await userEvent.click(screen.getByRole('button', { name: /Generate Personalized Care Plan/ }));
    expect(await screen.findByText(report.clinical_summary)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Visit Schedule' }));
    expect(screen.getByText('Routine Frequency')).toBeInTheDocument();
  });
  it('clears results when the patient changes', async () => {
    const { rerender } = render(<AICarePlanAnalyzer {...props} />);
    await userEvent.click(screen.getByRole('button', { name: /Generate Personalized Care Plan/ }));
    await screen.findByText(report.clinical_summary);
    rerender(<AICarePlanAnalyzer {...props} patientId="patient-b" patientName="Test B" />);
    expect(screen.queryByText(report.clinical_summary)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save Care Plan' })).not.toBeInTheDocument();
  });
  it('discards late analysis for an abandoned patient', async () => {
    let resolve;
    mocks.run.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const { rerender } = render(<AICarePlanAnalyzer {...props} />);
    await userEvent.click(screen.getByRole('button', { name: /Generate Personalized Care Plan/ }));
    rerender(<AICarePlanAnalyzer {...props} patientId="patient-b" />);
    resolve(report);
    await waitFor(() => expect(screen.getByRole('button', { name: /Generate Personalized Care Plan/ })).toBeEnabled());
    expect(screen.queryByText(report.clinical_summary)).not.toBeInTheDocument();
    expect(mocks.create).not.toHaveBeenCalled();
  });
});