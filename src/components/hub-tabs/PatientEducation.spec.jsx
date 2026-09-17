import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ callbacks: [], history: [] }));
const patients = [
  { id: 'patient-a', first_name: 'Alice', last_name: 'Example', primary_diagnosis: 'A condition' },
  { id: 'patient-b', first_name: 'Bob', last_name: 'Example', primary_diagnosis: 'B condition' },
];
vi.mock('@/hooks/useScopedPatients', () => ({ useScopedPatients: () => ({ data: patients }) }));
vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }) => <div><select aria-label="Patient" value={value} onChange={event => onValueChange(event.target.value)}><option value="none">None</option><option value="patient-a">Alice</option><option value="patient-b">Bob</option></select>{children}</div>,
  SelectTrigger: () => null, SelectValue: () => null, SelectContent: () => null, SelectItem: () => null,
}));
vi.mock('@/components/education/EducationMaterialGenerator', () => ({
  default: ({ onMaterialGenerated, teachBackHistory }) => {
    state.history = teachBackHistory;
    return <button onClick={() => state.callbacks.push(onMaterialGenerated)}>Start generation</button>;
  },
}));
vi.mock('@/components/education/EducationLibrary', () => ({ default: () => null }));
vi.mock('@/components/education/SimplifiedExplanationGenerator', () => ({ default: () => null }));
vi.mock('@/components/education/NextStepsSummaryGenerator', () => ({ default: () => null }));
vi.mock('@/components/education/TeachBackPromptsGenerator', () => ({ default: () => null }));
import PatientEducation from './PatientEducation';

const material = (title, count = 1) => ({ title, teach_back_questions: Array.from({ length: count }, (_, index) => ({ question: `${title} question ${index + 1}`, expected_answer: 'Example answer' })) });
const select = id => fireEvent.change(screen.getByLabelText('Patient'), { target: { value: id } });
const start = () => fireEvent.click(screen.getByRole('button', { name: 'Start generation' }));
const resolve = async (index, value) => act(async () => state.callbacks[index](value));
const respond = () => {
  fireEvent.change(screen.getByPlaceholderText('Document what the patient said...'), { target: { value: 'Original response' } });
  fireEvent.click(screen.getByRole('radio', { name: 'Good' }));
};

beforeEach(() => { state.callbacks = []; state.history = []; });
describe('patient education context', () => {
  it('clears material when changing patients and rejects a late response even after returning to the same patient', async () => {
    render(<PatientEducation />);
    select('patient-a'); start();
    await resolve(0, material('Alice material'));
    expect(screen.getByText(/Alice material question 1/)).toBeInTheDocument();
    start(); select('patient-b');
    expect(screen.queryByText(/Alice material question 1/)).not.toBeInTheDocument();
    select('patient-a');
    await resolve(1, material('Late Alice material'));
    expect(screen.queryByText(/Late Alice material/)).not.toBeInTheDocument();
    start(); await resolve(2, material('Current Alice material'));
    expect(screen.getByText(/Current Alice material question 1/)).toBeInTheDocument();
  });

  it('starts fresh teach-back responses when replacement material has fewer questions', async () => {
    render(<PatientEducation />);
    select('patient-a'); start(); await resolve(0, material('First material', 2));
    respond(); fireEvent.click(screen.getByRole('button', { name: 'Record & Next Question' }));
    expect(screen.getByText('Question 2 of 2')).toBeInTheDocument();
    start(); await resolve(1, material('Replacement material'));
    expect(screen.getByText('Question 1 of 1')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Document what the patient said...')).toHaveValue('');
    expect(screen.getByRole('radio', { name: 'Good' })).not.toBeChecked();
  });

  it('preserves completed records for their patient without using them for generic education', async () => {
    render(<PatientEducation />);
    select('patient-a'); start(); await resolve(0, material('Completed material'));
    respond(); fireEvent.click(screen.getByRole('button', { name: 'Complete Teach-Back' }));
    expect(state.history).toHaveLength(1);
    select('none'); expect(state.history).toHaveLength(0);
    select('patient-b'); expect(state.history).toHaveLength(0);
    select('patient-a'); expect(state.history).toHaveLength(1);
    expect(state.history[0].patientId).toBe('patient-a');
  });
});
