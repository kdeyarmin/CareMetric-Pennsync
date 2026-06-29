import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Target,
  BookOpen,
  CheckCircle2,
  Clock,
  ChevronDown,
  ChevronUp,
  Loader2,
  Play,
  Award
} from "lucide-react";

// Training modules mapped to documentation areas
const trainingModuleTemplates = {
  'Homebound Status': {
    title: 'Homebound Status Documentation Mastery',
    description: 'Learn to document Medicare-compliant homebound status',
    duration: 20,
    lessons: [
      { title: 'Medicare Definition of Homebound', type: 'lesson', duration: 5 },
      { title: 'Documenting Taxing Effort', type: 'lesson', duration: 5 },
      { title: 'Common Homebound Scenarios', type: 'practice', duration: 5 },
      { title: 'Homebound Status Quiz', type: 'quiz', duration: 5 }
    ],
    keyPoints: [
      'Patient must have a condition that restricts leaving home',
      'Leaving home requires considerable and taxing effort',
      'Absences must be infrequent and short duration',
      'Document specific limitations, not just diagnoses'
    ]
  },
  'Skilled Need Justification': {
    title: 'Skilled Need Justification Excellence',
    description: 'Master the art of justifying skilled nursing services',
    duration: 25,
    lessons: [
      { title: 'What Constitutes Skilled Care', type: 'lesson', duration: 5 },
      { title: 'Teaching & Training Documentation', type: 'lesson', duration: 5 },
      { title: 'Observation & Assessment Skills', type: 'lesson', duration: 5 },
      { title: 'Writing Skilled Need Statements', type: 'practice', duration: 5 },
      { title: 'Skilled Need Quiz', type: 'quiz', duration: 5 }
    ],
    keyPoints: [
      'Must require skills of a licensed nurse',
      'Cannot be safely performed by non-skilled personnel',
      'Must be reasonable and necessary',
      'Document clinical judgment and decision-making'
    ]
  },
  'Vital Signs Documentation': {
    title: 'Complete Vital Signs Documentation',
    description: 'Document vitals comprehensively with clinical context',
    duration: 15,
    lessons: [
      { title: 'Essential Vital Sign Parameters', type: 'lesson', duration: 3 },
      { title: 'Condition-Specific Vitals', type: 'lesson', duration: 5 },
      { title: 'Trending and Analysis', type: 'lesson', duration: 4 },
      { title: 'Vital Signs Quiz', type: 'quiz', duration: 3 }
    ],
    keyPoints: [
      'Document all relevant parameters for diagnosis',
      'Include position and circumstances',
      'Compare to baseline and previous visits',
      'Note clinical significance of findings'
    ]
  },
  'Assessment Documentation': {
    title: 'Comprehensive Assessment Skills',
    description: 'Document thorough, objective clinical assessments',
    duration: 30,
    lessons: [
      { title: 'Head-to-Toe Assessment Structure', type: 'lesson', duration: 8 },
      { title: 'Objective vs Subjective Findings', type: 'lesson', duration: 5 },
      { title: 'Disease-Specific Assessments', type: 'lesson', duration: 8 },
      { title: 'Assessment Documentation Practice', type: 'practice', duration: 5 },
      { title: 'Assessment Quiz', type: 'quiz', duration: 4 }
    ],
    keyPoints: [
      'Use measurable, objective language',
      'Document pertinent positives AND negatives',
      'Include all systems relevant to diagnosis',
      'Note changes from previous assessment'
    ]
  },
  'Patient Response': {
    title: 'Documenting Patient Response',
    description: 'Capture patient understanding and response to care',
    duration: 15,
    lessons: [
      { title: 'Teach-Back Method', type: 'lesson', duration: 4 },
      { title: 'Documenting Understanding', type: 'lesson', duration: 4 },
      { title: 'Response to Interventions', type: 'lesson', duration: 4 },
      { title: 'Patient Response Quiz', type: 'quiz', duration: 3 }
    ],
    keyPoints: [
      'Document specific patient statements',
      'Note demonstrated understanding',
      'Include barriers to learning',
      'Record response to interventions'
    ]
  },
  'Care Planning': {
    title: 'Effective Care Plan Documentation',
    description: 'Write measurable goals and evidence-based interventions',
    duration: 25,
    lessons: [
      { title: 'SMART Goal Writing', type: 'lesson', duration: 6 },
      { title: 'Evidence-Based Interventions', type: 'lesson', duration: 6 },
      { title: 'Progress Documentation', type: 'lesson', duration: 5 },
      { title: 'Care Plan Updates', type: 'practice', duration: 4 },
      { title: 'Care Planning Quiz', type: 'quiz', duration: 4 }
    ],
    keyPoints: [
      'Goals must be specific, measurable, achievable',
      'Interventions should address identified problems',
      'Document progress toward goals each visit',
      'Update plans based on patient response'
    ]
  },
  'Interventions': {
    title: 'Intervention Documentation',
    description: 'Document nursing interventions completely',
    duration: 20,
    lessons: [
      { title: 'Types of Nursing Interventions', type: 'lesson', duration: 5 },
      { title: 'Documenting Actions Taken', type: 'lesson', duration: 5 },
      { title: 'Linking Interventions to Problems', type: 'lesson', duration: 5 },
      { title: 'Intervention Quiz', type: 'quiz', duration: 5 }
    ],
    keyPoints: [
      'Document what was done, not just planned',
      'Include patient response to intervention',
      'Link to care plan goals',
      'Note time spent on skilled tasks'
    ]
  },
  'Functional Status': {
    title: 'Functional Status Assessment',
    description: 'Document ADLs, IADLs, and mobility accurately',
    duration: 20,
    lessons: [
      { title: 'ADL Assessment & Scoring', type: 'lesson', duration: 5 },
      { title: 'IADL Documentation', type: 'lesson', duration: 5 },
      { title: 'Mobility & Safety Assessment', type: 'lesson', duration: 5 },
      { title: 'Functional Status Quiz', type: 'quiz', duration: 5 }
    ],
    keyPoints: [
      'Use standardized scoring when possible',
      'Document assistance level required',
      'Note safety concerns and fall risk',
      'Compare to baseline functional status'
    ]
  },
  'Medication Documentation': {
    title: 'Medication Documentation Excellence',
    description: 'Complete medication reconciliation and education',
    duration: 20,
    lessons: [
      { title: 'Medication Reconciliation Process', type: 'lesson', duration: 5 },
      { title: 'Documenting Medication Education', type: 'lesson', duration: 5 },
      { title: 'Side Effects & Compliance', type: 'lesson', duration: 5 },
      { title: 'Medication Quiz', type: 'quiz', duration: 5 }
    ],
    keyPoints: [
      'Verify all medications each visit',
      'Document education provided',
      'Note compliance and barriers',
      'Report discrepancies promptly'
    ]
  },
  'Communication': {
    title: 'Professional Communication',
    description: 'Document communications effectively',
    duration: 15,
    lessons: [
      { title: 'Physician Communication', type: 'lesson', duration: 4 },
      { title: 'Family/Caregiver Updates', type: 'lesson', duration: 4 },
      { title: 'Interdisciplinary Coordination', type: 'lesson', duration: 4 },
      { title: 'Communication Quiz', type: 'quiz', duration: 3 }
    ],
    keyPoints: [
      'Document all MD communications with time',
      'Note family teaching and concerns',
      'Record care coordination activities',
      'Use professional, objective language'
    ]
  }
};

