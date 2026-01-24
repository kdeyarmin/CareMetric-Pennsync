import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Shield, CheckCircle, XCircle } from "lucide-react";

const PROVIDER_TYPES = [
  { value: "RN", label: "RN (Registered Nurse)" },
  { value: "LPN", label: "LPN (Licensed Practical Nurse)" },
  { value: "NP", label: "NP (Nurse Practitioner)" },
  { value: "PHYSICIAN", label: "Physician (MD/DO)" },
  { value: "THERAPIST", label: "Therapist (PT/OT/ST)" },
  { value: "MSW", label: "MSW (Medical Social Worker)" },
  { value: "Chiropractor", label: "Chiropractor" }
];

export default function AgencyRoleBasedAccess({ agency }) {
  const queryClient = useQueryClient();
  const [selectedRole, setSelectedRole] = useState("RN");

  const { data: roleAccess = [] } = useQuery({
    queryKey: ['roleAccess', agency.agency_code],
    queryFn: () => base44.entities.AgencyFeatureAccess.filter({ agency_code: agency.agency_code })
  });

  const currentRoleAccess = roleAccess.find(r => r.provider_type === selectedRole);
  const [selectedFeatures, setSelectedFeatures] = useState(
    currentRoleAccess?.enabled_features || agency.enabled_features || []
  );

  React.useEffect(() => {
    const access = roleAccess.find(r => r.provider_type === selectedRole);
    setSelectedFeatures(access?.enabled_features || agency.enabled_features || []);
  }, [selectedRole, roleAccess, agency.enabled_features]);

  const updateRoleAccessMutation = useMutation({
    mutationFn: async ({ providerType, features }) => {
      const existing = roleAccess.find(r => r.provider_type === providerType);
      
      if (existing) {
        await base44.entities.AgencyFeatureAccess.update(existing.id, {
          enabled_features: features
        });
      } else {
        await base44.entities.AgencyFeatureAccess.create({
          agency_code: agency.agency_code,
          provider_type: providerType,
          enabled_features: features,
          feature_tier: agency.feature_tier || "professional"
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roleAccess'] });
      toast.success('Role-based access updated');
    }
  });

  const toggleFeature = (feature) => {
    const newFeatures = selectedFeatures.includes(feature)
      ? selectedFeatures.filter(f => f !== feature)
      : [...selectedFeatures, feature];
    setSelectedFeatures(newFeatures);
  };

  const handleSave = () => {
    updateRoleAccessMutation.mutate({
      providerType: selectedRole,
      features: selectedFeatures
    });
  };

  const resetToDefault = () => {
    setSelectedFeatures(agency.enabled_features || []);
    toast.info('Reset to agency default');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-blue-600" />
          Role-Based Access Control
        </CardTitle>
        <CardDescription>
          Configure which features specific provider types can access
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label>Select Provider Type</Label>
          <Select value={selectedRole} onValueChange={setSelectedRole}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROVIDER_TYPES.map(type => (
                <SelectItem key={type.value} value={type.value}>
                  {type.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <Label>Available Features for {selectedRole}</Label>
            <Button size="sm" variant="ghost" onClick={resetToDefault}>
              Reset to Default
            </Button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-4">
            {(agency.enabled_features || []).map((feature) => (
              <button
                key={feature}
                onClick={() => toggleFeature(feature)}
                className={`flex items-center gap-2 p-2 rounded border text-sm transition-colors ${
                  selectedFeatures.includes(feature)
                    ? "bg-green-50 border-green-300 text-green-900"
                    : "bg-slate-50 border-slate-200 text-slate-400"
                }`}
              >
                {selectedFeatures.includes(feature) ? (
                  <CheckCircle className="w-4 h-4 text-green-600" />
                ) : (
                  <XCircle className="w-4 h-4 text-slate-400" />
                )}
                <span className="truncate">{feature}</span>
              </button>
            ))}
          </div>

          {currentRoleAccess && (
            <Badge variant="outline" className="mb-3">
              Custom rules active for {selectedRole}
            </Badge>
          )}

          <Button 
            onClick={handleSave} 
            disabled={updateRoleAccessMutation.isPending}
            className="w-full"
          >
            {updateRoleAccessMutation.isPending ? 'Saving...' : 'Save Role Access Rules'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}