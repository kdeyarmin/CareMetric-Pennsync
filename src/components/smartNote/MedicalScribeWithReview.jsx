import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Mic, Upload, CheckCircle2, AlertCircle, Loader, Edit3, ArrowRight, Sparkles, Lightbulb } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import EnhancedDocumentationAssistant from "./EnhancedDocumentationAssistant";
import PatientHistoryContext from "./PatientHistoryContext";
import SmartNoteGuidelinesPanel from "./SmartNoteGuidelinesPanel";
import ComplianceIssueDetector from "../scribe/ComplianceIssueDetector";
import VisitSummarizer from "../scribe/VisitSummarizer";
import DictationAccuracyFeedback from "../scribe/DictationAccuracyFeedback";
import InvoiceGenerator from "../billing/InvoiceGenerator";
import { ResolveAllIssues } from "./OneClickResolvers";
import NoteEmailDialog from "../notes/NoteEmailDialog";
import NoteFormatSelector from "../notes/NoteFormatSelector";
import { getFormatPrompt } from "../notes/NoteFormatTemplates";
import SpecialtyTemplateSelector from "../specialty/SpecialtyTemplateSelector";
import { getSpecialtyTemplate } from "../specialty/SpecialtyTemplateLibrary";
import AIMedicalCodingAssistant from "../coding/AIMedicalCodingAssistant";

