import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Settings, CheckCircle, XCircle } from "lucide-react";

const FEATURE_PACKAGES = {
  basic: {
    name: "Basic",
    features: ["Dashboard", "Patients", "SmartNoteAssistant", "Settings"]
  },
  professional: {
    name: "Professional",
    features: ["Dashboard", "Patients", "SmartNoteAssistant", "MedicalScribe", "ClinicalDecisionSupport", "CarePlanManagement", "DocumentGenerator", "Templates", "Settings"]
  },
  enterprise: {
    name: "Enterprise",
    features: ["Dashboard", "Patients", "SmartNoteAssistant", "MedicalScribe", "Telehealth", "ClinicalDecisionSupport", "ClinicalReasoning", "CarePlanManagement", "DocumentGenerator", "DocumentAnalyzer", "TemplateLibrary", "OASIS", "Compliance", "NurseAnalyticsDashboard", "ProviderTrainingHub", "MyTraining", "Tasks", "BillingOptimization", "Settings"]
  }
};

const ALL_FEATURES = [
  "Dashboard", "Patients", "SmartNoteAssistant", "MedicalScribe", "Telehealth",
  "ClinicalDecisionSupport", "ClinicalReasoning", "CarePlanManagement", 
  "DocumentGenerator", "DocumentAnalyzer", "TemplateLibrary", "OASIS", 
  "Compliance", "NurseAnalyticsDashboard", "ProviderTrainingHub", "MyTraining",
  "Tasks", "BillingOptimization"
];

const PROVIDER_TYPES = ["all", "RN", "LPN", "NP", "PHYSICIAN", "THERAPIST", "MSW", "Chiropractor"];

export default function AgencyFeatureManager({ agency }) {
  const queryClient = useQueryClient();
  const [selectedTier, setSelectedTier] = useState(agency.feature_tier || "professional");
  const [selectedProvider, setSelectedProvider] = useState("all");
  const [customFeatures, setCustomFeatures] = useState(agency.enabled_features || []);

  const updateFeaturesMutation = useMutation({
    mutationFn: async ({ tier, features }) => {
      await base44.entities.Agency.update(agency.id, {
        enabled_features: features,
        feature_tier: tier
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agencies'] });
      toast.success('Agency features updated');
    }
  });

  const updateRoleFeaturesMutation = useMutation({
    mutationFn: async ({ providerType, features }) => {
      const existing = await base44.entities.AgencyFeatureAccess.filter({
        agency_code: agency.agency_code,
        provider_type: providerType
      });

      if (existing.length > 0) {
        await base44.entities.AgencyFeatureAccess.update(existing[0].id, {
          enabled_features: features
        });
      } else {
        await base44.entities.AgencyFeatureAccess.create({
          agency_code: agency.agency_code,
          provider_type: providerType,
          enabled_features: features
        });
      }
    },
    onSuccess: () => {
      toast.success('Role-based features updated');
    }
  });

  const handleApplyPackage = (tier) => {
    const features = FEATURE_PACKAGES[tier].features;
    setCustomFeatures(features);
    updateFeaturesMutation.mutate({ tier, features });
  };

  const toggleFeature = (feature) => {
    const newFeatures = customFeatures.includes(feature)
      ? customFeatures.filter(f => f !== feature)
      : [...customFeatures, feature];
    setCustomFeatures(newFeatures);
  };

  const handleSaveCustom = () => {
    updateFeaturesMutation.mutate({ tier: "custom", features: customFeatures });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="w-5 h-5" />
          Feature Management - {agency.agency_name}
        </CardTitle>
        <CardDescription>Configure which features are available to this agency</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Feature Packages */}
        <div>
          <h4 className="font-semibold mb-3">Quick Apply Feature Package</h4>
          <div className="grid grid-cols-3 gap-3">
            {Object.entries(FEATURE_PACKAGES).map(([tier, pkg]) => (
              <Button
                key={tier}
                variant={selectedTier === tier ? "default" : "outline"}
                onClick={() => handleApplyPackage(tier)}
                className="flex flex-col h-auto py-4"
              >
                <span className="font-bold">{pkg.name}</span>
                <span className="text-xs">{pkg.features.length} features</span>
              </Button>
            ))}
          </div>
        </div>

        {/* Custom Feature Selection */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-semibold">Custom Feature Selection</h4>
            <Badge variant={selectedTier === "custom" ? "default" : "outline"}>
              {selectedTier}
            </Badge>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {ALL_FEATURES.map((feature) => (
              <button
                key={feature}
                onClick={() => toggleFeature(feature)}
                className={`flex items-center gap-2 p-2 rounded border text-sm transition-colors ${
                  customFeatures.includes(feature)
                    ? "bg-blue-50 border-blue-300 text-blue-900"
                    : "bg-white border-slate-200 text-slate-700"
                }`}
              >
                {customFeatures.includes(feature) ? (
                  <CheckCircle className="w-4 h-4 text-blue-600" />
                ) : (
                  <XCircle className="w-4 h-4 text-slate-400" />
                )}
                <span className="truncate">{feature}</span>
              </button>
            ))}
          </div>
          <Button onClick={handleSaveCustom} className="mt-3" size="sm">
            Save Custom Configuration
          </Button>
        </div>

        {/* Role-Based Access */}
        <div className="pt-6 border-t">
          <h4 className="font-semibold mb-3">Role-Based Feature Access (Optional)</h4>
          <p className="text-sm text-slate-600 mb-3">
            Restrict features for specific provider types within this agency
          </p>
          <div className="space-y-3">
            <Select value={selectedProvider} onValueChange={setSelectedProvider}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDER_TYPES.map(type => (
                  <SelectItem key={type} value={type}>
                    {type === "all" ? "All Providers (Default)" : type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedProvider !== "all" && (
              <div>
                <p className="text-sm text-slate-600 mb-2">
                  Select features available to {selectedProvider}:
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {customFeatures.map((feature) => (
                    <label key={feature} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        defaultChecked
                        onChange={(e) => {
                          const roleFeatures = e.target.checked
                            ? [...(selectedProvider === "all" ? [] : customFeatures), feature]
                            : customFeatures.filter(f => f !== feature);
                          // Save immediately
                          updateRoleFeaturesMutation.mutate({
                            providerType: selectedProvider,
                            features: roleFeatures
                          });
                        }}
                      />
                      {feature}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}