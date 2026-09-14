import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/dom';
import { readFileSync } from 'node:fs';
import { detachedPreviewUrl, renderSecureBootstrapNotice } from './secureBootstrapUi';

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
});

describe('secure embedded-preview recovery', () => {
  it('provides an isolated same-origin launch without carrying sensitive URL state', () => {
    renderSecureBootstrapNotice(document, {
      href: 'https://preview.example.test/Patients?access_token=secret&patient_id=patient-1&return_url=https://other.test#private',
    }, 'FRAME_NOT_ALLOWED');
    expect(screen.getByRole('heading', { level: 1, name: 'Open a secure preview' })).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Open preview in a new tab' });
    expect(link.href).toBe('https://preview.example.test/');
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer');
    expect(link.referrerPolicy).toBe('no-referrer');
    expect(document.querySelector('main').dataset.bootstrapReason).toBe('FRAME_NOT_ALLOWED');
    expect(document.body.textContent).not.toContain('secret');
    expect(document.body.textContent).not.toContain('patient-1');
    expect(document.title).toBe('Secure preview | PennSync by CareMetric');
  });

  it.each([
    'javascript:alert(1)', 'data:text/html,content', 'file:///private',
    'https://name:password@preview.example.test/', 'http://remote.example.test/',
    'not a URL',
  ])('does not create an unsafe launch link for %s', (href) => {
    expect(detachedPreviewUrl(href)).toBeNull();
    renderSecureBootstrapNotice(document, { href }, 'FRAME_NOT_ALLOWED');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it.each(['http://localhost:5173/', 'http://127.0.0.1:5173/', 'http://[::1]:5173/'])(
    'supports an isolated local-development launch at %s', (origin) => {
      expect(detachedPreviewUrl(`${origin}privacy?token=discard#discard`)).toBe(origin);
    },
  );

  it.each(['LINK_GUARD', 'FILE_INPUT_GUARD', 'FILE_DROP_GUARD', 'CLIPBOARD_GUARD', 'STORAGE_LISTENER'])(
    'keeps a failed %s blocked with an actionable support code', (code) => {
      const reload = vi.fn();
      renderSecureBootstrapNotice(document, { href: 'https://preview.example.test/', reload }, code);
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText(`Support code: ${code}`)).toBeInTheDocument();
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
      expect(reload).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Reload securely' }));
      expect(reload).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['APP_IMPORT', 'APP_MOUNT'])('does not mislabel %s as a browser privacy failure', (code) => {
    renderSecureBootstrapNotice(document, { reload: vi.fn() }, code);
    expect(screen.getByRole('heading', { name: 'App could not finish loading' })).toBeInTheDocument();
    expect(screen.getByText(`Support code: ${code}`)).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(document.title).toBe('App loading error | PennSync by CareMetric');
  });

  it('does not render arbitrary error strings or markup', () => {
    renderSecureBootstrapNotice(document, { reload: vi.fn() }, '<img src=x onerror=alert(1)>');
    expect(screen.getByText('Support code: REQUIRED_GUARD')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });

  it('does not require an app mount to exist', () => {
    document.body.innerHTML = '';
    expect(() => renderSecureBootstrapNotice(document, {}, 'FRAME_NOT_ALLOWED')).not.toThrow();
  });

  it('retains the frame prohibition and imports App only after all privacy guards', () => {
    const main = readFileSync('src/main.jsx', 'utf8');
    const ui = readFileSync('src/lib/secureBootstrapUi.js', 'utf8');
    expect(main).toContain('window.top === window.self');
    expect(main).toMatch(/if \(!currentFrameMayBootstrap\(\)\) \{\s*terminallyCloseDocumentAuthority\(\)\s*renderSecureBootstrapBlocked\(\)/);
    expect(main.lastIndexOf('installDocumentAuthorityGuards()')).toBeLessThan(main.indexOf("import('@/App.jsx')"));
    expect(main).not.toContain('import.meta.env.DEV === true');
    expect(ui).not.toMatch(/^import\s/m);
    expect(ui).not.toMatch(/postMessage|fetch\(|localStorage|sessionStorage|window\.open/);
  });
});
