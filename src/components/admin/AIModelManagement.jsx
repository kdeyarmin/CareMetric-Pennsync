import React, { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  Brain, 
  Settings, 
  TrendingUp, 
  Zap, 
  Save,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  BarChart3
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export default function AIModelManagement({ noteConversions = [] }) {
  const queryClient = useQueryClient();
  const [activeModel, setActiveModel] = useState("note-enhancement");

  // Fetch AI configuration
  const { data: aiConfig } = useQuery({
    queryKey: ['aiConfiguration'],
    queryFn: async () => {
      const configs = await base44.entities.AIConfiguration.list();
      return configs[0] || createDefaultConfig();
    }
  });

  // Save configuration mutation
  const saveConfigMutation = useMutation({
    mutationFn: async (config) => {
      if (aiConfig?.id) {
        return await base44.entities.AIConfiguration.update(aiConfig.id, config);
      } else {
        return await base44.entities.AIConfiguration.create(config);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['aiConfiguration'] });
    }
  });

  const [tempConfig, setTempConfig] = useState(aiConfig || createDefaultConfig());

  React.useEffect(() => {
    if (aiConfig) setTempConfig(aiConfig);
  }, [aiConfig]);

  // Calculate model performance metrics
  const modelMetrics = useMemo(() => {
    const recentConversions = noteConversions.slice(0, 100);
    
    return {
      totalConversions: noteConversions.length,
      avgQualityScore: Math.round(
        noteConversions.reduce((sum, c) => sum + (c.quality_score || 0), 0) / (noteConversions.length || 1)
      ),
      avgComplianceScore: Math.round(
        noteConversions.reduce((sum, c) => sum + (c.compliance_score || 0), 0) / (noteConversions.length || 1)
      ),
      avgResponseTime: Math.round(
        noteConversions.reduce((sum, c) => sum + (c.conversion_time_ms || 0), 0) / (noteConversions.length || 1)
      ),
      successRate: ((recentConversions.filter(c => c.quality_score >= 70).length / (recentConversions.length || 1)) * 100).toFixed(1)
    };
  }, [noteConversions]);

  // Performance trend data
  const performanceTrend = useMemo(() => {
    const daily = {};
    noteConversions.forEach(conv => {
      const date = new Date(conv.created_date).toLocaleDateString();
      if (!daily[date]) {
        daily[date] = { date, count: 0, totalQuality: 0, totalCompliance: 0 };
      }
      daily[date].count++;
      daily[date].totalQuality += conv.quality_score || 0;
      daily[date].totalCompliance += conv.compliance_score || 0;
    });

    return Object.values(daily)
      .map(d => ({
        date: d.date,
        avgQuality: Math.round(d.totalQuality / d.count),
        avgCompliance: Math.round(d.totalCompliance / d.count)
      }))
      .slice(-30);
  }, [noteConversions]);

  const handleSave = async () => {
    await saveConfigMutation.mutateAsync(tempConfig);
  };

  const updateModelConfig = (modelKey, updates) => {
    setTempConfig(prev => ({
      ...prev,
      models: {
        ...prev.models,
        [modelKey]: {
          ...prev.models[modelKey],
          ...updates
        }
      }
    }));
  };

  const models = [
    {
      id: "note-enhancement",
      name: "Clinical Note Enhancement",
      description: "Transforms rough notes into Medicare-compliant documentation",
      icon: Brain,
      color: "blue"
    },
    {
      id: "compliance-checker",
      name: "Compliance Checker",
      description: "Validates documentation against Medicare requirements",
      icon: CheckCircle2,
      color: "green"
    },
    {
      id: "risk-predictor",
      name: "Patient Risk Predictor",
      description: "Identifies patients at risk for adverse events",
      icon: AlertCircle,
      color: "orange"
    },
    {
      id: "care-plan-generator",
      name: "Care Plan Generator",
      description: "Creates personalized care plans based on diagnosis",
      icon: Zap,
      color: "purple"
    }
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">AI Model Management</h2>
          <p className="text-gray-600">Configure and monitor AI models powering the application</p>
        </div>
        <Button onClick={handleSave} className="gap-2">
          <Save className="w-4 h-4" />
          Save Configuration
        </Button>
      </div>

      {/* Performance Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-gray-600">Total AI Calls</p>
              <Brain className="w-5 h-5 text-blue-600" />
            </div>
            <p className="text-3xl font-bold">{modelMetrics.totalConversions}</p>
            <p className="text-xs text-gray-500 mt-1">All time</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-gray-600">Avg Quality</p>
              <TrendingUp className="w-5 h-5 text-green-600" />
            </div>
            <p className="text-3xl font-bold">{modelMetrics.avgQualityScore}</p>
            <p className="text-xs text-gray-500 mt-1">Out of 100</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-gray-600">Success Rate</p>
              <CheckCircle2 className="w-5 h-5 text-blue-600" />
            </div>
            <p className="text-3xl font-bold">{modelMetrics.successRate}%</p>
            <p className="text-xs text-gray-500 mt-1">Last 100 calls</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-gray-600">Avg Response</p>
              <Zap className="w-5 h-5 text-yellow-600" />
            </div>
            <p className="text-3xl font-bold">{modelMetrics.avgResponseTime}ms</p>
            <p className="text-xs text-gray-500 mt-1">Processing time</p>
          </CardContent>
        </Card>
      </div>

      {/* Performance Trend */}
      <Card>
        <CardHeader>
          <CardTitle>Model Performance Trends</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={performanceTrend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="avgQuality" stroke="#3B82F6" name="Quality Score" />
              <Line type="monotone" dataKey="avgCompliance" stroke="#10B981" name="Compliance Score" />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Model Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5" />
            Model Configuration & Tuning
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs value={activeModel} onValueChange={setActiveModel}>
            <TabsList className="grid w-full grid-cols-4">
              {models.map(model => (
                <TabsTrigger key={model.id} value={model.id}>
                  <model.icon className="w-4 h-4 mr-2" />
                  {model.name.split(' ')[0]}
                </TabsTrigger>
              ))}
            </TabsList>

            {models.map(model => (
              <TabsContent key={model.id} value={model.id} className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold mb-2">{model.name}</h3>
                  <p className="text-gray-600">{model.description}</p>
                </div>

                <Alert>
                  <AlertCircle className="w-4 h-4" />
                  <AlertDescription>
                    Changes to model configuration will affect all future AI operations. Test thoroughly before saving.
                  </AlertDescription>
                </Alert>

                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Model Status</Label>
                      <p className="text-sm text-gray-500">Enable or disable this model</p>
                    </div>
                    <Switch 
                      checked={tempConfig.models?.[model.id]?.enabled ?? true}
                      onCheckedChange={(checked) => updateModelConfig(model.id, { enabled: checked })}
                    />
                  </div>

                  <div>
                    <Label>Temperature: {tempConfig.models?.[model.id]?.temperature ?? 0.7}</Label>
                    <p className="text-sm text-gray-500 mb-2">Controls randomness (0-1). Higher = more creative</p>
                    <Slider
                      value={[tempConfig.models?.[model.id]?.temperature ?? 0.7]}
                      onValueChange={([value]) => updateModelConfig(model.id, { temperature: value })}
                      max={1}
                      step={0.1}
                      className="w-full"
                    />
                  </div>

                  <div>
                    <Label>Max Tokens: {tempConfig.models?.[model.id]?.maxTokens ?? 2000}</Label>
                    <p className="text-sm text-gray-500 mb-2">Maximum response length</p>
                    <Slider
                      value={[tempConfig.models?.[model.id]?.maxTokens ?? 2000]}
                      onValueChange={([value]) => updateModelConfig(model.id, { maxTokens: value })}
                      min={500}
                      max={4000}
                      step={100}
                      className="w-full"
                    />
                  </div>

                  <div>
                    <Label>Quality Threshold: {tempConfig.models?.[model.id]?.qualityThreshold ?? 70}</Label>
                    <p className="text-sm text-gray-500 mb-2">Minimum acceptable quality score</p>
                    <Slider
                      value={[tempConfig.models?.[model.id]?.qualityThreshold ?? 70]}
                      onValueChange={([value]) => updateModelConfig(model.id, { qualityThreshold: value })}
                      max={100}
                      step={5}
                      className="w-full"
                    />
                  </div>

                  <div>
                    <Label htmlFor={`prompt-${model.id}`}>System Prompt</Label>
                    <p className="text-sm text-gray-500 mb-2">Instructions that guide the model's behavior</p>
                    <textarea
                      id={`prompt-${model.id}`}
                      value={tempConfig.models?.[model.id]?.systemPrompt ?? getDefaultPrompt(model.id)}
                      onChange={(e) => updateModelConfig(model.id, { systemPrompt: e.target.value })}
                      rows={6}
                      className="w-full p-3 border rounded-md font-mono text-sm"
                    />
                  </div>
                </div>
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

function createDefaultConfig() {
  return {
    models: {
      'note-enhancement': {
        enabled: true,
        temperature: 0.7,
        maxTokens: 2000,
        qualityThreshold: 70,
        systemPrompt: getDefaultPrompt('note-enhancement')
      },
      'compliance-checker': {
        enabled: true,
        temperature: 0.3,
        maxTokens: 1500,
        qualityThreshold: 85,
        systemPrompt: getDefaultPrompt('compliance-checker')
      },
      'risk-predictor': {
        enabled: true,
        temperature: 0.5,
        maxTokens: 1000,
        qualityThreshold: 75,
        systemPrompt: getDefaultPrompt('risk-predictor')
      },
      'care-plan-generator': {
        enabled: true,
        temperature: 0.6,
        maxTokens: 2500,
        qualityThreshold: 70,
        systemPrompt: getDefaultPrompt('care-plan-generator')
      }
    }
  };
}

function getDefaultPrompt(modelId) {
  const prompts = {
    'note-enhancement': 'You are a clinical documentation expert specializing in Medicare-compliant nursing notes. Transform rough notes into clear, comprehensive documentation...',
    'compliance-checker': 'You are a Medicare compliance auditor. Review documentation for completeness, accuracy, and adherence to CMS guidelines...',
    'risk-predictor': 'You are a clinical risk assessment specialist. Analyze patient data to identify potential adverse events and readmission risks...',
    'care-plan-generator': 'You are a care plan specialist. Create comprehensive, evidence-based care plans with measurable goals and appropriate interventions...'
  };
  return prompts[modelId] || '';
}