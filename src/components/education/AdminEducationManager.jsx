import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Trash2, Edit2, Plus, Upload } from "lucide-react";
import { toast } from "sonner";

export default function AdminEducationManager() {
  const [step, setStep] = useState("list"); // list, create, edit
  const [selectedMaterial, setSelectedMaterial] = useState(null);
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    material_type: "article",
    diagnoses: [],
    content_url: "",
    file_url: "",
    duration_minutes: "",
    difficulty_level: "beginner",
    tags: [],
    is_approved: true,
    is_active: true
  });
  const [newDiagnosis, setNewDiagnosis] = useState("");
  const [newTag, setNewTag] = useState("");
  const queryClient = useQueryClient();

  const { data: materials = [], isLoading } = useQuery({
    queryKey: ['adminEducationMaterials'],
    queryFn: () => base44.entities.PatientEducationMaterial.list('-created_date', 200)
  });

  const saveMutation = useMutation({
    mutationFn: (data) => {
      if (selectedMaterial?.id) {
        return base44.entities.PatientEducationMaterial.update(selectedMaterial.id, data);
      } else {
        return base44.entities.PatientEducationMaterial.create(data);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminEducationMaterials'] });
      toast.success(selectedMaterial ? "Material updated" : "Material created");
      resetForm();
      setStep("list");
    },
    onError: (error) => {
      toast.error("Failed to save material: " + error.message);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.PatientEducationMaterial.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adminEducationMaterials'] });
      toast.success("Material deleted");
    }
  });

  const resetForm = () => {
    setFormData({
      title: "",
      description: "",
      material_type: "article",
      diagnoses: [],
      content_url: "",
      file_url: "",
      duration_minutes: "",
      difficulty_level: "beginner",
      tags: [],
      is_approved: true,
      is_active: true
    });
    setSelectedMaterial(null);
    setNewDiagnosis("");
    setNewTag("");
  };

  const handleEdit = (material) => {
    setSelectedMaterial(material);
    setFormData(material);
    setStep("create");
  };

  const handleSave = () => {
    if (!formData.title || !formData.diagnoses.length) {
      toast.error("Title and at least one diagnosis are required");
      return;
    }

    const payload = {
      ...formData,
      duration_minutes: formData.duration_minutes ? parseInt(formData.duration_minutes) : null,
      created_by_admin: (base44.auth.me?.email) || 'admin'
    };

    saveMutation.mutate(payload);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-slate-900">📚 Education Materials</h2>
          <p className="text-slate-600 mt-1">Manage patient educational resources</p>
        </div>
        <Button
          onClick={() => {
            resetForm();
            setStep("create");
          }}
          className="bg-slate-300 hover:bg-slate-400"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Material
        </Button>
      </div>

      {step === "list" ? (
        <>
          {isLoading ? (
            <p className="text-slate-600">Loading materials...</p>
          ) : materials.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <p className="text-slate-600 mb-4">No materials yet. Create your first one.</p>
                <Button
                  onClick={() => {
                    resetForm();
                    setStep("create");
                  }}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Create Material
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {materials.map((material) => (
                <Card key={material.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <h3 className="font-semibold text-slate-900">{material.title}</h3>
                        <p className="text-sm text-slate-600 mt-1">{material.description}</p>
                        <div className="flex flex-wrap gap-1 mt-3">
                          <Badge className="bg-blue-100 text-blue-800">
                            {material.material_type}
                          </Badge>
                          {material.diagnoses?.map((d) => (
                            <Badge key={d} variant="outline" className="text-xs">
                              {d}
                            </Badge>
                          ))}
                          {!material.is_approved && (
                            <Badge className="bg-red-100 text-red-800">Pending</Badge>
                          )}
                          {!material.is_active && (
                            <Badge variant="outline" className="bg-gray-100">Inactive</Badge>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleEdit(material)}
                        >
                          <Edit2 className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-red-600 hover:text-red-700"
                          onClick={() => {
                            if (window.confirm("Delete this material?")) {
                              deleteMutation.mutate(material.id);
                            }
                          }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{selectedMaterial ? "Edit Material" : "Create New Material"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Title */}
            <div>
              <Label className="text-sm font-medium">Title *</Label>
              <Input
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="e.g., Managing Type 2 Diabetes"
              />
            </div>

            {/* Description */}
            <div>
              <Label className="text-sm font-medium">Description</Label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Brief description of the material"
                rows={3}
              />
            </div>

            {/* Material Type */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium">Type *</Label>
                <Select value={formData.material_type} onValueChange={(val) => setFormData({ ...formData, material_type: val })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="article">Article</SelectItem>
                    <SelectItem value="video">Video</SelectItem>
                    <SelectItem value="pdf">PDF</SelectItem>
                    <SelectItem value="infographic">Infographic</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-sm font-medium">Difficulty Level</Label>
                <Select value={formData.difficulty_level} onValueChange={(val) => setFormData({ ...formData, difficulty_level: val })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="beginner">Beginner</SelectItem>
                    <SelectItem value="intermediate">Intermediate</SelectItem>
                    <SelectItem value="advanced">Advanced</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Content URL */}
            <div>
              <Label className="text-sm font-medium">Content URL or Link *</Label>
              <Input
                value={formData.content_url}
                onChange={(e) => setFormData({ ...formData, content_url: e.target.value })}
                placeholder="https://example.com/material"
              />
            </div>

            {/* Duration */}
            {formData.material_type === "video" && (
              <div>
                <Label className="text-sm font-medium">Duration (minutes)</Label>
                <Input
                  type="number"
                  value={formData.duration_minutes}
                  onChange={(e) => setFormData({ ...formData, duration_minutes: e.target.value })}
                  placeholder="e.g., 15"
                />
              </div>
            )}

            {/* Diagnoses */}
            <div>
              <Label className="text-sm font-medium">Related Diagnoses *</Label>
              <div className="flex gap-2 mb-2">
                <Input
                  value={newDiagnosis}
                  onChange={(e) => setNewDiagnosis(e.target.value)}
                  placeholder="e.g., Diabetes"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newDiagnosis.trim()) {
                      setFormData({
                        ...formData,
                        diagnoses: [...formData.diagnoses, newDiagnosis.trim()]
                      });
                      setNewDiagnosis("");
                    }
                  }}
                />
                <Button
                  onClick={() => {
                    if (newDiagnosis.trim()) {
                      setFormData({
                        ...formData,
                        diagnoses: [...formData.diagnoses, newDiagnosis.trim()]
                      });
                      setNewDiagnosis("");
                    }
                  }}
                  size="sm"
                >
                  Add
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {formData.diagnoses.map((d) => (
                  <Badge
                    key={d}
                    className="bg-blue-100 text-blue-800 cursor-pointer"
                    onClick={() => setFormData({
                      ...formData,
                      diagnoses: formData.diagnoses.filter(x => x !== d)
                    })}
                  >
                    {d} ✕
                  </Badge>
                ))}
              </div>
            </div>

            {/* Status */}
            <div className="grid grid-cols-2 gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.is_approved}
                  onChange={(e) => setFormData({ ...formData, is_approved: e.target.checked })}
                />
                <span className="text-sm">Approved for patients</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.is_active}
                  onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                />
                <span className="text-sm">Active</span>
              </label>
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-4 border-t">
              <Button
                onClick={handleSave}
                className="bg-blue-600 hover:bg-blue-700"
                disabled={saveMutation.isPending}
              >
                {saveMutation.isPending ? "Saving..." : selectedMaterial ? "Update Material" : "Create Material"}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  resetForm();
                  setStep("list");
                }}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}