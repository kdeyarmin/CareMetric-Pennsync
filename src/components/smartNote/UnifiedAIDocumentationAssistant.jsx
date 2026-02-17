import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Loader2,
  Wand2,
  AlertCircle,
  CheckCircle2,
  BookOpen,
  Code,
  FileText,
  Copy,
  ChevronDown
} from "lucide-react";
import { toast } from "sonner";

export default function UnifiedAIDocumentationAssistant({
  patientId,
  patientData,
  visitType,
  diagnosis,
  clinicalNotes,
  extractedData,
  onFieldsPopulated,
  onCodesGenerated,
  onEducationGenerated,
  onComplianceChecked
}) {
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('populate');
  const [results, setResults] = useState({
    fields: null,
    codes: null,
    education: null,
    compliance: null
  });
  const [expanded, setExpanded] = useState(false);

  const runAssistant = async (action) => {
    setLoading(true);
    try {
      const response = await base44.functions.invoke('aiDocumentationAssistant', {
        action,
        patient_id: patientId,
        visit_type: visitType,
        diagnosis,
        clinical_notes: clinicalNotes,
        extracted_data: extractedData
      });

      setResults(prev => ({
        ...prev,
        [action === 'populate_fields' ? 'fields' : 
         action === 'suggest_codes' ? 'codes' :
         action === 'generate_education' ? 'education' : 'compliance']: response
      }));

      // Call appropriate callback
      if (action === 'populate_fields') onFieldsPopulated?.(response);
      else if (action === 'suggest_codes') onCodesGenerated?.(response);
      else if (action === 'generate_education') onEducationGenerated?.(response);
      else if (action === 'check_compliance') onComplianceChecked?.(response);

      toast.success(`${action.split('_').join(' ')} completed`);
    } catch (error) {
      console.error('Assistant error:', error);
      toast.error('Failed to run assistant');
    } finally {
      setLoading(false);
    }
  };

  if (!patientId || patientId === 'no_patient' || !visitType || !diagnosis) {
    return null;
  }

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800 p-2 rounded transition-colors"
        >
          <div className="flex items-center gap-2">
            <Wand2 className="w-4 h-4 text-purple-600" />
            <CardTitle className="text-sm">AI Documentation Assistant</CardTitle>
          </div>
          <ChevronDown className={`w-4 h-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-4 mb-4">
              <TabsTrigger value="populate" className="text-xs">Fields</TabsTrigger>
              <TabsTrigger value="suggest_codes" className="text-xs">Codes</TabsTrigger>
              <TabsTrigger value="generate_education" className="text-xs">Education</TabsTrigger>
              <TabsTrigger value="check_compliance" className="text-xs">Compliance</TabsTrigger>
            </TabsList>

            {/* Field Population Tab */}
            <TabsContent value="populate" className="space-y-3">
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Auto-populate documentation fields based on patient history and visit context.
              </p>
              <Button
                onClick={() => runAssistant('populate_fields')}
                disabled={loading || !clinicalNotes}
                className="w-full bg-purple-600 hover:bg-purple-700"
                size="sm"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                    Populating...
                  </>
                ) : (
                  <>
                    <FileText className="w-3 h-3 mr-2" />
                    Populate Fields
                  </>
                )}
              </Button>

              {results.fields && (
                <div className="space-y-2 p-3 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                  {results.fields.fields.assessment && (
                    <div>
                      <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 mb-1">Assessment</p>
                      <p className="text-xs text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-700 p-2 rounded">
                        {results.fields.fields.assessment}
                      </p>
                    </div>
                  )}
                  {results.fields.fields.plan && (
                    <div>
                      <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 mb-1">Plan</p>
                      <p className="text-xs text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-700 p-2 rounded">
                        {results.fields.fields.plan}
                      </p>
                    </div>
                  )}
                  {results.fields.fields.patient_instructions && (
                    <div>
                      <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 mb-1">Patient Instructions</p>
                      <p className="text-xs text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-700 p-2 rounded">
                        {results.fields.fields.patient_instructions}
                      </p>
                    </div>
                  )}
                  {results.fields.fields.red_flags && (
                    <div>
                      <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 mb-1">Red Flags to Watch</p>
                      <ul className="text-xs text-slate-700 dark:text-slate-300 space-y-1">
                        {results.fields.fields.red_flags.map((flag, idx) => (
                          <li key={idx} className="flex gap-2">
                            <span className="text-red-500">⚠️</span>
                            <span>{flag}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </TabsContent>

            {/* ICD-10 Codes Tab */}
            <TabsContent value="suggest_codes" className="space-y-3">
              <p className="text-xs text-slate-600 dark:text-slate-400">
                AI-suggested ICD-10 codes based on clinical documentation.
              </p>
              <Button
                onClick={() => runAssistant('suggest_codes')}
                disabled={loading || !clinicalNotes}
                className="w-full bg-blue-600 hover:bg-blue-700"
                size="sm"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    <Code className="w-3 h-3 mr-2" />
                    Suggest Codes
                  </>
                )}
              </Button>

              {results.codes?.codes && (
                <div className="space-y-2">
                  {results.codes.codes.map((code, idx) => (
                    <div key={idx} className="p-2 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div>
                          <p className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">
                            {code.code}
                          </p>
                          <p className="text-xs text-slate-700 dark:text-slate-300">{code.description}</p>
                        </div>
                        <Badge className="text-xs">
                          {code.confidence}
                        </Badge>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-400">{code.justification}</p>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* Education Tab */}
            <TabsContent value="generate_education" className="space-y-3">
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Generate patient education materials tailored to diagnosis and patient needs.
              </p>
              <Button
                onClick={() => runAssistant('generate_education')}
                disabled={loading || !patientData}
                className="w-full bg-green-600 hover:bg-green-700"
                size="sm"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <BookOpen className="w-3 h-3 mr-2" />
                    Generate Education
                  </>
                )}
              </Button>

              {results.education?.material && (
                <div className="space-y-2 p-3 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">
                      {results.education.material.title}
                    </p>
                    <div className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap mb-3">
                      {results.education.material.content}
                    </div>
                  </div>

                  {results.education.material.key_points && (
                    <div>
                      <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 mb-2">Key Points</p>
                      <ul className="text-xs space-y-1 text-slate-700 dark:text-slate-300">
                        {results.education.material.key_points.map((point, idx) => (
                          <li key={idx}>• {point}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {results.education.material.warning_signs && (
                    <div className="p-2 bg-orange-50 dark:bg-orange-900/20 rounded">
                      <p className="text-xs font-semibold text-orange-900 dark:text-orange-200 mb-2">Warning Signs</p>
                      <ul className="text-xs space-y-1 text-orange-800 dark:text-orange-300">
                        {results.education.material.warning_signs.map((sign, idx) => (
                          <li key={idx}>⚠️ {sign}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <Button
                    onClick={() => {
                      navigator.clipboard.writeText(results.education.material.content);
                      toast.success('Education material copied');
                    }}
                    size="sm"
                    variant="outline"
                    className="w-full text-xs h-8"
                  >
                    <Copy className="w-3 h-3 mr-1" />
                    Copy Material
                  </Button>
                </div>
              )}
            </TabsContent>

            {/* Compliance Tab */}
            <TabsContent value="check_compliance" className="space-y-3">
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Real-time compliance checking and quality recommendations.
              </p>
              <Button
                onClick={() => runAssistant('check_compliance')}
                disabled={loading || !clinicalNotes}
                className="w-full bg-amber-600 hover:bg-amber-700"
                size="sm"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                    Checking...
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-3 h-3 mr-2" />
                    Check Compliance
                  </>
                )}
              </Button>

              {results.compliance && (
                <div className="space-y-3">
                  <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                        Compliance Score
                      </span>
                      <Badge 
                        className={results.compliance.compliance_score >= 85 ? 'bg-green-600' : 'bg-amber-600'}
                      >
                        {results.compliance.compliance_score}%
                      </Badge>
                    </div>
                    {results.compliance.summary && (
                      <p className="text-xs text-slate-700 dark:text-slate-300">
                        {results.compliance.summary}
                      </p>
                    )}
                  </div>

                  {results.compliance.issues && results.compliance.issues.length > 0 && (
                    <div className="space-y-2">
                      {results.compliance.issues.map((issue, idx) => (
                        <div
                          key={idx}
                          className={`p-2 rounded border text-xs ${
                            issue.severity === 'critical'
                              ? 'bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700'
                              : issue.severity === 'high'
                              ? 'bg-orange-50 dark:bg-orange-900/20 border-orange-300 dark:border-orange-700'
                              : 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-300 dark:border-yellow-700'
                          }`}
                        >
                          <p className="font-semibold mb-1">{issue.description}</p>
                          <p className="text-slate-700 dark:text-slate-300 mb-1">
                            {issue.recommendation}
                          </p>
                          <p className="text-slate-600 dark:text-slate-400 text-[10px]">
                            Standard: {issue.standard}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      )}
    </Card>
  );
}