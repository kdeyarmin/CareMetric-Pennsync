import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Settings, CheckCircle, XCircle, Lock } from "lucide-react";

export default function AgencyFeatureSettings({ agency }) {
  const queryClient = useQueryClient();
  const [selectedFeatures, setSelectedFeatures] = useState(agency.enabled_features || []);

  const updateFeaturesMutation = useMutation({
    mutationFn: async (features) => {
      await base44.entities.Agency.update(agency.id, {
        enabled_features: features
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['myAgency'] });
      toast.success('Feature settings updated');
    }
  });

  const toggleFeature = (feature) => {
    const newFeatures = selectedFeatures.includes(feature)
      ? selectedFeatures.filter(f => f !== feature)
      : [...selectedFeatures, feature];
    setSelectedFeatures(newFeatures);
  };

  const handleSave = () => {
    updateFeaturesMutation.mutate(selectedFeatures);
  };

  const tierName = {
    basic: "Basic",
    professional: "Professional", 
    enterprise: "Enterprise",
    custom: "Custom"
  }[agency.feature_tier || "professional"];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="w-5 h-5" />
          Feature Settings
        </CardTitle>
        <CardDescription>
          Manage which features are enabled for your agency
          <Badge className="ml-2">{tierName} Tier</Badge>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {selectedFeatures.map((feature) => (
            <button
              key={feature}
              onClick={() => toggleFeature(feature)}
              className="flex items-center gap-2 p-2 rounded border text-sm transition-colors bg-blue-50 border-blue-300 text-blue-900"
            >
              <CheckCircle className="w-4 h-4 text-blue-600" />
              <span className="truncate">{feature}</span>
            </button>
          ))}
        </div>

        <div className="pt-4 border-t">
          <p className="text-xs text-slate-600 mb-2">
            <Lock className="w-3 h-3 inline mr-1" />
            Contact your administrator to add more features or upgrade your tier
          </p>
          <Button onClick={handleSave} disabled={updateFeaturesMutation.isPending}>
            {updateFeaturesMutation.isPending ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}