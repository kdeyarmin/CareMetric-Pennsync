import { evaluateAccessTokenTrust } from '@/lib/accessTokenTrust';

const isNode = typeof window === 'undefined';
const memoryStorage = new Map();

const memoryStorageAdapter = {
	getItem: (key) => memoryStorage.get(key) ?? null,
	setItem: (key, value) => memoryStorage.set(key, value),
	removeItem: (key) => memoryStorage.delete(key),
};

const storage = (() => {
	try {
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem('__test__', '1');
			localStorage.removeItem('__test__');
			return localStorage;
		}
	} catch { /* no-op */ }
	return memoryStorageAdapter;
})();

const setStoredItem = (key, value) => storage.setItem(key, value);

const PENDING_ACCESS_TOKEN_KEY = 'base44_pending_access_token';

const toSnakeCase = (str) => {
	return str.replace(/([A-Z])/g, '_$1').toLowerCase();
};

const sanitizeValue = (value) => {
	if (typeof value !== 'string') {
		return value;
	}
	const trimmed = value.trim();
	return trimmed.length ? trimmed : undefined;
};

// A backend origin is only accepted if it lives on a trusted Base44 host or on
// the build's own configured backend host. Without this, a phishing link like
// `?server_url=https://evil.com` is sanitized as "valid" and persisted to
// localStorage, permanently rerouting ALL API traffic — including the email +
// password the sign-in screen POSTs and the bearer token/PHI the SDK sends — to
// the attacker's origin.
const TRUSTED_BACKEND_SUFFIXES = ['base44.com', 'base44.app', 'base44.io', 'base44.dev'];
const envBackendHost = (() => {
	try {
		return new URL(import.meta.env.VITE_BASE44_BACKEND_URL).host.toLowerCase();
	} catch {
		return null;
	}
})();
const isTrustedBackendHost = (host) => {
	const h = String(host || '').toLowerCase();
	if (envBackendHost && h === envBackendHost) return true;
	return TRUSTED_BACKEND_SUFFIXES.some((s) => h === s || h.endsWith('.' + s));
};

// Stricter gate for the `?access_token=` referrer check. `isTrustedBackendHost`
// accepts EVERY tenant app under the shared platform suffixes (any
// `*.base44.app` etc.), but any Base44 customer can host an app there — so a
// hostile tenant app could redirect a victim here carrying the attacker's
// token and a "trusted" Referrer, silently switching the victim's session.
// Auth handoffs only ever come from the app's own backend host or the fixed
// platform login/app origins, so trust exactly those.
const TRUSTED_AUTH_REFERRER_HOSTS = [
	'base44.com',
	'app.base44.com',
	'login.base44.com',
	'auth.base44.com',
	'base44.app',
	'base44.io',
	'base44.dev',
];
const isTrustedAuthReferrerHost = (host) => {
	const h = String(host || '').toLowerCase();
	if (envBackendHost && h === envBackendHost) return true;
	return TRUSTED_AUTH_REFERRER_HOSTS.includes(h);
};

const sanitizeServerUrl = (value) => {
	const sanitized = sanitizeValue(value);
	if (!sanitized) {
		return undefined;
	}

	try {
		const url = new URL(sanitized);
		if (!isTrustedBackendHost(url.host)) {
			console.warn(`[app-params] Ignoring server URL on untrusted host: ${url.host}`);
			return undefined;
		}
		return url.origin;
	} catch {
		console.warn(`[app-params] Ignoring invalid server URL: ${sanitized}`);
		return undefined;
	}
};

// Referrer / session gate for accepting a session token from the URL. A
// `?access_token=` handoff is how the platform's hosted-login flows (OTP /
// sign-up / captcha / password-reset completion) return an authenticated
// session, so we can't drop it — but an unsolicited phishing link carrying
// `?access_token=<attacker's session>` is otherwise persisted verbatim and
// silently switches the victim into the attacker's account (login CSRF /
// session fixation).
//
// Decision matrix (see evaluateAccessTokenTrust):
//   accept  — same-origin / trusted Base44 referrer, or matching planted
//             `auth_state` from plantLoginReturnState
//   reject  — would overwrite an existing session from empty/untrusted referrer,
//             or planted state mismatch
//   pending — logged-out empty/untrusted referrer with no matching planted
//             state (email-style magic links). Token is stashed under
//             `base44_pending_access_token` until the user confirms on
//             SignInScreen — closes silent logged-out login CSRF in-repo.
//
// Fully eliminating the confirm click still needs Base44 to issue a state/nonce
// on every return URL (including email magic links).
const LOGIN_STATE_KEY = 'base44_login_state';

