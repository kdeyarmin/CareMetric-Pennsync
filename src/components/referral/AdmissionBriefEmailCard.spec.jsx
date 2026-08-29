import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { authMe, userList, sendEmail, notificationCreate } = vi.hoisted(() => ({
  authMe: vi.fn(),
  userList: vi.fn(),
  sendEmail: vi.fn(),
  notificationCreate: vi.fn(),
}));

vi.mock('@/api/base44Client', () => ({
  base44: {
    auth: { me: (...a) => authMe(...a) },
    entities: {
      User: { list: (...a) => userList(...a) },
      Notification: { create: (...a) => notificationCreate(...a) },
    },
    integrations: { Core: { SendEmail: (...a) => sendEmail(...a) } },
  },
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

// Radix Select needs real pointer events; shim it with plain buttons so this
// spec exercises the CARD's logic (roster scoping, brief construction, send
// flow), not Radix internals.
vi.mock('@/components/ui/select', async () => {
  const React = await import('react');
  const Ctx = React.createContext(() => {});
  return {
    Select: ({ onValueChange, children }) => <Ctx.Provider value={onValueChange}>{children}</Ctx.Provider>,
    SelectTrigger: ({ children, ...props }) => <div {...props}>{children}</div>,
    SelectValue: ({ placeholder }) => <span>{placeholder}</span>,
    SelectContent: ({ children }) => <div>{children}</div>,
    SelectItem: ({ value, children }) => {
      const onValueChange = React.useContext(Ctx);
      return (
        <button type="button" onClick={() => onValueChange(value)}>
          {children}
        </button>
      );
    },
  };
});

import AdmissionBriefEmailCard from '@/components/referral/AdmissionBriefEmailCard';

const referralData = {
  demographics: { full_name: 'Jane Doe', insurance_primary: 'Medicare' },
  skilled_needs: { frequency_duration: 'SN 3w2, 2w2, 1w5', services_ordered: ['SN 3w2, 2w2, 1w5'] },
  diagnoses: { primary_diagnosis: 'CHF (I50.9)', primary_icd10: 'I50.9', allergies: 'Penicillin' },
};

const AGENCY_A = { email: 'intake@a.example', full_name: 'Dana Intake', agency_name: 'Agency A', account_type: 'agency_admin' };

const roster = [
  { id: 'u1', email: 'kelly@a.example', full_name: 'Kelly Nurse', credential_type: 'RN', agency_name: 'Agency A', is_active: true },
  { id: 'u2', email: 'sam@a.example', full_name: 'Sam Inactive', agency_name: 'Agency A', is_active: false },
  { id: 'u3', email: 'other@b.example', full_name: 'Other Tenant', agency_name: 'Agency B', is_active: true },
  { id: 'u4', email: 'jordan@a.example', full_name: 'Jordan Nurse', credential_type: 'RN', agency_name: 'Agency A', is_active: true },
];

const renderCard = (props = {}) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AdmissionBriefEmailCard referralData={referralData} analysis={null} {...props} />
    </QueryClientProvider>
  );

beforeEach(() => {
  authMe.mockReset().mockResolvedValue(AGENCY_A);
  userList.mockReset().mockResolvedValue(roster);
  sendEmail.mockReset().mockResolvedValue({});
  notificationCreate.mockReset().mockResolvedValue({});
});

describe('AdmissionBriefEmailCard', () => {
  it('offers only ACTIVE staff from the caller\'s agency as recipients', async () => {
    renderCard();
    expect(await screen.findByText(/Kelly Nurse, RN — kelly@a\.example/)).toBeInTheDocument();
    expect(screen.queryByText(/Sam Inactive/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Other Tenant/)).not.toBeInTheDocument();
    // No recipient chosen yet → send is disabled.
    expect(screen.getByRole('button', { name: /Email briefing/i })).toBeDisabled();
  });

  it('emails the selected nurse the full brief and records an in-app notification', async () => {
    renderCard({ sourceFileUrl: 'https://files.example/referral.pdf' });
    await userEvent.click(await screen.findByText(/Kelly Nurse, RN — kelly@a\.example/));
    await userEvent.click(screen.getByRole('button', { name: /Email briefing/i }));

    await waitFor(() => expect(sendEmail).toHaveBeenCalledTimes(1));
    const sent = sendEmail.mock.calls[0][0];
    expect(sent.to).toBe('kelly@a.example');
    // Subject carries initials, never the full patient name.
    expect(sent.subject).toContain('J.D.');
    expect(sent.subject).not.toContain('Jane');
    // Body carries the payer-optimized plan, alerts, and the document link.
    expect(sent.body).toContain('Skilled Nursing: 3/wk × 2 wks');
    expect(sent.body).toContain('LUPA');
    expect(sent.body).toContain('Allergies: Penicillin');
    expect(sent.body).toContain('https://files.example/referral.pdf');
    // Personalized to the selected nurse.
    expect(sent.body).toContain('To: Kelly Nurse');

    await waitFor(() => expect(notificationCreate).toHaveBeenCalledTimes(1));
    expect(notificationCreate.mock.calls[0][0]).toMatchObject({
      user_email: 'kelly@a.example',
      type: 'new_referral',
    });
    expect(await screen.findByText(/Sent to Kelly Nurse/)).toBeInTheDocument();
  });

  it('a notification failure does not fail the send', async () => {
    notificationCreate.mockRejectedValueOnce(new Error('notif down'));
    renderCard();
    await userEvent.click(await screen.findByText(/Kelly Nurse, RN — kelly@a\.example/));
    await userEvent.click(screen.getByRole('button', { name: /Email briefing/i }));
    await waitFor(() => expect(sendEmail).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Sent to Kelly Nurse/)).toBeInTheDocument();
  });

  it('a send failure surfaces an error and records no sent badge', async () => {
    sendEmail.mockRejectedValueOnce(Object.assign(new Error('smtp down'), { status: 500 }));
    renderCard();
    await userEvent.click(await screen.findByText(/Kelly Nurse, RN — kelly@a\.example/));
    await userEvent.click(screen.getByRole('button', { name: /Email briefing/i }));
    await waitFor(() => expect(sendEmail).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/Sent to/)).not.toBeInTheDocument();
    expect(notificationCreate).not.toHaveBeenCalled();
  });

  it('sends the intake-edited body instead of the generated one', async () => {
    renderCard();
    await userEvent.click(await screen.findByText(/Kelly Nurse, RN — kelly@a\.example/));
    await userEvent.click(screen.getByRole('button', { name: /Preview & edit/i }));
    const textarea = screen.getByLabelText(/Briefing email body/i);
    await userEvent.clear(textarea);
    await userEvent.type(textarea, 'EDITED BODY ONLY');
    await userEvent.click(screen.getByRole('button', { name: /Email briefing/i }));
    await waitFor(() => expect(sendEmail).toHaveBeenCalledTimes(1));
    expect(sendEmail.mock.calls[0][0].body).toBe('EDITED BODY ONLY');
  });

  it('switching recipients discards a hand-edited body so the old nurse\'s personalization never sends', async () => {
    renderCard();
    await userEvent.click(await screen.findByText(/Kelly Nurse, RN — kelly@a\.example/));
    await userEvent.click(screen.getByRole('button', { name: /Preview & edit/i }));
    const textarea = screen.getByLabelText(/Briefing email body/i);
    await userEvent.clear(textarea);
    await userEvent.type(textarea, 'EDITED FOR KELLY');

    // Intake realizes the wrong nurse is selected and switches to Jordan.
    await userEvent.click(screen.getByText(/Jordan Nurse, RN — jordan@a\.example/));
    await userEvent.click(screen.getByRole('button', { name: /Email briefing/i }));

    await waitFor(() => expect(sendEmail).toHaveBeenCalledTimes(1));
    const sent = sendEmail.mock.calls[0][0];
    expect(sent.to).toBe('jordan@a.example');
    // The regenerated body is personalized to Jordan — the stale edit (with
    // Kelly's "To:" line baked in) is gone.
    expect(sent.body).not.toContain('EDITED FOR KELLY');
    expect(sent.body).toContain('To: Jordan Nurse');
  });

  it('switching to a different referral discards the edited body and recipient (PHI guard)', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrap = (data) => (
      <QueryClientProvider client={client}>
        <AdmissionBriefEmailCard referralData={data} analysis={null} />
      </QueryClientProvider>
    );
    const { rerender } = render(wrap(referralData));
    await userEvent.click(await screen.findByText(/Kelly Nurse, RN — kelly@a\.example/));
    await userEvent.click(screen.getByRole('button', { name: /Preview & edit/i }));
    const textarea = screen.getByLabelText(/Briefing email body/i);
    await userEvent.clear(textarea);
    await userEvent.type(textarea, 'EDITED BODY ONLY');

    // Patient B's referral arrives in the same mounted card.
    rerender(wrap({ ...referralData, demographics: { ...referralData.demographics, full_name: 'Patient B' } }));
    // The previous patient's edited text is gone…
    expect(screen.queryByDisplayValue('EDITED BODY ONLY')).not.toBeInTheDocument();
    // …and the previous recipient selection was cleared, so Send is disabled
    // until a fresh, deliberate choice is made for the new patient.
    expect(screen.getByRole('button', { name: /Email briefing/i })).toBeDisabled();
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
