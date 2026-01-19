import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { 
  Loader2, 
  BookOpen, 
  FileText, 
  CheckCircle2, 
  AlertTriangle,
  TrendingUp,
  Pill,
  Lightbulb,
  ExternalLink,
  Copy,
  Download,
  Star,
  Code
} from 'lucide-react';
import { toast } from 'sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ClinicalCodeSuggestionPanel from '../billing/ClinicalCodeSuggestionPanel';

export default function EvidenceBasedClinicalReasoning({ 
  patientId,
  initialNote = '',
  onReportGenerated
}) {
  const [clinicalNote, setClinicalNote] = useState(initialNote);
  const [clinicalQuestion, setClinicalQuestion] = useState('');
  const [generating, setGenerating] = useState(false);
  const [report, setReport] = useState(null);

  // Evidence retrieval parameters
  const [specialty, setSpecialty] = useState('');
  const [authorityLevel, setAuthorityLevel] = useState('high');
  const [yearStart, setYearStart] = useState(2020);
  const [yearEnd, setYearEnd] = useState(new Date().getFullYear());
  const [includeDrugInfo, setIncludeDrugInfo] = useState(true);
  const [includeCommunityInsights, setIncludeCommunityInsights] = useState(true);
  
  const [selectedArticleTypes, setSelectedArticleTypes] = useState([
    'practice_guidelines',
    'meta_analyses',
    'randomized_controlled_trials'
  ]);

  const specialties = [
    'General Medicine', 'Cardiology', 'Pulmonology', 'Gastroenterology',
    'Nephrology', 'Endocrinology', 'Neurology', 'Psychiatry',
    'Oncology', 'Infectious Disease', 'Rheumatology', 'Orthopedics'
  ];

  const articleTypes = [
    { value: 'practice_guidelines', label: 'Practice Guidelines' },
    { value: 'meta_analyses', label: 'Meta-Analyses' },
    { value: 'randomized_controlled_trials', label: 'Randomized Controlled Trials' },
    { value: 'cohort_studies', label: 'Cohort Studies' },
    { value: 'case_control_studies', label: 'Case-Control Studies' },
    { value: 'review_articles', label: 'Review Articles' }
  ];

  const toggleArticleType = (type) => {
    setSelectedArticleTypes(prev =>
      prev.includes(type)
        ? prev.filter(t => t !== type)
        : [...prev, type]
    );
  };

  const generateReport = async () => {
    if (!clinicalNote.trim() && !clinicalQuestion.trim()) {
      toast.error('Please enter a clinical note or question');
      return;
    }

    setGenerating(true);
    try {
      const response = await base44.functions.invoke('generateEvidenceBasedReport', {
        clinical_note: clinicalNote,
        clinical_question: clinicalQuestion,
        patient_id: patientId,
        specialty,
        authority_level: authorityLevel,
        year_range_start: yearStart,
        year_range_end: yearEnd,
        article_types: selectedArticleTypes,
        include_drug_info: includeDrugInfo,
        include_community_insights: includeCommunityInsights
      });

      if (response.data?.success) {
        setReport(response.data.report);
        onReportGenerated?.(response.data.report);
        toast.success('Evidence-based report generated');
      } else {
        toast.error('Failed to generate report');
      }
    } catch (error) {
      console.error('Error generating report:', error);
      toast.error('Error generating report');
    } finally {
      setGenerating(false);
    }
  };

  const getQualityColor = (score) => {
    if (score >= 8) return 'text-green-600 dark:text-green-400';
    if (score >= 6) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-orange-600 dark:text-orange-400';
  };

  const getLikelihoodColor = (likelihood) => {
    switch (likelihood) {
      case 'high': return 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200';
      case 'moderate': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200';
      default: return 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200';
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="w-5 h-5" />
            Evidence-Based Clinical Reasoning
          </CardTitle>
          <CardDescription>
            Generate DDx, treatment options, and evidence-based recommendations from high-impact medical journals
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Clinical Input */}
          <div className="space-y-4">
            <div>
              <Label>Clinical Note / SOAP Note</Label>
              <Textarea
                value={clinicalNote}
                onChange={(e) => setClinicalNote(e.target.value)}
                placeholder="Enter clinical note, SOAP note, or patient presentation..."
                className="min-h-32 mt-1"
              />
            </div>

            <div className="text-center text-sm text-gray-500">- OR -</div>

            <div>
              <Label>Clinical Question</Label>
              <Input
                value={clinicalQuestion}
                onChange={(e) => setClinicalQuestion(e.target.value)}
                placeholder="Ask a specific clinical question..."
                className="mt-1"
              />
            </div>
          </div>

          {/* Evidence Retrieval Filters */}
          <div className="border-t pt-4">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              Evidence Retrieval Settings
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Specialty Focus</Label>
                <Select value={specialty} onValueChange={setSpecialty}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="All Specialties" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={null}>All Specialties</SelectItem>
                    {specialties.map(s => (
                      <SelectItem key={s} value={s.toLowerCase().replace(/\s+/g, '_')}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Journal Authority Level</Label>
                <Select value={authorityLevel} onValueChange={setAuthorityLevel}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="high">High (NEJM, JAMA, Lancet, BMJ)</SelectItem>
                    <SelectItem value="medium">Medium (Specialty Journals)</SelectItem>
                    <SelectItem value="low">Low (All Peer-Reviewed)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Year Range Start</Label>
                <Input
                  type="number"
                  value={yearStart}
                  onChange={(e) => setYearStart(parseInt(e.target.value))}
                  min="2000"
                  max={yearEnd}
                  className="mt-1"
                />
              </div>

              <div>
                <Label>Year Range End</Label>
                <Input
                  type="number"
                  value={yearEnd}
                  onChange={(e) => setYearEnd(parseInt(e.target.value))}
                  min={yearStart}
                  max={new Date().getFullYear()}
                  className="mt-1"
                />
              </div>
            </div>

            <div className="mt-4">
              <Label className="mb-2 block">Article Types</Label>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {articleTypes.map(({ value, label }) => (
                  <div key={value} className="flex items-center space-x-2">
                    <Checkbox
                      id={value}
                      checked={selectedArticleTypes.includes(value)}
                      onCheckedChange={() => toggleArticleType(value)}
                    />
                    <label
                      htmlFor={value}
                      className="text-sm cursor-pointer"
                    >
                      {label}
                    </label>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-4 mt-4">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="drug-info"
                  checked={includeDrugInfo}
                  onCheckedChange={setIncludeDrugInfo}
                />
                <label htmlFor="drug-info" className="text-sm cursor-pointer">
                  Include FDA Drug Information
                </label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="community-insights"
                  checked={includeCommunityInsights}
                  onCheckedChange={setIncludeCommunityInsights}
                />
                <label htmlFor="community-insights" className="text-sm cursor-pointer">
                  Include Clinical Pearls
                </label>
              </div>
            </div>
          </div>

          <Button 
            onClick={generateReport} 
            disabled={generating || (!clinicalNote.trim() && !clinicalQuestion.trim())}
            className="w-full"
            size="lg"
          >
            {generating ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Analyzing Evidence...
              </>
            ) : (
              <>
                <BookOpen className="w-4 h-4 mr-2" />
                Generate Evidence-Based Report
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {report && (
        <Tabs defaultValue="report" className="w-full">
          <TabsList className="mb-4">
            <TabsTrigger value="report">
              <FileText className="w-4 h-4 mr-2" />
              Clinical Report
            </TabsTrigger>
            <TabsTrigger value="coding">
              <Code className="w-4 h-4 mr-2" />
              Code Suggestions
            </TabsTrigger>
          </TabsList>

          <TabsContent value="report" className="space-y-4">
          {/* Executive Summary */}
          <Card>
            <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950 dark:to-indigo-950">
              <CardTitle className="flex items-center justify-between">
                <span>Executive Summary</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => copyToClipboard(report.executive_summary)}
                >
                  <Copy className="w-3 h-3" />
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{report.executive_summary}</p>
              {report.clinical_scenario && (
                <div className="mt-4 pt-4 border-t">
                  <p className="text-sm font-semibold mb-1">Clinical Scenario:</p>
                  <p className="text-sm text-gray-700 dark:text-gray-300">{report.clinical_scenario}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Red Flags */}
          {report.red_flags?.length > 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <p className="font-semibold mb-2">Critical Alerts:</p>
                <ul className="space-y-1">
                  {report.red_flags.map((flag, idx) => (
                    <li key={idx} className="text-sm">
                      <strong>{flag.warning}</strong> - {flag.action_required}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {/* Differential Diagnoses */}
          {report.differential_diagnoses?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Differential Diagnoses (Deep Analysis)</CardTitle>
                <CardDescription className="text-xs">
                  Two-stage reasoning: {report.broad_ddx_generated || 'Multiple'} candidates → {report.deep_analysis_count || report.differential_diagnoses.length} deep-analyzed
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {report.differential_diagnoses.map((ddx, idx) => (
                  <div key={idx} className={`border-l-4 ${ddx.likelihood === 'cant_miss' ? 'border-red-500 bg-red-50 dark:bg-red-950' : 'border-blue-500'} pl-4 py-3 rounded-r`}>
                    <div className="flex items-start justify-between mb-2">
                      <h4 className="font-semibold text-base">{ddx.diagnosis}</h4>
                      <Badge className={getLikelihoodColor(ddx.likelihood)}>
                        {ddx.likelihood === 'cant_miss' ? "CAN'T MISS" : `${ddx.likelihood} likelihood`}
                      </Badge>
                    </div>

                    {ddx.why_it_fits && (
                      <div className="mb-2 bg-green-50 dark:bg-green-950 p-2 rounded">
                        <p className="text-xs font-semibold text-green-800 dark:text-green-200 mb-1">✓ Why it fits THIS patient:</p>
                        <p className="text-sm text-green-900 dark:text-green-100">{ddx.why_it_fits}</p>
                      </div>
                    )}

                    {ddx.why_it_might_not && (
                      <div className="mb-2 bg-orange-50 dark:bg-orange-950 p-2 rounded">
                        <p className="text-xs font-semibold text-orange-800 dark:text-orange-200 mb-1">✗ Why it might NOT be:</p>
                        <p className="text-sm text-orange-900 dark:text-orange-100">{ddx.why_it_might_not}</p>
                      </div>
                    )}

                    {ddx.next_best_tests?.length > 0 && (
                      <div className="mb-2">
                        <p className="text-xs font-semibold text-blue-700 dark:text-blue-300 mb-1">🔬 Next-Best Diagnostic Tests:</p>
                        <ul className="text-sm space-y-0.5 ml-4">
                          {ddx.next_best_tests.map((test, i) => (
                            <li key={i}>• {test}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {ddx.safety_considerations?.length > 0 && (
                      <div className="mb-2 bg-red-50 dark:bg-red-950 p-2 rounded">
                        <p className="text-xs font-semibold text-red-800 dark:text-red-200 mb-1">⚠️ Safety / Don't Miss:</p>
                        <ul className="text-sm space-y-0.5">
                          {ddx.safety_considerations.map((safety, i) => (
                            <li key={i}>• {safety}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {ddx.evidence_quality_breakdown && (
                      <div className="mt-2 pt-2 border-t">
                        <p className="text-xs font-semibold mb-1">Evidence Quality Breakdown:</p>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>Study Quality: {ddx.evidence_quality_breakdown.study_quality}/10</div>
                          <div>Journal Tier: {ddx.evidence_quality_breakdown.journal_tier}/10</div>
                          <div>Recency: {ddx.evidence_quality_breakdown.recency}/10</div>
                          <div>Applicability: {ddx.evidence_quality_breakdown.applicability}/10</div>
                        </div>
                        <div className="mt-1">
                          <Progress value={ddx.supporting_evidence_score * 10} className="h-2" />
                          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                            Overall: {ddx.supporting_evidence_score}/10
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Treatment Options */}
          {report.treatment_options?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Evidence-Based Treatment Options</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {report.treatment_options.map((tx, idx) => (
                  <div key={idx} className="border rounded-lg p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h4 className="font-semibold text-base">{tx.treatment}</h4>
                        <p className="text-sm text-gray-600 dark:text-gray-400">{tx.category}</p>
                      </div>
                      <div className="text-right">
                        <div className={`text-2xl font-bold ${getQualityColor(tx.evidence_quality_score)}`}>
                          {tx.evidence_quality_score}/10
                        </div>
                        <Badge variant={tx.recommendation_strength === 'strong' ? 'default' : 'secondary'}>
                          {tx.recommendation_strength} recommendation
                        </Badge>
                      </div>
                    </div>

                    {tx.supporting_studies?.length > 0 && (
                      <div className="mb-3">
                        <p className="text-xs font-semibold mb-2">Supporting Evidence:</p>
                        <div className="space-y-2">
                          {tx.supporting_studies.slice(0, 3).map((study, i) => (
                            <div key={i} className="bg-gray-50 dark:bg-gray-900 p-3 rounded border-l-2 border-blue-500">
                              <div className="flex items-start justify-between mb-2">
                                <p className="font-semibold flex-1 text-sm">{study.title}</p>
                                <span className={`font-bold ml-2 text-lg ${getQualityColor(study.quality_score)}`}>
                                  {study.quality_score}/10
                                </span>
                              </div>
                              <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                                {study.journal} ({study.year}) • {study.study_type}
                                {study.pubmed_id && ` • PMID: ${study.pubmed_id}`}
                              </p>
                              
                              {study.quality_score_breakdown && (
                                <div className="mb-2 pb-2 border-b border-gray-200 dark:border-gray-700">
                                  <p className="text-xs font-semibold mb-1">Quality Factors:</p>
                                  <div className="grid grid-cols-2 gap-1 text-xs">
                                    <div>Study Design: {study.quality_score_breakdown.study_design}/10</div>
                                    <div>Sample Size: {study.quality_score_breakdown.sample_size}/10</div>
                                    <div>Journal Impact: {study.quality_score_breakdown.journal_impact}/10</div>
                                    <div>Recency: {study.quality_score_breakdown.recency}/10</div>
                                  </div>
                                </div>
                              )}
                              
                              <div className="mb-2">
                                <p className="text-xs font-semibold mb-1">Key Findings:</p>
                                <p className="text-sm">{study.key_findings}</p>
                              </div>
                              
                              {study.why_this_applies && (
                                <div className="bg-blue-50 dark:bg-blue-950 p-2 rounded mb-2">
                                  <p className="text-xs font-semibold text-blue-800 dark:text-blue-200 mb-1">
                                    Why this applies to YOUR patient:
                                  </p>
                                  <p className="text-sm text-blue-900 dark:text-blue-100">{study.why_this_applies}</p>
                                </div>
                              )}
                              
                              {study.citation && (
                                <p className="text-xs text-gray-500 italic">{study.citation}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {tx.contraindications?.length > 0 && (
                      <div className="mb-2">
                        <p className="text-xs font-semibold text-red-600 dark:text-red-400 mb-1">
                          Contraindications:
                        </p>
                        <ul className="text-sm space-y-0.5">
                          {tx.contraindications.map((ci, i) => (
                            <li key={i}>• {ci}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {tx.monitoring_required?.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-orange-600 dark:text-orange-400 mb-1">
                          Monitoring Required:
                        </p>
                        <ul className="text-sm space-y-0.5">
                          {tx.monitoring_required.map((mon, i) => (
                            <li key={i}>• {mon}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Clinical Guidelines */}
          {report.clinical_guidelines?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <FileText className="w-5 h-5" />
                  Clinical Practice Guidelines
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {report.clinical_guidelines.map((guideline, idx) => (
                  <div key={idx} className="border-l-4 border-purple-500 pl-4 py-2">
                    <div className="flex items-start justify-between mb-1">
                      <div>
                        <p className="font-semibold">{guideline.guideline_title}</p>
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          {guideline.organization} ({guideline.year})
                        </p>
                      </div>
                      {guideline.url && (
                        <a
                          href={guideline.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-700"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      )}
                    </div>
                    {guideline.key_recommendations?.length > 0 && (
                      <ul className="text-sm space-y-1 mt-2">
                        {guideline.key_recommendations.map((rec, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <CheckCircle2 className="w-3 h-3 text-purple-600 mt-0.5 flex-shrink-0" />
                            <span>{rec}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Drug Information */}
          {report.drug_information?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Pill className="w-5 h-5" />
                  Drug Information (FDA)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {report.drug_information.map((drug, idx) => (
                  <div key={idx} className="border rounded-lg p-3">
                    <div className="mb-2">
                      <h4 className="font-semibold">{drug.drug_name}</h4>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        {drug.generic_name} • {drug.class}
                      </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                      {drug.fda_approved_indications?.length > 0 && (
                        <div>
                          <p className="font-semibold text-xs mb-1">FDA Indications:</p>
                          <ul className="space-y-0.5">
                            {drug.fda_approved_indications.map((ind, i) => (
                              <li key={i}>• {ind}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {drug.typical_dosing && (
                        <div>
                          <p className="font-semibold text-xs mb-1">Typical Dosing:</p>
                          <p>{drug.typical_dosing}</p>
                        </div>
                      )}

                      {drug.black_box_warnings?.length > 0 && (
                        <div className="col-span-2">
                          <p className="font-semibold text-xs text-red-600 dark:text-red-400 mb-1">
                            ⚠️ Black Box Warnings:
                          </p>
                          <ul className="space-y-0.5">
                            {drug.black_box_warnings.map((warn, i) => (
                              <li key={i} className="text-red-700 dark:text-red-300">• {warn}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {drug.common_adverse_effects?.length > 0 && (
                        <div>
                          <p className="font-semibold text-xs mb-1">Common Adverse Effects:</p>
                          <ul className="space-y-0.5">
                            {drug.common_adverse_effects.map((ae, i) => (
                              <li key={i}>• {ae}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {drug.significant_interactions?.length > 0 && (
                        <div>
                          <p className="font-semibold text-xs mb-1">Significant Interactions:</p>
                          <ul className="space-y-0.5">
                            {drug.significant_interactions.map((int, i) => (
                              <li key={i}>• {int}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Clinical Pearls */}
          {report.clinical_pearls?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Lightbulb className="w-5 h-5" />
                  Clinical Pearls & Insights
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {report.clinical_pearls.map((pearl, idx) => (
                  <div key={idx} className="bg-yellow-50 dark:bg-yellow-950 border-l-4 border-yellow-500 p-3 rounded">
                    <p className="text-sm font-medium">{pearl.pearl}</p>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                      {pearl.practical_application}
                    </p>
                    <Badge variant="secondary" className="mt-2 text-xs">
                      {pearl.source_type?.replace(/_/g, ' ')}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Follow-up Recommendations */}
          {report.follow_up_recommendations?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Follow-up Recommendations</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {report.follow_up_recommendations.map((rec, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm">
                      <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                      <span>{rec}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Structured Input Data */}
          {report.structured_input && (
            <Card className="border-dashed">
              <CardHeader>
                <CardTitle className="text-sm">Structured Clinical Data (AI Parsed)</CardTitle>
              </CardHeader>
              <CardContent className="text-xs">
                <div className="grid grid-cols-2 gap-3">
                  {report.structured_input.chief_complaint && (
                    <div className="col-span-2">
                      <p className="font-semibold">Chief Complaint:</p>
                      <p>{report.structured_input.chief_complaint}</p>
                    </div>
                  )}
                  {report.structured_input.red_flags?.length > 0 && (
                    <div className="col-span-2 bg-red-50 dark:bg-red-950 p-2 rounded">
                      <p className="font-semibold text-red-800 dark:text-red-200">Red Flags Identified:</p>
                      <ul>{report.structured_input.red_flags.map((rf, i) => <li key={i}>• {rf}</li>)}</ul>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Governance & Audit Trail */}
          <Card className="bg-gray-50 dark:bg-gray-900">
            <CardHeader>
              <CardTitle className="text-sm">Clinical Decision Support Disclaimer & Audit Trail</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              <Alert>
                <AlertDescription>
                  <p className="font-semibold mb-1">⚠️ Clinical Decision Support Tool - Assistive Only</p>
                  <p>
                    This report is generated by AI for clinical decision support purposes only. 
                    It does NOT constitute medical advice and must be reviewed by a licensed healthcare provider. 
                    All clinical decisions remain the responsibility of the treating physician.
                  </p>
                </AlertDescription>
              </Alert>

              {report.governance_notes && (
                <div className="space-y-2">
                  {report.governance_notes.sources_queried?.length > 0 && (
                    <div>
                      <p className="font-semibold">Evidence Sources Queried:</p>
                      <ul className="ml-4">
                        {report.governance_notes.sources_queried.map((src, i) => (
                          <li key={i}>• {src}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {report.governance_notes.evidence_tiers_used?.length > 0 && (
                    <div>
                      <p className="font-semibold">Evidence Tiers Used:</p>
                      <ul className="ml-4">
                        {report.governance_notes.evidence_tiers_used.map((tier, i) => (
                          <li key={i}>• {tier}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {report.overall_evidence_quality && (
                <p>
                  <span className="font-semibold">Overall Evidence Quality:</span> {report.overall_evidence_quality}
                </p>
              )}
              
              {report.limitations?.length > 0 && (
                <div>
                  <p className="font-semibold">Limitations:</p>
                  <ul className="ml-4">
                    {report.limitations.map((lim, idx) => (
                      <li key={idx}>• {lim}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="pt-2 border-t text-gray-500">
                <p>Report logged for audit: {new Date().toISOString()}</p>
                <p>User: {report.audit_trail?.user || 'N/A'}</p>
              </div>
            </CardContent>
          </Card>
          </TabsContent>

          <TabsContent value="coding">
            <ClinicalCodeSuggestionPanel
              clinicalData={clinicalNote || clinicalQuestion}
              evidenceReport={report}
              patientId={patientId}
              onCodesConfirmed={(codes) => {
                console.log('Codes confirmed:', codes);
                toast.success('Codes ready for billing submission');
              }}
            />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}