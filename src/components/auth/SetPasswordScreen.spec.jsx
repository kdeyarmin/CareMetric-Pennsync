// The screen a staff member lands on from an invitation or a recovery link.
//
// Nothing here sends anything, no real address appears, and the transport is a
// mock: the halves that would send mail are not in the client at all.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SetPasswordScreen, { MINIMUM_PASSWORD_LENGTH } from './SetPasswordScreen';

const setPasswordFromLink = vi.fn();
vi.mock('@/lib/independentStagingSession', () => ({
  get ownedBackendAuth() { return { setPasswordFromLink }; },
  get independentStagingAuth() { return null; },
}));

const INVITE = Object.freeze({ type: 'invite', token: 'invitetoken-aaaaaa' });
const RECOVERY = Object.freeze({ type: 'recovery', token: 'recoverytoken-bbbbbb' });
const ADDRESS = 'nurse@agency.example';
const PASSWORD = 'a-new-long-password';

const fill = async (user, { email = ADDRESS, password = PASSWORD, confirmation = password } = {}) => {
  if (email) await user.type(screen.getByLabelText('Work email'), email);
  if (password) await user.type(screen.getByLabelText('New password'), password);
  if (confirmation) await user.type(screen.getByLabelText('Repeat new password'), confirmation);
};

describe('setting a password from a link', () => {
  beforeEach(() => { setPasswordFromLink.mockReset().mockResolvedValue({ id: 'x' }); });
  afterEach(() => { cleanup(); });

  it('asks for the address rather than reading it from the link', async () => {
    const user = userEvent.setup();
    render(<SetPasswordScreen link={INVITE} />);
    // The link carries no address, so a forwarded one names nobody and no address
    // ever goes in a URL. The person accepting knows their own.
    expect(screen.getByLabelText('Work email')).toHaveValue('');
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Accept invitation' }));
    await waitFor(() => expect(setPasswordFromLink).toHaveBeenCalledWith(
      ADDRESS, 'invite', INVITE.token, PASSWORD));
  });

  it('hands the person to sign-in rather than signing them in', async () => {
    const onPasswordSet = vi.fn();
    const user = userEvent.setup();
    render(<SetPasswordScreen link={RECOVERY} onPasswordSet={onPasswordSet} />);
    await fill(user, { email: 'Nurse@Agency.Example  ' });
    await user.click(screen.getByRole('button', { name: 'Set password' }));
    // The property the client exists to hold: a link never becomes a session.
    // This screen has no way to sign anybody in, and the address it passes on is
    // normalised so the sign-in form is filled with what was actually used.
    expect(await screen.findByText(/Your password is set\. Sign in with it to continue\./)).toBeInTheDocument();
    // And the handover waits for the person's own click: its caller unmounts this
    // screen, so performing it on success would take the confirmation away in the
    // same tick as it appeared.
    expect(onPasswordSet).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Go to sign in' }));
    await waitFor(() => expect(onPasswordSet).toHaveBeenCalledWith(ADDRESS));
  });

  it('says what is different before anything leaves the browser', async () => {
    const user = userEvent.setup();
    render(<SetPasswordScreen link={INVITE} />);
    await fill(user, { confirmation: 'a-different-password' });
    await user.click(screen.getByRole('button', { name: 'Accept invitation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Those two passwords are different.');
    expect(setPasswordFromLink).not.toHaveBeenCalled();
  });

  it('names the minimum rather than letting a refusal discover it', async () => {
    const user = userEvent.setup();
    render(<SetPasswordScreen link={INVITE} />);
    expect(screen.getByText(`At least ${MINIMUM_PASSWORD_LENGTH} characters.`)).toBeInTheDocument();
    await fill(user, { password: 'short' });
    await user.click(screen.getByRole('button', { name: 'Accept invitation' }));
    expect(await screen.findByRole('alert'))
      .toHaveTextContent(`at least ${MINIMUM_PASSWORD_LENGTH} characters`);
    expect(setPasswordFromLink).not.toHaveBeenCalled();
  });

  it('tells a person with a spent link what to do, in the words of the link they used', async () => {
    const user = userEvent.setup();
    const rejection = Object.assign(new Error('AUTHENTICATION_FAILED'), { code: 'AUTHENTICATION_FAILED' });
    setPasswordFromLink.mockRejectedValue(rejection);
    render(<SetPasswordScreen link={INVITE} />);
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Accept invitation' }));
    // Asking for a new link would be a message to a real person, which this
    // change does not send, so the answer is to ask an administrator.
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This invitation link is no longer valid, or it was issued for a different email address. Ask your administrator to send a new one.');

    cleanup();
    render(<SetPasswordScreen link={RECOVERY} />);
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Set password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This password reset link is no longer valid');
  });

  it('keeps no password in the form after a failure', async () => {
    const user = userEvent.setup();
    setPasswordFromLink.mockRejectedValue(Object.assign(new Error('x'), { code: 'AUTHORITY_NETWORK_FAILED' }));
    render(<SetPasswordScreen link={INVITE} />);
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Accept invitation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('unavailable right now');
    // Nothing on this screen needs them again, so a failure leaves the fields
    // empty rather than holding a password through whatever the failure was.
    expect(screen.getByLabelText('New password')).toHaveValue('');
    expect(screen.getByLabelText('Repeat new password')).toHaveValue('');
  });

  it('says plainly that a staging build cannot set one', async () => {
    const user = userEvent.setup();
    setPasswordFromLink.mockRejectedValue(
      Object.assign(new Error('x'), { code: 'STAGING_OPERATION_UNAVAILABLE' }));
    render(<SetPasswordScreen link={INVITE} />);
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Accept invitation' }));
    expect(await screen.findByRole('alert'))
      .toHaveTextContent('This build cannot set passwords. Its accounts are configured with the build.');
  });
});
