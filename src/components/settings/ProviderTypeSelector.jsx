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
    credential_type: 'RN',
    specialty: '',
    preferred_note_style: 'detailed'
  });

  React.useEffect(() => {
    const activeUser = currentUser || user;
    if (activeUser) {
      setFormData({
        credential_type: activeUser.credential_type || 'RN',
        specialty: activeUser.specialty || '',
        preferred_note_style: activeUser.preferred_note_style || 'detailed'
      });
    }
  }, [currentUser, user]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Sync provider type to other settings if it changed
    if ((currentUser?.credential_type || user?.credential_type) !== formData.credential_type) {
      try {
        await base44.functions.invoke('syncProviderType', {
          credential_type: formData.credential_type
        });
      } catch (syncError) {
        console.error('Error syncing provider type:', syncError);
      }
    }

    updateUserMutation.mutate(formData);
  };

  const providerTypes = [
  { value: "RN", label: "Registered Nurse (RN)" },
  { value: "LPN", label: "Licensed Practical Nurse (LPN)" }];


  const selectedProviderSetting = providerSettings.find(
    (ps) => ps.provider_type === formData.credential_type && ps.is_active
  );

  return (
    <div className="space-y-4">
      {allowAdminOverride && user?.role === 'admin' &&
      <Alert className="border-amber-300 bg-amber-50">
          <Info className="w-4 h-4 text-amber-600" />
          <AlertDescription className="text-amber-900">
            <strong>Admin Testing Mode:</strong> You can switch provider types to test different features and AI behaviors. Changes will reload the page.
          </AlertDescription>
        </Alert>
      }
      
      <Card>
        <CardHeader className="bg-slate-200 p-6 flex flex-col space-y-1.5">
          <CardTitle className="flex items-center gap-2">
            <Stethoscope className="w-5 h-5" />
            Provider Profile
          </CardTitle>
          <p className="text-sm text-gray-600 mt-1">
            Configure your nursing profile for home health & hospice documentation
          </p>
        </CardHeader>
      <CardContent className="bg-slate-100 pt-0 p-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label>Provider Type</Label>
            <select className="bg-slate-50 mt-1 p-2 rounded w-full border"

              value={formData.credential_type}
              onChange={(e) => setFormData({ ...formData, credential_type: e.target.value })}>

              {providerTypes.map((pt) =>
                <option key={pt.value} value={pt.value}>{pt.label}</option>
                )}
            </select>
            {!allowAdminOverride && user?.role !== 'admin' &&
              <p className="text-xs text-gray-500 mt-1">Changes will take effect after saving</p>
              }
          </div>

          {selectedProviderSetting &&
            <Alert className="bg-blue-50 border-blue-200">
              <Info className="w-4 h-4 text-blue-600" />
              <AlertDescription className="text-sm text-blue-800">
                <strong>Active Configuration:</strong> {selectedProviderSetting.display_name}
                <br />
                Your notes will be tailored to {selectedProviderSetting.provider_type} standards and compliance requirements.
              </AlertDescription>
            </Alert>
            }

          <div>
            <Label>Clinical Specialty</Label>
            <select className="bg-slate-50 mt-1 p-2 rounded w-full border"
              value={formData.specialty}
              onChange={(e) => setFormData({ ...formData, specialty: e.target.value })}>
              <option value="">Select your specialty...</option>
              <option value="Generalist">Generalist (Home Health / Hospice)</option>
              <option value="Wound Care">Wound Care Nurse</option>
              <option value="Psychiatric">Psychiatric / Mental Health Nurse</option>
              <option value="Cardiac">Cardiac / Heart Failure Nurse</option>
              <option value="Palliative">Palliative Care Nurse</option>
              <option value="Diabetes">Diabetes Management Nurse</option>
              <option value="Pediatric">Pediatric Home Health Nurse</option>
              <option value="IV Therapy">IV Therapy / Infusion Nurse</option>
              <option value="Oncology">Oncology Nurse</option>
              <option value="Geriatric">Geriatric Nurse</option>
              <option value="Rehabilitation">Rehabilitation Nurse</option>
              <option value="Respiratory">Respiratory Care Nurse</option>
            </select>
          </div>

          <div>
            <Label>Preferred Note Style</Label>
            <select className="bg-slate-50 mt-1 p-2 rounded w-full border"
              value={formData.preferred_note_style}
              onChange={(e) => setFormData({ ...formData, preferred_note_style: e.target.value })}>
              <option value="detailed">Detailed Narrative</option>
              <option value="concise">Concise</option>
              <option value="narrative">Full Narrative</option>
              <option value="bullet_points">Bullet Points</option>
              <option value="soap">SOAP Note (Subjective/Objective/Assessment/Plan)</option>
              <option value="dap">DAP Note (Data/Assessment/Plan)</option>
              <option value="focus">Focus Charting (Data/Action/Response)</option>
            </select>
          </div>

          <Button type="submit" className="w-full" disabled={updateUserMutation.isPending}>
            <Save className="w-4 h-4 mr-2" />
            Save Provider Profile
          </Button>
        </form>
      </CardContent>
    </Card>
    </div>);

}