import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Shield, CheckCircle, AlertTriangle, XCircle, Zap, TrendingUp } from "lucide-react";
import { toast } from "sonner";

export default function RealTimeComplianceScorer({ 
  noteContent, 
  vitalSigns, 
  visitType, 
  diagnosis,
  onFixSuggestion 
}) {
  const [complianceScore, setComplianceScore] = useState(0);
  const [requirements, setRequirements] = useState([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  useEffect(() => {
    const debounceTimer = setTimeout(() => {
      analyzeCompliance();
    }, 1000);

    return () => clearTimeout(debounceTimer);
  }, [noteContent, vitalSigns, visitType, diagnosis]);

  const analyzeCompliance = () => {
    const checks = [
      {
        id: 'chief_complaint',
        name: 'Chief Complaint Documented',
        required: true,
        category: 'medicare',
        met: noteContent?.toLowerCase().includes('complaint') || 
             noteContent?.toLowerCase().includes('reason for visit'),
        fix: 'Add patient\'s chief complaint or reason for visit',
        autoFix: '\n\nChief Complaint: [Patient reports...]'
      },
      {
        id: 'vital_signs',
        name: 'Vital Signs Recorded',
        required: true,
        category: 'medicare',
        met: vitalSigns && Object.keys(vitalSigns).length > 0,
        fix: 'Record vital signs (BP, HR, Temp, O2 Sat)',
        autoFix: null
      },
      {
        id: 'assessment',
        name: 'Clinical Assessment',
        required: true,
        category: 'medicare',
        met: noteContent?.toLowerCase().includes('assessment') ||
             noteContent?.toLowerCase().includes('patient condition'),
        fix: 'Document clinical assessment of patient condition',
        autoFix: '\n\nAssessment: Patient\'s current condition...'
      },
      {
        id: 'objective_findings',
        name: 'Objective Findings',
        required: true,
        category: 'medicare',
        met: noteContent?.toLowerCase().includes('observed') ||
             noteContent?.toLowerCase().includes('examination') ||
             noteContent?.toLowerCase().includes('findings'),
        fix: 'Include objective examination findings',
        autoFix: '\n\nObjective Findings: Upon examination...'
      },
      {
        id: 'plan_of_care',
        name: 'Plan of Care',
        required: true,
        category: 'medicare',
        met: noteContent?.toLowerCase().includes('plan') ||
             noteContent?.toLowerCase().includes('treatment') ||
             noteContent?.toLowerCase().includes('intervention'),
        fix: 'Document plan of care and interventions',
        autoFix: '\n\nPlan: Continue with...'
      },
      {
        id: 'patient_response',
        name: 'Patient Response to Treatment',
        required: true,
        category: 'medicare',
        met: noteContent?.toLowerCase().includes('patient tolerated') ||
             noteContent?.toLowerCase().includes('patient response') ||
             noteContent?.toLowerCase().includes('no adverse'),
        fix: 'Document patient\'s response to interventions',
        autoFix: '\n\nPatient Response: Patient tolerated interventions well...'
      },
      {
        id: 'skilled_need',
        name: 'Skilled Need Justification',
        required: visitType !== 'routine_visit',
        category: 'medicare',
        met: noteContent?.toLowerCase().includes('skilled') ||
             noteContent?.toLowerCase().includes('requires nursing') ||
             noteContent?.toLowerCase().includes('complex'),
        fix: 'Justify why skilled nursing is required',
        autoFix: '\n\nSkilled Need: Requires skilled nursing assessment and intervention due to...'
      },
      {
        id: 'homebound_status',
        name: 'Homebound Status',
        required: visitType === 'admission' || visitType === 'recertification',
        category: 'medicare',
        met: noteContent?.toLowerCase().includes('homebound') ||
             noteContent?.toLowerCase().includes('unable to leave home') ||
             noteContent?.toLowerCase().includes('confined'),
        fix: 'Document homebound status and limitations',
        autoFix: '\n\nHomebound Status: Patient is homebound due to...'
      },
      {
        id: 'safety_assessment',
        name: 'Safety Assessment',
        required: true,
        category: 'medicare',
        met: noteContent?.toLowerCase().includes('safety') ||
             noteContent?.toLowerCase().includes('fall risk') ||
             noteContent?.toLowerCase().includes('environment'),
        fix: 'Document home safety assessment',
        autoFix: '\n\nSafety Assessment: Home environment assessed for safety hazards...'
      },
      {
        id: 'medication_review',
        name: 'Medication Review/Reconciliation',
        required: true,
        category: 'medicare',
        met: noteContent?.toLowerCase().includes('medication') ||
             noteContent?.toLowerCase().includes('med review') ||
             noteContent?.toLowerCase().includes('compliance'),
        fix: 'Document medication review and compliance',
        autoFix: '\n\nMedication Review: Reviewed current medications with patient...'
      },
      {
        id: 'patient_education',
        name: 'Patient/Caregiver Education',
        required: true,
        category: 'medicare',
        met: noteContent?.toLowerCase().includes('education') ||
             noteContent?.toLowerCase().includes('teaching') ||
             noteContent?.toLowerCase().includes('instructed'),
        fix: 'Document education provided to patient/caregiver',
        autoFix: '\n\nPatient Education: Instructed patient/caregiver on...'
      },
      {
        id: 'phi_protection',
        name: 'PHI Protection (No identifiers in notes)',
        required: true,
        category: 'hipaa',
        met: !containsSensitiveIdentifiers(noteContent),
        fix: 'Remove specific PHI identifiers (SSN, account numbers)',
        autoFix: null
      },
      {
        id: 'progress_toward_goals',
        name: 'Progress Toward Goals',
        required: visitType !== 'admission',
        category: 'medicare',
        met: noteContent?.toLowerCase().includes('progress') ||
             noteContent?.toLowerCase().includes('goal') ||
             noteContent?.toLowerCase().includes('improved'),
        fix: 'Document progress toward care plan goals',
        autoFix: '\n\nProgress: Patient shows [improvement/decline] in...'
      }
    ];

    const applicableChecks = checks.filter(c => c.required);
    const metChecks = applicableChecks.filter(c => c.met);
    const score = Math.round((metChecks.length / applicableChecks.length) * 100);

    setComplianceScore(score);
    setRequirements(applicableChecks);
  };

  const containsSensitiveIdentifiers = (text) => {
    if (!text) return false;
    const ssnPattern = /\b\d{3}-\d{2}-\d{4}\b/;
    const accountPattern = /\baccount\s*#?\s*\d{6,}\b/i;
    return ssnPattern.test(text) || accountPattern.test(text);
  };

  const applyQuickFix = (requirement) => {
    if (requirement.autoFix && onFixSuggestion) {
      onFixSuggestion(requirement.autoFix);
      toast.success(`Added ${requirement.name} template`);
    } else {
      toast.info(requirement.fix);
    }
  };

  const getScoreColor = (score) => {
    if (score >= 90) return 'text-green-600';
    if (score >= 75) return 'text-yellow-600';
    if (score >= 60) return 'text-orange-600';
    return 'text-red-600';
  };

  const getScoreGradient = (score) => {
    if (score >= 90) return 'from-green-500 to-emerald-500';
    if (score >= 75) return 'from-yellow-500 to-amber-500';
    if (score >= 60) return 'from-orange-500 to-red-500';
    return 'from-red-500 to-rose-500';
  };

  const getMissingRequirements = () => requirements.filter(r => !r.met);
  const getMetRequirements = () => requirements.filter(r => r.met);

  return (
    <Card className="border-blue-200 sticky top-4">
      <CardHeader className="pb-3 bg-gradient-to-r from-blue-50 to-indigo-50">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-blue-600" />
            Live Compliance Score
          </span>
          <Badge variant="outline" className="text-xs">
            Real-time
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        {/* Score Display */}
        <div className="text-center space-y-2">
          <div className={`text-5xl font-bold ${getScoreColor(complianceScore)}`}>
            {complianceScore}%
          </div>
          <Progress 
            value={complianceScore} 
            className={`h-3 bg-gradient-to-r ${getScoreGradient(complianceScore)}`}
          />
          <p className="text-xs text-gray-600">
            {getMetRequirements().length} of {requirements.length} requirements met
          </p>
        </div>

        {/* Status Alert */}
        {complianceScore >= 90 && (
          <Alert className="border-green-200 bg-green-50">
            <CheckCircle className="w-4 h-4 text-green-600" />
            <AlertDescription className="text-green-900 text-xs">
              <strong>Excellent!</strong> Documentation meets Medicare compliance standards.
            </AlertDescription>
          </Alert>
        )}
        
        {complianceScore < 90 && complianceScore >= 75 && (
          <Alert className="border-yellow-200 bg-yellow-50">
            <AlertTriangle className="w-4 h-4 text-yellow-600" />
            <AlertDescription className="text-yellow-900 text-xs">
              <strong>Good progress.</strong> Add missing elements to reach full compliance.
            </AlertDescription>
          </Alert>
        )}

        {complianceScore < 75 && (
          <Alert className="border-red-200 bg-red-50">
            <AlertTriangle className="w-4 h-4 text-red-600" />
            <AlertDescription className="text-red-900 text-xs">
              <strong>Needs attention.</strong> Multiple required elements missing.
            </AlertDescription>
          </Alert>
        )}

        {/* Missing Requirements */}
        {getMissingRequirements().length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-gray-700 flex items-center gap-1">
              <XCircle className="w-3 h-3 text-red-500" />
              Missing Requirements:
            </h4>
            <div className="space-y-1.5">
              {getMissingRequirements().map(req => (
                <div key={req.id} className="bg-red-50 rounded p-2 border border-red-100">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-red-900">{req.name}</p>
                      <p className="text-xs text-red-700 mt-0.5">{req.fix}</p>
                    </div>
                    {req.autoFix && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => applyQuickFix(req)}
                        className="flex-shrink-0 h-6 px-2 text-xs border-red-200 hover:bg-red-100"
                      >
                        <Zap className="w-3 h-3 mr-1" />
                        Fix
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Met Requirements (Collapsible) */}
        {getMetRequirements().length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-gray-600 font-medium flex items-center gap-1">
              <CheckCircle className="w-3 h-3 text-green-500" />
              Completed ({getMetRequirements().length})
            </summary>
            <div className="mt-2 space-y-1">
              {getMetRequirements().map(req => (
                <div key={req.id} className="flex items-center gap-2 text-green-700 pl-4">
                  <CheckCircle className="w-3 h-3" />
                  <span>{req.name}</span>
                </div>
              ))}
            </div>
          </details>
        )}

        {/* Category Breakdown */}
        <div className="pt-3 border-t space-y-2">
          <div className="flex justify-between items-center text-xs">
            <span className="text-gray-600">Medicare Requirements:</span>
            <Badge variant="outline" className="text-xs">
              {requirements.filter(r => r.category === 'medicare' && r.met).length}/{requirements.filter(r => r.category === 'medicare').length}
            </Badge>
          </div>
          <div className="flex justify-between items-center text-xs">
            <span className="text-gray-600">HIPAA Compliance:</span>
            <Badge variant="outline" className="text-xs">
              {requirements.filter(r => r.category === 'hipaa' && r.met).length}/{requirements.filter(r => r.category === 'hipaa').length}
            </Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}