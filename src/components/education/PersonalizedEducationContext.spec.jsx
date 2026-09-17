import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const { run } = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('@/hooks/useAICall', () => ({ useAICall: () => ({ run, loading: false }) }));
import EducationGenerator from './PersonalizedEducationGenerator';
import ChartGenerator from '../patient/PersonalizedEducationGenerator';

const alice = { id: 'a', first_name: 'Alice', last_name: 'Example', primary_diagnosis: 'A condition' };
const bob = { id: 'b', first_name: 'Bob', last_name: 'Example', primary_diagnosis: 'B condition' };
const material = text => ({ title: text, sections: [], condition_overview: text });
const start = () => fireEvent.click(screen.getByRole('button', { name: /^Generate Education Material/ }));

beforeEach(() => run.mockReset());
describe.each([['education hub', EducationGenerator], ['chart generator', ChartGenerator]])('%s patient context', (_name, Generator) => {
  it('does not display a late result under another patient or after returning to the original patient', async () => {
    let finish;
    run.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<Generator patient={alice} />);
    start();
    view.rerender(<Generator patient={bob} />);
    view.rerender(<Generator patient={alice} />);
    await act(async () => finish(material('Late Alice result')));
    expect(screen.queryByText('Late Alice result')).not.toBeInTheDocument();
    run.mockResolvedValueOnce(material('Current Alice result'));
    start();
    expect(await screen.findByText('Current Alice result')).toBeInTheDocument();
  });

  it('clears completed material when the selected patient changes', async () => {
    run.mockResolvedValueOnce(material('Alice result'));
    const view = render(<Generator patient={alice} />);
    start(); expect(await screen.findByText('Alice result')).toBeInTheDocument();
    view.rerender(<Generator patient={bob} />);
    expect(screen.queryByText('Alice result')).not.toBeInTheDocument();
  });
});
