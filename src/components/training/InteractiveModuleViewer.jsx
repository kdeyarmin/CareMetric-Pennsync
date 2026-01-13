import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, Play, BookOpen, Award, Clock, AlertCircle } from "lucide-react";

export default function InteractiveModuleViewer({ module, onComplete, onProgress }) {
  const [currentSection, setCurrentSection] = useState(0);
  const [score, setScore] = useState(null);
  const [completed, setCompleted] = useState(false);
  const [answers, setAnswers] = useState({});

  const handleQuestionAnswer = (questionId, answer) => {
    setAnswers(prev => ({ ...prev, [questionId]: answer }));
  };

  const calculateScore = () => {
    if (!module.quiz_questions) return 100;
    let correctCount = 0;
    module.quiz_questions.forEach((q, idx) => {
      if (answers[idx] === q.correct_answer) correctCount++;
    });
    return Math.round((correctCount / module.quiz_questions.length) * 100);
  };

  const handleCompleteModule = async () => {
    const finalScore = calculateScore();
    setScore(finalScore);
    setCompleted(true);
    
    if (onComplete) {
      await onComplete({
        module_id: module.id,
        score: finalScore,
        completion_date: new Date().toISOString()
      });
    }
  };

  const progressPercentage = (currentSection / (module.sections?.length || 1)) * 100;

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="text-2xl">{module.title}</CardTitle>
                <p className="text-gray-600 mt-2">{module.description}</p>
              </div>
              <Badge className="bg-blue-100 text-blue-800 flex-shrink-0">
                {module.difficulty_level}
              </Badge>
            </div>
            
            <div className="flex flex-wrap gap-4 text-sm">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-gray-500" />
                <span>{module.duration_minutes} min</span>
              </div>
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-gray-500" />
                <span>{module.sections?.length || 0} sections</span>
              </div>
              {module.quiz_questions && (
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-gray-500" />
                  <span>{module.quiz_questions.length} questions</span>
                </div>
              )}
            </div>

            <Progress value={progressPercentage} className="h-2" />
          </div>
        </CardHeader>
      </Card>

      {/* Content Sections */}
      {!completed && (
        <Card>
          <CardContent className="p-6 space-y-6">
            {module.sections && module.sections[currentSection] && (
              <div className="space-y-4">
                <h3 className="text-xl font-semibold">
                  {module.sections[currentSection].title}
                </h3>
                <div className="prose max-w-none">
                  {module.sections[currentSection].content}
                </div>
              </div>
            )}

            {/* Navigation */}
            <div className="flex justify-between gap-4 pt-4 border-t">
              <Button
                variant="outline"
                onClick={() => setCurrentSection(Math.max(0, currentSection - 1))}
                disabled={currentSection === 0}
              >
                ← Previous
              </Button>
              
              {currentSection === (module.sections?.length || 1) - 1 ? (
                <Button
                  onClick={handleCompleteModule}
                  className="bg-green-600 hover:bg-green-700"
                >
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Complete Module
                </Button>
              ) : (
                <Button
                  onClick={() => setCurrentSection(currentSection + 1)}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  Next →
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quiz Section */}
      {!completed && module.quiz_questions && currentSection === (module.sections?.length || 1) && (
        <Card>
          <CardHeader>
            <CardTitle>Module Quiz</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {module.quiz_questions.map((q, idx) => (
              <div key={idx} className="space-y-3">
                <p className="font-medium">{q.question}</p>
                <div className="space-y-2">
                  {q.options.map((option, optIdx) => (
                    <label key={optIdx} className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50">
                      <input
                        type="radio"
                        name={`question-${idx}`}
                        value={optIdx}
                        checked={answers[idx] === optIdx}
                        onChange={() => handleQuestionAnswer(idx, optIdx)}
                        className="w-4 h-4"
                      />
                      <span>{option}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
            
            <Button
              onClick={handleCompleteModule}
              className="w-full bg-green-600 hover:bg-green-700"
              disabled={Object.keys(answers).length < module.quiz_questions.length}
            >
              Submit Quiz
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Completion Screen */}
      {completed && (
        <Card className="border-green-200 bg-green-50">
          <CardContent className="p-8 text-center space-y-6">
            <Award className="w-16 h-16 text-green-600 mx-auto" />
            <div>
              <h3 className="text-2xl font-bold text-gray-900 mb-2">Module Complete!</h3>
              <p className="text-gray-600">Great job finishing this training module</p>
            </div>
            
            {score !== null && (
              <div className="bg-white rounded-lg p-4">
                <p className="text-sm text-gray-600 mb-2">Your Score</p>
                <p className="text-4xl font-bold text-green-600">{score}%</p>
              </div>
            )}
            
            <div className="flex gap-3 justify-center">
              <Button variant="outline">View Certificate</Button>
              <Button className="bg-blue-600 hover:bg-blue-700">Next Module</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}