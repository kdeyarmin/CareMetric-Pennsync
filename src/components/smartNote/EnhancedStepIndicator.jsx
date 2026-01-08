import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  User,
  Activity,
  Edit3,
  Sparkles,
  CheckCircle2,
  Circle,
  ArrowRight,
  AlertCircle,
  ChevronRight,
  Lightbulb
} from "lucide-react";

export default function EnhancedStepIndicator({ 
  currentStep, 
  completedSteps,
  onStepClick,
  patientName,
  vitalStats,
  noteLength,
  complianceScore,
  criticalGaps = [],
  vitalAlerts = [],
  roughNote = ""
}) {
  // Analyze current context to provide intelligent guidance
  const getContextualGuidance = () => {
    // Analyze vital signs for alerts
    if (currentStep === 'vitals' && vitalStats) {
      const alerts = [];
      if (vitalStats.includes('BP:') && vitalStats.includes('/')) {
        const bpMatch = vitalStats.match(/BP:\s*(\d+)\/(\d+)/);
        if (bpMatch) {
          const systolic = parseInt(bpMatch[1]);
          const diastolic = parseInt(bpMatch[2]);
          if (systolic > 140 || systolic < 90) {
            alerts.push(`⚠️ BP ${systolic}/${diastolic} - Document in note`);
          }
        }
      }
      return alerts.length > 0 ? alerts[0] : null;
    }

    // Analyze rough note for critical gaps
    if (currentStep === 'notes' && roughNote.length >= 50) {
      const content = roughNote.toLowerCase();
      if (!content.includes('homebound') && !content.includes('taxing')) {
        return "⚠️ Missing homebound status - required for Medicare";
      }
      if (!content.includes('skilled') && roughNote.length > 100) {
        return "⚠️ Add skilled need justification";
      }
    }

    // Enhancement step guidance
    if (currentStep === 'enhance' && criticalGaps.length > 0) {
      return `🚨 ${criticalGaps.length} critical gap${criticalGaps.length > 1 ? 's' : ''} to address`;
    }

    return null;
  };

  const contextGuidance = getContextualGuidance();

  const steps = [
    {
      id: 'patient',
      label: 'Patient',
      icon: User,
      description: patientName || 'Select patient',
      color: 'blue',
      guidance: currentStep === 'patient' ? 'Choose patient or use anonymous mode' : null
    },
    {
      id: 'vitals',
      label: 'Vitals',
      icon: Activity,
      description: vitalStats || 'Enter vital signs',
      color: 'green',
      guidance: currentStep === 'vitals' && !vitalStats ? 'Quick entry for BP, HR, Temp, O2' : contextGuidance
    },
    {
      id: 'notes',
      label: 'Documentation',
      icon: Edit3,
      description: noteLength ? `${noteLength} characters` : 'Type or dictate notes',
      color: 'purple',
      guidance: currentStep === 'notes' ? (
        noteLength < 20 ? 'Min 20 characters - use voice or type' :
        noteLength < 100 ? 'Add skilled interventions and patient response' :
        contextGuidance || 'Looking good! Ready to enhance when complete'
      ) : null
    },
    {
      id: 'enhance',
      label: 'AI Enhancement',
      icon: Sparkles,
      description: complianceScore ? `${complianceScore}% compliant` : 'Transform to Medicare-compliant',
      color: 'indigo',
      guidance: currentStep === 'enhance' && !complianceScore ? 
        (criticalGaps.length > 0 ? `Address ${criticalGaps[0]?.element || 'critical gaps'} first` : 'Click Enhance to transform your note') :
        null
    }
  ];

  const stepIndex = steps.findIndex(s => s.id === currentStep);

  const getStepStatus = (step) => {
    if (completedSteps.includes(step.id)) return 'completed';
    if (step.id === currentStep) return 'active';
    return 'upcoming';
  };

  const getStepColor = (step) => {
    const status = getStepStatus(step);
    if (status === 'completed') return 'bg-green-500 border-green-500';
    if (status === 'active') return `bg-${step.color}-500 border-${step.color}-500`;
    return 'bg-gray-300 border-gray-300';
  };

  const getTextColor = (step) => {
    const status = getStepStatus(step);
    if (status === 'completed') return 'text-green-700';
    if (status === 'active') return `text-${step.color}-700`;
    return 'text-gray-500';
  };

  return (
    <Card className="border-2 border-indigo-200 bg-gradient-to-r from-indigo-50 via-purple-50 to-pink-50">
      <CardContent className="p-4">
        {/* Desktop View */}
        <div className="hidden md:flex items-center justify-between">
          {steps.map((step, idx) => {
            const status = getStepStatus(step);
            const isClickable = status === 'completed' || status === 'active';
            const StepIcon = step.icon;

            return (
              <React.Fragment key={step.id}>
                <div className="flex-1">
                  <div
                    className={`flex items-center gap-3 p-3 rounded-lg transition-all ${
                      status === 'active' ? 'bg-white shadow-md ring-2 ring-indigo-400' : ''
                    } ${isClickable ? 'cursor-pointer hover:bg-white/70' : 'cursor-not-allowed'}`}
                    onClick={() => isClickable && onStepClick(step.id)}
                  >
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${getStepColor(step)} transition-all`}>
                      {status === 'completed' ? (
                        <CheckCircle2 className="w-6 h-6 text-white" />
                      ) : status === 'active' ? (
                        <StepIcon className="w-5 h-5 text-white animate-pulse" />
                      ) : (
                        <Circle className="w-5 h-5 text-white" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className={`text-sm font-semibold ${getTextColor(step)}`}>
                          {step.label}
                        </p>
                        {status === 'active' && (
                          <Badge className="bg-indigo-100 text-indigo-700 text-xs">
                            Current
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-gray-600 truncate">
                        {step.description}
                      </p>
                      {status === 'active' && step.guidance && (
                        <p className="text-xs text-indigo-600 font-medium mt-1 flex items-start gap-1">
                          <Lightbulb className="w-3 h-3 flex-shrink-0 mt-0.5" />
                          <span>{step.guidance}</span>
                        </p>
                      )}
                    </div>
                  </div>
                </div>
                {idx < steps.length - 1 && (
                  <ChevronRight className={`w-5 h-5 mx-2 ${
                    completedSteps.includes(steps[idx + 1].id) ? 'text-green-500' :
                    currentStep === steps[idx + 1].id ? 'text-indigo-500' :
                    'text-gray-300'
                  }`} />
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* Mobile View */}
        <div className="md:hidden space-y-3">
          <div className="flex items-center gap-2 mb-3">
            <div className="flex-1 bg-gray-200 rounded-full h-2">
              <div 
                className="bg-gradient-to-r from-indigo-500 to-purple-500 h-2 rounded-full transition-all duration-500"
                style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }}
              />
            </div>
            <span className="text-xs font-semibold text-gray-600">
              {stepIndex + 1}/{steps.length}
            </span>
          </div>

          {steps.map((step) => {
            const status = getStepStatus(step);
            const isClickable = status === 'completed' || status === 'active';
            const StepIcon = step.icon;

            if (status === 'upcoming') return null;

            return (
              <div
                key={step.id}
                className={`flex items-center gap-3 p-3 rounded-lg transition-all ${
                  status === 'active' ? 'bg-white shadow-md ring-2 ring-indigo-400' : 'bg-white/50'
                } ${isClickable ? 'cursor-pointer' : ''}`}
                onClick={() => isClickable && onStepClick(step.id)}
              >
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${getStepColor(step)}`}>
                  {status === 'completed' ? (
                    <CheckCircle2 className="w-6 h-6 text-white" />
                  ) : (
                    <StepIcon className="w-5 h-5 text-white" />
                  )}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className={`text-sm font-semibold ${getTextColor(step)}`}>
                      {step.label}
                    </p>
                    {status === 'active' && (
                      <Badge className="bg-indigo-100 text-indigo-700 text-xs">
                        Current
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-gray-600">{step.description}</p>
                  {status === 'active' && step.guidance && (
                    <p className="text-xs text-indigo-600 font-medium mt-1 flex items-start gap-1">
                      <Lightbulb className="w-3 h-3 flex-shrink-0 mt-0.5" />
                      <span>{step.guidance}</span>
                    </p>
                  )}
                </div>
              </div>
            );
          })}

          {/* Show next step hint */}
          {stepIndex < steps.length - 1 && (
            <div className="flex items-center gap-2 p-2 bg-blue-50 rounded-lg border border-blue-200">
              <AlertCircle className="w-4 h-4 text-blue-600 flex-shrink-0" />
              <p className="text-xs text-blue-800">
                <strong>Next:</strong> {steps[stepIndex + 1].label} - {steps[stepIndex + 1].description}
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}