import { useState } from "react";
import { openExternalUrl } from "@/components/utils/security";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  FileText, AlertCircle, CheckCircle2, Clock,
  RefreshCw, TrendingUp, Brain, Zap, Download, Search
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

export default function FaxLogsDashboard() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const ai = useAICall();
  const [aiInsights, setAiInsights] = useState(null);

  const { data: faxLogs = [], isLoading, refetch } = useQuery({
    queryKey: ['fax-logs-dashboard'],
    queryFn: () => base44.entities.FaxLog.list('-created_date', 100),
    initialData: [],
  });

  const filteredLogs = faxLogs.filter(log => {
    const matchesSearch = searchQuery === "" || 
      log.to_number?.includes(searchQuery) ||
      log.to_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.document_name?.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStatus = selectedStatus === "all" || log.status === selectedStatus;
    
    return matchesSearch && matchesStatus;
  });

  // Statistics
  const stats = {
    total: faxLogs.length,
    sent: faxLogs.filter(f => f.status === 'sent' || f.status === 'delivered').length,
    failed: faxLogs.filter(f => f.status === 'failed').length,
    pending: faxLogs.filter(f => f.status === 'queued' || f.status === 'sending').length,
  };

  const failedLogs = faxLogs.filter(f => f.status === 'failed');

  const generateAIInsights = async () => {
    try {
      const failureAnalysis = failedLogs.map(log => ({
        to: log.to_number,
        name: log.to_name,
        failure_reason: log.failure_reason,
        retry_count: log.retry_count || 0,
        document: log.document_name,
        date: log.created_date,
      }));

      const result = await ai.run({
        model: "claude_sonnet_4_6",
        prompt: `Analyze these fax transmission failures and provide:
1. Common failure patterns and root causes
2. Specific recommendations for each failure type
3. Automated retry logic suggestions (timing, conditions)
4. Prevention strategies for future failures

Failed Faxes Data:
${JSON.stringify(failureAnalysis, null, 2)}

Provide actionable insights in a structured format with clear sections.`,
        response_json_schema: {
          type: "object",
          properties: {
            summary: { type: "string" },
            common_patterns: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  pattern: { type: "string" },
                  count: { type: "number" },
                  severity: { type: "string" },
                  recommendation: { type: "string" }
                }
              }
            },
            retry_strategy: {
              type: "object",
              properties: {
                immediate_retry: { type: "array", items: { type: "string" } },
                delayed_retry: { type: "array", items: { type: "string" } },
                manual_review: { type: "array", items: { type: "string" } }
              }
            },
            prevention_tips: { type: "array", items: { type: "string" } }
          }
        }
      });

      setAiInsights(result);
      toast.success("AI insights generated successfully");
    } catch (error) {
      toast.error("Failed to generate insights: " + error.message);
    }
  };

  const retryFax = async (faxId) => {
    try {
      await base44.functions.invoke('retryFailedFax', { fax_id: faxId });
      toast.success("Fax retry initiated");
      refetch();
    } catch (error) {
      toast.error("Failed to retry fax: " + error.message);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'sent':
      case 'delivered':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'failed':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'sending':
      case 'queued':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      default:
        return 'bg-slate-100 text-slate-800 border-slate-200';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'sent':
      case 'delivered':
        return <CheckCircle2 className="w-4 h-4" />;
      case 'failed':
        return <AlertCircle className="w-4 h-4" />;
      default:
        return <Clock className="w-4 h-4" />;
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-3">
          <RefreshCw className="w-8 h-8 animate-spin text-indigo-600 mx-auto" />
          <p className="text-slate-600">Loading fax logs...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex justify-end">
        <Button
          onClick={generateAIInsights}
          disabled={ai.loading || failedLogs.length === 0}
          className="bg-gradient-to-r from-navy-600 to-indigo-600"
        >
          <Brain className="w-4 h-4 mr-2" />
          {ai.loading ? "Analyzing..." : "Generate AI Insights"}
        </Button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">Total Faxes</p>
                <p className="text-2xl font-bold text-slate-900 mt-1">{stats.total}</p>
              </div>
              <FileText className="w-8 h-8 text-slate-400" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">Successfully Sent</p>
                <p className="text-2xl font-bold text-green-600 mt-1">{stats.sent}</p>
              </div>
              <CheckCircle2 className="w-8 h-8 text-green-400" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">Failed</p>
                <p className="text-2xl font-bold text-red-600 mt-1">{stats.failed}</p>
              </div>
              <AlertCircle className="w-8 h-8 text-red-400" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">Pending</p>
                <p className="text-2xl font-bold text-blue-600 mt-1">{stats.pending}</p>
              </div>
              <Clock className="w-8 h-8 text-blue-400" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* AI Insights Section */}
      {aiInsights && (
        <Card className="bg-gradient-to-br from-navy-50 to-indigo-50 border-navy-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Brain className="w-5 h-5 text-navy-600" />
              AI-Powered Insights
            </CardTitle>
            <CardDescription>Automated analysis of fax transmission patterns</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Summary */}
            <div>
              <h3 className="font-semibold text-slate-900 mb-2">Summary</h3>
              <p className="text-slate-700">{aiInsights.summary}</p>
            </div>

            {/* Common Patterns */}
            {aiInsights.common_patterns?.length > 0 && (
              <div>
                <h3 className="font-semibold text-slate-900 mb-3">Common Failure Patterns</h3>
                <div className="space-y-3">
                  {aiInsights.common_patterns.map((pattern, idx) => (
                    <Card key={idx} className="bg-white">
                      <CardContent className="pt-4">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1">
                            <p className="font-medium text-slate-900">{pattern.pattern}</p>
                            <p className="text-sm text-slate-600 mt-1">{pattern.recommendation}</p>
                          </div>
                          <Badge className={
                            pattern.severity === 'high' ? 'bg-red-100 text-red-800' :
                            pattern.severity === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                            'bg-blue-100 text-blue-800'
                          }>
                            {pattern.count} occurrences
                          </Badge>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Retry Strategy */}
            {aiInsights.retry_strategy && (
              <div>
                <h3 className="font-semibold text-slate-900 mb-3">Automated Retry Strategy</h3>
                <div className="grid md:grid-cols-3 gap-4">
                  <Card className="bg-white">
                    <CardContent className="pt-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Zap className="w-4 h-4 text-green-600" />
                        <h4 className="font-medium text-slate-900">Immediate Retry</h4>
                      </div>
                      <ul className="space-y-1 text-sm text-slate-600">
                        {aiInsights.retry_strategy.immediate_retry?.map((item, idx) => (
                          <li key={idx}>• {item}</li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>

                  <Card className="bg-white">
                    <CardContent className="pt-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Clock className="w-4 h-4 text-blue-600" />
                        <h4 className="font-medium text-slate-900">Delayed Retry</h4>
                      </div>
                      <ul className="space-y-1 text-sm text-slate-600">
                        {aiInsights.retry_strategy.delayed_retry?.map((item, idx) => (
                          <li key={idx}>• {item}</li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>

                  <Card className="bg-white">
                    <CardContent className="pt-4">
                      <div className="flex items-center gap-2 mb-2">
                        <AlertCircle className="w-4 h-4 text-red-600" />
                        <h4 className="font-medium text-slate-900">Manual Review</h4>
                      </div>
                      <ul className="space-y-1 text-sm text-slate-600">
                        {aiInsights.retry_strategy.manual_review?.map((item, idx) => (
                          <li key={idx}>• {item}</li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}

            {/* Prevention Tips */}
            {aiInsights.prevention_tips?.length > 0 && (
              <div>
                <h3 className="font-semibold text-slate-900 mb-2">Prevention Strategies</h3>
                <ul className="space-y-2">
                  {aiInsights.prevention_tips.map((tip, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-slate-700">
                      <TrendingUp className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                      <span>{tip}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Filters and Search */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Search by number, name, or document..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="flex gap-2">
              {['all', 'sent', 'failed', 'queued'].map(status => (
                <Button
                  key={status}
                  variant={selectedStatus === status ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedStatus(status)}
                >
                  {status.charAt(0).toUpperCase() + status.slice(1)}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Fax Logs Table */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Fax Transmissions</CardTitle>
          <CardDescription>
            {filteredLogs.length} {filteredLogs.length === 1 ? 'fax' : 'faxes'} found
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {filteredLogs.map((log) => (
              <Card key={log.id} className="hover:shadow-md transition-shadow">
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-3">
                        {getStatusIcon(log.status)}
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-slate-900">
                              {log.to_name || log.to_number}
                            </span>
                            <Badge className={getStatusColor(log.status)}>
                              {log.status}
                            </Badge>
                            {log.retry_count > 0 && (
                              <Badge variant="outline" className="text-xs">
                                Retry #{log.retry_count}
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-slate-600 mt-1">
                            {log.document_name} • {log.pages || 0} pages
                          </p>
                        </div>
                      </div>

                      {log.failure_reason && (
                        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                          <p className="text-sm text-red-800">
                            <strong>Failure Reason:</strong> {log.failure_reason}
                          </p>
                        </div>
                      )}

                      <div className="flex items-center gap-4 text-xs text-slate-500">
                        <span>To: {log.to_number}</span>
                        <span>•</span>
                        <span>{formatDistanceToNow(new Date(log.created_date), { addSuffix: true })}</span>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2">
                      {log.status === 'failed' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => retryFax(log.id)}
                        >
                          <RefreshCw className="w-4 h-4 mr-1" />
                          Retry
                        </Button>
                      )}
                      {log.document_url && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openExternalUrl(log.document_url)}
                        >
                          <Download className="w-4 h-4 mr-1" />
                          View
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}

            {filteredLogs.length === 0 && (
              <div className="text-center py-12 text-slate-500">
                <FileText className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>No fax logs found</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}