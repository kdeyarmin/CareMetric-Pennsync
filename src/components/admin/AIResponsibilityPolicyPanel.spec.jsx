import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import AIResponsibilityPolicyPanel from './AIResponsibilityPolicyPanel';

const { managePolicy } = vi.hoisted(() => ({ managePolicy: vi.fn() }));
vi.mock('@/functions/manageAiResponsibilityPolicy', () => ({
  manageAiResponsibilityPolicy: managePolicy,
}));

it('reads and writes the same policy cache key and invalidates agreement status after saving', async () => {
  managePolicy.mockResolvedValueOnce({ bypass_previously_acknowledged: false })
    .mockResolvedValueOnce({ bypass_previously_acknowledged: true });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(<QueryClientProvider client={client}><AIResponsibilityPolicyPanel /></QueryClientProvider>);

  const toggle = await screen.findByRole('switch');
  expect(toggle).toHaveAttribute('aria-checked', 'false');
  expect(client.getQueryData(['platformAiResponsibilityPolicy'])).toEqual({ bypass_previously_acknowledged: false });
  fireEvent.click(toggle);

  await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
  expect(managePolicy).toHaveBeenCalledWith({ bypass_previously_acknowledged: true });
  expect(client.getQueryData(['platformAiResponsibilityPolicy'])).toEqual({ bypass_previously_acknowledged: true });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['aiContentAgreementStatus'] });
  client.clear();
});
