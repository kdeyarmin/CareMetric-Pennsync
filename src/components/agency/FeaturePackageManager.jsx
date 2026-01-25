import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Edit, Trash2, Package, DollarSign, Users, Check } from "lucide-react";

export default function FeaturePackageManager({ currentUser }) {
  const queryClient = useQueryClient();
  const [isCreating, setIsCreating] = useState(false);
  const [editingPackage, setEditingPackage] = useState(null);

  const [formData, setFormData] = useState({
    package_name: "",
    description: "",
    price_per_user: 29.99,
    tier: "professional",
    max_users: null,
    included_features: [],
    features_summary: {
      ai_tools: true,
      advanced_analytics: false,
      custom_training: false,
      api_access: false,
      dedicated_support: false
    }
  });

  const availableFeatures = [
    "SmartNoteAssistant",
    "MedicalScribe",
    "ClinicalDecisionSupport",
    "OASIS",
    "Compliance",
    "CarePlanManagement",
    "DocumentGenerator",
    "BillingOptimization",
    "ProviderTrainingHub",
    "NurseAnalyticsDashboard"
  ];

  const { data: packages = [] } = useQuery({
    queryKey: ['featurePackages'],
    queryFn: () => base44.entities.FeaturePackage.list(),
    enabled: currentUser?.role === 'admin'
  });

  const createPackageMutation = useMutation({
    mutationFn: (data) => base44.entities.FeaturePackage.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['featurePackages']);
      toast.success('Package created successfully');
      resetForm();
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to create package');
    }
  });

  const updatePackageMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.FeaturePackage.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['featurePackages']);
      toast.success('Package updated successfully');
      resetForm();
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to update package');
    }
  });

  const deletePackageMutation = useMutation({
    mutationFn: (id) => base44.entities.FeaturePackage.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['featurePackages']);
      toast.success('Package deleted');
    }
  });

  const resetForm = () => {
    setIsCreating(false);
    setEditingPackage(null);
    setFormData({
      package_name: "",
      description: "",
      price_per_user: 29.99,
      tier: "professional",
      max_users: null,
      included_features: [],
      features_summary: {
        ai_tools: true,
        advanced_analytics: false,
        custom_training: false,
        api_access: false,
        dedicated_support: false
      }
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (editingPackage) {
      updatePackageMutation.mutate({ id: editingPackage.id, data: formData });
    } else {
      createPackageMutation.mutate(formData);
    }
  };

  const handleEdit = (pkg) => {
    setEditingPackage(pkg);
    setFormData({
      package_name: pkg.package_name,
      description: pkg.description,
      price_per_user: pkg.price_per_user,
      tier: pkg.tier,
      max_users: pkg.max_users,
      included_features: pkg.included_features || [],
      features_summary: pkg.features_summary || {
        ai_tools: true,
        advanced_analytics: false,
        custom_training: false,
        api_access: false,
        dedicated_support: false
      }
    });
    setIsCreating(true);
  };

  const toggleFeature = (feature) => {
    setFormData(prev => ({
      ...prev,
      included_features: prev.included_features.includes(feature)
        ? prev.included_features.filter(f => f !== feature)
        : [...prev.included_features, feature]
    }));
  };

  if (currentUser?.role !== 'admin') {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-slate-600">Admin access required</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Feature Packages</h2>
          <p className="text-sm text-slate-600">Create and manage billing packages for agencies</p>
        </div>
        {!isCreating && (
          <Button onClick={() => setIsCreating(true)} className="gap-2">
            <Plus className="w-4 h-4" />
            New Package
          </Button>
        )}
      </div>

      {/* Create/Edit Form */}
      {isCreating && (
        <Card className="border-2 border-blue-200">
          <CardHeader>
            <CardTitle>{editingPackage ? 'Edit' : 'Create'} Feature Package</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Package Name</Label>
                  <Input
                    value={formData.package_name}
                    onChange={(e) => setFormData({ ...formData, package_name: e.target.value })}
                    placeholder="e.g., Professional Plan"
                    required
                  />
                </div>
                <div>
                  <Label>Price per User ($/month)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.price_per_user}
                    onChange={(e) => setFormData({ ...formData, price_per_user: parseFloat(e.target.value) })}
                    required
                  />
                </div>
              </div>

              <div>
                <Label>Description</Label>
                <Textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Describe what's included in this package..."
                  rows={3}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Tier</Label>
                  <select
                    className="w-full border rounded-md p-2"
                    value={formData.tier}
                    onChange={(e) => setFormData({ ...formData, tier: e.target.value })}
                  >
                    <option value="basic">Basic</option>
                    <option value="professional">Professional</option>
                    <option value="enterprise">Enterprise</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>
                <div>
                  <Label>Max Users (optional)</Label>
                  <Input
                    type="number"
                    value={formData.max_users || ''}
                    onChange={(e) => setFormData({ ...formData, max_users: e.target.value ? parseInt(e.target.value) : null })}
                    placeholder="Unlimited"
                  />
                </div>
              </div>

              {/* Feature Summary Toggles */}
              <div>
                <Label className="mb-3 block">Feature Summary</Label>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {Object.entries(formData.features_summary).map(([key, value]) => (
                    <div key={key} className="flex items-center gap-2 p-2 border rounded-lg">
                      <Switch
                        checked={value}
                        onCheckedChange={(checked) =>
                          setFormData({
                            ...formData,
                            features_summary: { ...formData.features_summary, [key]: checked }
                          })
                        }
                      />
                      <Label className="capitalize cursor-pointer">
                        {key.replace(/_/g, ' ')}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>

              {/* Included Features */}
              <div>
                <Label className="mb-3 block">Included Features</Label>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {availableFeatures.map((feature) => (
                    <div
                      key={feature}
                      onClick={() => toggleFeature(feature)}
                      className={`p-3 border rounded-lg cursor-pointer transition-all ${
                        formData.included_features.includes(feature)
                          ? 'bg-blue-50 border-blue-500'
                          : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{feature}</span>
                        {formData.included_features.includes(feature) && (
                          <Check className="w-4 h-4 text-blue-600" />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <Button type="submit" disabled={createPackageMutation.isPending || updatePackageMutation.isPending}>
                  {editingPackage ? 'Update' : 'Create'} Package
                </Button>
                <Button type="button" variant="outline" onClick={resetForm}>
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Package List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {packages.map((pkg) => (
          <Card key={pkg.id} className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <Package className="w-5 h-5 text-blue-600" />
                  <CardTitle className="text-lg">{pkg.package_name}</CardTitle>
                </div>
                <Badge variant={pkg.tier === 'enterprise' ? 'default' : 'outline'} className="capitalize">
                  {pkg.tier}
                </Badge>
              </div>
              <CardDescription className="mt-2">{pkg.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
                <div className="flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-green-600" />
                  <span className="text-sm font-medium">Price per User</span>
                </div>
                <span className="text-lg font-bold text-green-700">${pkg.price_per_user}/mo</span>
              </div>

              {pkg.max_users && (
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <Users className="w-4 h-4" />
                  Max {pkg.max_users} users
                </div>
              )}

              <div>
                <p className="text-xs font-medium text-slate-600 mb-2">Features Summary:</p>
                <div className="flex flex-wrap gap-1">
                  {pkg.features_summary?.ai_tools && <Badge variant="outline">AI Tools</Badge>}
                  {pkg.features_summary?.advanced_analytics && <Badge variant="outline">Analytics</Badge>}
                  {pkg.features_summary?.custom_training && <Badge variant="outline">Training</Badge>}
                  {pkg.features_summary?.api_access && <Badge variant="outline">API</Badge>}
                  {pkg.features_summary?.dedicated_support && <Badge variant="outline">Support</Badge>}
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-slate-600 mb-2">
                  Included Features ({pkg.included_features?.length || 0}):
                </p>
                <div className="flex flex-wrap gap-1">
                  {(pkg.included_features || []).slice(0, 3).map((f) => (
                    <Badge key={f} variant="secondary" className="text-xs">
                      {f}
                    </Badge>
                  ))}
                  {(pkg.included_features?.length || 0) > 3 && (
                    <Badge variant="secondary" className="text-xs">
                      +{pkg.included_features.length - 3} more
                    </Badge>
                  )}
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <Button size="sm" variant="outline" onClick={() => handleEdit(pkg)} className="flex-1">
                  <Edit className="w-3 h-3 mr-1" />
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => {
                    if (confirm('Delete this package?')) {
                      deletePackageMutation.mutate(pkg.id);
                    }
                  }}
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {packages.length === 0 && !isCreating && (
        <Card>
          <CardContent className="py-12 text-center">
            <Package className="w-16 h-16 text-slate-300 mx-auto mb-4" />
            <p className="text-slate-600 mb-4">No feature packages yet</p>
            <Button onClick={() => setIsCreating(true)}>Create First Package</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}