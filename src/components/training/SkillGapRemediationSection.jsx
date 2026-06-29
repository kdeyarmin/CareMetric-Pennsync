import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Target,
  BookOpen,
  Brain,
  ArrowRight,
  CheckCircle2,
  Loader2,
  AlertTriangle,
  Sparkles
} from "lucide-react";
import { analyzeNurseDeficits } from "@/functions/analyzeNurseDeficits";
import InteractiveDocumentationScenarios from "./InteractiveDocumentationScenarios";
import AIComplianceQuizGenerator from "./AIComplianceQuizGenerator";

export default function SkillGapRemediationSection({ 
  nurseEmail,
  onComplete,
  complianceRisks = [],
  pdgmWarnings = []
}) {
  const [analysis, setAnalysis] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeScenario, setActiveScenario] = useState(null);
  const [activeQuiz, setActiveQuiz] = useState(null);
  const [completedItems, setCompletedItems] = useState(new Set());
  const [complianceModules, setComplianceModules] = useState([]);

  const loadDeficitAnalysis = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await analyzeNurseDeficits({
        nurseEmail,
        daysPeriod: 30
      });
      setAnalysis(response.data);
    } catch (error) {
      console.error("Error loading deficit analysis:", error);
    }
    setIsLoading(false);
  }, [nurseEmail]);

  const mapComplianceRisksToTraining = useCallback(() => {
    const modules = [];
    const riskToTrainingMap = {
      'homebound': { quiz: 'homebound', scenario: 'homebound_justification', priority: 'critical' },
      'skilled_need': { quiz: 'skilled_need', scenario: 'skilled_need', priority: 'critical' },
      'functional': { quiz: 'oasis', scenario: 'vital_signs', priority: 'high' },
      'comorbidity': { quiz: 'medicare_cop', scenario: 'assessment', priority: 'high' },
      'therapy': { quiz: 'skilled_need', scenario: 'skilled_need', priority: 'medium' },
      'documentation': { quiz: 'medicare_cop', scenario: 'homebound_justification', priority: 'high' },
      'safety': { quiz: 'safety', scenario: 'patient_response', priority: 'high' },
      'medication': { quiz: 'safety', scenario: 'medication_management', priority: 'medium' },
      'oasis': { quiz: 'oasis', scenario: 'assessment', priority: 'high' }
    };

    // Map compliance risks
    complianceRisks.forEach(risk => {
      const riskType = risk.element?.toLowerCase() || risk.warning?.toLowerCase() || '';
      Object.keys(riskToTrainingMap).forEach(key => {
        if (riskType.includes(key)) {
          const training = riskToTrainingMap[key];
          modules.push({
            type: 'compliance_risk',
            source: 'compliance_check',
            priority: training.priority,
            severity: risk.severity || 'high',
            description: risk.problem || risk.warning,
            quiz: training.quiz,
            scenario: training.scenario,
            riskDetails: risk
          });
        }
      });
    });

    // Map PDGM warnings
    pdgmWarnings.forEach(warning => {
      const category = warning.category?.toLowerCase() || '';
      if (category.includes('functional')) {
        modules.push({
          type: 'pdgm_risk',
          source: 'pdgm_analysis',
          priority: 'critical',
          severity: 'high',
          description: warning.warning || warning.description,
          quiz: 'oasis',
          scenario: 'vital_signs',
          paymentImpact: warning.payment_impact
        });
      } else if (category.includes('comorbidity')) {
        modules.push({
          type: 'pdgm_risk',
          source: 'pdgm_analysis',
          priority: 'high',
          severity: 'medium',
          description: warning.warning || warning.description,
          quiz: 'medicare_cop',
          scenario: 'assessment',
          paymentImpact: warning.payment_impact
        });
      }
    });

    // Remove duplicates and sort by priority
    const uniqueModules = modules.filter((module, index, self) =>
      index === self.findIndex(m => m.quiz === module.quiz && m.scenario === module.scenario)
    ).sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });

    setComplianceModules(uniqueModules);
  }, [complianceRisks, pdgmWarnings]);

  useEffect(() => {
    loadDeficitAnalysis();
  }, [loadDeficitAnalysis]);

  useEffect(() => {
    mapComplianceRisksToTraining();
  }, [mapComplianceRisksToTraining]);

  const handleScenarioComplete = (scenarioId) => {
    setCompletedItems(prev => new Set([...prev, scenarioId]));
    setActiveScenario(null);
    onComplete?.();
  };

  const handleQuizComplete = (quizId) => {
    setCompletedItems(prev => new Set([...prev, quizId]));
    setActiveQuiz(null);
    onComplete?.();
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <Loader2 className="w-12 h-12 animate-spin text-indigo-600 mx-auto mb-4" />
          <p className="text-slate-600">Analyzing your skill gaps...</p>
        </CardContent>
      </Card>
    );
  }

  if (!analysis || analysis.totalSuggestions === 0) {
    return (
      <Card className="bg-gradient-to-r from-green-50 to-emerald-50 border-green-200">
        <CardContent className="p-8 text-center">
          <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-green-900 mb-2">
            No Skill Gaps Identified!
          </h3>
          <p className="text-green-700">
            Your documentation is excellent. Keep up the great work!
          </p>
        </CardContent>
      </Card>
    );
  }

  // If actively working on a scenario or quiz
  if (activeScenario) {
    return (
      <InteractiveDocumentationScenarios
        selectedScenarioId={activeScenario}
        nurseEmail={nurseEmail}
        onComplete={() => handleScenarioComplete(activeScenario)}
        onBack={() => setActiveScenario(null)}
      />
    );
  }

  if (activeQuiz) {
    return (
      <AIComplianceQuizGenerator
        selectedQuizId={activeQuiz}
        nurseEmail={nurseEmail}
        onComplete={() => handleQuizComplete(activeQuiz)}
        onBack={() => setActiveQuiz(null)}
      />
    );
  }

  // Calculate progress
  const totalRecommendedItems = analysis.recommendations.reduce((sum, rec) => 
    sum + rec.suggestedScenarios.length + rec.suggestedQuizzes.length, 0
  );
  const progress = totalRecommendedItems > 0 
    ? Math.round((completedItems.size / totalRecommendedItems) * 100)
    : 0;

  return (
    <div className="space-y-6">
      {/* Compliance Risk Modules - High Priority */}
      {complianceModules.length > 0 && (
        <Card className="border-red-300 bg-gradient-to-r from-red-50 to-orange-50">
          <CardHeader className="py-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-600" />
              Urgent: Compliance Risk Training
              <Badge className="bg-red-600 text-white animate-pulse">
                {complianceModules.length} module{complianceModules.length > 1 ? 's' : ''}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Alert className="bg-orange-100 border-orange-300">
              <AlertTriangle className="w-4 h-4 text-orange-700" />
              <AlertDescription className="text-sm text-orange-900">
                <strong>AI detected compliance risks in your documentation.</strong> Complete these modules immediately to address potential audit issues.
              </AlertDescription>
            </Alert>

            {complianceModules.map((module, idx) => (
              <Card key={idx} className="border-2 border-red-200">
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <Badge className={
                        module.priority === 'critical' ? 'bg-red-600 text-white' :
                        module.priority === 'high' ? 'bg-orange-600 text-white' :
                        'bg-yellow-600 text-white'
                      }>
                        {module.priority} priority
                      </Badge>
                      <p className="text-sm font-medium text-slate-900 mt-2">{module.description}</p>
                      <Badge variant="outline" className="text-xs mt-1">
                        Source: {module.source.replace(/_/g, ' ')}
                      </Badge>
                      {module.paymentImpact && (
                        <Badge className="text-xs mt-1 ml-1 bg-green-100 text-green-800">
                          {module.paymentImpact} at risk
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-2 border-t">
                    <Button
                      size="sm"
                      className="bg-blue-600 hover:bg-blue-700"
                      onClick={() => setActiveScenario(module.scenario)}
                    >
                      <BookOpen className="w-3 h-3 mr-1" />
                      Practice Scenario
                    </Button>
                    <Button
                      size="sm"
                      className="bg-navy-600 hover:bg-navy-700"
                      onClick={() => setActiveQuiz(module.quiz)}
                    >
                      <Brain className="w-3 h-3 mr-1" />
                      Take Quiz
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Header with Progress */}
      <Card className="bg-gradient-to-r from-indigo-50 to-navy-50 border-indigo-200">
        <CardContent className="p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                <Target className="w-6 h-6 text-indigo-600" />
                Personalized Skill Gap Remediation
              </h2>
              <p className="text-slate-600 mt-1">
                Complete these modules to address your identified areas of improvement
              </p>
            </div>
            <Badge className="bg-indigo-600 text-white text-lg px-4 py-2">
              {completedItems.size}/{totalRecommendedItems}
            </Badge>
          </div>
          
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-700 font-medium">Overall Progress</span>
              <span className="text-indigo-600 font-bold">{progress}%</span>
            </div>
            <Progress value={progress} className="h-3" />
          </div>

          {analysis.patterns?.length > 0 && (
            <Alert className="mt-4 bg-orange-50 border-orange-200">
              <AlertTriangle className="w-4 h-4 text-orange-600" />
              <AlertDescription className="text-sm text-orange-800">
                <strong>Key Pattern:</strong> {analysis.patterns[0].description}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Deficit-Based Training Modules */}
      {analysis.recommendations.map((recommendation, idx) => {
        const allItems = [
          ...recommendation.suggestedScenarios.map(s => ({ type: 'scenario', id: s })),
          ...recommendation.suggestedQuizzes.map(q => ({ type: 'quiz', id: q }))
        ];
        const completedInCategory = allItems.filter(item => 
          completedItems.has(item.id)
        ).length;
        const categoryProgress = allItems.length > 0 
          ? Math.round((completedInCategory / allItems.length) * 100)
          : 0;

        return (
          <Card 
            key={idx} 
            className={`border-2 ${
              recommendation.severity === 'critical' ? 'border-red-300 bg-red-50' :
              recommendation.severity === 'high' ? 'border-orange-300 bg-orange-50' :
              'border-yellow-300 bg-yellow-50'
            }`}
          >
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <CardTitle className="text-lg capitalize flex items-center gap-2">
                    {recommendation.category}
                    <Badge className={
                      recommendation.severity === 'critical' ? 'bg-red-600 text-white' :
                      recommendation.severity === 'high' ? 'bg-orange-600 text-white' :
                      'bg-yellow-600 text-white'
                    }>
                      {recommendation.severity} priority
                    </Badge>
                  </CardTitle>
                  <p className="text-sm text-slate-600 mt-1">
                    {recommendation.count} AI suggestions identified in this area
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-slate-900">{categoryProgress}%</p>
                  <p className="text-xs text-slate-500">complete</p>
                </div>
              </div>
              <Progress value={categoryProgress} className="mt-2 h-2" />
            </CardHeader>

            <CardContent className="space-y-4">
              {/* Practice Scenarios */}
              {recommendation.suggestedScenarios.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-slate-700 flex items-center gap-1">
                    <BookOpen className="w-4 h-4 text-blue-600" />
                    Practice Scenarios
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {recommendation.suggestedScenarios.map((scenarioId) => {
                      const isCompleted = completedItems.has(scenarioId);
                      return (
                        <Button
                          key={scenarioId}
                          variant={isCompleted ? "outline" : "default"}
                          className={`justify-between h-auto py-3 ${
                            isCompleted ? 'bg-green-50 border-green-300' : 'bg-blue-600 hover:bg-blue-700'
                          }`}
                          onClick={() => setActiveScenario(scenarioId)}
                        >
                          <span className="flex items-center gap-2 text-left flex-1">
                            {isCompleted ? (
                              <CheckCircle2 className="w-4 h-4 text-green-600" />
                            ) : (
                              <Sparkles className="w-4 h-4" />
                            )}
                            <span className="text-sm">
                              {scenarioId.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                            </span>
                          </span>
                          {!isCompleted && <ArrowRight className="w-4 h-4" />}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Knowledge Quizzes */}
              {recommendation.suggestedQuizzes.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-slate-700 flex items-center gap-1">
                    <Brain className="w-4 h-4 text-navy-600" />
                    Knowledge Quizzes
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {recommendation.suggestedQuizzes.map((quizId) => {
                      const isCompleted = completedItems.has(quizId);
                      return (
                        <Button
                          key={quizId}
                          variant={isCompleted ? "outline" : "default"}
                          className={`justify-between h-auto py-3 ${
                            isCompleted ? 'bg-green-50 border-green-300' : 'bg-navy-600 hover:bg-navy-700'
                          }`}
                          onClick={() => setActiveQuiz(quizId)}
                        >
                          <span className="flex items-center gap-2 text-left flex-1">
                            {isCompleted ? (
                              <CheckCircle2 className="w-4 h-4 text-green-600" />
                            ) : (
                              <Brain className="w-4 h-4" />
                            )}
                            <span className="text-sm">
                              {quizId.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                            </span>
                          </span>
                          {!isCompleted && <ArrowRight className="w-4 h-4" />}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="pt-3 border-t">
                <p className="text-xs text-slate-600 italic">
                  <strong>Rationale:</strong> {recommendation.rationale}
                </p>
              </div>
            </CardContent>
          </Card>
        );
      })}

      {/* Completion Message */}
      {progress === 100 && (
        <Card className="bg-gradient-to-r from-green-50 to-emerald-50 border-green-300">
          <CardContent className="p-6 text-center">
            <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-green-900 mb-2">
              Congratulations! 🎉
            </h3>
            <p className="text-green-700">
              You've completed all recommended training modules. Your skills are now up to date!
            </p>
            <Button 
              onClick={loadDeficitAnalysis}
              className="mt-4 bg-green-600 hover:bg-green-700"
            >
              Check for New Recommendations
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}