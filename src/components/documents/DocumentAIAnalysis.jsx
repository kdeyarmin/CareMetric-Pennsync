import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Brain, AlertTriangle, TrendingUp, FileText, Loader2, Sparkles } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "sonner";
import { analyzeDocument } from "@/functions/analyzeDocument";

const unwrap = (response) => (response && typeof response === "object" && "data" in response ? response.data : response);

async function callAnalyzeDocument(payload) {
  const data = unwrap(await analyzeDocument(payload));
  if (!data || data.success !== true) {
    throw new Error(data?.error || "Document analysis did not complete");
  }
  return data.analysis ?? null;
}

const severityTone = (severity) => (
  severity === "critical" ? { box: "bg-red-50 border-red-300", badge: "bg-red-600 text-white" }
    : severity === "high" ? { box: "bg-orange-50 border-orange-300", badge: "bg-orange-600 text-white" }
      : { box: "bg-yellow-50 border-yellow-300", badge: "bg-yellow-600 text-white" }
);

/**
 * AI review of one stored document (owner decision, 2026-10-08). Access is
 * decided server-side by the Document read broker; this panel only asks for
 * the stored analysis when opened and runs a new one on request.
 */
export default function DocumentAIAnalysis({ document, agencyId }) {
  const [open, setOpen] = useState(false);
  const [showExtracted, setShowExtracted] = useState(false);
  const queryClient = useQueryClient();
  const queryKey = ["document-ai-analysis", agencyId, document?.id];
  const ready = Boolean(agencyId && document?.id);

  const storedQuery = useQuery({
    queryKey,
    queryFn: () => callAnalyzeDocument({ agency_id: agencyId, document_id: document.id, action: "get" }),
    enabled: open && ready,
    staleTime: 60_000,
    retry: false,
  });

  const analyzeMutation = useMutation({
    mutationFn: () => callAnalyzeDocument({ agency_id: agencyId, document_id: document.id, action: "analyze" }),
    onSuccess: (analysis) => {
      queryClient.setQueryData(queryKey, analysis);
      toast.success("Document analyzed");
    },
    onError: (error) => {
      toast.error(`Analysis failed: ${error?.message || "unknown error"}`);
    },
  });

  if (!ready) return null;

  if (!open) {
    return (
      <Button variant="ghost" size="sm" className="w-full justify-start text-navy-700" onClick={() => setOpen(true)}>
        <Brain className="w-4 h-4 mr-2" />
        AI analysis
      </Button>
    );
  }

  const analysis = storedQuery.isSuccess ? storedQuery.data : null;
  const busy = analyzeMutation.isPending;

  return (
    <div className="space-y-3 rounded-lg border border-navy-200 p-3" aria-live="polite">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-medium text-navy-900">
          <Brain className="w-4 h-4 text-navy-600" />
          AI analysis
        </span>
        {analysis?.confidence_score != null && (
          <Badge className="bg-navy-100 text-navy-800">Confidence: {analysis.confidence_score}%</Badge>
        )}
      </div>

      {storedQuery.isLoading && (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading analysis…
        </p>
      )}
      {storedQuery.isError && (
        <p className="text-sm text-red-600" role="alert">
          {storedQuery.error?.message || "The analysis could not be loaded."}
        </p>
      )}

      {analysis && (
        <>
          {analysis.critical_flags?.length > 0 && (
            <div className="space-y-2">
              <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <AlertTriangle className="w-4 h-4 text-red-600" />
                Critical findings
              </h4>
              {analysis.critical_flags.map((flag, idx) => {
                const tone = severityTone(flag.severity);
                return (
                  <Alert key={idx} className={tone.box}>
                    <AlertDescription>
                      <div className="flex items-start gap-2">
                        <Badge className={tone.badge}>{(flag.severity || "").toUpperCase()}</Badge>
                        <div className="flex-1">
                          <p className="text-sm font-semibold">{flag.finding}</p>
                          {flag.details && <p className="mt-1 text-sm text-slate-700">{flag.details}</p>}
                        </div>
                      </div>
                    </AlertDescription>
                  </Alert>
                );
              })}
            </div>
          )}

          <div>
            <h4 className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-900">
              <FileText className="w-4 h-4 text-blue-600" />
              Summary
            </h4>
            <p className="rounded-lg bg-blue-50 p-3 text-sm text-slate-700">{analysis.summary}</p>
          </div>

          {analysis.extracted_data && Object.keys(analysis.extracted_data).length > 0 && (
            <Collapsible open={showExtracted} onOpenChange={setShowExtracted}>
              <CollapsibleTrigger asChild>
                <Button variant="outline" size="sm" className="w-full">
                  <TrendingUp className="w-4 h-4 mr-2" />
                  {showExtracted ? "Hide" : "Show"} extracted data
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2 space-y-2">
                {Object.entries(analysis.extracted_data).map(([key, value]) => {
                  if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) return null;
                  return (
                    <div key={key} className="rounded-lg bg-slate-50 p-2">
                      <p className="mb-1 text-xs font-semibold uppercase text-slate-500">{key.replace(/_/g, " ")}</p>
                      {Array.isArray(value) ? (
                        <ul className="list-inside list-disc space-y-1 text-sm text-slate-900">
                          {value.map((item, idx) => <li key={idx}>{String(item)}</li>)}
                        </ul>
                      ) : (
                        <p className="text-sm text-slate-900">{String(value)}</p>
                      )}
                    </div>
                  );
                })}
              </CollapsibleContent>
            </Collapsible>
          )}

          {analysis.suggested_category && analysis.suggested_category !== document.category && (
            <div className="flex items-center gap-2 rounded-lg border border-navy-200 bg-navy-50 p-2">
              <Sparkles className="w-4 h-4 text-navy-600" />
              <span className="text-sm text-navy-900">
                Suggested category: <strong>{analysis.suggested_category.replace(/_/g, " ")}</strong>
              </span>
            </div>
          )}

          {analysis.analyzed_date && (
            <p className="text-xs text-slate-500">Analyzed {new Date(analysis.analyzed_date).toLocaleString()}</p>
          )}
        </>
      )}

      {storedQuery.isSuccess && (
        <Button
          size="sm"
          onClick={() => analyzeMutation.mutate()}
          disabled={busy}
          className="w-full bg-navy-600 hover:bg-navy-700"
        >
          {busy ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Analyzing…</>
          ) : (
            <><Sparkles className="w-4 h-4 mr-2" />{analysis ? "Re-analyze" : "Analyze document"}</>
          )}
        </Button>
      )}
    </div>
  );
}
