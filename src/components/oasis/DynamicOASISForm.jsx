import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, AlertTriangle, Info, ChevronRight, ChevronLeft } from 'lucide-react';
import OASISValidationEngine, { validateEntireAssessment } from './OASISValidationEngine';
import { OASIS_QUESTIONS } from './oasisQuestions';

// Skip Logic Rules
const SKIP_LOGIC = {
  M0069: {
    // Prognosis - always shown
    condition: () => true
  },
  M1021: {
    // Primary Diagnosis - always shown
    condition: () => true
  },
  M1800: {
    // Grooming - always shown
    condition: () => true
  },
  M1810: {
    // Dressing Upper - shown if patient not bedfast
    condition: (answers) => answers.M1850 !== '5'
  },
  M1820: {
    // Dressing Lower - shown if patient not bedfast
    condition: (answers) => answers.M1850 !== '5'
  },
  M1830: {
    // Bathing - always shown
    condition: () => true
  },
  M1840: {
    // Toileting - shown if patient can transfer
    condition: (answers) => answers.M1850 !== '5' && answers.M1845 !== '5'
  },
  M1845: {
    // Toilet Transferring - shown if patient not bedfast
    condition: (answers) => answers.M1850 !== '5'
  },
  M1850: {
    // Transferring - always shown
    condition: () => true
  },
  M1860: {
    // Ambulation - always shown
    condition: () => true
  }
};