/** Snapshot of `auth_state` from the landing URL, captured before we strip it. */
let landingAuthState = null;

/** Last trust decision for the landing `access_token` (for pending stash). */
let landingTokenTrust = 'accept';

const evaluateLandingTokenTrust = () => {
	if (isNode) return 'accept';
	const planted = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(LOGIN_STATE_KEY) : null;
	if (planted) {
		try { sessionStorage.removeItem(LOGIN_STATE_KEY); } catch { /* ignore */ }
	}
	return evaluateAccessTokenTrust({
		urlState: landingAuthState,
		plantedState: planted,
		referrer: typeof document !== 'undefined' ? document.referrer : '',
		hasExistingToken: !!storage.getItem('base44_access_token'),
		isTrustedBackendHost: isTrustedAuthReferrerHost,
		pageHost: typeof window !== 'undefined' ? window.location.host : null,
	});
};

const acceptUrlAccessToken = () => {
	landingTokenTrust = evaluateLandingTokenTrust();
	return landingTokenTrust === 'accept';
};

/** Peek at a token stashed for explicit confirm (login CSRF pending). */
export const peekPendingAccessToken = () => {
	if (isNode) return null;
	return storage.getItem(PENDING_ACCESS_TOKEN_KEY);
};

/** Promote the pending token into a real session. Caller should reload. */
export const confirmPendingAccessToken = () => {
	if (isNode) return false;
	const pending = storage.getItem(PENDING_ACCESS_TOKEN_KEY);
	if (!pending) return false;
	storage.removeItem(PENDING_ACCESS_TOKEN_KEY);
	setStoredItem('base44_access_token', pending);
	appParams.token = pending;
	return true;
};

/** Discard a pending handoff token without signing in. */
export const declinePendingAccessToken = () => {
	if (isNode) return;
	storage.removeItem(PENDING_ACCESS_TOKEN_KEY);
};

/** Plant a one-time state before redirecting to hosted login; append it to the
 * return URL so a matching `auth_state` proves the handoff was solicited. */
export const plantLoginReturnState = (returnUrl) => {
	if (isNode || typeof crypto === 'undefined' || !crypto.randomUUID) return returnUrl;
	const state = crypto.randomUUID();
	try {
		sessionStorage.setItem(LOGIN_STATE_KEY, state);
	} catch {
		return returnUrl;
	}
	try {
		const u = new URL(returnUrl, window.location.origin);
		u.searchParams.set('auth_state', state);
		return u.toString();
	} catch {
		return returnUrl;
	}
};

// `app_id` (and the `functions_version` that pins its backend code) are taken
// verbatim from the URL and persisted forever, with no in-app reset. A single
// crafted or stale `?app_id=bogus` link therefore bricks the device permanently
// — every SDK call targets the wrong app and only clearing site data recovers.
// When the build ships its own app id, only accept a URL value that agrees with
// it; otherwise (no build-time id) keep the previous open behaviour.
const envAppId = import.meta.env.VITE_BASE44_APP_ID;
const acceptAppId = () => {
	if (isNode || !envAppId) return true;
	return new URLSearchParams(window.location.search).get('app_id')?.trim() === envAppId;
};

