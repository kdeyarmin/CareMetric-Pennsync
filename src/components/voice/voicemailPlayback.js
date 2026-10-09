/**
 * Voicemail playback references.
 *
 * handleTelnyxStatusWebhook copies each voicemail recording into private app
 * storage and keeps the PRIVATE reference in CallLog.voicemail_url; such a row
 * is played through a signed link from getVoicemailPlaybackUrl. A row written
 * before that, or whose copy failed, still holds the provider's https link and
 * plays directly as it always did.
 *
 * isStoredVoicemailRef mirrors isPrivateFileUri (base44/_shared/backendHelpers.mjs,
 * the privateFileUri helper the webhook and the signer inline) and is
 * drift-guarded against it by VoicemailPlayer.spec.jsx. It must be asked FIRST:
 * a private reference is not an absolute URL, so a generic "safe URL" check
 * reads it as a same-origin path and would hand it to the audio element.
 */
export function isStoredVoicemailRef(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 4096
    && !/\s/.test(value) && ![...value].some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)
    && (value.startsWith("private/") || value.startsWith("private://")
      || /^mp\/private\/[a-f0-9]{24}\/[^?#]+$/.test(value));
}
