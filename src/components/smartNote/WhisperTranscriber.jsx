import { useRef, useState, useEffect } from 'react';
import { configNotReadyMessage } from '@/lib/aiFeatureError';
import { Mic, MicOff, Loader, AlertCircle, Copy, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';

/**
 * Real-time audio transcription component using OpenAI Whisper
 * Optimized for bedside clinical documentation during patient visits
 */
export default function WhisperTranscriber({ onTranscribe, disabled = false }) {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [recordingTime, setRecordingTime] = useState(0);
  const [error, setError] = useState(null);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);
  const streamRef = useRef(null);

  // Release the mic, timer, and recorder if the component unmounts mid-recording
  // (navigating away without pressing Stop) so the microphone isn't left live.
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (timerRef.current) clearInterval(timerRef.current);
      const mr = mediaRecorderRef.current;
      if (mr && mr.state !== "inactive") { try { mr.stop(); } catch { /* already stopped */ } }
    };
  }, []);

  // Initialize audio recording
  const startRecording = async () => {
    try {
      setError(null);
      setTranscript('');
      audioChunksRef.current = [];

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      streamRef.current = stream;

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm',
      });

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);

      // Timer for recording duration
      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);

      toast.success('Recording started');
    } catch (err) {
      setError('Microphone access denied. Please enable microphone permissions.');
      console.error('Recording error:', err);
    }
  };

  // Stop recording and transcribe
  const stopRecording = async () => {
    if (!mediaRecorderRef.current) return;

    mediaRecorderRef.current.stop();
    setIsRecording(false);

    if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    // Stop stream tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
    }

    // Wait for recording to finish
    await new Promise((resolve) => {
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.onstop = resolve;
      } else {
        resolve();
      }
    });

    // Transcribe audio
    await transcribeAudio();
  };

  // Send audio to Whisper API for transcription
  const transcribeAudio = async () => {
    if (audioChunksRef.current.length === 0) {
      setError('No audio recorded');
      return;
    }

    setIsTranscribing(true);
    setError(null);

    try {
      // Combine audio chunks into a single File. The SDK detects the File and
      // uploads it as multipart/form-data (with auth) to the backend function,
      // which reads the `file` field via req.formData() and returns { text }.
      const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      const audioFile = new File([audioBlob], `whisper-recording-${Date.now()}.webm`, {
        type: 'audio/webm',
      });

      // functions.invoke does not unwrap the response (interceptResponses:
      // false), so the backend's JSON body lives on response.data.
      const response = await base44.functions.invoke('transcribeAudioWithWhisper', {
        file: audioFile,
      });
      const result = response.data;

      if (result?.text) {
        setTranscript(result.text);
        onTranscribe?.(result.text);
        toast.success('Transcription complete');
      } else {
        setError('Could not transcribe audio. Please try again.');
      }
    } catch (err) {
      const friendly = configNotReadyMessage(err);
      setError(friendly || err.message || 'Transcription error');
      if (!friendly) console.error('Transcription error:', err);
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleCopyTranscript = async () => {
    try {
      await navigator.clipboard.writeText(transcript);
      toast.success('Copied to clipboard');
    } catch (err) {
      console.error('Clipboard write failed:', err);
      toast.error('Failed to copy to clipboard');
    }
  };

  const handleClearTranscript = () => {
    setTranscript('');
    audioChunksRef.current = [];
    setRecordingTime(0);
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <Card className="border-indigo-200 bg-gradient-to-br from-indigo-50 to-blue-50">
      <CardContent className="p-6">
        {/* Recording Controls */}
        <div className="flex items-center gap-3 mb-4">
          {isRecording ? (
            <>
              <Button
                onClick={stopRecording}
                disabled={isTranscribing}
                className="gap-2 bg-red-600 hover:bg-red-700"
              >
                <MicOff className="w-4 h-4" />
                Stop Recording
              </Button>
              <div className="flex items-center gap-2 ml-auto">
                <div className="w-3 h-3 bg-red-600 rounded-full animate-pulse" />
                <span className="text-sm font-semibold text-slate-700">
                  {formatTime(recordingTime)}
                </span>
              </div>
            </>
          ) : (
            <>
              <Button
                onClick={startRecording}
                disabled={disabled || isTranscribing || !!transcript}
                className="gap-2 bg-indigo-600 hover:bg-indigo-700"
              >
                <Mic className="w-4 h-4" />
                Start Recording
              </Button>
              {isTranscribing && (
                <div className="flex items-center gap-2 ml-auto">
                  <Loader className="w-4 h-4 animate-spin text-indigo-600" />
                  <span className="text-sm text-slate-600">Transcribing...</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-red-900">Transcription Error</p>
              <p className="text-sm text-red-700">{error}</p>
            </div>
          </div>
        )}

        {/* Transcript Display */}
        {transcript && (
          <div className="space-y-3">
            <div className="bg-white p-4 rounded-lg border border-slate-200">
              <p className="text-slate-900 leading-relaxed">{transcript}</p>
            </div>

            {/* Transcript Actions */}
            <div className="flex gap-2">
              <Button
                onClick={handleCopyTranscript}
                variant="outline"
                size="sm"
                className="gap-2"
              >
                <Copy className="w-4 h-4" />
                Copy
              </Button>
              <Button
                onClick={handleClearTranscript}
                variant="outline"
                size="sm"
                className="gap-2"
              >
                <RotateCcw className="w-4 h-4" />
                Clear
              </Button>
            </div>
          </div>
        )}

        {/* Instructions */}
        {!transcript && !isRecording && (
          <div className="text-xs text-slate-600 space-y-1">
            <p>💡 Tips for best results:</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li>Speak clearly and at a normal pace</li>
              <li>Minimize background noise</li>
              <li>Use medical terminology naturally</li>
              <li>Review and edit transcription before saving</li>
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}