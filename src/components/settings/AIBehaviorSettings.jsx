import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Zap, Save } from "lucide-react";
import { toast } from "sonner";

export default function AIBehaviorSettings({ currentUser }) {
  const [settings, setSettings] = useState({
    ai_aggressiveness: 'balanced', // conservative | balanced | aggressive
    auto_enhance_notes: true,
    auto_check_compliance: true,
    auto_suggest_tasks: true,
    ai_response_detail: 'standard', // brief | standard | detailed
    learning_mode_enabled: true,
    quality_threshold: 80
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadSettings();
  }, [currentUser?.email]);

  const loadSettings = async () => {
    if (!currentUser?.email) return;
    setLoading(true);
    try {
      const config = await base44.entities.AIConfiguration.filter({
        user_email: currentUser.email
      });
      if (config.length > 0) {
        setSettings(prev => ({ ...prev, ...config[0] }));
      }
    } catch (error) {
      console.error('Error loading AI settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const saveSettings = async () => {
    if (!currentUser?.email) return;
    setSaving(true);
    try {
      const config = await base44.entities.AIConfiguration.filter({
        user_email: currentUser.email
      });

      if (config.length > 0) {
        await base44.entities.AIConfiguration.update(config[0].id, settings);
      } else {
        await base44.entities.AIConfiguration.create({
          user_email: currentUser.email,
          ...settings
        });
      }
      toast.success('AI behavior settings saved');
    } catch (error) {
      console.error('Error saving settings:', error);
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card className="w-full">
        <CardContent className="p-6 flex justify-center">
          <Loader2 className="w-6 h-6 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader className="bg-gradient-to-r from-blue-100/60 to-slate-100/60 dark:from-slate-800/40 dark:to-slate-900/30 p-3 sm:p-4 md:p-6">
        <CardTitle className="flex items-center gap-2 text-xs sm:text-sm md:text-base">
          <Zap className="w-4 h-4 sm:w-5 sm:h-5" />
          AI Behavior & Automation
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4 space-y-4">
        {/* AI Aggressiveness */}
        <div>
          <Label className="text-sm font-medium mb-2 block">AI Suggestion Aggressiveness</Label>
          <Select value={settings.ai_aggressiveness} onValueChange={(value) => setSettings({ ...settings, ai_aggressiveness: value })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="conservative">
                🔇 Conservative - Minimal suggestions, mostly critical issues
              </SelectItem>
              <SelectItem value="balanced">
                ⚖️ Balanced - Standard suggestions (recommended)
              </SelectItem>
              <SelectItem value="aggressive">
                🚀 Aggressive - Frequent suggestions, proactive improvements
              </SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Controls how often AI provides suggestions and recommendations.
          </p>
        </div>

        {/* Response Detail Level */}
        <div>
          <Label className="text-sm font-medium mb-2 block">AI Response Detail Level</Label>
          <Select value={settings.ai_response_detail} onValueChange={(value) => setSettings({ ...settings, ai_response_detail: value })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="brief">Brief - Concise responses only</SelectItem>
              <SelectItem value="standard">Standard - Balanced detail (recommended)</SelectItem>
              <SelectItem value="detailed">Detailed - Comprehensive explanations</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Quality Threshold */}
        <div>
          <Label className="text-sm font-medium mb-2 block">
            Minimum Quality Threshold: {settings.quality_threshold}%
          </Label>
          <input
            type="range"
            min="60"
            max="100"
            step="5"
            value={settings.quality_threshold}
            onChange={(e) => setSettings({ ...settings, quality_threshold: parseInt(e.target.value) })}
            className="w-full"
          />
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            AI will flag notes below this quality score for review.
          </p>
        </div>

        {/* Automation Toggles */}
        <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-700">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Auto-Enhance Notes</Label>
            <Switch
              checked={settings.auto_enhance_notes}
              onCheckedChange={(checked) => setSettings({ ...settings, auto_enhance_notes: checked })}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Auto-Check Compliance</Label>
            <Switch
              checked={settings.auto_check_compliance}
              onCheckedChange={(checked) => setSettings({ ...settings, auto_check_compliance: checked })}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Auto-Suggest Follow-Up Tasks</Label>
            <Switch
              checked={settings.auto_suggest_tasks}
              onCheckedChange={(checked) => setSettings({ ...settings, auto_suggest_tasks: checked })}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Learning Mode (Personalization)</Label>
            <Switch
              checked={settings.learning_mode_enabled}
              onCheckedChange={(checked) => setSettings({ ...settings, learning_mode_enabled: checked })}
            />
          </div>
        </div>

        <Button
          onClick={saveSettings}
          disabled={saving}
          className="w-full bg-blue-600 hover:bg-blue-700 mt-4"
        >
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="w-4 h-4 mr-2" />
              Save AI Settings
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}