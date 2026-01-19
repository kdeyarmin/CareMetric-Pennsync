import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CheckCircle, AlertTriangle, Link2, HelpCircle, Calendar, AlertCircle, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function CrossDocumentAnalysis({ 
  analysisData, 
  fileNames = [],
  isLoading = false,
  onRefresh = null 
}) {
  const [expandedSections, setExpandedSections] = useState({});

  if (isLoading) {
    return (
      <Card className="border-blue-200 dark:border-blue-900">
        <CardContent className="py-8 flex items-center justify-center gap-2">
          <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
          <span className="text-slate-600 dark:text-slate-400">Analyzing document relationships...</span>
        </CardContent>
      </Card>
    );
  }

  if (!analysisData) return null;

  const toggleSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case "critical": return "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200";
      case "high": return "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200";
      case "medium": return "bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200";
      case "low": return "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200";
      default: return "bg-slate-100 text-slate-800 dark:bg-slate-900 dark:text-slate-200";
    }
  };

  const getConfidenceColor = (confidence) => {
    switch (confidence) {
      case "high": return "text-green-700 dark:text-green-300";
      case "medium": return "text-yellow-700 dark:text-yellow-300";
      case "low": return "text-orange-700 dark:text-orange-300";
      default: return "text-slate-700 dark:text-slate-300";
    }
  };

  return (
    <div className="space-y-6">
      {/* Consolidated Summary */}
      <Card className="border-l-4 border-l-indigo-600">
        <CardHeader>
          <CardTitle className="text-lg">Consolidated Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap bg-slate-50 dark:bg-slate-800 p-4 rounded-lg">
            {analysisData.consolidated_summary}
          </p>
        </CardContent>
      </Card>

      {/* Tabs for detailed analysis */}
      <Tabs defaultValue="key-findings" className="w-full">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="key-findings" className="text-xs md:text-sm">
            <span className="hidden sm:inline">Key Findings</span>
            <span className="sm:hidden">Findings</span>
          </TabsTrigger>
          <TabsTrigger value="consistencies" className="text-xs md:text-sm">
            <span className="hidden sm:inline">Consistent</span>
            <span className="sm:hidden">✓</span>
          </TabsTrigger>
          <TabsTrigger value="discrepancies" className="text-xs md:text-sm">
            <span className="hidden sm:inline">Discrepancies</span>
            <span className="sm:hidden">⚠</span>
          </TabsTrigger>
          <TabsTrigger value="correlations" className="text-xs md:text-sm">
            Links
          </TabsTrigger>
          <TabsTrigger value="investigation" className="text-xs md:text-sm">
            <span className="hidden sm:inline">Investigation</span>
            <span className="sm:hidden">?</span>
          </TabsTrigger>
        </TabsList>

        {/* Key Findings */}
        <TabsContent value="key-findings" className="space-y-4">
          {analysisData.key_findings_by_document?.map((doc, idx) => (
            <Card key={idx}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  {doc.document_name}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {doc.findings?.map((finding, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="text-indigo-600 dark:text-indigo-400 font-bold">•</span>
                      <span className="text-sm text-slate-700 dark:text-slate-300">{finding}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* Consistencies */}
        <TabsContent value="consistencies" className="space-y-4">
          {analysisData.cross_document_analysis?.consistencies?.length > 0 ? (
            analysisData.cross_document_analysis.consistencies.map((item, idx) => (
              <Card key={idx} className="border-l-4 border-l-green-600">
                <CardContent className="pt-6 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <p className="font-medium text-slate-900 dark:text-slate-100">{item.finding}</p>
                      <div className="mt-2 flex items-center gap-2">
                        <span className="text-xs text-slate-600 dark:text-slate-400">Confirmed in:</span>
                        <div className="flex flex-wrap gap-1">
                          {item.documents_supporting?.map((doc, i) => (
                            <Badge key={i} variant="outline" className="text-xs">
                              {doc}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                    <Badge className={getConfidenceColor(item.confidence)}>
                      {item.confidence}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))
          ) : (
            <Card>
              <CardContent className="py-6 text-center">
                <CheckCircle className="w-8 h-8 text-green-600 mx-auto mb-2" />
                <p className="text-sm text-slate-600 dark:text-slate-400">No discrepancies - documents are consistent</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Discrepancies */}
        <TabsContent value="discrepancies" className="space-y-4">
          {analysisData.cross_document_analysis?.discrepancies?.length > 0 ? (
            analysisData.cross_document_analysis.discrepancies.map((item, idx) => (
              <Alert key={idx} className="border-2 border-orange-300 dark:border-orange-700 bg-orange-50 dark:bg-orange-950">
                <AlertTriangle className="h-4 w-4 text-orange-600" />
                <AlertDescription className="space-y-3">
                  <div>
                    <p className="font-semibold text-orange-900 dark:text-orange-100">{item.finding}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-xs font-medium text-orange-800 dark:text-orange-300">{item.document_1}</p>
                      <p className="text-orange-700 dark:text-orange-200 mt-1">{item.value_or_statement_1}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-orange-800 dark:text-orange-300">{item.document_2}</p>
                      <p className="text-orange-700 dark:text-orange-200 mt-1">{item.value_or_statement_2}</p>
                    </div>
                  </div>
                  <div className="pt-2 border-t border-orange-200 dark:border-orange-800">
                    <p className="text-xs font-medium text-orange-800 dark:text-orange-300">Clinical Significance:</p>
                    <p className="text-sm text-orange-700 dark:text-orange-200 mt-1">{item.clinical_significance}</p>
                  </div>
                  <div className="bg-white dark:bg-slate-900 p-2 rounded">
                    <p className="text-xs font-medium text-slate-700 dark:text-slate-300">Recommended Action:</p>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{item.recommended_action}</p>
                  </div>
                </AlertDescription>
              </Alert>
            ))
          ) : (
            <Card>
              <CardContent className="py-6 text-center">
                <CheckCircle className="w-8 h-8 text-green-600 mx-auto mb-2" />
                <p className="text-sm text-slate-600 dark:text-slate-400">No discrepancies found</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Correlations */}
        <TabsContent value="correlations" className="space-y-4">
          {analysisData.cross_document_analysis?.correlations?.length > 0 ? (
            analysisData.cross_document_analysis.correlations.map((item, idx) => (
              <Card key={idx} className="border-l-4 border-l-blue-600">
                <CardContent className="pt-6 space-y-3">
                  <div className="flex items-start gap-3">
                    <Link2 className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                      <p className="font-medium text-slate-900 dark:text-slate-100">{item.correlation}</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {item.documents_involved?.map((doc, i) => (
                          <Badge key={i} className="bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200 text-xs">
                            {doc}
                          </Badge>
                        ))}
                      </div>
                      <p className="text-sm text-slate-600 dark:text-slate-400 mt-3">
                        <span className="font-medium">Clinical Implication:</span> {item.clinical_implication}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          ) : (
            <Card>
              <CardContent className="py-6 text-center">
                <Link2 className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="text-sm text-slate-600 dark:text-slate-400">No significant correlations identified</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Investigation Areas */}
        <TabsContent value="investigation" className="space-y-4">
          {analysisData.investigation_areas?.length > 0 ? (
            analysisData.investigation_areas.map((item, idx) => (
              <Card key={idx} className="border-l-4 border-l-purple-600">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <CardTitle className="text-base flex items-start gap-2">
                        <HelpCircle className="w-5 h-5 text-purple-600 mt-0.5 flex-shrink-0" />
                        {item.question}
                      </CardTitle>
                    </div>
                    <Badge className={getPriorityColor(item.priority)}>
                      {item.priority}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <p className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Source Documents:</p>
                    <div className="flex flex-wrap gap-1">
                      {item.documents_referenced?.map((doc, i) => (
                        <Badge key={i} variant="outline" className="text-xs">
                          {doc}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Investigation Method:</p>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{item.suggested_investigation_method}</p>
                  </div>

                  <div className="pt-2 border-t">
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Rationale:</p>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{item.clinical_rationale}</p>
                  </div>
                </CardContent>
              </Card>
            ))
          ) : (
            <Card>
              <CardContent className="py-6 text-center">
                <CheckCircle className="w-8 h-8 text-green-600 mx-auto mb-2" />
                <p className="text-sm text-slate-600 dark:text-slate-400">No outstanding investigation areas identified</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Timeline Reconstruction */}
      {analysisData.timeline_reconstruction?.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="w-5 h-5" />
              Clinical Timeline
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {analysisData.timeline_reconstruction.map((event, idx) => (
                <div key={idx} className="flex gap-4">
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 min-w-24">
                    {event.date}
                  </div>
                  <div className="flex-1 space-y-2">
                    <p className="text-sm text-slate-700 dark:text-slate-300">{event.event}</p>
                    <div className="flex flex-wrap gap-1">
                      {event.source_documents?.map((doc, i) => (
                        <Badge key={i} variant="outline" className="text-xs">
                          {doc}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Documentation Gaps */}
      {analysisData.gaps_in_documentation?.length > 0 && (
        <Alert className="border-2 border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950">
          <AlertCircle className="h-4 w-4 text-red-600" />
          <AlertDescription>
            <p className="font-semibold text-red-900 dark:text-red-100 mb-2">Documentation Gaps:</p>
            <ul className="space-y-1">
              {analysisData.gaps_in_documentation.map((gap, idx) => (
                <li key={idx} className="text-sm text-red-800 dark:text-red-200 flex gap-2">
                  <span className="font-bold">•</span>
                  <span>{gap}</span>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* Refresh Button */}
      {onRefresh && (
        <div className="flex justify-center">
          <Button onClick={onRefresh} variant="outline" size="sm">
            Refresh Analysis
          </Button>
        </div>
      )}
    </div>
  );
}