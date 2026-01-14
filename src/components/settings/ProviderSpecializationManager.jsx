import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { AlertCircle, Plus, Trash2, Edit3, Save, X } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

const SPECIALTY_OPTIONS = [
  { code: 'geriatric', name: 'Geriatric Care', description: 'Care for elderly patients' },
  { code: 'pediatric', name: 'Pediatrics', description: 'Care for infants and children' },
  { code: 'cardiology', name: 'Cardiology', description: 'Heart and cardiovascular care' },
  { code: 'oncology', name: 'Oncology', description: 'Cancer treatment and management' },
  { code: 'orthopedic', name: 'Orthopedics', description: 'Bone and joint care' },
  { code: 'neurology', name: 'Neurology', description: 'Nervous system disorders' },
  { code: 'mental_health', name: 'Mental Health', description: 'Psychiatric and behavioral care' },
  { code: 'wound_care', name: 'Wound Care', description: 'Wound management and healing' },
  { code: 'diabetes', name: 'Diabetes Management', description: 'Endocrine and metabolic disorders' },
  { code: 'copd', name: 'Respiratory Care', description: 'Lung and respiratory conditions' },
];

export default function ProviderSpecializationManager({ currentUser }) {
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState(null);
  const queryClient = useQueryClient();

  const { data: specializations = [] } = useQuery({
    queryKey: ['providerSpecializations', currentUser?.email],
    queryFn: () => base44.entities.ProviderSpecialization.filter({
      provider_email: currentUser?.email
    }),
    enabled: !!currentUser?.email,
    initialData: []
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.ProviderSpecialization.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['providerSpecializations'] });
      setIsAdding(false);
      setFormData(null);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.ProviderSpecialization.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['providerSpecializations'] });
      setEditingId(null);
      setFormData(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.ProviderSpecialization.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['providerSpecializations'] });
    },
  });

  const handleAddNew = () => {
    setFormData({
      specialty_name: '',
      specialty_code: '',
      description: '',
      expertise_level: 'intermediate',
      years_of_experience: 0,
      is_primary: specializations.length === 0
    });
    setIsAdding(true);
  };

  const handleEdit = (spec) => {
    setFormData(spec);
    setEditingId(spec.id);
  };

  const handleSubmit = async () => {
    if (!formData.specialty_name || !formData.specialty_code) {
      alert('Please fill in specialty name and code');
      return;
    }

    const data = {
      ...formData,
      provider_email: currentUser.email
    };

    if (editingId) {
      updateMutation.mutate({ id: editingId, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleCancel = () => {
    setIsAdding(false);
    setEditingId(null);
    setFormData(null);
  };

  const selectedSpec = SPECIALTY_OPTIONS.find(s => s.code === formData?.specialty_code);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Professional Specializations</CardTitle>
          <Button
            size="sm"
            onClick={handleAddNew}
            disabled={isAdding || !!editingId}
            className="gap-1"
          >
            <Plus className="w-4 h-4" />
            Add Specialty
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Form */}
        {(isAdding || editingId) && (
          <div className="border rounded-lg p-4 bg-blue-50 space-y-4">
            <div>
              <Label>Select Specialty</Label>
              <Select
                value={formData?.specialty_code}
                onValueChange={(code) => {
                  const spec = SPECIALTY_OPTIONS.find(s => s.code === code);
                  setFormData({
                    ...formData,
                    specialty_code: code,
                    specialty_name: spec.name,
                    description: spec.description
                  });
                }}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select a specialty" />
                </SelectTrigger>
                <SelectContent>
                  {SPECIALTY_OPTIONS.map(spec => (
                    <SelectItem key={spec.code} value={spec.code}>
                      {spec.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Expertise Level</Label>
              <Select
                value={formData?.expertise_level || 'intermediate'}
                onValueChange={(value) => setFormData({ ...formData, expertise_level: value })}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="beginner">Beginner</SelectItem>
                  <SelectItem value="intermediate">Intermediate</SelectItem>
                  <SelectItem value="advanced">Advanced</SelectItem>
                  <SelectItem value="expert">Expert</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Years of Experience</Label>
              <Input
                type="number"
                value={formData?.years_of_experience || 0}
                onChange={(e) => setFormData({ ...formData, years_of_experience: parseInt(e.target.value) })}
                placeholder="Years"
                className="mt-1"
              />
            </div>

            <div>
              <Label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData?.is_primary}
                  onChange={(e) => setFormData({ ...formData, is_primary: e.target.checked })}
                  className="rounded"
                />
                <span>Set as primary specialty</span>
              </Label>
            </div>

            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={handleSubmit}
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                <Save className="w-4 h-4 mr-1" />
                Save
              </Button>
              <Button size="sm" variant="outline" onClick={handleCancel}>
                <X className="w-4 h-4 mr-1" />
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Specializations List */}
        <div className="space-y-3">
          {specializations.length > 0 ? (
            specializations.map((spec) => (
              <div
                key={spec.id}
                className="border rounded-lg p-3 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-semibold text-gray-900 truncate">
                        {spec.specialty_name}
                      </h4>
                      {spec.is_primary && <Badge className="bg-blue-600">Primary</Badge>}
                    </div>
                    <p className="text-sm text-gray-600 mb-2">{spec.description}</p>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline" className="text-xs">
                        {spec.expertise_level}
                      </Badge>
                      {spec.years_of_experience > 0 && (
                        <Badge variant="outline" className="text-xs">
                          {spec.years_of_experience} yrs
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 ml-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleEdit(spec)}
                    >
                      <Edit3 className="w-4 h-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => deleteMutation.mutate(spec.id)}
                    >
                      <Trash2 className="w-4 h-4 text-red-600" />
                    </Button>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-6 text-gray-500">
              <AlertCircle className="w-8 h-8 mx-auto mb-2 text-gray-400" />
              <p>No specializations added yet</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}