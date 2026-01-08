import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserPlus } from "lucide-react";

export default function QuickPatientAddDialog({ open, onOpenChange, onPatientCreated }) {
  const [formData, setFormData] = useState({
    first_name: "",
    last_name: "",
    date_of_birth: "",
    primary_diagnosis: "",
    phone: "",
    address: ""
  });
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = async () => {
    if (!formData.first_name || !formData.last_name) {
      alert("Please enter at least first and last name");
      return;
    }

    setIsCreating(true);
    try {
      const newPatient = await base44.entities.Patient.create({
        ...formData,
        status: "active",
        care_type: "home_health"
      });

      onPatientCreated?.(newPatient);
      setFormData({
        first_name: "",
        last_name: "",
        date_of_birth: "",
        primary_diagnosis: "",
        phone: "",
        address: ""
      });
      onOpenChange(false);
    } catch (error) {
      alert("Failed to create patient. Please try again.");
    }
    setIsCreating(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="w-5 h-5" />
            Add New Patient
          </DialogTitle>
          <DialogDescription>
            Enter basic patient information to get started
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs mb-1.5 block">First Name *</Label>
              <Input
                value={formData.first_name}
                onChange={(e) => setFormData(prev => ({ ...prev, first_name: e.target.value }))}
                placeholder="John"
                className="h-10"
              />
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Last Name *</Label>
              <Input
                value={formData.last_name}
                onChange={(e) => setFormData(prev => ({ ...prev, last_name: e.target.value }))}
                placeholder="Smith"
                className="h-10"
              />
            </div>
          </div>

          <div>
            <Label className="text-xs mb-1.5 block">Date of Birth</Label>
            <Input
              type="date"
              value={formData.date_of_birth}
              onChange={(e) => setFormData(prev => ({ ...prev, date_of_birth: e.target.value }))}
              className="h-10"
            />
          </div>

          <div>
            <Label className="text-xs mb-1.5 block">Primary Diagnosis</Label>
            <Input
              value={formData.primary_diagnosis}
              onChange={(e) => setFormData(prev => ({ ...prev, primary_diagnosis: e.target.value }))}
              placeholder="e.g., CHF, COPD, Diabetes"
              className="h-10"
            />
          </div>

          <div>
            <Label className="text-xs mb-1.5 block">Phone</Label>
            <Input
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
              placeholder="(555) 123-4567"
              className="h-10"
            />
          </div>

          <div>
            <Label className="text-xs mb-1.5 block">Address</Label>
            <Input
              value={formData.address}
              onChange={(e) => setFormData(prev => ({ ...prev, address: e.target.value }))}
              placeholder="123 Main St, City, State ZIP"
              className="h-10"
            />
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={isCreating || !formData.first_name || !formData.last_name}
              className="flex-1 bg-blue-600 hover:bg-blue-700"
            >
              {isCreating ? "Creating..." : "Create Patient"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}