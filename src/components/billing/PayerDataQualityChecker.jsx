import React, { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { base44 } from "@/api/base44Client";
import { 
  Shield, 
  AlertTriangle, 
  CheckCircle2, 
  Loader2,
  FileWarning,
  Phone,
  Globe,
  Code,
  Copy,
  TrendingUp
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function PayerDataQualityChecker() {
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [error, setError] = useState(null);

  const runQualityCheck = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await base44.functions.invoke('analyzePayerDataQuality', {});
      setAnalysis(response.data);
    } catch (err) {
      setError(err.message || 'Failed to analyze payer data');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const getSeverityColor = (severity) => {
    switch (severity?.toLowerCase()) {
      case 'high':
      case 'critical':
        return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
      case 'medium':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
      case 'low':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
      default:
        return 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200';
    }
  };

  const getConfidenceColor = (confidence) => {
    switch (confidence?.toLowerCase()) {
      case 'high':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
      case 'medium':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
      case 'low':
        return 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200';
      default:
        return 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200';
    }
  };

  const totalIssues = analysis ? 
    (analysis.duplicates?.length || 0) + 
    (analysis.billingCodeIssues?.length || 0) + 
    (analysis.contactIssues?.length || 0) : 0;

  return (
    <Card className="border-slate-200 dark:border-slate-700">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-blue-600" />
              AI Data Quality Checker
            </CardTitle>
            <CardDescription>
              Automated detection of duplicates, inconsistencies, and data quality issues
            </CardDescription>
          </div>
          <Button
            onClick={runQualityCheck}
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Shield className="w-4 h-4 mr-2" />
                Run Quality Check
              </>
            )}
          </Button>
        </div>
      </CardHeader>

      {error && (
        <CardContent>
          <Alert className="border-red-200 bg-red-50 dark:bg-red-900/20">
            <AlertTriangle className="w-4 h-4 text-red-600" />
            <AlertDescription className="text-red-800 dark:text-red-200">
              {error}
            </AlertDescription>
          </Alert>
        </CardContent>
      )}

      {analysis && (
        <CardContent>
          {/* Summary Stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-lg">
              <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                {analysis.total_payers_analyzed || 0}
              </div>
              <div className="text-sm text-slate-600 dark:text-slate-400">Payers Analyzed</div>
            </div>
            <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded-lg">
              <div className="text-2xl font-bold text-red-600">{analysis.duplicates?.length || 0}</div>
              <div className="text-sm text-slate-600 dark:text-slate-400">Potential Duplicates</div>
            </div>
            <div className="bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded-lg">
              <div className="text-2xl font-bold text-yellow-600">{analysis.billingCodeIssues?.length || 0}</div>
              <div className="text-sm text-slate-600 dark:text-slate-400">Billing Code Issues</div>
            </div>
            <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
              <div className="text-2xl font-bold text-blue-600">{analysis.contactIssues?.length || 0}</div>
              <div className="text-sm text-slate-600 dark:text-slate-400">Contact Issues</div>
            </div>
          </div>

          {totalIssues === 0 ? (
            <Alert className="border-green-200 bg-green-50 dark:bg-green-900/20">
              <CheckCircle2 className="w-4 h-4 text-green-600" />
              <AlertDescription className="text-green-800 dark:text-green-200">
                No data quality issues detected! Your payer database is in excellent shape.
              </AlertDescription>
            </Alert>
          ) : (
            <Tabs defaultValue="duplicates" className="w-full">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="duplicates" className="flex items-center gap-2">
                  <Copy className="w-4 h-4" />
                  Duplicates ({analysis.duplicates?.length || 0})
                </TabsTrigger>
                <TabsTrigger value="billing" className="flex items-center gap-2">
                  <Code className="w-4 h-4" />
                  Billing ({analysis.billingCodeIssues?.length || 0})
                </TabsTrigger>
                <TabsTrigger value="contact" className="flex items-center gap-2">
                  <Phone className="w-4 h-4" />
                  Contact ({analysis.contactIssues?.length || 0})
                </TabsTrigger>
                <TabsTrigger value="suggestions" className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" />
                  Suggestions ({analysis.suggestions?.length || 0})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="duplicates" className="space-y-3">
                {analysis.duplicates?.length === 0 ? (
                  <p className="text-sm text-slate-500 text-center py-8">No duplicate entries detected</p>
                ) : (
                  analysis.duplicates?.map((dup, idx) => (
                    <Card key={idx} className="border-orange-200 dark:border-orange-800">
                      <CardContent className="pt-4">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Copy className="w-4 h-4 text-orange-600" />
                            <span className="font-medium">Potential Duplicate Found</span>
                          </div>
                          <Badge className={getConfidenceColor(dup.confidence)}>
                            {dup.confidence} confidence
                          </Badge>
                        </div>
                        <div className="space-y-2">
                          <div>
                            <span className="text-sm font-medium">Payers:</span>
                            <div className="text-sm text-slate-600 dark:text-slate-400 ml-2">
                              {dup.payer_names?.join(' ↔ ')}
                            </div>
                          </div>
                          <div>
                            <span className="text-sm font-medium">Reason:</span>
                            <p className="text-sm text-slate-600 dark:text-slate-400 ml-2">{dup.reason}</p>
                          </div>
                          <div className="bg-blue-50 dark:bg-blue-900/20 p-2 rounded mt-2">
                            <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                              Suggested Action:
                            </span>
                            <p className="text-sm text-blue-600 dark:text-blue-400 ml-2">
                              {dup.suggested_action}
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
              </TabsContent>

              <TabsContent value="billing" className="space-y-3">
                {analysis.billingCodeIssues?.length === 0 ? (
                  <p className="text-sm text-slate-500 text-center py-8">No billing code issues detected</p>
                ) : (
                  analysis.billingCodeIssues?.map((issue, idx) => (
                    <Card key={idx} className="border-yellow-200 dark:border-yellow-800">
                      <CardContent className="pt-4">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <FileWarning className="w-4 h-4 text-yellow-600" />
                            <span className="font-medium">{issue.payer_name}</span>
                          </div>
                          <Badge className={getSeverityColor(issue.severity)}>
                            {issue.severity} severity
                          </Badge>
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">Code:</span>
                            <code className="bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded text-sm">
                              {issue.code}
                            </code>
                          </div>
                          <div>
                            <span className="text-sm font-medium">Issue:</span>
                            <p className="text-sm text-slate-600 dark:text-slate-400 ml-2">{issue.issue}</p>
                          </div>
                          {issue.suggestion && (
                            <div className="bg-green-50 dark:bg-green-900/20 p-2 rounded mt-2">
                              <span className="text-sm font-medium text-green-700 dark:text-green-300">
                                Suggestion:
                              </span>
                              <p className="text-sm text-green-600 dark:text-green-400 ml-2">
                                {issue.suggestion}
                              </p>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
              </TabsContent>

              <TabsContent value="contact" className="space-y-3">
                {analysis.contactIssues?.length === 0 ? (
                  <p className="text-sm text-slate-500 text-center py-8">No contact information issues detected</p>
                ) : (
                  analysis.contactIssues?.map((issue, idx) => (
                    <Card key={idx} className="border-blue-200 dark:border-blue-800">
                      <CardContent className="pt-4">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            {issue.field === 'phone' ? (
                              <Phone className="w-4 h-4 text-blue-600" />
                            ) : (
                              <Globe className="w-4 h-4 text-blue-600" />
                            )}
                            <span className="font-medium">{issue.payer_name}</span>
                          </div>
                          <Badge variant="outline">{issue.field}</Badge>
                        </div>
                        <div className="space-y-2">
                          <div>
                            <span className="text-sm font-medium">Current Value:</span>
                            <code className="block bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded text-sm mt-1">
                              {issue.current_value || 'Not provided'}
                            </code>
                          </div>
                          <div>
                            <span className="text-sm font-medium">Issue:</span>
                            <p className="text-sm text-slate-600 dark:text-slate-400 ml-2">{issue.issue}</p>
                          </div>
                          {issue.suggested_correction && issue.suggested_correction !== 'N/A' && (
                            <div className="bg-green-50 dark:bg-green-900/20 p-2 rounded mt-2">
                              <span className="text-sm font-medium text-green-700 dark:text-green-300">
                                Suggested Correction:
                              </span>
                              <code className="block bg-green-100 dark:bg-green-900/30 px-2 py-1 rounded text-sm mt-1 text-green-700 dark:text-green-300">
                                {issue.suggested_correction}
                              </code>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
              </TabsContent>

              <TabsContent value="suggestions" className="space-y-3">
                {analysis.suggestions?.length === 0 ? (
                  <p className="text-sm text-slate-500 text-center py-8">No general suggestions</p>
                ) : (
                  analysis.suggestions?.map((suggestion, idx) => (
                    <Card key={idx} className="border-purple-200 dark:border-purple-800">
                      <CardContent className="pt-4">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <TrendingUp className="w-4 h-4 text-purple-600" />
                            <span className="font-medium capitalize">{suggestion.category}</span>
                          </div>
                          <Badge className={getSeverityColor(suggestion.priority)}>
                            {suggestion.priority} priority
                          </Badge>
                        </div>
                        <p className="text-sm text-slate-700 dark:text-slate-300 mb-2">
                          {suggestion.description}
                        </p>
                        {suggestion.affected_payers?.length > 0 && (
                          <div className="text-xs text-slate-500">
                            Affects {suggestion.affected_payers.length} payer(s)
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))
                )}
              </TabsContent>
            </Tabs>
          )}

          {analysis.analysis_date && (
            <div className="text-xs text-slate-500 text-center mt-4">
              Analysis completed: {new Date(analysis.analysis_date).toLocaleString()}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}