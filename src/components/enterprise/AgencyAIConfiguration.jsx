import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";
import { Brain, Save, AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function AgencyAIConfiguration({ agencySettings }) {
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState({
    ai_learning_enabled: agencySettings?.ai_learning_enabled ?? true,
    agency_wide_learning: agencySettings?.agency_wide_learning ?? false,
    custom_compliance_rules: agencySettings?.custom_compliance_rules || '',
    custom_documentation_style: agencySettings?.custom_documentation_style || '',
    ai_model_preference: agencySettings?.ai_model_preference || 'balanced',
    min_confidence_threshold: agencySettings?.min_confidence_threshold || 70,
    share_learnings_across_providers: agencySettings?.share_learnings_across_providers ?? true,
    agency_specific_prompts: agencySettings?.agency_specific_prompts || '',
    auto_apply_best_practices: agencySettings?.auto_apply_best_practices ?? false,
    custom_terminology: agencySettings?.custom_terminology || ''
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      if (agencySettings?.id) {
        await base44.entities.AgencySettings.update(agencySettings.id, config);
      } else {
        await base44.entities.AgencySettings.create(config);
      }
      toast.success('AI configuration saved successfully');
    } catch (error) {
      console.error('Error saving settings:', error);
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-purple-600" />
            Agency AI Learning Configuration
          </CardTitle>
          <CardDescription>
            Customize how AI learns and adapts to your agency's specific needs
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Core AI Settings */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="ai-learning">Enable AI Learning</Label>
                <p className="text-sm text-slate-500">
                  Allow AI to learn from provider interactions
                </p>
              </div>
              <Switch
                id="ai-learning"
                checked={config.ai_learning_enabled}
                onCheckedChange={(checked) => 
                  setConfig({ ...config, ai_learning_enabled: checked })
                }
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="agency-wide">Agency-Wide Learning</Label>
                <p className="text-sm text-slate-500">
                  Share learned patterns across all providers in your agency
                </p>
              </div>
              <Switch
                id="agency-wide"
                checked={config.agency_wide_learning}
                onCheckedChange={(checked) => 
                  setConfig({ ...config, agency_wide_learning: checked })
                }
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="share-learnings">Share Best Practices</Label>
                <p className="text-sm text-slate-500">
                  Apply top-performing providers' patterns to others
                </p>
              </div>
              <Switch
                id="share-learnings"
                checked={config.share_learnings_across_providers}
                onCheckedChange={(checked) => 
                  setConfig({ ...config, share_learnings_across_providers: checked })
                }
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="auto-apply">Auto-Apply Best Practices</Label>
                <p className="text-sm text-slate-500">
                  Automatically apply proven patterns to new notes
                </p>
              </div>
              <Switch
                id="auto-apply"
                checked={config.auto_apply_best_practices}
                onCheckedChange={(checked) => 
                  setConfig({ ...config, auto_apply_best_practices: checked })
                }
              />
            </div>
          </div>

          {/* AI Model Preference */}
          <div className="space-y-2">
            <Label>AI Model Preference</Label>
            <select
              value={config.ai_model_preference}
              onChange={(e) => setConfig({ ...config, ai_model_preference: e.target.value })}
              className="w-full p-2 border rounded-md"
            >
              <option value="fast">Fast (Quick responses, less detailed)</option>
              <option value="balanced">Balanced (Recommended)</option>
              <option value="accurate">Accurate (Slower, more thorough)</option>
            </select>
          </div>

          {/* Confidence Threshold */}
          <div className="space-y-2">
            <Label>Minimum Confidence Threshold ({config.min_confidence_threshold}%)</Label>
            <Input
              type="range"
              min="50"
              max="95"
              value={config.min_confidence_threshold}
              onChange={(e) => setConfig({ 
                ...config, 
                min_confidence_threshold: parseInt(e.target.value) 
              })}
            />
            <p className="text-sm text-slate-500">
              AI suggestions below this confidence level won't be shown
            </p>
          </div>

          {/* Custom Compliance Rules */}
          <div className="space-y-2">
            <Label>Custom Compliance Rules</Label>
            <Textarea
              placeholder="Add agency-specific compliance requirements (e.g., 'Always include homebound status in skilled nursing visits')"
              value={config.custom_compliance_rules}
              onChange={(e) => setConfig({ ...config, custom_compliance_rules: e.target.value })}
              className="h-24"
            />
          </div>

          {/* Custom Documentation Style */}
          <div className="space-y-2">
            <Label>Preferred Documentation Style</Label>
            <Textarea
              placeholder="Describe your agency's preferred documentation style (e.g., 'Use concise, bullet-point format for assessments')"
              value={config.custom_documentation_style}
              onChange={(e) => setConfig({ ...config, custom_documentation_style: e.target.value })}
              className="h-24"
            />
          </div>

          {/* Agency-Specific Prompts */}
          <div className="space-y-2">
            <Label>Agency-Specific AI Instructions</Label>
            <Textarea
              placeholder="Additional instructions for AI (e.g., 'Focus on medication reconciliation', 'Always mention fall risk assessment')"
              value={config.agency_specific_prompts}
              onChange={(e) => setConfig({ ...config, agency_specific_prompts: e.target.value })}
              className="h-24"
            />
          </div>

          {/* Custom Terminology */}
          <div className="space-y-2">
            <Label>Custom Terminology</Label>
            <Textarea
              placeholder="Agency-specific terms or abbreviations (one per line, e.g., 'HHA = Home Health Aide')"
              value={config.custom_terminology}
              onChange={(e) => setConfig({ ...config, custom_terminology: e.target.value })}
              className="h-24"
            />
          </div>

          <Alert>
            <AlertCircle className="w-4 h-4" />
            <AlertDescription>
              These settings apply to all providers in your agency. Changes may take a few minutes to propagate.
            </AlertDescription>
          </Alert>

          <Button onClick={handleSave} disabled={saving} className="w-full">
            <Save className="w-4 h-4 mr-2" />
            {saving ? 'Saving...' : 'Save Configuration'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}