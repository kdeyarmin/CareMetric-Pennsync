import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Settings, Save, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export default function AIPreferencesPanel({ currentUser }) {
  const queryClient = useQueryClient();

  // Fetch user's AI preferences
  const { data: preferences, isLoading } = useQuery({
    queryKey: ['aiPreferences', currentUser?.email],
    queryFn: async () => {
      const prefs = await base44.entities.AIConfiguration.filter({
        user_email: currentUser?.email
      });
      return prefs[0] || null;
    },
    enabled: !!currentUser?.email
  });

  const [localPrefs, setLocalPrefs] = useState({
    verbosity_level: 'balanced',
    compliance_priority: 'medicare',
    suggestion_aggressiveness: 'moderate',
    auto_apply_minor_fixes: false,
    include_education_tips: true,
    preferred_note_structure: 'narrative'
  });

  React.useEffect(() => {
    if (preferences) {
      setLocalPrefs({
        verbosity_level: preferences.verbosity_level || 'balanced',
        compliance_priority: preferences.compliance_priority || 'medicare',
        suggestion_aggressiveness: preferences.suggestion_aggressiveness || 'moderate',
        auto_apply_minor_fixes: preferences.auto_apply_minor_fixes || false,
        include_education_tips: preferences.include_education_tips !== false,
        preferred_note_structure: preferences.preferred_note_structure || 'narrative'
      });
    }
  }, [preferences]);

  const saveMutation = useMutation({
    mutationFn: async (prefs) => {
      if (preferences?.id) {
        return await base44.entities.AIConfiguration.update(preferences.id, prefs);
      } else {
        return await base44.entities.AIConfiguration.create({
          ...prefs,
          user_email: currentUser?.email,
          user_name: currentUser?.full_name
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['aiPreferences'] });
      toast.success("AI preferences saved!");
    },
    onError: () => {
      toast.error("Failed to save preferences");
    }
  });

  const handleSave = () => {
    saveMutation.mutate(localPrefs);
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <Loader2 className="w-6 h-6 animate-spin mx-auto" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-purple-300 bg-purple-50 dark:bg-purple-950">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="w-5 h-5 text-purple-600" />
          AI Enhancement Preferences
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Verbosity Level */}
        <div>
          <Label className="text-sm font-medium mb-2 block">Note Verbosity</Label>
          <Select
            value={localPrefs.verbosity_level}
            onValueChange={(value) => setLocalPrefs({...localPrefs, verbosity_level: value})}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="concise">Concise - Brief, essential details only</SelectItem>
              <SelectItem value="balanced">Balanced - Standard clinical detail</SelectItem>
              <SelectItem value="detailed">Detailed - Comprehensive documentation</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Compliance Priority */}
        <div>
          <Label className="text-sm font-medium mb-2 block">Compliance Focus</Label>
          <Select
            value={localPrefs.compliance_priority}
            onValueChange={(value) => setLocalPrefs({...localPrefs, compliance_priority: value})}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="medicare">Medicare/CMS - Home health focus</SelectItem>
              <SelectItem value="joint_commission">Joint Commission - Hospital standards</SelectItem>
              <SelectItem value="state">State Regulations - Local requirements</SelectItem>
              <SelectItem value="balanced">Balanced - All compliance areas</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Suggestion Aggressiveness */}
        <div>
          <Label className="text-sm font-medium mb-2 block">Quality Suggestions</Label>
          <Select
            value={localPrefs.suggestion_aggressiveness}
            onValueChange={(value) => setLocalPrefs({...localPrefs, suggestion_aggressiveness: value})}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="minimal">Minimal - Only critical issues</SelectItem>
              <SelectItem value="moderate">Moderate - Important improvements</SelectItem>
              <SelectItem value="comprehensive">Comprehensive - All possible improvements</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Note Structure Preference */}
        <div>
          <Label className="text-sm font-medium mb-2 block">Preferred Note Format</Label>
          <Select
            value={localPrefs.preferred_note_structure}
            onValueChange={(value) => setLocalPrefs({...localPrefs, preferred_note_structure: value})}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="narrative">Narrative - Flowing paragraphs</SelectItem>
              <SelectItem value="soap">SOAP - Structured format</SelectItem>
              <SelectItem value="bullet">Bullet Points - Concise lists</SelectItem>
              <SelectItem value="mixed">Mixed - Combination style</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Toggle Options */}
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm">Auto-apply minor grammar fixes</Label>
            <Switch
              checked={localPrefs.auto_apply_minor_fixes}
              onCheckedChange={(checked) => setLocalPrefs({...localPrefs, auto_apply_minor_fixes: checked})}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label className="text-sm">Include patient education tips</Label>
            <Switch
              checked={localPrefs.include_education_tips}
              onCheckedChange={(checked) => setLocalPrefs({...localPrefs, include_education_tips: checked})}
            />
          </div>
        </div>

        {/* Save Button */}
        <Button
          onClick={handleSave}
          disabled={saveMutation.isPending}
          className="w-full bg-purple-600 hover:bg-purple-700 mt-4"
        >
          {saveMutation.isPending ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="w-4 h-4 mr-2" />
              Save Preferences
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}