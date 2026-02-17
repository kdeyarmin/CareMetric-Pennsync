import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { FileText, Save, BookmarkPlus, Bookmark } from "lucide-react";
import { toast } from "sonner";

const URGENCY_LABELS = {
  normal: "Normal",
  urgent: "🔴 URGENT",
  for_review: "📋 For Review",
  please_reply: "↩️ Please Reply",
  confidential: "🔒 Confidential"
};

const HIPAA_NOTICE = `CONFIDENTIALITY NOTICE: This facsimile transmission contains confidential information that is legally privileged. This information is intended only for the use of the individual(s) named above. If you are not the intended recipient, you are hereby notified that any disclosure, copying, distribution, or action taken in reliance on the contents of these documents is strictly prohibited. If you have received this fax in error, please notify the sender immediately and destroy the original transmission.`;

export default function FaxCoverSheet({ userEmail, coverData, onCoverDataChange }) {
  const queryClient = useQueryClient();
  const [showTemplates, setShowTemplates] = useState(false);
  const [templateName, setTemplateName] = useState("");

  const { data: templates = [] } = useQuery({
    queryKey: ['faxCoverTemplates', userEmail],
    queryFn: () => base44.entities.FaxCoverTemplate.filter({ user_email: userEmail }),
    enabled: !!userEmail
  });

  const saveTemplateMutation = useMutation({
    mutationFn: (data) => base44.entities.FaxCoverTemplate.create({ ...data, user_email: userEmail }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['faxCoverTemplates'] });
      setTemplateName("");
      toast.success("Template saved");
    }
  });

  const loadTemplate = (template) => {
    onCoverDataChange({
      ...coverData,
      sender_name: template.sender_name || coverData.sender_name,
      sender_company: template.sender_company || coverData.sender_company,
      sender_phone: template.sender_phone || coverData.sender_phone,
      subject: template.subject_line || coverData.subject,
      message: template.message_body || coverData.message,
      urgency: template.urgency || "normal",
      include_hipaa: template.include_hipaa_notice !== false
    });
    setShowTemplates(false);
    toast.success(`Loaded template: ${template.name}`);
  };

  const saveAsTemplate = () => {
    if (!templateName.trim()) {
      toast.error("Enter a template name");
      return;
    }
    saveTemplateMutation.mutate({
      name: templateName,
      sender_name: coverData.sender_name,
      sender_company: coverData.sender_company,
      sender_phone: coverData.sender_phone,
      subject_line: coverData.subject,
      message_body: coverData.message,
      urgency: coverData.urgency,
      include_hipaa_notice: coverData.include_hipaa
    });
  };

  return (
    <Card>
      <CardHeader className="pb-2 p-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="w-4 h-4" />
            Cover Sheet
          </CardTitle>
          <div className="flex gap-1">
            {templates.length > 0 && (
              <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => setShowTemplates(!showTemplates)}>
                <Bookmark className="w-3 h-3 mr-1" /> Templates
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-0 space-y-3">
        {showTemplates && (
          <div className="bg-slate-50 rounded-lg p-2 border space-y-1 max-h-40 overflow-y-auto">
            {templates.map(t => (
              <button key={t.id} onClick={() => loadTemplate(t)} className="w-full text-left text-xs p-2 rounded hover:bg-blue-50 transition-colors">
                <span className="font-medium">{t.name}</span>
                {t.subject_line && <span className="text-slate-500 ml-2">— {t.subject_line}</span>}
              </button>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Your Name</Label>
            <Input value={coverData.sender_name} onChange={e => onCoverDataChange({...coverData, sender_name: e.target.value})} placeholder="Your name" className="h-9 text-sm" />
          </div>
          <div>
            <Label className="text-xs">Company/Agency</Label>
            <Input value={coverData.sender_company} onChange={e => onCoverDataChange({...coverData, sender_company: e.target.value})} placeholder="Company" className="h-9 text-sm" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Your Phone</Label>
            <Input value={coverData.sender_phone} onChange={e => onCoverDataChange({...coverData, sender_phone: e.target.value})} placeholder="(555) 123-4567" className="h-9 text-sm" />
          </div>
          <div>
            <Label className="text-xs">Urgency</Label>
            <Select value={coverData.urgency} onValueChange={v => onCoverDataChange({...coverData, urgency: v})}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(URGENCY_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div>
          <Label className="text-xs">Subject</Label>
          <Input value={coverData.subject} onChange={e => onCoverDataChange({...coverData, subject: e.target.value})} placeholder="Subject of this fax" className="h-9 text-sm" />
        </div>

        <div>
          <Label className="text-xs">Message</Label>
          <Textarea value={coverData.message} onChange={e => onCoverDataChange({...coverData, message: e.target.value})} placeholder="Enter your message here..." rows={4} className="text-sm" />
        </div>

        <div className="flex items-center justify-between">
          <Label className="text-xs flex items-center gap-2">
            <Switch checked={coverData.include_hipaa} onCheckedChange={v => onCoverDataChange({...coverData, include_hipaa: v})} />
            Include HIPAA Notice
          </Label>
        </div>

        {coverData.include_hipaa && (
          <p className="text-[9px] text-slate-500 bg-slate-50 rounded p-2 border italic leading-relaxed">{HIPAA_NOTICE}</p>
        )}

        {/* Save as template */}
        <div className="flex gap-2">
          <Input value={templateName} onChange={e => setTemplateName(e.target.value)} placeholder="Save as template..." className="h-8 text-xs flex-1" />
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={saveAsTemplate} disabled={!templateName.trim()}>
            <BookmarkPlus className="w-3 h-3 mr-1" /> Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export { HIPAA_NOTICE, URGENCY_LABELS };