import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { safePercent } from "@/lib/safePercent";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  BookOpen,
  Sparkles,
  Loader2,
  CheckCircle2,
  XCircle,
  ArrowRight,
  ArrowLeft,
  Trophy,
  Target,
  Lightbulb,
  Play
} from "lucide-react";

export default function TargetedLessonGenerator({ 
  module, 
  nurseEmail,
  onComplete,
  onExit
}) {
  const generatingAi = useAICall();
  const [lessonContent, setLessonContent] = useState(null);
  const [currentSection, setCurrentSection] = useState(0);
  const [quizAnswers, setQuizAnswers] = useState({});
  const [quizResults, setQuizResults] = useState(null);
  const [practiceResponse, setPracticeResponse] = useState("");
  const [practiceFeedback, setPracticeFeedback] = useState(null);
  const evaluatingAi = useAICall();
  const [completed, setCompleted] = useState(false);

  const generateLesson = async () => {
    
    try {
      const result = await generatingAi.run({
        model: "claude_opus_4_8",
        prompt: `Generate a comprehensive training lesson for home health nurses on: "${module.title}"

Category: ${module.category}
Description: ${module.description}

Create educational content with:

1. **INTRODUCTION** - Why this matters for Medicare compliance and quality care

2. **CORE CONTENT** - 3-4 detailed teaching sections with:
   - Clear explanations
   - Real examples from home health
   - Do's and Don'ts
   - Sample documentation phrases

3. **PRACTICE SCENARIO** - A realistic situation where the nurse must apply what they learned
   - Include patient details
   - Describe the situation
   - Ask them to write appropriate documentation

4. **QUIZ** - 5 multiple choice questions testing key concepts
   - Mix of easy, medium, and challenging questions
   - Include explanations for correct answers

5. **QUICK REFERENCE** - Bullet points they can use daily

Key points to cover:
${module.keyPoints?.map(p => `- ${p}`).join('\n')}

Make it practical, specific to home health, and immediately applicable.`,
        response_json_schema: {
          type: "object",
          properties: {
            introduction: { type: "string" },
            sections: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  content: { type: "string" },
                  examples: { type: "array", items: { type: "string" } },
                  dos: { type: "array", items: { type: "string" } },
                  donts: { type: "array", items: { type: "string" } },
                  sample_phrases: { type: "array", items: { type: "string" } }
                }
              }
            },
            practice_scenario: {
              type: "object",
              properties: {
                patient: { type: "string" },
                situation: { type: "string" },
                task: { type: "string" },
                ideal_elements: { type: "array", items: { type: "string" } }
              }
            },
            quiz: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  question: { type: "string" },
                  options: { type: "array", items: { type: "string" } },
                  correct_index: { type: "number" },
                  explanation: { type: "string" }
                }
              }
            },
            quick_reference: { type: "array", items: { type: "string" } }
          }
        }
      });

      // Normalize the AI result up front: none of these fields are schema-
      // required, and the render/quiz/practice paths deref them unconditionally.
      setLessonContent({
        ...result,
        sections: Array.isArray(result?.sections) ? result.sections : [],
        quiz: Array.isArray(result?.quiz) ? result.quiz : [],
        quick_reference: Array.isArray(result?.quick_reference) ? result.quick_reference : [],
        practice_scenario: {
          ...(result?.practice_scenario || {}),
          ideal_elements: Array.isArray(result?.practice_scenario?.ideal_elements)
            ? result.practice_scenario.ideal_elements
            : [],
        },
      });
    } catch (error) {
      console.error("Error generating lesson:", error);
    }
  };

  const evaluatePractice = async () => {
    if (!practiceResponse.trim()) return;

    try {
      const result = await evaluatingAi.run({
        model: "claude_opus_4_8",
        prompt: `Evaluate this nurse's documentation practice response.

SCENARIO:
Patient: ${lessonContent.practice_scenario.patient}
Situation: ${lessonContent.practice_scenario.situation}
Task: ${lessonContent.practice_scenario.task}

IDEAL RESPONSE SHOULD INCLUDE:
${lessonContent.practice_scenario.ideal_elements.map((e, i) => `${i + 1}. ${e}`).join('\n')}

NURSE'S RESPONSE:
"${practiceResponse}"

Provide constructive feedback:`,
        response_json_schema: {
          type: "object",
          properties: {
            score: { type: "number" },
            strengths: { type: "array", items: { type: "string" } },
            improvements: { type: "array", items: { type: "string" } },
            model_response: { type: "string" },
            tip: { type: "string" }
          }
        }
      });

      setPracticeFeedback(result);
    } catch (error) {
      console.error("Error evaluating practice:", error);
    }
  };

  const submitQuiz = () => {
    const results = lessonContent.quiz.map((q, idx) => ({
      correct: quizAnswers[idx] === q.correct_index,
      selected: quizAnswers[idx],
      correctAnswer: q.correct_index
    }));
    
    const score = safePercent(results.filter(r => r.correct).length, results.length);
    setQuizResults({ results, score });
  };

  const completeLesson = async () => {
    const finalScore = quizResults?.score || 0;
    const passed = finalScore >= 70;
    
    try {
      await base44.entities.MicroLearningProgress.create({
        nurse_email: nurseEmail,
        skill_area: module.category,
        module_type: 'micro_lesson',
        status: passed ? 'completed' : 'needs_review',
        score: finalScore,
        content: { module: module.title },
        source: 'ai_recommendation'
      });
    } catch (error) {
      console.error("Error saving progress:", error);
    }

    setCompleted(true);
    onComplete?.({ module: module.title, score: finalScore, passed });
  };

  // Initial state - start button
  if (!lessonContent && !generatingAi.loading) {
    return (
      <Card className="border-2 border-navy-200">
        <CardContent className="p-8 text-center">
          <div className="w-16 h-16 bg-navy-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <BookOpen className="w-8 h-8 text-navy-600" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">{module.title}</h2>
          <p className="text-sm text-slate-600 mb-4">{module.description}</p>
          <Badge variant="outline" className="mb-6">{module.duration} minutes</Badge>
          <div className="flex justify-center gap-3">
            <Button variant="outline" onClick={onExit}>Cancel</Button>
            <Button onClick={generateLesson} className="bg-navy-600 hover:bg-navy-700">
              <Sparkles className="w-4 h-4 mr-2" /> Generate Lesson
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Loading
  if (generatingAi.loading) {
    return (
      <Card className="border-2 border-navy-200">
        <CardContent className="p-12 text-center">
          <Loader2 className="w-12 h-12 animate-spin text-navy-600 mx-auto mb-4" />
          <p className="text-lg font-medium text-navy-900">Creating Your Personalized Lesson...</p>
          <p className="text-sm text-navy-700 mt-2">Tailored for: {module.category}</p>
        </CardContent>
      </Card>
    );
  }

  // Completed
  if (completed) {
    const passed = quizResults?.score >= 70;
    return (
      <Card className={`border-2 ${passed ? 'border-green-300 bg-green-50' : 'border-orange-300 bg-orange-50'}`}>
        <CardContent className="p-8 text-center">
          <Trophy className={`w-16 h-16 mx-auto mb-4 ${passed ? 'text-green-600' : 'text-orange-600'}`} />
          <h2 className="text-2xl font-bold text-slate-900 mb-2">
            {passed ? 'Lesson Completed!' : 'Keep Practicing!'}
          </h2>
          <Badge className={`text-lg px-4 py-2 mb-4 ${passed ? 'bg-green-600' : 'bg-orange-600'}`}>
            Quiz Score: {quizResults?.score}%
          </Badge>
          <p className="text-sm text-slate-600 mb-6">
            {passed 
              ? 'Great job! You\'ve demonstrated understanding of this topic.'
              : 'Review the material and try again to improve your score.'}
          </p>
          <Button onClick={onExit} variant="outline">Return to Training Plan</Button>
        </CardContent>
      </Card>
    );
  }

  // Calculate total sections
  const totalSections = 1 + lessonContent.sections.length + 1 + 1 + 1; // intro + content + practice + quiz + summary
  const progress = ((currentSection + 1) / totalSections) * 100;

  // Render current section
  const renderSection = () => {
    // Introduction
    if (currentSection === 0) {
      return (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-slate-900">Introduction</h3>
          <p className="text-sm text-slate-700 whitespace-pre-wrap">{lessonContent.introduction}</p>
        </div>
      );
    }

    // Content sections
    const contentIndex = currentSection - 1;
    if (contentIndex < lessonContent.sections.length) {
      const section = lessonContent.sections[contentIndex];
      return (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-slate-900">{section.title}</h3>
          <p className="text-sm text-slate-700 whitespace-pre-wrap">{section.content}</p>
          
          {section.examples?.length > 0 && (
            <div className="bg-blue-50 p-4 rounded-lg">
              <p className="text-xs font-semibold text-blue-800 mb-2">Examples:</p>
              <ul className="space-y-1">
                {section.examples.map((ex, i) => (
                  <li key={i} className="text-xs text-blue-700">• {ex}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            {section.dos?.length > 0 && (
              <div className="bg-green-50 p-3 rounded-lg">
                <p className="text-xs font-semibold text-green-800 mb-1">✓ Do:</p>
                <ul className="space-y-1">
                  {section.dos.map((d, i) => (
                    <li key={i} className="text-xs text-green-700">• {d}</li>
                  ))}
                </ul>
              </div>
            )}
            {section.donts?.length > 0 && (
              <div className="bg-red-50 p-3 rounded-lg">
                <p className="text-xs font-semibold text-red-800 mb-1">✗ Don't:</p>
                <ul className="space-y-1">
                  {section.donts.map((d, i) => (
                    <li key={i} className="text-xs text-red-700">• {d}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {section.sample_phrases?.length > 0 && (
            <div className="bg-navy-50 p-4 rounded-lg">
              <p className="text-xs font-semibold text-navy-800 mb-2">Sample Documentation Phrases:</p>
              <ul className="space-y-1">
                {section.sample_phrases.map((p, i) => (
                  <li key={i} className="text-xs text-navy-700 italic">"{p}"</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      );
    }

    // Practice section
    if (currentSection === lessonContent.sections.length + 1) {
      return (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <Play className="w-5 h-5 text-green-600" /> Practice Scenario
          </h3>
          
          <div className="bg-blue-50 p-4 rounded-lg">
            <p className="text-sm font-medium text-blue-900 mb-2">Patient: {lessonContent.practice_scenario.patient}</p>
            <p className="text-sm text-blue-800">{lessonContent.practice_scenario.situation}</p>
          </div>

          <div className="bg-navy-50 p-4 rounded-lg">
            <p className="text-sm font-medium text-navy-900">Your Task:</p>
            <p className="text-sm text-navy-800">{lessonContent.practice_scenario.task}</p>
          </div>

          <Textarea
            value={practiceResponse}
            onChange={(e) => setPracticeResponse(e.target.value)}
            placeholder="Write your documentation here..."
            rows={6}
            disabled={!!practiceFeedback}
          />

          {!practiceFeedback ? (
            <Button 
              onClick={evaluatePractice} 
              disabled={!practiceResponse.trim() || evaluatingAi.loading}
              className="w-full bg-green-600 hover:bg-green-700"
            >
              {evaluatingAi.loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Evaluating...</> : 'Submit for Feedback'}
            </Button>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge className={practiceFeedback.score >= 70 ? 'bg-green-600' : 'bg-orange-600'}>
                  Score: {practiceFeedback.score}%
                </Badge>
              </div>
              
              {practiceFeedback.strengths?.length > 0 && (
                <div className="bg-green-50 p-3 rounded-lg">
                  <p className="text-xs font-semibold text-green-800 mb-1">Strengths:</p>
                  <ul className="space-y-1">
                    {practiceFeedback.strengths.map((s, i) => (
                      <li key={i} className="text-xs text-green-700">✓ {s}</li>
                    ))}
                  </ul>
                </div>
              )}

              {practiceFeedback.improvements?.length > 0 && (
                <div className="bg-orange-50 p-3 rounded-lg">
                  <p className="text-xs font-semibold text-orange-800 mb-1">Areas to Improve:</p>
                  <ul className="space-y-1">
                    {practiceFeedback.improvements.map((i, idx) => (
                      <li key={idx} className="text-xs text-orange-700">• {i}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="bg-blue-50 p-3 rounded-lg">
                <p className="text-xs font-semibold text-blue-800 mb-1">Model Response:</p>
                <p className="text-xs text-blue-700 italic">{practiceFeedback.model_response}</p>
              </div>
            </div>
          )}
        </div>
      );
    }

    // Quiz section
    if (currentSection === lessonContent.sections.length + 2) {
      return (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <Target className="w-5 h-5 text-navy-600" /> Knowledge Check
          </h3>

          {!quizResults ? (
            <>
              {lessonContent.quiz.map((q, qIdx) => (
                <div key={qIdx} className="p-4 bg-slate-50 rounded-lg">
                  <p className="text-sm font-medium text-slate-900 mb-3">{qIdx + 1}. {q.question}</p>
                  <RadioGroup
                    value={quizAnswers[qIdx]?.toString()}
                    onValueChange={(val) => setQuizAnswers(prev => ({ ...prev, [qIdx]: parseInt(val) }))}
                  >
                    {q.options.map((opt, oIdx) => (
                      <div key={oIdx} className="flex items-center space-x-2 p-2 hover:bg-white rounded">
                        <RadioGroupItem value={oIdx.toString()} id={`q${qIdx}-o${oIdx}`} />
                        <Label htmlFor={`q${qIdx}-o${oIdx}`} className="text-sm cursor-pointer">{opt}</Label>
                      </div>
                    ))}
                  </RadioGroup>
                </div>
              ))}
              <Button 
                onClick={submitQuiz} 
                disabled={Object.keys(quizAnswers).length < lessonContent.quiz.length}
                className="w-full bg-navy-600 hover:bg-navy-700"
              >
                Submit Quiz
              </Button>
            </>
          ) : (
            <>
              <div className="text-center p-4 bg-navy-50 rounded-lg">
                <p className="text-2xl font-bold text-navy-900">{quizResults.score}%</p>
                <p className="text-sm text-navy-700">
                  {quizResults.results.filter(r => r.correct).length} of {quizResults.results.length} correct
                </p>
              </div>
              
              {lessonContent.quiz.map((q, qIdx) => {
                const result = quizResults.results[qIdx];
                return (
                  <div key={qIdx} className={`p-3 rounded-lg ${result.correct ? 'bg-green-50' : 'bg-red-50'}`}>
                    <div className="flex items-start gap-2">
                      {result.correct ? (
                        <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5" />
                      ) : (
                        <XCircle className="w-4 h-4 text-red-600 mt-0.5" />
                      )}
                      <div>
                        <p className="text-xs font-medium text-slate-900">{q.question}</p>
                        {!result.correct && (
                          <p className="text-xs text-green-700 mt-1">Correct: {q.options[q.correct_index]}</p>
                        )}
                        <p className="text-xs text-slate-600 mt-1">{q.explanation}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      );
    }

    // Summary/Quick Reference
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
          <Lightbulb className="w-5 h-5 text-yellow-600" /> Quick Reference
        </h3>
        <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200">
          <p className="text-xs font-semibold text-yellow-800 mb-2">Key Takeaways to Remember:</p>
          <ul className="space-y-2">
            {lessonContent.quick_reference.map((ref, i) => (
              <li key={i} className="text-sm text-yellow-900 flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-yellow-600 mt-0.5 flex-shrink-0" />
                {ref}
              </li>
            ))}
          </ul>
        </div>
        
        <Button onClick={completeLesson} className="w-full bg-green-600 hover:bg-green-700">
          <Trophy className="w-4 h-4 mr-2" /> Complete Lesson
        </Button>
      </div>
    );
  };

  return (
    <Card className="border-2 border-navy-200">
      <CardHeader className="bg-gradient-to-r from-navy-50 to-gold-50">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">{module.title}</CardTitle>
          <Badge variant="outline">
            {currentSection + 1} / {totalSections}
          </Badge>
        </div>
        <Progress value={progress} className="mt-2 h-2" />
      </CardHeader>
      
      <CardContent className="p-4">
        {renderSection()}
        
        <div className="flex justify-between mt-6 pt-4 border-t">
          <Button
            variant="outline"
            onClick={() => setCurrentSection(prev => prev - 1)}
            disabled={currentSection === 0}
          >
            <ArrowLeft className="w-4 h-4 mr-2" /> Previous
          </Button>
          
          {currentSection < totalSections - 1 && (
            <Button
              onClick={() => setCurrentSection(prev => prev + 1)}
              className="bg-navy-600 hover:bg-navy-700"
            >
              Next <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}