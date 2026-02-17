import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText, Trash2, Send, Loader2, Clock } from "lucide-react";
import { toast } from "sonner";

export default function FaxDraftsManager({ userEmail, onLoadDraft }) {
  const queryClient = useQueryClient();
  const [deletingId, setDeletingId] = useState(null);

  const { data: drafts = [], isLoading } = useQuery({
    queryKey: ["faxDrafts", userEmail],
    queryFn: () => base44.entities.FaxDraft.filter({ user_email: userEmail }, "-created_date", 20),
    enabled: !!userEmail,
  });

  const handleDelete = async (id) => {
    setDeletingId(id);
    await base44.entities.FaxDraft.delete(id);
    queryClient.invalidateQueries({ queryKey: ["faxDrafts"] });
    toast.success("Draft deleted");
    setDeletingId(null);
  };

  if (isLoading) return <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin" /></div>;
  if (drafts.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2 p-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <FileText className="w-4 h-4" /> Saved Drafts
          <Badge className="bg-blue-100 text-blue-700 text-[10px]">{drafts.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-0 space-y-2">
        {drafts.map((draft) => (
          <div key={draft.id} className="flex items-center justify-between p-2 border rounded-lg bg-white hover:bg-slate-50">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate">
                {draft.recipient_name || draft.recipient_fax_number || "No recipient"}
              </p>
              <p className="text-[10px] text-slate-500 truncate">
                {draft.subject || "No subject"} • {draft.document_urls?.length || 0} docs
              </p>
              <p className="text-[10px] text-slate-400 flex items-center gap-1">
                <Clock className="w-2.5 h-2.5" />
                {new Date(draft.created_date).toLocaleDateString()}
              </p>
            </div>
            <div className="flex gap-1 ml-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[10px]"
                onClick={() => onLoadDraft?.(draft)}
              >
                <Send className="w-3 h-3" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[10px] text-red-500 hover:text-red-700"
                onClick={() => handleDelete(draft.id)}
                disabled={deletingId === draft.id}
              >
                {deletingId === draft.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}