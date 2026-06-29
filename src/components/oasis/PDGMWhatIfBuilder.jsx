import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sliders,
  Plus,
  X,
  RotateCcw,
  Activity,
  Stethoscope,
  Building2,
  Clock
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';

const FUNCTIONAL_ITEMS = [
  { key: 'm1800_grooming', label: 'M1800 Grooming', max: 3 },
  { key: 'm1810_dress_upper', label: 'M1810 Upper Body Dressing', max: 3 },
  { key: 'm1820_dress_lower', label: 'M1820 Lower Body Dressing', max: 3 },
  { key: 'm1830_bathing', label: 'M1830 Bathing', max: 6 },
  { key: 'm1840_toilet_transfer', label: 'M1840 Toilet Transfer', max: 4 },
  { key: 'm1850_transferring', label: 'M1850 Transferring', max: 5 },
  { key: 'm1860_ambulation', label: 'M1860 Ambulation', max: 6 },
];

const COMMON_COMORBIDITIES = [
  'Diabetes mellitus (E11.9)',
  'Heart failure (I50.9)',
  'COPD (J44.9)',
  'Hypertension (I10)',
  'Atrial fibrillation (I48.91)',
  'Chronic kidney disease (N18.9)',
  'Peripheral vascular disease (I73.9)',
  'Obesity (E66.9)',
  'Depression (F32.9)',
  'Dementia (F03.90)',
];

