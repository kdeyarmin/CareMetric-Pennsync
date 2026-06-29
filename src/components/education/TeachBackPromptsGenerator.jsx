import { useState } from "react";
import { useAICall } from "@/hooks/useAICall";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MessageSquare,
  Loader2,
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
  Lightbulb,
  RefreshCw,
  ThumbsUp,
  ThumbsDown,
  AlertTriangle,
  Brain,
  Copy,
  Target
} from "lucide-react";
import { toast } from 'sonner';

export default function TeachBackPromptsGenerator({ 
  patient, 
  educationMaterial, 
  diagnosis,
  onTeachBackComplete 
}) {
  const [condition, setCondition] = useState(diagnosis || "");
  const [educationTopic, setEducationTopic] = useState("");
  const [patientLiteracy, setPatientLiteracy] = useState("average");
  const generatingAi = useAICall();
  const [prompts, setPrompts] = useState(null);
  const [currentPromptIdx, setCurrentPromptIdx] = useState(0);
  const [responses, setResponses] = useState([]);
  const [currentResponse, setCurrentResponse] = useState("");
  const [currentLevel, setCurrentLevel] = useState("");
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [followUpPrompt, setFollowUpPrompt] = useState(null);
  const generatingFollowUpAi = useAICall();
  const [isComplete, setIsComplete] = useState(false);
  const [copied, setCopied] = useState(false);

  const literacyLevels = [
    { value: "low", label: "Low Health Literacy", description: "Use very simple questions" },
    { value: "average", label: "Average", description: "Standard teach-back questions" },
    { value: "high", label: "High Health Literacy", description: "Can handle more detailed questions" }
  ];

  const generatePrompts = async () => {
    const topic = educationTopic || educationMaterial?.title || condition;
    if (!topic) {
      toast.error("Please enter a condition or education topic.");
      return;
    }

    setResponses([]);
    setCurrentPromptIdx(0);
    setIsComplete(false);

    try {
      const result = await generatingAi.run({
        model: "claude_sonnet_4_6",
        prompt: `You are an expert in patient education and the teach-back method. Generate tailored teach-back prompts for a nurse to use during a patient education session.

CONDITION/TOPIC: ${topic}
PATIENT HEALTH LITERACY: ${patientLiteracy}
${patient ? `PATIENT: ${patient.first_name} ${patient.last_name}` : ''}

${educationMaterial ? `
EDUCATION MATERIAL COVERED:
- Title: ${educationMaterial.title}
- Key Points: ${educationMaterial.key_points?.map(kp => kp.point).join(', ')}
- Warning Signs: ${educationMaterial.warning_signs?.map(ws => ws.sign).join(', ')}
- Self-Care Tips: ${educationMaterial.self_care_tips?.map(tip => tip.tip).join(', ')}
` : ''}

Create teach-back prompts that:
1. Are open-ended (not yes/no questions)
2. Use "teach me back" or "show me" language
3. Are tailored to the patient's health literacy level
4. Cover the most critical concepts for safety
5. Include alternative phrasings for if patient doesn't understand
6. Provide specific criteria for evaluating the response

Return JSON:
{
  "topic": "The education topic",
  "prompts": [
    {
      "prompt_id": 1,
      "category": "Understanding Condition" | "Medication" | "Warning Signs" | "Self-Care" | "When to Seek Help",
      "primary_question": "The main teach-back question",
      "alternative_phrasings": [
        "Alternative way to ask if patient doesn't understand the first phrasing"
      ],
      "what_to_listen_for": [
        "Key concept the patient should mention"
      ],
      "red_flags": [
        "Concerning response that indicates misunderstanding"
      ],
      "good_response_example": "Example of what a good response sounds like",
      "if_struggling": {
        "clarification_prompt": "How to help if patient struggles",
        "teaching_tip": "Quick teaching point to reinforce"
      },
      "importance": "Why this concept is critical for the patient to understand",
      "difficulty": "easy" | "medium" | "hard"
    }
  ],
  "general_teaching_tips": [
    "Tip for effective teach-back"
  ],
  "documentation_template": "Template for documenting the teach-back session"
}`,
        response_json_schema: {
          type: "object",
          properties: {
            topic: { type: "string" },
            prompts: { type: "array", items: { type: "object" } },
            general_teaching_tips: { type: "array", items: { type: "string" } },
            documentation_template: { type: "string" }
          }
        }
      });

      setPrompts(result);
    } catch (error) {
      console.error("Error generating prompts:", error);
      toast.error("Error generating prompts. Please try again.");
    }
  };

  const generateFollowUpPrompt = async (response, level) => {
    try {
      const currentPrompt = prompts.prompts[currentPromptIdx];
      
      const result = await generatingFollowUpAi.run({
        model: "claude_sonnet_4_6",
        prompt: `Based on the patient's teach-back response, generate a tailored follow-up prompt.

ORIGINAL QUESTION: "${currentPrompt.primary_question}"
PATIENT'S RESPONSE: "${response}"
UNDERSTANDING LEVEL: ${level}
WHAT THEY SHOULD HAVE MENTIONED: ${currentPrompt.what_to_listen_for?.join(', ')}

${level === 'poor' || level === 'fair' ? `
The patient is struggling. Generate:
1. A simplified follow-up question
2. A brief teaching point to clarify
3. A concrete example or analogy
` : `
The patient did well. Generate:
1. A reinforcing follow-up to deepen understanding
2. A practical application question
`}

Return JSON:
{
  "follow_up_question": "The follow-up question to ask",
  "teaching_point": "A brief clarification or reinforcement",
  "example_or_analogy": "A concrete example to help understanding",
  "encouragement": "Positive reinforcement message"
}`,
        response_json_schema: {
          type: "object",
          properties: {
            follow_up_question: { type: "string" },
            teaching_point: { type: "string" },
            example_or_analogy: { type: "string" },
            encouragement: { type: "string" }
          }
        }
      });

      setFollowUpPrompt(result);
      setShowFollowUp(true);
    } catch (error) {
      console.error("Error generating follow-up:", error);
    }
  };

  const handleRecordResponse = () => {
    if (!currentResponse.trim() || !currentLevel) {
      toast.error("Please enter the patient's response and select understanding level.");
      return;
    }

    const newResponse = {
      promptId: prompts.prompts[currentPromptIdx].prompt_id,
      category: prompts.prompts[currentPromptIdx].category,
      question: prompts.prompts[currentPromptIdx].primary_question,
      patientResponse: currentResponse,
      understandingLevel: currentLevel,
      followUpUsed: showFollowUp,
      timestamp: new Date().toISOString()
    };

    const updatedResponses = [...responses, newResponse];
    setResponses(updatedResponses);

    // Move to next or complete
    if (currentPromptIdx < prompts.prompts.length - 1) {
      setCurrentPromptIdx(currentPromptIdx + 1);
      setCurrentResponse("");
      setCurrentLevel("");
      setShowFollowUp(false);
      setFollowUpPrompt(null);
    } else {
      setIsComplete(true);
      
      // Calculate overall score
      const goodCount = updatedResponses.filter(r => r.understandingLevel === 'good').length;
      const overallLevel = goodCount >= updatedResponses.length * 0.7 ? 'good' : 
                          goodCount >= updatedResponses.length * 0.5 ? 'fair' : 'poor';

      if (onTeachBackComplete) {
        onTeachBackComplete({
          topic: prompts.topic,
          responses: updatedResponses,
          overallLevel,
          timestamp: new Date().toISOString()
        });
      }
    }
  };

  const generateDocumentation = () => {
    if (!prompts || !responses.length) return '';
    
    const goodCount = responses.filter(r => r.understandingLevel === 'good').length;
    const fairCount = responses.filter(r => r.understandingLevel === 'fair').length;
    
    return `TEACH-BACK DOCUMENTATION
Topic: ${prompts.topic}
Date: ${new Date().toLocaleString()}
${patient ? `Patient: ${patient.first_name} ${patient.last_name}` : ''}

TEACH-BACK VERIFICATION RESULTS:
${responses.map((r, idx) => `
${idx + 1}. Category: ${r.category}
   Question: "${r.question}"
   Patient Response: "${r.patientResponse}"
   Understanding: ${r.understandingLevel.toUpperCase()}
   ${r.followUpUsed ? '(Follow-up clarification provided)' : ''}
`).join('')}

SUMMARY:
- Total Questions: ${responses.length}
- Good Understanding: ${goodCount} (${Math.round(goodCount/responses.length*100)}%)
- Fair Understanding: ${fairCount} (${Math.round(fairCount/responses.length*100)}%)
- Needs Reinforcement: ${responses.length - goodCount - fairCount}

ASSESSMENT: Patient ${goodCount >= responses.length * 0.7 ? 
  'demonstrated adequate understanding of ' + prompts.topic + ' via teach-back method.' : 
  'requires additional education on ' + prompts.topic + '. Follow-up teaching planned.'}

Nurse Signature: _______________________`;
  };

  const handleCopyDocumentation = () => {
    navigator.clipboard.writeText(generateDocumentation());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getDifficultyColor = (difficulty) => {
    switch (difficulty) {
      case 'easy': return 'bg-green-100 text-green-800';
      case 'medium': return 'bg-yellow-100 text-yellow-800';
      case 'hard': return 'bg-red-100 text-red-800';
      default: return 'bg-slate-100 text-slate-800';
    }
  };

  const currentPrompt = prompts?.prompts?.[currentPromptIdx];

  return (
    <Card className="border-indigo-200">
      <CardHeader className="bg-gradient-to-r from-indigo-50 to-navy-50">
        <CardTitle className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-indigo-600" />
          AI Teach-Back Prompts Generator
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        {!prompts ? (
          <div className="space-y-4">
            <div className="bg-indigo-50 p-3 rounded-lg border border-indigo-200 text-sm text-indigo-800">
              <Target className="w-4 h-4 inline mr-1" />
              Generate tailored teach-back questions based on the condition and patient's literacy level to ensure comprehension.
            </div>

            <div>
              <Label>Condition/Topic</Label>
              <Input
                value={condition}
                onChange={(e) => setCondition(e.target.value)}
                placeholder="e.g., CHF, Diabetes, COPD, Wound Care"
              />
            </div>

            <div>
              <Label>Specific Education Topic (optional)</Label>
              <Input
                value={educationTopic}
                onChange={(e) => setEducationTopic(e.target.value)}
                placeholder="e.g., Daily weight monitoring, Insulin injection technique"
              />
            </div>

            <div>
              <Label>Patient Health Literacy Level</Label>
              <Select value={patientLiteracy} onValueChange={setPatientLiteracy}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {literacyLevels.map((level) => (
                    <SelectItem key={level.value} value={level.value}>
                      {level.label} - {level.description}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              onClick={generatePrompts}
              disabled={generatingAi.loading || !condition.trim()}
              className="w-full bg-indigo-600 hover:bg-indigo-700"
            >
              {generatingAi.loading ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating Prompts...</>
              ) : (
                <><MessageSquare className="w-4 h-4 mr-2" /> Generate Teach-Back Prompts</>
              )}
            </Button>
          </div>
        ) : !isComplete ? (
          <div className="space-y-4">
            {/* Progress */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm text-slate-600">
                <span>Question {currentPromptIdx + 1} of {prompts.prompts.length}</span>
                <span>{prompts.topic}</span>
              </div>
              <Progress value={(currentPromptIdx / prompts.prompts.length) * 100} className="h-2" />
            </div>

            {/* Current Prompt */}
            <div className="bg-indigo-50 p-4 rounded-lg border border-indigo-200">
              <div className="flex items-center justify-between mb-2">
                <Badge variant="outline">{currentPrompt.category}</Badge>
                <Badge className={getDifficultyColor(currentPrompt.difficulty)}>
                  {currentPrompt.difficulty}
                </Badge>
              </div>
              
              <div className="flex items-start gap-2 mb-3">
                <MessageSquare className="w-5 h-5 text-indigo-600 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-indigo-900">Ask the patient:</p>
                  <p className="text-indigo-800 text-lg mt-1">"{currentPrompt.primary_question}"</p>
                </div>
              </div>

              {/* Alternative Phrasings */}
              <div className="bg-white p-2 rounded border border-indigo-200 mt-3">
                <p className="text-xs font-medium text-slate-600 mb-1">Alternative ways to ask:</p>
                <ul className="text-xs text-slate-700 space-y-1">
                  {currentPrompt.alternative_phrasings?.map((alt, idx) => (
                    <li key={idx}>• "{alt}"</li>
                  ))}
                </ul>
              </div>
            </div>

            {/* What to Listen For */}
            <div className="bg-green-50 p-3 rounded-lg border border-green-200">
              <p className="text-xs font-semibold text-green-800 mb-2 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Listen for these key points:
              </p>
              <ul className="text-xs text-green-700 space-y-1">
                {currentPrompt.what_to_listen_for?.map((point, idx) => (
                  <li key={idx}>✓ {point}</li>
                ))}
              </ul>
            </div>

            {/* Red Flags */}
            <div className="bg-red-50 p-3 rounded-lg border border-red-200">
              <p className="text-xs font-semibold text-red-800 mb-2 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> Red flags (may indicate misunderstanding):
              </p>
              <ul className="text-xs text-red-700 space-y-1">
                {currentPrompt.red_flags?.map((flag, idx) => (
                  <li key={idx}>⚠ {flag}</li>
                ))}
              </ul>
            </div>

            {/* Follow-Up Prompt (if generated) */}
            {showFollowUp && followUpPrompt && (
              <div className="bg-navy-50 p-4 rounded-lg border border-navy-200">
                <p className="text-xs font-semibold text-navy-800 mb-2 flex items-center gap-1">
                  <Lightbulb className="w-3 h-3" /> AI-Generated Follow-Up
                </p>
                <p className="text-navy-800 font-medium">"{followUpPrompt.follow_up_question}"</p>
                <div className="mt-2 text-xs text-navy-700">
                  <p><strong>Teaching Point:</strong> {followUpPrompt.teaching_point}</p>
                  <p className="mt-1"><strong>Example:</strong> {followUpPrompt.example_or_analogy}</p>
                </div>
                <p className="mt-2 text-navy-600 italic">{followUpPrompt.encouragement}</p>
              </div>
            )}

            {/* Patient Response */}
            <div>
              <Label>Patient's Response</Label>
              <Textarea
                value={currentResponse}
                onChange={(e) => setCurrentResponse(e.target.value)}
                placeholder="Document what the patient said in their own words..."
                rows={3}
              />
            </div>

            {/* Understanding Level */}
            <div>
              <Label className="mb-2 block">Understanding Level</Label>
              <RadioGroup
                value={currentLevel}
                onValueChange={(value) => {
                  setCurrentLevel(value);
                  if ((value === 'poor' || value === 'fair') && !showFollowUp && currentResponse.trim()) {
                    generateFollowUpPrompt(currentResponse, value);
                  }
                }}
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
              
              {generatingFollowUpAi.loading && (
                <p className="text-xs text-navy-600 mt-2 flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Generating follow-up prompt...
                </p>
              )}
            </div>

            {/* Navigation */}
            <div className="flex gap-2">
              {currentPromptIdx > 0 && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setCurrentPromptIdx(currentPromptIdx - 1);
                    setCurrentResponse("");
                    setCurrentLevel("");
                    setShowFollowUp(false);
                    setFollowUpPrompt(null);
                  }}
                >
                  <ChevronLeft className="w-4 h-4 mr-1" /> Previous
                </Button>
              )}
              <Button
                onClick={handleRecordResponse}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700"
                disabled={!currentResponse.trim() || !currentLevel}
              >
                {currentPromptIdx < prompts.prompts.length - 1 ? (
                  <>Record & Next <ChevronRight className="w-4 h-4 ml-1" /></>
                ) : (
                  <>Complete Teach-Back <CheckCircle2 className="w-4 h-4 ml-1" /></>
                )}
              </Button>
            </div>

            {/* Teaching Tips */}
            <div className="bg-slate-50 p-3 rounded-lg border">
              <p className="text-xs font-semibold text-slate-700 mb-1">💡 Teaching Tips:</p>
              <ul className="text-xs text-slate-600 space-y-1">
                {prompts.general_teaching_tips?.slice(0, 2).map((tip, idx) => (
                  <li key={idx}>• {tip}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Completion Summary */}
            <div className="bg-green-50 p-4 rounded-lg border border-green-200 text-center">
              <CheckCircle2 className="w-12 h-12 text-green-600 mx-auto mb-2" />
              <h3 className="font-bold text-green-900">Teach-Back Complete!</h3>
              <p className="text-sm text-green-700">{responses.length} questions verified for {prompts.topic}</p>
            </div>

            {/* Results Summary */}
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-green-50 p-2 rounded border border-green-200">
                <p className="text-2xl font-bold text-green-600">
                  {responses.filter(r => r.understandingLevel === 'good').length}
                </p>
                <p className="text-xs text-green-700">Good</p>
              </div>
              <div className="bg-yellow-50 p-2 rounded border border-yellow-200">
                <p className="text-2xl font-bold text-yellow-600">
                  {responses.filter(r => r.understandingLevel === 'fair').length}
                </p>
                <p className="text-xs text-yellow-700">Fair</p>
              </div>
              <div className="bg-red-50 p-2 rounded border border-red-200">
                <p className="text-2xl font-bold text-red-600">
                  {responses.filter(r => r.understandingLevel === 'poor').length}
                </p>
                <p className="text-xs text-red-700">Poor</p>
              </div>
            </div>

            {/* Response Details */}
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {responses.map((r, idx) => (
                <div key={idx} className="p-2 bg-slate-50 rounded border text-sm">
                  <div className="flex items-center justify-between mb-1">
                    <Badge variant="outline" className="text-xs">{r.category}</Badge>
                    <Badge className={
                      r.understandingLevel === 'good' ? 'bg-green-100 text-green-800' :
                      r.understandingLevel === 'fair' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-red-100 text-red-800'
                    }>
                      {r.understandingLevel}
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-600">{r.question}</p>
                </div>
              ))}
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <Button
                onClick={handleCopyDocumentation}
                variant="outline"
                className="flex-1"
              >
                {copied ? (
                  <><CheckCircle2 className="w-4 h-4 mr-1 text-green-600" /> Copied!</>
                ) : (
                  <><Copy className="w-4 h-4 mr-1" /> Copy Documentation</>
                )}
              </Button>
              <Button
                onClick={() => {
                  setPrompts(null);
                  setResponses([]);
                  setCurrentPromptIdx(0);
                  setIsComplete(false);
                }}
                variant="outline"
              >
                <RefreshCw className="w-4 h-4 mr-1" /> New Session
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}