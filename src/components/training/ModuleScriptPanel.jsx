import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileText, ChevronDown, ChevronUp, Loader2, PencilLine, AlertTriangle } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  buildNarrationScript,
  MIN_AUTHORED_NARRATION_CHARS,
  NARRATION_CHAR_LIMIT,
} from "@/components/training/videoNarration";

// Review/edit the presenter script for one lesson module. The preview uses the
// SAME buildNarrationScript logic the manageTrainingVideos backend runs at
// render time, so what the admin reads here is exactly what the HeyGen avatar
// will say. Edits are stored as content_json.video_narration and picked up the
// next time the video is generated or regenerated.
export default function ModuleScriptPanel(props) {
  return <ScopedModuleScriptPanel key={`${props.courseId || ''}:${props.module?.id || ''}`} {...props} />;
}

function ScopedModuleScriptPanel({ module: moduleRecord, courseId, disabled = false }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const mounted = useRef(true);
  const saving = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const content = moduleRecord?.content_json || {};
  const authoredRaw = typeof content.video_narration === "string" ? content.video_narration.trim() : "";
  const isAuthored = authoredRaw.length >= MIN_AUTHORED_NARRATION_CHARS;
  const script = buildNarrationScript(String(moduleRecord?.title || ""), content);

  const saveMutation = useMutation({
    retry: false,
    mutationFn: ({ moduleId, contentJson, nextScript }) => {
      if (disabled || !moduleId) throw new Error('Script editing is temporarily unavailable.');
      return base44.entities.TrainingModule.update(moduleId, {
        content_json: { ...contentJson, video_narration: nextScript },
      });
    },
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ["training-modules", variables.courseId] });
      if (!mounted.current) return;
      setEditing(false);
      toast.success("Script saved. Generate or regenerate the video to hear the new script.");
    },
    onError: () => { if (mounted.current) toast.error("Could not confirm the script save. Refresh the lesson before trying again."); },
    onSettled: () => { saving.current = false; },
  });

  if (!moduleRecord) return null;

  const startEditing = () => {
    if (disabled || saving.current) return;
    setDraft(authoredRaw || script);
    setEditing(true);
  };

  const trimmedDraft = draft.trim();
  // A non-empty script under the authored minimum would be silently ignored at
  // render time (the auto-assembled narration runs instead) — block saving it.
  const draftTooShort = trimmedDraft.length > 0 && trimmedDraft.length < MIN_AUTHORED_NARRATION_CHARS;
  const draftOverLimit = trimmedDraft.length > NARRATION_CHAR_LIMIT;
  const saveScript = () => {
    if (disabled || saving.current || draftTooShort) return;
    saving.current = true;
    saveMutation.mutate({ moduleId: moduleRecord.id, courseId, contentJson: { ...content }, nextScript: trimmedDraft });
  };

  return (
    <div className="mt-2">
      <button
        type="button"
        className="text-xs text-slate-500 hover:text-slate-700 inline-flex items-center gap-1.5"
        onClick={() => setOpen((v) => !v)}
      >
        <FileText className="w-3.5 h-3.5" />
        {open ? "Hide script" : "View script"}
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>

      {open && (
        <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Badge className={isAuthored ? "bg-navy-100 text-navy-800 text-xs" : "bg-slate-200 text-slate-700 text-xs"}>
                {isAuthored ? "AI-written presenter script" : "Auto-assembled from lesson text"}
              </Badge>
              <span className="text-xs text-slate-400">
                {script.length.toLocaleString()} / {NARRATION_CHAR_LIMIT.toLocaleString()} characters
              </span>
            </div>
            {!editing && (
              <Button size="sm" variant="outline" onClick={startEditing} disabled={disabled}>
                <PencilLine className="w-3.5 h-3.5 mr-1.5" /> Edit script
              </Button>
            )}
          </div>

          {editing ? (
            <div className="space-y-2">
              <Textarea
                aria-label={`Presenter script for ${moduleRecord.title}`}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={10}
                className="bg-white text-sm"
                disabled={disabled || saveMutation.isPending}
              />
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className={`text-xs ${draftOverLimit ? "text-amber-600" : "text-slate-400"}`}>
                  {trimmedDraft.length.toLocaleString()} / {NARRATION_CHAR_LIMIT.toLocaleString()} characters
                  {draftOverLimit && " — longer scripts are trimmed at a sentence boundary"}
                </span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEditing(false)} disabled={saveMutation.isPending}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={saveScript}
                    disabled={disabled || saveMutation.isPending || draftTooShort}
                  >
                    {saveMutation.isPending ? (
                      <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Saving…</>
                    ) : (
                      "Save script"
                    )}
                  </Button>
                </div>
              </div>
              {draftTooShort && (
                <p className="text-xs text-amber-600 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Scripts under {MIN_AUTHORED_NARRATION_CHARS} characters are ignored — write a fuller script, or clear the text to use the auto-assembled narration.
                </p>
              )}
              <p className="text-xs text-slate-400">
                The change applies the next time this lesson&rsquo;s video is generated or regenerated.
              </p>
            </div>
          ) : (
            <p className="text-sm text-slate-700 whitespace-pre-wrap max-h-56 overflow-y-auto">{script}</p>
          )}
        </div>
      )}
    </div>
  );
}
