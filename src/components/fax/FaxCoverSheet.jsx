import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { FileText, Settings2, Bookmark, Star } from "lucide-react";
import { toast } from "sonner";
import FaxTemplateManager from "./FaxTemplateManager";

const URGENCY_LABELS = {
  normal: "Normal",
  urgent: "🔴 URGENT",
  for_review: "📋 For Review",
  please_reply: "↩️ Please Reply",
  confidential: "🔒 Confidential"
};

const HIPAA_NOTICE = `CONFIDENTIALITY NOTICE: This facsimile transmission contains confidential information that is legally privileged. This information is intended only for the use of the individual(s) named above. If you are not the intended recipient, you are hereby notified that any disclosure, copying, distribution, or action taken in reliance on the contents of these documents is strictly prohibited. If you have received this fax in error, please notify the sender immediately and destroy the original transmission.`;

/**
 * Replaces placeholder tags like {{recipient_name}} with actual values.
 */
export function resolvePlaceholders(text, context) {
  if (!text) return text;
  return text
    .replace(/\{\{recipient_name\}\}/gi, context.recipientName || "")
    .replace(/\{\{recipient_fax\}\}/gi, context.recipientFax || "")
    .replace(/\{\{sender_name\}\}/gi, context.senderName || "")
    .replace(/\{\{sender_company\}\}/gi, context.senderCompany || "")
    .replace(/\{\{sender_phone\}\}/gi, context.senderPhone || "")
    .replace(/\{\{date\}\}/gi, new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }))
    .replace(/\{\{time\}\}/gi, new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }));
}

export default function FaxCoverSheet({ userEmail, coverData, onCoverDataChange, recipientName, recipientFax }) {
  const [showTemplates, setShowTemplates] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);

  const { data: templates = [] } = useQuery({
    queryKey: ['faxCoverTemplates', userEmail],
    queryFn: () => base44.entities.FaxCoverTemplate.filter({ user_email: userEmail }),
    enabled: !!userEmail
  });

  // Auto-load default template on first render
  useEffect(() => {
    if (templates.length > 0 && !coverData._templateLoaded) {
      const defaultTemplate = templates.find(t => t.is_default);
      if (defaultTemplate) {
        loadTemplate(defaultTemplate, true);
      }
    }
  }, [templates]);

  const loadTemplate = (template, isAutoLoad = false) => {
    onCoverDataChange({
      ...coverData,
      sender_name: template.sender_name || coverData.sender_name,
      sender_company: template.sender_company || coverData.sender_company,
      sender_phone: template.sender_phone || coverData.sender_phone,
      subject: template.subject_line || coverData.subject,
      message: template.message_body || coverData.message,
      urgency: template.urgency || "normal",
      include_hipaa: template.include_hipaa_notice !== false,
      _templateLoaded: true,
      _templateId: template.id
    });
    setShowTemplates(false);
    if (!isAutoLoad) {
      toast.success(`Loaded template: ${template.name}`);
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="pb-2 p-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Cover Sheet
            </CardTitle>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => setShowTemplates(!showTemplates)}>
                <Bookmark className="w-3 h-3 mr-1" /> Templates ({templates.length})
              </Button>
              <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => setManagerOpen(true)} title="Manage Templates">
                <Settings2 className="w-3 h-3" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-3 pt-0 space-y-3">
          {showTemplates && (
            <div className="bg-slate-50 rounded-lg p-2 border space-y-1 max-h-48 overflow-y-auto">
              {templates.length === 0 ? (
                <div className="text-center py-3">
                  <p className="text-xs text-slate-500 mb-2">No templates yet</p>
                  <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => { setShowTemplates(false); setManagerOpen(true); }}>
                    Create Template
                  </Button>
                </div>
              ) : (
                templates.map(t => (
                  <button
                    key={t.id}
                    onClick={() => loadTemplate(t)}
                    className={`w-full text-left text-xs p-2 rounded hover:bg-blue-50 transition-colors flex items-center gap-2 ${coverData._templateId === t.id ? 'bg-blue-50 border border-blue-200' : ''}`}
                  >
                    {t.is_default && <Star className="w-3 h-3 text-blue-500 fill-blue-500 flex-shrink-0" />}
                    <span className="font-medium truncate">{t.name}</span>
                    {t.subject_line && <span className="text-slate-400 truncate ml-auto text-[10px]">{t.subject_line}</span>}
                  </button>
                ))
              )}
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
            {coverData.message && /\{\{.+?\}\}/.test(coverData.message) && (
              <p className="text-[10px] text-blue-600 mt-1">Contains placeholders — will be replaced with actual values when sent.</p>
            )}
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
        </CardContent>
      </Card>

      <FaxTemplateManager
        userEmail={userEmail}
        open={managerOpen}
        onOpenChange={setManagerOpen}
      />
    </>
  );
}

export { HIPAA_NOTICE, URGENCY_LABELS };