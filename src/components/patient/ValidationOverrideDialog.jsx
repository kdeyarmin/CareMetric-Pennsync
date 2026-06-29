import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";
import { toast } from 'sonner';

export default function ValidationOverrideDialog({ 
  isOpen, 
  onClose, 
  warning, 
  onOverride 
}) {
  const [justification, setJustification] = useState("");

  const handleOverride = () => {
    if (!justification.trim()) {
      toast.error("Please provide a justification for overriding this warning");
      return;
    }
    
    onOverride(warning.field, justification);
    setJustification("");
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Override Validation Warning</DialogTitle>
        </DialogHeader>

        <Alert variant="warning" className="mb-4">
          <AlertTriangle className="w-4 h-4" />
          <AlertDescription>
            <strong>{warning?.field}:</strong> {warning?.message}
          </AlertDescription>
        </Alert>

        <div className="space-y-2">
          <Label htmlFor="justification">
            Justification <span className="text-red-500">*</span>
          </Label>
          <Textarea
            id="justification"
            placeholder="Explain why you're overriding this warning..."
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            className="min-h-[100px]"
          />
          <p className="text-xs text-slate-500">
            This justification will be logged for audit purposes.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button 
            onClick={handleOverride}
            disabled={!justification.trim()}
            className="bg-amber-600 hover:bg-amber-700"
          >
            Override Warning
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}