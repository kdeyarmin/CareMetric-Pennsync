import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import { base44 } from "@/api/base44Client";
import { 
  Sparkles, 
  FileSearch, 
  GitCompare, 
  Loader2, 
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  Calendar,
  Copy,
  Download
} from "lucide-react";
import { toast } from "sonner";

export default function AdvancedDocumentAnalysis({ selectedAnalysisIds, onClose }) {
  const [activeTab, setActiveTab] = useState('summary');
  const [customQuery, setCustomQuery] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState(null);

  const handleAnalysis = async (operationType, query = null) => {
    if (selectedAnalysisIds.length === 0) {
      toast.error('Please select at least one document analysis');
      return;
    }

    if (selectedAnalysisIds.length < 2 && operationType !== 'extract_by_query') {
      toast.error('Please select at least 2 documents for this analysis');
      return;
    }

    if (operationType === 'extract_by_query' && !query?.trim()) {
      toast.error('Please enter a query');
      return;
    }

    setAnalyzing(true);
    setResult(null);

    try {
      const response = await base44.functions.invoke('advancedDocumentAnalysis', {
        analysis_ids: selectedAnalysisIds,
        operation_type: operationType,
        query: query || undefined
      });

      if (response?.data?.result) {
        setResult({ ...response.data.result, operation_type: operationType });
        toast.success('Analysis complete');
      } else {
        throw new Error('Invalid response format');
      }
    } catch (error) {
      toast.error('Analysis failed: ' + error.message);
      console.error(error);
    } finally {
      setAnalyzing(false);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  return (
    <div className="space-y-4">
      <Alert>
        <Sparkles className="w-4 h-4" />
        <AlertDescription>
          Advanced AI analysis across {selectedAnalysisIds.length} selected document{selectedAnalysisIds.length !== 1 ? 's' : ''}
        </AlertDescription>
      </Alert>

      {/* Analysis Type Tabs */}
      <div className="flex flex-wrap gap-2">
        <Button
          variant={activeTab === 'summary' ? 'default' : 'outline'}
          onClick={() => setActiveTab('summary')}
          size="sm"
        >
          <Sparkles className="w-4 h-4 mr-2" />
          Multi-Doc Summary
        </Button>
        <Button
          variant={activeTab === 'contradictions' ? 'default' : 'outline'}
          onClick={() => setActiveTab('contradictions')}
          size="sm"
        >
          <GitCompare className="w-4 h-4 mr-2" />
          Find Contradictions
        </Button>
        <Button
          variant={activeTab === 'query' ? 'default' : 'outline'}
          onClick={() => setActiveTab('query')}
          size="sm"
        >
          <FileSearch className="w-4 h-4 mr-2" />
          Query Data
        </Button>
      </div>

      {/* Content Area */}
      {activeTab === 'summary' && (
        <Card>
          <CardHeader>
            <CardTitle>Multi-Document Summary</CardTitle>
            <CardDescription>
              Generate a comprehensive summary synthesizing key findings across all selected documents
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() => handleAnalysis('multi_document_summary')}
              disabled={analyzing || selectedAnalysisIds.length < 2}
              className="w-full"
            >
              {analyzing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Generate Summary
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {activeTab === 'contradictions' && (
        <Card>
          <CardHeader>
            <CardTitle>Detect Contradictions</CardTitle>
            <CardDescription>
              Identify inconsistencies, conflicts, and discrepancies across documents
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() => handleAnalysis('detect_contradictions')}
              disabled={analyzing || selectedAnalysisIds.length < 2}
              className="w-full bg-amber-600 hover:bg-amber-700"
            >
              {analyzing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <GitCompare className="w-4 h-4 mr-2" />
                  Detect Contradictions
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {activeTab === 'query' && (
        <Card>
          <CardHeader>
            <CardTitle>Extract Data by Query</CardTitle>
            <CardDescription>
              Ask a specific question and extract relevant data from all documents
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">
                What would you like to find?
              </label>
              <Textarea
                placeholder="e.g., 'Find all diagnoses mentioned for patient', 'Show medication changes over time', 'List all lab results for glucose'"
                value={customQuery}
                onChange={(e) => setCustomQuery(e.target.value)}
                rows={3}
              />
            </div>
            <Button
              onClick={() => handleAnalysis('extract_by_query', customQuery)}
              disabled={analyzing || !customQuery.trim()}
              className="w-full bg-blue-600 hover:bg-blue-700"
            >
              {analyzing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Searching...
                </>
              ) : (
                <>
                  <FileSearch className="w-4 h-4 mr-2" />
                  Extract Data
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Results Display */}
      {result && (
        <div className="space-y-4">
          {/* Multi-Document Summary Results */}
          {result.operation_type === 'multi_document_summary' && (
            <>
              <Card className="border-2 border-green-200 dark:border-green-800">
                <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950 dark:to-emerald-950">
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5 text-green-600" />
                      Comprehensive Summary
                    </CardTitle>
                    <Button size="sm" variant="ghost" onClick={() => copyToClipboard(result.comprehensive_summary)}>
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="pt-6">
                  <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                    {result.comprehensive_summary}
                  </p>
                </CardContent>
              </Card>

              {result.key_findings && result.key_findings.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>Key Findings Across Documents</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {result.key_findings.map((finding, index) => (
                      <div key={index} className="p-4 bg-blue-50 dark:bg-blue-950 border-l-4 border-blue-500 rounded-lg">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <Badge variant="outline">{finding.category}</Badge>
                              <Badge className={
                                finding.significance === 'critical' ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' :
                                finding.significance === 'important' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200' :
                                'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200'
                              }>
                                {finding.significance}
                              </Badge>
                            </div>
                            <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
                              {finding.finding}
                            </p>
                            {finding.source_documents && (
                              <p className="text-xs text-blue-700 dark:text-blue-300 mt-2">
                                Sources: {finding.source_documents.join(', ')}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {result.trends && result.trends.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <TrendingUp className="w-5 h-5" />
                      Trends Over Time
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {result.trends.map((trend, index) => (
                      <div key={index} className="p-3 bg-purple-50 dark:bg-purple-950 rounded-lg">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge className={
                            trend.direction === 'improving' ? 'bg-green-100 text-green-800' :
                            trend.direction === 'worsening' ? 'bg-red-100 text-red-800' :
                            trend.direction === 'stable' ? 'bg-blue-100 text-blue-800' :
                            'bg-amber-100 text-amber-800'
                          }>
                            {trend.direction}
                          </Badge>
                        </div>
                        <p className="text-sm font-medium text-purple-900 dark:text-purple-100">
                          {trend.trend}
                        </p>
                        <p className="text-xs text-purple-700 dark:text-purple-300 mt-1">
                          {trend.evidence}
                        </p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {result.integrated_diagnosis_list && result.integrated_diagnosis_list.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>Integrated Diagnosis List</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {result.integrated_diagnosis_list.map((dx, index) => (
                      <div key={index} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
                        <div>
                          <p className="text-sm font-medium">{dx.diagnosis}</p>
                          {dx.icd10_code && <p className="text-xs text-slate-500">{dx.icd10_code}</p>}
                        </div>
                        <Badge variant="outline">{dx.status}</Badge>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </>
          )}

          {/* Contradictions Results */}
          {result.operation_type === 'detect_contradictions' && (
            <>
              <Card className="border-2 border-amber-200 dark:border-amber-800">
                <CardHeader className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950 dark:to-orange-950">
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <AlertTriangle className="w-5 h-5 text-amber-600" />
                      Contradiction Analysis
                    </CardTitle>
                    <Badge variant="outline">
                      {result.contradictions_found} found
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between mb-4 p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
                    <span className="text-sm font-medium">Consistency Score</span>
                    <div className="flex items-center gap-2">
                      <div className="w-32 bg-slate-200 dark:bg-slate-700 rounded-full h-2">
                        <div 
                          className={`h-2 rounded-full ${
                            result.consistency_score >= 80 ? 'bg-green-500' :
                            result.consistency_score >= 60 ? 'bg-amber-500' :
                            'bg-red-500'
                          }`}
                          style={{ width: `${result.consistency_score}%` }}
                        />
                      </div>
                      <span className="text-sm font-bold">{result.consistency_score}%</span>
                    </div>
                  </div>
                  <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                    {result.summary}
                  </p>
                </CardContent>
              </Card>

              {result.contradictions && result.contradictions.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>Identified Contradictions</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {result.contradictions.map((contradiction, index) => (
                      <div 
                        key={index} 
                        className={`p-4 border-l-4 rounded-lg ${
                          contradiction.severity === 'critical' ? 'bg-red-50 dark:bg-red-950 border-red-500' :
                          contradiction.severity === 'high' ? 'bg-orange-50 dark:bg-orange-950 border-orange-500' :
                          contradiction.severity === 'medium' ? 'bg-amber-50 dark:bg-amber-950 border-amber-500' :
                          'bg-yellow-50 dark:bg-yellow-950 border-yellow-500'
                        }`}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">{contradiction.category}</Badge>
                            <Badge className={
                              contradiction.severity === 'critical' ? 'bg-red-100 text-red-800' :
                              contradiction.severity === 'high' ? 'bg-orange-100 text-orange-800' :
                              contradiction.severity === 'medium' ? 'bg-amber-100 text-amber-800' :
                              'bg-yellow-100 text-yellow-800'
                            }>
                              {contradiction.severity}
                            </Badge>
                          </div>
                          {contradiction.requires_provider_review && (
                            <Badge variant="destructive">Review Required</Badge>
                          )}
                        </div>
                        
                        <p className="text-sm font-medium mb-3">{contradiction.description}</p>
                        
                        <div className="space-y-2 mb-3">
                          <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">Conflicting Values:</p>
                          {contradiction.conflicting_values?.map((value, vidx) => (
                            <div key={vidx} className="pl-3 border-l-2 border-slate-300 dark:border-slate-600">
                              <p className="text-sm"><strong>"{value.value}"</strong></p>
                              <p className="text-xs text-slate-600 dark:text-slate-400">
                                From: {value.source_document} ({value.date})
                              </p>
                            </div>
                          ))}
                        </div>
                        
                        <div className="p-3 bg-white dark:bg-slate-900 rounded-lg space-y-2">
                          <p className="text-xs font-semibold">Clinical Impact:</p>
                          <p className="text-sm">{contradiction.clinical_impact}</p>
                          
                          <p className="text-xs font-semibold mt-2">Resolution:</p>
                          <p className="text-sm">{contradiction.resolution_recommendation}</p>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {result.recommendations && result.recommendations.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>Recommended Actions</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {result.recommendations.map((rec, index) => (
                      <div key={index} className="flex items-start gap-3 p-3 bg-blue-50 dark:bg-blue-950 rounded-lg">
                        <Badge className={
                          rec.priority === 'urgent' ? 'bg-red-100 text-red-800' :
                          rec.priority === 'high' ? 'bg-orange-100 text-orange-800' :
                          rec.priority === 'medium' ? 'bg-amber-100 text-amber-800' :
                          'bg-blue-100 text-blue-800'
                        }>
                          {rec.priority}
                        </Badge>
                        <p className="text-sm flex-1">{rec.action}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </>
          )}

          {/* Query Results */}
          {result.operation_type === 'extract_by_query' && (
            <>
              <Card className="border-2 border-blue-200 dark:border-blue-800">
                <CardHeader className="bg-gradient-to-r from-blue-50 to-cyan-50 dark:from-blue-950 dark:to-cyan-950">
                  <CardTitle className="flex items-center gap-2">
                    <FileSearch className="w-5 h-5 text-blue-600" />
                    Query Results
                  </CardTitle>
                  <CardDescription>
                    <strong>Query:</strong> {result.query}
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-6 space-y-4">
                  <div className="flex items-center gap-4 p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
                    <div>
                      <p className="text-2xl font-bold">{result.total_matches}</p>
                      <p className="text-xs text-slate-600 dark:text-slate-400">Matches Found</p>
                    </div>
                    <div className="h-8 w-px bg-slate-300 dark:bg-slate-600" />
                    <div>
                      <p className="text-2xl font-bold">{result.documents_searched}</p>
                      <p className="text-xs text-slate-600 dark:text-slate-400">Documents Searched</p>
                    </div>
                  </div>

                  <div>
                    <h4 className="font-semibold mb-2">Summary:</h4>
                    <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap bg-slate-50 dark:bg-slate-800 p-4 rounded-lg">
                      {result.summary}
                    </p>
                  </div>
                </CardContent>
              </Card>

              {result.extracted_data && result.extracted_data.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>Extracted Data Points</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {result.extracted_data.map((item, index) => (
                      <div key={index} className="p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
                        <div className="flex items-start justify-between mb-2">
                          <p className="text-sm font-medium flex-1">{item.data_point}</p>
                          <Badge className={
                            item.confidence === 'high' ? 'bg-green-100 text-green-800' :
                            item.confidence === 'medium' ? 'bg-amber-100 text-amber-800' :
                            'bg-slate-100 text-slate-800'
                          }>
                            {item.confidence}
                          </Badge>
                        </div>
                        <p className="text-sm font-bold text-blue-600 dark:text-blue-400 mb-2">
                          {item.value}
                        </p>
                        <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                          <Calendar className="w-3 h-3" />
                          <span>{item.document_date}</span>
                          <span>•</span>
                          <span>{item.source_document}</span>
                        </div>
                        {item.context && (
                          <p className="text-xs text-slate-600 dark:text-slate-400 mt-2 italic">
                            {item.context}
                          </p>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </>
          )}

          <div className="flex gap-3">
            <Button onClick={() => setResult(null)} variant="outline" className="flex-1">
              New Analysis
            </Button>
            <Button onClick={() => copyToClipboard(JSON.stringify(result, null, 2))} variant="outline">
              <Copy className="w-4 h-4 mr-2" />
              Copy All
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}