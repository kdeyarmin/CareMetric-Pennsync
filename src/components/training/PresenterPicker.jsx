import { isSafeExternalUrl } from "@/components/utils/security";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Info, Loader2, Volume2, Square } from "lucide-react";
import { manageTrainingVideos } from "@/functions/manageTrainingVideos";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

// Radix Select can't represent an empty-string item value, so "use the agency
// default presenter/voice" is a sentinel mapped back to "" for the API.
const DEFAULT_SENTINEL = "__default__";

// Avatar + voice pickers for HeyGen presenter videos, fed by the
// manageTrainingVideos `options` action so admins choose from the account's
// actual catalog (with voice audio preview) instead of pasting raw HeyGen IDs.
// Falls back to free-text ID inputs if the catalog can't be fetched, and to an
// explanatory notice when HeyGen isn't configured at all.
export default function PresenterPicker({
  avatarId,
  voiceId,
  onAvatarChange,
  onVoiceChange,
  disabled = false,
  idPrefix = "presenter",
  notConfiguredHint = "",
}) {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef(null);

  const { data, isLoading } = useQuery({
    queryKey: ["heygen-presenter-options"],
    queryFn: async () => {
      const res = await manageTrainingVideos({ action: "options" });
      return res?.data || res;
    },
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });

  const stopPreview = () => {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlaying(false);
  };
  // Stop any playing preview audio on unmount.
  useEffect(() => () => stopPreview(), []);

  if (isLoading) {
    return (
      <p className="text-xs text-slate-400 flex items-center gap-1.5">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading presenter options…
      </p>
    );
  }

  if (data?.heygen_configured === false) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex items-start gap-2 text-xs text-amber-900">
        <Info className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
        <span>
          HeyGen isn’t connected yet — add a <code className="bg-amber-100 px-1 rounded">HEYGEN_API_KEY</code> to
          the environment’s function secrets to enable presenter videos.
          {notConfiguredHint ? ` ${notConfiguredHint}` : ""}
        </span>
      </div>
    );
  }

  const avatars = data?.avatars || [];
  const voices = data?.voices || [];

  const selectedAvatar = avatars.find((a) => a.avatar_id === avatarId);
  const previewVoiceId = voiceId || data?.default_voice_id;
  const previewUrl = voices.find((v) => v.voice_id === previewVoiceId)?.preview_audio_url;

  const togglePreview = () => {
    if (playing) return stopPreview();
    if (!previewUrl) return;
    const audio = new Audio(previewUrl);
    audioRef.current = audio;
    audio.onended = () => setPlaying(false);
    audio.onerror = () => setPlaying(false);
    audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  };

  // Each half falls back to a raw-ID input independently, so a partial catalog
  // failure (one endpoint down / empty) never blocks picking the other side —
  // and admins can still paste a known ID for the missing side.
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div>
        {avatars.length === 0 ? (
          <>
            <Label htmlFor={`${idPrefix}-avatar-id`} className="text-xs font-semibold">Avatar ID (optional)</Label>
            <Input
              id={`${idPrefix}-avatar-id`}
              value={avatarId}
              onChange={(e) => onAvatarChange(e.target.value)}
              placeholder="Default avatar"
              className="h-9 mt-1"
              disabled={disabled}
            />
          </>
        ) : (
          <>
            <Label htmlFor={`${idPrefix}-avatar`} className="text-xs font-semibold">Presenter</Label>
            <div className="flex items-center gap-2 mt-1">
              {selectedAvatar?.preview_image_url && isSafeExternalUrl(selectedAvatar.preview_image_url) && (
                <img
                  src={selectedAvatar.preview_image_url}
                  alt=""
                  className="w-9 h-9 rounded-lg object-cover border flex-shrink-0"
                />
              )}
              <Select
                value={avatarId || DEFAULT_SENTINEL}
                onValueChange={(v) => onAvatarChange(v === DEFAULT_SENTINEL ? "" : v)}
                disabled={disabled}
              >
                <SelectTrigger id={`${idPrefix}-avatar`} className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent style={{ zIndex: 9999 }}>
                  <SelectItem value={DEFAULT_SENTINEL}>Default presenter</SelectItem>
                  {avatars.map((a) => (
                    <SelectItem key={a.avatar_id} value={a.avatar_id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        )}
      </div>
      <div>
        {voices.length === 0 ? (
          <>
            <Label htmlFor={`${idPrefix}-voice-id`} className="text-xs font-semibold">Voice ID (optional)</Label>
            <Input
              id={`${idPrefix}-voice-id`}
              value={voiceId}
              onChange={(e) => onVoiceChange(e.target.value)}
              placeholder="Default voice"
              className="h-9 mt-1"
              disabled={disabled}
            />
          </>
        ) : (
          <>
            <Label htmlFor={`${idPrefix}-voice`} className="text-xs font-semibold">Voice</Label>
            <div className="flex items-center gap-2 mt-1">
              <Select
                value={voiceId || DEFAULT_SENTINEL}
                onValueChange={(v) => {
                  stopPreview();
                  onVoiceChange(v === DEFAULT_SENTINEL ? "" : v);
                }}
                disabled={disabled}
              >
                <SelectTrigger id={`${idPrefix}-voice`} className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent style={{ zIndex: 9999 }}>
                  <SelectItem value={DEFAULT_SENTINEL}>Default voice (Elizabeth — friendly)</SelectItem>
                  {voices.map((v) => (
                    <SelectItem key={v.voice_id} value={v.voice_id}>
                      {v.name}{v.language ? ` · ${v.language}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-9 px-2.5 flex-shrink-0"
                onClick={togglePreview}
                disabled={disabled || !previewUrl}
                title={previewUrl ? "Play a sample of this voice" : "No sample available for this voice"}
                aria-label={playing ? "Stop voice sample" : "Play voice sample"}
              >
                {playing ? <Square className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
              </Button>
            </div>
          </>
        )}
      </div>
      {(avatars.length === 0 || voices.length === 0) && (
        <p className="sm:col-span-2 text-xs text-slate-400">
          Couldn’t load the full avatar &amp; voice catalog — you can paste IDs from your HeyGen account, or leave blank for the defaults.
        </p>
      )}
    </div>
  );
}
