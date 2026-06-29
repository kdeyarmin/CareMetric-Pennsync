import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Settings, Brain } from "lucide-react";

export default function AIConfigurationManager() {
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);

  const { data: configs = [], isLoading } = useQuery({
    queryKey: ['aiConfigurations'],
    queryFn: () => base44.entities.AIConfiguration.list(),
  });

  const saveMutation = useMutation({
    mutationFn: (configData) => {
      const existing = configs.find(c => c.setting_name === configData.setting_name);
      if (existing) {
        return base44.entities.AIConfiguration.update(existing.id, configData);
      }
      return base44.entities.AIConfiguration.create(configData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['aiConfigurations'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  const getConfigValue = (name, defaultValue) => {
    const config = configs.find(c => c.setting_name === name);
    return config?.value || defaultValue;
  };

  const handleSaveConfig = (name, category, value, description) => {
    saveMutation.mutate({
      setting_name: name,
      setting_category: category,
      value,
      description,
      is_active: true
    });
  };

  return (
    <Card className="border-2 border-blue-300">
      <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50">
        <CardTitle className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-blue-600" />
          AI Configuration & Fine-Tuning
          {saved && <Badge className="bg-green-600 ml-auto">Saved!</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6">
        <Alert className="mb-6 bg-blue-50 border-blue-200">
          <Settings className="w-4 h-4 text-blue-600" />
          <AlertDescription className="text-sm">
            Configure AI behavior agency-wide. Changes apply to all nurses immediately.
          </AlertDescription>
        </Alert>

        {isLoading ? (
          <div className="py-12 text-center text-slate-500">Loading configuration…</div>
        ) : (
        <Tabs defaultValue="compliance" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="compliance">Compliance</TabsTrigger>
            <TabsTrigger value="documentation">Documentation</TabsTrigger>
            <TabsTrigger value="analysis">Analysis</TabsTrigger>
            <TabsTrigger value="general">General</TabsTrigger>
          </TabsList>

          <TabsContent value="compliance" className="space-y-6">
            <ComplianceSettings 
              getConfigValue={getConfigValue}
              onSave={handleSaveConfig}
            />
          </TabsContent>

          <TabsContent value="documentation" className="space-y-6">
            <DocumentationSettings 
              getConfigValue={getConfigValue}
              onSave={handleSaveConfig}
            />
          </TabsContent>

          <TabsContent value="analysis" className="space-y-6">
            <AnalysisSettings 
              getConfigValue={getConfigValue}
              onSave={handleSaveConfig}
            />
          </TabsContent>

          <TabsContent value="general" className="space-y-6">
            <GeneralSettings 
              getConfigValue={getConfigValue}
              onSave={handleSaveConfig}
            />
          </TabsContent>
        </Tabs>
        )}
      </CardContent>
    </Card>
  );
}

function ComplianceSettings({ getConfigValue, onSave }) {
  const [targetScore, setTargetScore] = useState(getConfigValue('compliance_target_score', { target: 90 }).target);
  const [strictMode, setStrictMode] = useState(getConfigValue('compliance_strict_mode', { enabled: false }).enabled);

  return (
    <>
      <div className="space-y-4">
        <div>
          <Label className="text-base font-semibold mb-3 block">Compliance Target Score</Label>
          <p className="text-sm text-slate-600 mb-3">Default compliance threshold for all documentation</p>
          <div className="flex items-center gap-4">
            <Slider
              value={[targetScore]}
              onValueChange={([val]) => setTargetScore(val)}
              min={70}
              max={100}
              step={5}
              className="flex-1"
            />
            <Badge className="bg-blue-600 text-white text-lg px-4 py-2">{targetScore}%</Badge>
          </div>
          <Button 
            size="sm" 
            className="mt-3"
            onClick={() => onSave('compliance_target_score', 'compliance', { target: targetScore }, 'Default compliance target score')}
          >
            Save Target Score
          </Button>
        </div>

        <div className="border-t pt-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-base font-semibold">Strict Compliance Mode</Label>
              <p className="text-sm text-slate-600 mt-1">Require all critical elements before allowing note submission</p>
            </div>
            <Switch
              checked={strictMode}
              onCheckedChange={(checked) => {
                setStrictMode(checked);
                onSave('compliance_strict_mode', 'compliance', { enabled: checked }, 'Strict compliance enforcement');
              }}
            />
          </div>
        </div>
      </div>
    </>
  );
}

function DocumentationSettings({ getConfigValue, onSave }) {
  const [detailLevel, setDetailLevel] = useState(getConfigValue('documentation_detail_level', { level: 'standard' }).level);
  const [autoEnhance, setAutoEnhance] = useState(getConfigValue('documentation_auto_enhance', { enabled: false }).enabled);

  return (
    <>
      <div className="space-y-4">
        <div>
          <Label className="text-base font-semibold mb-3 block">Documentation Detail Level</Label>
          <p className="text-sm text-slate-600 mb-3">Control how verbose AI-generated notes are</p>
          <div className="grid grid-cols-3 gap-2">
            {['concise', 'standard', 'detailed'].map((level) => (
              <Button
                key={level}
                variant={detailLevel === level ? 'default' : 'outline'}
                onClick={() => {
                  setDetailLevel(level);
                  onSave('documentation_detail_level', 'documentation', { level }, 'AI note detail level');
                }}
              >
                {level.charAt(0).toUpperCase() + level.slice(1)}
              </Button>
            ))}
          </div>
        </div>

        <div className="border-t pt-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-base font-semibold">Auto-Enhance on Save</Label>
              <p className="text-sm text-slate-600 mt-1">Automatically enhance notes when saving (skips manual enhance step)</p>
            </div>
            <Switch
              checked={autoEnhance}
              onCheckedChange={(checked) => {
                setAutoEnhance(checked);
                onSave('documentation_auto_enhance', 'documentation', { enabled: checked }, 'Auto-enhance notes');
              }}
            />
          </div>
        </div>
      </div>
    </>
  );
}

function AnalysisSettings({ getConfigValue, onSave }) {
  const [riskSensitivity, setRiskSensitivity] = useState(getConfigValue('risk_analysis_sensitivity', { level: 50 }).level);
  const [autoAnalyze, setAutoAnalyze] = useState(getConfigValue('risk_auto_analyze', { enabled: true }).enabled);

  return (
    <>
      <div className="space-y-4">
        <div>
          <Label className="text-base font-semibold mb-3 block">Risk Detection Sensitivity</Label>
          <p className="text-sm text-slate-600 mb-3">Higher = more alerts, Lower = only critical risks</p>
          <div className="flex items-center gap-4">
            <span className="text-xs text-slate-500">Conservative</span>
            <Slider
              value={[riskSensitivity]}
              onValueChange={([val]) => setRiskSensitivity(val)}
              min={0}
              max={100}
              step={10}
              className="flex-1"
            />
            <span className="text-xs text-slate-500">Aggressive</span>
          </div>
          <div className="flex items-center justify-between mt-2">
            <Badge variant="outline">{riskSensitivity}% Sensitivity</Badge>
            <Button 
              size="sm"
              onClick={() => onSave('risk_analysis_sensitivity', 'analysis', { level: riskSensitivity }, 'Risk detection sensitivity')}
            >
              Save Sensitivity
            </Button>
          </div>
        </div>

        <div className="border-t pt-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-base font-semibold">Auto-Run Risk Analysis</Label>
              <p className="text-sm text-slate-600 mt-1">Automatically analyze patient risk after each visit completion</p>
            </div>
            <Switch
              checked={autoAnalyze}
              onCheckedChange={(checked) => {
                setAutoAnalyze(checked);
                onSave('risk_auto_analyze', 'analysis', { enabled: checked }, 'Auto-run risk analysis');
              }}
            />
          </div>
        </div>
      </div>
    </>
  );
}

function GeneralSettings({ getConfigValue, onSave }) {
  const [aiEnabled, setAiEnabled] = useState(getConfigValue('ai_features_enabled', { enabled: true }).enabled);
  const [cacheTime, setCacheTime] = useState(getConfigValue('ai_cache_time', { minutes: 5 }).minutes);

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center justify-between p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <div>
            <Label className="text-base font-semibold text-yellow-900">Master AI Toggle</Label>
            <p className="text-sm text-yellow-700 mt-1">Enable or disable all AI features agency-wide</p>
          </div>
          <Switch
            checked={aiEnabled}
            onCheckedChange={(checked) => {
              setAiEnabled(checked);
              onSave('ai_features_enabled', 'general', { enabled: checked }, 'Master AI feature toggle');
            }}
          />
        </div>

        <div className="border-t pt-4">
          <Label className="text-base font-semibold mb-3 block">AI Response Cache Duration</Label>
          <p className="text-sm text-slate-600 mb-3">How long to cache AI responses (reduces API costs)</p>
          <div className="flex items-center gap-4">
            <Input
              type="number"
              value={cacheTime}
              onChange={(e) => setCacheTime(parseInt(e.target.value) || 5)}
              min={1}
              max={60}
              className="w-24"
            />
            <span className="text-sm text-slate-600">minutes</span>
            <Button 
              size="sm"
              onClick={() => onSave('ai_cache_time', 'general', { minutes: cacheTime }, 'AI response cache duration')}
            >
              Save Cache Time
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}