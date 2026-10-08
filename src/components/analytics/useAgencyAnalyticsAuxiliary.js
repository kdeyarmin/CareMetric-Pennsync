import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { loadAgencyRoster } from '@/lib/agencyRoster';
import { filterRecordsByAuthorAgency } from '@/lib/agencyScope';

const FRESH_QUERY_OPTIONS = Object.freeze({
  retry: false,
  staleTime: 0,
  refetchOnMount: 'always',
  refetchOnWindowFocus: 'always',
  refetchOnReconnect: 'always',
});

const ROW_LIMIT = 1000;
const TRAINING_ROW_LIMIT = 5000;

function settledSuccessfullyAfterMount(query) {
  return query.isSuccess
    && query.isFetchedAfterMount
    && query.fetchStatus === 'idle'
    && !query.error
    && !query.isFetching
    && !query.isPaused;
}

/**
 * Each source's own read rule admits the person a row belongs to and the
 * administrator, so rows are then bounded to the caller's agency by the person
 * each row is attributed to — the nurse for a note conversion or audit, the
 * assignee for a training assignment, the reporter for an incident.
 */
export const AGENCY_ANALYTICS_SOURCES = Object.freeze({
  noteConversions: {
    fetch: () => base44.entities.NoteConversion.list('-created_date', ROW_LIMIT),
    authorOf: (row) => row?.nurse_email,
  },
  complianceAudits: {
    fetch: () => base44.entities.ComplianceAudit.list('-created_date', ROW_LIMIT),
    authorOf: (row) => row?.nurse_email,
  },
  incidents: {
    fetch: () => base44.entities.Incident.list('-created_date', ROW_LIMIT),
    authorOf: (row) => row?.created_by,
  },
  trainingAssignments: {
    fetch: () => base44.entities.TrainingAssignment.list('-created_date', TRAINING_ROW_LIMIT),
    authorOf: (row) => row?.assigned_to_user_id,
  },
});

function useAuxiliarySource(name, { authorityKey, enabled, currentUser }) {
  const source = AGENCY_ANALYTICS_SOURCES[name];
  const query = useQuery({
    queryKey: ['agency-analytics', name, authorityKey],
    queryFn: async () => filterRecordsByAuthorAgency(
      await source.fetch(),
      await loadAgencyRoster(),
      currentUser,
      source.authorOf,
    ),
    enabled: Boolean(enabled && authorityKey && currentUser),
    ...FRESH_QUERY_OPTIONS,
  });
  const available = Boolean(enabled) && settledSuccessfullyAfterMount(query);
  return {
    rows: available && Array.isArray(query.data) ? query.data : null,
    isError: query.isError,
  };
}

/**
 * The auxiliary Agency Analytics sources, loaded only after the page's own
 * Patient/Visit authority and staff roster agree. A source that has not
 * settled freshly after mount is `rows: null`, so the page reports that
 * section as unavailable instead of computing it from nothing.
 */
export function useAgencyAnalyticsAuxiliary({ authorityKey, enabled, currentUser }) {
  return {
    noteConversions: useAuxiliarySource('noteConversions', { authorityKey, enabled, currentUser }),
    complianceAudits: useAuxiliarySource('complianceAudits', { authorityKey, enabled, currentUser }),
    incidents: useAuxiliarySource('incidents', { authorityKey, enabled, currentUser }),
    trainingAssignments: useAuxiliarySource('trainingAssignments', { authorityKey, enabled, currentUser }),
  };
}

export default useAgencyAnalyticsAuxiliary;
