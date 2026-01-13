import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { AlertCircle, Plus, Edit2, Trash2, Check } from 'lucide-react';
import { toast } from 'sonner';
import { VISIT_TYPES_BY_SETTING, PROVIDER_VISIT_TYPES } from '@/components/utils/providerVisitTypeMapping';

/**
 * CareSettingManager Component
 * Allows admins to create and manage care settings
 */
export default function CareSettingManager() {
  const [openDialog, setOpenDialog] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    category: '',
    description: '',
    visit_types_available: [],
    provider_types_allowed: [],
    requires_oasis: false,
    requires_prior_auth: false,
    visit_duration_minutes: 60,
    billing_unit: 'per_visit',
    is_active: true,
  });

  const queryClient = useQueryClient();

  // Fetch care settings
  const { data: careSettings = [], isLoading } = useQuery({
    queryKey: ['careSettings'],
    queryFn: () => base44.entities.CareSetting.list(),
  });

  // Create care setting
  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.CareSetting.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['careSettings'] });
      resetForm();
      setOpenDialog(false);
      toast.success('Care setting created successfully');
    },
    onError: (error) => {
      toast.error('Failed to create care setting: ' + error.message);
    },
  });

  // Update care setting
  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.CareSetting.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['careSettings'] });
      resetForm();
      setOpenDialog(false);
      toast.success('Care setting updated successfully');
    },
    onError: (error) => {
      toast.error('Failed to update care setting: ' + error.message);
    },
  });

  // Delete care setting
  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.CareSetting.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['careSettings'] });
      toast.success('Care setting deleted successfully');
    },
    onError: (error) => {
      toast.error('Failed to delete care setting: ' + error.message);
    },
  });

  const resetForm = () => {
    setFormData({
      name: '',
      code: '',
      category: '',
      description: '',
      visit_types_available: [],
      provider_types_allowed: [],
      requires_oasis: false,
      requires_prior_auth: false,
      visit_duration_minutes: 60,
      billing_unit: 'per_visit',
      is_active: true,
    });
    setEditingId(null);
  };

  const handleEdit = (setting) => {
    setFormData(setting);
    setEditingId(setting.id);
    setOpenDialog(true);
  };

  const handleSubmit = () => {
    if (!formData.name || !formData.code || !formData.category) {
      toast.error('Please fill in all required fields');
      return;
    }

    if (editingId) {
      updateMutation.mutate({ id: editingId, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleVisitTypeToggle = (visitTypeId) => {
    setFormData((prev) => ({
      ...prev,
      visit_types_available: prev.visit_types_available.includes(visitTypeId)
        ? prev.visit_types_available.filter((id) => id !== visitTypeId)
        : [...prev.visit_types_available, visitTypeId],
    }));
  };

  const handleProviderTypeToggle = (providerType) => {
    setFormData((prev) => ({
      ...prev,
      provider_types_allowed: prev.provider_types_allowed.includes(providerType)
        ? prev.provider_types_allowed.filter((p) => p !== providerType)
        : [...prev.provider_types_allowed, providerType],
    }));
  };

  const getAvailableVisitTypes = () => {
    if (!formData.category) return [];
    return VISIT_TYPES_BY_SETTING[formData.category] || [];
  };

  const getAvailableProviders = () => {
    return Object.keys(PROVIDER_VISIT_TYPES);
  };

  if (isLoading) {
    return <div className="p-4 text-center text-slate-500">Loading care settings...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Care Settings</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Manage care settings and their associated visit types
          </p>
        </div>
        <Dialog open={openDialog} onOpenChange={setOpenDialog}>
          <DialogTrigger asChild>
            <Button
              onClick={() => {
                resetForm();
                setOpenDialog(true);
              }}
              className="bg-blue-600 hover:bg-blue-700"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Care Setting
            </Button>
          </DialogTrigger>

          {/* Dialog Content */}
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingId ? 'Edit Care Setting' : 'Create New Care Setting'}
              </DialogTitle>
              <DialogDescription>
                Define the care setting and configure its visit types and provider access
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-6 py-4">
              {/* Basic Information */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Basic Information
                </h3>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Name *</Label>
                    <Input
                      placeholder="e.g., Home Health Agency"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Code *</Label>
                    <Input
                      placeholder="e.g., home_health"
                      value={formData.code}
                      onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Category *</Label>
                  <Select value={formData.category} onValueChange={(val) => {
                    setFormData({ ...formData, category: val, visit_types_available: [] });
                  }}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select category..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="home_health">Home Health</SelectItem>
                      <SelectItem value="telehealth">Telehealth</SelectItem>
                      <SelectItem value="clinic_outpatient">Clinic/Outpatient</SelectItem>
                      <SelectItem value="hospital_inpatient">Hospital/Inpatient</SelectItem>
                      <SelectItem value="skilled_nursing">Skilled Nursing Facility</SelectItem>
                      <SelectItem value="hospice">Hospice</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Description</Label>
                  <Input
                    placeholder="Describe this care setting..."
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  />
                </div>
              </div>

              {/* Visit Types */}
              {formData.category && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                    Available Visit Types
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {getAvailableVisitTypes().map((vt) => (
                      <Badge
                        key={vt.id}
                        variant={
                          formData.visit_types_available.includes(vt.id) ? 'default' : 'outline'
                        }
                        className="cursor-pointer"
                        onClick={() => handleVisitTypeToggle(vt.id)}
                      >
                        {vt.label}
                        {formData.visit_types_available.includes(vt.id) && (
                          <Check className="w-3 h-3 ml-1" />
                        )}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Provider Types */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Allowed Provider Types
                </h3>
                <div className="flex flex-wrap gap-2">
                  {getAvailableProviders().map((provider) => (
                    <Badge
                      key={provider}
                      variant={
                        formData.provider_types_allowed.includes(provider) ? 'default' : 'outline'
                      }
                      className="cursor-pointer"
                      onClick={() => handleProviderTypeToggle(provider)}
                    >
                      {provider}
                      {formData.provider_types_allowed.includes(provider) && (
                        <Check className="w-3 h-3 ml-1" />
                      )}
                    </Badge>
                  ))}
                </div>
              </div>

              {/* Billing & Requirements */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Billing & Requirements
                </h3>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Visit Duration (minutes)</Label>
                    <Input
                      type="number"
                      value={formData.visit_duration_minutes}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          visit_duration_minutes: parseInt(e.target.value),
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Billing Unit</Label>
                    <Select value={formData.billing_unit} onValueChange={(val) => {
                      setFormData({ ...formData, billing_unit: val });
                    }}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="per_visit">Per Visit</SelectItem>
                        <SelectItem value="per_15_minutes">Per 15 Minutes</SelectItem>
                        <SelectItem value="per_hour">Per Hour</SelectItem>
                        <SelectItem value="per_episode">Per Episode</SelectItem>
                        <SelectItem value="per_month">Per Month</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.requires_oasis}
                      onChange={(e) =>
                        setFormData({ ...formData, requires_oasis: e.target.checked })
                      }
                      className="w-4 h-4"
                    />
                    <span className="text-sm text-slate-700 dark:text-slate-300">
                      Requires OASIS Documentation
                    </span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.requires_prior_auth}
                      onChange={(e) =>
                        setFormData({ ...formData, requires_prior_auth: e.target.checked })
                      }
                      className="w-4 h-4"
                    />
                    <span className="text-sm text-slate-700 dark:text-slate-300">
                      Requires Prior Authorization
                    </span>
                  </label>
                </div>
              </div>

              {/* Status */}
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.is_active}
                    onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <span className="text-sm text-slate-700 dark:text-slate-300">Active</span>
                </label>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-700">
                <Button
                  variant="outline"
                  onClick={() => {
                    setOpenDialog(false);
                    resetForm();
                  }}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={createMutation.isPending || updateMutation.isPending}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {editingId ? 'Update' : 'Create'} Care Setting
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Care Settings List */}
      <div className="grid gap-4">
        {careSettings.length === 0 ? (
          <Card>
            <CardContent className="pt-6 text-center text-slate-500">
              <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>No care settings created yet. Create one to get started.</p>
            </CardContent>
          </Card>
        ) : (
          careSettings.map((setting) => (
            <Card key={setting.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="text-lg">{setting.name}</CardTitle>
                    <CardDescription>{setting.description}</CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    {!setting.is_active && (
                      <Badge variant="secondary" className="bg-slate-200">
                        Inactive
                      </Badge>
                    )}
                    {setting.requires_oasis && (
                      <Badge variant="outline">OASIS Required</Badge>
                    )}
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <p className="text-slate-600 dark:text-slate-400">Code</p>
                    <p className="font-mono font-medium text-slate-900 dark:text-slate-100">
                      {setting.code}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-600 dark:text-slate-400">Category</p>
                    <p className="font-medium text-slate-900 dark:text-slate-100">
                      {setting.category}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-600 dark:text-slate-400">Billing Unit</p>
                    <p className="font-medium text-slate-900 dark:text-slate-100">
                      {setting.billing_unit?.replace(/_/g, ' ')}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-600 dark:text-slate-400">Visit Duration</p>
                    <p className="font-medium text-slate-900 dark:text-slate-100">
                      {setting.visit_duration_minutes} min
                    </p>
                  </div>
                </div>

                {/* Visit Types */}
                {setting.visit_types_available && setting.visit_types_available.length > 0 && (
                  <div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mb-2">
                      Available Visit Types
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {setting.visit_types_available.map((vt) => (
                        <Badge key={vt} variant="secondary" className="text-xs">
                          {vt}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Provider Types */}
                {setting.provider_types_allowed && setting.provider_types_allowed.length > 0 && (
                  <div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mb-2">
                      Allowed Providers
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {setting.provider_types_allowed.map((p) => (
                        <Badge key={p} variant="outline" className="text-xs">
                          {p}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2 pt-3 border-t border-slate-200 dark:border-slate-700">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleEdit(setting)}
                  >
                    <Edit2 className="w-3 h-3 mr-1" />
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/20"
                    onClick={() => {
                      if (
                        confirm(
                          'Are you sure you want to delete this care setting? This action cannot be undone.'
                        )
                      ) {
                        deleteMutation.mutate(setting.id);
                      }
                    }}
                  >
                    <Trash2 className="w-3 h-3 mr-1" />
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}