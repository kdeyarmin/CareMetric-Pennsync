import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Activity, Save, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function InVisitVitalsCollection({ visitId, patientId, onSaved }) {
  const [vitals, setVitals] = useState({
    temperature: '',
    blood_pressure_systolic: '',
    blood_pressure_diastolic: '',
    heart_rate: '',
    respiratory_rate: '',
    oxygen_saturation: '',
    pain_level: '',
    weight: ''
  });

  const queryClient = useQueryClient();

  const saveVitalsMutation = useMutation({
    mutationFn: async () => {
      // Update the visit with vitals
      await base44.entities.Visit.update(visitId, {
        vital_signs: vitals
      });
      return vitals;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['visit', visitId]);
      toast.success('Vitals saved successfully');
      onSaved?.(vitals);
    },
    onError: () => {
      toast.error('Failed to save vitals');
    }
  });

  const handleSave = () => {
    saveVitalsMutation.mutate();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Activity className="w-4 h-4" />
          Collect Vitals During Call
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-gray-600 mb-3">
          Guide patient to measure and report vitals during the video call
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Temperature (°F)</Label>
            <Input
              type="number"
              step="0.1"
              placeholder="98.6"
              value={vitals.temperature}
              onChange={(e) => setVitals({...vitals, temperature: parseFloat(e.target.value)})}
              className="h-8 text-sm"
            />
          </div>

          <div>
            <Label className="text-xs">BP (systolic/diastolic)</Label>
            <div className="flex gap-1">
              <Input
                type="number"
                placeholder="120"
                value={vitals.blood_pressure_systolic}
                onChange={(e) => setVitals({...vitals, blood_pressure_systolic: parseInt(e.target.value)})}
                className="h-8 text-sm"
              />
              <Input
                type="number"
                placeholder="80"
                value={vitals.blood_pressure_diastolic}
                onChange={(e) => setVitals({...vitals, blood_pressure_diastolic: parseInt(e.target.value)})}
                className="h-8 text-sm"
              />
            </div>
          </div>

          <div>
            <Label className="text-xs">Heart Rate (bpm)</Label>
            <Input
              type="number"
              placeholder="72"
              value={vitals.heart_rate}
              onChange={(e) => setVitals({...vitals, heart_rate: parseInt(e.target.value)})}
              className="h-8 text-sm"
            />
          </div>

          <div>
            <Label className="text-xs">O2 Saturation (%)</Label>
            <Input
              type="number"
              placeholder="98"
              value={vitals.oxygen_saturation}
              onChange={(e) => setVitals({...vitals, oxygen_saturation: parseInt(e.target.value)})}
              className="h-8 text-sm"
            />
          </div>

          <div>
            <Label className="text-xs">Respiratory Rate</Label>
            <Input
              type="number"
              placeholder="16"
              value={vitals.respiratory_rate}
              onChange={(e) => setVitals({...vitals, respiratory_rate: parseInt(e.target.value)})}
              className="h-8 text-sm"
            />
          </div>

          <div>
            <Label className="text-xs">Pain Level (0-10)</Label>
            <Input
              type="number"
              min="0"
              max="10"
              placeholder="0"
              value={vitals.pain_level}
              onChange={(e) => setVitals({...vitals, pain_level: parseInt(e.target.value)})}
              className="h-8 text-sm"
            />
          </div>

          <div>
            <Label className="text-xs">Weight (lbs)</Label>
            <Input
              type="number"
              step="0.1"
              placeholder="150"
              value={vitals.weight}
              onChange={(e) => setVitals({...vitals, weight: parseFloat(e.target.value)})}
              className="h-8 text-sm"
            />
          </div>
        </div>

        <Button
          onClick={handleSave}
          disabled={saveVitalsMutation.isPending}
          className="w-full"
          size="sm"
        >
          {saveVitalsMutation.isPending ? (
            <>
              <Loader2 className="w-3 h-3 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="w-3 h-3 mr-2" />
              Save Vitals
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}