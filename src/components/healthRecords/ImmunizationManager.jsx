import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Syringe } from "lucide-react";

export default function ImmunizationManager({ patientId }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    vaccine_name: "",
    vaccine_code: "",
    date_administered: "",
    site_of_administration: "right_arm",
    route: "intramuscular",
    dose_number: 1,
    reaction_or_notes: "",
    is_complete: false
  });

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me(),
  });

  const { data: immunizations, refetch } = useQuery({
    queryKey: ["patientImmunizations", patientId],
    queryFn: () => patientId ? base44.entities.Immunization.filter({ patient_id: patientId }) : Promise.resolve([]),
    enabled: !!patientId,
    initialData: []
  });

  const handleAddImmunization = async (e) => {
    e.preventDefault();
    try {
      await base44.entities.Immunization.create({
        ...formData,
        patient_id: patientId,
        provider_name: currentUser?.full_name,
        provider_email: currentUser?.email
      });

      setDialogOpen(false);
      setFormData({
        vaccine_name: "",
        vaccine_code: "",
        date_administered: "",
        site_of_administration: "right_arm",
        route: "intramuscular",
        dose_number: 1,
        reaction_or_notes: "",
        is_complete: false
      });
      refetch();
    } catch (error) {
      alert('Error adding immunization: ' + error.message);
    }
  };

  const handleDelete = async (id) => {
    if (confirm('Delete this immunization record?')) {
      try {
        await base44.entities.Immunization.delete(id);
        refetch();
      } catch (error) {
        alert('Error deleting immunization: ' + error.message);
      }
    }
  };

  const upcomingImms = immunizations.filter(imm => imm.next_dose_due && new Date(imm.next_dose_due) > new Date());

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-xl font-semibold">Immunizations</h3>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Add Immunization
        </Button>
      </div>

      {upcomingImms.length > 0 && (
        <Card className="border-l-4 border-blue-500 bg-blue-50">
          <CardContent className="pt-6">
            <p className="text-sm font-semibold text-blue-900">Upcoming Immunizations Due:</p>
            <ul className="text-sm text-blue-800 mt-2 space-y-1">
              {upcomingImms.map(imm => (
                <li key={imm.id}>• {imm.vaccine_name} - Due {new Date(imm.next_dose_due).toLocaleDateString()}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {immunizations.length === 0 ? (
          <p className="text-sm text-gray-500">No immunization records</p>
        ) : (
          immunizations.map(imm => (
            <Card key={imm.id}>
              <CardContent className="pt-6">
                <div className="flex justify-between items-start gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <Syringe className="w-4 h-4" />
                      <p className="font-semibold">{imm.vaccine_name}</p>
                      {imm.is_complete && <Badge className="bg-green-100 text-green-800">Complete</Badge>}
                    </div>
                    <p className="text-sm text-gray-600">
                      Administered: {new Date(imm.date_administered).toLocaleDateString()}
                    </p>
                    {imm.next_dose_due && (
                      <p className="text-sm text-blue-600">
                        Next dose: {new Date(imm.next_dose_due).toLocaleDateString()}
                      </p>
                    )}
                    {imm.reaction_or_notes && (
                      <p className="text-sm text-gray-600 mt-2">{imm.reaction_or_notes}</p>
                    )}
                  </div>
                  <Button size="sm" variant="destructive" onClick={() => handleDelete(imm.id)}>
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Add Immunization Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add Immunization Record</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleAddImmunization} className="space-y-4">
            <div>
              <Label>Vaccine Name</Label>
              <Input
                value={formData.vaccine_name}
                onChange={(e) => setFormData({ ...formData, vaccine_name: e.target.value })}
                placeholder="e.g., COVID-19, Flu, MMR"
                required
              />
            </div>

            <div>
              <Label>Date Administered</Label>
              <Input
                type="date"
                value={formData.date_administered}
                onChange={(e) => setFormData({ ...formData, date_administered: e.target.value })}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Site of Administration</Label>
                <Select value={formData.site_of_administration} onValueChange={(val) => setFormData({ ...formData, site_of_administration: val })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="left_arm">Left Arm</SelectItem>
                    <SelectItem value="right_arm">Right Arm</SelectItem>
                    <SelectItem value="left_thigh">Left Thigh</SelectItem>
                    <SelectItem value="right_thigh">Right Thigh</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Dose Number</Label>
                <Input
                  type="number"
                  value={formData.dose_number}
                  onChange={(e) => setFormData({ ...formData, dose_number: parseInt(e.target.value) })}
                  min="1"
                />
              </div>
            </div>

            <div>
              <Label>Next Dose Due (optional)</Label>
              <Input
                type="date"
                onChange={(e) => setFormData({ ...formData, next_dose_due: e.target.value })}
              />
            </div>

            <div>
              <Label>Reactions or Notes (optional)</Label>
              <Input
                value={formData.reaction_or_notes}
                onChange={(e) => setFormData({ ...formData, reaction_or_notes: e.target.value })}
                placeholder="Any reactions or clinical notes"
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit">Add Immunization</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}