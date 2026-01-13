import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Stethoscope, Save, Info } from "lucide-react";
import { toast } from "sonner";

export default function ProviderTypeSelector({ currentUser, allowAdminOverride = false }) {
  const queryClient = useQueryClient();

  const { data: user } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: providerSettings = [] } = useQuery({
    queryKey: ['providerSettings'],
    queryFn: () => base44.entities.ProviderSettings.list()
  });

  const updateUserMutation = useMutation({
    mutationFn: (data) => base44.auth.updateMe(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['currentUser'] });
      toast.success('Provider settings updated - Page will reload to apply changes');
      setTimeout(() => window.location.reload(), 1500);
    }
  });

  const [formData, setFormData] = React.useState({
    provider_type: currentUser?.provider_type || user?.provider_type || 'RN',
    license_number: currentUser?.license_number || user?.license_number || '',
    credentials: currentUser?.credentials || user?.credentials || '',
    specialty: currentUser?.specialty || user?.specialty || '',
    preferred_note_style: currentUser?.preferred_note_style || user?.preferred_note_style || 'detailed'
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    updateUserMutation.mutate(formData);
  };

  const providerTypes = [
    { value: "RN", label: "Registered Nurse" },
    { value: "LPN", label: "Licensed Practical Nurse" },
    { value: "NP", label: "Nurse Practitioner" },
    { value: "MD", label: "Medical Doctor" },
    { value: "DO", label: "Doctor of Osteopathic Medicine" },
    { value: "PT", label: "Physical Therapist" },
    { value: "OT", label: "Occupational Therapist" },
    { value: "ST", label: "Speech Therapist" },
    { value: "MSW", label: "Medical Social Worker" },
    { value: "Chiropractor", label: "Chiropractor" }
  ];

  const selectedProviderSetting = providerSettings.find(
    ps => ps.provider_type === formData.provider_type && ps.is_active
  );

  return (
    <div className="space-y-4">
      {allowAdminOverride && user?.role === 'admin' && (
        <Alert className="border-amber-300 bg-amber-50">
          <Info className="w-4 h-4 text-amber-600" />
          <AlertDescription className="text-amber-900">
            <strong>Admin Testing Mode:</strong> You can switch provider types to test different features and AI behaviors. Changes will reload the page.
          </AlertDescription>
        </Alert>
      )}
      
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Stethoscope className="w-5 h-5" />
            Provider Profile
          </CardTitle>
          <p className="text-sm text-gray-600 mt-1">
            Configure your provider type to customize AI note generation and compliance checks
          </p>
        </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label>Provider Type</Label>
            <select
              className="w-full p-2 border rounded mt-1"
              value={formData.provider_type}
              onChange={(e) => setFormData({ ...formData, provider_type: e.target.value })}
            >
              {providerTypes.map(pt => (
                <option key={pt.value} value={pt.value}>{pt.label}</option>
              ))}
            </select>
            {!allowAdminOverride && user?.role !== 'admin' && (
              <p className="text-xs text-gray-500 mt-1">Changes will take effect after saving</p>
            )}
          </div>

          {selectedProviderSetting && (
            <Alert className="bg-blue-50 border-blue-200">
              <Info className="w-4 h-4 text-blue-600" />
              <AlertDescription className="text-sm text-blue-800">
                <strong>Active Configuration:</strong> {selectedProviderSetting.display_name}
                <br />
                Your notes will be tailored to {selectedProviderSetting.provider_type} standards and compliance requirements.
              </AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>License Number</Label>
              <Input
                value={formData.license_number}
                onChange={(e) => setFormData({ ...formData, license_number: e.target.value })}
                placeholder="e.g., RN123456"
              />
            </div>

            <div>
              <Label>Credentials</Label>
              <Input
                value={formData.credentials}
                onChange={(e) => setFormData({ ...formData, credentials: e.target.value })}
                placeholder="e.g., RN, BSN, MSN"
              />
            </div>
          </div>

          <div>
            <Label>Clinical Specialty</Label>
            <Input
              value={formData.specialty}
              onChange={(e) => setFormData({ ...formData, specialty: e.target.value })}
              placeholder="e.g., Wound Care, Cardiac, Palliative"
            />
          </div>

          <div>
            <Label>Preferred Note Style</Label>
            <select
              className="w-full p-2 border rounded mt-1"
              value={formData.preferred_note_style}
              onChange={(e) => setFormData({ ...formData, preferred_note_style: e.target.value })}
            >
              <option value="detailed">Detailed Narrative</option>
              <option value="concise">Concise</option>
              <option value="narrative">Full Narrative</option>
              <option value="bullet_points">Bullet Points</option>
              <option value="soap">SOAP Note (Subjective/Objective/Assessment/Plan)</option>
            </select>
          </div>

          <Button type="submit" className="w-full" disabled={updateUserMutation.isPending}>
            <Save className="w-4 h-4 mr-2" />
            Save Provider Profile
          </Button>
        </form>
      </CardContent>
    </Card>
    </div>
  );
}