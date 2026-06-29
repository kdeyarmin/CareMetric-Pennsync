import { useState } from 'react';
import { Mic } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import WhisperTranscriber from './WhisperTranscriber';

/**
 * Integration wrapper for voice transcription in note editors
 * Provides dialog UI for recording and inserting transcribed text
 */
export default function VoiceNoteIntegration({ onInsertText, disabled = false }) {
  const [isOpen, setIsOpen] = useState(false);

  const handleTranscribe = (text) => {
    if (text) {
      onInsertText(text);
      // Keep dialog open to allow adding more observations
    }
  };

  return (
    <>
      <Button
        onClick={() => setIsOpen(true)}
        disabled={disabled}
        variant="outline"
        size="sm"
        className="gap-2"
      >
        <Mic className="w-4 h-4" />
        Voice Note
      </Button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-lg">
          <DialogTitle>Bedside Voice Transcription</DialogTitle>
          <DialogDescription>
            Record clinical observations using your microphone. Your speech will be
            transcribed to text using AI.
          </DialogDescription>
          <WhisperTranscriber onTranscribe={handleTranscribe} />
        </DialogContent>
      </Dialog>
    </>
  );
}