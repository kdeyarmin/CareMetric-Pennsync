import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Settings, CheckCircle, Loader2 } from "lucide-react";

export default function AgencyGuidedSetup({ agency }) {
  const queryClient = useQueryClient();

  const { data: agencySettings } = useQuery({
    queryKey: ['agencySettings'],
    queryFn: async () => {
      const settings = await base44.entities.AgencySettings.list();
      return settings[0];
    }
  });

  const [settings, setSettings] = useState({
    custom_compliance_rules: agencySettings?.custom_compliance_rules || "",
    custom_documentation_style: agencySettings?.custom_documentation_style || "",
    ai_learning_enabled: agencySettings?.ai_learning_enabled !== false,
    agency_wide_learning: agencySettings?.agency_wide_learning || false,
    ai_model_preference: agencySettings?.ai_model_preference || "balanced",
    min_confidence_threshold: agencySettings?.min_confidence_threshold || 70,
    share_learnings_across_providers: agencySettings?.share_learnings_across_providers !== false,
    auto_apply_best_practices: agencySettings?.auto_apply_best_practices || false,
    custom_terminology: agencySettings?.custom_terminology || ""
  });

  const updateSettingsMutation = useMutation({
    mutationFn: async (data) => {
      if (agencySettings) {
        await base44.entities.AgencySettings.update(agencySettings.id, data);
      } else {
        await base44.entities.AgencySettings.create({
          ...data,
          agency_code: agency.agency_code,
          office_name: agency.agency_name
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agencySettings'] });
      toast.success('Settings saved successfully');
    }
  });

  const handleSave = () => {
    updateSettingsMutation.mutate(settings);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="w-5 h-5 text-blue-600" />
          Agency Configuration
        </CardTitle>
        <CardDescription>Configure agency-wide settings and AI preferences</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Compliance & Documentation */}
        <div className="space-y-4">
          <h4 className="font-semibold text-sm">Compliance & Documentation</h4>
          <div>
            <Label>Custom Compliance Rules</Label>
            <Textarea
              value={settings.custom_compliance_rules}
              onChange={(e) => setSettings({ ...settings, custom_compliance_rules: e.target.value })}
              placeholder="e.g., All notes must include fall risk assessment, Medication reconciliation required on every visit"
              rows={3}
            />
          </div>
          <div>
            <Label>Documentation Style Preferences</Label>
            <Textarea
              value={settings.custom_documentation_style}
              onChange={(e) => setSettings({ ...settings, custom_documentation_style: e.target.value })}
              placeholder="e.g., Use narrative style, Prefer bullet points for assessments, Include specific terminology"
              rows={3}
            />
          </div>
          <div>
            <Label>Custom Terminology</Label>
            <Textarea
              value={settings.custom_terminology}
              onChange={(e) => setSettings({ ...settings, custom_terminology: e.target.value })}
              placeholder="e.g., Use 'client' instead of 'patient', Agency-specific abbreviations"
              rows={2}
            />
          </div>
        </div>

        {/* AI Configuration */}
        <div className="space-y-4 pt-4 border-t">
          <h4 className="font-semibold text-sm">AI Learning & Preferences</h4>
          
          <div className="flex items-center justify-between">
            <div>
              <Label>AI Learning Enabled</Label>
              <p className="text-xs text-slate-500">Allow AI to learn from your agency's documentation patterns</p>
            </div>
            <Switch
              checked={settings.ai_learning_enabled}
              onCheckedChange={(checked) => setSettings({ ...settings, ai_learning_enabled: checked })}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>Share Learnings Across All Providers</Label>
              <p className="text-xs text-slate-500">Share best practices discovered from one provider with all others</p>
            </div>
            <Switch
              checked={settings.share_learnings_across_providers}
              onCheckedChange={(checked) => setSettings({ ...settings, share_learnings_across_providers: checked })}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>Auto-Apply Best Practices</Label>
              <p className="text-xs text-slate-500">Automatically apply proven patterns to new notes</p>
            </div>
            <Switch
              checked={settings.auto_apply_best_practices}
              onCheckedChange={(checked) => setSettings({ ...settings, auto_apply_best_practices: checked })}
            />
          </div>

          <div>
            <Label>AI Model Preference</Label>
            <Select value={settings.ai_model_preference} onValueChange={(v) => setSettings({ ...settings, ai_model_preference: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fast">Fast (Quicker responses, good for routine notes)</SelectItem>
                <SelectItem value="balanced">Balanced (Recommended)</SelectItem>
                <SelectItem value="accurate">Accurate (Best quality, slower)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Minimum Confidence Threshold (%)</Label>
            <Input
              type="number"
              value={settings.min_confidence_threshold}
              onChange={(e) => setSettings({ ...settings, min_confidence_threshold: parseInt(e.target.value) })}
              min={0}
              max={100}
            />
            <p className="text-xs text-slate-500 mt-1">AI suggestions below this confidence level will be flagged for review</p>
          </div>
        </div>

        <Button 
          onClick={handleSave} 
          disabled={updateSettingsMutation.isPending}
          className="w-full bg-blue-600 hover:bg-blue-700"
        >
          {updateSettingsMutation.isPending ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <CheckCircle className="w-4 h-4 mr-2" />
              Save Configuration
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}