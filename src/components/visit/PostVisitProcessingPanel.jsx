import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { processCompletedVisit } from "@/functions/processCompletedVisit";

function brokerError(error) {
  const message = error?.response?.data?.error || error?.data?.error;
  return typeof message === "string" && message ? message : "Post-visit processing failed. Please try again.";
}

/**
 * Post-visit AI processing for a completed visit: a Medicare-compliant
 * narrative replaces the saved note (the original raw note is kept), the
 * clinician's review acknowledgement is reset so the narrative is reviewed
 * before EMR handoff, and follow-up tasks are created for the caller.
 *
 * The server admits only the visit's own clinician with chart access and
 * processes a visit once; a repeat answers "already processed".
 */
export default function PostVisitProcessingPanel({ visitId }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const { data } = await processCompletedVisit({ visit_id: visitId });
      setResult(data || null);
    } catch (e) {
      setError(brokerError(e));
    } finally {
      setRunning(false);
    }
  };

  const tasks = Array.isArray(result?.tasks) ? result.tasks.filter((task) => task && typeof task.title === "string") : [];
  return (
    <section aria-label="Post-visit processing" className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <h3 className="font-semibold text-slate-900">Post-visit processing</h3>
      <p className="text-sm text-slate-600">
        Generate a Medicare-compliant narrative and follow-up tasks from this visit. The narrative replaces the
        saved note, the original dictation is kept, and you will need to review the note again before EMR handoff.
      </p>
      <Button type="button" size="sm" onClick={run} disabled={running || !visitId}>
        {running ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />}
        Generate narrative and tasks
      </Button>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {result && (
        <div role="status" className="space-y-2 text-sm text-slate-800">
          <p>
            {result.already_processed
              ? "This visit was already processed."
              : `Narrative published. ${result.tasks_created ?? tasks.length} follow-up task${(result.tasks_created ?? tasks.length) === 1 ? "" : "s"} created. Reload the visit to review the updated note.`}
          </p>
          {tasks.length > 0 && (
            <ul className="list-disc pl-5">
              {tasks.map((task, index) => <li key={task.id || index}>{task.title}</li>)}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
