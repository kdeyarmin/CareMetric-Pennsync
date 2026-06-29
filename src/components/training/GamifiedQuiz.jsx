import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import {
  Trophy,
  Zap,
  Target,
  Star,
  Flame,
  Award
} from "lucide-react";
import confetti from 'canvas-confetti';

export default function GamifiedQuiz({ questions = [], onComplete, title }) {
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [answers, setAnswers] = useState({});
  const [showFeedback, setShowFeedback] = useState(false);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [points, setPoints] = useState(0);
  const [timeLeft, setTimeLeft] = useState(30);
  const [isComplete, setIsComplete] = useState(false);

  useEffect(() => {
    if (!questions || questions.length === 0) return;
    let timer;
    if (!showFeedback && !isComplete && timeLeft > 0) {
      timer = setTimeout(() => setTimeLeft(prev => prev - 1), 1000);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [timeLeft, showFeedback, isComplete, questions]);

  // Safety check for questions
  if (!questions || questions.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-slate-500">
          No quiz questions available for this module.
        </CardContent>
      </Card>
    );
  }

  const handleAnswerSelect = (answerIndex) => {
    setSelectedAnswer(answerIndex);
  };

  const handleSubmit = () => {
    const question = questions[currentQuestion];
    if (!question) return;
    
    const isCorrect = selectedAnswer === question.correct_answer;
    
    // Calculate points (time bonus + streak multiplier)
    let earnedPoints = 0;
    if (isCorrect) {
      const timeBonus = Math.max(0, timeLeft * 2);
      const streakMultiplier = 1 + (streak * 0.1);
      earnedPoints = Math.round((100 + timeBonus) * streakMultiplier);
      setPoints(points + earnedPoints);
      setStreak(streak + 1);
      setScore(score + 1);
    } else {
      setStreak(0);
    }

    setAnswers({
      ...answers,
      [currentQuestion]: {
        selected: selectedAnswer,
        correct: isCorrect,
        points: earnedPoints
      }
    });
    setShowFeedback(true);

    // Show confetti on correct answer
    if (isCorrect) {
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 }
      });
    }
  };

  const handleNext = () => {
    if (currentQuestion < questions.length - 1) {
      setCurrentQuestion(currentQuestion + 1);
      setSelectedAnswer(null);
      setShowFeedback(false);
      setTimeLeft(30);
    } else {
      setIsComplete(true);
      if (score === questions.length) {
        confetti({
          particleCount: 200,
          spread: 100,
          origin: { y: 0.5 }
        });
      }
    }
  };

  if (isComplete) {
    const percentage = Math.round((score / questions.length) * 100);
    const isPerfect = score === questions.length;

    return (
      <Card className="border-2 border-yellow-400 bg-gradient-to-br from-yellow-50 to-orange-50">
        <CardContent className="p-8 text-center">
          <Trophy className={`w-24 h-24 mx-auto mb-4 ${isPerfect ? 'text-yellow-500' : 'text-slate-400'}`} />
          <h2 className="text-3xl font-bold mb-2">
            {isPerfect ? '🎉 Perfect Score!' : 'Quiz Complete!'}
          </h2>
          
          <div className="grid grid-cols-3 gap-4 my-6">
            <div className="p-4 bg-white rounded-lg border-2 border-green-200">
              <Target className="w-8 h-8 text-green-600 mx-auto mb-2" />
              <p className="text-2xl font-bold text-green-600">{score}/{questions.length}</p>
              <p className="text-sm text-slate-600">Correct</p>
            </div>
            <div className="p-4 bg-white rounded-lg border-2 border-navy-200">
              <Star className="w-8 h-8 text-navy-600 mx-auto mb-2" />
              <p className="text-2xl font-bold text-navy-600">{points}</p>
              <p className="text-sm text-slate-600">Points</p>
            </div>
            <div className="p-4 bg-white rounded-lg border-2 border-orange-200">
              <Flame className="w-8 h-8 text-orange-600 mx-auto mb-2" />
              <p className="text-2xl font-bold text-orange-600">{percentage}%</p>
              <p className="text-sm text-slate-600">Accuracy</p>
            </div>
          </div>

          {isPerfect && (
            <div className="mb-6 p-4 bg-yellow-100 border-2 border-yellow-400 rounded-lg">
              <Award className="w-8 h-8 text-yellow-600 mx-auto mb-2" />
              <p className="font-bold text-yellow-900">Achievement Unlocked!</p>
              <p className="text-sm text-yellow-800">Perfect Quiz Master</p>
            </div>
          )}

          <Button onClick={() => onComplete(percentage, points)} className="w-full">
            Continue
          </Button>
        </CardContent>
      </Card>
    );
  }

  const question = questions[currentQuestion];
  if (!question) return null;
  
  const progress = ((currentQuestion + 1) / questions.length) * 100;
  const currentAnswer = answers[currentQuestion];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between mb-3">
          <CardTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-yellow-500" />
            {title || 'Gamified Quiz'}
          </CardTitle>
          <div className="flex items-center gap-4">
            {/* Streak Counter */}
            <div className="flex items-center gap-1 px-3 py-1 bg-orange-100 rounded-full">
              <Flame className="w-4 h-4 text-orange-600" />
              <span className="text-sm font-bold text-orange-600">{streak}</span>
            </div>
            {/* Points */}
            <div className="flex items-center gap-1 px-3 py-1 bg-navy-100 rounded-full">
              <Star className="w-4 h-4 text-navy-600" />
              <span className="text-sm font-bold text-navy-600">{points}</span>
            </div>
            {/* Timer */}
            <div className={`flex items-center gap-1 px-3 py-1 rounded-full ${
              timeLeft <= 10 ? 'bg-red-100' : 'bg-blue-100'
            }`}>
              <span className={`text-sm font-bold ${
                timeLeft <= 10 ? 'text-red-600' : 'text-blue-600'
              }`}>
                {timeLeft}s
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Progress value={progress} className="flex-1 h-2" />
          <Badge>{currentQuestion + 1}/{questions.length}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          <div>
            <h3 className="text-lg font-semibold mb-4">{question.question}</h3>
            
            <RadioGroup
              value={selectedAnswer?.toString()}
              onValueChange={(value) => handleAnswerSelect(parseInt(value))}
              disabled={showFeedback}
            >
              {question.options?.map((option, idx) => {
                const isSelected = selectedAnswer === idx;
                const isCorrect = idx === question.correct_answer;
                const showCorrect = showFeedback && isCorrect;
                const showWrong = showFeedback && isSelected && !isCorrect;

                return (
                  <div
                    key={idx}
                    className={`flex items-center space-x-2 p-4 border-2 rounded-lg transition-all ${
                      showCorrect ? 'border-green-500 bg-green-50' :
                      showWrong ? 'border-red-500 bg-red-50' :
                      isSelected ? 'border-navy-500 bg-navy-50' :
                      'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <RadioGroupItem value={idx.toString()} id={`option-${idx}`} />
                    <Label htmlFor={`option-${idx}`} className="flex-1 cursor-pointer">
                      {option}
                    </Label>
                    {showCorrect && <Badge className="bg-green-500">✓ Correct</Badge>}
                    {showWrong && <Badge className="bg-red-500">✗ Wrong</Badge>}
                  </div>
                );
              })}
            </RadioGroup>
          </div>

          {showFeedback && (
            <div className={`p-4 rounded-lg ${
              currentAnswer?.correct ? 'bg-green-50 border-2 border-green-200' : 'bg-yellow-50 border-2 border-yellow-200'
            }`}>
              <p className="font-semibold mb-2">
                {currentAnswer?.correct ? '🎉 Correct!' : '💡 Learn More'}
              </p>
              <p className="text-sm text-slate-700">{question.explanation}</p>
              {currentAnswer?.points > 0 && (
                <p className="text-sm font-bold text-green-600 mt-2">
                  +{currentAnswer.points} points earned!
                </p>
              )}
            </div>
          )}

          <div className="flex gap-3">
            {!showFeedback ? (
              <Button
                onClick={handleSubmit}
                disabled={selectedAnswer === null}
                className="w-full"
              >
                Submit Answer
              </Button>
            ) : (
              <Button onClick={handleNext} className="w-full">
                {currentQuestion < questions.length - 1 ? 'Next Question' : 'Finish Quiz'}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}