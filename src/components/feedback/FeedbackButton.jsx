import { useEffect, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { MessageSquare, Send, CheckCircle2 } from "lucide-react";
import { toast } from 'sonner';
import { OUTBOUND_DELIVERY_PAUSED_CODE, OUTBOUND_DELIVERY_PAUSED_MESSAGE } from '@/lib/outboundDeliveryContainment';

const MAX_SUBJECT_LENGTH = 200;
const MAX_FEEDBACK_LENGTH = 5000;

/**
 * Sidebar "Send Feedback" dialog. The message is delivered by the
 * submitAppFeedback backend function, which sits behind the shared outbound
 * delivery release gate and chooses the recipient itself; the browser never
 * names an address or calls an email integration directly.
 */
export default function FeedbackButton() {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [feedback, setFeedback] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const resetTimer = useRef(null);

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!feedback.trim() || sending) return;

    setSending(true);
    try {
      const res = await base44.functions.invoke('submitAppFeedback', {
        subject: subject.trim() || undefined,
        feedback: feedback.trim(),
      });
      const data = res?.data ?? res;
      if (data?.error) throw Object.assign(new Error(data.error), { code: data.code });

      setSent(true);
      resetTimer.current = setTimeout(() => {
        setOpen(false);
        setSubject("");
        setFeedback("");
        setSent(false);
      }, 2000);
    } catch (error) {
      const code = error?.code || error?.response?.data?.code;
      toast.error(code === OUTBOUND_DELIVERY_PAUSED_CODE
        ? OUTBOUND_DELIVERY_PAUSED_MESSAGE
        : 'Failed to send feedback. Please try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
        >
          <MessageSquare className="w-4 h-4" />
          <span className="hidden sm:inline">Feedback</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Send Feedback or Suggestion</DialogTitle>
          <DialogDescription>
            Share your ideas, report issues, or suggest new features. Your feedback helps us improve PennSync by CareMetric.
            Please do not include patient information.
          </DialogDescription>
        </DialogHeader>
        {sent ? (
          <div className="flex flex-col items-center justify-center py-8 text-center" role="status">
            <CheckCircle2 className="w-16 h-16 text-green-600 mb-4" aria-hidden="true" />
            <p className="text-lg font-semibold text-green-600">Feedback Sent!</p>
            <p className="text-sm text-slate-600">Thank you for helping us improve.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="subject">Subject (Optional)</Label>
              <Input
                id="subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="e.g., Feature Request, Bug Report, Improvement"
                maxLength={MAX_SUBJECT_LENGTH}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="feedback">Your Feedback *</Label>
              <Textarea
                id="feedback"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="Tell us what's on your mind..."
                maxLength={MAX_FEEDBACK_LENGTH}
                className="mt-1 min-h-[150px]"
                required
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={sending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!feedback.trim() || sending}
                className="gap-2"
              >
                {sending ? (
                  <>Sending...</>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    Send Feedback
                  </>
                )}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
