import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
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

export default function FeedbackButton() {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [feedback, setFeedback] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!feedback.trim()) return;

    setSending(true);
    try {
      await base44.integrations.Core.SendEmail({
        to: "kdeyarmin@pennhospice.com",
        subject: subject || "Feedback from Penn Sync User",
        body: `
Feedback from: ${currentUser?.full_name || 'Unknown'} (${currentUser?.email || 'No email'})
Role: ${currentUser?.role || 'Unknown'}

Subject: ${subject || 'General Feedback'}

Feedback:
${feedback}

---
Sent from Penn Sync Feedback Feature
        `.trim()
      });

      setSent(true);
      setTimeout(() => {
        setOpen(false);
        setSubject("");
        setFeedback("");
        setSent(false);
      }, 2000);
    } catch (error) {
      console.error('Error sending feedback:', error);
      toast.error('Failed to send feedback. Please try again.');
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
            Share your ideas, report issues, or suggest new features. Your feedback helps us improve Penn Sync.
          </DialogDescription>
        </DialogHeader>
        {sent ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <CheckCircle2 className="w-16 h-16 text-green-600 mb-4" />
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