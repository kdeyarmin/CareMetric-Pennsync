import { useState } from "react";
import { toast } from "sonner";
import { useAICall } from "@/hooks/useAICall";
import { DEFAULT_PASSING_SCORE } from "@/constants/training";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import {
  HelpCircle,
  CheckCircle2,
  XCircle,
  Sparkles,
  Loader2,
  Trophy,
  RotateCcw,
  ArrowRight,
  Brain,
  Target
} from "lucide-react";

const quizCategories = [
  { id: "documentation", label: "Documentation", questions: 10 },
  { id: "medicare", label: "Medicare Compliance", questions: 10 },
  { id: "oasis", label: "OASIS Requirements", questions: 8 },
  { id: "communication", label: "Patient Communication", questions: 8 },
  { id: "safety", label: "Patient Safety", questions: 8 },
  { id: "hipaa", label: "HIPAA & Privacy", questions: 8 }
];

export default function InteractiveQuizModule({ _nurseEmail, onQuizCompleted }) {
  const [selectedCategory, setSelectedCategory] = useState(null);
  const ai = useAICall();
  const [questions, setQuestions] = useState([]);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [showResult, setShowResult] = useState(false);
  const [score, setScore] = useState(0);
  const [answers, setAnswers] = useState([]);
  const [quizCompleted, setQuizCompleted] = useState(false);
  const [startTime, setStartTime] = useState(null);

  const generateQuiz = async (category) => {
    setSelectedCategory(category);
    setStartTime(new Date());
    
    try {
      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `Generate a professional quiz for home health nurses on: "${category.label}"

Create ${category.questions} multiple-choice questions that test practical knowledge.

Requirements:
- Questions should be scenario-based when possible
- Include realistic clinical situations
- Test understanding, not just memorization
- Cover different difficulty levels (easy, medium, hard)
- Each question should have 4 options with only 1 correct answer
- Explanations should be educational and reference best practices

Topics to cover for ${category.label}:
${category.id === 'documentation' ? '- Note writing, homebound status, skilled need, vital signs, assessments' : ''}
${category.id === 'medicare' ? '- Conditions of Participation, coverage criteria, billing requirements, medical necessity' : ''}
${category.id === 'oasis' ? '- Data collection, timing requirements, M-items, assessment accuracy' : ''}
${category.id === 'communication' ? '- Patient education, family communication, teach-back, difficult conversations' : ''}
${category.id === 'safety' ? '- Fall prevention, medication safety, infection control, emergency response' : ''}
${category.id === 'hipaa' ? '- Protected health information, patient rights, breach prevention, documentation security' : ''}`,
        response_json_schema: {
          type: "object",
          properties: {
            questions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  question: { type: "string" },
                  options: { type: "array", items: { type: "string" } },
                  correct_index: { type: "number" },
                  explanation: { type: "string" },
                  difficulty: { type: "string" },
                  topic: { type: "string" }
                }
              }
            }
          }
        }
      });

      const generated = Array.isArray(result.questions) ? result.questions : [];
      // Guard: an empty question set would make scoring divide by zero (NaN).
      if (generated.length === 0) {
        toast.error('The quiz failed to generate. Please try again.');
        setSelectedCategory(null);
        return;
      }

      setQuestions(generated);
      setCurrentQuestion(0);
      setScore(0);
      setAnswers([]);
      setQuizCompleted(false);
    } catch (error) {
      console.error("Error generating quiz:", error);
      toast.error('The quiz failed to generate. Please try again.');
      setSelectedCategory(null);
    }
  };

  const handleAnswer = () => {
    if (selectedAnswer === null) return;
    
    const isCorrect = selectedAnswer === questions[currentQuestion].correct_index;
    if (isCorrect) setScore(prev => prev + 1);
    
    setAnswers(prev => [...prev, {
      questionIndex: currentQuestion,
      selected: selectedAnswer,
      correct: questions[currentQuestion].correct_index,
      isCorrect
    }]);
    
    setShowResult(true);
  };

  const nextQuestion = () => {
    if (currentQuestion < questions.length - 1) {
      setCurrentQuestion(prev => prev + 1);
      setSelectedAnswer(null);
      setShowResult(false);
    } else {
      setQuizCompleted(true);
      const endTime = new Date();
      const duration = Math.round((endTime - startTime) / 1000 / 60);

      const percentage = questions.length > 0
        ? Math.round((score / questions.length) * 100)
        : 0;

      onQuizCompleted?.({
        category: selectedCategory.label,
        score,
        total: questions.length,
        percentage,
        duration,
        answers
      });
    }
  };

  const resetQuiz = () => {
    setSelectedCategory(null);
    setQuestions([]);
    setCurrentQuestion(0);
    setSelectedAnswer(null);
    setShowResult(false);
    setScore(0);
    setAnswers([]);
    setQuizCompleted(false);
  };

  // Category Selection
  if (!selectedCategory) {
    return (
      <div className="space-y-4">
        <div className="text-center mb-6">
          <h2 className="text-xl font-bold text-slate-900 mb-2">Interactive Knowledge Quiz</h2>
          <p className="text-sm text-slate-600">Test your understanding with AI-generated questions</p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {quizCategories.map((category) => (
            <Card
              key={category.id}
              className="cursor-pointer hover:shadow-lg transition-all hover:border-blue-300"
              onClick={() => generateQuiz(category)}
            >
              <CardContent className="p-6 text-center">
                <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <HelpCircle className="w-6 h-6 text-blue-600" />
                </div>
                <h3 className="font-semibold text-slate-900 mb-1">{category.label}</h3>
                <p className="text-xs text-slate-500">{category.questions} questions</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // Loading State
  if (ai.loading) {
    return (
      <Card className="border-2 border-blue-200 bg-blue-50">
        <CardContent className="p-12 text-center">
          <Loader2 className="w-12 h-12 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-lg font-medium text-blue-900">Generating Quiz...</p>
          <p className="text-sm text-blue-700 mt-2">Creating {selectedCategory.questions} questions on {selectedCategory.label}</p>
        </CardContent>
      </Card>
    );
  }

  // Quiz Completed
  if (quizCompleted) {
    const percentage = questions.length > 0 ? Math.round((score / questions.length) * 100) : 0;
    const passed = percentage >= DEFAULT_PASSING_SCORE;

    return (
      <Card className={`border-2 ${passed ? 'border-green-300 bg-green-50' : 'border-orange-300 bg-orange-50'}`}>
        <CardContent className="p-8 text-center">
          <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4 ${
            passed ? 'bg-green-100' : 'bg-orange-100'
          }`}>
            {passed ? (
              <Trophy className="w-10 h-10 text-green-600" />
            ) : (
              <Target className="w-10 h-10 text-orange-600" />
            )}
          </div>
          
          <h2 className="text-2xl font-bold text-slate-900 mb-2">
            {passed ? 'Congratulations!' : 'Keep Learning!'}
          </h2>
          
          <p className="text-lg text-slate-700 mb-4">
            You scored <span className="font-bold">{score}</span> out of <span className="font-bold">{questions.length}</span>
          </p>
          
          <div className="flex justify-center gap-4 mb-6">
            <Badge className={`text-lg px-4 py-2 ${passed ? 'bg-green-600' : 'bg-orange-600'}`}>
              {percentage}%
            </Badge>
            <Badge variant="outline" className="text-lg px-4 py-2">
              {passed ? 'PASSED' : 'NEEDS REVIEW'}
            </Badge>
          </div>

          {/* Answer Review */}
          <div className="text-left bg-white rounded-lg p-4 mb-6 max-h-60 overflow-auto">
            <h3 className="font-semibold text-slate-900 mb-3">Answer Review:</h3>
            {questions.map((q, idx) => {
              const answer = answers[idx];
              return (
                <div key={idx} className={`p-2 rounded mb-2 ${answer?.isCorrect ? 'bg-green-50' : 'bg-red-50'}`}>
                  <div className="flex items-start gap-2">
                    {answer?.isCorrect ? (
                      <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red-600 mt-0.5" />
                    )}
                    <div>
                      <p className="text-xs font-medium text-slate-900">Q{idx + 1}: {(q.question || '').substring(0, 60)}...</p>
                      {!answer?.isCorrect && (
                        <p className="text-xs text-green-700 mt-1">Correct: {q.options[q.correct_index]}</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex justify-center gap-3">
            <Button variant="outline" onClick={resetQuiz}>
              <RotateCcw className="w-4 h-4 mr-2" />
              Try Another Quiz
            </Button>
            <Button onClick={() => generateQuiz(selectedCategory)} className="bg-blue-600 hover:bg-blue-700">
              <Sparkles className="w-4 h-4 mr-2" />
              Retake This Quiz
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Active Quiz
  const currentQ = questions[currentQuestion];
  const progress = ((currentQuestion + 1) / questions.length) * 100;

  return (
    <Card className="border-2 border-blue-200">
      <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Brain className="w-4 h-4 text-blue-600" />
            {selectedCategory.label} Quiz
          </CardTitle>
          <div className="flex items-center gap-3">
            <Badge variant="outline">
              Question {currentQuestion + 1} of {questions.length}
            </Badge>
            <Badge className="bg-green-600">
              Score: {score}
            </Badge>
          </div>
        </div>
        <Progress value={progress} className="mt-2" />
      </CardHeader>
      
      <CardContent className="p-6">
        {/* Difficulty Badge */}
        <div className="flex items-center gap-2 mb-4">
          <Badge variant="outline" className={`text-xs ${
            currentQ?.difficulty === 'hard' ? 'bg-red-50 text-red-700' :
            currentQ?.difficulty === 'medium' ? 'bg-yellow-50 text-yellow-700' :
            'bg-green-50 text-green-700'
          }`}>
            {currentQ?.difficulty || 'medium'}
          </Badge>
          <Badge variant="outline" className="text-xs">
            {currentQ?.topic}
          </Badge>
        </div>

        {/* Question */}
        <h3 className="text-lg font-medium text-slate-900 mb-6">{currentQ?.question}</h3>

        {/* Options */}
        <RadioGroup
          value={selectedAnswer?.toString()}
          onValueChange={(val) => !showResult && setSelectedAnswer(parseInt(val))}
          className="space-y-3"
        >
          {currentQ?.options?.map((option, idx) => {
            let optionClass = "border-slate-200 hover:border-blue-300";
            if (showResult) {
              if (idx === currentQ.correct_index) {
                optionClass = "border-green-500 bg-green-50";
              } else if (idx === selectedAnswer && idx !== currentQ.correct_index) {
                optionClass = "border-red-500 bg-red-50";
              }
            } else if (selectedAnswer === idx) {
              optionClass = "border-blue-500 bg-blue-50";
            }

            return (
              <div
                key={idx}
                className={`flex items-center space-x-3 p-4 rounded-lg border-2 cursor-pointer transition-all ${optionClass}`}
                onClick={() => !showResult && setSelectedAnswer(idx)}
              >
                <RadioGroupItem value={idx.toString()} id={`option-${idx}`} disabled={showResult} />
                <Label htmlFor={`option-${idx}`} className="flex-1 cursor-pointer text-sm">
                  {option}
                </Label>
                {showResult && idx === currentQ.correct_index && (
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                )}
                {showResult && idx === selectedAnswer && idx !== currentQ.correct_index && (
                  <XCircle className="w-5 h-5 text-red-600" />
                )}
              </div>
            );
          })}
        </RadioGroup>

        {/* Explanation */}
        {showResult && (
          <div className={`mt-6 p-4 rounded-lg ${
            selectedAnswer === currentQ.correct_index ? 'bg-green-100 border border-green-300' : 'bg-blue-100 border border-blue-300'
          }`}>
            <p className="text-sm font-medium text-slate-900 mb-1">
              {selectedAnswer === currentQ.correct_index ? '✓ Correct!' : '✗ Incorrect'}
            </p>
            <p className="text-sm text-slate-700">{currentQ.explanation}</p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex justify-between mt-6">
          <Button variant="outline" onClick={resetQuiz}>
            Exit Quiz
          </Button>
          
          {!showResult ? (
            <Button 
              onClick={handleAnswer} 
              disabled={selectedAnswer === null}
              className="bg-blue-600 hover:bg-blue-700"
            >
              Submit Answer
            </Button>
          ) : (
            <Button onClick={nextQuestion} className="bg-green-600 hover:bg-green-700">
              {currentQuestion < questions.length - 1 ? (
                <>Next Question <ArrowRight className="w-4 h-4 ml-2" /></>
              ) : (
                <>See Results <Trophy className="w-4 h-4 ml-2" /></>
              )}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}