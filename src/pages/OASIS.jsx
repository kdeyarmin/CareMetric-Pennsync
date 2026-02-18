import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  UploadCloud, Brain, FileText, CheckCircle2, AlertCircle, Loader2, X,
  Zap, Shield, Lightbulb, TrendingUp } from "lucide-react";
import PullToRefresh from "../components/mobile/PullToRefresh";
import AutoPopulateDataFields from "../components/smartNote/AutoPopulateDataFields";
import PremiumFeatureGate from "../components/subscription/PremiumFeatureGate";

export default function OASIS() {
  const [oasisFile, setOasisFile] = useState(null);
  const [narrative, setNarrative] = useState("");
  const [analysisResult, setAnalysisResult] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const handleFileChange = (event) => {
    if (event.target.files && event.target.files[0]) {
      setOasisFile(event.target.files[0]);
    }
  };

  const analyzeOASIS = async () => {
    if (!oasisFile && !narrative.trim()) {
      toast.error("Please upload an OASIS assessment or enter a narrative.");
      return;
    }

    setIsAnalyzing(true);
    setAnalysisResult(null);

    try {
      let fileUrl = null;
      if (oasisFile) {
        const uploadRes = await base44.integrations.Core.UploadFile({ file: oasisFile });
        fileUrl = uploadRes.file_url;
      }

      const result = await base44.functions.invoke('analyzeOASIS', {
        oasis_file_url: fileUrl,
        narrative_text: narrative
      });

      if (result.data?.success) {
        setAnalysisResult(result.data);
        toast.success("OASIS analysis complete!");
      } else {
        toast.error(result.data?.error || "Failed to analyze OASIS.");
      }
    } catch (error) {
      toast.error(`Error during analysis: ${error.message}`);
      console.error("OASIS analysis error:", error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'compliant':
        return <Badge className="bg-green-500 text-white">Compliant</Badge>;
      case 'flagged':
        return <Badge className="bg-orange-500 text-white">Flagged</Badge>;
      case 'critical':
        return <Badge className="bg-red-500 text-white">Critical Issues</Badge>;
      default:
        return <Badge variant="secondary">Unknown</Badge>;
    }
  };

  return (
    <PremiumFeatureGate featureName="OASIS Documentation" featureDescription="AI-powered OASIS assessment analysis with compliance checking." allowTrial={true}>
    <PullToRefresh onRefresh={() => queryClient.invalidateQueries({ queryKey: ['currentUser'] })}>
      <div className="p-3 sm:p-4 md:p-6 lg:p-8 max-w-7xl mx-auto w-full max-w-full overflow-x-hidden min-w-0 pb-20 sm:pb-6">
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-2 text-slate-900 dark:text-slate-100">OASIS Documentation Assistant</h1>
          <p className="text-sm sm:text-base text-slate-600 dark:text-slate-400">AI-powered analysis to ensure your OASIS assessments are complete, accurate, and compliant with Medicare requirements.</p>
        </div>

        {/* What Gets Generated Section */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4 mb-6">
          <Card className="border-blue-200/50 dark:border-blue-900/30">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm sm:text-base flex items-center gap-2">
                <Brain className="w-4 h-4 text-blue-600" />
                Comprehensive Analysis
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 space-y-2">
              <p>✓ Field inconsistency detection</p>
              <p>✓ Data reasonableness validation</p>
              <p>✓ Compliance rule checking</p>
              <p>✓ Improvement recommendations</p>
            </CardContent>
          </Card>

          <Card className="border-green-200/50 dark:border-green-900/30">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm sm:text-base flex items-center gap-2">
                <Shield className="w-4 h-4 text-green-600" />
                Compliance Verification
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 space-y-2">
              <p>✓ Medicare OASIS-E standards</p>
              <p>✓ Clinical documentation rules</p>
              <p>✓ Quality indicator checks</p>
              <p>✓ Audit readiness assessment</p>
            </CardContent>
          </Card>
        </div>

        <Card className="mb-4 sm:mb-6 w-full">
          <CardHeader className="bg-gradient-to-r from-blue-50 to-blue-100/50 dark:from-blue-950/30 dark:to-blue-900/20 p-3 sm:p-4 flex flex-col space-y-2">
            <CardTitle className="flex items-center gap-2 text-xs sm:text-sm md:text-base"><UploadCloud className="w-4 h-4 sm:w-5 sm:h-5" /> Upload OASIS Assessment</CardTitle>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">Upload a PDF or image of your assessment, or paste the narrative notes for AI analysis</p>
          </CardHeader>
          <CardContent className="pt-4 sm:pt-5 p-3 sm:p-4 space-y-4 sm:space-y-4">
            <div>
              <Label htmlFor="oasis-file" className="text-xs sm:text-sm">OASIS Assessment File (PDF, Image)</Label>
              <Input id="oasis-file" type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={handleFileChange} className="h-10 sm:h-11 text-sm" />
              {oasisFile && <p className="text-xs sm:text-sm text-slate-500 mt-2">Selected: {oasisFile.name}</p>}
            </div>
            <div>
              <Label htmlFor="oasis-narrative" className="text-xs sm:text-sm">OASIS Narrative / Notes</Label>
              <Textarea
                id="oasis-narrative"
                placeholder="Enter the detailed narrative notes related to the OASIS assessment..."
                value={narrative}
                onChange={(e) => setNarrative(e.target.value)}
                rows={6}
                className="text-sm" />

            </div>
            <Button
              onClick={analyzeOASIS}
              disabled={isAnalyzing || !oasisFile && !narrative.trim()}
              className="w-full touch-target h-11 sm:h-12 bg-blue-600 hover:bg-blue-700">

              {isAnalyzing ?
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Analyzing Assessment...</> :

              <><Brain className="w-4 h-4 mr-2" /> Run AI Analysis</>
              }
            </Button>
          </CardContent>
        </Card>

        {/* AI Auto-Populate OASIS Fields */}
        {narrative &&
        <AutoPopulateDataFields
          narrative={narrative}
          dataType="oasis_m1800"
          onDataExtracted={(data) => {
            console.log('Extracted OASIS data:', data);
          }} />

        }

        {analysisResult &&
         <Card className="mt-6 w-full overflow-hidden border-blue-200/50 dark:border-blue-900/30">
             <CardHeader className="bg-gradient-to-r from-blue-50 to-blue-100/50 dark:from-blue-950/30 dark:to-blue-900/20 p-3 sm:p-4">
               <CardTitle className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs sm:text-sm md:text-base">
                 <span className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5" /> Analysis Results</span>
                {getStatusBadge(analysisResult.overall_status)}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 sm:space-y-5 p-4 sm:p-5 pt-4">
              <div className="bg-slate-50 dark:bg-slate-900/30 p-3 sm:p-4 rounded-lg border border-slate-200 dark:border-slate-700">
                <h3 className="text-sm sm:text-base font-semibold text-slate-900 dark:text-slate-100 mb-2">Summary</h3>
                <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{analysisResult.summary_message}</p>
              </div>
              {analysisResult.inconsistencies && analysisResult.inconsistencies.length > 0 &&
            <div className="bg-red-50 dark:bg-red-950/20 p-3 sm:p-4 rounded-lg border border-red-200 dark:border-red-900/30">
                  <h3 className="text-sm font-semibold text-red-700 dark:text-red-400 mb-3 flex items-center gap-2"><AlertCircle className="w-4 h-4" /> Critical Inconsistencies</h3>
                  <ul className="space-y-2">
                    {analysisResult.inconsistencies.map((item, index) =>
                <li key={index} className="text-xs sm:text-sm bg-white dark:bg-slate-800 p-2 rounded border-l-3 border-red-600">
                  <strong className="text-red-700 dark:text-red-400">{item.field}</strong>
                  <p className="text-slate-600 dark:text-slate-300 text-xs mt-1">{item.issue}</p>
                  <p className="text-red-600 dark:text-red-400 text-xs mt-1">→ {item.suggestion}</p>
                </li>
                )}
                  </ul>
                </div>
            }
              {analysisResult.reasonableness_flags && analysisResult.reasonableness_flags.length > 0 &&
            <div className="bg-orange-50 dark:bg-orange-950/20 p-3 sm:p-4 rounded-lg border border-orange-200 dark:border-orange-900/30">
                  <h3 className="text-sm font-semibold text-orange-700 dark:text-orange-400 mb-3 flex items-center gap-2"><TrendingUp className="w-4 h-4" /> Reasonableness Checks</h3>
                  <ul className="space-y-2">
                    {analysisResult.reasonableness_flags.map((item, index) =>
                <li key={index} className="text-xs sm:text-sm bg-white dark:bg-slate-800 p-2 rounded border-l-3 border-orange-600">
                  <strong className="text-orange-700 dark:text-orange-400">{item.field}</strong>
                  <p className="text-slate-600 dark:text-slate-300 text-xs mt-1">{item.issue}</p>
                  <p className="text-orange-600 dark:text-orange-400 text-xs mt-1">ℹ️ {item.context}</p>
                </li>
                )}
                  </ul>
                </div>
            }
              {analysisResult.compliance_warnings && analysisResult.compliance_warnings.length > 0 &&
            <div className="bg-yellow-50 dark:bg-yellow-950/20 p-3 sm:p-4 rounded-lg border border-yellow-200 dark:border-yellow-900/30">
                  <h3 className="text-sm font-semibold text-yellow-700 dark:text-yellow-400 mb-3 flex items-center gap-2"><Shield className="w-4 h-4" /> Compliance Warnings</h3>
                  <ul className="space-y-2">
                    {analysisResult.compliance_warnings.map((item, index) =>
                <li key={index} className="text-xs sm:text-sm bg-white dark:bg-slate-800 p-2 rounded border-l-3 border-yellow-600">
                  <strong className="text-yellow-700 dark:text-yellow-400">{item.rule}</strong>
                  <p className="text-slate-600 dark:text-slate-300 text-xs mt-1">{item.details}</p>
                </li>
                )}
                  </ul>
                </div>
            }
              {analysisResult.suggestions && analysisResult.suggestions.length > 0 &&
            <div className="bg-green-50 dark:bg-green-950/20 p-3 sm:p-4 rounded-lg border border-green-200 dark:border-green-900/30">
                  <h3 className="text-sm font-semibold text-green-700 dark:text-green-400 mb-3 flex items-center gap-2"><Lightbulb className="w-4 h-4" /> Recommendations</h3>
                  <ul className="space-y-2">
                    {analysisResult.suggestions.map((item, index) =>
                <li key={index} className="text-xs sm:text-sm bg-white dark:bg-slate-800 p-2 rounded flex items-start gap-2">
                  <span className="text-green-600 mt-0.5 flex-shrink-0">✓</span>
                  <span className="text-slate-700 dark:text-slate-300">{item}</span>
                </li>
                )}
                  </ul>
                </div>
            }
            </CardContent>
          </Card>
        }
      </div>
    </PullToRefresh>
    </PremiumFeatureGate>);

}