export default function PersonalizedTrainingPlan({ 
  nurseEmail, 
  skillGaps = [], 
  onStartModule,
  _onModuleComplete 
}) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [trainingPlan, setTrainingPlan] = useState(null);
  const [expandedModules, setExpandedModules] = useState(new Set());
  const [moduleProgress, _setModuleProgress] = useState({});

  const generatePersonalizedPlan = useCallback(async () => {
    setIsGenerating(true);

    // Build personalized plan based on skill gaps
    const plan = {
      nurseEmail,
      generatedAt: new Date(),
      totalDuration: 0,
      modules: []
    };

    // Prioritize modules based on skill gaps
    skillGaps.forEach((gap, index) => {
      const template = trainingModuleTemplates[gap.category];
      if (template) {
        plan.modules.push({
          ...template,
          category: gap.category,
          priority: index + 1,
          issueCount: gap.count,
          severity: gap.priority > 10 ? 'high' : gap.priority > 5 ? 'medium' : 'low',
          status: 'not_started',
          progress: 0
        });
        plan.totalDuration += template.duration;
      }
    });

    // Add general documentation if no specific gaps
    if (plan.modules.length === 0) {
      plan.modules.push({
        ...trainingModuleTemplates['Assessment Documentation'],
        category: 'Assessment Documentation',
        priority: 1,
        issueCount: 0,
        severity: 'low',
        status: 'not_started',
        progress: 0
      });
    }

    setTrainingPlan(plan);
    setIsGenerating(false);
  }, [nurseEmail, skillGaps]);

  useEffect(() => {
    if (skillGaps.length > 0) {
      generatePersonalizedPlan();
    }
  }, [skillGaps, generatePersonalizedPlan]);

  const toggleModule = (index) => {
    setExpandedModules(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'high': return 'bg-red-100 text-red-800 border-red-300';
      case 'medium': return 'bg-orange-100 text-orange-800 border-orange-300';
      case 'low': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      default: return 'bg-slate-100 text-slate-800';
    }
  };

  const getLessonIcon = (type) => {
    switch (type) {
      case 'lesson': return <BookOpen className="w-3 h-3" />;
      case 'practice': return <Play className="w-3 h-3" />;
      case 'quiz': return <Target className="w-3 h-3" />;
      default: return <BookOpen className="w-3 h-3" />;
    }
  };

  if (isGenerating) {
    return (
      <Card className="border-2 border-navy-200">
        <CardContent className="p-8 text-center">
          <Loader2 className="w-8 h-8 animate-spin text-navy-600 mx-auto mb-3" />
          <p className="text-sm font-medium text-navy-900">Creating Your Personalized Training Plan...</p>
          <p className="text-xs text-navy-700 mt-1">Analyzing your documentation patterns</p>
        </CardContent>
      </Card>
    );
  }

  if (!trainingPlan || trainingPlan.modules.length === 0) {
    return (
      <Card className="border-2 border-green-200 bg-green-50">
        <CardContent className="p-6 text-center">
          <Award className="w-10 h-10 text-green-600 mx-auto mb-3" />
          <h3 className="font-semibold text-green-900">Great Work!</h3>
          <p className="text-sm text-green-700 mt-1">No significant skill gaps identified. Keep up the excellent documentation!</p>
        </CardContent>
      </Card>
    );
  }

  const completedModules = trainingPlan.modules.filter(m => m.status === 'completed').length;
  const overallProgress = (completedModules / trainingPlan.modules.length) * 100;

  return (
    <Card className="border-2 border-navy-200">
      <CardHeader className="bg-gradient-to-r from-navy-50 to-gold-50">
        <CardTitle className="text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-navy-600" />
            Your Personalized Training Plan
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              <Clock className="w-3 h-3 mr-1" />
              {trainingPlan.totalDuration} min total
            </Badge>
          </div>
        </CardTitle>
        <div className="mt-2">
          <div className="flex justify-between text-xs text-slate-600 mb-1">
            <span>Overall Progress</span>
            <span>{completedModules}/{trainingPlan.modules.length} modules</span>
          </div>
          <Progress value={overallProgress} className="h-2" />
        </div>
      </CardHeader>
      
      <CardContent className="p-4 space-y-3">
        {trainingPlan.modules.map((module, idx) => {
          const isExpanded = expandedModules.has(idx);
          const progress = moduleProgress[idx] || 0;

          return (
            <Collapsible key={idx} open={isExpanded} onOpenChange={() => toggleModule(idx)}>
              <div className={`rounded-lg border ${
                module.status === 'completed' ? 'border-green-300 bg-green-50' :
                module.severity === 'high' ? 'border-red-200 bg-red-50' :
                'border-slate-200'
              }`}>
                <CollapsibleTrigger asChild>
                  <div className="p-3 cursor-pointer hover:bg-slate-50/50 transition-colors">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <Badge className="text-[10px]" variant="outline">#{idx + 1}</Badge>
                          <Badge className={`text-[10px] ${getSeverityColor(module.severity)}`}>
                            {module.issueCount} issues found
                          </Badge>
                          {module.status === 'completed' && (
                            <Badge className="bg-green-600 text-white text-[10px]">
                              <CheckCircle2 className="w-2.5 h-2.5 mr-1" /> Completed
                            </Badge>
                          )}
                        </div>
                        <h4 className="text-sm font-semibold text-slate-900">{module.title}</h4>
                        <p className="text-xs text-slate-600 mt-0.5">{module.description}</p>
                        <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" /> {module.duration} min
                          </span>
                          <span className="flex items-center gap-1">
                            <BookOpen className="w-3 h-3" /> {module.lessons.length} lessons
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {module.status !== 'completed' && (
                          <Button
                            size="sm"
                            className="h-7 text-xs bg-navy-600 hover:bg-navy-700"
                            onClick={(e) => {
                              e.stopPropagation();
                              onStartModule?.(module);
                            }}
                          >
                            <Play className="w-3 h-3 mr-1" /> Start
                          </Button>
                        )}
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </div>
                    </div>
                    {progress > 0 && progress < 100 && (
                      <Progress value={progress} className="h-1 mt-2" />
                    )}
                  </div>
                </CollapsibleTrigger>

                <CollapsibleContent>
                  <div className="px-3 pb-3 pt-0 border-t space-y-3">
                    {/* Key Points */}
                    <div className="mt-3 bg-blue-50 p-3 rounded-lg">
                      <p className="text-xs font-semibold text-blue-800 mb-2">Key Learning Points:</p>
                      <ul className="space-y-1">
                        {module.keyPoints.map((point, pidx) => (
                          <li key={pidx} className="text-xs text-blue-700 flex items-start gap-1">
                            <CheckCircle2 className="w-3 h-3 mt-0.5 flex-shrink-0 text-blue-500" />
                            {point}
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* Lessons */}
                    <div>
                      <p className="text-xs font-semibold text-slate-700 mb-2">Module Content:</p>
                      <div className="space-y-1">
                        {module.lessons.map((lesson, lidx) => (
                          <div
                            key={lidx}
                            className="flex items-center justify-between p-2 bg-white rounded border hover:bg-slate-50 cursor-pointer"
                            onClick={() => onStartModule?.({ ...module, startLesson: lidx })}
                          >
                            <div className="flex items-center gap-2">
                              <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
                                lesson.type === 'quiz' ? 'bg-navy-100 text-navy-600' :
                                lesson.type === 'practice' ? 'bg-green-100 text-green-600' :
                                'bg-blue-100 text-blue-600'
                              }`}>
                                {getLessonIcon(lesson.type)}
                              </div>
                              <span className="text-xs text-slate-700">{lesson.title}</span>
                            </div>
                            <Badge variant="outline" className="text-[10px]">
                              {lesson.duration} min
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          );
        })}
      </CardContent>
    </Card>
  );
}