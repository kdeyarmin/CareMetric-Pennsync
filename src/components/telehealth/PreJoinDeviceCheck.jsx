import { useCallback, useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Video, Mic, Loader2, AlertTriangle } from 'lucide-react';

const STORAGE_KEY = 'telehealth.devicePrefs';

function readPrefs() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; }
}
function writePrefs(prefs) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
}

// "Green room" shown before joining a visit: live self-preview, camera/mic
// pickers, and a mic level meter so people confirm their devices work before
// they connect — the single biggest cause of "I can't see/hear you" calls.
export default function PreJoinDeviceCheck({ role = 'patient', onJoin }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const audioCtxRef = useRef(null);
  const rafRef = useRef(null);

  const [cameras, setCameras] = useState([]);
  const [mics, setMics] = useState([]);
  const [videoDeviceId, setVideoDeviceId] = useState(() => readPrefs().videoDeviceId || '');
  const [audioDeviceId, setAudioDeviceId] = useState(() => readPrefs().audioDeviceId || '');
  const [status, setStatus] = useState('loading'); // loading | ready | denied
  const [level, setLevel] = useState(0);

  const stopStream = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const startMeter = useCallback((stream) => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        setLevel(Math.min(1, Math.sqrt(sum / data.length) * 2.5));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch { /* metering is best-effort */ }
  }, []);

  const startPreview = useCallback(async () => {
    stopStream();
    setStatus('loading');
    try {
      // Bare deviceId is an "ideal" hint: a remembered device is preferred but
      // falls back gracefully if it's been unplugged (vs. {exact} which throws).
      const constraints = {
        video: videoDeviceId ? { deviceId: videoDeviceId } : true,
        audio: audioDeviceId ? { deviceId: audioDeviceId } : true,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;

      // Labels are only populated once permission is granted.
      const all = await navigator.mediaDevices.enumerateDevices();
      setCameras(all.filter((d) => d.kind === 'videoinput'));
      setMics(all.filter((d) => d.kind === 'audioinput'));
      startMeter(stream);
      setStatus('ready');
    } catch (err) {
      console.error('Device preview error:', err);
      setStatus('denied');
    }
  }, [videoDeviceId, audioDeviceId, stopStream, startMeter]);

  useEffect(() => {
    startPreview();
    return stopStream;
  }, [startPreview, stopStream]);

  const handleJoin = () => {
    writePrefs({ videoDeviceId, audioDeviceId });
    stopStream();
    onJoin?.({ videoDeviceId, audioDeviceId });
  };

  const heading = role === 'patient' ? 'Get ready for your visit' : 'Check your camera & mic';

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Video className="w-5 h-5 text-blue-600" />
          {heading}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="relative bg-slate-900 rounded-xl overflow-hidden aspect-video">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover [transform:scaleX(-1)]"
          />
          {status === 'loading' && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="w-8 h-8 text-blue-300 animate-spin" />
            </div>
          )}
          {status === 'denied' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center p-4">
              <AlertTriangle className="w-8 h-8 text-amber-400" />
              <p className="text-white text-sm max-w-xs">
                We couldn&apos;t access your camera or microphone. Please allow access in your
                browser, then try again.
              </p>
              <Button variant="outline" size="sm" onClick={startPreview}>Try again</Button>
            </div>
          )}
        </div>

        {/* Mic level meter */}
        <div className="flex items-center gap-2">
          <Mic className="w-4 h-4 text-slate-500" />
          <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 transition-[width] duration-75"
              style={{ width: `${Math.round(level * 100)}%` }}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs flex items-center gap-1.5 mb-1"><Video className="w-3.5 h-3.5" /> Camera</Label>
            <Select value={videoDeviceId} onValueChange={setVideoDeviceId} disabled={status !== 'ready' || cameras.length === 0}>
              <SelectTrigger><SelectValue placeholder="Default camera" /></SelectTrigger>
              <SelectContent>
                {cameras.map((c, i) => (
                  <SelectItem key={c.deviceId || i} value={c.deviceId}>{c.label || `Camera ${i + 1}`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs flex items-center gap-1.5 mb-1"><Mic className="w-3.5 h-3.5" /> Microphone</Label>
            <Select value={audioDeviceId} onValueChange={setAudioDeviceId} disabled={status !== 'ready' || mics.length === 0}>
              <SelectTrigger><SelectValue placeholder="Default microphone" /></SelectTrigger>
              <SelectContent>
                {mics.map((m, i) => (
                  <SelectItem key={m.deviceId || i} value={m.deviceId}>{m.label || `Microphone ${i + 1}`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Button
          onClick={handleJoin}
          disabled={status !== 'ready'}
          className="w-full h-12 bg-blue-600 hover:bg-blue-700 text-white font-semibold gap-2"
        >
          {status === 'ready' ? <Video className="w-5 h-5" /> : <Loader2 className="w-5 h-5 animate-spin" />}
          {status === 'ready' ? 'Join Visit' : 'Preparing devices…'}
        </Button>
      </CardContent>
    </Card>
  );
}