const getAppParamValue = (paramName, { defaultValue = undefined, removeFromUrl = false, sanitize = sanitizeValue, acceptUrlValue = undefined } = {}) => {
	if (isNode) {
		return sanitize(defaultValue);
	}
	const storageKey = `base44_${toSnakeCase(paramName)}`;
	const urlParams = new URLSearchParams(window.location.search);
	const searchParam = sanitize(urlParams.get(paramName));
	if (removeFromUrl) {
		urlParams.delete(paramName);
		const newUrl = `${window.location.pathname}${urlParams.toString() ? `?${urlParams.toString()}` : ''}${window.location.hash}`;
		window.history.replaceState({}, document.title, newUrl);
	}
	if (searchParam) {
		// A URL value may be gated (e.g. a session token must not come from a
		// foreign referrer). When rejected, don't persist it — fall through to any
		// already-stored value / default so the caller keeps their own session.
		// For access_token, a `pending` trust decision stashes the token for
		// explicit confirm on SignInScreen instead of silent login.
		if (acceptUrlValue && !acceptUrlValue()) {
			if (paramName === 'access_token' && landingTokenTrust === 'pending') {
				setStoredItem(PENDING_ACCESS_TOKEN_KEY, searchParam);
				console.warn('[app-params] Stashing access_token for explicit confirm (login CSRF pending).');
			} else {
				console.warn(`[app-params] Ignoring ${paramName} supplied from an untrusted referrer.`);
			}
		} else {
			if (paramName === 'access_token') {
				storage.removeItem(PENDING_ACCESS_TOKEN_KEY);
			}
			setStoredItem(storageKey, searchParam);
			return searchParam;
		}
	}
	const storedValue = sanitize(storage.getItem(storageKey));
	if (storedValue) {
		return storedValue;
	}
	const sanitizedDefault = sanitize(defaultValue);
	if (sanitizedDefault !== undefined) {
		storage.setItem(storageKey, sanitizedDefault);
		return sanitizedDefault;
	}
	return null;
};

const getAppParams = () => {
	// `clear_access_token` is a ONE-SHOT directive ("clear the stored token now"),
	// not a persisted preference. Read it straight from the URL — never through
	// getAppParamValue, which writes the value to storage and would then re-clear
	// the token on EVERY subsequent load (a permanent logout loop once the param
	// is ever seen). Also drop any flag a prior version persisted so an already
	// affected session self-heals on the next load.
	if (!isNode) {
		storage.removeItem('base44_clear_access_token');
		if (new URLSearchParams(window.location.search).get('clear_access_token') === 'true') {
			storage.removeItem('base44_access_token');
			storage.removeItem('token');
			storage.removeItem(PENDING_ACCESS_TOKEN_KEY);
		}
		// Capture auth_state BEFORE stripping it so trustedTokenReferrer can
		// match against the planted sessionStorage value.
		const cleanParams = new URLSearchParams(window.location.search);
		landingAuthState = cleanParams.get('auth_state');
		if (cleanParams.has('auth_state')) {
			cleanParams.delete('auth_state');
			const newUrl = `${window.location.pathname}${cleanParams.toString() ? `?${cleanParams.toString()}` : ''}${window.location.hash}`;
			window.history.replaceState({}, document.title, newUrl);
		}
		// Self-heal a device an earlier bad `?app_id=` link already pinned to the
		// wrong app: drop the stored id (and the functions version pinned with it)
		// so the build-time default is used again on this load.
		const storedAppId = storage.getItem('base44_app_id');
		if (envAppId && storedAppId && storedAppId !== envAppId) {
			storage.removeItem('base44_app_id');
			storage.removeItem('base44_functions_version');
		}
	}

	const appId = getAppParamValue('app_id', { defaultValue: envAppId, acceptUrlValue: acceptAppId });
	const serverUrl = getAppParamValue('server_url', {
		defaultValue: import.meta.env.VITE_BASE44_BACKEND_URL,
		sanitize: sanitizeServerUrl
	});

	if (!appId || !serverUrl) {
		console.warn('[app-params] Missing Base44 app configuration. Set VITE_BASE44_APP_ID and VITE_BASE44_BACKEND_URL.');
	}

	return {
		appId,
		serverUrl,
		token: getAppParamValue('access_token', { removeFromUrl: true, acceptUrlValue: acceptUrlAccessToken }),
		functionsVersion: getAppParamValue('functions_version', { acceptUrlValue: acceptAppId })
	};
};

export const appParams = {
	...getAppParams()
};