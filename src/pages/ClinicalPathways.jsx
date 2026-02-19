import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { 
  Route, 
  Plus, 
  Edit2,
  Trash2,
  TrendingUp,
  Clock,
  Target,
  Loader2
} from 'lucide-react';
import { toast } from 'sonner';

export default function ClinicalPathways() {
  const [showForm, setShowForm] = useState(false);
  const [editingPathway, setEditingPathway] = useState(null);
  const [formData, setFormData] = useState({
    pathway_name: '',
    condition: '',
    description: '',
    typical_los: 60,
    evidence_level: 'B'
  });

  const queryClient = useQueryClient();

  const { data: pathways, isLoading } = useQuery({
    queryKey: ['clinical-pathways'],
    queryFn: () => base44.entities.ClinicalPathway.filter({})
  });

  const createPathwayMutation = useMutation({
    mutationFn: async (pathwayData) => {
      if (editingPathway) {
        return await base44.entities.ClinicalPathway.update(editingPathway.id, pathwayData);
      }
      return await base44.entities.ClinicalPathway.create(pathwayData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['clinical-pathways']);
      setShowForm(false);
      setEditingPathway(null);
      resetForm();
      toast.success(editingPathway ? 'Pathway updated' : 'Pathway created');
    },
    onError: (error) => {
      toast.error('Failed to save pathway: ' + error.message);
    }
  });

  const deletePathwayMutation = useMutation({
    mutationFn: async (pathwayId) => {
      return await base44.entities.ClinicalPathway.delete(pathwayId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['clinical-pathways']);
      toast.success('Pathway deleted');
    }
  });

  const resetForm = () => {
    setFormData({
      pathway_name: '',
      condition: '',
      description: '',
      typical_los: 60,
      evidence_level: 'B'
    });
  };

  const handleEdit = (pathway) => {
    setEditingPathway(pathway);
    setFormData(pathway);
    setShowForm(true);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    createPathwayMutation.mutate({
      ...formData,
      is_active: true,
      usage_count: 0,
      phases: [] // Would be configured in detail view
    });
  };

  const activePathways = pathways?.filter(p => p.is_active) || [];

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Clinical Pathways</h1>
            <p className="text-sm text-slate-600 mt-1">Evidence-based care pathways</p>
          </div>
          <Button
            onClick={() => {
              resetForm();
              setEditingPathway(null);
              setShowForm(!showForm);
            }}
            className="bg-blue-600 hover:bg-blue-700"
          >
            <Plus className="h-4 w-4 mr-2" />
            New Pathway
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-blue-100 rounded-lg">
                  <Route className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{pathways?.length || 0}</p>
                  <p className="text-xs text-slate-600">Total Pathways</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-green-100 rounded-lg">
                  <Target className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{activePathways.length}</p>
                  <p className="text-xs text-slate-600">Active Pathways</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-purple-100 rounded-lg">
                  <TrendingUp className="h-5 w-5 text-purple-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">
                    {pathways?.reduce((sum, p) => sum + (p.usage_count || 0), 0) || 0}
                  </p>
                  <p className="text-xs text-slate-600">Total Uses</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Form */}
        {showForm && (
          <Card className="border-2 border-blue-300">
            <CardHeader>
              <CardTitle>{editingPathway ? 'Edit Pathway' : 'Create New Pathway'}</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium mb-2 block">Pathway Name</label>
                    <Input
                      value={formData.pathway_name}
                      onChange={(e) => setFormData({ ...formData, pathway_name: e.target.value })}
                      placeholder="e.g., CHF Management"
                      required
                    />
                  </div>

                  <div>
                    <label className="text-sm font-medium mb-2 block">Condition</label>
                    <Input
                      value={formData.condition}
                      onChange={(e) => setFormData({ ...formData, condition: e.target.value })}
                      placeholder="e.g., Congestive Heart Failure"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium mb-2 block">Description</label>
                  <Textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Describe the clinical pathway..."
                    rows={3}
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium mb-2 block">Typical Length of Service (days)</label>
                    <Input
                      type="number"
                      value={formData.typical_los}
                      onChange={(e) => setFormData({ ...formData, typical_los: parseInt(e.target.value) })}
                      required
                    />
                  </div>

                  <div>
                    <label className="text-sm font-medium mb-2 block">Evidence Level</label>
                    <select
                      value={formData.evidence_level}
                      onChange={(e) => setFormData({ ...formData, evidence_level: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-md"
                    >
                      <option value="A">Level A (Strong Evidence)</option>
                      <option value="B">Level B (Moderate Evidence)</option>
                      <option value="C">Level C (Limited Evidence)</option>
                      <option value="Expert Opinion">Expert Opinion</option>
                    </select>
                  </div>
                </div>

                <div className="flex gap-2 pt-4">
                  <Button type="submit" disabled={createPathwayMutation.isPending} className="flex-1">
                    {createPathwayMutation.isPending ? 'Saving...' : editingPathway ? 'Update' : 'Create'}
                  </Button>
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={() => {
                      setShowForm(false);
                      setEditingPathway(null);
                      resetForm();
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {/* Pathways List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          </div>
        ) : pathways?.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Route className="h-12 w-12 text-slate-400 mx-auto mb-4" />
              <p className="text-slate-600 mb-4">No clinical pathways configured</p>
              <Button onClick={() => setShowForm(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Create First Pathway
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {pathways.map(pathway => (
              <Card key={pathway.id} className={pathway.is_active ? 'border-l-4 border-l-green-600' : 'opacity-60'}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="text-lg">{pathway.pathway_name}</CardTitle>
                      <p className="text-sm text-slate-600 mt-1">{pathway.condition}</p>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleEdit(pathway)}
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          if (confirm('Delete this pathway?')) {
                            deletePathwayMutation.mutate(pathway.id);
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-red-600" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-slate-700 mb-4">{pathway.description}</p>
                  
                  <div className="flex items-center gap-4 text-xs text-slate-600">
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {pathway.typical_los} days
                    </div>
                    <Badge variant="outline">Level {pathway.evidence_level}</Badge>
                    <div className="flex items-center gap-1">
                      <TrendingUp className="h-3 w-3" />
                      Used {pathway.usage_count || 0} times
                    </div>
                  </div>

                  {pathway.success_rate && (
                    <div className="mt-3 p-2 bg-green-50 border border-green-200 rounded">
                      <p className="text-xs text-green-800">
                        Success Rate: {pathway.success_rate}%
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}