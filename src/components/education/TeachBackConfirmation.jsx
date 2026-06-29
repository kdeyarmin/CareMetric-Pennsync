import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  CheckCircle2,
  HelpCircle,
  MessageSquare,
  ThumbsUp,
  ThumbsDown,
  AlertTriangle,
  Copy,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import { toast } from 'sonner';

// Single source of truth for the overall teach-back level. The saved record and
// the generated documentation note previously used DIFFERENT thresholds, so the
// same encounter could be recorded "fair"/"poor" while the note read "adequate
// understanding" — contradictory clinical documentation.
export function computeOverallLevel(levels) {
  const good = levels.filter(l => l === 'good').length;
  const fair = levels.filter(l => l === 'fair').length;
  if (good > levels.length / 2) return 'good';
  if (good + fair > levels.length / 2) return 'fair';
  return 'poor';
}

export default function TeachBackConfirmation({ material, patient, onRecorded }) {
  const [currentQuestionIdx, setCurrentQuestionIdx] = useState(0);
  const [responses, setResponses] = useState([]);
  const [currentResponse, setCurrentResponse] = useState("");
  const [understandingLevel, setUnderstandingLevel] = useState("");
  const [isComplete, setIsComplete] = useState(false);
  const [overallLevel, setOverallLevel] = useState('');
  const [showQuestions, setShowQuestions] = useState(true);
  const [copied, setCopied] = useState(false);

  if (!material || !material.teach_back_questions?.length) {
    return (
      <Card className="border-slate-200">
        <CardContent className="p-6 text-center text-slate-500">
          <HelpCircle className="w-12 h-12 mx-auto mb-3 text-slate-300" />
          <p>Generate educational material to see teach-back questions.</p>
        </CardContent>
      </Card>
    );
  }

  const questions = material.teach_back_questions;
  const currentQuestion = questions[currentQuestionIdx];

  const handleRecordResponse = () => {
    if (!currentResponse.trim() || !understandingLevel) {
      toast.error("Please enter a response and select understanding level.");
      return;
    }

    const newResponse = {
      question: currentQuestion.question,
      expectedAnswer: currentQuestion.expected_answer,
      patientResponse: currentResponse,
      understandingLevel: understandingLevel,
      timestamp: new Date().toISOString()
    };

    const updatedResponses = [...responses, newResponse];
    setResponses(updatedResponses);
    setCurrentResponse("");
    setUnderstandingLevel("");

    if (currentQuestionIdx < questions.length - 1) {
      setCurrentQuestionIdx(currentQuestionIdx + 1);
    } else {
      setIsComplete(true);
      
      // Calculate overall understanding (shared with the documentation note).
      const levels = updatedResponses.map(r => r.understandingLevel);
      const overallLevel = computeOverallLevel(levels);
      setOverallLevel(overallLevel);

      if (onRecorded) {
        onRecorded({
          topic: material.title,
          patientId: patient?.id,
          patientName: patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown Patient',
          responses: updatedResponses,
          understandingLevel: overallLevel,
          response: updatedResponses.map(r => `Q: ${r.question}\nA: ${r.patientResponse} (${r.understandingLevel})`).join('\n\n'),
          timestamp: new Date().toISOString()
        });
      }
    }
  };

  const generateDocumentation = () => {
    const doc = `PATIENT EDUCATION DOCUMENTATION
Topic: ${material.title}
Date: ${new Date().toLocaleString()}
${patient ? `Patient: ${patient.first_name} ${patient.last_name}` : ''}

TEACH-BACK VERIFICATION:
${responses.map((r, idx) => `
${idx + 1}. Question: "${r.question}"
   Patient Response: "${r.patientResponse}"
   Understanding Level: ${r.understandingLevel.toUpperCase()}
`).join('')}

OVERALL ASSESSMENT:
Patient ${
  overallLevel === 'good'
    ? 'demonstrated adequate understanding of material via teach-back method.'
    : overallLevel === 'fair'
      ? 'demonstrated partial understanding; key points were reinforced and follow-up teaching planned.'
      : 'requires additional education. Follow-up teaching planned.'}

Nurse Signature: _______________________`;

    return doc;
  };

  const handleCopyDocumentation = () => {
    navigator.clipboard.writeText(generateDocumentation());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getUnderstandingColor = (level) => {
    const colors = {
      good: "bg-green-100 text-green-800 border-green-300",
      fair: "bg-yellow-100 text-yellow-800 border-yellow-300",
      poor: "bg-red-100 text-red-800 border-red-300"
    };
    return colors[level] || "bg-slate-100 text-slate-800";
  };

  return (
    <Card className="border-green-200">
      <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <CheckCircle2 className="w-5 h-5 text-green-600" />
            Teach-Back Verification
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowQuestions(!showQuestions)}
          >
            {showQuestions ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>
        </div>
      </CardHeader>
      
      {showQuestions && (
        <CardContent className="p-4">
          {!isComplete ? (
            <div className="space-y-4">
              {/* Progress */}
              <div className="flex items-center justify-between text-sm text-slate-600">
                <span>Question {currentQuestionIdx + 1} of {questions.length}</span>
                <div className="flex gap-1">
                  {questions.map((_, idx) => (
                    <div
                      key={idx}
                      className={`w-2 h-2 rounded-full ${
                        idx < currentQuestionIdx ? 'bg-green-500' :
                        idx === currentQuestionIdx ? 'bg-blue-500' : 'bg-slate-300'
                      }`}
                    />
                  ))}
                </div>
              </div>

              {/* Current Question */}
              <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                <div className="flex items-start gap-2">
                  <MessageSquare className="w-5 h-5 text-blue-600 mt-0.5" />
                  <div>
                    <p className="font-medium text-blue-900">Ask the patient:</p>
                    <p className="text-blue-800 mt-1">"{currentQuestion.question}"</p>
                  </div>
                </div>
              </div>

              {/* Expected Answer Hint */}
              <Alert className="bg-slate-50 border-slate-200">
                <HelpCircle className="w-4 h-4 text-slate-600" />
                <AlertDescription className="text-xs text-slate-600">
                  <strong>Expected answer should include:</strong> {currentQuestion.expected_answer}
                </AlertDescription>
              </Alert>

              {/* Patient Response */}
              <div>
                <Label>Patient's Response</Label>
                <Textarea
                  value={currentResponse}
                  onChange={(e) => setCurrentResponse(e.target.value)}
                  placeholder="Document what the patient said..."
                  rows={3}
                />
              </div>

              {/* Understanding Level */}
              <div>
                <Label className="mb-2 block">Understanding Level</Label>
                <RadioGroup
                  value={understandingLevel}
                  onValueChange={setUnderstandingLevel}
                  className="flex gap-4"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="good" id="good" />
                    <Label htmlFor="good" className="flex items-center gap-1 cursor-pointer">
                      <ThumbsUp className="w-4 h-4 text-green-600" />
                      Good
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="fair" id="fair" />
                    <Label htmlFor="fair" className="flex items-center gap-1 cursor-pointer">
                      <AlertTriangle className="w-4 h-4 text-yellow-600" />
                      Fair
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="poor" id="poor" />
                    <Label htmlFor="poor" className="flex items-center gap-1 cursor-pointer">
                      <ThumbsDown className="w-4 h-4 text-red-600" />
                      Poor
                    </Label>
                  </div>
                </RadioGroup>
              </div>

              <Button
                onClick={handleRecordResponse}
                className="w-full bg-green-600 hover:bg-green-700"
                disabled={!currentResponse.trim() || !understandingLevel}
              >
                {currentQuestionIdx < questions.length - 1 ? 'Record & Next Question' : 'Complete Teach-Back'}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <Alert className="bg-green-50 border-green-200">
                <CheckCircle2 className="w-5 h-5 text-green-600" />
                <AlertDescription className="text-green-900">
                  <strong>Teach-back completed!</strong> {responses.length} questions verified.
                </AlertDescription>
              </Alert>

              {/* Summary */}
              <div className="space-y-2">
                {responses.map((r, idx) => (
                  <div key={idx} className="p-3 bg-slate-50 rounded border">
                    <p className="text-sm font-medium">{r.question}</p>
                    <p className="text-sm text-slate-600 mt-1">Response: "{r.patientResponse}"</p>
                    <Badge className={`mt-2 ${getUnderstandingColor(r.understandingLevel)}`}>
                      {r.understandingLevel}
                    </Badge>
                  </div>
                ))}
              </div>

              {/* Copy Documentation */}
              <Button
                onClick={handleCopyDocumentation}
                variant="outline"
                className="w-full gap-2"
              >
                {copied ? (
                  <><CheckCircle2 className="w-4 h-4 text-green-600" /> Copied!</>
                ) : (
                  <><Copy className="w-4 h-4" /> Copy Documentation</>
                )}
              </Button>

              {/* Reset */}
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => {
                  setCurrentQuestionIdx(0);
                  setResponses([]);
                  setIsComplete(false);
                }}
              >
                Start New Teach-Back
              </Button>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}