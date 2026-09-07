import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/testUtils';
import { expectNoAxeViolations } from '@/test/axeHelpers';
import { PublicCapabilityBoundary } from '@/lib/PublicCapabilityContext';
import { closePublicCapabilityRealm } from '@/lib/publicCapabilityRealmGate';
import OAuthConsent from './OAuthConsent';

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));

vi.mock('@/lib/app-params', () => ({
  appParams: { appId: 'app-1', token: null },
}));

function mockResponse(status, data = null) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn(async () => data),
  };
}

function renderConsent(url = '/consent') {
  window.history.replaceState({}, '', url);
  return renderWithProviders(
    <PublicCapabilityBoundary capabilitySnapshot={`oauth-consent|${url}`}>
      <OAuthConsent />
    </PublicCapabilityBoundary>,
    { route: url },
  );
}

beforeEach(() => {
  mocks.fetch.mockReset();
  vi.stubGlobal('fetch', mocks.fetch);
});

afterEach(() => {
  closePublicCapabilityRealm();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

describe('OAuthConsent public accessibility states', () => {
  it('announces an invalid authorization link inside one titled main landmark', async () => {
    const { container } = renderConsent();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This authorization link is invalid or has expired.',
    );
    expect(document.title).toBe('Authorize access | PennSync by CareMetric');
    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(container.querySelector('h1')).toHaveTextContent('Authorize access');
    expect(mocks.fetch).not.toHaveBeenCalled();
    await expectNoAxeViolations(container);
  });

  it('announces terminal reconnect guidance after the server consumes the handle', async () => {
    mocks.fetch
      .mockResolvedValueOnce(mockResponse(200, {
        authenticated: true,
        app_name: 'PennSync',
        client_name: 'Example AI client',
        tools: [],
      }))
      .mockResolvedValueOnce(mockResponse(409, {
        detail: 'The requested tool set changed. Reconnect to review it again.',
      }));
    renderConsent('/consent?ctx=opaque-handle');

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Approve' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The requested tool set changed.');
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(document.title).toBe('Reconnect required | PennSync by CareMetric');
  });

  it('announces a retryable submission failure without discarding the consent controls', async () => {
    mocks.fetch
      .mockResolvedValueOnce(mockResponse(200, {
        authenticated: true,
        app_name: 'PennSync',
        client_name: 'Example AI client',
        tools: [],
      }))
      .mockResolvedValueOnce(mockResponse(500));
    renderConsent('/consent?ctx=opaque-handle');

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Approve' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not complete authorization. Please try again.',
    );
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
  });
});
