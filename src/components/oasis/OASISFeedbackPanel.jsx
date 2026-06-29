import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Check,
  X,
  Edit3,
  Star,
  MessageSquare,
  Loader2
} from "lucide-react";

export default function OASISFeedbackPanel({
  suggestion,
  suggestionType,
  oasisItem,
  visitId,
  patientId,
  onAccept,
  onReject,
  onModify,
  reimbursementImpact
}) {
  const [showFeedbackDialog, setShowFeedbackDialog] = useState(false);
  const [feedbackAction, setFeedbackAction] = useState(null);
  const [modifiedText, setModifiedText] = useState(suggestion?.example || suggestion?.documentation_guidance || '');
  const [feedbackReason, setFeedbackReason] = useState('');
  const [reimbursementAccuracy, setReimbursementAccuracy] = useState('');
  const [clinicalAccuracy, setClinicalAccuracy] = useState(0);
  const [helpfulnessRating, setHelpfulnessRating] = useState(0);
  const [isSaving, setIsSaving] = useState(false);

  const handleAction = (action) => {
    setFeedbackAction(action);
    if (action === 'accepted') {
      submitFeedback(action);
      if (onAccept) onAccept(suggestion);
    } else {
      setShowFeedbackDialog(true);
    }
  };

  const submitFeedback = async (action) => {
    setIsSaving(true);
    try {
      await base44.entities.OASISFeedback.create({
        visit_id: visitId,
        patient_id: patientId,
        suggestion_type: suggestionType,
        oasis_item: oasisItem || suggestion?.oasis_item,
        original_suggestion: JSON.stringify(suggestion),
        user_action: action,
        modified_text: action === 'modified' ? modifiedText : null,
        feedback_reason: feedbackReason || null,
        reimbursement_impact_accuracy: reimbursementAccuracy || null,
        clinical_accuracy: clinicalAccuracy || null,
        helpfulness_rating: helpfulnessRating || null
      });

      if (action === 'modified' && onModify) {
        onModify(modifiedText);
      } else if (action === 'rejected' && onReject) {
        onReject(feedbackReason);
      }

      setShowFeedbackDialog(false);
    } catch (error) {
      console.error("Error saving feedback:", error);
    }
    setIsSaving(false);
  };

  const StarRating = ({ value, onChange, label }) => (
    <div className="space-y-1">
      <p className="text-xs text-slate-600">{label}</p>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            onClick={() => onChange(star)}
            className={`p-0.5 ${star <= value ? 'text-yellow-500' : 'text-slate-300'}`}
          >
            <Star className="w-5 h-5 fill-current" />
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <>
      <div className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-200">
        <Button
          size="sm"
          variant="outline"
          onClick={() => handleAction('accepted')}
          className="text-green-600 border-green-300 hover:bg-green-50"
        >
          <Check className="w-3 h-3 mr-1" />
          Accept
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => handleAction('modified')}
          className="text-blue-600 border-blue-300 hover:bg-blue-50"
        >
          <Edit3 className="w-3 h-3 mr-1" />
          Modify
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => handleAction('rejected')}
          className="text-red-600 border-red-300 hover:bg-red-50"
        >
          <X className="w-3 h-3 mr-1" />
          Reject
        </Button>
      </div>

      <Dialog open={showFeedbackDialog} onOpenChange={setShowFeedbackDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-blue-600" />
              {feedbackAction === 'modified' ? 'Modify Suggestion' : 'Provide Feedback'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {feedbackAction === 'modified' && (
              <div className="space-y-2">
                <label htmlFor="feedback-modified-version" className="text-sm font-medium">Your Modified Version:</label>
                <Textarea
                  id="feedback-modified-version"
                  value={modifiedText}
                  onChange={(e) => setModifiedText(e.target.value)}
                  rows={4}
                  placeholder="Enter your corrected or improved text..."
                  className="text-sm"
                />
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium">
                {feedbackAction === 'rejected' ? 'Why are you rejecting this suggestion?' : 'Additional Comments:'}
              </label>
              <Textarea
                value={feedbackReason}
                onChange={(e) => setFeedbackReason(e.target.value)}
                rows={2}
                placeholder={feedbackAction === 'rejected' 
                  ? "e.g., Not clinically accurate, doesn't apply to this patient..."
                  : "Optional feedback..."}
                className="text-sm"
              />
            </div>

            {reimbursementImpact && (
              <div className="space-y-2">
                <label htmlFor="feedback-reimbursement-accuracy" className="text-sm font-medium">Reimbursement Impact Accuracy:</label>
                <Select value={reimbursementAccuracy} onValueChange={setReimbursementAccuracy}>
                  <SelectTrigger id="feedback-reimbursement-accuracy" className="text-sm">
                    <SelectValue placeholder="How accurate was the impact estimate?" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="accurate">Accurate</SelectItem>
                    <SelectItem value="overestimated">Overestimated</SelectItem>
                    <SelectItem value="underestimated">Underestimated</SelectItem>
                    <SelectItem value="not_applicable">Not Applicable</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <StarRating
                value={clinicalAccuracy}
                onChange={setClinicalAccuracy}
                label="Clinical Accuracy"
              />
              <StarRating
                value={helpfulnessRating}
                onChange={setHelpfulnessRating}
                label="Helpfulness"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowFeedbackDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => submitFeedback(feedbackAction)}
              disabled={isSaving || (feedbackAction === 'modified' && !modifiedText.trim())}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Submit Feedback
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}