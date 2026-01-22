import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Scissors,
  Activity,
  Users,
  Home,
  AlertTriangle,
  TrendingUp,
  Clock,
  Building2,
  Heart,
  CheckCircle2
} from "lucide-react";
import { format, isValid } from "date-fns";
import { sanitizeInput } from "@/components/utils/security";

export default function ComprehensiveMedicalHistory({ patient }) {
  const hasSurgeries = patient?.past_surgeries?.length > 0;
  const hasChronicConditions = patient?.chronic_conditions?.length > 0;
  const hasFamilyHistory = patient?.family_medical_history && Object.keys(patient.family_medical_history).some(
    key => key !== 'notes' && key !== 'other_conditions' && patient.family_medical_history[key]
  );
  const hasSocialDeterminants = patient?.social_determinants && Object.keys(patient.social_determinants).length > 0;

  const getRiskLevel = () => {
    let riskFactors = 0;
    
    if (patient?.chronic_conditions?.some(c => c.severity === 'severe')) riskFactors += 2;
    if (patient?.family_medical_history?.heart_disease) riskFactors += 1;
    if (patient?.family_medical_history?.diabetes) riskFactors += 1;
    if (patient?.social_determinants?.housing_stability === 'unstable' || patient?.social_determinants?.housing_stability === 'homeless') riskFactors += 2;
    if (patient?.social_determinants?.food_security === 'insecure' || patient?.social_determinants?.food_security === 'very_insecure') riskFactors += 2;
    if (patient?.social_determinants?.social_isolation === 'isolated' || patient?.social_determinants?.social_isolation === 'severely_isolated') riskFactors += 1;

    if (riskFactors >= 5) return { level: 'High Risk', color: 'bg-red-100 text-red-800 border-red-300' };
    if (riskFactors >= 3) return { level: 'Moderate Risk', color: 'bg-yellow-100 text-yellow-800 border-yellow-300' };
    return { level: 'Low Risk', color: 'bg-green-100 text-green-800 border-green-300' };
  };

  const risk = getRiskLevel();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-blue-600" />
            Comprehensive Medical History
          </div>
          <Badge className={risk.color}>
            {risk.level}
          </Badge>
        </CardTitle>
      </CardHeader>

      <CardContent>
        <Tabs defaultValue="surgeries" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="surgeries">Surgeries</TabsTrigger>
            <TabsTrigger value="chronic">Chronic</TabsTrigger>
            <TabsTrigger value="family">Family</TabsTrigger>
            <TabsTrigger value="social">Social</TabsTrigger>
          </TabsList>

          {/* Past Surgeries Tab */}
          <TabsContent value="surgeries" className="space-y-4">
            {hasSurgeries ? (
              <ScrollArea className="max-h-96">
                <div className="space-y-3">
                  {patient.past_surgeries.map((surgery, index) => (
                    <Card key={index} className="border-l-4 border-l-purple-500">
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <Scissors className="w-5 h-5 text-purple-600 mt-1 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <h4 className="font-semibold text-gray-900 break-words mb-2">
                              {sanitizeInput(surgery.procedure)}
                            </h4>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                              {surgery.date && (
                                <div className="flex items-center gap-1">
                                  <Clock className="w-3 h-3 text-gray-500" />
                                  <span className="text-gray-600">
                                    {isValid(new Date(surgery.date)) ? format(new Date(surgery.date), 'MMM d, yyyy') : 'Date unknown'}
                                  </span>
                                </div>
                              )}
                              {surgery.hospital && (
                                <div className="flex items-center gap-1">
                                  <Building2 className="w-3 h-3 text-gray-500" />
                                  <span className="text-gray-600 truncate">{sanitizeInput(surgery.hospital)}</span>
                                </div>
                              )}
                              {surgery.surgeon && (
                                <div className="text-gray-600 col-span-full">
                                  <span className="font-medium">Surgeon:</span> {sanitizeInput(surgery.surgeon)}
                                </div>
                              )}
                            </div>
                            {surgery.complications && (
                              <Alert className="mt-3 bg-yellow-50 border-yellow-200">
                                <AlertTriangle className="w-4 h-4 text-yellow-600" />
                                <AlertDescription className="text-sm text-yellow-900">
                                  <span className="font-medium">Complications:</span> {sanitizeInput(surgery.complications)}
                                </AlertDescription>
                              </Alert>
                            )}
                            {surgery.outcome && (
                              <div className="mt-2 text-sm text-gray-700">
                                <span className="font-medium">Outcome:</span> {sanitizeInput(surgery.outcome)}
                              </div>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </ScrollArea>
            ) : (
              <div className="text-center py-8 text-gray-500">
                <Scissors className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p>No surgical history documented</p>
              </div>
            )}
          </TabsContent>

          {/* Chronic Conditions Tab */}
          <TabsContent value="chronic" className="space-y-4">
            {hasChronicConditions ? (
              <div className="space-y-3">
                {patient.chronic_conditions.map((condition, index) => (
                  <Card key={index} className={`border-l-4 ${
                    condition.severity === 'severe' ? 'border-l-red-500 bg-red-50' :
                    condition.severity === 'moderate' ? 'border-l-yellow-500 bg-yellow-50' :
                    'border-l-blue-500 bg-blue-50'
                  }`}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <h4 className="font-semibold text-gray-900 break-words mb-1">
                            {sanitizeInput(condition.condition)}
                          </h4>
                          <div className="flex flex-wrap items-center gap-2 mb-2">
                            {condition.severity && (
                              <Badge className={
                                condition.severity === 'severe' ? 'bg-red-500' :
                                condition.severity === 'moderate' ? 'bg-yellow-500' :
                                'bg-blue-500'
                              }>
                                {condition.severity}
                              </Badge>
                            )}
                            {condition.date_diagnosed && isValid(new Date(condition.date_diagnosed)) && (
                              <span className="text-xs text-gray-600">
                                Since {format(new Date(condition.date_diagnosed), 'MMM yyyy')}
                              </span>
                            )}
                          </div>
                          {condition.management_notes && (
                            <p className="text-sm text-gray-700 mt-2 break-words">
                              {sanitizeInput(condition.management_notes)}
                            </p>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                <Activity className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p>No chronic conditions documented</p>
              </div>
            )}
          </TabsContent>

          {/* Family Medical History Tab */}
          <TabsContent value="family" className="space-y-4">
            {hasFamilyHistory ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {patient.family_medical_history.heart_disease && (
                    <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                      <Heart className="w-4 h-4 text-red-600" />
                      <span className="text-sm font-medium text-red-900">Heart Disease</span>
                    </div>
                  )}
                  {patient.family_medical_history.diabetes && (
                    <div className="flex items-center gap-2 p-3 bg-orange-50 border border-orange-200 rounded-lg">
                      <Activity className="w-4 h-4 text-orange-600" />
                      <span className="text-sm font-medium text-orange-900">Diabetes</span>
                    </div>
                  )}
                  {patient.family_medical_history.cancer && (
                    <div className="flex items-center gap-2 p-3 bg-purple-50 border border-purple-200 rounded-lg">
                      <AlertTriangle className="w-4 h-4 text-purple-600" />
                      <span className="text-sm font-medium text-purple-900">Cancer</span>
                    </div>
                  )}
                  {patient.family_medical_history.hypertension && (
                    <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                      <TrendingUp className="w-4 h-4 text-red-600" />
                      <span className="text-sm font-medium text-red-900">Hypertension</span>
                    </div>
                  )}
                  {patient.family_medical_history.stroke && (
                    <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                      <Heart className="w-4 h-4 text-red-600" />
                      <span className="text-sm font-medium text-red-900">Stroke</span>
                    </div>
                  )}
                  {patient.family_medical_history.alzheimers_dementia && (
                    <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                      <Activity className="w-4 h-4 text-blue-600" />
                      <span className="text-sm font-medium text-blue-900">Alzheimer's/Dementia</span>
                    </div>
                  )}
                  {patient.family_medical_history.mental_illness && (
                    <div className="flex items-center gap-2 p-3 bg-indigo-50 border border-indigo-200 rounded-lg">
                      <Activity className="w-4 h-4 text-indigo-600" />
                      <span className="text-sm font-medium text-indigo-900">Mental Illness</span>
                    </div>
                  )}
                </div>

                {patient.family_medical_history.other_conditions?.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="font-semibold text-sm text-gray-700">Other Family Conditions:</h4>
                    {patient.family_medical_history.other_conditions.map((item, idx) => (
                      <div key={idx} className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
                        <p className="font-medium text-gray-900">{sanitizeInput(item.condition)}</p>
                        {item.relation && (
                          <p className="text-sm text-gray-600">Relation: {sanitizeInput(item.relation)}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {patient.family_medical_history.notes && (
                  <Alert className="bg-blue-50 border-blue-200">
                    <AlertDescription className="text-sm text-blue-900">
                      {sanitizeInput(patient.family_medical_history.notes)}
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                <Users className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p>No family medical history documented</p>
              </div>
            )}
          </TabsContent>

          {/* Social Determinants Tab */}
          <TabsContent value="social" className="space-y-4">
            {hasSocialDeterminants ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {patient.social_determinants.housing_stability && (
                    <div className={`p-4 rounded-lg border-2 ${
                      patient.social_determinants.housing_stability === 'stable' ? 'bg-green-50 border-green-300' :
                      patient.social_determinants.housing_stability === 'unstable' ? 'bg-yellow-50 border-yellow-300' :
                      'bg-red-50 border-red-300'
                    }`}>
                      <div className="flex items-center gap-2 mb-1">
                        <Home className={`w-4 h-4 ${
                          patient.social_determinants.housing_stability === 'stable' ? 'text-green-600' :
                          patient.social_determinants.housing_stability === 'unstable' ? 'text-yellow-600' :
                          'text-red-600'
                        }`} />
                        <span className="font-semibold text-sm">Housing</span>
                      </div>
                      <p className="text-sm capitalize">{patient.social_determinants.housing_stability.replace('_', ' ')}</p>
                    </div>
                  )}

                  {patient.social_determinants.food_security && (
                    <div className={`p-4 rounded-lg border-2 ${
                      patient.social_determinants.food_security === 'secure' ? 'bg-green-50 border-green-300' :
                      patient.social_determinants.food_security === 'insecure' ? 'bg-yellow-50 border-yellow-300' :
                      'bg-red-50 border-red-300'
                    }`}>
                      <div className="flex items-center gap-2 mb-1">
                        <CheckCircle2 className={`w-4 h-4 ${
                          patient.social_determinants.food_security === 'secure' ? 'text-green-600' :
                          patient.social_determinants.food_security === 'insecure' ? 'text-yellow-600' :
                          'text-red-600'
                        }`} />
                        <span className="font-semibold text-sm">Food Security</span>
                      </div>
                      <p className="text-sm capitalize">{patient.social_determinants.food_security.replace('_', ' ')}</p>
                    </div>
                  )}

                  {patient.social_determinants.financial_strain && (
                    <div className={`p-4 rounded-lg border-2 ${
                      patient.social_determinants.financial_strain === 'none' ? 'bg-green-50 border-green-300' :
                      patient.social_determinants.financial_strain === 'mild' || patient.social_determinants.financial_strain === 'moderate' ? 'bg-yellow-50 border-yellow-300' :
                      'bg-red-50 border-red-300'
                    }`}>
                      <span className="font-semibold text-sm block mb-1">Financial Strain</span>
                      <p className="text-sm capitalize">{patient.social_determinants.financial_strain}</p>
                    </div>
                  )}

                  {patient.social_determinants.social_isolation && (
                    <div className={`p-4 rounded-lg border-2 ${
                      patient.social_determinants.social_isolation === 'well_connected' ? 'bg-green-50 border-green-300' :
                      patient.social_determinants.social_isolation === 'some_isolation' ? 'bg-yellow-50 border-yellow-300' :
                      'bg-red-50 border-red-300'
                    }`}>
                      <div className="flex items-center gap-2 mb-1">
                        <Users className={`w-4 h-4 ${
                          patient.social_determinants.social_isolation === 'well_connected' ? 'text-green-600' :
                          patient.social_determinants.social_isolation === 'some_isolation' ? 'text-yellow-600' :
                          'text-red-600'
                        }`} />
                        <span className="font-semibold text-sm">Social Connection</span>
                      </div>
                      <p className="text-sm capitalize">{patient.social_determinants.social_isolation.replace('_', ' ')}</p>
                    </div>
                  )}

                  {patient.social_determinants.caregiver_burden && (
                    <div className={`p-4 rounded-lg border-2 ${
                      patient.social_determinants.caregiver_burden === 'low' ? 'bg-green-50 border-green-300' :
                      patient.social_determinants.caregiver_burden === 'moderate' ? 'bg-yellow-50 border-yellow-300' :
                      'bg-red-50 border-red-300'
                    }`}>
                      <span className="font-semibold text-sm block mb-1">Caregiver Burden</span>
                      <p className="text-sm capitalize">{patient.social_determinants.caregiver_burden}</p>
                    </div>
                  )}

                  {patient.social_determinants.health_literacy && (
                    <div className={`p-4 rounded-lg border-2 ${
                      patient.social_determinants.health_literacy === 'high' || patient.social_determinants.health_literacy === 'adequate' ? 'bg-green-50 border-green-300' :
                      'bg-yellow-50 border-yellow-300'
                    }`}>
                      <span className="font-semibold text-sm block mb-1">Health Literacy</span>
                      <p className="text-sm capitalize">{patient.social_determinants.health_literacy.replace('_', ' ')}</p>
                    </div>
                  )}

                  {patient.social_determinants.medication_access && (
                    <div className={`p-4 rounded-lg border-2 ${
                      patient.social_determinants.medication_access === 'no_barriers' ? 'bg-green-50 border-green-300' :
                      patient.social_determinants.medication_access === 'some_barriers' ? 'bg-yellow-50 border-yellow-300' :
                      'bg-red-50 border-red-300'
                    }`}>
                      <span className="font-semibold text-sm block mb-1">Medication Access</span>
                      <p className="text-sm capitalize">{patient.social_determinants.medication_access.replace('_', ' ')}</p>
                    </div>
                  )}

                  {patient.social_determinants.utilities_access !== undefined && (
                    <div className={`p-4 rounded-lg border-2 ${
                      patient.social_determinants.utilities_access ? 'bg-green-50 border-green-300' : 'bg-red-50 border-red-300'
                    }`}>
                      <span className="font-semibold text-sm block mb-1">Utilities Access</span>
                      <p className="text-sm">{patient.social_determinants.utilities_access ? 'Available' : 'Limited or Unavailable'}</p>
                    </div>
                  )}
                </div>

                {patient.social_determinants.notes && (
                  <Alert className="bg-blue-50 border-blue-200">
                    <AlertDescription className="text-sm text-blue-900">
                      <span className="font-semibold">Notes:</span> {sanitizeInput(patient.social_determinants.notes)}
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                <Home className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p>No social determinants documented</p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}