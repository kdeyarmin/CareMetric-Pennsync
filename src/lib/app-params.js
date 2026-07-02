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

const getAppParamValue = (paramName, { defaultValue = undefined, removeFromUrl = false, sanitize = sanitizeValue } = {}) => {
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
		setStoredItem(storageKey, searchParam);
		return searchParam;
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
	const currentUrl = isNode ? undefined : window.location.href;
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
	}

	const appId = getAppParamValue('app_id', { defaultValue: import.meta.env.VITE_BASE44_APP_ID });
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
		token: getAppParamValue('access_token', { removeFromUrl: true }),
		fromUrl: getAppParamValue('from_url', { defaultValue: currentUrl }),
		functionsVersion: getAppParamValue('functions_version')
	};
};

export const appParams = {
	...getAppParams()
};