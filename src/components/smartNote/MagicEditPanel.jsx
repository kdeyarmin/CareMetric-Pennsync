import React, { useState, useRef, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Wand2, Send, Mic, MicOff, Undo2, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

export default function MagicEditPanel({ noteContent, onNoteUpdated, patientData, visitType, diagnosis }) {
  const [editRequest, setEditRequest] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [editHistory, setEditHistory] = useState([]);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef(null);

  const quickCommands = [
    { label: "Make more concise", prompt: "Make this note more concise while keeping all critical clinical details" },
    { label: "Add more detail", prompt: "Add more clinical detail and specific observations to this note" },
    { label: "Improve flow", prompt: "Improve the narrative flow and readability of this note" },
    { label: "Strengthen justification", prompt: "Strengthen the skilled need justification and homebound status documentation" },
    { label: "Add ROS detail", prompt: "Add more Review of Systems detail appropriate for this visit" },
    { label: "Undo last change", prompt: "__UNDO__" }
  ];

  const startVoiceInput = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      toast.error('Speech recognition not supported');
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;

    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setEditRequest(transcript);
      toast.success('Voice captured');
    };

    recognition.onerror = () => {
      toast.error('Voice input failed');
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    setIsListening(true);
    recognition.start();
    toast.info('Listening...');
  };

  const stopVoiceInput = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
    }
  };

  const handleMagicEdit = async (customPrompt = null) => {
    const requestText = customPrompt || editRequest;
    
    if (!requestText.trim()) {
      toast.error("Enter an edit request");
      return;
    }

    // Handle undo
    if (requestText === "__UNDO__") {
      if (editHistory.length > 0) {
        const previousNote = editHistory[editHistory.length - 1];
        onNoteUpdated(previousNote);
        setEditHistory(prev => prev.slice(0, -1));
        toast.success("Edit undone");
      } else {
        toast.error("No edits to undo");
      }
      return;
    }

    setIsProcessing(true);
    
    // Save current note to history before editing
    setEditHistory(prev => [...prev, noteContent]);

    try {
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `You are Magic Edit - an AI assistant that helps clinicians refine their clinical notes.

The clinician has requested: "${requestText}"

CURRENT NOTE:
${noteContent}

${patientData ? `
PATIENT CONTEXT:
- Name: ${patientData.first_name} ${patientData.last_name}
- Diagnosis: ${patientData.primary_diagnosis || diagnosis}
- Visit Type: ${visitType}
` : ''}

Apply the requested edit to the note. Maintain medical accuracy and compliance requirements.

CRITICAL RULES:
- Only modify what was requested
- Keep all essential clinical information
- Maintain professional medical documentation standards
- Do NOT add meta-commentary about documentation
- Return ONLY the edited note text

Return JSON:
{
  "edited_note": "The complete edited note",
  "changes_made": "Brief summary of what was changed"
}`,
        response_json_schema: {
          type: "object",
          properties: {
            edited_note: { type: "string" },
            changes_made: { type: "string" }
          }
        }
      });

      onNoteUpdated(result.edited_note);
      toast.success(`✨ ${result.changes_made}`);
      setEditRequest("");

      // Track magic edit usage
      try {
        const user = await base44.auth.me();
        if (user?.email) {
          const patterns = await base44.entities.ProviderUsagePattern.filter({ provider_email: user.email });
          if (patterns[0]) {
            const featureUsage = patterns[0].feature_usage || {};
            featureUsage.magic_edit_count = (featureUsage.magic_edit_count || 0) + 1;
            await base44.entities.ProviderUsagePattern.update(patterns[0].id, { 
              feature_usage: featureUsage,
              last_updated: new Date().toISOString()
            });
          }
        }
      } catch (e) {
        // Silent fail
      }
    } catch (error) {
      toast.error("Magic Edit failed");
      // Restore from history
      if (editHistory.length > 0) {
        onNoteUpdated(editHistory[editHistory.length - 1]);
        setEditHistory(prev => prev.slice(0, -1));
      }
    }

    setIsProcessing(false);
  };

  return (
    <Card className="border-2 border-purple-300 bg-gradient-to-br from-purple-50 to-pink-50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Wand2 className="w-5 h-5 text-purple-600" />
          Magic Edit
        </CardTitle>
        <p className="text-xs text-gray-600">Tell the AI how to refine your note</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Quick Commands */}
        <div className="flex flex-wrap gap-1.5">
          {quickCommands.map((cmd, idx) => (
            <Button
              key={idx}
              size="sm"
              variant="outline"
              onClick={() => handleMagicEdit(cmd.prompt)}
              disabled={isProcessing}
              className="text-xs h-7 px-2"
            >
              {cmd.label}
            </Button>
          ))}
        </div>

        {/* Custom Request */}
        <div className="space-y-2">
          <div className="relative">
            <Textarea
              placeholder='e.g., "Add more detail about patient education" or "Make the assessment more detailed"'
              value={editRequest}
              onChange={(e) => setEditRequest(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  handleMagicEdit();
                }
              }}
              disabled={isProcessing}
              className="min-h-[60px] text-sm pr-10"
            />
            <Button
              size="icon"
              variant="ghost"
              onClick={isListening ? stopVoiceInput : startVoiceInput}
              disabled={isProcessing}
              className="absolute bottom-2 right-2 h-7 w-7"
            >
              {isListening ? (
                <MicOff className="w-3.5 h-3.5 text-red-500" />
              ) : (
                <Mic className="w-3.5 h-3.5 text-gray-400" />
              )}
            </Button>
          </div>

          <Button
            onClick={() => handleMagicEdit()}
            disabled={isProcessing || !editRequest.trim()}
            className="w-full bg-purple-600 hover:bg-purple-700"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Applying Magic...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                Apply Magic Edit
              </>
            )}
          </Button>
        </div>

        {/* Edit History Indicator */}
        {editHistory.length > 0 && (
          <div className="flex items-center justify-between text-xs text-gray-600 pt-2 border-t">
            <span>{editHistory.length} edit{editHistory.length > 1 ? 's' : ''} made</span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => handleMagicEdit("__UNDO__")}
              disabled={isProcessing}
              className="h-6 px-2 text-xs"
            >
              <Undo2 className="w-3 h-3 mr-1" />
              Undo
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}