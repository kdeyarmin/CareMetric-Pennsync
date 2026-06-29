import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info } from "lucide-react";
import { toast } from 'sonner';
import { validateFileUpload } from '@/components/utils/security';

// Common personnel file items. Picking a preset fills in the type + title so
// staff don't have to figure out the right wording. Auto insurance and car
// registration are required for ALL staff, even those with a company vehicle.
const PRESETS = [
  { key: "rn_license", label: "RN / Nursing License", item_type: "license", title: "RN License" },
  { key: "cpr_bls", label: "CPR / BLS Certification", item_type: "certification", title: "CPR / BLS Certification" },
  { key: "acls", label: "ACLS Certification", item_type: "certification", title: "ACLS Certification" },
  { key: "auto_insurance", label: "Auto Insurance (required)", item_type: "insurance", title: "Auto Insurance" },
  { key: "car_registration", label: "Car Registration (required)", item_type: "insurance", title: "Car Registration" },
  { key: "drivers_license", label: "Driver's License", item_type: "license", title: "Driver's License" },
  { key: "other", label: "Other", item_type: "license", title: "" },
];

export default function PersonnelCredentialForm({ currentUser, existingItem, onDone }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(existingItem || {
    item_type: "license",
    title: "",
    issuing_organization: "",
    credential_number: "",
    issued_date: "",
    expiration_date: "",
    uploaded_file_url: "",
    uploaded_file_name: "",
    notes: "",
  });
  const [file, setFile] = useState(null);
  const [preset, setPreset] = useState("");

  const applyPreset = (key) => {
    setPreset(key);
    const found = PRESETS.find((p) => p.key === key);
    if (found && key !== "other") {
      setForm((prev) => ({ ...prev, item_type: found.item_type, title: found.title }));
    }
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      let uploaded_file_url = form.uploaded_file_url;
      let uploaded_file_name = form.uploaded_file_name;

      if (file) {
        const uploadResult = await base44.integrations.Core.UploadFile({ file });
        uploaded_file_url = uploadResult.file_url;
        uploaded_file_name = file.name;
      }

      const payload = {
        item_type: form.item_type,
        title: form.title,
        issuing_organization: form.issuing_organization || undefined,
        credential_number: form.credential_number || undefined,
        issued_date: form.issued_date || undefined,
        expiration_date: form.expiration_date,
        uploaded_file_url: uploaded_file_url || undefined,
        uploaded_file_name: uploaded_file_name || undefined,
        notes: form.notes || undefined,
        user_id: currentUser.email,
        user_name: currentUser.full_name,
        agency_name: currentUser.agency_name || undefined,
        status: "pending_approval",
        approved_by: undefined,
        approved_at: undefined,
        rejection_reason: undefined,
        reminder_offsets_sent: existingItem?.reminder_offsets_sent || [],
        last_reminder_sent_at: existingItem?.last_reminder_sent_at || undefined,
      };

      if (existingItem?.id) {
        return base44.entities.PersonnelCredential.update(existingItem.id, payload);
      }
      return base44.entities.PersonnelCredential.create(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["personnel-credentials"] });
      onDone?.();
    },
    onError: (error) => {
      toast.error(error.message || "Unable to save personnel file item.");
    }
  });

  return (
    <div className="space-y-4">
      <Alert className="border-navy-200 bg-navy-50">
        <Info className="h-4 w-4 text-navy-700" />
        <AlertDescription className="text-navy-900 text-sm">
          Pick a common item below to start fast. <strong>An expiration date is always required</strong> — even when you upload a copy of your license, CPR card, insurance, or registration. Auto insurance and car registration are required for everyone, including company vehicle drivers.
        </AlertDescription>
      </Alert>

      <div>
        <Label>Quick add a common item</Label>
        <Select value={preset} onValueChange={applyPreset}>
          <SelectTrigger><SelectValue placeholder="Choose an item to auto-fill" /></SelectTrigger>
          <SelectContent>
            {PRESETS.map((p) => (
              <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label>Item type</Label>
          <Select value={form.item_type} onValueChange={(value) => setForm({ ...form, item_type: value })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="license">License</SelectItem>
              <SelectItem value="certification">Certification</SelectItem>
              <SelectItem value="insurance">Insurance</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Title</Label>
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="RN License, BLS, Auto Insurance" />
        </div>
        <div>
          <Label>Issuing organization</Label>
          <Input value={form.issuing_organization || ""} onChange={(e) => setForm({ ...form, issuing_organization: e.target.value })} placeholder="PA State Board, AHA, Carrier" />
        </div>
        <div>
          <Label>Credential / policy number</Label>
          <Input value={form.credential_number || ""} onChange={(e) => setForm({ ...form, credential_number: e.target.value })} />
        </div>
        <div>
          <Label>Issued date</Label>
          <Input type="date" value={form.issued_date || ""} onChange={(e) => setForm({ ...form, issued_date: e.target.value })} />
        </div>
        <div>
          <Label>Expiration date <span className="text-red-600">*</span></Label>
          <Input type="date" value={form.expiration_date || ""} onChange={(e) => setForm({ ...form, expiration_date: e.target.value })} />
          <p className="text-xs text-slate-500 mt-1">Required — must be entered manually even if a document is uploaded.</p>
        </div>
      </div>

      <div>
        <Label>Upload current document</Label>
        <Input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => {
          const f = e.target.files?.[0] || null;
          if (f) {
            // accept="" is only a UI hint; validate type + size before accepting.
            const check = validateFileUpload(f, {
              maxSize: 15 * 1024 * 1024,
              allowedTypes: ['application/pdf', 'image/png', 'image/jpeg'],
              allowedExtensions: ['.pdf', '.png', '.jpg', '.jpeg'],
            });
            if (!check.valid) { toast.error(check.error); e.target.value = ''; setFile(null); return; }
          }
          setFile(f);
        }} />
        <p className="text-xs text-slate-500 mt-1">Uploading a copy does not replace the expiration date above.</p>
      </div>

      <div>
        <Label>Notes</Label>
        <Textarea rows={4} value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Optional notes about renewal, restrictions, or replacement upload." />
      </div>

      <Button className="w-full" disabled={saveMutation.isPending || !form.title || !form.expiration_date} onClick={() => saveMutation.mutate()}>
        {saveMutation.isPending ? "Saving..." : existingItem ? "Submit updated copy for approval" : "Add to personnel file"}
      </Button>
    </div>
  );
}