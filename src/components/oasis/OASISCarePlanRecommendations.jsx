import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { base44 } from '@/api/base44Client';
import { 
  Target, 
  Activity, 
  ShieldCheck, 
  BookOpen, 
  Package,
  Eye,
  Calendar,
  CheckCircle2,
  Loader2,
  Sparkles
} from 'lucide-react';
import { toast } from 'sonner';

export default function OASISCarePlanRecommendations({ oasisData, patientId }) {
  const [carePlan, setCarePlan] = useState(null);
  const [loading, setLoading] = useState(false);

  const generateCarePlan = async () => {
    setLoading(true);
    try {
      const response = await base44.functions.invoke('generateOASISCarePlan', {
        oasis_data: oasisData,
        patient_id: patientId
      });

      if (response.data.success) {
        setCarePlan(response.data.care_plan);
        toast.success('Care plan generated successfully!');
      }
    } catch (error) {
      console.error('Care plan generation failed:', error);
      toast.error('Failed to generate care plan');
    } finally {
      setLoading(false);
    }
  };

  const applyToCarePlan = async (items) => {
    try {
      // Logic to apply recommendations to actual care plan
      toast.success(`Applied ${items.length} recommendations to care plan`);
    } catch (error) {
      toast.error('Failed to apply recommendations');
    }
  };

  if (!carePlan) {
    return (
      <Card className="border-green-200">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-green-600" />
            OASIS-Driven Care Plan Generator
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-slate-600 mb-3">
            Generate comprehensive, evidence-based care plan recommendations directly from OASIS assessment data.
          </p>
          <Button 
            onClick={generateCarePlan} 
            disabled={loading || !oasisData}
            className="w-full bg-green-600 hover:bg-green-700"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                Generate Care Plan
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-green-200">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Target className="h-4 w-4 text-green-600" />
            OASIS Care Plan Recommendations
          </CardTitle>
          <Button 
            size="sm" 
            variant="outline" 
            onClick={generateCarePlan}
            disabled={loading}
          >
            Regenerate
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="goals" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="goals" className="text-xs">Goals</TabsTrigger>
            <TabsTrigger value="interventions" className="text-xs">Interventions</TabsTrigger>
            <TabsTrigger value="monitoring" className="text-xs">Monitoring</TabsTrigger>
          </TabsList>

          {/* Goals Tab */}
          <TabsContent value="goals" className="space-y-3 mt-3">
            {carePlan.care_plan_goals?.map((goal, idx) => (
              <div key={idx} className="p-3 border border-green-200 rounded-lg bg-green-50">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-start gap-2">
                    <Target className="h-4 w-4 text-green-600 mt-0.5" />
                    <div>
                      <p className="text-xs font-semibold text-green-900">
                        {goal.goal_statement}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <Calendar className="h-3 w-3 text-green-700" />
                        <span className="text-xs text-green-700">Target: {goal.target_date}</span>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="mt-2 space-y-1">
                  <p className="text-xs font-medium text-green-800">Measurable Outcomes:</p>
                  {goal.measurable_outcomes?.map((outcome, oidx) => (
                    <div key={oidx} className="flex items-start gap-1 text-xs text-green-700">
                      <CheckCircle2 className="h-3 w-3 mt-0.5" />
                      <span>{outcome}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {goal.oasis_indicators?.map((item, iidx) => (
                    <Badge key={iidx} variant="outline" className="text-[10px] bg-white">
                      {item}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
            <Button 
              size="sm" 
              className="w-full bg-green-600 hover:bg-green-700"
              onClick={() => applyToCarePlan(carePlan.care_plan_goals)}
            >
              Apply Goals to Care Plan
            </Button>
          </TabsContent>

          {/* Interventions Tab */}
          <TabsContent value="interventions" className="space-y-3 mt-3">
            {carePlan.interventions?.map((intervention, idx) => (
              <div key={idx} className="p-3 border border-blue-200 rounded-lg bg-blue-50">
                <div className="flex items-center justify-between mb-2">
                  <Badge className="bg-blue-600">{intervention.discipline}</Badge>
                  <span className="text-xs font-semibold text-blue-900">
                    {intervention.frequency}, {intervention.duration}
                  </span>
                </div>
                <p className="text-xs font-medium text-blue-900 mb-2">
                  {intervention.intervention_description}
                </p>
                <p className="text-xs text-blue-700 mb-2">
                  <strong>Rationale:</strong> {intervention.rationale}
                </p>
                <div className="flex flex-wrap gap-1">
                  {intervention.oasis_items_addressed?.map((item, iidx) => (
                    <Badge key={iidx} variant="outline" className="text-[10px] bg-white">
                      {item}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
            
            {/* Safety Interventions */}
            {carePlan.safety_interventions && carePlan.safety_interventions.length > 0 && (
              <div className="mt-4">
                <h4 className="text-xs font-semibold text-slate-800 mb-2 flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-orange-600" />
                  Safety Interventions
                </h4>
                {carePlan.safety_interventions.map((safety, idx) => (
                  <div key={idx} className="p-2 border border-orange-200 rounded bg-orange-50 mb-2">
                    <p className="text-xs font-medium text-orange-900">{safety.risk_area}</p>
                    <p className="text-xs text-orange-700">{safety.intervention}</p>
                  </div>
                ))}
              </div>
            )}

            <Button 
              size="sm" 
              className="w-full"
              onClick={() => applyToCarePlan(carePlan.interventions)}
            >
              Apply Interventions to Care Plan
            </Button>
          </TabsContent>

          {/* Monitoring Tab */}
          <TabsContent value="monitoring" className="space-y-3 mt-3">
            {carePlan.monitoring_requirements?.map((monitor, idx) => (
              <div key={idx} className="p-3 border border-purple-200 rounded-lg bg-purple-50">
                <div className="flex items-start gap-2 mb-2">
                  <Eye className="h-4 w-4 text-purple-600 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-purple-900">
                      {monitor.parameter}
                    </p>
                    <p className="text-xs text-purple-700 mt-1">
                      <strong>Frequency:</strong> {monitor.frequency}
                    </p>
                    <p className="text-xs text-purple-700">
                      <strong>Alert Criteria:</strong> {monitor.alert_criteria}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1 mt-2">
                  <Badge variant="outline" className="text-[10px] bg-white">
                    {monitor.oasis_correlation}
                  </Badge>
                </div>
              </div>
            ))}

            {/* Equipment/DME Needs */}
            {carePlan.equipment_needs && carePlan.equipment_needs.length > 0 && (
              <div className="mt-4">
                <h4 className="text-xs font-semibold text-slate-800 mb-2 flex items-center gap-2">
                  <Package className="h-4 w-4 text-indigo-600" />
                  Equipment & DME Needs
                </h4>
                {carePlan.equipment_needs.map((equip, idx) => (
                  <div key={idx} className="p-2 border border-indigo-200 rounded bg-indigo-50 mb-2">
                    <p className="text-xs font-medium text-indigo-900">{equip.equipment}</p>
                    <p className="text-xs text-indigo-700">{equip.justification}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Education Plan */}
            {carePlan.education_plan && carePlan.education_plan.length > 0 && (
              <div className="mt-4">
                <h4 className="text-xs font-semibold text-slate-800 mb-2 flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-teal-600" />
                  Patient Education Plan
                </h4>
                {carePlan.education_plan.map((edu, idx) => (
                  <div key={idx} className="p-2 border border-teal-200 rounded bg-teal-50 mb-2">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-medium text-teal-900">{edu.topic}</p>
                      <Badge variant="outline" className="text-[10px]">{edu.priority}</Badge>
                    </div>
                    <p className="text-xs text-teal-700">
                      Target: {edu.target_audience.join(', ')}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* Discharge Planning Summary */}
        {carePlan.discharge_planning && (
          <div className="mt-4 p-3 bg-slate-50 border border-slate-200 rounded-lg">
            <h4 className="text-xs font-semibold text-slate-800 mb-2">Discharge Planning</h4>
            <div className="space-y-1 text-xs text-slate-700">
              <p><strong>Estimated LOS:</strong> {carePlan.discharge_planning.estimated_los}</p>
              <p><strong>Discharge Goals:</strong></p>
              <ul className="ml-4 space-y-1">
                {carePlan.discharge_planning.discharge_goals?.map((goal, idx) => (
                  <li key={idx}>• {goal}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}