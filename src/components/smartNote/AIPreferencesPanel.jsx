import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Settings, Save, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export default function AIPreferencesPanel({ currentUser }) {
  const queryClient = useQueryClient();

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
    preferred_note_structure: 'narrative',
    custom_compliance_rules: []
  });

  const [newRule, setNewRule] = useState({ 
    rule_name: '', 
    rule_description: '', 
    applies_to_visit_types: [], 
    is_active: true 
  });

  React.useEffect(() => {
    if (preferences) {
      setLocalPrefs({
        verbosity_level: preferences.verbosity_level || 'balanced',
        compliance_priority: preferences.compliance_priority || 'medicare',
        suggestion_aggressiveness: preferences.suggestion_aggressiveness || 'moderate',
        auto_apply_minor_fixes: preferences.auto_apply_minor_fixes || false,
        include_education_tips: preferences.include_education_tips !== false,
        preferred_note_structure: preferences.preferred_note_structure || 'narrative',
        custom_compliance_rules: preferences.custom_compliance_rules || []
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
        <div>
          <Label className="text-sm font-medium mb-2 block">Note Verbosity</Label>
          <Select
            value={localPrefs.verbosity_level}
            onValueChange={(value) => setLocalPrefs({...localPrefs, verbosity_level: value})}>
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

        <div>
          <Label className="text-sm font-medium mb-2 block">Compliance Focus</Label>
          <Select
            value={localPrefs.compliance_priority}
            onValueChange={(value) => setLocalPrefs({...localPrefs, compliance_priority: value})}>
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

        <div>
          <Label className="text-sm font-medium mb-2 block">Quality Suggestions</Label>
          <Select
            value={localPrefs.suggestion_aggressiveness}
            onValueChange={(value) => setLocalPrefs({...localPrefs, suggestion_aggressiveness: value})}>
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

        <div>
          <Label className="text-sm font-medium mb-2 block">Preferred Note Format</Label>
          <Select
            value={localPrefs.preferred_note_structure}
            onValueChange={(value) => setLocalPrefs({...localPrefs, preferred_note_structure: value})}>
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

        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm">Auto-apply minor grammar fixes</Label>
            <Switch
              checked={localPrefs.auto_apply_minor_fixes}
              onCheckedChange={(checked) => setLocalPrefs({...localPrefs, auto_apply_minor_fixes: checked})} />
          </div>

          <div className="flex items-center justify-between">
            <Label className="text-sm">Include patient education tips</Label>
            <Switch
              checked={localPrefs.include_education_tips}
              onCheckedChange={(checked) => setLocalPrefs({...localPrefs, include_education_tips: checked})} />
          </div>
        </div>

        {/* Custom Compliance Rules */}
        <div className="space-y-2 pt-4 border-t">
          <Label className="text-base font-semibold">Custom Compliance Rules</Label>
          <p className="text-xs text-slate-600 dark:text-slate-400 mb-3">
            Define your own compliance rules in natural language. The AI will interpret and apply them during note enhancement.
          </p>
          
          {localPrefs.custom_compliance_rules?.length > 0 && (
            <div className="space-y-2 mb-3">
              {localPrefs.custom_compliance_rules.map((rule, idx) => (
                <div key={idx} className="bg-slate-50 dark:bg-slate-900 p-3 rounded-lg border">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-semibold text-sm">{rule.rule_name}</p>
                        {!rule.is_active && <Badge variant="outline" className="text-xs">Inactive</Badge>}
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-400">{rule.rule_description}</p>
                      {rule.applies_to_visit_types?.length > 0 && (
                        <div className="flex gap-1 mt-2">
                          {rule.applies_to_visit_types.map((vt, i) => (
                            <Badge key={i} variant="outline" className="text-xs">{vt}</Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => {
                        const updated = localPrefs.custom_compliance_rules.filter((_, i) => i !== idx);
                        setLocalPrefs({ ...localPrefs, custom_compliance_rules: updated });
                      }}
                      className="h-6 w-6 text-red-600">
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="bg-indigo-50 dark:bg-indigo-950 p-3 rounded-lg space-y-2">
            <input
              type="text"
              placeholder="Rule name (e.g., 'Wound Measurement Detail')"
              value={newRule.rule_name}
              onChange={(e) => setNewRule({ ...newRule, rule_name: e.target.value })}
              className="w-full px-3 py-2 rounded-md border text-sm" />
            <Textarea
              placeholder="Describe your rule in natural language (e.g., 'All wound assessments must include length, width, depth in centimeters, wound bed description, and surrounding skin condition')"
              value={newRule.rule_description}
              onChange={(e) => setNewRule({ ...newRule, rule_description: e.target.value })}
              className="text-sm h-20" />
            <Button
              size="sm"
              onClick={() => {
                if (newRule.rule_name && newRule.rule_description) {
                  setLocalPrefs({
                    ...localPrefs,
                    custom_compliance_rules: [...(localPrefs.custom_compliance_rules || []), newRule]
                  });
                  setNewRule({ rule_name: '', rule_description: '', applies_to_visit_types: [], is_active: true });
                  toast.success('Rule added');
                }
              }}
              className="bg-indigo-600 hover:bg-indigo-700">
              <Plus className="w-3 h-3 mr-1" />
              Add Rule
            </Button>
          </div>
        </div>

        <Button
          onClick={handleSave}
          disabled={saveMutation.isPending}
          className="w-full bg-purple-600 hover:bg-purple-700 mt-4">
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