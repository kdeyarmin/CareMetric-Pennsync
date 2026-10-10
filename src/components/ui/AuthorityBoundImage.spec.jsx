import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('AuthorityBoundImage', () => {
  let AuthorityBoundImage;
  let closeTenantSdkRealm;
  let openTenantSdkRealm;

  const status = (value) => <span role="status">{value}</span>;

  beforeEach(async () => {
    localStorage.clear();
    vi.resetModules();
    ({ closeTenantSdkRealm, openTenantSdkRealm } = await import('@/lib/tenantSdkRealmGate'));
    ({ default: AuthorityBoundImage } = await import('./AuthorityBoundImage'));
  });

  afterEach(() => vi.restoreAllMocks());

  const open = () => expect(openTenantSdkRealm('image-authority')).toBe(true);

  it('asks for the link once and shows the picture inside the current authority', async () => {
    open();
    const resolveSrc = vi.fn().mockResolvedValue('https://storage.example/signed/mms-1.jpeg?sig=1');
    const view = render(<AuthorityBoundImage resolveSrc={resolveSrc} alt="Picture from the patient" renderStatus={status} />);
    const image = view.getByAltText('Picture from the patient');
    expect(image.hasAttribute('src')).toBe(false);
    expect(view.getByRole('status').textContent).toBe('loading');

    await waitFor(() => expect(image.getAttribute('src')).toBe('https://storage.example/signed/mms-1.jpeg?sig=1'));
    expect(image.hidden).toBe(false);
    expect(view.queryByRole('status')).toBeNull();
    expect(resolveSrc).toHaveBeenCalledTimes(1);
  });

  it('removes the picture\'s src synchronously when the tenant authority closes', async () => {
    open();
    const view = render(<AuthorityBoundImage resolveSrc={async () => 'https://storage.example/signed/mms-1.jpeg?sig=1'} alt="Picture from the patient" renderStatus={status} />);
    const image = view.getByAltText('Picture from the patient');
    await waitFor(() => expect(image.hasAttribute('src')).toBe(true));
    image.setAttribute('srcset', 'https://storage.example/signed/mms-1.jpeg?sig=1 2x');
    const onload = vi.fn();
    image.onload = onload;

    act(() => closeTenantSdkRealm());

    expect(image.hasAttribute('src')).toBe(false);
    expect(image.hasAttribute('srcset')).toBe(false);
    expect(image.onload).toBeNull();
    expect(image.hidden).toBe(true);
    expect(view.getByRole('status').textContent).toBe('unavailable');
  });

  it('never assigns a link that resolves after the tenant authority closed', async () => {
    open();
    let deliver;
    const resolveSrc = vi.fn(() => new Promise((resolve) => { deliver = resolve; }));
    const view = render(<AuthorityBoundImage resolveSrc={resolveSrc} alt="Picture from the patient" renderStatus={status} />);
    await waitFor(() => expect(resolveSrc).toHaveBeenCalledTimes(1));

    act(() => closeTenantSdkRealm());
    await act(async () => { deliver('https://storage.example/signed/mms-1.jpeg?sig=late'); });

    const image = view.getByAltText('Picture from the patient');
    expect(image.hasAttribute('src')).toBe(false);
    expect(image.hidden).toBe(true);
    expect(view.getByRole('status').textContent).toBe('unavailable');
  });

  it('asks for no link at all without an open tenant authority', async () => {
    const resolveSrc = vi.fn().mockResolvedValue('https://storage.example/signed/mms-1.jpeg?sig=1');
    const view = render(<AuthorityBoundImage resolveSrc={resolveSrc} alt="Picture from the patient" renderStatus={status} />);
    await act(async () => {});
    expect(resolveSrc).not.toHaveBeenCalled();
    expect(view.getByAltText('Picture from the patient').hasAttribute('src')).toBe(false);
    expect(view.getByRole('status').textContent).toBe('unavailable');
  });

  it('shows the picture as unavailable when no https link comes back', async () => {
    open();
    for (const answer of [
      () => Promise.reject(new Error('denied')),
      () => Promise.resolve('http://storage.example/mms-1.jpeg'),
      () => Promise.resolve('private/agency_a/mms-1.jpeg'),
      () => Promise.resolve('https://user:pass@storage.example/mms-1.jpeg'),
    ]) {
      const view = render(<AuthorityBoundImage resolveSrc={answer} alt="Picture from the patient" renderStatus={status} />);
      await waitFor(() => expect(view.getByRole('status').textContent).toBe('unavailable'));
      expect(view.getByAltText('Picture from the patient').hasAttribute('src')).toBe(false);
      view.unmount();
    }
  });

  it('detaches the picture on unmount', async () => {
    open();
    const view = render(<AuthorityBoundImage resolveSrc={async () => 'https://storage.example/signed/mms-1.jpeg?sig=1'} alt="Picture from the patient" />);
    const image = view.getByAltText('Picture from the patient');
    await waitFor(() => expect(image.hasAttribute('src')).toBe(true));
    view.unmount();
    expect(image.hasAttribute('src')).toBe(false);
  });
});