export default function PDGMWhatIfBuilder({ 
  originalPdgmData, 
  onScenarioChange, 
  originalRevenue,
  scenarioRevenue 
}) {
  const [scenarioData, setScenarioData] = useState(null);
  const [newComorbidity, setNewComorbidity] = useState('');
  const [isExpanded, setIsExpanded] = useState(true);

  // Initialize scenario data from original
  useEffect(() => {
    if (originalPdgmData && !scenarioData) {
      setScenarioData({
        functional_scores: { ...(originalPdgmData.functional_scores || {}) },
        comorbidities: [...(originalPdgmData.comorbidities || [])],
        admission_source: originalPdgmData.admission_source || 'community',
        episode_timing: originalPdgmData.episode_timing || 'early'
      });
    }
  }, [originalPdgmData, scenarioData]);

  // Notify parent of changes
  useEffect(() => {
    if (scenarioData && onScenarioChange) {
      onScenarioChange(scenarioData);
    }
  }, [scenarioData, onScenarioChange]);

  const updateFunctionalScore = (key, value) => {
    setScenarioData(prev => ({
      ...prev,
      functional_scores: {
        ...prev.functional_scores,
        [key]: value
      }
    }));
  };

  const addComorbidity = (comorbidity) => {
    if (comorbidity && !scenarioData.comorbidities.includes(comorbidity)) {
      setScenarioData(prev => ({
        ...prev,
        comorbidities: [...prev.comorbidities, comorbidity]
      }));
      setNewComorbidity('');
    }
  };

  const removeComorbidity = (index) => {
    setScenarioData(prev => ({
      ...prev,
      comorbidities: prev.comorbidities.filter((_, i) => i !== index)
    }));
  };

  const resetScenario = () => {
    if (originalPdgmData) {
      setScenarioData({
        functional_scores: { ...(originalPdgmData.functional_scores || {}) },
        comorbidities: [...(originalPdgmData.comorbidities || [])],
        admission_source: originalPdgmData.admission_source || 'community',
        episode_timing: originalPdgmData.episode_timing || 'early'
      });
    }
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount || 0);
  };

  const revenueDiff = (scenarioRevenue || 0) - (originalRevenue || 0);

  // Chart data for comparison
  const comparisonChartData = [
    {
      name: 'Original',
      revenue: originalRevenue || 0,
      fill: '#9ca3af'
    },
    {
      name: 'What-If',
      revenue: scenarioRevenue || 0,
      fill: revenueDiff > 0 ? '#22c55e' : revenueDiff < 0 ? '#ef4444' : '#3557b0'
    }
  ];

  // Functional score impact chart
  const functionalImpactData = FUNCTIONAL_ITEMS.map(item => {
    const original = originalPdgmData?.functional_scores?.[item.key] || 0;
    const scenario = scenarioData?.functional_scores?.[item.key] || 0;
    return {
      name: item.label.replace('M18', '').split(' ')[0],
      original,
      scenario,
      diff: scenario - original
    };
  });

  if (!scenarioData) return null;

  return (
    <Card className="border-2 border-navy-200">
      <CardHeader className="pb-3 bg-gradient-to-r from-navy-50 to-indigo-50">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Sliders className="w-5 h-5 text-navy-600" />
            What-If Scenario Builder
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={resetScenario}>
              <RotateCcw className="w-3 h-3 mr-1" />
              Reset
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsExpanded(!isExpanded)}
            >
              {isExpanded ? 'Collapse' : 'Expand'}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-4">
        {/* Real-time Revenue Impact Banner */}
        <div className={`p-4 rounded-lg border-2 ${
          revenueDiff > 0 ? 'bg-green-50 border-green-300' :
          revenueDiff < 0 ? 'bg-red-50 border-red-300' :
          'bg-slate-50 border-slate-300'
        }`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-slate-600">Scenario Revenue Impact</p>
              <p className={`text-2xl font-bold ${
                revenueDiff > 0 ? 'text-green-700' :
                revenueDiff < 0 ? 'text-red-700' :
                'text-slate-700'
              }`}>
                {revenueDiff > 0 ? '+' : ''}{formatCurrency(revenueDiff)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-500">Per Episode</p>
              <p className="text-lg font-semibold text-navy-700">
                {formatCurrency(scenarioRevenue)}
              </p>
            </div>
          </div>
        </div>

        {/* Revenue Comparison Chart */}
        <div className="bg-slate-50 rounded-lg p-3">
          <p className="text-xs font-medium text-slate-600 mb-2">Revenue Comparison</p>
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={comparisonChartData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tickFormatter={(v) => `$${(v/1000).toFixed(1)}k`} fontSize={10} />
              <YAxis type="category" dataKey="name" fontSize={10} width={60} />
              <Tooltip formatter={(value) => formatCurrency(value)} />
              <Bar dataKey="revenue" radius={[0, 4, 4, 0]}>
                {comparisonChartData.map((entry, index) => (
                  <Cell key={index} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {isExpanded && (
          <>
            {/* Functional Scores Section */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-blue-600" />
                <h3 className="font-semibold text-sm text-slate-800">Functional Scores</h3>
              </div>
              <div className="space-y-4 bg-blue-50 p-3 rounded-lg">
                {FUNCTIONAL_ITEMS.map(item => {
                  const originalVal = originalPdgmData?.functional_scores?.[item.key] || 0;
                  const currentVal = scenarioData.functional_scores[item.key] || 0;
                  const diff = currentVal - originalVal;
                  
                  return (
                    <div key={item.key} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs">{item.label}</Label>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-500">Orig: {originalVal}</span>
                          <Badge className={`text-xs py-0 ${
                            diff > 0 ? 'bg-green-100 text-green-700' :
                            diff < 0 ? 'bg-red-100 text-red-700' :
                            'bg-slate-100 text-slate-600'
                          }`}>
                            {currentVal} {diff !== 0 && `(${diff > 0 ? '+' : ''}${diff})`}
                          </Badge>
                        </div>
                      </div>
                      <Slider
                        value={[currentVal]}
                        min={0}
                        max={item.max}
                        step={1}
                        onValueChange={([val]) => updateFunctionalScore(item.key, val)}
                        className="cursor-pointer"
                      />
                      <div className="flex justify-between text-xs text-slate-400">
                        <span>0 (Independent)</span>
                        <span>{item.max} (Dependent)</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Functional Score Impact Chart */}
              <div className="bg-white rounded-lg p-3 border">
                <p className="text-xs font-medium text-slate-600 mb-2">Functional Score Changes</p>
                <ResponsiveContainer width="100%" height={150}>
                  <BarChart data={functionalImpactData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" fontSize={9} />
                    <YAxis fontSize={10} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Bar dataKey="original" fill="#9ca3af" name="Original" />
                    <Bar dataKey="scenario" fill="#8b5cf6" name="Scenario" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Comorbidities Section */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Stethoscope className="w-4 h-4 text-green-600" />
                <h3 className="font-semibold text-sm text-slate-800">
                  Comorbidities ({scenarioData.comorbidities.length})
                </h3>
              </div>
              <div className="bg-green-50 p-3 rounded-lg space-y-3">
                {/* Current comorbidities */}
                <div className="flex flex-wrap gap-1">
                  {scenarioData.comorbidities.length === 0 ? (
                    <p className="text-xs text-slate-500 italic">No comorbidities added</p>
                  ) : (
                    scenarioData.comorbidities.map((c, idx) => (
                      <Badge key={idx} variant="outline" className="text-xs bg-white flex items-center gap-1">
                        {c.length > 30 ? c.substring(0, 30) + '...' : c}
                        <button 
                          onClick={() => removeComorbidity(idx)}
                          className="ml-1 hover:text-red-600"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </Badge>
                    ))
                  )}
                </div>

                {/* Add comorbidity */}
                <div className="flex gap-2">
                  <Select onValueChange={addComorbidity}>
                    <SelectTrigger className="text-xs h-8 flex-1">
                      <SelectValue placeholder="Add common comorbidity..." />
                    </SelectTrigger>
                    <SelectContent>
                      {COMMON_COMORBIDITIES.filter(c => !scenarioData.comorbidities.includes(c)).map(c => (
                        <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Custom comorbidity */}
                <div className="flex gap-2">
                  <Input
                    placeholder="Or type custom diagnosis..."
                    value={newComorbidity}
                    onChange={(e) => setNewComorbidity(e.target.value)}
                    className="text-xs h-8"
                    onKeyDown={(e) => e.key === 'Enter' && addComorbidity(newComorbidity)}
                  />
                  <Button 
                    size="sm" 
                    variant="outline" 
                    className="h-8"
                    onClick={() => addComorbidity(newComorbidity)}
                  >
                    <Plus className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            </div>

            {/* Admission & Timing Section */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-orange-600" />
                  <Label className="text-sm font-semibold">Admission Source</Label>
                </div>
                <Select 
                  value={scenarioData.admission_source}
                  onValueChange={(val) => setScenarioData(prev => ({ ...prev, admission_source: val }))}
                >
                  <SelectTrigger className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="community">Community</SelectItem>
                    <SelectItem value="institutional">Institutional</SelectItem>
                  </SelectContent>
                </Select>
                {scenarioData.admission_source !== originalPdgmData?.admission_source && (
                  <Badge className="text-xs bg-orange-100 text-orange-700">
                    Changed from {originalPdgmData?.admission_source}
                  </Badge>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-indigo-600" />
                  <Label className="text-sm font-semibold">Episode Timing</Label>
                </div>
                <Select 
                  value={scenarioData.episode_timing}
                  onValueChange={(val) => setScenarioData(prev => ({ ...prev, episode_timing: val }))}
                >
                  <SelectTrigger className="text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="early">Early (Days 1-30)</SelectItem>
                    <SelectItem value="late">Late (Days 31-60)</SelectItem>
                  </SelectContent>
                </Select>
                {scenarioData.episode_timing !== originalPdgmData?.episode_timing && (
                  <Badge className="text-xs bg-indigo-100 text-indigo-700">
                    Changed from {originalPdgmData?.episode_timing}
                  </Badge>
                )}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}