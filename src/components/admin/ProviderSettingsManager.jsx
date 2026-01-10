import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  Settings, 
  Plus, 
  Save, 
  Trash2, 
  FileText, 
  CheckSquare, 
  BookOpen,
  AlertCircle 
} from "lucide-react";
import { toast } from "sonner";

export default function ProviderSettingsManager() {
  const [selectedProvider, setSelectedProvider] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const queryClient = useQueryClient();

  const { data: providerSettings = [], isLoading } = useQuery({
    queryKey: ['providerSettings'],
    queryFn: () => base44.entities.ProviderSettings.list()
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.ProviderSettings.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['providerSettings']);
      toast.success('Provider settings created');
      setEditMode(false);
      setSelectedProvider(null);
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.ProviderSettings.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['providerSettings']);
      toast.success('Provider settings updated');
      setEditMode(false);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.ProviderSettings.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['providerSettings']);
      toast.success('Provider settings deleted');
      setSelectedProvider(null);
    }
  });

  const handleSave = (data) => {
    if (selectedProvider?.id) {
      updateMutation.mutate({ id: selectedProvider.id, data });
    } else {
      createMutation.mutate(data);
    }
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

  if (isLoading) {
    return <div className="p-6">Loading provider settings...</div>;
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Settings className="w-8 h-8" />
            Provider Settings Manager
          </h1>
          <p className="text-gray-600 mt-1">
            Configure AI prompts, compliance rules, and documentation checklists for each provider type
          </p>
        </div>
        <Button 
          onClick={() => {
            setSelectedProvider(null);
            setEditMode(true);
          }}
          className="gap-2"
        >
          <Plus className="w-4 h-4" />
          Add Provider Type
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Provider List */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-lg">Provider Types</CardTitle>
            <CardDescription>{providerSettings.length} configured</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {providerSettings.map((setting) => (
              <Button
                key={setting.id}
                variant={selectedProvider?.id === setting.id ? "default" : "outline"}
                className="w-full justify-between"
                onClick={() => {
                  setSelectedProvider(setting);
                  setEditMode(false);
                }}
              >
                <span>{setting.display_name}</span>
                <Badge variant={setting.is_active ? "default" : "secondary"}>
                  {setting.provider_type}
                </Badge>
              </Button>
            ))}
          </CardContent>
        </Card>

        {/* Editor */}
        <Card className="lg:col-span-2">
          {!selectedProvider && !editMode ? (
            <CardContent className="flex flex-col items-center justify-center h-96 text-gray-500">
              <Settings className="w-16 h-16 mb-4 text-gray-300" />
              <p>Select a provider type or create a new one</p>
            </CardContent>
          ) : (
            <ProviderSettingsEditor
              provider={selectedProvider}
              editMode={editMode}
              providerTypes={providerTypes}
              onSave={handleSave}
              onCancel={() => {
                setEditMode(false);
                setSelectedProvider(null);
              }}
              onDelete={() => {
                if (window.confirm('Delete this provider configuration?')) {
                  deleteMutation.mutate(selectedProvider.id);
                }
              }}
              onEdit={() => setEditMode(true)}
            />
          )}
        </Card>
      </div>
    </div>
  );
}

