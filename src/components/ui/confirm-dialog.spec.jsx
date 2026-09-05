import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  TENANT_AUTHORITY_STATES,
  TenantAuthorityBoundary,
} from '@/lib/AuthContext';
import { ConfirmDialogProvider, useConfirm } from './confirm-dialog';

function ProtectedMutation({ onResult, mutate }) {
  const confirm = useConfirm();

  const requestMutation = () => {
    void (async () => {
      const accepted = await confirm({
        title: 'Delete protected record?',
        description: 'This must not survive an authority transition.',
        destructive: true,
      });
      onResult(accepted);
      if (accepted) mutate();
    })();
  };

  return (
    <button type="button" onClick={requestMutation}>
      Request protected mutation
    </button>
  );
}

function AuthorityTree({ authorityState, authorityKey, onResult, mutate }) {
  return (
    <TenantAuthorityBoundary
      authorityState={authorityState}
      authorityKey={authorityKey}
      fallback={<div>Authority unavailable</div>}
    >
      <ConfirmDialogProvider>
        <ProtectedMutation onResult={onResult} mutate={mutate} />
      </ConfirmDialogProvider>
    </TenantAuthorityBoundary>
  );
}

describe('authority-bound confirmation dialog', () => {
  it.each([
    ['authority becomes unavailable', TENANT_AUTHORITY_STATES.SWITCHING, null],
    ['authority key changes', TENANT_AUTHORITY_STATES.READY, 'authority-b'],
  ])('denies a pending confirmation when %s', async (_label, nextState, nextKey) => {
    const onResult = vi.fn();
    const mutate = vi.fn();
    const { rerender } = render(
      <AuthorityTree
        authorityState={TENANT_AUTHORITY_STATES.READY}
        authorityKey="authority-a"
        onResult={onResult}
        mutate={mutate}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Request protected mutation' }));
    expect(await screen.findByText('Delete protected record?')).toBeInTheDocument();

    rerender(
      <AuthorityTree
        authorityState={nextState}
        authorityKey={nextKey}
        onResult={onResult}
        mutate={mutate}
      />,
    );

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
    expect(mutate).not.toHaveBeenCalled();
    expect(screen.queryByText('Delete protected record?')).not.toBeInTheDocument();
  });
});
