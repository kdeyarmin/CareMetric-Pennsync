import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

/**
 * The signed-in nurse's own call log, shared by the Phone Center's Recents
 * tab, its Callbacks tab and the Callbacks badge so all three read one query
 * (one cache entry, one poll). CallLog RLS admits a non-admin only to rows
 * whose nurse_email, sent_by or creator is them; the nurse_email filter
 * narrows the built-in admin's wider read to their own calls.
 */
export function nurseCallLogsQueryKey(email) {
  return ["call-logs", email];
}

export function useNurseCallLogs(user) {
  return useQuery({
    queryKey: nurseCallLogsQueryKey(user?.email),
    queryFn: () => base44.entities.CallLog.filter({ nurse_email: user.email }, "-created_date", 200),
    enabled: !!user?.email,
    refetchInterval: 30000,
    initialData: [],
  });
}
