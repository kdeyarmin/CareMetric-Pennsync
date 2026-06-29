import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Upload, Loader2, FileText, AlertCircle, Brain } from "lucide-react";
import { toast } from "sonner";
import { validateFileUpload } from "@/components/utils/security";
import { analyzeDocument } from "@/functions/analyzeDocument";

const CATEGORIES = [
  { value: "lab_results", label: "Lab Results" },
  { value: "imaging", label: "Imaging/X-Ray" },
  { value: "consent_forms", label: "Consent Forms" },
  { value: "insurance", label: "Insurance Documents" },
  { value: "referral", label: "Referral" },
  { value: "progress_notes", label: "Progress Notes" },
  { value: "discharge_summary", label: "Discharge Summary" },
  { value: "medication_list", label: "Medication List" },
  { value: "orders", label: "Orders" },
  { value: "other", label: "Other" }
];

export default function DocumentUploader({ patientId, onUploadComplete, open, onOpenChange }) {
  const [file, setFile] = useState(null);
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    category: "",
    document_date: new Date().toISOString().split('T')[0],
    tags: "",
    notes: "",
    is_sensitive: false,
    auto_analyze: true
  });

  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: allPatients = [] } = useQuery({
    queryKey: ['patients'],
    queryFn: () => base44.entities.Patient.list('-updated_date', 2000),
    initialData: [],
    enabled: !patientId
  });

  const [selectedPatientId, setSelectedPatientId] = useState(patientId || "");

  useEffect(() => {
    if (patientId) setSelectedPatientId(patientId);
  }, [patientId]);

  const uploadMutation = useMutation({
    mutationFn: async (data) => {
      const { file_url } = await base44.integrations.Core.UploadFile({ file: data.file });
      
      const documentData = {
        title: data.title,
        description: data.description,
        file_url,
        file_name: data.file.name,
        file_size: data.file.size,
        file_type: data.file.type,
        category: data.category,
        patient_id: data.patient_id || null,
        tags: data.tags ? data.tags.split(',').map(t => t.trim()) : [],
        document_date: data.document_date,
        uploaded_by: currentUser?.email,
        notes: data.notes,
        is_sensitive: data.is_sensitive
      };

      const newDoc = await base44.entities.Document.create(documentData);
      
      // Trigger AI analysis if enabled
      if (data.auto_analyze) {
        setTimeout(() => {
          analyzeDocument({ document_id: newDoc.id }).catch(err => {
            console.error('Auto-analysis failed:', err);
          });
        }, 500);
      }
      
      return newDoc;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      queryClient.invalidateQueries({ queryKey: ['patient-documents'] });
      toast.success("Document uploaded successfully");
      resetForm();
      onUploadComplete?.();
      onOpenChange?.(false);
    },
    onError: (error) => {
      toast.error("Upload failed: " + error.message);
    }
  });

  const resetForm = () => {
    setFile(null);
    setFormData({
      title: "",
      description: "",
      category: "",
      document_date: new Date().toISOString().split('T')[0],
      tags: "",
      notes: "",
      is_sensitive: false,
      auto_analyze: true
    });
    if (!patientId) setSelectedPatientId("");
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!file) {
      toast.error("Please select a file");
      return;
    }
    if (!formData.category) {
      toast.error("Please select a category");
      return;
    }
    // The file input has no `accept`, so guard type + size before uploading.
    const check = validateFileUpload(file, {
      maxSize: 50 * 1024 * 1024,
      allowedTypes: [
        'application/pdf', 'image/png', 'image/jpeg',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain',
      ],
      allowedExtensions: ['.pdf', '.png', '.jpg', '.jpeg', '.doc', '.docx', '.txt'],
    });
    if (!check.valid) { toast.error(check.error); return; }

    uploadMutation.mutate({
      file,
      ...formData,
      patient_id: selectedPatientId || null
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Upload Document</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>File *</Label>
            <div className="border-2 border-dashed rounded-lg p-6 text-center hover:border-indigo-500 transition-colors">
              <input
                type="file"
                id="file-upload"
                className="hidden"
                onChange={(e) => {
                  const selectedFile = e.target.files?.[0];
                  setFile(selectedFile);
                  if (selectedFile && !formData.title) {
                    setFormData({ ...formData, title: selectedFile.name });
                  }
                }}
              />
              <label htmlFor="file-upload" className="cursor-pointer">
                {file ? (
                  <div className="flex items-center justify-center gap-2">
                    <FileText className="w-8 h-8 text-indigo-600" />
                    <div>
                      <p className="font-medium">{file.name}</p>
                      <p className="text-sm text-slate-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                    </div>
                  </div>
                ) : (
                  <div>
                    <Upload className="w-12 h-12 mx-auto text-slate-400 mb-2" />
                    <p className="text-sm text-slate-600">Click to select file or drag and drop</p>
                  </div>
                )}
              </label>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Title *</Label>
              <Input
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Category *</Label>
              <Select value={formData.category} onValueChange={(value) => setFormData({ ...formData, category: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(cat => (
                    <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {!patientId && (
            <div className="space-y-2">
              <Label>Patient (Optional)</Label>
              <Select value={selectedPatientId || "none"} onValueChange={(v) => setSelectedPatientId(v === "none" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select patient" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No patient</SelectItem>
                  {allPatients.map(patient => (
                    <SelectItem key={patient.id} value={patient.id}>
                      {patient.first_name} {patient.last_name} - MRN: {patient.medical_record_number}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={2}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Document Date</Label>
              <Input
                type="date"
                value={formData.document_date}
                onChange={(e) => setFormData({ ...formData, document_date: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Tags (comma-separated)</Label>
              <Input
                placeholder="urgent, review, follow-up"
                value={formData.tags}
                onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 p-3 bg-amber-50 rounded-lg border border-amber-200">
              <input
                type="checkbox"
                id="sensitive"
                checked={formData.is_sensitive}
                onChange={(e) => setFormData({ ...formData, is_sensitive: e.target.checked })}
                className="rounded"
              />
              <label htmlFor="sensitive" className="text-sm flex items-center gap-2 cursor-pointer">
                <AlertCircle className="w-4 h-4 text-amber-600" />
                Mark as sensitive document
              </label>
            </div>
            <div className="flex items-center gap-2 p-3 bg-navy-50 rounded-lg border border-navy-200">
              <input
                type="checkbox"
                id="auto-analyze"
                checked={formData.auto_analyze}
                onChange={(e) => setFormData({ ...formData, auto_analyze: e.target.checked })}
                className="rounded"
              />
              <label htmlFor="auto-analyze" className="text-sm flex items-center gap-2 cursor-pointer">
                <Brain className="w-4 h-4 text-navy-600" />
                Auto-analyze with AI after upload
              </label>
            </div>
          </div>

          <div className="flex gap-2 pt-4">
            <Button type="submit" disabled={uploadMutation.isPending} className="flex-1">
              {uploadMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 mr-2" />
                  Upload Document
                </>
              )}
            </Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange?.(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}