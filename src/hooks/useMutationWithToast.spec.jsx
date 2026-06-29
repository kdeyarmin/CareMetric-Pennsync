import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { toastSuccess, toastError, loggerError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }));
vi.mock('@/lib/logger', () => ({ logger: { error: loggerError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { useMutationWithToast } from '@/hooks/useMutationWithToast';

function wrapper({ children }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  toastSuccess.mockClear();
  toastError.mockClear();
  loggerError.mockClear();
});

describe('useMutationWithToast', () => {
  it('on success: shows success toast, invalidates keys, and runs caller onSuccess', async () => {
    const invalidateSpy = vi.fn();
    const onSuccess = vi.fn();
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    client.invalidateQueries = invalidateSpy;
    const localWrapper = ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;

    const { result } = renderHook(
      () => useMutationWithToast({
        mutationFn: async () => ({ ok: true }),
        successMessage: 'Saved!',
        invalidateKeys: [['allUsers'], 'other'],
        onSuccess,
      }),
      { wrapper: localWrapper }
    );

    result.current.mutate({ id: 1 });

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(toastSuccess).toHaveBeenCalledWith('Saved!');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['allUsers'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['other'] });
    expect(toastError).not.toHaveBeenCalled();
  });

  it('on error: shows error toast (from fn), logs to telemetry, and runs caller onError', async () => {
    const onError = vi.fn();
    const { result } = renderHook(
      () => useMutationWithToast({
        mutationFn: async () => { throw new Error('boom'); },
        errorMessage: (err) => `Failed: ${err.message}`,
        onError,
      }),
      { wrapper }
    );

    result.current.mutate();

    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(toastError).toHaveBeenCalledWith('Failed: boom');
    expect(loggerError).toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('omitting successMessage suppresses the success toast', async () => {
    const onSuccess = vi.fn();
    const { result } = renderHook(
      () => useMutationWithToast({ mutationFn: async () => 1, onSuccess }),
      { wrapper }
    );
    result.current.mutate();
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
