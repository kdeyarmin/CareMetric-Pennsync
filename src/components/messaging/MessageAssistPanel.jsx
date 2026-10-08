import { useState } from "react";
import { FileText, Lightbulb, Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";

/**
 * AI help for one secure thread.
 *
 * Both actions go to purpose-bound brokers that re-derive the caller's
 * authority on every request: summarizeMessageThread admits only a bound
 * participant of the thread, and generateMessageSuggestions additionally
 * requires chart access to the thread's patient. Nothing here is saved; the
 * output is a draft aid the clinician reads and decides on.
 */

function brokerError(error, fallback) {
  const message = error?.response?.data?.error || error?.data?.error;
  return typeof message === "string" && message ? message : fallback;
}

function stringList(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim()) : [];
}

function List({ title, items }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      <ul className="list-disc pl-5 text-sm text-slate-700">
        {items.map((item, index) => <li key={`${title}-${index}`}>{item}</li>)}
      </ul>
    </div>
  );
}

export default function MessageAssistPanel({ agencyId, threadId, patientId, draft }) {
  const [busy, setBusy] = useState(null);
  const [summary, setSummary] = useState(null);
  const [suggestions, setSuggestions] = useState(null);
  const [error, setError] = useState(null);

  const summarize = async () => {
    setBusy("summary");
    setError(null);
    try {
      const { data } = await base44.functions.invoke("summarizeMessageThread", {
        agency_id: agencyId,
        thread_id: threadId,
      });
      setSummary(data || null);
    } catch (e) {
      setError(brokerError(e, "The thread could not be summarized. Please try again."));
    } finally {
      setBusy(null);
    }
  };

  const suggest = async () => {
    setBusy("suggest");
    setError(null);
    try {
      const { data } = await base44.functions.invoke("generateMessageSuggestions", {
        agency_id: agencyId,
        patient_id: patientId,
        thread_id: threadId,
        ...(typeof draft === "string" && draft.trim() ? { current_message: draft.slice(0, 4000) } : {}),
      });
      setSuggestions(data || null);
    } catch (e) {
      setError(brokerError(e, "Suggestions could not be generated. Please try again."));
    } finally {
      setBusy(null);
    }
  };

  const actionItems = Array.isArray(summary?.action_items)
    ? summary.action_items.filter((item) => item && typeof item.action === "string" && item.action.trim())
    : [];
  const suggestedInfo = Array.isArray(suggestions?.suggested_info)
    ? suggestions.suggested_info.filter((item) => item && typeof item.information === "string" && item.information.trim())
    : [];

  return (
    <section aria-label="AI message assistant" className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={summarize} disabled={busy !== null}>
          {busy === "summary" ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <FileText className="h-4 w-4 mr-1" />}
          Summarize thread
        </Button>
        {patientId && (
          <Button type="button" size="sm" variant="outline" onClick={suggest} disabled={busy !== null}>
            {busy === "suggest" ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Lightbulb className="h-4 w-4 mr-1" />}
            Suggest patient info
          </Button>
        )}
      </div>
      <p className="text-xs text-slate-500">AI output is a draft aid. Verify it against the chart before acting on it.</p>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {summary && (
        <div className="space-y-2" aria-live="polite">
          {typeof summary.summary === "string" && summary.summary.trim() && (
            <p className="text-sm text-slate-800 whitespace-pre-wrap">{summary.summary}</p>
          )}
          <List title="Key points" items={stringList(summary.key_points)} />
          <List title="Decisions" items={stringList(summary.decisions_made)} />
          <List
            title="Action items"
            items={actionItems.map((item) => [item.action, item.assigned_to && `(${item.assigned_to})`, item.priority && `- ${item.priority}`]
              .filter(Boolean).join(" "))}
          />
          <List title="Open questions" items={stringList(summary.open_questions)} />
        </div>
      )}
      {suggestions && (
        <div className="space-y-2" aria-live="polite">
          <List title="Safety alerts" items={stringList(suggestions.safety_alerts)} />
          <List
            title="Relevant information"
            items={suggestedInfo.map((item) => [item.category && `${item.category}:`, item.information].filter(Boolean).join(" "))}
          />
          <List title="Quick facts" items={stringList(suggestions.quick_facts)} />
          <List title="Suggested actions" items={stringList(suggestions.suggested_actions)} />
        </div>
      )}
    </section>
  );
}
