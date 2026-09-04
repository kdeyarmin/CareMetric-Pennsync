import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AIContentResponsibilityAgreement from './AIContentResponsibilityAgreement';
import {
  AI_CONTENT_AGREEMENT_ACKNOWLEDGMENTS,
  AI_CONTENT_AGREEMENT_VERSION,
} from '@/lib/aiContentAgreement';

// --- Mocks for the gate's collaborators ---------------------------------------
const acceptAgreement = vi.fn(() => Promise.resolve());
vi.mock('@/functions/acceptAiContentAgreement', () => ({
  acceptAiContentAgreement: (...args) => acceptAgreement(...args),
}));

const logout = vi.fn();
vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'nurse@example.com' }, logout }),
}));

const invalidateQueries = vi.fn();
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries }),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe('AIContentResponsibilityAgreement', () => {
  beforeEach(() => {
    acceptAgreement.mockReset().mockResolvedValue({ data: { success: true } });
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

  it('records the sign-off and requires a protected status recheck on accept', async () => {
    const onAccepted = vi.fn(() => Promise.resolve());
    render(<AIContentResponsibilityAgreement onAccepted={onAccepted} />);
    screen.getAllByRole('checkbox').forEach((b) => fireEvent.click(b));
    fireEvent.click(screen.getByRole('button', { name: /i agree & continue/i }));

    await waitFor(() => expect(acceptAgreement).toHaveBeenCalledTimes(1));
    expect(acceptAgreement).toHaveBeenCalledWith({
      accepted: true,
      agreement_version: AI_CONTENT_AGREEMENT_VERSION,
    });

    await waitFor(() => expect(onAccepted).toHaveBeenCalledTimes(1));
    expect(invalidateQueries).toHaveBeenCalled();
  });

  it('does not set the acceptance flag when the attestation write fails', async () => {
    acceptAgreement.mockRejectedValueOnce(new Error('audit down'));
    render(<AIContentResponsibilityAgreement />);
    screen.getAllByRole('checkbox').forEach((b) => fireEvent.click(b));
    fireEvent.click(screen.getByRole('button', { name: /i agree & continue/i }));

    await waitFor(() => expect(acceptAgreement).toHaveBeenCalledTimes(1));
    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it('restores the retry control when protected verification does not confirm acceptance', async () => {
    const onAccepted = vi.fn(() => Promise.reject(new Error('not yet visible')));
    render(<AIContentResponsibilityAgreement onAccepted={onAccepted} />);
    screen.getAllByRole('checkbox').forEach((b) => fireEvent.click(b));
    const agree = screen.getByRole('button', { name: /i agree & continue/i });
    fireEvent.click(agree);

    await waitFor(() => expect(onAccepted).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(agree).toBeEnabled());
  });

  it('does not persist when the user chooses to sign out instead', () => {
    render(<AIContentResponsibilityAgreement />);
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));
    expect(logout).toHaveBeenCalledTimes(1);
    expect(acceptAgreement).not.toHaveBeenCalled();
  });
});
