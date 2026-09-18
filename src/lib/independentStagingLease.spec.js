import { expect, it, vi } from 'vitest';

const inner = vi.hoisted(() => ({ rpc: vi.fn(), invalidate: vi.fn() }));
vi.mock('../../services/authority-client/client.mjs', () => ({
  STAGING_APP_ID: '6a9881683dc68a0bd54f1ef7',
  createStagingAuthorityClient: () => ({
    signIn: async () => {}, signOut: async () => {},
    // The underlying operation has already returned its validated result.
    // Invalidation cannot retract it; the outer adapter must fence its own await.
    rpc: inner.rpc, invalidate: inner.invalidate,
  }),
}));
import { createIndependentStagingAdapter } from './independentStagingAdapter';

it('fences the app continuation after an underlying RPC has already resolved', async () => {
  const email = 'info+pennsync-admin-a@caremetricai.com';
  const adapter = createIndependentStagingAdapter({ target: {}, actors: { [email]: 'synthetic-native-id' } });
  await adapter.auth.signIn(email, 'Synthetic-model-password');
  inner.rpc.mockReturnValue(Promise.resolve({ user_id: 'legacy-user', user_email: email }));
  const pending = adapter.authority.me();
  expect(inner.rpc).toHaveBeenCalledWith('memberships', {});
  adapter.raw.cleanup();
  await expect(pending).rejects.toMatchObject({ code: 'STALE_AUTHORITY_SESSION' });
  expect(adapter.auth.hasSession()).toBe(false);
  expect(inner.invalidate).toHaveBeenCalledOnce();
});
