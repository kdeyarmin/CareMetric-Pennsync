import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Settings, Save, Sparkles } from "lucide-react";
import { toast } from "sonner";

/**
 * Allows nurses to explicitly set their AI documentation preferences
 * This supplements the automatic learning from feedback
 */
export default function AIStyleAdapter({ userEmail, providerType }) {
  const [isSaving, setIsSaving] = useState(false);

  const { data: preferences, refetch } = useQuery({
    queryKey: ['providerPreferences', userEmail],
    queryFn: async () => {
      const prefs = await base44.entities.ProviderPreferences.filter({ 
        provider_email: userEmail 
      });
      return prefs[0];
    },
    enabled: !!userEmail
  });

  const [settings, setSettings] = useState({
    writing_style: preferences?.ai_personalization?.writing_style || 'clinical',
    detail_level: preferences?.ai_personalization?.detail_level || 'moderate',
    tone: preferences?.ai_personalization?.tone || 'professional',
    focus_areas: preferences?.ai_personalization?.focus_areas || []
  });

  useEffect(() => {
    if (preferences?.ai_personalization) {
      setSettings({
        writing_style: preferences.ai_personalization.writing_style || 'clinical',
        detail_level: preferences.ai_personalization.detail_level || 'moderate',
        tone: preferences.ai_personalization.tone || 'professional',
        focus_areas: preferences.ai_personalization.focus_areas || []
      });
    }
  }, [preferences]);

  const focusAreaOptions = [
    "patient_safety",
    "patient_education", 
    "medication_management",
    "wound_care",
    "fall_prevention",
    "homebound_justification",
    "skilled_need_justification",
    "functional_assessment"
  ];

  const toggleFocusArea = (area) => {
    setSettings(prev => ({
      ...prev,
      focus_areas: prev.focus_areas.includes(area)
        ? prev.focus_areas.filter(a => a !== area)
        : [...prev.focus_areas, area]
    }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      if (preferences) {
        await base44.entities.ProviderPreferences.update(preferences.id, {
          ai_personalization: {
            ...(preferences.ai_personalization || {}),
            ...settings
          }
        });
      } else {
        await base44.entities.ProviderPreferences.create({
          provider_email: userEmail,
          provider_type: providerType,
          ai_personalization: settings
        });
      }

      toast.success("AI preferences saved! Future notes will use these settings");
      refetch();
    } catch (error) {
      toast.error("Failed to save preferences");
    }
    setIsSaving(false);
  };

  return (
    <Card className="border-2 border-indigo-200 bg-gradient-to-br from-indigo-50 to-purple-50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Settings className="w-5 h-5 text-indigo-600" />
          Customize AI Documentation Style
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="bg-indigo-100/50 rounded-lg p-3 border border-indigo-200">
          <p className="text-xs text-indigo-900 flex items-center gap-1">
            <Sparkles className="w-3 h-3" />
            AI will adapt to your preferences and learn from your feedback over time
          </p>
        </div>

        {/* Writing Style */}
        <div>
          <Label className="text-sm font-medium mb-2 block">Writing Style</Label>
          <Select value={settings.writing_style} onValueChange={(v) => setSettings({...settings, writing_style: v})}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="clinical">Clinical (Medical terminology)</SelectItem>
              <SelectItem value="detailed">Detailed (Comprehensive descriptions)</SelectItem>
              <SelectItem value="concise">Concise (Brief and focused)</SelectItem>
              <SelectItem value="narrative">Narrative (Story-like flow)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Detail Level */}
        <div>
          <Label className="text-sm font-medium mb-2 block">Detail Level</Label>
          <Select value={settings.detail_level} onValueChange={(v) => setSettings({...settings, detail_level: v})}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="minimal">Minimal (Key points only)</SelectItem>
              <SelectItem value="moderate">Moderate (Balanced detail)</SelectItem>
              <SelectItem value="comprehensive">Comprehensive (Very detailed)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Tone */}
        <div>
          <Label className="text-sm font-medium mb-2 block">Tone</Label>
          <Select value={settings.tone} onValueChange={(v) => setSettings({...settings, tone: v})}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="professional">Professional</SelectItem>
              <SelectItem value="warm">Warm & Empathetic</SelectItem>
              <SelectItem value="objective">Objective & Factual</SelectItem>
              <SelectItem value="empathetic">Empathetic</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Focus Areas */}
        <div>
          <Label className="text-sm font-medium mb-2 block">Documentation Focus Areas</Label>
          <div className="flex flex-wrap gap-2">
            {focusAreaOptions.map((area) => (
              <Badge
                key={area}
                variant={settings.focus_areas.includes(area) ? "default" : "outline"}
                className={`cursor-pointer transition-all ${
                  settings.focus_areas.includes(area) 
                    ? "bg-indigo-600 text-white" 
                    : "hover:bg-indigo-100"
                }`}
                onClick={() => toggleFocusArea(area)}
              >
                {area.replace(/_/g, ' ')}
              </Badge>
            ))}
          </div>
          <p className="text-xs text-gray-600 mt-2">
            AI will emphasize these areas in generated documentation
          </p>
        </div>

        {/* Save Button */}
        <Button
          onClick={handleSave}
          disabled={isSaving}
          className="w-full bg-indigo-600 hover:bg-indigo-700"
        >
          {isSaving ? (
            <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" /> Saving...</>
          ) : (
            <><Save className="w-4 h-4 mr-2" /> Save AI Preferences</>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}