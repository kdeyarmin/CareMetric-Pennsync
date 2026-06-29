import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Trash2, Loader2 } from "lucide-react";

// Admin dialog to assign / clear an on-call person for a single coverage slot.
export default function AssignOnCallDialog({ open, slot, staff = [], onClose, onSave, onDelete }) {
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (slot) {
      setEmail(slot.shift?.assigned_user_email || "");
      setNotes(slot.shift?.notes || "");
    }
  }, [slot]);

  if (!slot) return null;

  const prettyDate = new Date(`${slot.iso}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const handleSave = async () => {
    const person = staff.find((s) => s.email === email);
    setSaving(true);
    try {
      await onSave({
        slot,
        assigned_user_email: email || "",
        assigned_user_name: person?.full_name || person?.email || "",
        notes,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setSaving(true);
    try {
      await onDelete(slot);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{prettyDate}</DialogTitle>
          <DialogDescription className="flex items-center gap-2">
            {slot.coverage_type === "holiday" ? (
              <Badge className="bg-red-100 text-red-800 border border-red-200">{slot.holiday_name}</Badge>
            ) : (
              <Badge className="bg-navy-100 text-navy-800 border border-navy-200">Overnight</Badge>
            )}
            <span className="text-slate-500">
              {slot.start_label} – {slot.end_label}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Assigned staff</Label>
            <Select value={email || "unassigned"} onValueChange={(v) => setEmail(v === "unassigned" ? "" : v)}>
              <SelectTrigger>
                <SelectValue placeholder="Select staff member" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {staff.map((s) => (
                  <SelectItem key={s.email} value={s.email}>
                    {s.full_name || s.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Notes (optional)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. backup is Jane" />
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          {slot.shift?.id && (
            <Button variant="outline" onClick={handleDelete} disabled={saving} className="text-red-600 hover:text-red-700 sm:mr-auto">
              <Trash2 className="w-4 h-4 mr-2" />
              Clear
            </Button>
          )}
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}