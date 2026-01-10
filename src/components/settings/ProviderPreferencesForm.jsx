import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader, CheckCircle2, X, Plus } from "lucide-react";
import { toast } from "sonner";

const VISIT_TYPES = [
  "admission",
  "routine_visit",
  "recertification",
  "discharge",
  "prn"
];

const COMMON_ELEMENTS = [
  { key: "vital_signs", label: "Vital Signs" },
  { key: "patient_response", label: "Patient Response" },
  { key: "assessment", label: "Assessment" },
  { key: "interventions", label: "Interventions" },
  { key: "education", label: "Patient Education" }
];

const WRITING_STYLES = ["clinical", "detailed", "concise", "narrative"];
const TONES = ["professional", "warm", "objective", "empathetic"];
const DETAIL_LEVELS = ["minimal", "moderate", "comprehensive"];

export default function ProviderPreferencesForm({ preferences = null, onSaved = null }) {
  const [formData, setFormData] = useState(preferences || {
    provider_email: "",
    provider_type: "RN",
    preferred_phrasing: {},
    priority_checklists: { default_priorities: [], visit_types: [] },
    custom_templates: [],
    default_values: {},
    ai_personalization: {
      writing_style: "clinical",
      tone: "professional",
      detail_level: "moderate",
      focus_areas: []
    },
    notifications_preferences: {}
  });

  const [customPhrase, setCustomPhrase] = useState({ element: "", preferred_text: "" });
  const [customDiagnosis, setCustomDiagnosis] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const handlePhrasingChange = (key, value) => {
    setFormData(prev => ({
      ...prev,
      preferred_phrasing: {
        ...prev.preferred_phrasing,
        [key]: value
      }
    }));
  };

  const addCustomPhrase = () => {
    if (!customPhrase.element || !customPhrase.preferred_text) return;
    
    const custom = formData.preferred_phrasing.custom_phrases || [];
    setFormData(prev => ({
      ...prev,
      preferred_phrasing: {
        ...prev.preferred_phrasing,
        custom_phrases: [...custom, customPhrase]
      }
    }));
    setCustomPhrase({ element: "", preferred_text: "" });
  };

  const removeCustomPhrase = (index) => {
    const custom = formData.preferred_phrasing.custom_phrases || [];
    setFormData(prev => ({
      ...prev,
      preferred_phrasing: {
        ...prev.preferred_phrasing,
        custom_phrases: custom.filter((_, i) => i !== index)
      }
    }));
  };

  const toggleDefaultPriority = (element) => {
    const current = formData.priority_checklists.default_priorities || [];
    setFormData(prev => ({
      ...prev,
      priority_checklists: {
        ...prev.priority_checklists,
        default_priorities: current.includes(element)
          ? current.filter(p => p !== element)
          : [...current, element]
      }
    }));
  };

  const addCommonDiagnosis = () => {
    if (!customDiagnosis.trim()) return;
    const current = formData.default_values.common_diagnoses || [];
    if (!current.includes(customDiagnosis)) {
      setFormData(prev => ({
        ...prev,
        default_values: {
          ...prev.default_values,
          common_diagnoses: [...current, customDiagnosis]
        }
      }));
      setCustomDiagnosis("");
    }
  };

  const removeCommonDiagnosis = (diagnosis) => {
    setFormData(prev => ({
      ...prev,
      default_values: {
        ...prev.default_values,
        common_diagnoses: (prev.default_values.common_diagnoses || []).filter(d => d !== diagnosis)
      }
    }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      if (preferences?.id) {
        await base44.entities.ProviderPreferences.update(preferences.id, formData);
      } else {
        const currentUser = await base44.auth.me();
        await base44.entities.ProviderPreferences.create({
          ...formData,
          provider_email: currentUser.email
        });
      }
      toast.success("Preferences saved successfully!");
      if (onSaved) onSaved();
    } catch (error) {
      console.error("Failed to save preferences:", error);
      toast.error("Failed to save preferences");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Tabs defaultValue="phrasing" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="phrasing" className="text-xs">Phrasing</TabsTrigger>
          <TabsTrigger value="priorities" className="text-xs">Priorities</TabsTrigger>
          <TabsTrigger value="defaults" className="text-xs">Defaults</TabsTrigger>
          <TabsTrigger value="ai" className="text-xs">AI Settings</TabsTrigger>
        </TabsList>

        {/* Preferred Phrasing Tab */}
        <TabsContent value="phrasing" className="space-y-4 mt-4">
          <div className="space-y-3">
            {COMMON_ELEMENTS.map(elem => (
              <div key={elem.key}>
                <Label className="text-xs font-semibold">{elem.label}</Label>
                <Textarea
                  placeholder={`Enter your preferred way to document ${elem.label.toLowerCase()}`}
                  value={formData.preferred_phrasing?.[elem.key] || ""}
                  onChange={(e) => handlePhrasingChange(elem.key, e.target.value)}
                  className="mt-1 min-h-16 text-sm resize-none"
                />
              </div>
            ))}
          </div>

          {/* Custom Phrases */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Custom Phrases</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(formData.preferred_phrasing?.custom_phrases || []).map((phrase, idx) => (
                <div key={idx} className="flex items-start gap-2 bg-slate-50 p-2 rounded">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-slate-900">{phrase.element}</p>
                    <p className="text-xs text-slate-700 mt-1">{phrase.preferred_text}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => removeCustomPhrase(idx)}
                    className="text-red-600 hover:bg-red-50 h-8 w-8"
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              ))}

              <div className="border-t pt-3 space-y-2">
                <div>
                  <Label className="text-xs font-semibold">Element Name</Label>
                  <Input
                    placeholder="e.g., Skin assessment, Compliance check"
                    value={customPhrase.element}
                    onChange={(e) => setCustomPhrase({ ...customPhrase, element: e.target.value })}
                    className="h-8 text-xs mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs font-semibold">Preferred Text</Label>
                  <Textarea
                    placeholder="How you prefer this to be documented"
                    value={customPhrase.preferred_text}
                    onChange={(e) => setCustomPhrase({ ...customPhrase, preferred_text: e.target.value })}
                    className="min-h-12 text-xs resize-none mt-1"
                  />
                </div>
                <Button
                  onClick={addCustomPhrase}
                  disabled={!customPhrase.element || !customPhrase.preferred_text}
                  size="sm"
                  className="w-full h-8 text-xs"
                >
                  <Plus className="w-3 h-3 mr-1" />
                  Add Custom Phrase
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Priority Checklists Tab */}
        <TabsContent value="priorities" className="space-y-4 mt-4">
          <Alert>
            <AlertDescription className="text-xs">
              Select elements you want to prioritize in all documentation
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            {COMMON_ELEMENTS.map(elem => (
              <div key={elem.key} className="flex items-center gap-2 p-2 bg-slate-50 rounded">
                <Checkbox
                  id={elem.key}
                  checked={(formData.priority_checklists.default_priorities || []).includes(elem.key)}
                  onCheckedChange={() => toggleDefaultPriority(elem.key)}
                />
                <Label htmlFor={elem.key} className="text-xs cursor-pointer flex-1">
                  {elem.label}
                </Label>
              </div>
            ))}
          </div>
        </TabsContent>

        {/* Default Values Tab */}
        <TabsContent value="defaults" className="space-y-4 mt-4">
          <div>
            <Label className="text-xs font-semibold">Default Visit Type</Label>
            <Select 
              value={formData.default_values?.default_visit_type || ""}
              onValueChange={(value) => setFormData(prev => ({
                ...prev,
                default_values: { ...prev.default_values, default_visit_type: value }
              }))}
            >
              <SelectTrigger className="h-9 text-sm mt-1">
                <SelectValue placeholder="Select default visit type" />
              </SelectTrigger>
              <SelectContent>
                {VISIT_TYPES.map(vt => (
                  <SelectItem key={vt} value={vt} className="text-sm">
                    {vt.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs font-semibold mb-2 block">Common Diagnoses</Label>
            <div className="space-y-2">
              {(formData.default_values?.common_diagnoses || []).map(diagnosis => (
                <div key={diagnosis} className="flex items-center justify-between bg-slate-50 p-2 rounded">
                  <span className="text-xs text-slate-900">{diagnosis}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => removeCommonDiagnosis(diagnosis)}
                    className="text-red-600 hover:bg-red-50 h-6 w-6"
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              ))}
              <div className="flex gap-2">
                <Input
                  placeholder="Add common diagnosis"
                  value={customDiagnosis}
                  onChange={(e) => setCustomDiagnosis(e.target.value)}
                  onKeyPress={(e) => e.key === "Enter" && addCommonDiagnosis()}
                  className="h-8 text-xs flex-1"
                />
                <Button
                  onClick={addCommonDiagnosis}
                  size="sm"
                  className="h-8 text-xs"
                >
                  Add
                </Button>
              </div>
            </div>
          </div>

          <div>
            <Label className="text-xs font-semibold">Education Level Default</Label>
            <Select 
              value={formData.default_values?.default_education_level || "intermediate"}
              onValueChange={(value) => setFormData(prev => ({
                ...prev,
                default_values: { ...prev.default_values, default_education_level: value }
              }))}
            >
              <SelectTrigger className="h-9 text-sm mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="basic" className="text-sm">Basic</SelectItem>
                <SelectItem value="intermediate" className="text-sm">Intermediate</SelectItem>
                <SelectItem value="advanced" className="text-sm">Advanced</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </TabsContent>

        {/* AI Settings Tab */}
        <TabsContent value="ai" className="space-y-4 mt-4">
          <div>
            <Label className="text-xs font-semibold">Writing Style</Label>
            <Select 
              value={formData.ai_personalization?.writing_style || "clinical"}
              onValueChange={(value) => setFormData(prev => ({
                ...prev,
                ai_personalization: { ...prev.ai_personalization, writing_style: value }
              }))}
            >
              <SelectTrigger className="h-9 text-sm mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WRITING_STYLES.map(style => (
                  <SelectItem key={style} value={style} className="text-sm capitalize">
                    {style}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs font-semibold">Tone</Label>
            <Select 
              value={formData.ai_personalization?.tone || "professional"}
              onValueChange={(value) => setFormData(prev => ({
                ...prev,
                ai_personalization: { ...prev.ai_personalization, tone: value }
              }))}
            >
              <SelectTrigger className="h-9 text-sm mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TONES.map(tone => (
                  <SelectItem key={tone} value={tone} className="text-sm capitalize">
                    {tone}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs font-semibold">Detail Level</Label>
            <Select 
              value={formData.ai_personalization?.detail_level || "moderate"}
              onValueChange={(value) => setFormData(prev => ({
                ...prev,
                ai_personalization: { ...prev.ai_personalization, detail_level: value }
              }))}
            >
              <SelectTrigger className="h-9 text-sm mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DETAIL_LEVELS.map(level => (
                  <SelectItem key={level} value={level} className="text-sm capitalize">
                    {level}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs font-semibold mb-2 block">Focus Areas</Label>
            <div className="flex flex-wrap gap-1">
              {["patient education", "safety", "compliance", "clinical detail", "efficiency"].map(focus => (
                <Badge
                  key={focus}
                  variant={
                    (formData.ai_personalization?.focus_areas || []).includes(focus)
                      ? "default"
                      : "outline"
                  }
                  className="cursor-pointer text-xs"
                  onClick={() => {
                    const current = formData.ai_personalization?.focus_areas || [];
                    setFormData(prev => ({
                      ...prev,
                      ai_personalization: {
                        ...prev.ai_personalization,
                        focus_areas: current.includes(focus)
                          ? current.filter(f => f !== focus)
                          : [...current, focus]
                      }
                    }));
                  }}
                >
                  {focus}
                </Badge>
              ))}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Save Button */}
      <div className="flex gap-2">
        <Button
          onClick={handleSave}
          disabled={isSaving}
          className="flex-1 h-10 bg-blue-600 hover:bg-blue-700 gap-2"
        >
          {isSaving && <Loader className="w-4 h-4 animate-spin" />}
          {isSaving ? "Saving..." : "Save Preferences"}
        </Button>
      </div>
    </div>
  );
}