export default function DynamicOASISForm({ _patientId, onSave, initialData = {} }) {
  const [answers, setAnswers] = useState(initialData);
  const [currentSection, setCurrentSection] = useState(0);
  const [validationSummary, setValidationSummary] = useState(null);

  // Determine which questions should be shown based on skip logic
  const visibleQuestions = useMemo(() => {
    const questions = [];
    Object.keys(SKIP_LOGIC).forEach(questionId => {
      if (SKIP_LOGIC[questionId].condition(answers)) {
        const question = OASIS_QUESTIONS.find(q => q.id === questionId);
        if (question) {
          questions.push({ ...question, id: questionId });
        }
      }
    });
    return questions;
  }, [answers]);

  // Group questions into sections
  const sections = useMemo(() => {
    const sectionMap = {
      'Clinical': ['M0069', 'M1021'],
      'ADLs - Personal Care': ['M1800', 'M1830'],
      'ADLs - Dressing': ['M1810', 'M1820'],
      'ADLs - Toileting': ['M1840', 'M1845'],
      'Mobility': ['M1850', 'M1860']
    };

    return Object.entries(sectionMap).map(([name, questionIds]) => ({
      name,
      questions: visibleQuestions.filter(q => questionIds.includes(q.id))
    })).filter(section => section.questions.length > 0);
  }, [visibleQuestions]);

  const currentQuestions = sections[currentSection]?.questions || [];

  // Calculate progress
  const totalQuestions = visibleQuestions.length;
  const answeredQuestions = visibleQuestions.filter(q => 
    answers[q.id] !== undefined && answers[q.id] !== null && answers[q.id] !== ''
  ).length;
  const progressPercent = totalQuestions > 0 ? (answeredQuestions / totalQuestions) * 100 : 0;

  // Real-time validation
  useEffect(() => {
    const summary = validateEntireAssessment(answers);
    setValidationSummary(summary);
  }, [answers]);

  const handleAnswerChange = (questionId, value) => {
    setAnswers(prev => ({ ...prev, [questionId]: value }));
  };

  const handleNext = () => {
    if (currentSection < sections.length - 1) {
      setCurrentSection(prev => prev + 1);
    }
  };

  const handlePrevious = () => {
    if (currentSection > 0) {
      setCurrentSection(prev => prev - 1);
    }
  };

  const handleSave = () => {
    if (onSave) {
      onSave(answers);
    }
  };

  const renderQuestionInput = (question) => {
    if (question.options) {
      return (
        <Select
          value={answers[question.id]?.toString() || ''}
          onValueChange={(value) => handleAnswerChange(question.id, value)}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select an answer..." />
          </SelectTrigger>
          <SelectContent>
            {question.options.map((option) => (
              <SelectItem key={option.value} value={option.value.toString()}>
                {option.value} — {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    if (question.type === 'textarea') {
      return (
        <Textarea
          value={answers[question.id] || ''}
          onChange={(e) => handleAnswerChange(question.id, e.target.value)}
          placeholder="Enter diagnosis..."
          rows={2}
        />
      );
    }

    return (
      <Input
        value={answers[question.id] || ''}
        onChange={(e) => handleAnswerChange(question.id, e.target.value)}
        placeholder="Enter answer..."
      />
    );
  };

  return (
    <div className="space-y-6">
      {/* Progress Bar */}
      <Card>
        <CardContent className="p-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-slate-700">Assessment Progress</span>
              <span className="text-slate-900 font-semibold">
                {answeredQuestions} / {totalQuestions} ({Math.round(progressPercent)}%)
              </span>
            </div>
            <Progress value={progressPercent} className="h-2" />
            
            {/* Validation Summary */}
            {validationSummary && (
              <div className="flex items-center gap-2 mt-3">
                {validationSummary.totalErrors === 0 && validationSummary.totalWarnings === 0 ? (
                  <Badge className="bg-green-500 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    All Valid
                  </Badge>
                ) : (
                  <>
                    {validationSummary.totalErrors > 0 && (
                      <Badge className="bg-red-500 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        {validationSummary.totalErrors} Error{validationSummary.totalErrors > 1 ? 's' : ''}
                      </Badge>
                    )}
                    {validationSummary.totalWarnings > 0 && (
                      <Badge className="bg-orange-500 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        {validationSummary.totalWarnings} Warning{validationSummary.totalWarnings > 1 ? 's' : ''}
                      </Badge>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Section Navigation */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {sections.map((section, idx) => (
          <Button
            key={idx}
            variant={currentSection === idx ? 'default' : 'outline'}
            size="sm"
            onClick={() => setCurrentSection(idx)}
            className="whitespace-nowrap"
          >
            {section.name}
            {section.questions.filter(q => 
              answers[q.id] !== undefined && answers[q.id] !== null && answers[q.id] !== ''
            ).length === section.questions.length && (
              <CheckCircle2 className="w-3 h-3 ml-2 text-green-500" />
            )}
          </Button>
        ))}
      </div>

      {/* Current Section Questions */}
      <Card>
        <CardHeader>
          <CardTitle>{sections[currentSection]?.name}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {currentQuestions.map((question) => (
            <div key={question.id} className="space-y-2 p-4 bg-slate-50 rounded-lg border border-slate-200">
              <div className="flex items-start justify-between gap-4">
                <Label className="font-semibold text-slate-900">
                  {question.id} — {question.label}
                </Label>
                {answers[question.id] && (
                  <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
                )}
              </div>
              
              {question.description && (
                <p className="text-sm text-slate-600">{question.description}</p>
              )}

              <div className="mt-2">
                {renderQuestionInput(question)}
              </div>

              {/* Real-time Validation */}
              <OASISValidationEngine
                questionId={question.id}
                value={answers[question.id]}
                allAnswers={answers}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Navigation Buttons */}
      <div className="flex items-center justify-between gap-4">
        <Button
          variant="outline"
          onClick={handlePrevious}
          disabled={currentSection === 0}
        >
          <ChevronLeft className="w-4 h-4 mr-2" />
          Previous
        </Button>

        <div className="text-sm text-slate-600">
          Section {currentSection + 1} of {sections.length}
        </div>

        {currentSection < sections.length - 1 ? (
          <Button onClick={handleNext}>
            Next
            <ChevronRight className="w-4 h-4 ml-2" />
          </Button>
        ) : (
          <Button
            onClick={handleSave}
            className="bg-green-600 hover:bg-green-700"
            disabled={validationSummary?.totalErrors > 0}
          >
            <CheckCircle2 className="w-4 h-4 mr-2" />
            Save Assessment
          </Button>
        )}
      </div>

      {/* Info Alert */}
      <Card className="bg-blue-50 border-blue-200">
        <CardContent className="p-4 flex items-start gap-3">
          <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-blue-900">
            <p className="font-semibold mb-1">Dynamic Skip Logic Active</p>
            <p>Questions automatically adjust based on your answers. Only relevant questions are shown to reduce documentation burden.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}