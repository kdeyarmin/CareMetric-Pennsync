import { API } from '../../authority-store/tests/http-local-stack.mjs';
import { BROWSER_ORIGIN } from './server.mjs';

export function matchesPatientPost(url, method, path) {
  return method === 'POST' && url.origin === API && !url.search
    && url.pathname === `/rest/v1/rpc${path}`;
}

export function allowedDestination(url, method) {
  if (url.username || url.password) return false;
  if (url.origin === BROWSER_ORIGIN) return method === 'GET' && !url.search
    && ['/', '/entry.js', '/configuration'].includes(url.pathname);
  if (url.origin !== API) return false;
  if (url.pathname === '/auth/v1/user') return ['GET', 'OPTIONS'].includes(method) && !url.search;
  if (!['POST', 'OPTIONS'].includes(method)) return false;
  return (url.pathname === '/auth/v1/token' && url.search === '?grant_type=password')
    || (url.pathname === '/auth/v1/logout' && url.search === '?scope=local')
    || (/^\/rest\/v1\/rpc\/pennsync_staging_(context|memberships|patients|patient)$/.test(url.pathname) && !url.search);
}
