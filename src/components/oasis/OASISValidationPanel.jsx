import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import {
  ShieldCheck,
  AlertTriangle,
  XCircle,
  CheckCircle2,
  ArrowRight,
  Info,
  Clock,
  Building2,
  FileText,
  Activity,
  AlertCircle
} from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export default function OASISValidationPanel({ pdgmData, analysisResults }) {
  if (!pdgmData) return null;

  const validationChecks = performValidationChecks(pdgmData, analysisResults);
  const { totalChecks, passedChecks, criticalIssues, warningIssues, infoIssues } = validationChecks.summary;
  const validationScore = totalChecks > 0
    ? Math.min(100, Math.max(0, Math.round((passedChecks / totalChecks) * 100)))
    : 100;

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return 'text-red-700 bg-red-100 border-red-300';
      case 'high': return 'text-orange-700 bg-orange-100 border-orange-300';
      case 'medium': return 'text-yellow-700 bg-yellow-100 border-yellow-300';
      case 'low': return 'text-blue-700 bg-blue-100 border-blue-300';
      default: return 'text-slate-700 bg-slate-100 border-slate-300';
    }
  };

  const getSeverityIcon = (severity) => {
    switch (severity) {
      case 'critical': return <XCircle className="w-4 h-4" />;
      case 'high': return <AlertTriangle className="w-4 h-4" />;
      case 'medium': return <AlertCircle className="w-4 h-4" />;
      case 'low': return <Info className="w-4 h-4" />;
      default: return <Info className="w-4 h-4" />;
    }
  };

  return (
    <Card className="border-2 border-navy-200">
      <CardHeader className="pb-3 bg-gradient-to-r from-navy-50 to-indigo-50">
        <CardTitle className="text-lg flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-navy-600" />
            OASIS Validation Report
          </div>
          <div className="flex items-center gap-2">
            <Badge className={`text-lg px-3 py-1 ${
              validationScore >= 90 ? 'bg-green-600' :
              validationScore >= 70 ? 'bg-yellow-600' :
              'bg-red-600'
            } text-white`}>
              {validationScore}%
            </Badge>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {/* Summary Stats */}
        <div className="grid grid-cols-4 gap-3">
          <div className="p-3 bg-green-50 rounded-lg border border-green-200 text-center">
            <CheckCircle2 className="w-5 h-5 text-green-600 mx-auto mb-1" />
            <p className="text-2xl font-bold text-green-700">{passedChecks}</p>
            <p className="text-xs text-green-600">Passed</p>
          </div>
          <div className="p-3 bg-red-50 rounded-lg border border-red-200 text-center">
            <XCircle className="w-5 h-5 text-red-600 mx-auto mb-1" />
            <p className="text-2xl font-bold text-red-700">{criticalIssues}</p>
            <p className="text-xs text-red-600">Critical</p>
          </div>
          <div className="p-3 bg-yellow-50 rounded-lg border border-yellow-200 text-center">
            <AlertTriangle className="w-5 h-5 text-yellow-600 mx-auto mb-1" />
            <p className="text-2xl font-bold text-yellow-700">{warningIssues}</p>
            <p className="text-xs text-yellow-600">Warnings</p>
          </div>
          <div className="p-3 bg-blue-50 rounded-lg border border-blue-200 text-center">
            <Info className="w-5 h-5 text-blue-600 mx-auto mb-1" />
            <p className="text-2xl font-bold text-blue-700">{infoIssues}</p>
            <p className="text-xs text-blue-600">Info</p>
          </div>
        </div>

        {/* Validation Score Progress */}
        <div className="bg-white p-4 rounded-lg border">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-slate-700">Validation Score</span>
            <span className="text-sm text-slate-600">{passedChecks} of {totalChecks} checks passed</span>
          </div>
          <Progress value={validationScore} className="h-3" />
        </div>

        {/* Validation Issues by Category */}
        {validationChecks.categories.length > 0 && (
          <Accordion type="multiple" className="space-y-2">
            {validationChecks.categories.map((category, idx) => (
              <AccordionItem key={idx} value={`category-${idx}`} className="border rounded-lg">
                <AccordionTrigger className="px-4 py-3 hover:no-underline">
                  <div className="flex items-center justify-between w-full pr-4">
                    <div className="flex items-center gap-2">
                      {category.icon}
                      <span className="font-medium">{category.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {category.issues.length > 0 ? (
                        <Badge className="bg-red-100 text-red-800">
                          {category.issues.length} issues
                        </Badge>
                      ) : (
                        <Badge className="bg-green-100 text-green-800">
                          <CheckCircle2 className="w-3 h-3 mr-1" />
                          Valid
                        </Badge>
                      )}
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  {category.issues.length === 0 ? (
                    <div className="text-center py-4 text-green-600">
                      <CheckCircle2 className="w-6 h-6 mx-auto mb-2" />
                      <p className="text-sm">All checks passed for this category</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {category.issues.map((issue, issueIdx) => (
                        <div key={issueIdx} className={`p-3 rounded-lg border-2 ${getSeverityColor(issue.severity)}`}>
                          <div className="flex items-start gap-2">
                            {getSeverityIcon(issue.severity)}
                            <div className="flex-1">
                              <div className="flex items-center justify-between mb-1">
                                <p className="text-sm font-semibold">{issue.title}</p>
                                <Badge variant="outline" className="text-xs">
                                  {issue.severity}
                                </Badge>
                              </div>
                              <p className="text-sm mb-2">{issue.message}</p>
                              
                              {issue.fields && issue.fields.length > 0 && (
                                <div className="bg-white/50 p-2 rounded mb-2">
                                  <p className="text-xs font-medium mb-1">Affected Fields:</p>
                                  <div className="flex flex-wrap gap-1">
                                    {issue.fields.map((field, fIdx) => (
                                      <span key={fIdx} className="text-xs font-mono bg-white px-2 py-0.5 rounded border">
                                        {field}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {issue.comparison && (
                                <div className="flex items-center gap-2 text-xs mb-2">
                                  <span className="bg-white/50 px-2 py-1 rounded">
                                    <strong>Expected:</strong> {issue.comparison.expected}
                                  </span>
                                  <ArrowRight className="w-3 h-3" />
                                  <span className="bg-white/50 px-2 py-1 rounded">
                                    <strong>Found:</strong> {issue.comparison.actual}
                                  </span>
                                </div>
                              )}

                              {issue.recommendation && (
                                <div className="bg-blue-50 border border-blue-200 p-2 rounded mt-2">
                                  <p className="text-xs">
                                    <strong className="text-blue-700">Recommendation:</strong> {issue.recommendation}
                                  </p>
                                </div>
                              )}

                              {issue.impact && (
                                <p className="text-xs mt-2 italic">
                                  <strong>Impact:</strong> {issue.impact}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}

        {/* Overall Status */}
        {criticalIssues === 0 && warningIssues === 0 ? (
          <Alert className="bg-green-50 border-green-200">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            <AlertDescription className="text-green-800">
              <strong>Excellent!</strong> All validation checks passed. This OASIS assessment is ready for submission.
            </AlertDescription>
          </Alert>
        ) : (
          <Alert className="bg-orange-50 border-orange-200">
            <AlertTriangle className="w-4 h-4 text-orange-600" />
            <AlertDescription className="text-orange-800">
              {criticalIssues > 0 && (
                <p className="mb-1">
                  <strong>{criticalIssues} critical issue{criticalIssues > 1 ? 's' : ''}</strong> must be resolved before submission.
                </p>
              )}
              {warningIssues > 0 && (
                <p>
                  {warningIssues} warning{warningIssues > 1 ? 's' : ''} detected that may affect PDGM payment accuracy.
                </p>
              )}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

function performValidationChecks(pdgmData, _analysisResults) {
  const _checks = [];
  
  // Category 1: Admission Source & Timing Validation
  const admissionChecks = validateAdmissionSourceTiming(pdgmData);
  
  // Category 2: Diagnosis Validation
  const diagnosisChecks = validateDiagnosis(pdgmData);
  
  // Category 3: Functional Status Validation
  const functionalChecks = validateFunctionalStatus(pdgmData);
  
  // Category 4: Clinical Consistency
  const clinicalChecks = validateClinicalConsistency(pdgmData);
  
  // Category 5: Date Validation
  const dateChecks = validateDates(pdgmData);

  const categories = [
    {
      name: "Admission Source & Episode Timing",
      icon: <Building2 className="w-4 h-4 text-navy-600" />,
      issues: admissionChecks
    },
    {
      name: "Diagnosis Documentation",
      icon: <FileText className="w-4 h-4 text-blue-600" />,
      issues: diagnosisChecks
    },
    {
      name: "Functional Status Assessment",
      icon: <Activity className="w-4 h-4 text-green-600" />,
      issues: functionalChecks
    },
    {
      name: "Clinical Consistency",
      icon: <ShieldCheck className="w-4 h-4 text-indigo-600" />,
      issues: clinicalChecks
    },
    {
      name: "Date & Timeline Validation",
      icon: <Clock className="w-4 h-4 text-orange-600" />,
      issues: dateChecks
    }
  ];

  const allIssues = [...admissionChecks, ...diagnosisChecks, ...functionalChecks, ...clinicalChecks, ...dateChecks];
  // Baseline of 15 expected checks, but a single assessment can surface more than
  // 15 issues; never let the denominator be exceeded (which produced negative
  // "passed" counts and a negative validation score).
  const BASELINE_CHECKS = 15;
  const totalChecks = Math.max(BASELINE_CHECKS, allIssues.length);
  const passedChecks = Math.max(0, totalChecks - allIssues.length);
  
  const criticalIssues = allIssues.filter(i => i.severity === 'critical').length;
  const warningIssues = allIssues.filter(i => i.severity === 'high' || i.severity === 'medium').length;
  const infoIssues = allIssues.filter(i => i.severity === 'low').length;

  return {
    categories: categories.filter(c => c.issues.length > 0 || true), // Show all categories
    summary: {
      totalChecks,
      passedChecks,
      criticalIssues,
      warningIssues,
      infoIssues
    }
  };
}

function validateAdmissionSourceTiming(data) {
  const issues = [];
  
  // Check M1000 vs admission_source
  const m1000 = data.m1000_from_where_admitted || data.admission_info?.m1000_from_where_admitted;
  const admissionSource = (data.admission_source || '').toLowerCase();
  
  if (m1000) {
    const m1000Val = String(m1000).trim();
    let expectedSource = 'community';
    
    if (['2', '3', '4'].includes(m1000Val) || 
        m1000Val.toLowerCase().includes('hospital') || 
        m1000Val.toLowerCase().includes('snf')) {
      expectedSource = 'institutional';
    }
    
    if (expectedSource !== admissionSource) {
      issues.push({
        severity: 'high',
        title: 'Admission Source Mismatch',
        message: `M1000 indicates ${expectedSource} admission, but ${admissionSource} is documented`,
        fields: ['M1000', 'admission_source'],
        comparison: {
          expected: expectedSource,
          actual: admissionSource
        },
        recommendation: `Review M1000 response and update admission source to ${expectedSource} if appropriate`,
        impact: `${expectedSource === 'institutional' ? 'Institutional' : 'Community'} admission affects PDGM payment by 5-10%`
      });
    }
  }
  
  // Check M1005 vs admission_source
  const m1005 = data.m1005_inpatient_discharge_date || data.admission_info?.m1005_inpatient_discharge_date;
  if (m1005 && admissionSource === 'community') {
    issues.push({
      severity: 'critical',
      title: 'Inpatient Discharge Date Conflict',
      message: 'M1005 (Inpatient Discharge Date) is present but admission source is documented as community',
      fields: ['M1005', 'admission_source'],
      comparison: {
        expected: 'institutional',
        actual: 'community'
      },
      recommendation: 'If patient was discharged from inpatient facility, change admission source to institutional',
      impact: 'This could result in significant payment undercoding (10-15% revenue loss)'
    });
  }
  
  // Check M0110 vs episode_timing
  const m0110 = data.m0110_episode_timing || data.admission_info?.m0110_episode_timing;
  const episodeTiming = (data.episode_timing || '').toLowerCase();
  
  if (m0110) {
    const m0110Val = String(m0110).toLowerCase();
    let expectedTiming = 'early';
    
    if (m0110Val.includes('2') || m0110Val.includes('late')) {
      expectedTiming = 'late';
    }
    
    if (expectedTiming !== episodeTiming) {
      issues.push({
        severity: 'high',
        title: 'Episode Timing Mismatch',
        message: `M0110 indicates ${expectedTiming} episode, but ${episodeTiming} is documented`,
        fields: ['M0110', 'episode_timing'],
        comparison: {
          expected: expectedTiming,
          actual: episodeTiming
        },
        recommendation: `Verify episode timing - late episodes typically occur after day 30`,
        impact: 'Episode timing affects payment by approximately 8%'
      });
    }
  }
  
  return issues;
}

function validateDiagnosis(data) {
  const issues = [];
  
  const diagnosisCode = data.primary_diagnosis_code || '';
  const diagnosisDescription = data.primary_diagnosis || data.primary_diagnosis_description || '';
  
  // Check for missing diagnosis
  if (!diagnosisCode && !diagnosisDescription) {
    issues.push({
      severity: 'critical',
      title: 'Missing Primary Diagnosis',
      message: 'No primary diagnosis code or description found',
      fields: ['primary_diagnosis_code', 'primary_diagnosis'],
      recommendation: 'Document the primary diagnosis with valid ICD-10-CM code',
      impact: 'Primary diagnosis is required for PDGM clinical grouping'
    });
  }
  
  // Validate ICD-10 code format
  if (diagnosisCode) {
    const cleanCode = diagnosisCode.toUpperCase().replace(/[^A-Z0-9.]/g, '');
    const validFormat = /^[A-Z]\d{2}\.?\d{0,4}$/.test(cleanCode);
    
    if (!validFormat) {
      issues.push({
        severity: 'medium',
        title: 'Invalid Diagnosis Code Format',
        message: `Diagnosis code "${diagnosisCode}" does not match ICD-10-CM format`,
        fields: ['primary_diagnosis_code'],
        comparison: {
          expected: 'ICD-10-CM format (e.g., I50.9)',
          actual: diagnosisCode
        },
        recommendation: 'Verify and correct the ICD-10-CM code format',
        impact: 'Invalid codes may be rejected by Medicare or affect clinical grouping'
      });
    }
  }
  
  // Check for comorbidity documentation
  const comorbidities = data.comorbidities || [];
  if (comorbidities.length === 0) {
    issues.push({
      severity: 'low',
      title: 'No Comorbidities Documented',
      message: 'No secondary diagnoses or comorbidities found',
      fields: ['comorbidities'],
      recommendation: 'Review patient chart and document all relevant comorbidities - they can increase PDGM payment',
      impact: 'Comorbidities can increase payment by 2-8%'
    });
  }
  
  return issues;
}

function validateFunctionalStatus(data) {
  const issues = [];
  const functionalScores = data.functional_scores || {};
  
  const requiredItems = [
    { key: 'm1800_grooming', name: 'M1800 (Grooming)', max: 3 },
    { key: 'm1810_dress_upper', name: 'M1810 (Dress Upper)', max: 3 },
    { key: 'm1820_dress_lower', name: 'M1820 (Dress Lower)', max: 3 },
    { key: 'm1830_bathing', name: 'M1830 (Bathing)', max: 6 },
    { key: 'm1840_toilet_transfer', name: 'M1840 (Toilet Transfer)', max: 4 },
    { key: 'm1850_transferring', name: 'M1850 (Transferring)', max: 5 },
    { key: 'm1860_ambulation', name: 'M1860 (Ambulation)', max: 6 }
  ];
  
  const missingItems = [];
  const invalidScores = [];
  
  requiredItems.forEach(item => {
    const score = functionalScores[item.key];
    
    if (score === undefined || score === null || score === '') {
      missingItems.push(item.name);
    } else {
      const numScore = parseInt(score);
      if (isNaN(numScore) || numScore < 0 || numScore > item.max) {
        invalidScores.push({
          item: item.name,
          score: score,
          max: item.max
        });
      }
    }
  });
  
  if (missingItems.length > 0) {
    issues.push({
      severity: 'critical',
      title: 'Missing Functional Assessment Items',
      message: `${missingItems.length} required functional items are missing`,
      fields: missingItems,
      recommendation: 'Complete all required ADL assessment items (M1800-M1860)',
      impact: 'Functional status is critical for PDGM payment calculation'
    });
  }
  
  if (invalidScores.length > 0) {
    issues.push({
      severity: 'high',
      title: 'Invalid Functional Scores',
      message: `${invalidScores.length} functional items have out-of-range scores`,
      fields: invalidScores.map(i => i.item),
      recommendation: 'Review and correct functional assessment scores to valid ranges',
      impact: 'Invalid scores will be rejected or defaulted to 0'
    });
  }
  
  return issues;
}

function validateClinicalConsistency(data) {
  const issues = [];
  
  // Check for therapy needs vs functional scores
  const functionalScores = data.functional_scores || {};
  const therapyServices = data.therapy_services || [];
  
  const highFunctionalImpairment = 
    (parseInt(functionalScores.m1860_ambulation) || 0) >= 4 ||
    (parseInt(functionalScores.m1850_transferring) || 0) >= 3;
  
  const hasTherapy = therapyServices.length > 0 || 
    data.primary_diagnosis?.toLowerCase().includes('therapy') ||
    data.primary_diagnosis?.toLowerCase().includes('rehab');
  
  if (highFunctionalImpairment && !hasTherapy) {
    issues.push({
      severity: 'medium',
      title: 'Potential Therapy Need Not Documented',
      message: 'High functional impairment detected but no therapy services documented',
      fields: ['therapy_services', 'M1860', 'M1850'],
      recommendation: 'Consider if patient would benefit from PT/OT services',
      impact: 'Therapy needs can affect clinical grouping and payment'
    });
  }
  
  return issues;
}

function validateDates(data) {
  const issues = [];
  
  const socDate = data.soc_date || data.patient_info?.soc_date || data.m0102_soc_roc_date;
  const assessmentDate = data.assessment_date || data.patient_info?.assessment_date;
  
  if (socDate && assessmentDate) {
    try {
      const soc = new Date(socDate);
      const assessment = new Date(assessmentDate);
      
      if (assessment < soc) {
        issues.push({
          severity: 'critical',
          title: 'Assessment Date Before SOC Date',
          message: 'Assessment date cannot be before Start of Care date',
          fields: ['assessment_date', 'soc_date'],
          comparison: {
            expected: `On or after ${socDate}`,
            actual: assessmentDate
          },
          recommendation: 'Verify and correct the assessment date',
          impact: 'Date conflicts will cause claim rejection'
        });
      }
      
      const daysDiff = Math.floor((assessment - soc) / (1000 * 60 * 60 * 24));
      
      if (daysDiff > 5 && data.assessment_type?.toLowerCase().includes('soc')) {
        issues.push({
          severity: 'medium',
          title: 'Late SOC Assessment',
          message: `SOC assessment completed ${daysDiff} days after admission`,
          fields: ['assessment_date', 'soc_date'],
          recommendation: 'SOC assessments should ideally be completed within 5 days',
          impact: 'Late assessments may not capture initial patient status accurately'
        });
      }
    } catch {
      issues.push({
        severity: 'low',
        title: 'Invalid Date Format',
        message: 'Unable to parse dates for validation',
        fields: ['assessment_date', 'soc_date'],
        recommendation: 'Ensure dates are in valid format (YYYY-MM-DD)',
        impact: 'Date validation could not be performed'
      });
    }
  }
  
  return issues;
}