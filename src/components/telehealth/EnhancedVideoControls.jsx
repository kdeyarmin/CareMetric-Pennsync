import { Button } from '@/components/ui/button';
import { Mic, MicOff, Video, VideoOff, PhoneOff, Monitor, MessageSquare, Maximize, Minimize } from 'lucide-react';

export default function EnhancedVideoControls({
  audioMuted,
  videoMuted,
  screenSharing = false,
  chatActive = false,
  isFullscreen = false,
  onToggleAudio,
  onToggleVideo,
  onDisconnect,
  onToggleChat,
  onToggleScreenShare,
  onToggleFullscreen
}) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 p-4 bg-slate-900 rounded-xl">
      <Button
        variant="ghost"
        size="icon"
        onClick={onToggleAudio}
        className={`rounded-full h-12 w-12 transition ${
          audioMuted
            ? 'bg-red-600 hover:bg-red-700 text-white'
            : 'bg-slate-700 hover:bg-slate-600 text-white'
        }`}
        title={audioMuted ? 'Unmute' : 'Mute'}
        aria-label={audioMuted ? 'Unmute' : 'Mute'}
        aria-pressed={audioMuted}
      >
        {audioMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
      </Button>

      <Button
        variant="ghost"
        size="icon"
        onClick={onToggleVideo}
        className={`rounded-full h-12 w-12 transition ${
          videoMuted
            ? 'bg-red-600 hover:bg-red-700 text-white'
            : 'bg-slate-700 hover:bg-slate-600 text-white'
        }`}
        title={videoMuted ? 'Turn on camera' : 'Turn off camera'}
        aria-label={videoMuted ? 'Turn on camera' : 'Turn off camera'}
        aria-pressed={videoMuted}
      >
        {videoMuted ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
      </Button>

      <Button
        variant="ghost"
        size="icon"
        onClick={onToggleScreenShare}
        className={`rounded-full h-12 w-12 transition ${
          screenSharing
            ? 'bg-blue-600 hover:bg-blue-700 text-white'
            : 'bg-slate-700 hover:bg-slate-600 text-white'
        }`}
        title={screenSharing ? 'Stop sharing screen' : 'Share screen'}
        aria-label={screenSharing ? 'Stop sharing screen' : 'Share screen'}
        aria-pressed={screenSharing}
      >
        <Monitor className="w-5 h-5" />
      </Button>

      {onToggleChat && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleChat}
          className={`rounded-full h-12 w-12 transition ${
            chatActive
              ? 'bg-blue-600 hover:bg-blue-700 text-white'
              : 'bg-slate-700 hover:bg-slate-600 text-white'
          }`}
          title={chatActive ? 'Hide chat' : 'Show chat'}
          aria-label={chatActive ? 'Hide chat' : 'Show chat'}
          aria-pressed={chatActive}
        >
          <MessageSquare className="w-5 h-5" />
        </Button>
      )}

      {onToggleFullscreen && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleFullscreen}
          className="rounded-full h-12 w-12 bg-slate-700 hover:bg-slate-600 text-white transition"
          title={isFullscreen ? 'Exit full screen' : 'Full screen'}
          aria-label={isFullscreen ? 'Exit full screen' : 'Full screen'}
          aria-pressed={isFullscreen}
        >
          {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
        </Button>
      )}

      <div className="mx-2 w-px h-8 bg-slate-700" />

      <Button
        variant="ghost"
        size="icon"
        onClick={onDisconnect}
        className="rounded-full h-14 w-14 bg-red-600 hover:bg-red-700 text-white transition"
        title="End session"
        aria-label="End session"
      >
        <PhoneOff className="w-6 h-6" />
      </Button>
    </div>
  );
}