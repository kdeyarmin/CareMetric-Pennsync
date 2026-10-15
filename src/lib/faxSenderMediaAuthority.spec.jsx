import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mediaRealm = vi.hoisted(() => {
  let controller;
  let current;
  let lease;
  let scopes;

  const stale = () => Object.assign(new Error('expired'), {
    code: 'STALE_TENANT_SDK_OPERATION',
  });

  const create = vi.fn((...args) => {
    const candidate = args.length === 0 ? lease : args[0];
    if (!current || candidate !== lease) throw stale();
    let active = true;
    const scopeController = new AbortController();
    const teardowns = new Set();
    const scope = {
      addTeardown(teardown) {
        if (!active) {
          teardown();
          return () => {};
        }
        teardowns.add(teardown);
        return () => teardowns.delete(teardown);
      },
      assertCurrent() {
        if (!active || !current || controller.signal.aborted) throw stale();
        return candidate;
      },
      dispose() {
        if (!active) return;
        active = false;
        scopeController.abort();
        scopes.delete(scope);
        for (const teardown of [...teardowns].reverse()) teardown();
        teardowns.clear();
      },
      isCurrent: () => active && current && !controller.signal.aborted,
      realmLease: candidate,
      signal: scopeController.signal,
    };
    scopes.add(scope);
    return Object.freeze(scope);
  });

  return {
    abort() {
      current = false;
      controller.abort();
      for (const scope of [...scopes]) scope.dispose();
    },
    create,
    lease: () => lease,
    reset() {
      controller = new AbortController();
      current = true;
      lease = Object.freeze({});
      scopes = new Set();
      create.mockClear();
    },
  };
});

const sdk = vi.hoisted(() => ({
  invoke: vi.fn(),
  upload: vi.fn(),
}));

const camera = vi.hoisted(() => ({
  acquire: vi.fn(),
  stop: vi.fn((stream) => {
    for (const track of stream?.getTracks?.() || []) track.stop();
  }),
}));

const fax = vi.hoisted(() => ({ send: vi.fn() }));
const notifications = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));

const documentAccess = vi.hoisted(() => ({
  getAuthorized: vi.fn(),
  documentsQuery: vi.fn(),
}));

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

vi.mock('@/lib/authorityBoundMediaProcessing', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createAuthorityBoundMediaOperation: mediaRealm.create,
    loadAuthorityBoundImage: vi.fn(async (operation) => {
      operation.assertCurrent();
      return { height: 200, width: 100 };
    }),
    readAuthorityBoundDataUrl: vi.fn(async (operation) => {
      operation.assertCurrent();
      return 'data:image/jpeg;base64,ZmF4';
    }),
  };
});

vi.mock('@/api/base44Client', () => ({
  base44: {
    functions: { invoke: sdk.invoke },
    integrations: { Core: { UploadFile: sdk.upload } },
  },
}));

vi.mock('@/lib/tenantMediaDevices', () => ({
  getAuthorityBoundUserMedia: camera.acquire,
  stopMediaStream: camera.stop,
}));

vi.mock('@/functions/sendFax', () => ({ sendFax: fax.send }));
vi.mock('@/functions/getAuthorizedDocument', () => ({
  getAuthorizedDocument: documentAccess.getAuthorized,
}));
vi.mock('@/hooks/useAuthorizedDocuments', () => ({
  useAuthorizedDocuments: documentAccess.documentsQuery,
}));
vi.mock('@/components/fax/FaxOCRExtractor', () => ({ default: () => null }));
// A native stand-in for the Radix select, so the document sender test drives
// real choices (same pattern as SignatureRequestCreator.spec.jsx).
vi.mock('@/components/ui/select', async () => {
  const React = await import('react');
  const Context = React.createContext(null);
  return {
    Select: ({ value, onValueChange, children }) => (
      <Context.Provider value={{ value, onValueChange }}>{children}</Context.Provider>
    ),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: function SelectContent({ children }) {
      const context = React.useContext(Context);
      return (
        <select value={context.value} onChange={(event) => context.onValueChange(event.target.value)}>
          <option value="" />
          {children}
        </select>
      );
    },
    SelectItem: ({ value, children }) => <option value={value}>{children}</option>,
  };
});
vi.mock('sonner', () => ({ toast: notifications }));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('@/components/fax/FaxAddressBook', () => ({ default: () => null }));
vi.mock('@/components/fax/FaxSignaturePanel', () => ({ default: () => null }));
vi.mock('@/components/fax/FaxCoverSheetGenerator', () => ({ default: () => null }));

