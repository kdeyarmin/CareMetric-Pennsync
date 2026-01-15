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
  UploadCloud, Brain, FileText, CheckCircle2, AlertCircle, Loader2, X
} from "lucide-react";
import PullToRefresh from "../components/mobile/PullToRefresh";

export default function OASIS() {
  const [oasisFile, setOasisFile] = useState(null);
  const [narrative, setNarrative] = useState("");
  const [analysisResult, setAnalysisResult] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
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
        narrative_text: narrative,
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
      case 'compliant': return <Badge className="bg-green-500 text-white">Compliant</Badge>;
      case 'flagged': return <Badge className="bg-orange-500 text-white">Flagged</Badge>;
      case 'critical': return <Badge className="bg-red-500 text-white">Critical Issues</Badge>;
      default: return <Badge variant="secondary">Unknown</Badge>;
    }
  };

  return (
    <PullToRefresh onRefresh={() => queryClient.invalidateQueries({ queryKey: ['currentUser'] })}>
      <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold mb-6 text-slate-900 dark:text-slate-100">OASIS Documentation Assistant</h1>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><UploadCloud className="w-5 h-5" /> Upload OASIS Assessment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="oasis-file">OASIS Assessment File (PDF, Image)</Label>
              <Input id="oasis-file" type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={handleFileChange} />
              {oasisFile && <p className="text-sm text-slate-500 mt-2">Selected: {oasisFile.name}</p>}
            </div>
            <div>
              <Label htmlFor="oasis-narrative">OASIS Narrative / Notes</Label>
              <Textarea
                id="oasis-narrative"
                placeholder="Enter the detailed narrative notes related to the OASIS assessment..."
                value={narrative}
                onChange={(e) => setNarrative(e.target.value)}
                rows={8}
              />
            </div>
            <Button 
              onClick={analyzeOASIS} 
              disabled={isAnalyzing || (!oasisFile && !narrative.trim())}
              className="w-full"
            >
              {isAnalyzing ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Analyzing...</>
              ) : (
                <><Brain className="w-4 h-4 mr-2" /> Analyze OASIS</>
              )}
            </Button>
          </CardContent>
        </Card>

        {analysisResult && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2"><FileText className="w-5 h-5" /> Analysis Results</span>
                {getStatusBadge(analysisResult.overall_status)}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold">Overall Status:</h3>
                <p className="text-sm">{analysisResult.summary_message}</p>
              </div>
              {analysisResult.inconsistencies && analysisResult.inconsistencies.length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold text-red-600">Inconsistencies Found:</h3>
                  <ul className="list-disc pl-5 space-y-1">
                    {analysisResult.inconsistencies.map((item, index) => (
                      <li key={index} className="text-sm text-red-700"><strong>{item.field}:</strong> {item.issue} (Suggested fix: {item.suggestion})</li>
                    ))}
                  </ul>
                </div>
              )}
              {analysisResult.reasonableness_flags && analysisResult.reasonableness_flags.length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold text-orange-600">Reasonableness Flags:</h3>
                  <ul className="list-disc pl-5 space-y-1">
                    {analysisResult.reasonableness_flags.map((item, index) => (
                      <li key={index} className="text-sm text-orange-700"><strong>{item.field}:</strong> {item.issue} (Context: {item.context})</li>
                    ))}
                  </ul>
                </div>
              )}
              {analysisResult.compliance_warnings && analysisResult.compliance_warnings.length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold text-yellow-600">Compliance Warnings:</h3>
                  <ul className="list-disc pl-5 space-y-1">
                    {analysisResult.compliance_warnings.map((item, index) => (
                      <li key={index} className="text-sm text-yellow-700"><strong>Rule:</strong> {item.rule} (Details: {item.details})</li>
                    ))}
                  </ul>
                </div>
              )}
              {analysisResult.suggestions && analysisResult.suggestions.length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold text-green-600">Suggestions for Improvement:</h3>
                  <ul className="list-disc pl-5 space-y-1">
                    {analysisResult.suggestions.map((item, index) => (
                      <li key={index} className="text-sm text-green-700">{item}</li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </PullToRefresh>
  );
}