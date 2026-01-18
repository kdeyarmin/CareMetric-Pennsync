import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { 
  Upload, 
  FileText, 
  Loader2, 
  CheckCircle, 
  AlertCircle,
  X,
  Download,
  Copy
} from "lucide-react";
import { toast } from "sonner";

export default function DocumentAnalyzer() {
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState(null);

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me()
  });

  const { data: providerSettings } = useQuery({
    queryKey: ['providerSettings', currentUser?.email],
    queryFn: async () => {
      const settings = await base44.entities.ProviderSettings.filter({ provider_email: currentUser.email });
      return settings[0];
    },
    enabled: !!currentUser?.email
  });

  const providerType = currentUser?.credential_type || providerSettings?.provider_type || 'RN';
  const careSetting = providerSettings?.primary_care_setting || 'home_health';

  const handleFileSelect = (e) => {
    const selectedFiles = Array.from(e.target.files);
    const pdfFiles = selectedFiles.filter(f => f.type === 'application/pdf');
    
    if (pdfFiles.length !== selectedFiles.length) {
      toast.error('Only PDF files are allowed');
    }
    
    setFiles(prev => [...prev, ...pdfFiles]);
  };

  const removeFile = (index) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleAnalyze = async () => {
    if (files.length === 0) {
      toast.error('Please upload at least one PDF file');
      return;
    }

    setUploading(true);
    setAnalysis(null);

    try {
      // Upload all files
      const uploadedUrls = [];
      for (const file of files) {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        uploadedUrls.push(file_url);
      }

      setUploading(false);
      setAnalyzing(true);

      // Analyze with AI
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: buildAnalysisPrompt(providerType, careSetting, files.map(f => f.name)),
        file_urls: uploadedUrls,
        response_json_schema: getAnalysisSchema(providerType, careSetting)
      });

      setAnalysis(result);
      toast.success('Documents analyzed successfully');
    } catch (error) {
      toast.error('Failed to analyze documents: ' + error.message);
    } finally {
      setUploading(false);
      setAnalyzing(false);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 p-4 md:p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100">
              AI Document Analyzer
            </h1>
            <p className="text-slate-600 dark:text-slate-400 mt-1">
              Upload clinical documents for AI-powered analysis and summaries
            </p>
          </div>
          <Badge variant="outline" className="text-sm">
            {providerType} - {careSetting.replace(/_/g, ' ')}
          </Badge>
        </div>

        {/* Upload Section */}
        <Card>
          <CardHeader>
            <CardTitle>Upload Documents</CardTitle>
            <CardDescription>
              Upload one or more PDF documents (referrals, reports, consults, etc.)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg p-8 text-center">
              <input
                type="file"
                id="file-upload"
                multiple
                accept=".pdf"
                onChange={handleFileSelect}
                className="hidden"
              />
              <label htmlFor="file-upload" className="cursor-pointer">
                <Upload className="w-12 h-12 mx-auto text-slate-400 mb-4" />
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Click to upload or drag and drop
                </p>
                <p className="text-xs text-slate-500 mt-1">PDF files only</p>
              </label>
            </div>

            {files.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  Selected Files ({files.length})
                </p>
                {files.map((file, index) => (
                  <div key={index} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
                    <div className="flex items-center gap-3">
                      <FileText className="w-5 h-5 text-slate-500" />
                      <div>
                        <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{file.name}</p>
                        <p className="text-xs text-slate-500">{(file.size / 1024).toFixed(1)} KB</p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeFile(index)}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <Button
              onClick={handleAnalyze}
              disabled={files.length === 0 || uploading || analyzing}
              className="w-full"
            >
              {uploading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {analyzing && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {uploading ? 'Uploading...' : analyzing ? 'Analyzing...' : 'Analyze Documents'}
            </Button>
          </CardContent>
        </Card>

        {/* Analysis Results */}
        {analysis && (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                  Analysis Complete
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Executive Summary */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-slate-900 dark:text-slate-100">Executive Summary</h3>
                    <Button size="sm" variant="ghost" onClick={() => copyToClipboard(analysis.executive_summary)}>
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                  <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap bg-slate-50 dark:bg-slate-800 p-4 rounded-lg">
                    {analysis.executive_summary}
                  </p>
                </div>

                {/* Key Findings */}
                {analysis.key_findings && analysis.key_findings.length > 0 && (
                  <div>
                    <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-3">Key Findings</h3>
                    <div className="grid gap-3">
                      {analysis.key_findings.map((finding, index) => (
                        <div key={index} className="p-3 bg-blue-50 dark:bg-blue-950 border-l-4 border-blue-500 rounded">
                          <p className="text-sm font-medium text-blue-900 dark:text-blue-100">{finding.category}</p>
                          <p className="text-sm text-blue-800 dark:text-blue-200 mt-1">{finding.finding}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Provider-Specific Sections */}
                {renderProviderSpecificSections(analysis, providerType, careSetting, copyToClipboard)}

                {/* Action Items */}
                {analysis.action_items && analysis.action_items.length > 0 && (
                  <div>
                    <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-3">Recommended Actions</h3>
                    <div className="space-y-2">
                      {analysis.action_items.map((item, index) => (
                        <div key={index} className="flex items-start gap-3 p-3 bg-amber-50 dark:bg-amber-950 rounded-lg">
                          <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                          <div>
                            <p className="text-sm font-medium text-amber-900 dark:text-amber-100">{item.action}</p>
                            {item.priority && (
                              <Badge className="mt-1" variant={item.priority === 'high' ? 'destructive' : 'secondary'}>
                                {item.priority}
                              </Badge>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Button onClick={() => { setFiles([]); setAnalysis(null); }} variant="outline" className="w-full">
              Analyze New Documents
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function buildAnalysisPrompt(providerType, careSetting, fileNames) {
  const basePrompt = `You are analyzing clinical documents for a ${providerType} working in ${careSetting.replace(/_/g, ' ')}.\n\nDocuments uploaded: ${fileNames.join(', ')}\n\n`;
  
  const prompts = {
    home_health: {
      RN: `${basePrompt}Focus on:
- Patient demographics and insurance information
- Primary and secondary diagnoses (with ICD-10 codes if available)
- Current medications and allergies
- Functional status and ADL independence
- Homebound status indicators
- Skilled nursing needs
- OASIS-relevant assessment data
- Safety concerns and fall risk
- Orders and care plan recommendations

Provide OASIS item suggestions based on the referral information.`,
      
      LPN: `${basePrompt}Focus on:
- Vital signs monitoring requirements
- Medication administration needs
- Wound care requirements
- Basic ADL assistance needs
- Patient teaching opportunities
- Safety protocols`,
      
      PT: `${basePrompt}Focus on:
- Mobility and transfer status
- Gait and balance assessment
- Range of motion limitations
- Pain reports
- Fall history and risk
- Prior therapy outcomes
- Home safety and DME needs
- Functional goals`,
      
      OT: `${basePrompt}Focus on:
- ADL independence levels
- Fine motor skills
- Cognitive status
- Home modification needs
- Adaptive equipment requirements
- Safety awareness
- Prior therapy progress`,
      
      ST: `${basePrompt}Focus on:
- Swallowing and dysphagia risk
- Speech and language deficits
- Cognitive-communication status
- Diet texture recommendations
- Prior therapy outcomes
- Communication strategies`,
      
      MSW: `${basePrompt}Focus on:
- Psychosocial stressors
- Financial barriers to care
- Caregiver support and burden
- Depression screening results
- Community resources needed
- Advance directives status
- Living situation and safety`
    },
    
    outpatient_clinic: {
      MD: `${basePrompt}Focus on:
- Chief complaint and presenting symptoms
- Relevant history and physical findings
- Diagnostic test results
- Specialist recommendations
- Treatment plan modifications
- Medication changes
- Follow-up requirements
- Red flags or urgent findings`,
      
      NP: `${basePrompt}Focus on:
- Chief complaint and HPI
- Relevant exam findings
- Lab and imaging results
- Differential diagnoses
- Treatment recommendations
- Patient education needs
- Follow-up plan`,
      
      PA: `${basePrompt}Focus on:
- Presenting problem
- Pertinent physical findings
- Diagnostic results
- Specialist opinions
- Treatment modifications
- Patient instructions`
    },
    
    telehealth: {
      default: `${basePrompt}Focus on:
- Virtual visit findings
- Remote monitoring data
- Patient-reported symptoms
- Technology accessibility
- Follow-up telehealth needs
- In-person visit requirements`
    }
  };

  return prompts[careSetting]?.[providerType] || prompts[careSetting]?.default || basePrompt + "Analyze these clinical documents and provide a comprehensive summary.";
}

function getAnalysisSchema(providerType, careSetting) {
  const baseSchema = {
    type: "object",
    properties: {
      executive_summary: { type: "string" },
      key_findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            category: { type: "string" },
            finding: { type: "string" }
          }
        }
      },
      action_items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            action: { type: "string" },
            priority: { type: "string" }
          }
        }
      }
    }
  };

  if (careSetting === 'home_health' && (providerType === 'RN' || providerType === 'LPN')) {
    baseSchema.properties.patient_demographics = {
      type: "object",
      properties: {
        name: { type: "string" },
        dob: { type: "string" },
        insurance: { type: "string" },
        physician: { type: "string" }
      }
    };
    baseSchema.properties.diagnoses = {
      type: "array",
      items: {
        type: "object",
        properties: {
          diagnosis: { type: "string" },
          icd10: { type: "string" }
        }
      }
    };
    baseSchema.properties.medications = {
      type: "array",
      items: { type: "string" }
    };
    baseSchema.properties.oasis_suggestions = {
      type: "array",
      items: {
        type: "object",
        properties: {
          item: { type: "string" },
          suggested_value: { type: "string" },
          rationale: { type: "string" }
        }
      }
    };
    baseSchema.properties.homebound_indicators = {
      type: "array",
      items: { type: "string" }
    };
  }

  if (providerType === 'MD' || providerType === 'NP' || providerType === 'PA') {
    baseSchema.properties.specialist_recommendations = {
      type: "array",
      items: { type: "string" }
    };
    baseSchema.properties.diagnostic_results = {
      type: "array",
      items: {
        type: "object",
        properties: {
          test: { type: "string" },
          result: { type: "string" },
          significance: { type: "string" }
        }
      }
    };
  }

  return baseSchema;
}

function renderProviderSpecificSections(analysis, providerType, careSetting, copyToClipboard) {
  const sections = [];

  if (analysis.patient_demographics) {
    sections.push(
      <div key="demographics">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-3">Patient Demographics</h3>
        <div className="grid grid-cols-2 gap-3 p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
          {Object.entries(analysis.patient_demographics).map(([key, value]) => (
            value && (
              <div key={key}>
                <p className="text-xs text-slate-500 uppercase">{key.replace(/_/g, ' ')}</p>
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{value}</p>
              </div>
            )
          ))}
        </div>
      </div>
    );
  }

  if (analysis.diagnoses && analysis.diagnoses.length > 0) {
    sections.push(
      <div key="diagnoses">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-3">Diagnoses</h3>
        <div className="space-y-2">
          {analysis.diagnoses.map((dx, index) => (
            <div key={index} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
              <div>
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{dx.diagnosis}</p>
                {dx.icd10 && <p className="text-xs text-slate-500">{dx.icd10}</p>}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (analysis.medications && analysis.medications.length > 0) {
    sections.push(
      <div key="medications">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-3">Medications</h3>
        <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
          <ul className="list-disc list-inside space-y-1">
            {analysis.medications.map((med, index) => (
              <li key={index} className="text-sm text-slate-700 dark:text-slate-300">{med}</li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  if (analysis.oasis_suggestions && analysis.oasis_suggestions.length > 0) {
    sections.push(
      <div key="oasis">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-3">OASIS Item Suggestions</h3>
        <div className="space-y-3">
          {analysis.oasis_suggestions.map((item, index) => (
            <div key={index} className="p-4 bg-purple-50 dark:bg-purple-950 border-l-4 border-purple-500 rounded">
              <p className="text-sm font-medium text-purple-900 dark:text-purple-100">{item.item}</p>
              <p className="text-sm text-purple-800 dark:text-purple-200 mt-1">
                Suggested: <strong>{item.suggested_value}</strong>
              </p>
              <p className="text-xs text-purple-700 dark:text-purple-300 mt-1">{item.rationale}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (analysis.homebound_indicators && analysis.homebound_indicators.length > 0) {
    sections.push(
      <div key="homebound">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-3">Homebound Status Indicators</h3>
        <div className="p-4 bg-green-50 dark:bg-green-950 rounded-lg">
          <ul className="list-disc list-inside space-y-1">
            {analysis.homebound_indicators.map((indicator, index) => (
              <li key={index} className="text-sm text-green-800 dark:text-green-200">{indicator}</li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  if (analysis.specialist_recommendations && analysis.specialist_recommendations.length > 0) {
    sections.push(
      <div key="specialist">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-3">Specialist Recommendations</h3>
        <div className="space-y-2">
          {analysis.specialist_recommendations.map((rec, index) => (
            <div key={index} className="p-3 bg-indigo-50 dark:bg-indigo-950 rounded-lg">
              <p className="text-sm text-indigo-900 dark:text-indigo-100">{rec}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (analysis.diagnostic_results && analysis.diagnostic_results.length > 0) {
    sections.push(
      <div key="diagnostics">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-3">Diagnostic Results</h3>
        <div className="space-y-3">
          {analysis.diagnostic_results.map((result, index) => (
            <div key={index} className="p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{result.test}</p>
              <p className="text-sm text-slate-700 dark:text-slate-300 mt-1">{result.result}</p>
              {result.significance && (
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 italic">{result.significance}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return sections;
}