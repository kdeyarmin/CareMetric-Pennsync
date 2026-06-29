import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/testUtils';

vi.mock('@/api/base44Client', () => {
  const entityStub = new Proxy({}, { get: () => async () => ({}) });
  return { base44: { entities: new Proxy({}, { get: () => entityStub }), auth: { me: async () => ({}) } } };
});

import ScenarioBuilder from './ScenarioBuilder';

describe('ScenarioBuilder', () => {
  it('persists the FULL node map, not just the start node', () => {
    const onSave = vi.fn();
    renderWithProviders(<ScenarioBuilder courseId="c1" onSave={onSave} />);

    fireEvent.click(screen.getByText('Save Scenario'));

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0];
    // Regression: the builder used to save scenarioFlow = nodes['node-start'],
    // discarding every branch. It must now be the { startNodeId, nodes } map.
    expect(saved.scenarioFlow).toMatchObject({ startNodeId: 'node-start' });
    expect(saved.scenarioFlow.nodes).toHaveProperty('node-start');
    expect(saved.courseId).toBe('c1');
    expect(saved.totalNodes).toBeGreaterThanOrEqual(1);
  });
});
