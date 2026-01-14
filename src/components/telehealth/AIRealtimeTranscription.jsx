import React, { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Mic, MicOff, Brain, Loader2, CheckCircle, FileText, Copy } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";

export default function AIRealtimeTranscription({ visitId, patientId, isActive }) {
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [liveTranscript, setLiveTranscript] = useState("");
  const [aiSummary, setAiSummary] = useState("");
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [keyPoints, setKeyPoints] = useState([]);
  const recognitionRef = useRef(null);
  const transcriptEndRef = useRef(null);

  useEffect(() => {
    if (!isActive && isTranscribing) {
      stopTranscription();
    }
  }, [isActive]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript, liveTranscript]);

  const startTranscription = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      toast.error('Speech recognition not supported in this browser');
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      let interim = '';
      let final = '';
      
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          final += event.results[i][0].transcript + ' ';
        } else {
          interim += event.results[i][0].transcript;
        }
      }

      if (final) {
        setTranscript(prev => prev + final);
        setLiveTranscript('');
      } else {
        setLiveTranscript(interim);
      }
    };

    recognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
      if (event.error !== 'no-speech') {
        toast.error('Transcription error occurred');
      }
    };

    recognition.onend = () => {
      if (isTranscribing) {
        recognition.start(); // Auto-restart if still active
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsTranscribing(true);
    toast.success('Real-time transcription started');
  };

  const stopTranscription = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsTranscribing(false);
    setLiveTranscript('');
    toast.info('Transcription stopped');
  };

  const generateAISummary = async () => {
    if (!transcript.trim()) {
      toast.error('No transcript to summarize');
      return;
    }

    setIsGeneratingSummary(true);
    try {
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `Analyze this telehealth consultation transcript and provide:
1. A concise clinical summary (2-3 sentences)
2. Key discussion points (bulleted list)
3. Patient concerns mentioned
4. Any red flags or urgent items

Transcript:
${transcript}

Format the response as JSON with keys: summary, keyPoints (array), concerns (array), redFlags (array)`,
        response_json_schema: {
          type: "object",
          properties: {
            summary: { type: "string" },
            keyPoints: { type: "array", items: { type: "string" } },
            concerns: { type: "array", items: { type: "string" } },
            redFlags: { type: "array", items: { type: "string" } }
          }
        }
      });

      setAiSummary(result.summary);
      setKeyPoints(result.keyPoints || []);
      
      // Save to visit notes
      if (visitId) {
        await base44.entities.Visit.update(visitId, {
          ai_transcript: transcript,
          ai_summary: result.summary,
          telehealth_summary: JSON.stringify(result)
        });
      }

      toast.success('AI summary generated');
    } catch (error) {
      console.error('Error generating summary:', error);
      toast.error('Failed to generate AI summary');
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  const copyTranscript = () => {
    navigator.clipboard.writeText(transcript);
    toast.success('Transcript copied to clipboard');
  };

  return (
    <Card className="border-purple-200">
      <CardHeader className="pb-3 bg-gradient-to-r from-purple-50 to-pink-50">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-purple-600" />
            AI Real-Time Transcription
          </span>
          <div className="flex items-center gap-2">
            {isTranscribing && (
              <Badge variant="outline" className="text-xs bg-red-50 text-red-700 border-red-200">
                <span className="animate-pulse mr-1">●</span>
                Recording
              </Badge>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 p-4">
        {/* Controls */}
        <div className="flex gap-2">
          <Button
            onClick={isTranscribing ? stopTranscription : startTranscription}
            variant={isTranscribing ? "destructive" : "default"}
            size="sm"
            className="flex-1"
            disabled={!isActive}
          >
            {isTranscribing ? (
              <>
                <MicOff className="w-4 h-4 mr-2" />
                Stop Recording
              </>
            ) : (
              <>
                <Mic className="w-4 h-4 mr-2" />
                Start Recording
              </>
            )}
          </Button>
          <Button
            onClick={copyTranscript}
            variant="outline"
            size="sm"
            disabled={!transcript}
          >
            <Copy className="w-4 h-4" />
          </Button>
        </div>

        {/* Transcript Display */}
        <div className="bg-gray-50 rounded-lg p-4 min-h-[200px] max-h-[300px] overflow-y-auto border border-gray-200">
          {!transcript && !liveTranscript ? (
            <p className="text-sm text-gray-500 text-center py-8">
              Click "Start Recording" to begin transcription
            </p>
          ) : (
            <div className="text-sm space-y-2">
              <p className="text-gray-900 whitespace-pre-wrap">{transcript}</p>
              {liveTranscript && (
                <p className="text-gray-500 italic">{liveTranscript}</p>
              )}
              <div ref={transcriptEndRef} />
            </div>
          )}
        </div>

        {/* AI Summary Section */}
        {transcript && (
          <div className="space-y-3">
            <Button
              onClick={generateAISummary}
              disabled={isGeneratingSummary}
              size="sm"
              className="w-full bg-purple-600 hover:bg-purple-700"
            >
              {isGeneratingSummary ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Generating AI Summary...
                </>
              ) : (
                <>
                  <Brain className="w-4 h-4 mr-2" />
                  Generate AI Summary
                </>
              )}
            </Button>

            {aiSummary && (
              <div className="bg-purple-50 rounded-lg p-4 border border-purple-200">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle className="w-4 h-4 text-purple-600" />
                  <h4 className="text-sm font-semibold text-purple-900">Clinical Summary</h4>
                </div>
                <p className="text-sm text-purple-800 mb-3">{aiSummary}</p>
                
                {keyPoints.length > 0 && (
                  <div>
                    <h5 className="text-xs font-semibold text-purple-900 mb-2">Key Points:</h5>
                    <ul className="text-xs text-purple-800 space-y-1">
                      {keyPoints.map((point, idx) => (
                        <li key={idx} className="flex gap-2">
                          <span>•</span>
                          <span>{point}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <p className="text-xs text-gray-500">
          Real-time speech-to-text powered by AI. Transcript is automatically saved to visit notes.
        </p>
      </CardContent>
    </Card>
  );
}