export default function MedicalScribeWithReview({
        diagnosis = "",
        visitType = "",
        patientId = "",
        selectedTemplate = null,
        selectedLanguage = "en",
        patientContext = null,
        recentVisits = [],
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
  const [rawTranscription, setRawTranscription] = useState("");
  const [showInvoiceGenerator, setShowInvoiceGenerator] = useState(false);
  const [complianceIssues, setComplianceIssues] = useState([]);
  const [documentationGaps, setDocumentationGaps] = useState([]);
  const [realTimeSuggestions, setRealTimeSuggestions] = useState([]);
  const [generatingSuggestions, setGeneratingSuggestions] = useState(false);
  const [selectedFormat, setSelectedFormat] = useState("soap");
  const [selectedSpecialty, setSelectedSpecialty] = useState("");
  const [selectedSpecialtyTemplate, setSelectedSpecialtyTemplate] = useState("");
  const [differentialDiagnoses, setDifferentialDiagnoses] = useState([]);
  const [suggestedCodes, setSuggestedCodes] = useState({ icd10: [], cpt: [] });

  const { data: patientData } = useQuery({
    queryKey: ['patient', patientId],
    queryFn: async () => {
      if (!patientId || patientId === 'anonymous') return null;
      const results = await base44.entities.Patient.filter({ id: patientId });
      return results[0] || null;
    },
    enabled: !!patientId && patientId !== 'anonymous'
  });

  const { data: patientHistory } = useQuery({
    queryKey: ['patientHistory', patientId],
    queryFn: async () => {
      if (!patientId || patientId === 'anonymous') return null;
      const results = await base44.entities.Patient.filter({ id: patientId });
      return results[0] || null;
    },
    enabled: !!patientId && patientId !== 'anonymous'
  });

  const { data: customTerminology = [] } = useQuery({
    queryKey: ['terminologyGlossary', currentUser?.email, selectedLanguage],
    queryFn: () => base44.entities.TerminologyGlossary.filter({
      user_email: currentUser?.email,
      language: selectedLanguage,
      is_active: true
    }),
    enabled: !!currentUser?.email
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
      formData.append('language', selectedLanguage);
      if (customTerminology.length > 0) {
        formData.append('customTerminology', JSON.stringify(customTerminology));
      }

      const response = await base44.functions.invoke('transcribeAndExtractClinicalData', formData);
      const data = response.data || response;

      if (!data.success) {
        throw new Error(data.error || 'Transcription failed');
      }

      let transcribedText = data.transcript || data.transcription || '';
      
      // Store raw transcription for accuracy feedback
      setRawTranscription(transcribedText);

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
      // Build enhanced context from patient data
      const contextData = {
        patient_demographics: patientContext ? {
          age: patientContext.date_of_birth 
            ? Math.floor((Date.now() - new Date(patientContext.date_of_birth)) / 31557600000) 
            : null,
          primary_diagnosis: patientContext.primary_diagnosis,
          allergies: patientContext.allergies,
          current_medications: patientContext.current_medications?.map(m => `${m.name} ${m.dosage}`).join(', ')
        } : null,
        recent_visits: recentVisits?.map(v => ({
          date: v.visit_date,
          type: v.visit_type,
          summary: v.nurse_notes?.substring(0, 200)
        }))
      };

      const formatPrompt = getFormatPrompt(
        selectedFormat, 
        currentUser?.credential_type || currentUser?.provider_type
      );

      // Get specialty template context if selected
      const specialtyTemplate = selectedSpecialty && selectedSpecialtyTemplate 
        ? getSpecialtyTemplate(selectedSpecialty, selectedSpecialtyTemplate)
        : null;

      const specialtyContext = specialtyTemplate ? {
        specialty: selectedSpecialty,
        templateName: selectedSpecialtyTemplate,
        aiPrompt: specialtyTemplate.aiPrompt,
        sections: specialtyTemplate.sections,
        commonCodes: specialtyTemplate.commonCodes
      } : null;

      const response = await base44.functions.invoke('enhanceNoteOptimized', {
        roughNote: editedTranscription,
        patientId: patientId || null,
        visitType,
        diagnosis,
        vitalSigns: {},
        nurseType: currentUser?.provider_type || currentUser?.credential_type || 'RN',
        contextData,
        noteFormat: selectedFormat,
        formatInstructions: formatPrompt,
        specialtyContext
      });

      const data = response.data || response;

          if (!data.success) {
            throw new Error(data.error || 'Note generation failed');
          }

          setGeneratedNote(data.enhanced_note);
          setDifferentialDiagnoses(data.differential_diagnoses || []);
          setSuggestedCodes(data.suggested_codes || { icd10: [], cpt: [] });
          onNoteGenerated?.(data.enhanced_note, {
            differentialDiagnoses: data.differential_diagnoses,
            suggestedCodes: data.suggested_codes,
            specialtyApplied: data.specialty_applied
          });
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
    setDifferentialDiagnoses([]);
    setSuggestedCodes({ icd10: [], cpt: [] });
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  // Real-time contextual suggestions
  const generateContextualSuggestions = async () => {
    if (!editedTranscription.trim() || generatingSuggestions) return;

    setGeneratingSuggestions(true);
    try {
      const contextPrompt = `Based on this clinical transcription, provide 3-5 brief contextual suggestions to improve documentation quality:

Transcription: ${editedTranscription}

Visit Type: ${visitType}
Diagnosis: ${diagnosis}
${patientContext ? `Patient has: ${patientContext.primary_diagnosis}, Allergies: ${patientContext.allergies || 'None'}` : ''}

Provide specific, actionable suggestions for:
1. Missing clinical details
2. Required documentation elements
3. Compliance improvements
4. Medical necessity justification`;

      const response = await base44.integrations.Core.InvokeLLM({
        prompt: contextPrompt,
        response_json_schema: {
          type: "object",
          properties: {
            suggestions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  category: { type: "string" },
                  suggestion: { type: "string" },
                  priority: { type: "string", enum: ["high", "medium", "low"] }
                }
              }
            }
          }
        }
      });

      setRealTimeSuggestions(response.suggestions || []);
    } catch (error) {
      console.error('Failed to generate suggestions:', error);
    } finally {
      setGeneratingSuggestions(false);
    }
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

        <div className="lg:col-span-3">
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
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <NoteFormatSelector
                selectedFormat={selectedFormat}
                onFormatChange={setSelectedFormat}
                specialty={currentUser?.credential_type || currentUser?.provider_type}
                showDescription={false}
                compact={true}
              />
              <SpecialtyTemplateSelector
                selectedSpecialty={selectedSpecialty}
                onSpecialtyChange={setSelectedSpecialty}
                selectedTemplate={selectedSpecialtyTemplate}
                onTemplateSelect={setSelectedSpecialtyTemplate}
                compact={true}
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Transcribed Text</label>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={generateContextualSuggestions}
                  disabled={generatingSuggestions || !editedTranscription.trim()}
                >
                  {generatingSuggestions ? (
                    <>
                      <Loader className="w-3 h-3 mr-1 animate-spin" />
                      Analyzing...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3 h-3 mr-1" />
                      Get AI Suggestions
                    </>
                  )}
                </Button>
              </div>
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

            {/* Real-time contextual suggestions */}
            {realTimeSuggestions.length > 0 && (
              <Alert className="bg-blue-50 dark:bg-blue-950 border-blue-200">
                <Lightbulb className="w-4 h-4 text-blue-600" />
                <AlertDescription>
                  <p className="font-semibold text-sm mb-2">AI Suggestions:</p>
                  <div className="space-y-2">
                    {realTimeSuggestions.map((item, idx) => (
                      <div key={idx} className="text-xs">
                        <span className={`font-semibold ${
                          item.priority === 'high' ? 'text-red-600' : 
                          item.priority === 'medium' ? 'text-orange-600' : 'text-blue-600'
                        }`}>
                          [{item.category}]
                        </span> {item.suggestion}
                      </div>
                    ))}
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {/* One-Click Resolve All for Transcription Stage */}
            <ResolveAllIssues
              issues={complianceIssues}
              gaps={documentationGaps}
              suggestions={[]}
              noteContent={editedTranscription}
              visitType={visitType}
              diagnosis={diagnosis}
              onResolved={(correctedNote) => {
                setEditedTranscription(correctedNote);
              }}
            />

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

          <div className="space-y-4 mt-4">
            <SmartNoteGuidelinesPanel
              visitType={visitType}
              diagnosis={diagnosis}
              noteContent={editedTranscription}
            />

            <EnhancedDocumentationAssistant
              generatedNote={generatedNote}
              diagnosis={diagnosis}
              visitType={visitType}
              patientId={patientId}
              patientHistory={patientHistory}
              isLoading={isProcessing}
              roughNote={editedTranscription}
              providerType={currentUser?.provider_type || currentUser?.credential_type || 'RN'}
            />
            
            {/* Real-time feedback components */}
            <DictationAccuracyFeedback 
              rawTranscription={rawTranscription}
              refinedNote={editedTranscription}
              selectedLanguage={selectedLanguage}
            />
            
            <ComplianceIssueDetector
              noteContent={editedTranscription}
              diagnosis={diagnosis}
              visitType={visitType}
              onIssuesDetected={(issues) => setComplianceIssues(issues)}
              onIssueResolved={(correctedNote) => {
                setEditedTranscription(correctedNote);
              }}
            />
          </div>
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
              <div className="flex items-center justify-between flex-wrap gap-2">
              <label className="text-sm font-medium">Generated Note</label>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => copyToClipboard(generatedNote)}
                >
                  Copy
                </Button>
                <NoteEmailDialog
                  noteContent={generatedNote}
                  patientData={patientData}
                  visitType={visitType}
                  currentUser={currentUser}
                />
              </div>
            </div>
            <div className="bg-white p-4 rounded border border-green-200 max-h-80 overflow-y-auto text-sm text-gray-700 whitespace-pre-wrap">
              {generatedNote}
            </div>
            </div>

          {/* Differential Diagnoses */}
          {differentialDiagnoses.length > 0 && (
            <div className="border rounded-lg p-4 bg-purple-50 dark:bg-purple-950">
              <p className="font-semibold mb-3 text-purple-900 dark:text-purple-100">
                Differential Diagnoses to Consider:
              </p>
              <div className="space-y-2">
                {differentialDiagnoses.map((dx, idx) => (
                  <div key={idx} className="bg-white dark:bg-gray-900 p-3 rounded border">
                    <div className="flex items-start justify-between mb-1">
                      <p className="font-medium text-sm">{dx.diagnosis}</p>
                      <Badge className={
                        dx.probability === 'high' ? 'bg-red-100 text-red-800' :
                        dx.probability === 'moderate' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-blue-100 text-blue-800'
                      }>
                        {dx.probability}
                      </Badge>
                    </div>
                    <p className="text-xs text-gray-600">{dx.reasoning}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Suggested Billing Codes */}
          {(suggestedCodes.icd10?.length > 0 || suggestedCodes.cpt?.length > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {suggestedCodes.icd10?.length > 0 && (
                <div className="border rounded-lg p-4 bg-green-50 dark:bg-green-950">
                  <p className="font-semibold mb-2 text-green-900 dark:text-green-100">
                    Suggested ICD-10 Codes:
                  </p>
                  <div className="space-y-2">
                    {suggestedCodes.icd10.map((code, idx) => (
                      <div key={idx} className="bg-white dark:bg-gray-900 p-2 rounded text-xs">
                        <div className="flex items-center justify-between mb-1">
                          <Badge className="bg-green-600">{code.code}</Badge>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              navigator.clipboard.writeText(code.code);
                              toast.success('Code copied');
                            }}
                            className="h-5 text-xs"
                          >
                            Copy
                          </Button>
                        </div>
                        <p className="text-gray-700 dark:text-gray-300">{code.description}</p>
                        <p className="text-gray-500 mt-1">{code.relevance}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {suggestedCodes.cpt?.length > 0 && (
                <div className="border rounded-lg p-4 bg-blue-50 dark:bg-blue-950">
                  <p className="font-semibold mb-2 text-blue-900 dark:text-blue-100">
                    Suggested CPT Codes:
                  </p>
                  <div className="space-y-2">
                    {suggestedCodes.cpt.map((code, idx) => (
                      <div key={idx} className="bg-white dark:bg-gray-900 p-2 rounded text-xs">
                        <div className="flex items-center justify-between mb-1">
                          <Badge className="bg-blue-600">{code.code}</Badge>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              navigator.clipboard.writeText(code.code);
                              toast.success('Code copied');
                            }}
                            className="h-5 text-xs"
                          >
                            Copy
                          </Button>
                        </div>
                        <p className="text-gray-700 dark:text-gray-300">{code.description}</p>
                        <p className="text-gray-500 mt-1">{code.documentation_basis}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <Alert className="bg-blue-50 border-blue-200">
            <AlertCircle className="w-4 h-4 text-blue-600" />
            <AlertDescription className="text-sm text-blue-800">
              You can now copy this note or continue editing in the Smart Note Assistant for further refinement and compliance checking.
            </AlertDescription>
          </Alert>

          <div className="flex gap-2">
            <Button
              onClick={() => setShowInvoiceGenerator(true)}
              className="flex-1 bg-green-600 hover:bg-green-700"
            >
              Generate Invoice
            </Button>
            <Button
              onClick={handleStartOver}
              variant="outline"
              className="flex-1"
            >
              Create Another Note
            </Button>
          </div>
          </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
             <div className="lg:col-span-1 space-y-3">
               {showInvoiceGenerator ? (
                 <InvoiceGenerator
                     patientId={patientId}
                     visitType={visitType}
                     diagnosis={diagnosis}
                     clinicalNote={generatedNote}
                     onInvoiceCreated={() => {
                       setShowInvoiceGenerator(false);
                       toast.success('Invoice created successfully');
                     }}
                   />
               ) : (
                 <>
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
                 </>
               )}
             </div>
             <div className="lg:col-span-4 space-y-4">
               {/* One-Click Resolve All for Final Note */}
               <ResolveAllIssues
                 issues={complianceIssues}
                 gaps={documentationGaps}
                 suggestions={[]}
                 noteContent={generatedNote}
                 visitType={visitType}
                 diagnosis={diagnosis}
                 onResolved={(correctedNote) => {
                   setGeneratedNote(correctedNote);
                 }}
               />

               <VisitSummarizer
                 noteContent={generatedNote}
                 diagnosis={diagnosis}
                 visitType={visitType}
                 patientName={patientId ? "patient" : ""}
               />

               <ComplianceIssueDetector
                 noteContent={generatedNote}
                 diagnosis={diagnosis}
                 visitType={visitType}
                 onIssuesDetected={(issues) => setComplianceIssues(issues)}
                 onIssueResolved={(correctedNote) => {
                   setGeneratedNote(correctedNote);
                 }}
               />
                
                <DictationAccuracyFeedback 
                  rawTranscription={rawTranscription}
                  refinedNote={editedTranscription}
                  selectedLanguage={selectedLanguage}
                />
                
                <EnhancedDocumentationAssistant
                  generatedNote={generatedNote}
                  diagnosis={diagnosis}
                  visitType={visitType}
                  patientId={patientId}
                  patientHistory={patientHistory}
                  isLoading={false}
                  roughNote={editedTranscription}
                  providerType={currentUser?.provider_type || currentUser?.credential_type || 'RN'}
                  />

                  <AIMedicalCodingAssistant
                  clinicalNote={generatedNote}
                  patientData={patientData}
                  visitType={visitType}
                  onCodesSelected={(codes) => {
                    toast.success(`${codes.length} codes selected and ready to use`);
                  }}
                  />
                  </div>
                  </div>
                  </div>
                  );
                  }

          return null;
}