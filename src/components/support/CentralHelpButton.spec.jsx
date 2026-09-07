import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import CentralHelpButton from './CentralHelpButton';

const ROUTES = ['/Help', '/PatientDetails'];

describe('CentralHelpButton', () => {
  it('opens the first-party Hub with canonical, non-identifying context', () => {
    render(
      <CentralHelpButton
        enabled
        pathname="/patientdetails?patient_id=secret#chart"
        knownRoutes={ROUTES}
        appVersion="2026.09.07+abc123"
        environment="production"
      />,
    );

    const link = screen.getByRole('link', { name: /open caremetric help center/i });
    const url = new URL(link.getAttribute('href'));
    expect(url.origin).toBe('https://support-hub-web-production.up.railway.app');
    expect(url.searchParams.get('product')).toBe('pennsync');
    expect(url.searchParams.get('route')).toBe('/PatientDetails');
    expect(url.searchParams.get('app_version')).toBe('2026.09.07+abc123');
    expect(url.toString()).not.toMatch(/secret|patient_id|localhost/i);
    expect(link).not.toHaveAttribute('target');
  });

  it('renders no central launcher when the rollout flag is off', () => {
    const { container } = render(
      <CentralHelpButton enabled={false} pathname="/Help" knownRoutes={ROUTES} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
