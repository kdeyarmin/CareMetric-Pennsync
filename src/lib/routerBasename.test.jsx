import { describe, expect, it } from 'vitest';
import { getRouterBasename } from '@/lib/routerBasename';

describe('getRouterBasename', () => {
  it('ignores Vite relative build base so dynamic mounts can be inferred', () => {
    expect(getRouterBasename({ pathname: '/apps/pennsync/Dashboard', baseUrl: './', routerPaths: ['/Dashboard'] })).toBe('/apps/pennsync');
  });

  it('uses Vite BASE_URL when configured', () => {
    expect(getRouterBasename({ pathname: '/ignored/Dashboard', baseUrl: '/published/app/', routerPaths: ['/Dashboard'] })).toBe('/published/app');
  });

  it('does not set a basename for root-hosted app routes', () => {
    expect(getRouterBasename({ pathname: '/Dashboard', baseUrl: '/', routerPaths: ['/Dashboard', '/PatientDetails', '/join', '/signer', '/followup'] })).toBeUndefined();
    expect(getRouterBasename({ pathname: '/PatientDetails', baseUrl: '/', routerPaths: ['/Dashboard', '/PatientDetails', '/join', '/signer', '/followup'] })).toBeUndefined();
  });

  it('infers a hosted mount prefix before authenticated routes', () => {
    expect(getRouterBasename({ pathname: '/apps/pennsync/Dashboard', baseUrl: '/', routerPaths: ['/Dashboard', '/PatientDetails', '/join', '/signer', '/followup'] })).toBe('/apps/pennsync');
    expect(getRouterBasename({ pathname: '/store/apps/pennsync/PatientDetails', baseUrl: '/', routerPaths: ['/Dashboard', '/PatientDetails', '/join', '/signer', '/followup'] })).toBe('/store/apps/pennsync');
  });

  it('infers a hosted mount prefix before public portal routes', () => {
    expect(getRouterBasename({ pathname: '/apps/pennsync/join', baseUrl: '/', routerPaths: ['/Dashboard', '/PatientDetails', '/join', '/signer', '/followup'] })).toBe('/apps/pennsync');
    expect(getRouterBasename({ pathname: '/apps/pennsync/signer', baseUrl: '/', routerPaths: ['/Dashboard', '/PatientDetails', '/join', '/signer', '/followup'] })).toBe('/apps/pennsync');
    expect(getRouterBasename({ pathname: '/apps/pennsync/followup', baseUrl: '/', routerPaths: ['/Dashboard', '/PatientDetails', '/join', '/signer', '/followup'] })).toBe('/apps/pennsync');
  });

  it('does not infer a basename from a root-hosted route that only differs by a trailing slash', () => {
    expect(getRouterBasename({ pathname: '/Help/', baseUrl: '/', routerPaths: ['/', '/Help', '/Telehealth'] })).toBeUndefined();
    expect(getRouterBasename({ pathname: '/Telehealth/', baseUrl: '/', routerPaths: ['/', '/Help', '/Telehealth'] })).toBeUndefined();
  });

  it('still infers the hosted mount root from the slash route', () => {
    expect(getRouterBasename({ pathname: '/apps/pennsync/', baseUrl: '/', routerPaths: ['/', '/Help', '/Telehealth'] })).toBe('/apps/pennsync');
  });
});
