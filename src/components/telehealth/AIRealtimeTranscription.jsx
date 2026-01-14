import React, { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Mic, MicOff, Brain, Loader2, CheckCircle, FileText } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";

export default function TelehealthAITranscription({ visitId, patientId, isActive }) {
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [aiSummary, setAiSummary] = useState("");
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const recognitionRef = useRef(null);

  useEffect(() => {
    if (!isActive) {
      stopTranscription();
    }
  }, [isActive]);

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
      const transcript = Array.from(event.results)
        .map(result => result[0].transcript)
        .join('');
      
      // Real-time transcription update
      setLiveTranscript(transcript);
    };

    recognition.start();
  };

  // Create the AI-powered components
  return (
    <>
      <RealTimeTranscriptionPanel />
      <AISymptomChecker />
      <FollowUpInstructionsGenerator />
    </>
  );
}