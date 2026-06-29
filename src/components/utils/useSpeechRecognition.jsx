import { useState, useRef, useEffect } from 'react';
import { toast } from 'sonner';

export const useSpeechRecognition = (onFinalTranscript) => {
  const [listening, setListening] = useState(false);
  const [interimText, setInterimText] = useState('');
  const recognitionRef = useRef(null);

  const startDictation = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      toast.error('Speech recognition not supported in your browser');
      return;
    }

    try {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      const recognition = new SpeechRecognition();
      recognitionRef.current = recognition;

      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = (event) => {
        let interim = '', final = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            final += transcript + ' ';
          } else {
            interim += transcript;
          }
        }
        if (final) {
          onFinalTranscript(final.trim());
          setInterimText('');
        } else if (interim) {
          setInterimText(interim);
        }
      };

      recognition.onend = () => {
        setListening(prev => {
          if (prev) {
            try {
              recognition.start();
            } catch (e) {
              console.error('Restart error:', e);
              return false;
            }
          } else {
            setInterimText('');
          }
          return prev;
        });
      };

      recognition.onerror = (event) => {
        console.error('Speech error:', event.error);
        if (event.error === 'no-speech' || event.error === 'audio-capture') {
          setTimeout(() => {
            try {
              if (recognitionRef.current) recognition.start();
            } catch (e) {
              console.error('Restart failed:', e);
            }
          }, 100);
        } else {
          setListening(false);
          setInterimText('');
        }
      };

      setListening(true);
      recognition.start();
    } catch (error) {
      console.error('Failed to start dictation:', error);
      toast.error('Failed to start voice dictation. Please try again.');
    }
  };

  const stopDictation = () => {
    setListening(false);
    setInterimText('');
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      if (recognitionRef.current) recognitionRef.current.stop();
    };
  }, []);

  return { listening, interimText, startDictation, stopDictation };
};