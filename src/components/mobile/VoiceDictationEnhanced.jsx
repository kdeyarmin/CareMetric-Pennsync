import React, { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Mic, MicOff, Volume2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

export default function VoiceDictationEnhanced({ onTranscript, buttonSize = "default" }) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const recognitionRef = useRef(null);
  const [isSupported, setIsSupported] = useState(false);

  useEffect(() => {
    // Check if browser supports Web Speech API
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      setIsSupported(true);
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = 'en-US';
      recognitionRef.current.maxAlternatives = 1;

      recognitionRef.current.onresult = (event) => {
        let interimText = '';
        let finalText = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalText += transcript + ' ';
          } else {
            interimText += transcript;
          }
        }

        if (finalText) {
          setTranscript(prev => prev + finalText);
          onTranscript?.(finalText);
        }
        setInterimTranscript(interimText);
      };

      recognitionRef.current.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        if (event.error === 'no-speech') {
          toast.error('No speech detected. Try speaking closer to the microphone.');
        } else if (event.error === 'audio-capture') {
          toast.error('Microphone not accessible');
        } else if (event.error === 'not-allowed') {
          toast.error('Microphone permission denied');
        }
        setIsListening(false);
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
        setInterimTranscript("");
      };
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  const toggleListening = () => {
    if (!isSupported) {
      toast.error('Speech recognition not supported in this browser');
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
      if (navigator.vibrate) navigator.vibrate([50, 50]);
    } else {
      recognitionRef.current.start();
      setIsListening(true);
      if (navigator.vibrate) navigator.vibrate(100);
      toast.success('Listening... Speak now', { duration: 2000 });
    }
  };

  if (!isSupported) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <AlertCircle className="w-4 h-4" />
        Voice input not supported
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        onClick={toggleListening}
        size={buttonSize}
        className={`gap-2 touch-target ${
          isListening 
            ? 'bg-red-600 hover:bg-red-700 animate-pulse' 
            : 'bg-blue-600 hover:bg-blue-700'
        }`}
      >
        {isListening ? (
          <>
            <MicOff className="w-4 h-4" />
            Stop
          </>
        ) : (
          <>
            <Mic className="w-4 h-4" />
            Dictate
          </>
        )}
      </Button>

      {isListening && (
        <Badge className="bg-red-100 text-red-800 animate-pulse">
          <Volume2 className="w-3 h-3 mr-1" />
          Listening...
        </Badge>
      )}

      {interimTranscript && (
        <span className="text-xs text-gray-500 italic">
          {interimTranscript}
        </span>
      )}
    </div>
  );
}