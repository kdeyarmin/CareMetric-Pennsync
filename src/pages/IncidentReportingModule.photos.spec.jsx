/**
 * The incident composer previews a photo from the local file and stores the
 * uploaded locator. Those are two different values for one photo, held in two
 * pieces of state, and `removePhoto` has to clear both — so a spec that only
 * checked the thumbnails would pass while the submitted `photo_urls` still
 * carried a photo the reporter had deleted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/testUtils';

const { uploadFile, submitIncidentReport, toastError } = vi.hoisted(() => ({
  uploadFile: vi.fn(),
  submitIncidentReport: vi.fn(async () => ({ incident: { id: 'incident-a' } })),
  toastError: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { error: toastError, success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/functions/submitIncidentReport', () => ({
  submitIncidentReport: (...args) => submitIncidentReport(...args),
}));
vi.mock('@/functions/updateIncident', () => ({ transitionIncident: vi.fn() }));

vi.mock('@/lib/roles', () => ({ isAdminView: () => false }));

vi.mock('@/hooks/useAgencyScopedQuery', () => ({
  useAgencyScopedQuery: () => ({ data: [], isLoading: false }),
}));
vi.mock('@/hooks/useScopedPatients', () => ({
  useScopedPatients: () => ({
    data: [{ id: 'patient-a', first_name: 'Ada', last_name: 'Byron' }],
  }),
}));

vi.mock('@/api/base44Client', async () => {
  const { makeBase44Stub } = await import('@/test/testUtils');
  const stub = makeBase44Stub({ auth: { me: async () => ({ email: 'nurse@x.com' }) } });
  return {
    base44: {
      ...stub,
      integrations: { Core: { UploadFile: (...args) => uploadFile(...args) } },
    },
  };
});

// Radix Select needs real pointer events; shim it with plain buttons so this
// spec exercises the composer's photo state rather than Radix internals.
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
      return <button type="button" onClick={() => onValueChange(value)}>{children}</button>;
    },
  };
});

import IncidentReportingModule from '@/pages/IncidentReportingModule';

const photo = (name) => new File([name], name, { type: 'image/jpeg' });

/** Open the report dialog and hand back its hidden file input. */
const openComposer = async (user) => {
  await user.click(screen.getByRole('button', { name: /report incident/i }));
  const input = await screen.findByLabelText(/upload photos/i, { selector: 'input[type="file"]' })
    .catch(() => document.querySelector('input[type="file"]'));
  return input || document.querySelector('input[type="file"]');
};

describe('incident composer photos', () => {
  let created;

  beforeEach(() => {
    vi.clearAllMocks();
    created = [];
    let n = 0;
    uploadFile.mockImplementation(async () => ({ file_url: `https://files.test/stored-${++n}.jpg` }));
    let b = 0;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      const url = `blob:local/preview-${++b}`;
      created.push(url);
      return url;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  it('previews from the local file rather than the uploaded copy', async () => {
    const user = userEvent.setup();
    renderWithProviders(<IncidentReportingModule />);
    const input = await openComposer(user);

    fireEvent.change(input, { target: { files: [photo('one.jpg'), photo('two.jpg')] } });

    await waitFor(() => expect(document.querySelectorAll('img').length).toBe(2));
    const sources = [...document.querySelectorAll('img')].map(i => i.getAttribute('src'));
    expect(sources).toEqual(created);
    // The uploaded locator is never handed to the browser to fetch back.
    expect(sources.some(s => s.startsWith('https://files.test/'))).toBe(false);
  });

  it('removes the matching locator, not just the thumbnail', async () => {
    const user = userEvent.setup();
    renderWithProviders(<IncidentReportingModule />);
    const input = await openComposer(user);

    fireEvent.change(input, { target: { files: [photo('one.jpg'), photo('two.jpg')] } });
    await waitFor(() => expect(document.querySelectorAll('img').length).toBe(2));

    // Delete the FIRST photo. Its preview must go, its locator must go, and the
    // second photo's locator must survive.
    const [firstRemove] = [...document.querySelectorAll('img')]
      .map(img => img.parentElement.querySelector('button'));
    fireEvent.click(firstRemove);

    await waitFor(() => expect(document.querySelectorAll('img').length).toBe(1));
    expect(document.querySelector('img').getAttribute('src')).toBe(created[1]);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(created[0]);

    await user.click(screen.getByRole('button', { name: 'Ada Byron' }));
    await user.click(screen.getByRole('button', { name: 'Fall' }));
    fireEvent.change(screen.getByPlaceholderText(/detailed description/i), {
      target: { value: 'Patient slipped in the bathroom.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /submit report/i }));

    await waitFor(() => expect(submitIncidentReport).toHaveBeenCalledTimes(1));
    expect(submitIncidentReport.mock.calls[0][0].photo_urls)
      .toEqual(['https://files.test/stored-2.jpg']);
  });
});
