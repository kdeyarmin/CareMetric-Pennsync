import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

/**
 * The signed-in nurse's own call log, shared by the Phone Center's Recents
 * tab, its Callbacks tab and the Callbacks badge so all three read one query
 * (one cache entry, one poll). CallLog RLS admits a non-admin only to rows
 * whose nurse_email, sent_by or creator is them; the nurse_email filter
 * narrows the built-in admin's wider read to their own calls.
 *
 * The two server actions those screens take on a call row live here too, so
 * each has one call site: a masked call back, and a short-lived link to play a
 * voicemail held in private storage.
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

const answerOf = (res) => res?.data ?? res;

/** Ring the nurse's cell, then bridge to the patient (startMaskedCall). */
export async function startMaskedCallback({ patient_id, to_number }) {
  const data = answerOf(await base44.functions.invoke("startMaskedCall", {
    patient_id: patient_id || undefined,
    to_number: to_number || undefined,
  }));
  if (data?.error) throw new Error(data.error);
  return data;
}

/**
 * A signed link to play one stored voicemail. getVoicemailPlaybackUrl decides
 * with the caller's own CallLog read and the link expires in minutes, so it is
 * requested when the nurse presses play, never stored.
 */
export async function requestVoicemailPlaybackUrl(callLogId) {
  const data = answerOf(await base44.functions.invoke("getVoicemailPlaybackUrl", { call_log_id: callLogId }));
  if (!data?.url) throw new Error(data?.error || "Voicemail is unavailable");
  return data.url;
}
