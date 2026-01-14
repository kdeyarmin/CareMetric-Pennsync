import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, Phone, Ambulance, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";

export default function EmergencyEscalationProtocol({ visitId, patientId, patient }) {
  const [showDialog, setShowDialog] = useState(false);
  const [emergencyType, setEmergencyType] = useState(null);

  const escalateMutation = useMutation({
    mutationFn: async (type) => {
      // Create incident
      const incident = await base44.entities.Incident.create({
        patient_id: patientId,
        visit_id: visitId,
        incident_type: 'emergency_visit',
        incident_name: `Emergency during telehealth: ${type}`,
        incident_date: new Date().toISOString().split('T')[0],
        incident_time: new Date().toLocaleTimeString('en-US', { hour12: false }),
        severity: 'high',
        details: {
          emergency_type: type,
          escalated_from: 'telehealth_visit'
        },
        report: `Emergency identified during telehealth visit requiring ${type}`,
        physician_notified: type === '911',
        office_notified: true
      });

      return incident;
    },
    onSuccess: (incident, type) => {
      toast.success(`Emergency protocol activated: ${type}`);
      setShowDialog(false);
      setEmergencyType(null);
    },
    onError: () => {
      toast.error('Failed to activate emergency protocol');
    }
  });

  const emergencyOptions = [
    {
      type: '911',
      label: 'Call 911',
      icon: <Ambulance className="w-6 h-6" />,
      description: 'Life-threatening emergency requiring immediate medical attention',
      color: 'bg-red-100 border-red-300'
    },
    {
      type: 'physician_urgent',
      label: 'Contact Physician Urgently',
      icon: <Phone className="w-6 h-6" />,
      description: 'Urgent medical concern requiring physician consultation',
      color: 'bg-orange-100 border-orange-300'
    },
    {
      type: 'er_recommendation',
      label: 'Recommend ER Visit',
      icon: <AlertTriangle className="w-6 h-6" />,
      description: 'Recommend patient go to emergency room',
      color: 'bg-yellow-100 border-yellow-300'
    }
  ];

  return (
    <>
      <Card className="border-2 border-red-300 bg-red-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm text-red-800">
            <AlertTriangle className="w-4 h-4" />
            Emergency Protocol
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Button
            onClick={() => setShowDialog(true)}
            variant="destructive"
            className="w-full"
            size="sm"
          >
            <AlertTriangle className="w-4 h-4 mr-2" />
            Activate Emergency Protocol
          </Button>
        </CardContent>
      </Card>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-600" />
              Emergency Escalation Protocol
            </DialogTitle>
          </DialogHeader>

          <Alert className="bg-red-50 border-red-300">
            <AlertDescription className="text-sm">
              <strong>Patient:</strong> {patient?.first_name} {patient?.last_name}
              <br />
              <strong>Address:</strong> {patient?.address}
              <br />
              <strong>Emergency Contact:</strong> {patient?.emergency_contact_name} - {patient?.emergency_contact_phone}
            </AlertDescription>
          </Alert>

          <div className="space-y-3">
            <p className="text-sm font-medium">Select appropriate emergency response:</p>
            
            {emergencyOptions.map((option) => (
              <Card
                key={option.type}
                className={`border-2 ${option.color} cursor-pointer hover:shadow-md transition-all`}
                onClick={() => {
                  if (!escalateMutation.isPending) {
                    setEmergencyType(option.type);
                    escalateMutation.mutate(option.type);
                  }
                }}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-white rounded-lg">
                      {option.icon}
                    </div>
                    <div className="flex-1">
                      <h4 className="font-semibold text-sm mb-1">{option.label}</h4>
                      <p className="text-xs text-gray-600">{option.description}</p>
                    </div>
                    {escalateMutation.isPending && emergencyType === option.type && (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Alert>
            <AlertDescription className="text-xs">
              All emergency escalations are automatically logged and reported to the office.
              For 911 calls, ensure you stay on the line with the patient until help arrives.
            </AlertDescription>
          </Alert>
        </DialogContent>
      </Dialog>
    </>
  );
}