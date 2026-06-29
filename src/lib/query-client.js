import { QueryClient, QueryCache } from '@tanstack/react-query';
import { toast } from 'sonner';
import { logger } from '@/lib/logger';


export const queryClientInstance = new QueryClient({
	// Safety net for failed data loads. Most pages never render an `isError`
	// state, so before this a failed read just left an empty/forever-loading
	// screen with no explanation. Surface one deduped toast (the fixed id
	// collapses simultaneous failures from a multi-query page into a single
	// message). Auth/permission/not-found are handled by the auth + route
	// layers, so they don't toast here.
	queryCache: new QueryCache({
		onError: (error) => {
			const status = error?.response?.status ?? error?.status;
			if (status === 401 || status === 403 || status === 404) return;
			logger.error('Query failed:', error);
			toast.error("Couldn't load some data. Check your connection and try again.", {
				id: 'query-load-error',
			});
		},
	}),
	defaultOptions: {
		mutations: {
			// Safety net: a failed create/update/delete should never fail silently.
			// Most mutations only defined onSuccess, so before this a server/network
			// error left the user with no feedback (and sometimes a dialog that just
			// "didn't do anything"). Mutations that need bespoke error handling can
			// still override onError — react-query uses this only as the default.
			onError: (error) => {
				logger.error('Mutation failed:', error);
				const message =
					typeof error?.message === 'string' && error.message.trim()
						? error.message
						: 'Something went wrong. Please try again.';
				toast.error(message);
			},
		},
		queries: {
			refetchOnWindowFocus: false,
			// Don't retry auth/permission/not-found errors — retrying a 401 just
			// fires another failed PHI request and slows the logout redirect.
			retry: (failureCount, error) => {
				const status = error?.response?.status ?? error?.status;
				if (status === 401 || status === 403 || status === 404) return false;
				return failureCount < 1;
			},
			staleTime: 60000,       // 1 min global default — prevents redundant refetches on remount
			gcTime: 300000,         // 5 min garbage collection
			// Treat `initialData` as already stale. The app pervasively uses
			// `initialData: []` purely as an empty-render placeholder (e.g. patient
			// dropdowns). Without this, `initialData` is seeded as "fresh" and the
			// non-zero `staleTime` above suppresses the fetch-on-mount entirely, so
			// those lists/dropdowns stay permanently empty. Marking initialData's
			// timestamp as epoch (0) forces an immediate background fetch on mount
			// while still letting `staleTime` dedupe refetches once real data lands.
			initialDataUpdatedAt: 0,
		},
	},
});