import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Mic, MicOff, Volume2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from 'sonner';

const SUPPORTED_LANGUAGES = [
  { code: 'en-US', name: 'English (US)', flag: '🇺🇸' },
  { code: 'en-GB', name: 'English (UK)', flag: '🇬🇧' },
  { code: 'es-ES', name: 'Spanish', flag: '🇪🇸' },
  { code: 'fr-FR', name: 'French', flag: '🇫🇷' },
  { code: 'de-DE', name: 'German', flag: '🇩🇪' },
  { code: 'it-IT', name: 'Italian', flag: '🇮🇹' },
  { code: 'pt-BR', name: 'Portuguese', flag: '🇧🇷' },
  { code: 'zh-CN', name: 'Chinese', flag: '🇨🇳' },
  { code: 'ja-JP', name: 'Japanese', flag: '🇯🇵' },
  { code: 'ko-KR', name: 'Korean', flag: '🇰🇷' },
  { code: 'ar-SA', name: 'Arabic', flag: '🇸🇦' },
  { code: 'hi-IN', name: 'Hindi', flag: '🇮🇳' }
];

export default function EnhancedVoiceCommands({
  onTranscription,
  onCommand,
  commands = [],
  mode = 'dictation', // 'dictation' or 'command'
  showSettings = true
}) {
  const [listening, setListening] = useState(false);
  const [language, setLanguage] = useState('en-US');
  const [interimText, setInterimText] = useState('');
  const [lastCommand, setLastCommand] = useState(null);
  const [commandMode, setCommandMode] = useState(mode);
  const [confidence, setConfidence] = useState(null);
  const recognitionRef = useRef(null);
  // The recognition.onend/onerror handlers are created inside startListening
  // BEFORE setListening(true) applies, so they captured a stale `listening`
  // (always false) and never auto-restarted. Read this ref instead.
  const listeningRef = useRef(false);

  useEffect(() => {
    listeningRef.current = listening;
  }, [listening]);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  const matchCommand = (text) => {
    const normalizedText = text.toLowerCase().trim();
    
    for (const command of commands) {
      // Check exact match
      if (normalizedText === command.trigger.toLowerCase()) {
        return command;
      }
      
      // Check if text starts with trigger
      if (normalizedText.startsWith(command.trigger.toLowerCase())) {
        return { ...command, extractedValue: text.substring(command.trigger.length).trim() };
      }
      
      // Check aliases
      if (command.aliases) {
        for (const alias of command.aliases) {
          if (normalizedText === alias.toLowerCase() || normalizedText.startsWith(alias.toLowerCase())) {
            return { ...command, extractedValue: text.substring(alias.length).trim() };
          }
        }
      }
      
      // Fuzzy matching for common variations
      const similarity = calculateSimilarity(normalizedText, command.trigger.toLowerCase());
      if (similarity > 0.8) {
        return command;
      }
    }
    
    return null;
  };

  const calculateSimilarity = (str1, str2) => {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) return 1.0;
    
    const editDistance = levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  };

  const levenshteinDistance = (str1, str2) => {
    const matrix = [];
    
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    return matrix[str2.length][str1.length];
  };

  const startListening = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      toast.error('Speech recognition not supported in your browser');
      return;
    }
    
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = language;
    recognition.maxAlternatives = 3; // Get multiple alternatives for better accuracy
    
    recognition.onresult = (event) => {
      let interimTranscript = '';
      let finalTranscript = '';
      let maxConfidence = 0;
      
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript;
        const resultConfidence = result[0].confidence;
        
        if (result.isFinal) {
          finalTranscript += transcript + ' ';
          maxConfidence = Math.max(maxConfidence, resultConfidence);
        } else {
          interimTranscript += transcript;
        }
      }
      
      if (finalTranscript) {
        setConfidence(maxConfidence);
        const trimmedText = finalTranscript.trim();
        
        if (commandMode === 'command') {
          const matchedCommand = matchCommand(trimmedText);
          if (matchedCommand) {
            setLastCommand(matchedCommand.action);
            onCommand?.(matchedCommand.action, trimmedText, matchedCommand.extractedValue);
            
            // Visual feedback
            setTimeout(() => setLastCommand(null), 2000);
          } else {
            // If no command matched in command mode, still transcribe
            onTranscription?.(trimmedText);
          }
        } else {
          // Dictation mode - just transcribe
          onTranscription?.(trimmedText);
        }
        
        setInterimText('');
        setConfidence(null);
      } else if (interimTranscript) {
        setInterimText(interimTranscript);
      }
    };
    
    recognition.onend = () => {
      if (listeningRef.current) {
        // Auto-restart if still supposed to be listening
        try {
          recognition.start();
        } catch (e) {
          console.error('Error restarting recognition:', e);
        }
      } else {
        setListening(false);
        setInterimText('');
      }
    };

    recognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
      if (event.error === 'no-speech' || event.error === 'audio-capture') {
        if (listeningRef.current) {
          setTimeout(() => {
            try {
              recognition.start();
            } catch (e) {
              console.error('Error restarting after error:', e);
            }
          }, 100);
        }
      } else {
        setListening(false);
        setInterimText('');
      }
    };

    listeningRef.current = true;
    setListening(true);
    recognition.start();
  };

  const stopListening = () => {
    listeningRef.current = false;
    setListening(false);
    setInterimText('');
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
  };

  const toggleMode = () => {
    setCommandMode(prev => prev === 'dictation' ? 'command' : 'dictation');
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button
          size="default"
          variant={listening ? "destructive" : "outline"}
          onClick={listening ? stopListening : startListening}
          className="gap-2 min-h-[44px] px-4 flex-shrink-0"
        >
          {listening ? <MicOff className="w-4 h-4 md:w-5 md:h-5" /> : <Mic className="w-4 h-4 md:w-5 md:h-5" />}
          <span className="text-sm md:text-base">{listening ? 'Stop' : 'Start'}</span>
        </Button>
        
        {showSettings && (
          <>
            <Select value={language} onValueChange={setLanguage} disabled={listening}>
              <SelectTrigger className="w-32 h-[44px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUPPORTED_LANGUAGES.map(lang => (
                  <SelectItem key={lang.code} value={lang.code}>
                    {lang.flag} {lang.name.split(' ')[0]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            <Button
              size="sm"
              variant="outline"
              onClick={toggleMode}
              disabled={listening}
              className="gap-1"
            >
              <Volume2 className="w-3 h-3" />
              {commandMode === 'command' ? 'Commands' : 'Dictation'}
            </Button>
          </>
        )}
      </div>
      
      {listening && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 animate-pulse">
              <div className="w-2 h-2 bg-red-500 rounded-full"></div>
              <span className="text-xs text-slate-600">
                Listening ({commandMode === 'command' ? 'Command Mode' : 'Dictation Mode'})
              </span>
            </div>
            {confidence !== null && (
              <Badge variant="outline" className="text-xs">
                {Math.round(confidence * 100)}% confident
              </Badge>
            )}
          </div>
          
          {interimText && (
            <Card className="bg-blue-50 border-blue-200">
              <CardContent className="p-2 text-sm text-blue-900 italic">
                {interimText}...
              </CardContent>
            </Card>
          )}
          
          {lastCommand && (
            <Alert className="bg-green-50 border-green-300 animate-pulse">
              <AlertDescription className="text-xs text-green-900 font-medium">
                ✓ Command executed: {lastCommand}
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}
    </div>
  );
}