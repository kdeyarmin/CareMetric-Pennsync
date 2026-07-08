import { describe, expect, it } from 'vitest';
import { hostedAbsoluteUrl, hostedAssetPath } from '@/lib/assetPath';

const routerPaths = ['/Dashboard', '/Help', '/UserGuides'];

describe('hostedAssetPath', () => {
  it('keeps assets root-relative when the app is root-hosted', () => {
    expect(hostedAssetPath('/manuals/PennSync-User-Manual.pdf', { pathname: '/Help', baseUrl: '/', routerPaths })).toBe('/manuals/PennSync-User-Manual.pdf');
  });

  it('prefixes static assets with the hosted app mount path', () => {
    expect(hostedAssetPath('/manuals/PennSync-User-Manual.pdf', { pathname: '/apps/pennsync/Help', baseUrl: '/', routerPaths })).toBe('/apps/pennsync/manuals/PennSync-User-Manual.pdf');
  });


  it('needs known router paths to infer a dynamic hosted mount path', () => {
    expect(hostedAssetPath('/manuals/PennSync-User-Manual.pdf', { pathname: '/apps/pennsync/UserGuides', baseUrl: '/', routerPaths })).toBe('/apps/pennsync/manuals/PennSync-User-Manual.pdf');
  });

  it('uses Vite BASE_URL when provided', () => {
    expect(hostedAssetPath('icons/icon-192.png', { pathname: '/Help', baseUrl: '/published/app/', routerPaths })).toBe('/published/app/icons/icon-192.png');
  });

  it('builds absolute URLs under the hosted app mount path', () => {
    expect(hostedAbsoluteUrl('/join?room=abc&t=token', { origin: 'https://example.com', pathname: '/apps/pennsync/Telehealth', baseUrl: '/', routerPaths: ['/Telehealth'] })).toBe('https://example.com/apps/pennsync/join?room=abc&t=token');
  });
});
