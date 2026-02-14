import React, { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Mic, MicOff, Loader2, Square, Pause, Play, Trash2, CheckCircle } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { motion, AnimatePresence } from "framer-motion";

export default function MobileVoiceRecorder({ onTranscriptionComplete, onRecordingChange, compact = false }) {
  const [state, setState] = useState("idle"); // idle | recording | paused | processing
  const [duration, setDuration] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const analyserRef = useRef(null);
  const animFrameRef = useRef(null);

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, []);

  useEffect(() => {
    if (state === "recording") {
      timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [state]);

  const cleanup = () => {
    clearInterval(timerRef.current);
    cancelAnimationFrame(animFrameRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    mediaRecorderRef.current = null;
    streamRef.current = null;
    analyserRef.current = null;
  };

  const startLevelMonitor = (stream) => {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    const source = ctx.createMediaStreamSource(stream);
    source.connect(analyser);
    analyserRef.current = analyser;

    const buf = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteFrequencyData(buf);
      const avg = buf.reduce((a, b) => a + b, 0) / buf.length;
      setAudioLevel(avg / 255);
      animFrameRef.current = requestAnimationFrame(tick);
    };
    tick();
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      streamRef.current = stream;
      chunksRef.current = [];
      
      const recorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4" });
      mediaRecorderRef.current = recorder;
      
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => processAudio();
      
      recorder.start(1000); // collect in 1s chunks
      setState("recording");
      setDuration(0);
      startLevelMonitor(stream);
      onRecordingChange?.(true);
    } catch (err) {
      toast.error("Microphone access denied");
    }
  };

  const pauseRecording = () => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.pause();
      setState("paused");
      cancelAnimationFrame(animFrameRef.current);
      setAudioLevel(0);
    }
  };

  const resumeRecording = () => {
    if (mediaRecorderRef.current?.state === "paused") {
      mediaRecorderRef.current.resume();
      setState("recording");
      if (analyserRef.current) {
        const buf = new Uint8Array(analyserRef.current.frequencyBinCount);
        const tick = () => { analyserRef.current.getByteFrequencyData(buf); setAudioLevel(buf.reduce((a,b) => a+b, 0) / buf.length / 255); animFrameRef.current = requestAnimationFrame(tick); };
        tick();
      }
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      setState("processing");
      cancelAnimationFrame(animFrameRef.current);
      setAudioLevel(0);
      mediaRecorderRef.current.stop();
      streamRef.current?.getTracks().forEach(t => t.stop());
      onRecordingChange?.(false);
    }
  };

  const discardRecording = () => {
    cleanup();
    chunksRef.current = [];
    setState("idle");
    setDuration(0);
    setAudioLevel(0);
    onRecordingChange?.(false);
  };

  const processAudio = async () => {
    if (chunksRef.current.length === 0) { setState("idle"); return; }
    
    try {
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      const { file_url } = await base44.integrations.Core.UploadFile({ file: blob });
      
      const result = await base44.functions.invoke("transcribeWithDeepgram", { audio_url: file_url });
      const text = result.data?.text || result.data?.transcript || "";
      
      if (!text) {
        toast.error("No speech detected");
        setState("idle");
        return;
      }
      
      onTranscriptionComplete?.(text);
      toast.success(`Transcribed ${formatDuration(duration)} of audio`);
      setState("idle");
      setDuration(0);
    } catch (err) {
      console.error("Transcription failed:", err);
      toast.error("Transcription failed — audio saved locally");
      setState("idle");
    }
  };

  const formatDuration = (s) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  // Compact pill mode for embedding in forms
  if (compact) {
    return (
      <div className="flex items-center gap-2">
        {state === "idle" && (
          <Button type="button" size="sm" variant="outline" onClick={startRecording} className="gap-1.5 h-9 touch-target">
            <Mic className="w-4 h-4" /> Dictate
          </Button>
        )}
        {state === "recording" && (
          <div className="flex items-center gap-2 bg-red-50 dark:bg-red-950 border border-red-200 rounded-lg px-3 py-1.5">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-xs font-mono text-red-700 dark:text-red-300">{formatDuration(duration)}</span>
            <Button type="button" size="icon" variant="ghost" onClick={pauseRecording} className="h-7 w-7"><Pause className="w-3 h-3" /></Button>
            <Button type="button" size="icon" variant="ghost" onClick={stopRecording} className="h-7 w-7 text-red-600"><Square className="w-3 h-3" /></Button>
          </div>
        )}
        {state === "paused" && (
          <div className="flex items-center gap-2 bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 rounded-lg px-3 py-1.5">
            <span className="text-xs text-yellow-700 dark:text-yellow-300">Paused {formatDuration(duration)}</span>
            <Button type="button" size="icon" variant="ghost" onClick={resumeRecording} className="h-7 w-7"><Play className="w-3 h-3" /></Button>
            <Button type="button" size="icon" variant="ghost" onClick={stopRecording} className="h-7 w-7 text-green-600"><CheckCircle className="w-3 h-3" /></Button>
            <Button type="button" size="icon" variant="ghost" onClick={discardRecording} className="h-7 w-7 text-red-600"><Trash2 className="w-3 h-3" /></Button>
          </div>
        )}
        {state === "processing" && (
          <div className="flex items-center gap-2 text-blue-600 text-xs">
            <Loader2 className="w-4 h-4 animate-spin" /> Transcribing...
          </div>
        )}
      </div>
    );
  }

  // Full card mode
  return (
    <Card className={`overflow-hidden transition-all ${state === "recording" ? "border-red-300 shadow-red-100 shadow-lg" : state === "processing" ? "border-blue-300" : ""}`}>
      <CardContent className="p-4 space-y-3">
        {/* Audio level visualizer */}
        <AnimatePresence>
          {(state === "recording") && (
            <motion.div initial={{ height: 0 }} animate={{ height: 40 }} exit={{ height: 0 }} className="flex items-end justify-center gap-[3px]">
              {Array.from({ length: 20 }).map((_, i) => (
                <motion.div
                  key={i}
                  className="w-1.5 rounded-full bg-red-400"
                  animate={{ height: Math.max(4, audioLevel * 40 * (0.5 + Math.random() * 0.5)) }}
                  transition={{ duration: 0.1 }}
                />
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Timer */}
        {state !== "idle" && (
          <div className="text-center">
            <span className="text-2xl font-mono font-bold text-slate-800 dark:text-slate-200">{formatDuration(duration)}</span>
            {state === "recording" && <p className="text-xs text-red-600 mt-1 animate-pulse">Recording...</p>}
            {state === "paused" && <p className="text-xs text-yellow-600 mt-1">Paused</p>}
            {state === "processing" && <p className="text-xs text-blue-600 mt-1 flex items-center justify-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />Transcribing...</p>}
          </div>
        )}

        {/* Controls */}
        <div className="flex items-center justify-center gap-3">
          {state === "idle" && (
            <Button onClick={startRecording} size="lg" className="h-14 w-14 rounded-full bg-red-500 hover:bg-red-600 shadow-lg active:scale-90 transition-transform">
              <Mic className="w-6 h-6 text-white" />
            </Button>
          )}
          {state === "recording" && (
            <>
              <Button onClick={discardRecording} size="icon" variant="outline" className="h-10 w-10 rounded-full active:scale-90">
                <Trash2 className="w-4 h-4 text-slate-500" />
              </Button>
              <Button onClick={pauseRecording} size="icon" variant="outline" className="h-10 w-10 rounded-full active:scale-90">
                <Pause className="w-4 h-4" />
              </Button>
              <Button onClick={stopRecording} size="lg" className="h-14 w-14 rounded-full bg-green-500 hover:bg-green-600 shadow-lg active:scale-90 transition-transform">
                <CheckCircle className="w-6 h-6 text-white" />
              </Button>
            </>
          )}
          {state === "paused" && (
            <>
              <Button onClick={discardRecording} size="icon" variant="outline" className="h-10 w-10 rounded-full active:scale-90">
                <Trash2 className="w-4 h-4 text-red-500" />
              </Button>
              <Button onClick={resumeRecording} size="lg" className="h-14 w-14 rounded-full bg-blue-500 hover:bg-blue-600 shadow-lg active:scale-90 transition-transform">
                <Play className="w-6 h-6 text-white" />
              </Button>
              <Button onClick={stopRecording} size="icon" variant="outline" className="h-10 w-10 rounded-full active:scale-90">
                <CheckCircle className="w-4 h-4 text-green-500" />
              </Button>
            </>
          )}
        </div>

        {state === "idle" && (
          <p className="text-xs text-center text-slate-500">Tap to start voice dictation</p>
        )}
      </CardContent>
    </Card>
  );
}