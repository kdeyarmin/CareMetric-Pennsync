import { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import {
  Save,
  Trash2,
  Play,
  TrendingUp,
  TrendingDown,
  Loader2,
  FileCheck,
  Sliders,
  BarChart3
} from "lucide-react";
import { calculatePDGM } from "@/functions/calculatePDGM";
import { debounce } from "@/lib/debounce";

const FUNCTIONAL_ITEMS = [
  { key: 'm1800_grooming', label: 'M1800 Grooming', max: 3 },
  { key: 'm1810_dress_upper', label: 'M1810 Upper Dress', max: 3 },
  { key: 'm1820_dress_lower', label: 'M1820 Lower Dress', max: 3 },
  { key: 'm1830_bathing', label: 'M1830 Bathing', max: 6 },
  { key: 'm1840_toilet_transfer', label: 'M1840 Toilet Transfer', max: 4 },
  { key: 'm1850_transferring', label: 'M1850 Transferring', max: 5 },
  { key: 'm1860_ambulation', label: 'M1860 Ambulation', max: 6 },
];

export default function OASISScenarioManager({ 
  analysisId,
  originalPdgmData, 
  originalPayment,
  patientName,
  _onScenarioSelect,
  onCreateActions
}) {
  const queryClient = useQueryClient();
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [scenarioName, setScenarioName] = useState("");
  const [scenarioDescription, setScenarioDescription] = useState("");
  const [currentScenario, setCurrentScenario] = useState(null);
  const [scenarioPayment, setScenarioPayment] = useState(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [selectedScenarios, setSelectedScenarios] = useState([]);

  // Fetch saved scenarios
  const { data: savedScenarios = [] } = useQuery({
    queryKey: ['oasis-scenarios', analysisId],
    // Scenarios are scoped to the OASIS analysis they were modeled from.
    queryFn: () => base44.entities.OASISScenario.filter({ analysis_id: analysisId }),
    enabled: !!analysisId
  });

  // Initialize current scenario from original data
  useEffect(() => {
    if (originalPdgmData && !currentScenario) {
      setCurrentScenario({
        ...originalPdgmData,
        functional_scores: { ...originalPdgmData.functional_scores }
      });
    }
  }, [originalPdgmData, currentScenario]);

  // Save scenario mutation
  const saveMutation = useMutation({
    mutationFn: (scenarioData) => base44.entities.OASISScenario.create(scenarioData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['oasis-scenarios', analysisId] });
      setShowSaveDialog(false);
      setScenarioName("");
      setScenarioDescription("");
    },
    onError: () => {
      toast.error("Couldn't save the scenario. Please try again.");
    }
  });

  // Delete scenario mutation
  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.OASISScenario.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['oasis-scenarios', analysisId] });
    },
    onError: () => {
      toast.error("Couldn't delete the scenario. Please try again.");
    }
  });

  // Debounced calculation
  const calculateScenarioPayment = useMemo(
    () => debounce(async (scenarioData) => {
      if (!scenarioData) return;
      setIsCalculating(true);
      try {
        const response = await calculatePDGM({
          pdgmData: originalPdgmData,
          correctedPdgmData: scenarioData
        });
        setScenarioPayment(response.data?.corrected?.totalPayment || 0);
      } catch (err) {
        console.error("Calculation error:", err);
      }
      setIsCalculating(false);
    }, 500),
    [originalPdgmData]
  );

  // Cancel any pending debounced calculation on unmount
  useEffect(() => () => calculateScenarioPayment.cancel(), [calculateScenarioPayment]);

  // Update scenario and recalculate
  const updateScenario = (field, value) => {
    const updated = { ...currentScenario };
    
    if (field.startsWith('functional_scores.')) {
      const scoreKey = field.replace('functional_scores.', '');
      updated.functional_scores = {
        ...updated.functional_scores,
        [scoreKey]: value
      };
    } else {
      updated[field] = value;
    }
    
    setCurrentScenario(updated);
    calculateScenarioPayment(updated);
  };

  // Build changes list
  const getChanges = () => {
    if (!originalPdgmData || !currentScenario) return [];
    const changes = [];

    // Check admission source
    if (originalPdgmData.admission_source !== currentScenario.admission_source) {
      changes.push({
        field: 'admission_source',
        original_value: originalPdgmData.admission_source,
        new_value: currentScenario.admission_source
      });
    }

    // Check episode timing
    if (originalPdgmData.episode_timing !== currentScenario.episode_timing) {
      changes.push({
        field: 'episode_timing',
        original_value: originalPdgmData.episode_timing,
        new_value: currentScenario.episode_timing
      });
    }

    // Check functional scores
    FUNCTIONAL_ITEMS.forEach(item => {
      const orig = originalPdgmData.functional_scores?.[item.key] || 0;
      const curr = currentScenario.functional_scores?.[item.key] || 0;
      if (orig !== curr) {
        changes.push({
          field: item.key,
          original_value: String(orig),
          new_value: String(curr)
        });
      }
    });

    return changes;
  };

  // Save current scenario
  const handleSaveScenario = () => {
    const changes = getChanges();
    const paymentDiff = (scenarioPayment || originalPayment) - originalPayment;

    saveMutation.mutate({
      analysis_id: analysisId,
      scenario_name: scenarioName,
      description: scenarioDescription,
      patient_name: patientName,
      original_pdgm_data: originalPdgmData,
      modified_pdgm_data: currentScenario,
      changes_made: changes,
      original_payment: originalPayment,
      scenario_payment: scenarioPayment || originalPayment,
      payment_difference: paymentDiff,
      status: 'saved'
    });
  };

  // Load a saved scenario
  const loadScenario = (scenario) => {
    setCurrentScenario(scenario.modified_pdgm_data);
    setScenarioPayment(scenario.scenario_payment);
  };

  // Reset to original
  const resetToOriginal = () => {
    setCurrentScenario({
      ...originalPdgmData,
      functional_scores: { ...originalPdgmData.functional_scores }
    });
    setScenarioPayment(originalPayment);
  };

  // Toggle scenario selection for comparison/action
  const toggleScenarioSelection = (scenarioId) => {
    setSelectedScenarios(prev => 
      prev.includes(scenarioId) 
        ? prev.filter(id => id !== scenarioId)
        : [...prev, scenarioId]
    );
  };

  // Create actions from selected scenarios
  const handleCreateActions = () => {
    const selected = savedScenarios.filter(s => selectedScenarios.includes(s.id));
    if (onCreateActions && selected.length > 0) {
      onCreateActions(selected);
    }
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount || 0);
  };

  const paymentDiff = (scenarioPayment || originalPayment) - originalPayment;
  const changes = getChanges();

  if (!originalPdgmData) {
    return (
      <Alert className="bg-blue-50 border-blue-200">
        <AlertDescription>Run OASIS analysis first to enable scenario planning.</AlertDescription>
      </Alert>
    );
  }

  return (
    <Card className="border-2 border-navy-200">
      <CardHeader className="pb-3 bg-gradient-to-r from-navy-50 to-indigo-50">
        <CardTitle className="text-lg flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sliders className="w-5 h-5 text-navy-600" />
            Scenario Planning
          </div>
          <div className="flex items-center gap-2">
            {changes.length > 0 && (
              <Badge variant="outline" className="text-xs">
                {changes.length} changes
              </Badge>
            )}
            <Button 
              size="sm" 
              variant="outline"
              onClick={resetToOriginal}
              disabled={changes.length === 0}
            >
              Reset
            </Button>
            <Button 
              size="sm" 
              onClick={() => setShowSaveDialog(true)}
              disabled={changes.length === 0}
              className="bg-navy-600 hover:bg-navy-700"
            >
              <Save className="w-4 h-4 mr-1" /> Save Scenario
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {/* Payment Comparison */}
        <div className="grid grid-cols-3 gap-3">
          <div className="p-3 bg-slate-50 rounded-lg border text-center">
            <p className="text-xs text-slate-500 mb-1">Original Payment</p>
            <p className="text-lg font-bold text-slate-700">{formatCurrency(originalPayment)}</p>
          </div>
          <div className="p-3 bg-navy-50 rounded-lg border border-navy-200 text-center">
            <p className="text-xs text-navy-600 mb-1">Scenario Payment</p>
            <p className="text-lg font-bold text-navy-700">
              {isCalculating ? (
                <Loader2 className="w-5 h-5 animate-spin mx-auto" />
              ) : (
                formatCurrency(scenarioPayment || originalPayment)
              )}
            </p>
          </div>
          <div className={`p-3 rounded-lg border text-center ${
            paymentDiff > 0 ? 'bg-green-50 border-green-200' : 
            paymentDiff < 0 ? 'bg-red-50 border-red-200' : 'bg-slate-50'
          }`}>
            <p className="text-xs text-slate-500 mb-1">Difference</p>
            <p className={`text-lg font-bold flex items-center justify-center gap-1 ${
              paymentDiff > 0 ? 'text-green-700' : paymentDiff < 0 ? 'text-red-700' : 'text-slate-500'
            }`}>
              {paymentDiff > 0 ? <TrendingUp className="w-4 h-4" /> : 
               paymentDiff < 0 ? <TrendingDown className="w-4 h-4" /> : null}
              {paymentDiff > 0 ? '+' : ''}{formatCurrency(paymentDiff)}
            </p>
          </div>
        </div>

        {/* Scenario Editor */}
        <div className="space-y-4">
          {/* Admission & Timing */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="scenario-admission-source" className="text-xs font-medium text-slate-700 mb-1 block">Admission Source</label>
              <Select
                value={currentScenario?.admission_source || 'community'}
                onValueChange={(v) => updateScenario('admission_source', v)}
              >
                <SelectTrigger id="scenario-admission-source">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="community">Community</SelectItem>
                  <SelectItem value="institutional">Institutional</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label htmlFor="scenario-episode-timing" className="text-xs font-medium text-slate-700 mb-1 block">Episode Timing</label>
              <Select
                value={currentScenario?.episode_timing || 'early'}
                onValueChange={(v) => updateScenario('episode_timing', v)}
              >
                <SelectTrigger id="scenario-episode-timing">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="early">Early (Days 1-30)</SelectItem>
                  <SelectItem value="late">Late (Days 31-60)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Functional Scores */}
          <div className="space-y-3">
            <p className="text-sm font-medium text-slate-700">Functional Scores</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {FUNCTIONAL_ITEMS.map(item => {
                const origVal = originalPdgmData.functional_scores?.[item.key] || 0;
                const currVal = currentScenario?.functional_scores?.[item.key] || 0;
                const isChanged = origVal !== currVal;

                return (
                  <div key={item.key} className={`p-3 rounded-lg border ${isChanged ? 'bg-navy-50 border-navy-200' : 'bg-slate-50'}`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium">{item.label}</span>
                      <div className="flex items-center gap-2">
                        {isChanged && (
                          <Badge className="text-xs bg-navy-100 text-navy-700">
                            {origVal} → {currVal}
                          </Badge>
                        )}
                        <span className="text-sm font-bold text-navy-700">{currVal}</span>
                      </div>
                    </div>
                    <Slider
                      value={[currVal]}
                      onValueChange={([v]) => updateScenario(`functional_scores.${item.key}`, v)}
                      max={item.max}
                      step={1}
                      className="w-full"
                    />
                    <div className="flex justify-between text-xs text-slate-400 mt-1">
                      <span>0 (Indep)</span>
                      <span>{item.max} (Dep)</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Saved Scenarios */}
        {savedScenarios.length > 0 && (
          <div className="border-t pt-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <BarChart3 className="w-4 h-4" />
                Saved Scenarios ({savedScenarios.length})
              </p>
              {selectedScenarios.length > 0 && (
                <Button 
                  size="sm" 
                  onClick={handleCreateActions}
                  className="bg-green-600 hover:bg-green-700"
                >
                  <FileCheck className="w-4 h-4 mr-1" />
                  Create Actions ({selectedScenarios.length})
                </Button>
              )}
            </div>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {savedScenarios.map(scenario => (
                <div 
                  key={scenario.id} 
                  className={`p-3 rounded-lg border flex items-center justify-between ${
                    selectedScenarios.includes(scenario.id) 
                      ? 'bg-green-50 border-green-300' 
                      : 'bg-white hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={selectedScenarios.includes(scenario.id)}
                      onChange={() => toggleScenarioSelection(scenario.id)}
                      className="w-4 h-4 text-green-600"
                    />
                    <div>
                      <p className="text-sm font-medium">{scenario.scenario_name}</p>
                      <p className="text-xs text-slate-500">
                        {scenario.changes_made?.length || 0} changes • 
                        <span className={scenario.payment_difference > 0 ? 'text-green-600' : 'text-red-600'}>
                          {' '}{scenario.payment_difference > 0 ? '+' : ''}{formatCurrency(scenario.payment_difference)}
                        </span>
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="ghost" onClick={() => loadScenario(scenario)}>
                      <Play className="w-4 h-4" />
                    </Button>
                    <Button 
                      size="sm" 
                      variant="ghost" 
                      className="text-red-500 hover:text-red-700"
                      onClick={() => deleteMutation.mutate(scenario.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Save Dialog */}
        <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Save Scenario</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <label htmlFor="scenario-name" className="text-sm font-medium mb-1 block">Scenario Name</label>
                <Input
                  id="scenario-name"
                  value={scenarioName}
                  onChange={(e) => setScenarioName(e.target.value)}
                  placeholder="e.g., Higher Functional Scores"
                />
              </div>
              <div>
                <label htmlFor="scenario-description" className="text-sm font-medium mb-1 block">Description (Optional)</label>
                <Textarea
                  id="scenario-description"
                  value={scenarioDescription}
                  onChange={(e) => setScenarioDescription(e.target.value)}
                  placeholder="Describe what this scenario represents..."
                  rows={3}
                />
              </div>
              <div className="bg-navy-50 p-3 rounded-lg">
                <p className="text-sm font-medium text-navy-800 mb-2">
                  Payment Impact: <span className={paymentDiff >= 0 ? 'text-green-600' : 'text-red-600'}>
                    {paymentDiff > 0 ? '+' : ''}{formatCurrency(paymentDiff)}
                  </span>
                </p>
                <p className="text-xs text-navy-600">{changes.length} modifications from original</p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowSaveDialog(false)}>Cancel</Button>
              <Button 
                onClick={handleSaveScenario}
                disabled={!scenarioName || saveMutation.isPending}
                className="bg-navy-600 hover:bg-navy-700"
              >
                {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />}
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}