function ProviderSettingsEditor({ provider, editMode, providerTypes, onSave, onCancel, onDelete, onEdit }) {
  const [formData, setFormData] = useState(provider || {
    provider_type: "",
    display_name: "",
    ai_note_prompt: "",
    compliance_prompt: "",
    regulatory_references: [],
    documentation_checklist: [],
    visit_types: [],
    common_diagnoses: [],
    terminology_preferences: {},
    is_active: true
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(formData);
  };

  const addChecklistItem = () => {
    setFormData({
      ...formData,
      documentation_checklist: [
        ...(formData.documentation_checklist || []),
        { element: "", required: true, priority: "medium", description: "" }
      ]
    });
  };

  const updateChecklistItem = (index, field, value) => {
    const updated = [...(formData.documentation_checklist || [])];
    updated[index][field] = value;
    setFormData({ ...formData, documentation_checklist: updated });
  };

  const removeChecklistItem = (index) => {
    const updated = [...(formData.documentation_checklist || [])];
    updated.splice(index, 1);
    setFormData({ ...formData, documentation_checklist: updated });
  };

  return (
    <form onSubmit={handleSubmit}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>
              {editMode ? (provider ? 'Edit Provider Settings' : 'New Provider Settings') : formData.display_name}
            </CardTitle>
            <CardDescription>
              {editMode ? 'Configure AI and compliance settings' : 'View provider configuration'}
            </CardDescription>
          </div>
          <div className="flex gap-2">
            {!editMode && (
              <>
                <Button type="button" variant="outline" onClick={onEdit}>
                  Edit
                </Button>
                <Button type="button" variant="destructive" onClick={onDelete}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <Tabs defaultValue="basic" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="basic">Basic</TabsTrigger>
            <TabsTrigger value="prompts">AI Prompts</TabsTrigger>
            <TabsTrigger value="checklist">Checklist</TabsTrigger>
            <TabsTrigger value="references">References</TabsTrigger>
          </TabsList>

          <TabsContent value="basic" className="space-y-4">
            <div>
              <Label>Provider Type</Label>
              <select
                className="w-full p-2 border rounded"
                value={formData.provider_type}
                onChange={(e) => setFormData({ ...formData, provider_type: e.target.value })}
                disabled={!editMode}
                required
              >
                <option value="">Select type...</option>
                {providerTypes.map(pt => (
                  <option key={pt.value} value={pt.value}>{pt.label}</option>
                ))}
              </select>
            </div>

            <div>
              <Label>Display Name</Label>
              <Input
                value={formData.display_name}
                onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
                disabled={!editMode}
                required
              />
            </div>

            <div>
              <Label>Visit Types (comma-separated)</Label>
              <Input
                value={formData.visit_types?.join(', ') || ''}
                onChange={(e) => setFormData({ 
                  ...formData, 
                  visit_types: e.target.value.split(',').map(v => v.trim()).filter(Boolean)
                })}
                disabled={!editMode}
                placeholder="e.g., Initial Eval, Routine Visit, Discharge"
              />
            </div>

            <div>
              <Label>Common Diagnoses (comma-separated)</Label>
              <Textarea
                value={formData.common_diagnoses?.join(', ') || ''}
                onChange={(e) => setFormData({ 
                  ...formData, 
                  common_diagnoses: e.target.value.split(',').map(v => v.trim()).filter(Boolean)
                })}
                disabled={!editMode}
                rows={3}
              />
            </div>
          </TabsContent>

          <TabsContent value="prompts" className="space-y-4">
            <Alert>
              <AlertCircle className="w-4 h-4" />
              <AlertDescription>
                These prompts customize how the AI generates notes and checks compliance for this provider type
              </AlertDescription>
            </Alert>

            <div>
              <Label className="flex items-center gap-2">
                <FileText className="w-4 h-4" />
                AI Note Generation Prompt
              </Label>
              <Textarea
                value={formData.ai_note_prompt}
                onChange={(e) => setFormData({ ...formData, ai_note_prompt: e.target.value })}
                disabled={!editMode}
                rows={8}
                placeholder="Custom instructions for note generation for this provider type..."
              />
            </div>

            <div>
              <Label className="flex items-center gap-2">
                <CheckSquare className="w-4 h-4" />
                Compliance Check Prompt
              </Label>
              <Textarea
                value={formData.compliance_prompt}
                onChange={(e) => setFormData({ ...formData, compliance_prompt: e.target.value })}
                disabled={!editMode}
                rows={8}
                placeholder="Custom compliance checking instructions for this provider type..."
              />
            </div>
          </TabsContent>

          <TabsContent value="checklist" className="space-y-4">
            <div className="flex items-center justify-between">
              <Label>Documentation Checklist</Label>
              {editMode && (
                <Button type="button" size="sm" onClick={addChecklistItem}>
                  <Plus className="w-4 h-4 mr-1" />
                  Add Item
                </Button>
              )}
            </div>

            <div className="space-y-3">
              {formData.documentation_checklist?.map((item, idx) => (
                <div key={idx} className="p-3 border rounded space-y-2">
                  <div className="flex gap-2">
                    <Input
                      placeholder="Element name"
                      value={item.element}
                      onChange={(e) => updateChecklistItem(idx, 'element', e.target.value)}
                      disabled={!editMode}
                      className="flex-1"
                    />
                    <select
                      value={item.priority}
                      onChange={(e) => updateChecklistItem(idx, 'priority', e.target.value)}
                      disabled={!editMode}
                      className="p-2 border rounded"
                    >
                      <option value="critical">Critical</option>
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                    </select>
                    {editMode && (
                      <Button
                        type="button"
                        variant="destructive"
                        size="icon"
                        onClick={() => removeChecklistItem(idx)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                  <Input
                    placeholder="Description"
                    value={item.description}
                    onChange={(e) => updateChecklistItem(idx, 'description', e.target.value)}
                    disabled={!editMode}
                  />
                </div>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="references" className="space-y-4">
            <Label className="flex items-center gap-2">
              <BookOpen className="w-4 h-4" />
              Regulatory References
            </Label>
            <Textarea
              value={JSON.stringify(formData.regulatory_references, null, 2)}
              onChange={(e) => {
                try {
                  setFormData({ ...formData, regulatory_references: JSON.parse(e.target.value) });
                } catch (err) {}
              }}
              disabled={!editMode}
              rows={10}
              placeholder='[{"title": "Reference Title", "description": "...", "url": "...", "category": "..."}]'
              className="font-mono text-xs"
            />
          </TabsContent>
        </Tabs>

        {editMode && (
          <div className="flex gap-2 pt-4">
            <Button type="submit" className="flex-1">
              <Save className="w-4 h-4 mr-2" />
              Save Settings
            </Button>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        )}
      </CardContent>
    </form>
  );
}