import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, act } from '@testing-library/react';
import { renderWithProviders } from '@/test/testUtils';

vi.mock('@/api/base44Client', () => {
  const entityStub = new Proxy({}, { get: () => async () => ({}) });
  return {
    base44: {
      entities: new Proxy({}, { get: () => entityStub }),
      auth: { me: async () => ({ email: 'n@x.com' }) },
      functions: { invoke: async () => ({ data: {} }) },
    },
  };
});

import ScenarioPlayer from './ScenarioPlayer';

const twoNodeScenario = {
  id: 's1',
  title: 'Test Scenario',
  passingScore: 50,
  patientContext: 'Patient context here',
  scenarioFlow: {
    startNodeId: 'node-start',
    nodes: {
      'node-start': {
        id: 'node-start',
        text: 'FIRST node question',
        choices: [
          { text: 'Correct first', feedback: 'well done', isCorrect: true, nextNodeId: 'node-2' },
          { text: 'Wrong first', feedback: 'no', isCorrect: false, nextNodeId: null },
        ],
      },
      'node-2': {
        id: 'node-2',
        text: 'SECOND node question',
        choices: [
          { text: 'Correct second', feedback: 'done', isCorrect: true, nextNodeId: 'node-end' },
        ],
      },
    },
  },
};

describe('ScenarioPlayer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('navigates past the first node (the bug that made multi-step scenarios dead)', () => {
    renderWithProviders(<ScenarioPlayer scenario={twoNodeScenario} onComplete={vi.fn()} />);
    expect(screen.getByText('FIRST node question')).toBeInTheDocument();

    // Pick the correct choice; the player shows feedback then advances after 2s.
    fireEvent.click(screen.getByText('Correct first'));
    act(() => vi.advanceTimersByTime(2000));

    // Before the fix, nodes[nextNodeId] was always undefined and this never appeared.
    expect(screen.getByText('SECOND node question')).toBeInTheDocument();
  });

  it('renders the start node for a legacy-shaped scenarioFlow (back-compat)', () => {
    const legacy = {
      id: 's2', title: 'Legacy', passingScore: 50, patientContext: 'ctx',
      scenarioFlow: {
        id: 'node-start',
        text: 'LEGACY start node',
        choices: [{ text: 'Finish', feedback: '', isCorrect: true, nextNodeId: 'node-end' }],
      },
    };
    renderWithProviders(<ScenarioPlayer scenario={legacy} onComplete={vi.fn()} />);
    expect(screen.getByText('LEGACY start node')).toBeInTheDocument();
  });
});
