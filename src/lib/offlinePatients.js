/**
 * Offline fallback for patient-roster queries.
 *
 * The offline documentation surfaces (Offline Mode tabs, SmartNote) load their
 * patient list over the network, but they are exactly the screens a nurse opens
 * WITHOUT connectivity. When the fetch fails while offline, serve the roster
 * OfflineManager cached in IndexedDB instead, so a patient can still be
 * selected and documented against.
 *
 * IMPORTANT: callers using React Query must set `networkMode: 'always'` on the
 * query — the v5 default ('online') PAUSES the queryFn while offline, so a
 * fallback inside the queryFn would never run precisely when it matters.
 *
 * Only falls back when the device is actually offline: an online API failure
 * (auth, 500) still surfaces as an error rather than silently showing a stale
 * roster.
 */
export async function withOfflineRosterFallback(fetchRemote, { getLocal, isOffline } = {}) {
	try {
		return await fetchRemote();
	} catch (error) {
		const offline = isOffline
			? isOffline()
			: typeof navigator !== 'undefined' && navigator.onLine === false;
		if (!offline) throw error;

		const loadLocal = getLocal ?? (async () => {
			const { getPatientsLocally } = await import('@/lib/indexedDB');
			return getPatientsLocally();
		});

		let local = null;
		try {
			local = await loadLocal();
		} catch {
			/* cache unavailable (fresh install, private mode) — rethrow below */
		}
		if (Array.isArray(local) && local.length > 0) return local;
		throw error;
	}
}
