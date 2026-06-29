import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { CheckCircle, AlertTriangle, FileText, Save } from "lucide-react";
import { toast } from "sonner";

export default function OCRReviewPanel({ faxLog, onClose }) {
  const queryClient = useQueryClient();
  const [correctedText, setCorrectedText] = useState(faxLog.ocr_text || '');
  const [correctionType, setCorrectionType] = useState('minor');
  const [documentType, setDocumentType] = useState('');
  const [feedbackNotes, setFeedbackNotes] = useState('');

  const hasChanges = correctedText !== faxLog.ocr_text;

  const submitFeedbackMutation = useMutation({
    mutationFn: async () => {
      // Save the feedback
      await base44.entities.OCRFeedback.create({
        fax_log_id: faxLog.id,
        original_ocr_text: faxLog.ocr_text,
        corrected_text: correctedText,
        correction_type: correctionType,
        feedback_notes: feedbackNotes,
        document_type: documentType,
        corrected_by: (await base44.auth.me()).email
      });

      // Update the fax log with corrected text
      await base44.entities.FaxLog.update(faxLog.id, {
        ocr_text: correctedText,
        ocr_confidence: 100 // Human verified
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fax-logs'] });
      toast.success("OCR correction saved and will improve future extractions");
      onClose?.();
    },
    onError: () => {
      toast.error("Failed to save OCR correction");
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!hasChanges) {
      toast.info("No changes detected");
      return;
    }
    submitFeedbackMutation.mutate();
  };

  const confidenceColor = 
    faxLog.ocr_confidence >= 90 ? 'text-green-600' :
    faxLog.ocr_confidence >= 70 ? 'text-yellow-600' :
    'text-red-600';

  return (
    <Card className="border-2 border-blue-200">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-blue-600" />
          Review & Correct OCR Extraction
        </CardTitle>
        <div className="flex items-center gap-4 mt-2">
          <div className="flex items-center gap-2">
            {faxLog.ocr_confidence >= 90 ? (
              <CheckCircle className="w-4 h-4 text-green-600" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-yellow-600" />
            )}
            <span className={`text-sm font-semibold ${confidenceColor}`}>
              Confidence: {faxLog.ocr_confidence?.toFixed(0)}%
            </span>
          </div>
          {hasChanges && (
            <span className="text-sm text-blue-600 font-medium">
              • Changes detected
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Original OCR (Read-only reference) */}
          <div className="space-y-2">
            <Label className="text-xs text-slate-500">Original OCR Text (Reference)</Label>
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 max-h-40 overflow-y-auto">
              <p className="text-sm text-slate-700 whitespace-pre-wrap font-mono">
                {faxLog.ocr_text || 'No OCR text available'}
              </p>
            </div>
          </div>

          {/* Editable Corrected Text */}
          <div className="space-y-2">
            <Label>Corrected Text *</Label>
            <Textarea
              value={correctedText}
              onChange={(e) => setCorrectedText(e.target.value)}
              placeholder="Make corrections to the OCR text here..."
              className="min-h-64 font-mono text-sm"
              required
            />
            <p className="text-xs text-slate-500">
              Edit the text above to correct any OCR errors. Your corrections help improve future extractions.
            </p>
          </div>

          {/* Correction Metadata */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Correction Severity</Label>
              <Select value={correctionType} onValueChange={setCorrectionType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="minor">Minor (typos, spacing)</SelectItem>
                  <SelectItem value="moderate">Moderate (some errors)</SelectItem>
                  <SelectItem value="major">Major (many errors)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Document Type (optional)</Label>
              <Input
                value={documentType}
                onChange={(e) => setDocumentType(e.target.value)}
                placeholder="e.g., Lab Report, Prescription"
              />
            </div>
          </div>

          {/* Feedback Notes */}
          <div className="space-y-2">
            <Label>Feedback Notes (optional)</Label>
            <Textarea
              value={feedbackNotes}
              onChange={(e) => setFeedbackNotes(e.target.value)}
              placeholder="Any notes about common errors or improvements needed..."
              className="h-20"
            />
          </div>

          {/* Info Alert */}
          <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
            <p className="text-xs text-blue-800">
              <strong>How this helps:</strong> Your corrections are stored and analyzed to improve OCR accuracy for similar documents in the future.
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <Button 
              type="submit" 
              disabled={!hasChanges || submitFeedbackMutation.isPending}
              className="flex-1"
            >
              <Save className="w-4 h-4 mr-2" />
              Save Correction
            </Button>
            {onClose && (
              <Button 
                type="button" 
                variant="outline" 
                onClick={onClose}
                disabled={submitFeedbackMutation.isPending}
              >
                Cancel
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}