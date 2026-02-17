import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import {
  CheckCircle2, XCircle, Edit3, Send, AlertCircle,
  FileText, Loader2, Eye, Pencil
} from "lucide-react";
import { format } from "date-fns";

const STATUS_CONFIG = {
  draft: { color: "bg-amber-100 text-amber-700", icon: Edit3, label: "Draft" },
  approved: { color: "bg-green-100 text-green-700", icon: CheckCircle2, label: "Approved" },
  sent: { color: "bg-blue-100 text-blue-700", icon: Send, label: "Sent" },
  rejected: { color: "bg-red-100 text-red-700", icon: XCircle, label: "Rejected" },
};

export default function EducationDraftReviewer({ draft, currentUser, patientId, patientName }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(draft.content);
  const [reviewerNotes, setReviewerNotes] = useState("");
  const [sending, setSending] = useState(false);

  const updateDraft = useMutation({
    mutationFn: (data) => base44.entities.PatientEducationDraft.update(draft.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["educationDrafts", patientId] });
    },
  });

  const handleApprove = () => {
    updateDraft.mutate({
      status: "approved",
      content: editContent,
      reviewer_email: currentUser.email,
      reviewed_at: new Date().toISOString(),
      reviewer_notes: reviewerNotes || undefined,
    });
    setEditing(false);
    toast.success("Material approved and ready to send");
  };

  const handleReject = () => {
    if (!reviewerNotes.trim()) { toast.error("Please add a note explaining why"); return; }
    updateDraft.mutate({
      status: "rejected",
      reviewer_email: currentUser.email,
      reviewed_at: new Date().toISOString(),
      reviewer_notes: reviewerNotes,
    });
    toast.info("Material rejected with feedback");
  };

  const handleSendToPatient = async () => {
    setSending(true);
    // Build the message body from the education content
    const body = `📚 **${draft.title}**\n\n${editContent}\n\n` +
      (draft.key_points?.length ? `**Key Points:**\n${draft.key_points.map(p => `• ${p}`).join("\n")}\n\n` : "") +
      (draft.warning_signs?.length ? `**⚠️ When to Call Your Doctor:**\n${draft.warning_signs.map(s => `• ${s}`).join("\n")}\n\n` : "") +
      (draft.action_items?.length ? `**Action Items:**\n${draft.action_items.map(a => `✓ ${a}`).join("\n")}\n\n` : "") +
      `_This education material was prepared specifically for you by your care team._`;

    const msg = await base44.entities.PatientMessage.create({
      patient_id: patientId,
      channel: "patient",
      sender_type: "provider",
      sender_email: currentUser.email,
      sender_name: currentUser.full_name || currentUser.email,
      body,
      subject: `📚 ${draft.title}`,
      priority: "normal",
      status: "unread",
      read_by: [currentUser.email],
    });

    await base44.entities.PatientEducationDraft.update(draft.id, {
      status: "sent",
      sent_at: new Date().toISOString(),
      message_id: msg.id,
    });

    queryClient.invalidateQueries({ queryKey: ["educationDrafts", patientId] });
    queryClient.invalidateQueries({ queryKey: ["patientMessages", patientId, "patient"] });
    setSending(false);
    toast.success(`Education material sent to ${patientName}'s secure messaging`);
  };

  const handleSaveEdits = () => {
    updateDraft.mutate({ content: editContent });
    setEditing(false);
    toast.success("Edits saved");
  };

  const statusConf = STATUS_CONFIG[draft.status] || STATUS_CONFIG.draft;
  const StatusIcon = statusConf.icon;

  return (
    <Card className={`transition-all ${draft.status === "draft" ? "border-amber-200" : draft.status === "approved" ? "border-green-200" : ""}`}>
      <CardHeader className="p-3 pb-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileText className="w-4 h-4 text-blue-500 flex-shrink-0" />
              <span className="truncate">{draft.title}</span>
            </CardTitle>
            <p className="text-[10px] text-slate-400 mt-0.5">
              {draft.topic} · {draft.reading_level || "simple"} level
              {draft.created_date && ` · ${format(new Date(draft.created_date), "MMM d, h:mm a")}`}
            </p>
          </div>
          <Badge className={`${statusConf.color} text-[10px] flex-shrink-0 gap-1`}>
            <StatusIcon className="w-3 h-3" /> {statusConf.label}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="p-3 space-y-3">
        {/* Content preview or editor */}
        {editing ? (
          <Textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="min-h-[200px] text-sm font-mono"
          />
        ) : (
          <div className="bg-slate-50 rounded-lg p-3 max-h-[250px] overflow-y-auto text-sm prose prose-sm max-w-none">
            <ReactMarkdown>{editContent}</ReactMarkdown>
          </div>
        )}

        {/* Key points / warnings summary */}
        {!editing && (draft.key_points?.length > 0 || draft.warning_signs?.length > 0) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {draft.key_points?.length > 0 && (
              <div className="bg-green-50 rounded-lg p-2">
                <p className="text-[10px] font-semibold text-green-700 mb-1">Key Points ({draft.key_points.length})</p>
                {draft.key_points.slice(0, 3).map((p, i) => (
                  <p key={i} className="text-[10px] text-green-600">• {p}</p>
                ))}
                {draft.key_points.length > 3 && <p className="text-[9px] text-green-400">+{draft.key_points.length - 3} more</p>}
              </div>
            )}
            {draft.warning_signs?.length > 0 && (
              <div className="bg-red-50 rounded-lg p-2">
                <p className="text-[10px] font-semibold text-red-700 mb-1 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> Warning Signs ({draft.warning_signs.length})
                </p>
                {draft.warning_signs.slice(0, 3).map((s, i) => (
                  <p key={i} className="text-[10px] text-red-600">⚠ {s}</p>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Reviewer notes */}
        {draft.status === "draft" && (
          <div>
            <label className="text-[10px] font-semibold text-slate-500">Review Notes (optional for approve, required for reject)</label>
            <Textarea
              placeholder="Add notes about this material..."
              value={reviewerNotes}
              onChange={(e) => setReviewerNotes(e.target.value)}
              className="min-h-[50px] text-xs mt-1"
              rows={2}
            />
          </div>
        )}

        {draft.reviewer_notes && draft.status !== "draft" && (
          <div className="bg-slate-50 rounded p-2">
            <p className="text-[10px] text-slate-500">
              <span className="font-medium">Review by {draft.reviewer_email}:</span> {draft.reviewer_notes}
            </p>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2 pt-1">
          {draft.status === "draft" && (
            <>
              {editing ? (
                <>
                  <Button size="sm" variant="outline" onClick={handleSaveEdits} className="text-xs gap-1 h-8">
                    <CheckCircle2 className="w-3 h-3" /> Save Edits
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setEditContent(draft.content); setEditing(false); }} className="text-xs h-8">
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <Button size="sm" variant="outline" onClick={() => setEditing(true)} className="text-xs gap-1 h-8">
                    <Pencil className="w-3 h-3" /> Edit
                  </Button>
                  <Button size="sm" onClick={handleApprove} className="text-xs gap-1 h-8 bg-green-600 hover:bg-green-700">
                    <CheckCircle2 className="w-3 h-3" /> Approve
                  </Button>
                  <Button size="sm" variant="destructive" onClick={handleReject} className="text-xs gap-1 h-8">
                    <XCircle className="w-3 h-3" /> Reject
                  </Button>
                </>
              )}
            </>
          )}

          {draft.status === "approved" && (
            <Button size="sm" onClick={handleSendToPatient} disabled={sending} className="text-xs gap-1 h-8 bg-blue-600 hover:bg-blue-700">
              {sending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
              Send to Patient via Secure Message
            </Button>
          )}

          {draft.status === "sent" && (
            <p className="text-[10px] text-blue-500 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              Sent {draft.sent_at ? format(new Date(draft.sent_at), "MMM d 'at' h:mm a") : ""}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}