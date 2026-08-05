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

// Referrer gate for accepting a session token from the URL. A `?access_token=`
// handoff is how the platform's hosted-login flows (OTP / sign-up / captcha /
// password-reset completion) return an authenticated session, so we can't drop
// it — but an unsolicited phishing link carrying `?access_token=<attacker's
// session>` is otherwise persisted verbatim and silently switches the victim
// into the attacker's account (login CSRF / session fixation). Reject the URL
// value ONLY when we can positively tell it arrived from a foreign origin; fail
// OPEN on a same-origin / trusted-Base44 / absent referrer so the legitimate
// handoff (whose hosted page may set Referrer-Policy: no-referrer) never breaks.
// NOTE: an attacker who redirects with no referrer still bypasses this — fully
// closing login CSRF needs a backend-issued state/nonce echoed on return.
const trustedTokenReferrer = () => {
	if (isNode) return true;
	const ref = document.referrer;
	if (!ref) return true;
	try {
		const refHost = new URL(ref).host.toLowerCase();
		if (refHost === window.location.host.toLowerCase()) return true;
		return isTrustedBackendHost(refHost);
	} catch {
		return true;
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
		if (acceptUrlValue && !acceptUrlValue()) {
			console.warn(`[app-params] Ignoring ${paramName} supplied from an untrusted referrer.`);
		} else {
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
		token: getAppParamValue('access_token', { removeFromUrl: true, acceptUrlValue: trustedTokenReferrer }),
		functionsVersion: getAppParamValue('functions_version', { acceptUrlValue: acceptAppId })
	};
};

export const appParams = {
	...getAppParams()
};