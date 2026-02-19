import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { 
  Calculator, 
  DollarSign, 
  TrendingUp,
  BarChart3,
  AlertTriangle
} from 'lucide-react';

export default function ScenarioModeler() {
  const [scenario, setScenario] = useState({
    clinical_grouping: 'MMTA',
    functional_level: 'medium',
    comorbidity: 'low',
    timing: 'early',
    visit_count: 15,
    wage_index: 1.0,
    base_rate: 2020.61
  });

  const [results, setResults] = useState(null);

  // Case mix weights (simplified - actual values from CMS tables)
  const caseMixWeights = {
    'MMTA': { low: 0.8977, medium: 1.1234, high: 1.4521 },
    'MS-Rehab': { low: 1.2145, medium: 1.5234, high: 1.8921 },
    'Neuro-Rehab': { low: 1.3214, medium: 1.6543, high: 2.1234 },
    'Wounds': { low: 1.1234, medium: 1.4321, high: 1.7654 },
    'Complex': { low: 1.4567, medium: 1.8234, high: 2.3456 },
    'Behavioral Health': { low: 0.9876, medium: 1.2345, high: 1.5678 }
  };

  const comorbidityAdjustment = {
    'none': 1.0,
    'low': 1.05,
    'high': 1.12
  };

  const timingAdjustment = {
    'early': 1.0,
    'late': 0.9
  };

  const lupaThresholds = {
    'MMTA': 6,
    'MS-Rehab': 7,
    'Neuro-Rehab': 7,
    'Wounds': 6,
    'Complex': 7,
    'Behavioral Health': 5
  };

  const calculateScenario = () => {
    const baseCaseMix = caseMixWeights[scenario.clinical_grouping][scenario.functional_level];
    const comorbAdj = comorbidityAdjustment[scenario.comorbidity];
    const timeAdj = timingAdjustment[scenario.timing];
    
    const finalCaseMix = baseCaseMix * comorbAdj * timeAdj;
    const basePayment = scenario.base_rate * finalCaseMix * scenario.wage_index;
    
    const isLUPA = scenario.visit_count < lupaThresholds[scenario.clinical_grouping];
    const lupaAdjustment = isLUPA ? 0.6 : 1.0;
    const finalPayment = basePayment * lupaAdjustment;

    const perVisitRevenue = scenario.visit_count > 0 ? finalPayment / scenario.visit_count : 0;

    setResults({
      case_mix_weight: finalCaseMix,
      base_payment: basePayment,
      is_lupa: isLUPA,
      lupa_threshold: lupaThresholds[scenario.clinical_grouping],
      final_payment: finalPayment,
      per_visit_revenue: perVisitRevenue,
      lupa_penalty: isLUPA ? basePayment - finalPayment : 0
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calculator className="h-5 w-5 text-blue-600" />
          PDGM Scenario Modeler
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Inputs */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium mb-2 block">Clinical Grouping</label>
            <Select 
              value={scenario.clinical_grouping} 
              onValueChange={(value) => setScenario({ ...scenario, clinical_grouping: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="MMTA">MMTA</SelectItem>
                <SelectItem value="MS-Rehab">MS-Rehab</SelectItem>
                <SelectItem value="Neuro-Rehab">Neuro-Rehab</SelectItem>
                <SelectItem value="Wounds">Wounds</SelectItem>
                <SelectItem value="Complex">Complex</SelectItem>
                <SelectItem value="Behavioral Health">Behavioral Health</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-sm font-medium mb-2 block">Functional Level</label>
            <Select 
              value={scenario.functional_level} 
              onValueChange={(value) => setScenario({ ...scenario, functional_level: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-sm font-medium mb-2 block">Comorbidity</label>
            <Select 
              value={scenario.comorbidity} 
              onValueChange={(value) => setScenario({ ...scenario, comorbidity: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="high">High</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-sm font-medium mb-2 block">Timing</label>
            <Select 
              value={scenario.timing} 
              onValueChange={(value) => setScenario({ ...scenario, timing: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="early">Early (Days 1-30)</SelectItem>
                <SelectItem value="late">Late (Days 31-60)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-sm font-medium mb-2 block">Visit Count: {scenario.visit_count}</label>
            <Slider
              value={[scenario.visit_count]}
              onValueChange={(value) => setScenario({ ...scenario, visit_count: value[0] })}
              min={1}
              max={30}
              step={1}
            />
          </div>

          <div>
            <label className="text-sm font-medium mb-2 block">Wage Index</label>
            <Input
              type="number"
              step="0.01"
              value={scenario.wage_index}
              onChange={(e) => setScenario({ ...scenario, wage_index: parseFloat(e.target.value) })}
            />
          </div>
        </div>

        {/* Calculate Button */}
        <Button onClick={calculateScenario} className="w-full bg-blue-600 hover:bg-blue-700">
          <Calculator className="h-4 w-4 mr-2" />
          Calculate Payment
        </Button>

        {/* Results */}
        {results && (
          <div className="space-y-4 pt-4 border-t">
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-blue-700 mb-1">Case Mix Weight</p>
                <p className="text-2xl font-bold text-blue-900">{results.case_mix_weight.toFixed(4)}</p>
              </div>

              <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-sm text-green-700 mb-1">Final Payment</p>
                <p className="text-2xl font-bold text-green-900">${results.final_payment.toFixed(2)}</p>
              </div>

              <div className="p-4 bg-purple-50 border border-purple-200 rounded-lg">
                <p className="text-sm text-purple-700 mb-1">Per Visit Revenue</p>
                <p className="text-2xl font-bold text-purple-900">${results.per_visit_revenue.toFixed(2)}</p>
              </div>

              <div className={`p-4 rounded-lg ${
                results.is_lupa 
                  ? 'bg-red-50 border border-red-200' 
                  : 'bg-green-50 border border-green-200'
              }`}>
                <p className={`text-sm mb-1 ${results.is_lupa ? 'text-red-700' : 'text-green-700'}`}>
                  LUPA Status
                </p>
                <p className={`text-2xl font-bold ${results.is_lupa ? 'text-red-900' : 'text-green-900'}`}>
                  {results.is_lupa ? 'YES' : 'NO'}
                </p>
              </div>
            </div>

            {results.is_lupa && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-medium text-red-900 mb-1">LUPA Triggered</p>
                    <p className="text-sm text-red-800 mb-2">
                      Visit count ({scenario.visit_count}) is below threshold ({results.lupa_threshold})
                    </p>
                    <p className="text-sm text-red-900 font-semibold">
                      Revenue Loss: -${results.lupa_penalty.toFixed(2)}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="p-4 bg-slate-50 rounded-lg">
              <p className="text-xs text-slate-600 mb-2">Calculation Breakdown:</p>
              <div className="space-y-1 text-xs font-mono">
                <p>Base Case Mix: {caseMixWeights[scenario.clinical_grouping][scenario.functional_level].toFixed(4)}</p>
                <p>× Comorbidity Adj: {comorbidityAdjustment[scenario.comorbidity].toFixed(2)}</p>
                <p>× Timing Adj: {timingAdjustment[scenario.timing].toFixed(2)}</p>
                <p>= Final Case Mix: {results.case_mix_weight.toFixed(4)}</p>
                <p className="pt-1 border-t">Base Rate: ${scenario.base_rate}</p>
                <p>× Wage Index: {scenario.wage_index}</p>
                <p>× Case Mix: {results.case_mix_weight.toFixed(4)}</p>
                <p>= Payment: ${results.final_payment.toFixed(2)}</p>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}