import AuthorityBoundAudio from "@/components/ui/AuthorityBoundAudio";
import { isSafeExternalUrl } from "@/components/utils/security";
import { isStoredVoicemailRef } from "@/components/voice/voicemailPlayback";
import { requestVoicemailPlaybackUrl } from "@/components/voice/useNurseCallLogs";

/**
 * Inline voicemail playback for a CallLog row. A recording held in private
 * storage is played through a signed link requested when the nurse presses
 * play; a legacy provider link plays directly, as before.
 */
export default function VoicemailPlayer({ call, className = "" }) {
  if (!call?.has_voicemail || !call.voicemail_url) return null;
  if (isStoredVoicemailRef(call.voicemail_url)) {
    return (
      <AuthorityBoundAudio
        preload="none"
        resolveSrc={() => requestVoicemailPlaybackUrl(call.id)}
        className={className}
      />
    );
  }
  if (!isSafeExternalUrl(call.voicemail_url)) return null;
  return <AuthorityBoundAudio controls preload="none" src={call.voicemail_url} className={className} />;
}
