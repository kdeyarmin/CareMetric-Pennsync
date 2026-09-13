import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/testUtils';

const { readUser, updateUser } = vi.hoisted(() => ({
  readUser: vi.fn(),
  updateUser: vi.fn(),
}));

vi.mock('@/api/base44Client', () => ({
  base44: { auth: { me: readUser, updateMe: updateUser } },
}));
vi.mock('@/functions/createAuthorizedPatient', () => ({
  createAuthorizedPatient: vi.fn(),
  createPatientRequestId: () => 'synthetic-request',
}));
vi.mock('@/lib/tenantSdkRealmGate', () => ({
  captureTenantSdkRealmLease: () => ({}),
  assertTenantSdkRealmLeaseCurrent: () => {},
  getTenantSdkRealmAbortSignal: () => new AbortController().signal,
}));

import SearchablePatientSelect from './SearchablePatientSelect';

const email = 'favorites@example.test';
const cacheKey = `favoritedPatients_${email}`;
const profileIds = Array.from({ length: 150 }, (_, index) => `profile-${index}`);
const originalScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  localStorage.clear();
  vi.clearAllMocks();
  readUser.mockResolvedValue({ email, favorited_patients: profileIds });
  updateUser.mockResolvedValue({});
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalScrollIntoView) {
    Object.defineProperty(Element.prototype, 'scrollIntoView', originalScrollIntoView);
  } else {
    delete Element.prototype.scrollIntoView;
  }
});

describe('persisted favorites are not limited by the local cache', () => {
  it('preserves the full profile on writeback while capping only local storage', async () => {
    renderWithProviders(<SearchablePatientSelect patients={[
      { id: 'profile-149', first_name: 'Last', last_name: 'Favorite' },
    ]} />);
    await waitFor(() => expect(readUser).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('combobox'));
    const option = await screen.findByRole('option', { name: /Last Favorite/i });
    fireEvent.click(within(option).getByRole('button'));

    await waitFor(() => expect(updateUser).toHaveBeenCalledTimes(1));
    const written = updateUser.mock.calls[0][0].favorited_patients;
    expect(written).toEqual(profileIds.slice(0, -1));
    const cached = JSON.parse(localStorage.getItem(cacheKey));
    expect(cached).toHaveLength(100);
    expect(cached).toEqual(profileIds.slice(0, 100));
  });

  it('keeps all persisted IDs and bounded local-only additions when starring another patient', async () => {
    localStorage.setItem(cacheKey, JSON.stringify(['local-only', ...profileIds]));
    renderWithProviders(<SearchablePatientSelect patients={[
      { id: 'new-patient', first_name: 'New', last_name: 'Favorite' },
    ]} />);
    await waitFor(() => expect(readUser).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('combobox'));
    const option = await screen.findByRole('option', { name: /New Favorite/i });
    fireEvent.click(within(option).getByRole('button'));

    await waitFor(() => expect(updateUser).toHaveBeenCalledTimes(1));
    expect(updateUser.mock.calls[0][0].favorited_patients)
      .toEqual([...profileIds, 'local-only', 'new-patient']);
    expect(JSON.parse(localStorage.getItem(cacheKey))).toHaveLength(100);
  });
});
