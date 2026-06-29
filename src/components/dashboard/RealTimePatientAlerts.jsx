import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import {
  AlertTriangle,
  Clock,
  Target,
  ChevronRight,
  RefreshCw,
  Activity,
  Heart
} from "lucide-react";
import { format, differenceInDays, parseISO } from "date-fns";

const parseValidDate = (value) => {
  if (!value) return null;
  const date = parseISO(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
};

export default function RealTimePatientAlerts({ 
  patients = [], 
  visits = [], 
  carePlans = [],
  incidents = [],
  currentUser = null
}) {
  const [alerts, setAlerts] = useState([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const generateAlerts = useCallback(() => {
    const newAlerts = [];
    const today = new Date();

    // Get favorited patient IDs
    const favoritedPatientIds = currentUser?.favorited_patients?.map(p => p.id) || [];
    
    // Only check favorited patients - if none, show no alerts
    if (favoritedPatientIds.length === 0) {
      setAlerts([]);
      return;
    }
    
    const patientsToCheck = (patients || []).filter(p => favoritedPatientIds.includes(p.id));

    // Check each patient
    patientsToCheck.forEach(patient => {
      const patientVisits = (visits || []).filter(v => v.patient_id === patient.id);
      const patientCarePlans = (carePlans || []).filter(cp => cp.patient_id === patient.id);
      const patientIncidents = (incidents || []).filter(i => i.patient_id === patient.id);

      // Alert: No recent visits (>7 days)
      const lastVisit = patientVisits
        .filter(v => v.status === 'completed')
        .map(v => ({ visit: v, date: parseValidDate(v.visit_date) }))
        .filter(({ date }) => date)
        .sort((a, b) => b.date - a.date)[0];
      
      if (lastVisit) {
        const daysSinceVisit = differenceInDays(today, lastVisit.date);
        if (daysSinceVisit > 7) {
          newAlerts.push({
            type: 'overdue_visit',
            severity: daysSinceVisit > 14 ? 'high' : 'medium',
            patientId: patient.id,
            patientName: `${patient.first_name} ${patient.last_name}`,
            message: `No visit in ${daysSinceVisit} days`,
            icon: Clock
          });
        }
      }

      // Alert: Care plan goals approaching deadline
      patientCarePlans
        .filter(cp => cp.status === 'active' && cp.target_date)
        .forEach(cp => {
          const targetDate = parseValidDate(cp.target_date);
          if (!targetDate) return;
          const daysUntilTarget = differenceInDays(targetDate, today);
          if (daysUntilTarget <= 7 && daysUntilTarget >= 0) {
            newAlerts.push({
              type: 'goal_deadline',
              severity: daysUntilTarget <= 3 ? 'high' : 'medium',
              patientId: patient.id,
              patientName: `${patient.first_name} ${patient.last_name}`,
              message: `Goal due in ${daysUntilTarget} days: ${cp.problem?.substring(0, 40)}...`,
              icon: Target
            });
          }
        });

      // Alert: Recent incidents
      const recentIncidents = patientIncidents.filter(i => {
        const incidentDate = parseValidDate(i.incident_date);
        if (!incidentDate) return false;
        return differenceInDays(today, incidentDate) <= 3;
      });

      recentIncidents.forEach(incident => {
        const incidentDate = parseValidDate(incident.incident_date);
        if (!incidentDate) return;
        newAlerts.push({
          type: 'recent_incident',
          severity: 'high',
          patientId: patient.id,
          patientName: `${patient.first_name} ${patient.last_name}`,
          message: `Recent ${incident.incident_name || incident.incident_type}: ${format(incidentDate, 'MMM d')}`,
          icon: AlertTriangle
        });
      });

      // Alert: High-risk diagnosis
      const highRiskDiagnoses = ['CHF', 'COPD', 'Diabetes', 'Sepsis'];
      if (patient.primary_diagnosis && highRiskDiagnoses.some(d => 
        patient.primary_diagnosis.toLowerCase().includes(d.toLowerCase())
      )) {
        // Only show if no visit scheduled today
        const todayVisit = patientVisits.find(v => 
          v.visit_date === format(today, 'yyyy-MM-dd') && v.status !== 'cancelled'
        );
        if (!todayVisit && lastVisit) {
          const daysSince = differenceInDays(today, lastVisit.date);
          if (daysSince >= 3) {
            newAlerts.push({
              type: 'high_risk',
              severity: 'medium',
              patientId: patient.id,
              patientName: `${patient.first_name} ${patient.last_name}`,
              message: `High-risk patient (${patient.primary_diagnosis}) - last visit ${daysSince}d ago`,
              icon: Heart
            });
          }
        }
      }
    });

    // Sort by severity
    const severityOrder = { high: 0, medium: 1, low: 2 };
    newAlerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    setAlerts(newAlerts.slice(0, 10)); // Limit to 10 alerts
  }, [patients, visits, carePlans, incidents, currentUser]);

  useEffect(() => {
    generateAlerts();
  }, [generateAlerts]);

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'high': return 'bg-red-100 border-red-300 text-red-800';
      case 'medium': return 'bg-yellow-100 border-yellow-300 text-yellow-800';
      case 'low': return 'bg-blue-100 border-blue-300 text-blue-800';
      default: return 'bg-slate-100 border-slate-300 text-slate-800';
    }
  };

  if (alerts.length === 0) {
    return (
      <Card className="border-green-200 bg-green-50">
        <CardContent className="p-4 text-center">
          <Activity className="w-8 h-8 text-green-600 mx-auto mb-2" />
          <p className="text-sm text-green-800 font-medium">All patients on track</p>
          <p className="text-xs text-green-600">No urgent alerts at this time</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-orange-200">
      <CardHeader className="py-3 bg-gradient-to-r from-orange-50 to-red-50">
        <CardTitle className="text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-orange-600" />
            Patient Alerts
            <Badge className="bg-red-600 text-white">{alerts.length}</Badge>
          </div>
          <Button 
            size="sm" 
            variant="ghost" 
            className="h-6"
            onClick={() => {
              setIsRefreshing(true);
              generateAlerts();
              setTimeout(() => setIsRefreshing(false), 500);
            }}
          >
            <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-2 space-y-2 max-h-[300px] overflow-y-auto">
        {(alerts || []).map((alert, idx) => (
          <Link 
            key={idx} 
            to={`${createPageUrl("PatientDetails")}?id=${alert.patientId}`}
            className="block"
          >
            <Alert className={`${getSeverityColor(alert.severity)} cursor-pointer hover:opacity-80 transition-opacity`}>
              <alert.icon className="w-4 h-4" />
              <AlertDescription className="flex items-center justify-between">
                <div>
                  <span className="font-semibold">{alert.patientName}</span>
                  <span className="text-xs block">{alert.message}</span>
                </div>
                <ChevronRight className="w-4 h-4 shrink-0" />
              </AlertDescription>
            </Alert>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}