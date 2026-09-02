import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AIContentResponsibilityAgreement from './AIContentResponsibilityAgreement';
import {
  AI_CONTENT_AGREEMENT_ACKNOWLEDGMENTS,
  AI_CONTENT_AGREEMENT_VERSION,
} from '@/lib/aiContentAgreement';

// --- Mocks for the gate's collaborators ---------------------------------------
const updateMe = vi.fn(() => Promise.resolve());
const createUserActivity = vi.fn(() => Promise.resolve());
vi.mock('@/api/base44Client', () => ({
  base44: {
    auth: { updateMe: (...args) => updateMe(...args) },
    entities: { UserActivity: { create: (...args) => createUserActivity(...args) } },
  },
}));

const refreshUser = vi.fn(() => Promise.resolve());
const logout = vi.fn();
vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'nurse@example.com' }, refreshUser, logout }),
}));

const invalidateQueries = vi.fn();
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries }),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe('AIContentResponsibilityAgreement', () => {
  beforeEach(() => {
    updateMe.mockClear();
    createUserActivity.mockClear();
    refreshUser.mockClear();
    logout.mockClear();
    invalidateQueries.mockClear();
  });

  it('renders one required acknowledgment checkbox per responsibility', () => {
    render(<AIContentResponsibilityAgreement />);
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(AI_CONTENT_AGREEMENT_ACKNOWLEDGMENTS.length);
  });

  it('keeps "I Agree & Continue" disabled until every acknowledgment is checked', () => {
    render(<AIContentResponsibilityAgreement />);
    const agree = screen.getByRole('button', { name: /i agree & continue/i });
    expect(agree).toBeDisabled();

    const boxes = screen.getAllByRole('checkbox');
    // Check all but the last — still blocked.
    boxes.slice(0, -1).forEach((b) => fireEvent.click(b));
    expect(agree).toBeDisabled();

    // Check the final one — now enabled.
    fireEvent.click(boxes[boxes.length - 1]);
    expect(agree).toBeEnabled();
  });

  it('records the sign-off (updateMe + audit) and refreshes auth on accept', async () => {
    render(<AIContentResponsibilityAgreement />);
    screen.getAllByRole('checkbox').forEach((b) => fireEvent.click(b));
    fireEvent.click(screen.getByRole('button', { name: /i agree & continue/i }));

    await waitFor(() => expect(updateMe).toHaveBeenCalledTimes(1));

    const patch = updateMe.mock.calls[0][0];
    expect(patch.ai_content_agreement_accepted).toBe(true);
    expect(patch.ai_content_agreement_version).toBe(AI_CONTENT_AGREEMENT_VERSION);
    expect(typeof patch.ai_content_agreement_accepted_at).toBe('string');

    await waitFor(() => expect(refreshUser).toHaveBeenCalledTimes(1));
    expect(createUserActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ai_content_agreement_accepted' }),
    );
    // The durable attestation must be written BEFORE the User flag: if the
    // audit write fails, the gate must stay unsatisfied so the user retries.
    expect(createUserActivity.mock.invocationCallOrder[0]).toBeLessThan(
      updateMe.mock.invocationCallOrder[0],
    );
    expect(invalidateQueries).toHaveBeenCalled();
  });

  it('does not set the acceptance flag when the attestation write fails', async () => {
    createUserActivity.mockRejectedValueOnce(new Error('audit down'));
    render(<AIContentResponsibilityAgreement />);
    screen.getAllByRole('checkbox').forEach((b) => fireEvent.click(b));
    fireEvent.click(screen.getByRole('button', { name: /i agree & continue/i }));

    await waitFor(() => expect(createUserActivity).toHaveBeenCalledTimes(1));
    expect(updateMe).not.toHaveBeenCalled();
    expect(refreshUser).not.toHaveBeenCalled();
  });

  it('does not persist when the user chooses to sign out instead', () => {
    render(<AIContentResponsibilityAgreement />);
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));
    expect(logout).toHaveBeenCalledTimes(1);
    expect(updateMe).not.toHaveBeenCalled();
  });
});
