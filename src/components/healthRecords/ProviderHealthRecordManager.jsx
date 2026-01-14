import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, FileText } from "lucide-react";

export default function ProviderHealthRecordManager({ patientId }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [formData, setFormData] = useState({
    record_type: "clinical_note",
    title: "",
    description: "",
    clinical_significance: "moderate",
    status: "active"
  });

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me(),
  });

  const { data: records, refetch } = useQuery({
    queryKey: ["patientRecords", patientId],
    queryFn: () => patientId ? base44.entities.HealthRecord.filter({ patient_id: patientId }) : Promise.resolve([]),
    enabled: !!patientId,
    initialData: []
  });

  const handleSaveRecord = async (e) => {
    e.preventDefault();
    try {
      const recordData = {
        ...formData,
        patient_id: patientId,
        record_date: new Date().toISOString().split('T')[0],
        provider_name: currentUser?.full_name,
        provider_email: currentUser?.email
      };

      if (selectedRecord) {
        await base44.entities.HealthRecord.update(selectedRecord.id, recordData);
      } else {
        await base44.entities.HealthRecord.create(recordData);
      }

      setDialogOpen(false);
      setSelectedRecord(null);
      setFormData({ record_type: "clinical_note", title: "", description: "", clinical_significance: "moderate", status: "active" });
      refetch();
    } catch (error) {
      alert('Error saving record: ' + error.message);
    }
  };

  const handleEdit = (record) => {
    setSelectedRecord(record);
    setFormData({
      record_type: record.record_type,
      title: record.title,
      description: record.description,
      clinical_significance: record.clinical_significance,
      status: record.status
    });
    setDialogOpen(true);
  };

  const handleDelete = async (id) => {
    if (confirm('Delete this record?')) {
      try {
        await base44.entities.HealthRecord.delete(id);
        refetch();
      } catch (error) {
        alert('Error deleting record: ' + error.message);
      }
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-xl font-semibold">Health Records</h3>
        <Button onClick={() => {
          setSelectedRecord(null);
          setFormData({ record_type: "clinical_note", title: "", description: "", clinical_significance: "moderate", status: "active" });
          setDialogOpen(true);
        }}>
          <Plus className="w-4 h-4 mr-2" />
          Add Record
        </Button>
      </div>

      <div className="space-y-3">
        {records.length === 0 ? (
          <p className="text-sm text-gray-500">No health records added yet</p>
        ) : (
          records.map(record => (
            <Card key={record.id}>
              <CardContent className="pt-6">
                <div className="flex justify-between items-start gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <FileText className="w-4 h-4" />
                      <p className="font-semibold">{record.title}</p>
                      <Badge>{record.record_type}</Badge>
                    </div>
                    <p className="text-sm text-gray-600">{record.description}</p>
                    <div className="flex gap-2 mt-2">
                      <Badge variant="outline" className="text-xs">{record.status}</Badge>
                      <Badge className="text-xs bg-gray-100 text-gray-800">{record.clinical_significance}</Badge>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => handleEdit(record)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => handleDelete(record.id)}>
                      Delete
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Add/Edit Record Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selectedRecord ? 'Edit Health Record' : 'Add Health Record'}</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSaveRecord} className="space-y-4">
            <div>
              <Label>Record Type</Label>
              <Select value={formData.record_type} onValueChange={(val) => setFormData({ ...formData, record_type: val })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="diagnosis">Diagnosis</SelectItem>
                  <SelectItem value="medication">Medication</SelectItem>
                  <SelectItem value="allergy">Allergy</SelectItem>
                  <SelectItem value="lab_result">Lab Result</SelectItem>
                  <SelectItem value="imaging">Imaging</SelectItem>
                  <SelectItem value="clinical_note">Clinical Note</SelectItem>
                  <SelectItem value="encounter_summary">Encounter Summary</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Title</Label>
              <Input
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="Record title"
                required
              />
            </div>

            <div>
              <Label>Description</Label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Detailed description of the record"
                className="h-24"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Clinical Significance</Label>
                <Select value={formData.clinical_significance} onValueChange={(val) => setFormData({ ...formData, clinical_significance: val })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="moderate">Moderate</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Status</Label>
                <Select value={formData.status} onValueChange={(val) => setFormData({ ...formData, status: val })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="reviewed">Reviewed</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit">{selectedRecord ? 'Update' : 'Add'} Record</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}