vi.mock('jspdf', () => {
  class MockPdf {
    constructor() {
      this.internal = {
        pageSize: {
          getHeight: () => 297,
          getWidth: () => 210,
        },
      };
    }

    addImage() {}
    addPage() {}
    output() { return new Blob(['pdf'], { type: 'application/pdf' }); }
  }
  return { default: MockPdf, jsPDF: MockPdf };
});

import { MemoryRouter } from 'react-router';
import DocumentFaxSender from '@/components/fax/DocumentFaxSender';
import EnhancedCameraFaxSender from '@/components/fax/EnhancedCameraFaxSender';
import PhotoUploadFaxSender from '@/components/fax/PhotoUploadFaxSender';

describe('fax sender exact media authority integration', () => {
  beforeEach(() => {
    mediaRealm.reset();
    sdk.invoke.mockReset();
    sdk.upload.mockReset();
    camera.acquire.mockReset();
    camera.stop.mockClear();
    fax.send.mockReset();
    documentAccess.getAuthorized.mockReset();
    documentAccess.getAuthorized.mockResolvedValue({
      delivery: { download_url: 'https://files.test/authorized.pdf' },
    });
    documentAccess.documentsQuery.mockReset();
    documentAccess.documentsQuery.mockReturnValue({
      data: [{
        id: 'doc-1',
        title: 'Visit note',
        file_name: 'visit.pdf',
        file_type: 'application/pdf',
      }],
      isSuccess: true,
      isLoading: false,
      isError: false,
      tenantScope: { agency_id: 'agency-1' },
    });
    notifications.error.mockClear();
    notifications.success.mockClear();
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('detaches an exact-lease camera preview and blocks native escape surfaces on abort', async () => {
    const stopTrack = vi.fn();
    const stream = { getTracks: () => [{ stop: stopTrack }] };
    camera.acquire.mockResolvedValue({ realmLease: mediaRealm.lease(), stream });
    const { container } = render(<EnhancedCameraFaxSender />);

    fireEvent.click(await screen.findByRole('button', { name: /start camera/i }));
    const video = await waitFor(() => {
      const candidate = container.querySelector('video');
      expect(candidate).not.toBeNull();
      expect(candidate.srcObject).toBe(stream);
      return candidate;
    });
    expect(video.controls).toBe(false);
    expect(video).toHaveAttribute('controlslist', 'nodownload nofullscreen noremoteplayback');
    expect(video).toHaveAttribute('disablepictureinpicture');
    expect(video).toHaveAttribute('disableremoteplayback');
    expect(video).toHaveAttribute('x-webkit-airplay', 'deny');
    const contextMenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    video.dispatchEvent(contextMenu);
    expect(contextMenu.defaultPrevented).toBe(true);
    video.onended = vi.fn();

    act(() => mediaRealm.abort());

    expect(stopTrack).toHaveBeenCalled();
    expect(video.srcObject).toBeNull();
    expect(video.onended).toBeNull();
    expect(screen.getByRole('button', { name: /start camera/i })).toBeDisabled();
  });

  it('does not begin PDF upload or fax send after authority aborts during image fetch', async () => {
    sdk.upload.mockResolvedValueOnce({ file_url: 'https://files.test/uploaded-image.jpg' });
    let resolveFetch;
    const responseBlob = vi.fn().mockResolvedValue(new Blob(['image'], { type: 'image/jpeg' }));
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { resolveFetch = resolve; })));
    const { container } = render(<PhotoUploadFaxSender />);
    const fileInput = container.querySelector('input[type="file"]');
    const imageFile = new File(['image'], 'visit.jpg', { type: 'image/jpeg' });

    fireEvent.change(fileInput, { target: { files: [imageFile] } });
    await waitFor(() => expect(container.querySelector('img')).toHaveAttribute(
      'src',
      'https://files.test/uploaded-image.jpg',
    ));
    fireEvent.change(screen.getByPlaceholderText('+1234567890'), {
      target: { value: '+15555550123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send fax/i }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    act(() => mediaRealm.abort());
    await act(async () => {
      resolveFetch({ blob: responseBlob });
      await Promise.resolve();
    });

    expect(responseBlob).not.toHaveBeenCalled();
    expect(sdk.upload).toHaveBeenCalledTimes(1);
    expect(sdk.invoke).not.toHaveBeenCalled();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('button', { name: /select photos/i })).toBeDisabled();
  });

  it('does not expose a prefilled recipient when the component cannot capture authority', () => {
    mediaRealm.abort();
    render(<PhotoUploadFaxSender prefilledData={{ recipient_fax_number: '+15555550123' }} />);

    expect(screen.getByPlaceholderText('+1234567890')).toHaveValue('');
    expect(screen.getByPlaceholderText('+1234567890')).toBeDisabled();
    expect(sdk.upload).not.toHaveBeenCalled();
    expect(sdk.invoke).not.toHaveBeenCalled();
  });

  it('aborts an in-flight PDF fetch when the photo sender unmounts', async () => {
    sdk.upload.mockResolvedValueOnce({ file_url: 'https://files.test/uploaded-image.jpg' });
    let fetchSignal;
    vi.stubGlobal('fetch', vi.fn((_url, options) => {
      fetchSignal = options.signal;
      return new Promise((_resolve, reject) => {
        fetchSignal.addEventListener('abort', () => reject(
          Object.assign(new Error('aborted'), { name: 'AbortError' }),
        ), { once: true });
      });
    }));
    const { container, unmount } = render(<PhotoUploadFaxSender />);
    const imageFile = new File(['image'], 'visit.jpg', { type: 'image/jpeg' });

    fireEvent.change(container.querySelector('input[type="file"]'), {
      target: { files: [imageFile] },
    });
    await waitFor(() => expect(container.querySelector('img')).not.toBeNull());
    fireEvent.change(screen.getByPlaceholderText('+1234567890'), {
      target: { value: '+15555550123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send fax/i }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    unmount();

    expect(fetchSignal.aborted).toBe(true);
    await waitFor(() => expect(sdk.invoke).not.toHaveBeenCalled());
    expect(sdk.upload).toHaveBeenCalledTimes(1);
  });

  // Duplicate-send guard + durable confirmation (live incident 2026-10-14: a
  // double submission transmitted two real faxes). The double click is
  // dispatched inside one act so no state flush lands between the clicks —
  // the exact race the isSending flag + disabled button cannot close and the
  // synchronous in-flight ref must.
  const doubleClick = (element) => {
    act(() => {
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
  };

  it('photo sender: a second send invocation while one is in flight is a no-op, and success leaves a durable confirmation', async () => {
    sdk.upload.mockResolvedValue({ file_url: 'https://files.test/uploaded.pdf' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      blob: () => Promise.resolve(new Blob(['image'], { type: 'image/jpeg' })),
    }));
    const sendGate = deferred();
    sdk.invoke.mockImplementation((name) => (
      name === 'sendFax' ? sendGate.promise : Promise.resolve({ data: {} })
    ));
    const { container } = render(
      <MemoryRouter>
        <PhotoUploadFaxSender />
      </MemoryRouter>,
    );
    const imageFile = new File(['image'], 'visit.jpg', { type: 'image/jpeg' });
    fireEvent.change(container.querySelector('input[type="file"]'), {
      target: { files: [imageFile] },
    });
    await waitFor(() => expect(container.querySelector('img')).not.toBeNull());
    fireEvent.change(screen.getByPlaceholderText('+1234567890'), {
      target: { value: '+15555550123' },
    });

    doubleClick(screen.getByRole('button', { name: /send fax/i }));
    await waitFor(() => expect(sdk.invoke).toHaveBeenCalledWith('sendFax', expect.anything()));
    expect(sdk.invoke.mock.calls.filter(([name]) => name === 'sendFax')).toHaveLength(1);

    await act(async () => { sendGate.resolve({ data: { success: true } }); });

    // Durable confirmation: recipient + submission time, honest untracked
    // copy, fax-log link — and it survives the post-send form reset.
    expect(await screen.findByText(/Fax submitted to \+15555550123/)).toBeTruthy();
    expect(container.querySelector('time')).not.toBeNull();
    expect(screen.getByText(/not tracked to delivery inside PennSync/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /view fax log/i }))
      .toHaveAttribute('href', '/SendFax?tab=logs');
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByPlaceholderText('+1234567890')).toHaveValue('');
    expect(screen.getByText(/Fax submitted to \+15555550123/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /dismiss submission confirmation/i }));
    expect(screen.queryByText(/Fax submitted to/)).toBeNull();
  });

  it('camera sender: a second send invocation while one is in flight is a no-op, and success leaves a durable confirmation', async () => {
    const stream = { getTracks: () => [{ stop: vi.fn() }] };
    camera.acquire.mockResolvedValue({ realmLease: mediaRealm.lease(), stream });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue({ drawImage: vi.fn() });
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL')
      .mockReturnValue('data:image/jpeg;base64,ZmF4');
    sdk.upload.mockResolvedValue({ file_url: 'https://files.test/camera-fax.pdf' });
    const sendGate = deferred();
    fax.send.mockImplementation(() => sendGate.promise);
    render(
      <MemoryRouter>
        <EnhancedCameraFaxSender />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /start camera/i }));
    fireEvent.click(await screen.findByRole('button', { name: /capture page 1/i }));
    fireEvent.change(await screen.findByPlaceholderText('+1234567890'), {
      target: { value: '+15555550199' },
    });

    doubleClick(screen.getByRole('button', { name: /send fax/i }));
    await waitFor(() => expect(fax.send).toHaveBeenCalledTimes(1));

    await act(async () => { sendGate.resolve({ success: true }); });

    expect(await screen.findByText(/Fax submitted to \+15555550199/)).toBeTruthy();
    // The post-send reset cleared the captured pages; the confirmation stays.
    expect(screen.queryByText(/page\(s\) captured/)).toBeNull();
    expect(screen.getByText(/Fax submitted to \+15555550199/)).toBeTruthy();
    expect(screen.getByText(/not tracked to delivery inside PennSync/)).toBeTruthy();
  });

  it('document sender: a second send invocation while one is in flight is a no-op, and success leaves a durable confirmation', async () => {
    const sendGate = deferred();
    fax.send.mockImplementation(() => sendGate.promise);
    const { container } = render(
      <MemoryRouter>
        <DocumentFaxSender patientId="patient-1" />
      </MemoryRouter>,
    );
    fireEvent.change(container.querySelector('select'), {
      target: { value: 'doc-1' },
    });
    await waitFor(() => expect(documentAccess.getAuthorized).toHaveBeenCalled());
    fireEvent.change(screen.getByPlaceholderText('+1234567890'), {
      target: { value: '+15555550177' },
    });

    doubleClick(screen.getByRole('button', { name: /send fax/i }));
    await waitFor(() => expect(fax.send).toHaveBeenCalledTimes(1));

    await act(async () => { sendGate.resolve({ success: true }); });

    expect(await screen.findByText(/Fax submitted to \+15555550177/)).toBeTruthy();
    // The post-send reset cleared the recipient; the confirmation stays.
    expect(screen.getByPlaceholderText('+1234567890')).toHaveValue('');
    expect(screen.getByText(/Fax submitted to \+15555550177/)).toBeTruthy();
    expect(screen.getByText(/not tracked to delivery inside PennSync/)).toBeTruthy();
  });
});
