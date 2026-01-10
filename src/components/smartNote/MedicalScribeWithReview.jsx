import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Mic, Upload, CheckCircle2, AlertCircle, Loader, Edit3, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import EnhancedDocumentationAssistant from "./EnhancedDocumentationAssistant";
import PatientHistoryContext from "./PatientHistoryContext";
import SmartNoteGuidelinesPanel from "./SmartNoteGuidelinesPanel";

export default function MedicalScribeWithReview({
        diagnosis = "",
        visitType = "",
        patientId = "",
        selectedTemplate = null,
        onNoteGenerated = null
      }) {
        const { data: currentUser } = useQuery({
          queryKey: ["currentUser"],
          queryFn: async () => {
            try {
              return await base44.auth.me();
            } catch (error) {
              return null;
            }
          }
        });
  const [stage, setStage] = useState('input'); // input, transcribing, reviewing, generating, complete
  const [transcription, setTranscription] = useState("");
  const [editedTranscription, setEditedTranscription] = useState("");
  const [generatedNote, setGeneratedNote] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = React.useRef(null);
  const audioChunksRef = React.useRef([]);
  const timerRef = React.useRef(null);
  const [isRecording, setIsRecording] = useState(false);

  const { data: patientHistory } = useQuery({
    queryKey: ['patientHistory', patientId],
    queryFn: async () => {
      if (!patientId || patientId === 'anonymous') return null;
      const results = await base44.entities.Patient.filter({ id: patientId });
      return results[0] || null;
    },
    enabled: !!patientId && patientId !== 'anonymous'
  });

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (event) => {
        audioChunksRef.current.push(event.data);
      };

      mediaRecorderRef.current.start();
      setIsRecording(true);
      setRecordingTime(0);

      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

      toast.success('Recording started');
    } catch (error) {
      toast.error('Microphone access denied');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      setIsRecording(false);
      clearInterval(timerRef.current);

      mediaRecorderRef.current.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        await transcribeAudio(audioBlob);
      };
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await transcribeAudio(file);
  };

  const transcribeAudio = async (audioBlob) => {
    setStage('transcribing');
    setIsProcessing(true);

    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'audio.wav');

      const response = await base44.functions.invoke('transcribeAndExtractClinicalData', formData);
      const data = response.data || response;

      if (!data.success) {
        throw new Error(data.error || 'Transcription failed');
      }

      let transcribedText = data.transcript || data.transcription || '';

      // Pre-populate with template if selected
      if (selectedTemplate?.sections) {
        const templateSections = selectedTemplate.sections
          .map(s => `${s.section_name}:\n${s.template_text}`)
          .join('\n\n');
        transcribedText = templateSections + '\n\n' + transcribedText;
      }

      setTranscription(transcribedText);
      setEditedTranscription(transcribedText);
      setStage('reviewing');
      toast.success('Transcription complete - review and edit if needed');
    } catch (error) {
      toast.error(error.message || 'Failed to transcribe audio');
      setStage('input');
    }

    setIsProcessing(false);
  };

  const generateNote = async () => {
    if (!editedTranscription.trim()) {
      toast.error('Transcription cannot be empty');
      return;
    }

    setStage('generating');
    setIsProcessing(true);

    try {
      const response = await base44.functions.invoke('enhanceNoteOptimized', {
        roughNote: editedTranscription,
        patientId: patientId || null,
        visitType,
        diagnosis,
        vitalSigns: {},
        nurseType: 'RN'
      });

      const data = response.data || response;

          if (!data.success) {
            throw new Error(data.error || 'Note generation failed');
          }

          setGeneratedNote(data.enhanced_note);
          onNoteGenerated?.(data.enhanced_note);
          setStage('complete');

          // Auto-save note to patient history if patient is selected
          if (patientId && patientId !== 'anonymous') {
            try {
              const patientData = await base44.entities.Patient.filter({ id: patientId });
              if (patientData[0]) {
                const enhancedNotesHistory = patientData[0].enhanced_notes_history || [];
                const newEntry = {
                  date: new Date().toISOString(),
                  visit_type: visitType,
                  diagnosis: diagnosis,
                  enhanced_note: data.enhanced_note,
                  rough_note: editedTranscription,
                  quality_score: 85, // Default quality score
                  nurse_email: currentUser?.email,
                  vital_signs: {}
                };

                await base44.entities.Patient.update(patientId, {
                  enhanced_notes_history: [newEntry, ...enhancedNotesHistory]
                });
                toast.success('Note saved to patient history');
              }
            } catch (error) {
              console.error('Failed to save note to patient history:', error);
              toast.warning('Note generated but auto-save failed');
            }
          }

          toast.success('Clinical note generated successfully');
    } catch (error) {
      toast.error(error.message || 'Failed to generate note');
      setStage('reviewing');
    }

    setIsProcessing(false);
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleStartOver = () => {
    setStage('input');
    setTranscription('');
    setEditedTranscription('');
    setGeneratedNote('');
    setRecordingTime(0);
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  // Input stage - recording and file upload
  if (stage === 'input') {
    return (
      <Card className="w-full border-blue-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mic className="w-5 h-5 text-blue-600" />
            Record or Upload Audio
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isRecording && (
            <Alert className="bg-red-50 border-red-200">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
                <span className="text-sm font-semibold text-red-600">
                  Recording: {formatTime(recordingTime)}
                </span>
              </div>
            </Alert>
          )}

          <div className="flex gap-2">
            <Button
              onClick={isRecording ? stopRecording : startRecording}
              disabled={isProcessing}
              className={`flex-1 ${isRecording ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}
            >
              {isRecording ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                  Stop Recording
                </>
              ) : (
                <>
                  <Mic className="w-4 h-4 mr-2" />
                  Start Recording
                </>
              )}
            </Button>
          </div>

          <div className="relative">
            <input
              type="file"
              accept="audio/*"
              onChange={handleFileUpload}
              disabled={isRecording || isProcessing}
              className="hidden"
              id="audio-upload"
            />
            <label htmlFor="audio-upload">
              <Button
                asChild
                variant="outline"
                className="w-full cursor-pointer"
                disabled={isRecording || isProcessing}
              >
                <div className="flex items-center justify-center gap-2">
                  <Upload className="w-4 h-4" />
                  Upload Audio File
                </div>
              </Button>
            </label>
          </div>

          <div className="text-xs text-gray-600 bg-gray-50 p-3 rounded">
            <p className="font-medium mb-1">Tips:</p>
            <ul className="space-y-1">
              <li>• Speak clearly and at a normal pace</li>
              <li>• Include vital signs when mentioning them</li>
              <li>• Describe patient condition and responses</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Reviewing stage - show transcription for editing
  if (stage === 'reviewing' || stage === 'generating') {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="lg:col-span-1">
          <PatientHistoryContext
            patientId={patientId}
            onInsertSnippet={(snippet) => {
              setEditedTranscription(prev => prev + '\n\n' + snippet);
              toast.success('Snippet added to transcription');
            }}
          />
        </div>

        <div className="lg:col-span-3 space-y-4">
        <Card className="w-full border-purple-200 bg-purple-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Edit3 className="w-5 h-5 text-purple-600" />
              Review & Edit Transcription
            </CardTitle>
            <p className="text-xs text-gray-600 mt-2">
              Review the transcribed text and make corrections before generating the clinical note.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Transcribed Text</label>
              <Textarea
                value={editedTranscription}
                onChange={(e) => setEditedTranscription(e.target.value)}
                placeholder="Edit transcription here..."
                className="min-h-40 font-mono text-sm"
              />
              <p className="text-xs text-gray-500">
                {editedTranscription.length} characters
              </p>
            </div>

            <div className="flex gap-2">
              <Button
                onClick={generateNote}
                disabled={isProcessing || !editedTranscription.trim()}
                className="flex-1 bg-green-600 hover:bg-green-700"
              >
                {isProcessing ? (
                  <>
                    <Loader className="w-4 h-4 mr-2 animate-spin" />
                    Generating Note...
                  </>
                ) : (
                  <>
                    <ArrowRight className="w-4 h-4 mr-2" />
                    Generate Clinical Note
                  </>
                )}
              </Button>
              <Button
                onClick={handleStartOver}
                variant="outline"
                disabled={isProcessing}
              >
                Start Over
              </Button>
            </div>
          </CardContent>
        </Card>

        <EnhancedDocumentationAssistant
          generatedNote={generatedNote}
          diagnosis={diagnosis}
          visitType={visitType}
          patientId={patientId}
          patientHistory={patientHistory}
          isLoading={isProcessing}
        />
        </div>
        </div>
        );
        }

  // Complete stage - show generated note
  if (stage === 'complete') {
    return (
      <div className="space-y-4">
        <Card className="w-full border-green-200 bg-green-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-green-900">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
              Clinical Note Generated
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Generated Note</label>
              <Button
                size="sm"
                variant="outline"
                onClick={() => copyToClipboard(generatedNote)}
              >
                Copy
              </Button>
            </div>
            <div className="bg-white p-4 rounded border border-green-200 max-h-80 overflow-y-auto text-sm text-gray-700 whitespace-pre-wrap">
              {generatedNote}
            </div>
          </div>

          <Alert className="bg-blue-50 border-blue-200">
            <AlertCircle className="w-4 h-4 text-blue-600" />
            <AlertDescription className="text-sm text-blue-800">
              You can now copy this note or continue editing in the Smart Note Assistant for further refinement and compliance checking.
            </AlertDescription>
          </Alert>

          <Button
            onClick={handleStartOver}
            variant="outline"
            className="w-full"
          >
            Create Another Note
          </Button>
          </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
              <div className="lg:col-span-1 space-y-3">
                <PatientHistoryContext
                  patientId={patientId}
                  onInsertSnippet={(snippet) => {
                    setGeneratedNote(prev => prev + '\n\n' + snippet);
                    toast.success('Snippet added to note');
                  }}
                />
                <SmartNoteGuidelinesPanel
                  visitType={visitType}
                  diagnosis={diagnosis}
                  noteContent={generatedNote}
                />
              </div>
              <div className="lg:col-span-4">
                <EnhancedDocumentationAssistant
                  generatedNote={generatedNote}
                  diagnosis={diagnosis}
                  visitType={visitType}
                  patientId={patientId}
                  patientHistory={patientHistory}
                  isLoading={false}
                />
              </div>
            </div>
          </div>
          );
          }

          return null;
}