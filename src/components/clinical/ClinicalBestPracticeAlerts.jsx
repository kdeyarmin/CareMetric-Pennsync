import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Bell, AlertTriangle, CheckCircle2, TrendingDown, Activity, Clock, XCircle } from "lucide-react";

export default function ClinicalBestPracticeAlerts({ patient, visits = [] }) {
  const [alerts, setAlerts] = useState([]);

  useEffect(() => {
    if (patient) {
      generateAlerts();
    }
  }, [patient, visits]);

  const generateAlerts = () => {
    const newAlerts = [];
    const recentVisits = visits.slice(0, 5);

    // Alert: Missing vital signs documentation
    if (recentVisits.some(v => !v.vital_signs || Object.keys(v.vital_signs).length < 3)) {
      newAlerts.push({
        id: 'vital_signs_incomplete',
        severity: 'high',
        category: 'Documentation',
        title: 'Incomplete Vital Signs Documentation',
        description: 'Recent visits have incomplete vital signs. Medicare requires comprehensive vital signs for skilled nursing visits.',
        recommendation: 'Ensure BP, HR, RR, temp, and O2 sat are documented at each visit',
        icon: Activity
      });
    }

    // Alert: Fall risk without intervention
    if (patient.functional_status?.fall_risk === 'high' && 
        !patient.care_plans?.some(cp => cp.problem?.toLowerCase().includes('fall'))) {
      newAlerts.push({
        id: 'fall_risk_no_plan',
        severity: 'critical',
        category: 'Safety',
        title: 'High Fall Risk Without Care Plan',
        description: 'Patient identified as high fall risk but no fall prevention care plan documented.',
        recommendation: 'Create fall prevention care plan with interventions (walker assessment, home safety evaluation, strength training)',
        icon: AlertTriangle
      });
    }

    // Alert: Polypharmacy risk
    if (patient.current_medications?.length >= 10) {
      newAlerts.push({
        id: 'polypharmacy',
        severity: 'moderate',
        category: 'Medication Safety',
        title: 'Polypharmacy Alert',
        description: `Patient is on ${patient.current_medications.length} medications, increasing risk of adverse drug events.`,
        recommendation: 'Review medication list for potential deprescribing opportunities. Consult with pharmacist or physician.',
        icon: AlertTriangle
      });
    }

    // Alert: Missing pressure injury assessment
    if (patient.functional_status?.ambulation === 'bedbound' && 
        (!patient.wounds || patient.wounds.length === 0)) {
      newAlerts.push({
        id: 'pressure_injury_screening',
        severity: 'high',
        category: 'Wound Care',
        title: 'Pressure Injury Screening Required',
        description: 'Bedbound patient without documented pressure injury assessment.',
        recommendation: 'Complete Braden Scale assessment and document skin integrity at all pressure points',
        icon: Activity
      });
    }

    // Alert: Declining vital signs trend
    if (recentVisits.length >= 3) {
      const bpReadings = recentVisits
        .filter(v => v.vital_signs?.blood_pressure_systolic)
        .map(v => v.vital_signs.blood_pressure_systolic);
      
      if (bpReadings.length >= 3) {
        const trend = bpReadings[0] - bpReadings[bpReadings.length - 1];
        if (trend > 30) {
          newAlerts.push({
            id: 'bp_declining',
            severity: 'high',
            category: 'Clinical Status',
            title: 'Blood Pressure Trend Alert',
            description: 'Systolic BP has decreased significantly over recent visits.',
            recommendation: 'Assess for orthostatic hypotension, review medications (antihypertensives), notify physician',
            icon: TrendingDown
          });
        }
      }
    }

    // Alert: Missing medication reconciliation
    const daysSinceLastVisit = recentVisits[0] ? 
      Math.floor((new Date() - new Date(recentVisits[0].visit_date)) / (1000 * 60 * 60 * 24)) : 999;
    
    if (daysSinceLastVisit > 14 && patient.current_medications?.length > 0) {
      newAlerts.push({
        id: 'med_reconciliation_due',
        severity: 'moderate',
        category: 'Medication Safety',
        title: 'Medication Reconciliation Due',
        description: 'Medication list should be reconciled regularly (at minimum every 2 weeks).',
        recommendation: 'Review and update medication list with patient/caregiver. Document any changes or adherence issues.',
        icon: Clock
      });
    }

    // Alert: Social isolation risk
    if (patient.social_determinants?.social_isolation === 'isolated' || 
        patient.social_determinants?.social_isolation === 'severely_isolated') {
      newAlerts.push({
        id: 'social_isolation',
        severity: 'moderate',
        category: 'Social Determinants',
        title: 'Social Isolation Risk',
        description: 'Patient experiencing social isolation, which impacts health outcomes and recovery.',
        recommendation: 'Refer to social work, assess caregiver support, consider community resources or day programs',
        icon: Activity
      });
    }

    // Alert: Missing advance directives
    if (!patient.advance_directives?.has_living_will && 
        !patient.advance_directives?.has_healthcare_proxy) {
      newAlerts.push({
        id: 'advance_directives',
        severity: 'low',
        category: 'Documentation',
        title: 'Advance Directives Not Documented',
        description: 'No advance care planning documentation on file.',
        recommendation: 'Discuss advance directives with patient/family. Document wishes for end-of-life care.',
        icon: Activity
      });
    }

    setAlerts(newAlerts);
  };

  const getSeverityConfig = (severity) => {
    switch (severity) {
      case 'critical':
        return { color: 'bg-red-600 text-white', border: 'border-red-500', bg: 'bg-red-50', icon: XCircle };
      case 'high':
        return { color: 'bg-orange-500 text-white', border: 'border-orange-500', bg: 'bg-orange-50', icon: AlertTriangle };
      case 'moderate':
        return { color: 'bg-yellow-500 text-white', border: 'border-yellow-500', bg: 'bg-yellow-50', icon: Bell };
      default:
        return { color: 'bg-blue-500 text-white', border: 'border-blue-500', bg: 'bg-blue-50', icon: Bell };
    }
  };

  const criticalAlerts = alerts.filter(a => a.severity === 'critical');
  const highAlerts = alerts.filter(a => a.severity === 'high');
  const moderateAlerts = alerts.filter(a => a.severity === 'moderate');
  const lowAlerts = alerts.filter(a => a.severity === 'low');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-amber-600" />
            Clinical Best Practice Alerts
          </div>
          <Badge variant="outline" className="text-lg">
            {alerts.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {alerts.length === 0 ? (
          <Alert className="bg-green-50 border-green-200">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            <AlertDescription className="text-green-900">
              <p className="font-semibold">No Active Alerts</p>
              <p className="text-sm">Current care meets best practice guidelines</p>
            </AlertDescription>
          </Alert>
        ) : (
          <ScrollArea className="max-h-[600px]">
            <div className="space-y-4">
              {/* Critical Alerts */}
              {criticalAlerts.length > 0 && (
                <div>
                  <h3 className="font-semibold text-red-600 mb-2 flex items-center gap-2">
                    <XCircle className="w-4 h-4" />
                    Critical ({criticalAlerts.length})
                  </h3>
                  <div className="space-y-2">
                    {criticalAlerts.map((alert) => {
                      const config = getSeverityConfig(alert.severity);
                      return (
                        <Card key={alert.id} className={`border-l-4 ${config.border} ${config.bg}`}>
                          <CardContent className="p-4">
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <h4 className="font-semibold text-gray-900">{alert.title}</h4>
                              <Badge className={config.color}>{alert.category}</Badge>
                            </div>
                            <p className="text-sm text-gray-700 mb-2">{alert.description}</p>
                            <Alert className="bg-white border-gray-200 mt-2">
                              <CheckCircle2 className="w-4 h-4 text-blue-600" />
                              <AlertDescription className="text-blue-900 text-sm">
                                <span className="font-semibold">Action:</span> {alert.recommendation}
                              </AlertDescription>
                            </Alert>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* High Priority Alerts */}
              {highAlerts.length > 0 && (
                <div>
                  <h3 className="font-semibold text-orange-600 mb-2 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" />
                    High Priority ({highAlerts.length})
                  </h3>
                  <div className="space-y-2">
                    {highAlerts.map((alert) => {
                      const config = getSeverityConfig(alert.severity);
                      return (
                        <Card key={alert.id} className={`border-l-4 ${config.border} ${config.bg}`}>
                          <CardContent className="p-4">
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <h4 className="font-semibold text-gray-900">{alert.title}</h4>
                              <Badge className={config.color}>{alert.category}</Badge>
                            </div>
                            <p className="text-sm text-gray-700 mb-2">{alert.description}</p>
                            <Alert className="bg-white border-gray-200 mt-2">
                              <CheckCircle2 className="w-4 h-4 text-blue-600" />
                              <AlertDescription className="text-blue-900 text-sm">
                                <span className="font-semibold">Action:</span> {alert.recommendation}
                              </AlertDescription>
                            </Alert>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Moderate Alerts */}
              {moderateAlerts.length > 0 && (
                <div>
                  <h3 className="font-semibold text-yellow-600 mb-2 flex items-center gap-2">
                    <Bell className="w-4 h-4" />
                    Moderate ({moderateAlerts.length})
                  </h3>
                  <div className="space-y-2">
                    {moderateAlerts.map((alert) => {
                      const config = getSeverityConfig(alert.severity);
                      return (
                        <Card key={alert.id} className={`border-l-4 ${config.border} ${config.bg}`}>
                          <CardContent className="p-3">
                            <div className="flex items-start justify-between gap-2 mb-1">
                              <h4 className="font-medium text-gray-900 text-sm">{alert.title}</h4>
                              <Badge className={config.color} size="sm">{alert.category}</Badge>
                            </div>
                            <p className="text-xs text-gray-600 mb-2">{alert.description}</p>
                            <p className="text-xs text-blue-900">
                              <span className="font-semibold">Action:</span> {alert.recommendation}
                            </p>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Low Priority Alerts */}
              {lowAlerts.length > 0 && (
                <div>
                  <h3 className="font-semibold text-blue-600 mb-2 flex items-center gap-2">
                    <Bell className="w-4 h-4" />
                    Low Priority ({lowAlerts.length})
                  </h3>
                  <div className="space-y-2">
                    {lowAlerts.map((alert) => {
                      const config = getSeverityConfig(alert.severity);
                      return (
                        <Card key={alert.id} className={`border-l-4 ${config.border}`}>
                          <CardContent className="p-3">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1">
                                <h4 className="font-medium text-gray-900 text-sm">{alert.title}</h4>
                                <p className="text-xs text-gray-600 mt-1">{alert.recommendation}</p>
                              </div>
                              <Badge className={config.color} size="sm">{alert.category}</Badge>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}