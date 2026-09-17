import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { listAuthorizedReferrals } from '@/functions/manageAuthorizedReferral';
import { ALL_ROWS } from '@/lib/queryLimits';
import { REPORT_READ_OPTIONS, validReportDate } from '@/components/analytics/reportReadContracts';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function readRows(value) {
  const ids = new Set();
  if (!Array.isArray(value) || value.some(row => {
    if (!object(row) || typeof row.id !== 'string' || !row.id || ids.has(row.id)) return true;
    if (['referral_date', 'referral_source', 'priority', 'status', 'soc_date', 'first_visit_date', 'estimated_start_date'].some(key => row[key] != null && typeof row[key] !== 'string')) return true;
    if (['extracted_data', 'analysis_results', 'follow_up_requests'].some(key => row[key] != null && !object(row[key]))) return true;
    const provider = row.extracted_data?.demographics?.referring_physician;
    if (provider != null && typeof provider !== 'string') return true;
    if (['status', 'generated_at', 'received_at'].some(key => row.follow_up_requests?.[key] != null && typeof row.follow_up_requests[key] !== 'string')) return true;
    const request = row.follow_up_requests;
    if (['generated_at', 'received_at'].some(key => request?.[key] != null
      && (!validReportDate(request[key]) || !request[key].includes('T')))) return true;
    if (request?.generated_at && request?.received_at
      && Date.parse(request.received_at) < Date.parse(request.generated_at)) return true;
    ids.add(row.id);
    return false;
  })) throw new Error('REFERRAL_REPORT_READ_INVALID');
  return value;
}

export default function useReferralReportRows({ enabled = true } = {}) {
  const { tenantContext } = useAuth();
  const scopeAvailable = Boolean(tenantContext?.agency_id);
  const query = useQuery({
    // Preserve mutation invalidation while isolating the validated projection.
    queryKey: ['referrals', 'report', tenantContext?.agency_id, tenantContext?.membership_id, tenantContext?.membership_version, ALL_ROWS],
    queryFn: async () => readRows((await listAuthorizedReferrals({ agencyId: tenantContext.agency_id, limit: ALL_ROWS })).referrals),
    enabled: scopeAvailable && enabled,
    ...REPORT_READ_OPTIONS,
  });
  return { ...query, scopeAvailable, capped: query.isSuccess && query.data.length >= ALL_ROWS };
}
