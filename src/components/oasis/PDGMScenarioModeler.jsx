import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Lightbulb,
  Play,
  Save,
  Trash2,
  Copy,
  TrendingUp,
  TrendingDown,
  ArrowRight,
  Loader2,
  BarChart3,
  DollarSign,
  Activity,
  FileText,
  Target
} from "lucide-react";

export default function PDGMScenarioModeler({ baselineOasisData, baselineNavigationData, patientId }) {
  const [currentScenario, setCurrentScenario] = useState({
    name: 'Baseline',
    functional_scores: baselineOasisData?.functional_scores || {},
    comorbidities: baselineOasisData?.comorbidities || [],
    admission_source: baselineOasisData?.admission_source || 'community',
    episode_timing: baselineOasisData?.episode_timing || 'early',
    clinical_items: baselineOasisData?.clinical_items || {}
  });
  
  const [scenarios, setScenarios] = useState([]);
  const ai = useAICall();
  const [simulationResult, setSimulationResult] = useState(null);
  const [_compareMode, _setCompareMode] = useState(false);
  const [selectedScenarios, setSelectedScenarios] = useState([]);
  const [newComorbidity, setNewComorbidity] = useState('');

  const queryClient = useQueryClient();

  const saveScenarioMutation = useMutation({
    mutationFn: (data) => base44.entities.OASISScenario.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['oasisScenarios'] });
    },
  });

  const runSimulation = async () => {
    try {
      const prompt = `You are a PDGM payment expert. Simulate the impact of these OASIS changes on case-mix weight, payment, and quality measures.

BASELINE DATA:
${JSON.stringify({
  functional_scores: baselineOasisData?.functional_scores,
  comorbidities: baselineOasisData?.comorbidities,
  admission_source: baselineOasisData?.admission_source,
  episode_timing: baselineOasisData?.episode_timing,
  baseline_payment: baselineNavigationData?.case_mix_calculation?.calculated_payment || 2038.22
}, null, 2)}

SIMULATED SCENARIO:
${JSON.stringify(currentScenario, null, 2)}

CALCULATE:
1. New functional impairment level and points
2. New comorbidity adjustment level
3. New case-mix weight
4. New payment amount
5. Payment difference from baseline
6. Quality measure impact predictions
7. Clinical appropriateness of changes

Provide detailed comparison showing what changed and why.`;

      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            functional_analysis: {
              type: "object",
              properties: {
                total_points: { type: "number" },
                functional_level: { type: "string" },
                points_change: { type: "number" },
                level_change: { type: "string" },
                key_drivers: { type: "array", items: { type: "string" } }
              }
            },
            comorbidity_analysis: {
              type: "object",
              properties: {
                adjustment_level: { type: "string" },
                high_value_count: { type: "number" },
                change_from_baseline: { type: "string" },
                impact_explanation: { type: "string" }
              }
            },
            payment_impact: {
              type: "object",
              properties: {
                baseline_payment: { type: "number" },
                simulated_payment: { type: "number" },
                payment_difference: { type: "number" },
                percentage_change: { type: "number" },
                case_mix_weight: { type: "number" },
                weight_change: { type: "number" }
              }
            },
            quality_impact: {
              type: "object",
              properties: {
                improvement_measures_affected: { type: "array", items: { type: "string" } },
                predicted_star_rating_impact: { type: "string" },
                quality_score_change: { type: "string" }
              }
            },
            clinical_appropriateness: {
              type: "object",
              properties: {
                is_clinically_appropriate: { type: "boolean" },
                concerns: { type: "array", items: { type: "string" } },
                justification_needed: { type: "array", items: { type: "string" } }
              }
            },
            recommendations: { type: "array", items: { type: "string" } }
          }
        }
      });

      setSimulationResult(result);
    } catch (error) {
      console.error('Simulation error:', error);
      toast.error("The AI request didn't complete. Please try again.");
    }
  };

  const updateFunctionalScore = (mItem, value) => {
    setCurrentScenario(prev => ({
      ...prev,
      functional_scores: {
        ...prev.functional_scores,
        [mItem]: parseInt(value)
      }
    }));
  };

  const addComorbidity = () => {
    if (newComorbidity.trim()) {
      setCurrentScenario(prev => ({
        ...prev,
        comorbidities: [...prev.comorbidities, newComorbidity.trim()]
      }));
      setNewComorbidity('');
    }
  };

  const removeComorbidity = (index) => {
    setCurrentScenario(prev => ({
      ...prev,
      comorbidities: prev.comorbidities.filter((_, i) => i !== index)
    }));
  };

  const saveScenario = () => {
    const scenarioToSave = {
      patient_id: patientId,
      scenario_name: currentScenario.name,
      scenario_data: currentScenario,
      simulation_result: simulationResult,
      baseline_payment: baselineNavigationData?.case_mix_calculation?.calculated_payment,
      simulated_payment: simulationResult?.payment_impact?.simulated_payment
    };

    saveScenarioMutation.mutate(scenarioToSave);
    setScenarios(prev => [...prev, { ...scenarioToSave, id: Date.now() }]);
  };

  const loadScenario = (scenario) => {
    setCurrentScenario(scenario.scenario_data);
    setSimulationResult(scenario.simulation_result);
  };

  const deleteScenario = (index) => {
    setScenarios(prev => prev.filter((_, i) => i !== index));
  };

  const toggleCompareScenario = (scenario) => {
    setSelectedScenarios(prev => {
      const exists = prev.find(s => s.id === scenario.id);
      if (exists) {
        return prev.filter(s => s.id !== scenario.id);
      }
      return [...prev, scenario].slice(-3); // Max 3 scenarios
    });
  };

  const functionalItems = [
    { key: 'm1800_grooming', label: 'M1800 Grooming', max: 3 },
    { key: 'm1810_dress_upper', label: 'M1810 Upper Dressing', max: 3 },
    { key: 'm1820_dress_lower', label: 'M1820 Lower Dressing', max: 3 },
    { key: 'm1830_bathing', label: 'M1830 Bathing', max: 6 },
    { key: 'm1840_toilet_transfer', label: 'M1840 Toilet Transfer', max: 4 },
    { key: 'm1850_transferring', label: 'M1850 Transferring', max: 5 },
    { key: 'm1860_ambulation', label: 'M1860 Ambulation', max: 6 }
  ];

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount || 0);
  };

  return (
    <Card className="border-2 border-navy-400 shadow-lg">
      <CardHeader className="bg-gradient-to-r from-navy-50 to-blue-50">
        <CardTitle className="flex items-center gap-2">
          <Lightbulb className="w-6 h-6 text-navy-600" />
          PDGM Scenario Modeler
        </CardTitle>
      </CardHeader>

      <CardContent className="pt-6">
        <Tabs defaultValue="modeler" className="space-y-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="modeler">Scenario Builder</TabsTrigger>
            <TabsTrigger value="saved">
              Saved Scenarios ({scenarios.length})
            </TabsTrigger>
            <TabsTrigger value="compare">Compare</TabsTrigger>
          </TabsList>

          {/* Scenario Builder */}
          <TabsContent value="modeler" className="space-y-4">
            <div className="bg-white p-4 rounded-lg border">
              <Label className="mb-2 block">Scenario Name</Label>
              <Input
                value={currentScenario.name}
                onChange={(e) => setCurrentScenario(prev => ({ ...prev, name: e.target.value }))}
                placeholder="e.g., Improved Functional Scores"
              />
            </div>

            {/* Functional Scores */}
            <Card className="border-navy-200">
              <CardHeader className="pb-3 bg-navy-50">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Activity className="w-4 h-4 text-navy-600" />
                  Functional Scores
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="space-y-3">
                  {functionalItems.map(item => (
                    <div key={item.key} className="flex items-center gap-3">
                      <Label className="text-xs flex-1">{item.label}</Label>
                      <div className="flex items-center gap-2 flex-1">
                        <Slider
                          value={[currentScenario.functional_scores?.[item.key] || 0]}
                          onValueChange={([value]) => updateFunctionalScore(item.key, value)}
                          max={item.max}
                          step={1}
                          className="flex-1"
                        />
                        <Badge variant="outline" className="w-12 text-center">
                          {currentScenario.functional_scores?.[item.key] || 0}/{item.max}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Admission Source & Timing */}
            <Card className="border-orange-200">
              <CardHeader className="pb-3 bg-orange-50">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Target className="w-4 h-4 text-orange-600" />
                  Admission & Episode
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs mb-2 block">Admission Source</Label>
                    <Select
                      value={currentScenario.admission_source}
                      onValueChange={(value) => setCurrentScenario(prev => ({ ...prev, admission_source: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="community">Community</SelectItem>
                        <SelectItem value="institutional">Institutional</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs mb-2 block">Episode Timing</Label>
                    <Select
                      value={currentScenario.episode_timing}
                      onValueChange={(value) => setCurrentScenario(prev => ({ ...prev, episode_timing: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="early">Early (0-30 days)</SelectItem>
                        <SelectItem value="late">Late (31+ days)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Comorbidities */}
            <Card className="border-green-200">
              <CardHeader className="pb-3 bg-green-50">
                <CardTitle className="text-sm flex items-center gap-2">
                  <FileText className="w-4 h-4 text-green-600" />
                  Comorbidities
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="flex gap-2 mb-3">
                  <Input
                    value={newComorbidity}
                    onChange={(e) => setNewComorbidity(e.target.value)}
                    placeholder="Add comorbidity (e.g., I10 Hypertension)"
                    onKeyPress={(e) => e.key === 'Enter' && addComorbidity()}
                  />
                  <Button onClick={addComorbidity} size="sm">Add</Button>
                </div>
                <ScrollArea className="max-h-40">
                  <div className="space-y-1">
                    {currentScenario.comorbidities?.map((comorbidity, idx) => (
                      <div key={idx} className="flex items-center justify-between bg-green-50 p-2 rounded border">
                        <span className="text-sm">{comorbidity}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeComorbidity(idx)}
                          className="h-6 w-6 p-0"
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>

            {/* Simulation Controls */}
            <div className="flex gap-2">
              <Button
                onClick={runSimulation}
                disabled={ai.loading}
                className="flex-1 bg-navy-600 hover:bg-navy-700"
              >
                {ai.loading ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Simulating...</>
                ) : (
                  <><Play className="w-4 h-4 mr-2" /> Run Simulation</>
                )}
              </Button>
              {simulationResult && (
                <Button
                  onClick={saveScenario}
                  disabled={saveScenarioMutation.isPending}
                  variant="outline"
                >
                  <Save className="w-4 h-4 mr-2" />
                  Save Scenario
                </Button>
              )}
            </div>

            {/* Simulation Results */}
            {simulationResult && (
              <div className="space-y-4 pt-4 border-t">
                <h3 className="font-semibold text-lg">Simulation Results</h3>

                {/* Payment Impact */}
                <Card className="border-2 border-green-400">
                  <CardHeader className="pb-3 bg-green-50">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <DollarSign className="w-4 h-4 text-green-600" />
                      Payment Impact
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-4">
                    <div className="grid grid-cols-3 gap-3 mb-4">
                      <div className="text-center p-3 bg-slate-50 rounded border">
                        <p className="text-xs text-slate-600 mb-1">Baseline</p>
                        <p className="text-xl font-bold text-slate-700">
                          {formatCurrency(simulationResult.payment_impact?.baseline_payment)}
                        </p>
                      </div>
                      <div className="flex items-center justify-center">
                        <ArrowRight className="w-6 h-6 text-navy-600" />
                      </div>
                      <div className="text-center p-3 bg-green-50 rounded border-2 border-green-400">
                        <p className="text-xs text-green-600 mb-1">Simulated</p>
                        <p className="text-xl font-bold text-green-700">
                          {formatCurrency(simulationResult.payment_impact?.simulated_payment)}
                        </p>
                      </div>
                    </div>

                    <div className="bg-gradient-to-r from-green-100 to-emerald-100 p-4 rounded-lg border-2 border-green-400">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs text-green-700">Payment Change</p>
                          <p className="text-3xl font-bold text-green-800 flex items-center gap-2">
                            {simulationResult.payment_impact?.payment_difference >= 0 ? (
                              <TrendingUp className="w-6 h-6" />
                            ) : (
                              <TrendingDown className="w-6 h-6" />
                            )}
                            {formatCurrency(Math.abs(simulationResult.payment_impact?.payment_difference))}
                          </p>
                        </div>
                        <Badge className={
                          simulationResult.payment_impact?.percentage_change >= 0
                            ? 'bg-green-600 text-white text-lg'
                            : 'bg-red-600 text-white text-lg'
                        }>
                          {simulationResult.payment_impact?.percentage_change > 0 ? '+' : ''}
                          {simulationResult.payment_impact?.percentage_change?.toFixed(1)}%
                        </Badge>
                      </div>
                      <div className="mt-2 text-xs text-green-700">
                        Case-Mix Weight: {simulationResult.payment_impact?.case_mix_weight?.toFixed(4)} 
                        ({simulationResult.payment_impact?.weight_change >= 0 ? '+' : ''}
                        {simulationResult.payment_impact?.weight_change?.toFixed(4)})
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Functional Analysis */}
                <Card className="border-2 border-navy-400">
                  <CardHeader className="pb-3 bg-navy-50">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Activity className="w-4 h-4 text-navy-600" />
                      Functional Impact
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-4">
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div className="text-center p-3 bg-white rounded border">
                        <p className="text-xs text-slate-600">Total Points</p>
                        <p className="text-2xl font-bold text-navy-700">
                          {simulationResult.functional_analysis?.total_points}
                        </p>
                        <Badge variant="outline" className="text-xs mt-1">
                          {simulationResult.functional_analysis?.points_change >= 0 ? '+' : ''}
                          {simulationResult.functional_analysis?.points_change} pts
                        </Badge>
                      </div>
                      <div className="text-center p-3 bg-white rounded border">
                        <p className="text-xs text-slate-600">Functional Level</p>
                        <Badge className={
                          simulationResult.functional_analysis?.functional_level === 'high' ? 'bg-green-600' :
                          simulationResult.functional_analysis?.functional_level === 'medium' ? 'bg-yellow-600' :
                          'bg-blue-600'
                        } size="lg">
                          {simulationResult.functional_analysis?.functional_level}
                        </Badge>
                        {simulationResult.functional_analysis?.level_change && (
                          <p className="text-xs text-slate-600 mt-1">
                            {simulationResult.functional_analysis.level_change}
                          </p>
                        )}
                      </div>
                    </div>

                    {simulationResult.functional_analysis?.key_drivers?.length > 0 && (
                      <div className="bg-navy-50 p-2 rounded border border-navy-200">
                        <p className="text-xs text-navy-700 font-semibold mb-1">Key Drivers:</p>
                        <ul className="text-xs text-navy-800 space-y-1">
                          {simulationResult.functional_analysis.key_drivers.map((driver, i) => (
                            <li key={i}>• {driver}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Comorbidity Analysis */}
                <Card className="border-2 border-blue-400">
                  <CardHeader className="pb-3 bg-blue-50">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <FileText className="w-4 h-4 text-blue-600" />
                      Comorbidity Impact
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-4">
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div className="text-center p-3 bg-white rounded border">
                        <p className="text-xs text-slate-600">Adjustment Level</p>
                        <Badge className={
                          simulationResult.comorbidity_analysis?.adjustment_level === 'high' ? 'bg-green-600' :
                          simulationResult.comorbidity_analysis?.adjustment_level === 'low' ? 'bg-yellow-600' :
                          'bg-slate-600'
                        } size="lg">
                          {simulationResult.comorbidity_analysis?.adjustment_level}
                        </Badge>
                      </div>
                      <div className="text-center p-3 bg-white rounded border">
                        <p className="text-xs text-slate-600">High-Value Count</p>
                        <p className="text-2xl font-bold text-blue-700">
                          {simulationResult.comorbidity_analysis?.high_value_count}
                        </p>
                      </div>
                    </div>

                    <div className="bg-blue-50 p-3 rounded border border-blue-200">
                      <p className="text-xs text-blue-700 font-semibold mb-1">Change from Baseline:</p>
                      <p className="text-sm text-blue-800">{simulationResult.comorbidity_analysis?.change_from_baseline}</p>
                      <p className="text-xs text-slate-600 mt-2">{simulationResult.comorbidity_analysis?.impact_explanation}</p>
                    </div>
                  </CardContent>
                </Card>

                {/* Quality Impact */}
                {simulationResult.quality_impact && (
                  <Card className="border-2 border-indigo-400">
                    <CardHeader className="pb-3 bg-indigo-50">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <TrendingUp className="w-4 h-4 text-indigo-600" />
                        Quality Measure Impact
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-4">
                      {simulationResult.quality_impact.improvement_measures_affected?.length > 0 && (
                        <div className="bg-navy-50 p-3 rounded border border-navy-200 mb-3">
                          <p className="text-xs text-navy-700 font-semibold mb-2">Affected Measures:</p>
                          <ul className="space-y-1">
                            {simulationResult.quality_impact.improvement_measures_affected.map((measure, i) => (
                              <li key={i} className="text-sm text-navy-800">• {measure}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      <div className="bg-indigo-50 p-3 rounded border border-indigo-200">
                        <p className="text-xs text-indigo-700 font-semibold mb-1">⭐ STAR Rating Impact:</p>
                        <p className="text-sm text-indigo-800">{simulationResult.quality_impact.predicted_star_rating_impact}</p>
                      </div>

                      {simulationResult.quality_impact.quality_score_change && (
                        <Alert className="mt-3 bg-blue-50 border-blue-200">
                          <AlertDescription className="text-sm text-blue-900">
                            {simulationResult.quality_impact.quality_score_change}
                          </AlertDescription>
                        </Alert>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Clinical Appropriateness */}
                {simulationResult.clinical_appropriateness && (
                  <Alert className={
                    simulationResult.clinical_appropriateness.is_clinically_appropriate
                      ? 'bg-green-50 border-green-300'
                      : 'bg-yellow-50 border-yellow-300'
                  }>
                    <AlertDescription>
                      <p className="font-semibold text-sm mb-2">
                        {simulationResult.clinical_appropriateness.is_clinically_appropriate
                          ? '✓ Clinically Appropriate'
                          : '⚠️ Clinical Concerns Identified'}
                      </p>

                      {simulationResult.clinical_appropriateness.concerns?.length > 0 && (
                        <div className="mb-2">
                          <p className="text-xs font-semibold mb-1">Concerns:</p>
                          <ul className="text-xs space-y-1">
                            {simulationResult.clinical_appropriateness.concerns.map((concern, i) => (
                              <li key={i}>• {concern}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {simulationResult.clinical_appropriateness.justification_needed?.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold mb-1">Justification Needed:</p>
                          <ul className="text-xs space-y-1">
                            {simulationResult.clinical_appropriateness.justification_needed.map((just, i) => (
                              <li key={i}>• {just}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </AlertDescription>
                  </Alert>
                )}

                {/* Recommendations */}
                {simulationResult.recommendations?.length > 0 && (
                  <div className="bg-blue-50 p-4 rounded-lg border border-blue-300">
                    <p className="font-semibold text-blue-900 mb-2">AI Recommendations:</p>
                    <ul className="space-y-1">
                      {simulationResult.recommendations.map((rec, i) => (
                        <li key={i} className="text-sm text-blue-800 flex items-start gap-2">
                          <span className="bg-blue-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs flex-shrink-0">
                            {i + 1}
                          </span>
                          {rec}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </TabsContent>

          {/* Saved Scenarios */}
          <TabsContent value="saved" className="space-y-3">
            {scenarios.length === 0 ? (
              <div className="text-center py-12 bg-slate-50 rounded-lg border-2 border-dashed">
                <Lightbulb className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-600">No saved scenarios yet</p>
                <p className="text-sm text-slate-500">Create and run a simulation, then save it</p>
              </div>
            ) : (
              <ScrollArea className="max-h-[600px]">
                <div className="space-y-3">
                  {scenarios.map((scenario, idx) => (
                    <Card key={scenario.id} className="border-2 hover:border-navy-400 transition-colors">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <h4 className="font-semibold text-slate-900">{scenario.scenario_name}</h4>
                            <p className="text-xs text-slate-500">
                              Saved {new Date(scenario.created_date || Date.now()).toLocaleDateString()}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge className={
                              scenario.simulated_payment > scenario.baseline_payment
                                ? 'bg-green-600 text-white'
                                : 'bg-red-600 text-white'
                            }>
                              {scenario.simulated_payment > scenario.baseline_payment ? '+' : ''}
                              {formatCurrency(scenario.simulated_payment - scenario.baseline_payment)}
                            </Badge>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
                          <div className="bg-slate-50 p-2 rounded">
                            <p className="text-slate-600">Functional Points</p>
                            <p className="font-bold">{scenario.simulation_result?.functional_analysis?.total_points}</p>
                          </div>
                          <div className="bg-slate-50 p-2 rounded">
                            <p className="text-slate-600">Comorbidities</p>
                            <p className="font-bold">{scenario.scenario_data?.comorbidities?.length}</p>
                          </div>
                        </div>

                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => loadScenario(scenario)}
                            className="flex-1"
                          >
                            <Copy className="w-3 h-3 mr-2" />
                            Load
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => toggleCompareScenario(scenario)}
                            className={selectedScenarios.find(s => s.id === scenario.id) ? 'bg-navy-100' : ''}
                          >
                            <BarChart3 className="w-3 h-3 mr-2" />
                            Compare
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => deleteScenario(idx)}
                            className="text-red-600"
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </ScrollArea>
            )}
          </TabsContent>

          {/* Comparison View */}
          <TabsContent value="compare" className="space-y-4">
            {selectedScenarios.length === 0 ? (
              <div className="text-center py-12 bg-slate-50 rounded-lg border-2 border-dashed">
                <BarChart3 className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-600">No scenarios selected for comparison</p>
                <p className="text-sm text-slate-500">Go to Saved Scenarios and click "Compare"</p>
              </div>
            ) : (
              <div className="space-y-4">
                <Alert className="bg-navy-50 border-navy-300">
                  <AlertDescription className="text-sm text-navy-900">
                    Comparing {selectedScenarios.length} scenario{selectedScenarios.length !== 1 ? 's' : ''}
                  </AlertDescription>
                </Alert>

                {/* Payment Comparison */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Payment Comparison</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {selectedScenarios.map((scenario, _idx) => (
                        <div key={scenario.id} className="flex items-center justify-between p-3 bg-gradient-to-r from-slate-50 to-white rounded border">
                          <div>
                            <p className="font-semibold text-sm">{scenario.scenario_name}</p>
                            <p className="text-xs text-slate-500">
                              Functional: {scenario.simulation_result?.functional_analysis?.total_points} pts | 
                              Comorbidities: {scenario.scenario_data?.comorbidities?.length}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-lg font-bold text-slate-900">
                              {formatCurrency(scenario.simulated_payment)}
                            </p>
                            <Badge className={
                              scenario.simulated_payment > scenario.baseline_payment
                                ? 'bg-green-600 text-white text-xs'
                                : 'bg-red-600 text-white text-xs'
                            }>
                              {scenario.simulated_payment > scenario.baseline_payment ? '+' : ''}
                              {formatCurrency(scenario.simulated_payment - scenario.baseline_payment)}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Best Scenario */}
                    {selectedScenarios.length > 1 && (
                      <div className="mt-4 bg-green-50 p-3 rounded-lg border-2 border-green-400">
                        <p className="text-xs text-green-700 font-semibold mb-1">💎 Best Scenario:</p>
                        <p className="text-sm text-green-900 font-bold">
                          {[...selectedScenarios].sort((a, b) => b.simulated_payment - a.simulated_payment)[0].scenario_name}
                        </p>
                        <p className="text-xs text-green-700 mt-1">
                          Highest Payment: {formatCurrency(Math.max(...selectedScenarios.map(s => s.simulated_payment)))}
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Functional Level Comparison */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Functional Level Comparison</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {selectedScenarios.map((scenario) => (
                        <div key={scenario.id} className="flex items-center justify-between p-2 bg-white rounded border">
                          <p className="text-sm font-medium">{scenario.scenario_name}</p>
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-slate-600">
                              {scenario.simulation_result?.functional_analysis?.total_points} points
                            </span>
                            <Badge className={
                              scenario.simulation_result?.functional_analysis?.functional_level === 'high' ? 'bg-green-600' :
                              scenario.simulation_result?.functional_analysis?.functional_level === 'medium' ? 'bg-yellow-600' :
                              'bg-blue-600'
                            }>
                              {scenario.simulation_result?.functional_analysis?.functional_level}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}