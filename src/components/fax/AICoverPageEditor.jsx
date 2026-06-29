import { useState, useEffect } from "react";
import { configNotReadyMessage } from "@/lib/aiFeatureError";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Brain, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { generateFaxCoverPage } from "@/functions/generateFaxCoverPage";
import { useMutation } from "@tanstack/react-query";

export default function AICoverPageEditor({ patientId, documentId, recipientNumber, senderNumber, onCoverPageGenerated }) {
  const [coverPageData, setCoverPageData] = useState(null);
  const [formData, setFormData] = useState({});

  const generateMutation = useMutation({
    mutationFn: (vars) => generateFaxCoverPage({
      patient_id: patientId,
      document_id: documentId,
      recipient_number: recipientNumber,
      sender_number: senderNumber,
      ...vars
    }),
    onSuccess: (data) => {
      // functions.invoke returns the full axios response; body is under .data.
      const body = data?.data || data;
      setCoverPageData(body.cover_page_data);
      setFormData(body.cover_page_data);
      onCoverPageGenerated(body.cover_page_data);
      toast.success("AI cover page generated!");
    },
    onError: (error) => {
      toast.error(configNotReadyMessage(error) || ("Failed to generate AI cover page: " + error.message));
    }
  });

  const { mutate: doGenerate } = generateMutation;

  useEffect(() => {
    if ((patientId || documentId) && recipientNumber && senderNumber) {
      doGenerate({});
    }
  }, [patientId, documentId, recipientNumber, senderNumber, doGenerate]);

  const handleFieldChange = (path, value) => {
    const keys = path.split('.');
    setFormData(prev => {
      const newData = { ...prev };
      let current = newData;
      for (let i = 0; i < keys.length - 1; i++) {
        current[keys[i]] = { ...current[keys[i]] };
        current = current[keys[i]];
      }
      current[keys[keys.length - 1]] = value;
      onCoverPageGenerated(newData);
      return newData;
    });
  };

  if (generateMutation.isPending) {
    return (
      <Card className="border-navy-200 bg-navy-50">
        <CardContent className="p-8">
          <div className="flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin mr-2 text-navy-600" />
            <span className="text-navy-700">Generating AI cover page...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!coverPageData) {
    return null;
  }

  return (
    <Card className="border-navy-200 bg-navy-50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Brain className="w-5 h-5 text-navy-600" />
          AI-Generated Cover Page
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Sender Name</Label>
            <Input
              value={formData.from?.name || ""}
              onChange={(e) => handleFieldChange('from.name', e.target.value)}
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Sender Phone</Label>
            <Input
              value={formData.from?.phone || ""}
              onChange={(e) => handleFieldChange('from.phone', e.target.value)}
              className="h-9 text-sm"
            />
          </div>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Subject</Label>
          <Input
            value={formData.subject || ""}
            onChange={(e) => handleFieldChange('subject', e.target.value)}
            className="h-9 text-sm"
          />
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Message</Label>
          <Textarea
            value={formData.message || ""}
            onChange={(e) => handleFieldChange('message', e.target.value)}
            rows={3}
            className="text-sm"
          />
        </div>

        {formData.patient_info?.name && (
          <div className="p-2 bg-white rounded border border-navy-200">
            <p className="text-xs font-semibold text-navy-900 mb-1">Patient Info</p>
            <p className="text-xs text-slate-700">{formData.patient_info.name}</p>
            {formData.patient_info.dob && <p className="text-xs text-slate-600">DOB: {formData.patient_info.dob}</p>}
            {formData.patient_info.mrn && <p className="text-xs text-slate-600">MRN: {formData.patient_info.mrn}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}