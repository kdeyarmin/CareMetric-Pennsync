import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { 
  Brain, 
  Plus, 
  Save, 
  Trash2, 
  Copy, 
  TrendingUp,
  AlertCircle,
  TestTube,
  BarChart3,
  Trophy
} from "lucide-react";
import { toast } from "sonner";
import ABTestComparison from "./ABTestComparison";

export default function AIModelConfigurationManager() {
  const [selectedConfig, setSelectedConfig] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const queryClient = useQueryClient();

  const { data: configurations = [] } = useQuery({
    queryKey: ['aiModelConfigurations'],
    queryFn: () => base44.entities.AIModelConfiguration.list('-created_date')
  });

  const { data: testResults = [] } = useQuery({
    queryKey: ['aiTestResults'],
    queryFn: () => base44.entities.AIModelTestResult.list('-created_date', 100)
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.AIModelConfiguration.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['aiModelConfigurations']);
      toast.success('Configuration created');
      setEditMode(false);
      setSelectedConfig(null);
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.AIModelConfiguration.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['aiModelConfigurations']);
      toast.success('Configuration updated');
      setEditMode(false);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.AIModelConfiguration.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['aiModelConfigurations']);
      toast.success('Configuration deleted');
      setSelectedConfig(null);
    }
  });

  const handleClone = async (config) => {
    const newConfig = {
      ...config,
      version: (config.version || 1) + 1,
      is_active: false,
      is_ab_test: false
    };
    delete newConfig.id;
    delete newConfig.created_date;
    delete newConfig.updated_date;
    delete newConfig.performance_metrics;
    
    try {
      await base44.entities.AIModelConfiguration.create(newConfig);
      queryClient.invalidateQueries(['aiModelConfigurations']);
      toast.success('Configuration cloned');
    } catch (error) {
      toast.error('Failed to clone configuration');
    }
  };

  // Group configurations by provider and task
  const groupedConfigs = configurations.reduce((acc, config) => {
    const key = `${config.provider_type}-${config.task_type}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(config);
    return acc;
  }, {});

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Brain className="w-8 h-8" />
            AI Model Configuration & A/B Testing
          </h1>
          <p className="text-gray-600 mt-1">
            Fine-tune AI models per provider type and task. Run A/B tests to optimize performance.
          </p>
        </div>
        <Button 
          onClick={() => {
            setSelectedConfig(null);
            setEditMode(true);
          }}
          className="gap-2"
        >
          <Plus className="w-4 h-4" />
          New Configuration
        </Button>
      </div>

      <Tabs defaultValue="configurations" className="w-full">
        <TabsList>
          <TabsTrigger value="configurations">Configurations</TabsTrigger>
          <TabsTrigger value="testing">A/B Testing</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="configurations" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Configuration List */}
            <Card className="lg:col-span-1">
              <CardHeader>
                <CardTitle className="text-lg">Configurations ({configurations.length})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 max-h-[600px] overflow-y-auto">
                {Object.entries(groupedConfigs).map(([key, configs]) => {
                  const [provider, task] = key.split('-');
                  return (
                    <div key={key} className="border rounded p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <Badge>{provider}</Badge>
                        <span className="text-xs text-gray-600">{task}</span>
                      </div>
                      {configs.map(config => (
                        <Button
                          key={config.id}
                          variant={selectedConfig?.id === config.id ? "default" : "outline"}
                          size="sm"
                          className="w-full justify-between"
                          onClick={() => {
                            setSelectedConfig(config);
                            setEditMode(false);
                          }}
                        >
                          <span>v{config.version}</span>
                          <div className="flex gap-1">
                            {config.is_active && <Badge variant="default" className="text-xs">Active</Badge>}
                            {config.is_ab_test && <Badge variant="secondary" className="text-xs">{config.ab_test_group}</Badge>}
                          </div>
                        </Button>
                      ))}
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            {/* Editor */}
            <Card className="lg:col-span-2">
              {!selectedConfig && !editMode ? (
                <CardContent className="flex flex-col items-center justify-center h-96 text-gray-500">
                  <Brain className="w-16 h-16 mb-4 text-gray-300" />
                  <p>Select a configuration or create a new one</p>
                </CardContent>
              ) : (
                <ConfigurationEditor
                  config={selectedConfig}
                  editMode={editMode}
                  onSave={(data) => {
                    if (selectedConfig?.id) {
                      updateMutation.mutate({ id: selectedConfig.id, data });
                    } else {
                      createMutation.mutate(data);
                    }
                  }}
                  onCancel={() => {
                    setEditMode(false);
                    setSelectedConfig(null);
                  }}
                  onDelete={() => {
                    if (window.confirm('Delete this configuration?')) {
                      deleteMutation.mutate(selectedConfig.id);
                    }
                  }}
                  onEdit={() => setEditMode(true)}
                  onClone={() => handleClone(selectedConfig)}
                />
              )}
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="testing" className="space-y-6">
          <ABTestingManager configurations={configurations} testResults={testResults} />
        </TabsContent>

        <TabsContent value="analytics">
          <ConfigurationAnalytics configurations={configurations} testResults={testResults} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ConfigurationEditor({ config, editMode, onSave, onCancel, onDelete, onEdit, onClone }) {
  const [formData, setFormData] = useState(config || {
    provider_type: "",
    task_type: "",
    version: 1,
    model: "gpt-4o",
    temperature: 0.3,
    max_tokens: 2500,
    system_prompt: "",
    is_active: true,
    is_ab_test: false,
    ab_test_group: "A",
    ab_test_weight: 50,
    notes: ""
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(formData);
  };

  const providerTypes = ["RN", "LPN", "NP", "MD", "DO", "PT", "OT", "ST", "MSW", "Chiropractor"];
  const taskTypes = ["note_enhancement", "compliance_check", "clinical_decision", "patient_education", "care_plan", "risk_analysis", "documentation", "general_chat"];

  return (
    <form onSubmit={handleSubmit}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>
              {editMode ? (config ? `Edit Configuration v${config.version}` : 'New Configuration') : `Configuration v${formData.version}`}
            </CardTitle>
            {config?.performance_metrics && (
              <div className="flex gap-2 mt-2">
                <Badge variant="outline">Uses: {config.performance_metrics.total_uses || 0}</Badge>
                {config.performance_metrics.avg_quality_score && (
                  <Badge variant="outline">Quality: {config.performance_metrics.avg_quality_score.toFixed(1)}</Badge>
                )}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            {!editMode && (
              <>
                <Button type="button" variant="outline" onClick={onEdit}>Edit</Button>
                <Button type="button" variant="outline" onClick={onClone}>
                  <Copy className="w-4 h-4 mr-1" />
                  Clone
                </Button>
                <Button type="button" variant="destructive" onClick={onDelete}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Provider Type</Label>
            <Select
              value={formData.provider_type}
              onValueChange={(value) => setFormData({ ...formData, provider_type: value })}
              disabled={!editMode}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select provider..." />
              </SelectTrigger>
              <SelectContent>
                {providerTypes.map(type => (
                  <SelectItem key={type} value={type}>{type}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Task Type</Label>
            <Select
              value={formData.task_type}
              onValueChange={(value) => setFormData({ ...formData, task_type: value })}
              disabled={!editMode}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select task..." />
              </SelectTrigger>
              <SelectContent>
                {taskTypes.map(type => (
                  <SelectItem key={type} value={type}>{type.replace(/_/g, ' ')}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <Label>Version</Label>
            <Input
              type="number"
              value={formData.version}
              onChange={(e) => setFormData({ ...formData, version: parseInt(e.target.value) })}
              disabled={!editMode}
            />
          </div>

          <div>
            <Label>Temperature</Label>
            <Input
              type="number"
              step="0.1"
              min="0"
              max="2"
              value={formData.temperature}
              onChange={(e) => setFormData({ ...formData, temperature: parseFloat(e.target.value) })}
              disabled={!editMode}
            />
          </div>

          <div>
            <Label>Max Tokens</Label>
            <Input
              type="number"
              value={formData.max_tokens}
              onChange={(e) => setFormData({ ...formData, max_tokens: parseInt(e.target.value) })}
              disabled={!editMode}
            />
          </div>
        </div>

        <div>
          <Label>System Prompt</Label>
          <Textarea
            value={formData.system_prompt}
            onChange={(e) => setFormData({ ...formData, system_prompt: e.target.value })}
            disabled={!editMode}
            rows={6}
            placeholder="Custom system prompt for this configuration..."
          />
        </div>

        <div className="border-t pt-4 space-y-4">
          <h3 className="font-semibold flex items-center gap-2">
            <TestTube className="w-4 h-4" />
            A/B Testing Configuration
          </h3>

          <div className="flex items-center justify-between">
            <Label htmlFor="is_ab_test">Enable A/B Testing</Label>
            <Switch
              id="is_ab_test"
              checked={formData.is_ab_test}
              onCheckedChange={(checked) => setFormData({ ...formData, is_ab_test: checked })}
              disabled={!editMode}
            />
          </div>

          {formData.is_ab_test && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Test Group</Label>
                  <Select
                    value={formData.ab_test_group}
                    onValueChange={(value) => setFormData({ ...formData, ab_test_group: value })}
                    disabled={!editMode}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="A">Group A</SelectItem>
                      <SelectItem value="B">Group B</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Traffic Weight (%)</Label>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    value={formData.ab_test_weight}
                    onChange={(e) => setFormData({ ...formData, ab_test_weight: parseInt(e.target.value) })}
                    disabled={!editMode}
                  />
                </div>
              </div>

              <div>
                <Label>Test Hypothesis</Label>
                <Textarea
                  value={formData.test_hypothesis}
                  onChange={(e) => setFormData({ ...formData, test_hypothesis: e.target.value })}
                  disabled={!editMode}
                  rows={3}
                  placeholder="What are you testing with this configuration?"
                />
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-between border-t pt-4">
          <Label htmlFor="is_active">Active Configuration</Label>
          <Switch
            id="is_active"
            checked={formData.is_active}
            onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
            disabled={!editMode}
          />
        </div>

        {editMode && (
          <div className="flex gap-2 pt-4">
            <Button type="submit" className="flex-1">
              <Save className="w-4 h-4 mr-2" />
              Save Configuration
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

function ABTestingManager({ configurations, testResults }) {
  const activeTests = configurations.filter(c => c.is_ab_test && c.is_active);
  
  // Group tests by provider/task pair
  const testPairs = {};
  activeTests.forEach(test => {
    const key = `${test.provider_type}-${test.task_type}`;
    if (!testPairs[key]) testPairs[key] = [];
    testPairs[key].push(test);
  });

  // Only show pairs with both A and B
  const completePairs = Object.entries(testPairs).filter(([_, tests]) => 
    tests.some(t => t.ab_test_group === 'A') && tests.some(t => t.ab_test_group === 'B')
  );
  
  return (
    <div className="space-y-4">
      <Alert>
        <TestTube className="w-4 h-4" />
        <AlertDescription>
          {completePairs.length} active A/B test pair(s) running. Results are automatically tracked and analyzed.
        </AlertDescription>
      </Alert>

      {completePairs.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center text-gray-500">
            <TestTube className="w-16 h-16 mx-auto mb-4 text-gray-300" />
            <p>No active A/B test pairs. Create two configurations (Group A and B) with same provider/task.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {completePairs.map(([key, tests]) => {
            const [providerType, taskType] = key.split('-');
            const groupAConfig = tests.find(t => t.ab_test_group === 'A');
            const groupBConfig = tests.find(t => t.ab_test_group === 'B');

            const resultsA = testResults.filter(r => r.configuration_id === groupAConfig.id);
            const resultsB = testResults.filter(r => r.configuration_id === groupBConfig.id);

            const metricsA = calculateTestMetrics(resultsA);
            const metricsB = calculateTestMetrics(resultsB);

            const winner = determineTestWinner(metricsA, metricsB);

            return (
              <Card key={key} className="border-2 border-purple-300">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span>{providerType} - {taskType.replace(/_/g, ' ')}</span>
                    {winner && (
                      <Badge className="bg-green-600">Group {winner} Leading</Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    {/* Group A Stats */}
                    <div className={`p-4 rounded-lg border-2 ${winner === 'A' ? 'border-green-400 bg-green-50' : 'border-gray-300'}`}>
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-semibold">Group A</h4>
                        <Badge variant="outline">n={resultsA.length}</Badge>
                      </div>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-600">Quality</span>
                          <span className="font-semibold">{metricsA.quality.toFixed(1)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Compliance</span>
                          <span className="font-semibold">{metricsA.compliance.toFixed(1)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Success</span>
                          <span className="font-semibold">{metricsA.successRate.toFixed(1)}%</span>
                        </div>
                      </div>
                    </div>

                    {/* Group B Stats */}
                    <div className={`p-4 rounded-lg border-2 ${winner === 'B' ? 'border-green-400 bg-green-50' : 'border-gray-300'}`}>
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-semibold">Group B</h4>
                        <Badge variant="outline">n={resultsB.length}</Badge>
                      </div>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-600">Quality</span>
                          <span className="font-semibold">{metricsB.quality.toFixed(1)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Compliance</span>
                          <span className="font-semibold">{metricsB.compliance.toFixed(1)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Success</span>
                          <span className="font-semibold">{metricsB.successRate.toFixed(1)}%</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Test Hypothesis */}
                  {groupAConfig.test_hypothesis && (
                    <Alert className="bg-blue-50 border-blue-200">
                      <AlertDescription className="text-sm">
                        <span className="font-semibold">Hypothesis:</span> {groupAConfig.test_hypothesis}
                      </AlertDescription>
                    </Alert>
                  )}

                  {/* Recommendation */}
                  {winner && (
                    <Alert className="bg-green-50 border-green-300">
                      <Trophy className="w-4 h-4 text-green-600" />
                      <AlertDescription className="text-sm text-green-900">
                        Group {winner} shows {Math.abs(metricsB.quality - metricsA.quality).toFixed(1)} point improvement in quality.
                        Consider promoting to production after reviewing results.
                      </AlertDescription>
                    </Alert>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function calculateTestMetrics(results) {
  if (results.length === 0) return { quality: 0, compliance: 0, successRate: 0 };
  
  return {
    quality: results.reduce((sum, r) => sum + (r.quality_score || 0), 0) / results.length,
    compliance: results.reduce((sum, r) => sum + (r.compliance_score || 0), 0) / results.length,
    successRate: (results.filter(r => r.success).length / results.length) * 100
  };
}

function determineTestWinner(metricsA, metricsB) {
  const scoreA = (metricsA.quality * 0.5) + (metricsA.compliance * 0.5);
  const scoreB = (metricsB.quality * 0.5) + (metricsB.compliance * 0.5);
  
  if (Math.abs(scoreA - scoreB) < 2) return null;
  return scoreA > scoreB ? 'A' : 'B';
}

function ConfigurationAnalytics({ configurations, testResults }) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5" />
            Performance Overview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-3xl font-bold">{configurations.length}</p>
              <p className="text-sm text-gray-600">Total Configurations</p>
            </div>
            <div>
              <p className="text-3xl font-bold">{configurations.filter(c => c.is_active).length}</p>
              <p className="text-sm text-gray-600">Active</p>
            </div>
            <div>
              <p className="text-3xl font-bold">{testResults.length}</p>
              <p className="text-sm text-gray-600">Test Results</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4">
        {configurations
          .filter(c => c.performance_metrics?.total_uses > 0)
          .sort((a, b) => (b.performance_metrics?.total_uses || 0) - (a.performance_metrics?.total_uses || 0))
          .slice(0, 10)
          .map(config => (
            <Card key={config.id}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Badge>{config.provider_type}</Badge>
                    <span className="text-sm">{config.task_type.replace(/_/g, ' ')}</span>
                    <Badge variant="outline">v{config.version}</Badge>
                  </div>
                  {config.is_ab_test && <Badge variant="secondary">{config.ab_test_group}</Badge>}
                </div>
                <div className="grid grid-cols-4 gap-4 text-sm">
                  <div>
                    <p className="font-bold">{config.performance_metrics.total_uses}</p>
                    <p className="text-xs text-gray-600">Uses</p>
                  </div>
                  <div>
                    <p className="font-bold">{config.performance_metrics.avg_quality_score?.toFixed(1) || 'N/A'}</p>
                    <p className="text-xs text-gray-600">Quality</p>
                  </div>
                  <div>
                    <p className="font-bold">{config.performance_metrics.avg_compliance_score?.toFixed(1) || 'N/A'}</p>
                    <p className="text-xs text-gray-600">Compliance</p>
                  </div>
                  <div>
                    <p className="font-bold">{((config.performance_metrics.success_rate || 1) * 100).toFixed(0)}%</p>
                    <p className="text-xs text-gray-600">Success Rate</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
      </div>
    </div>
  );
}