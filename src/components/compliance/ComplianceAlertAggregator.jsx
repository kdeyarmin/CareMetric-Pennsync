import { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { createPageUrl } from "@/utils";
import {
  AlertTriangle,
  FileText,
  Shield,
  TrendingUp,
  Calendar,
  Bell,
  CheckCircle2,
  XCircle
} from "lucide-react";
import { format, differenceInDays, addDays } from "date-fns";

export default function ComplianceAlertAggregator() {
  const [dismissedAlerts, setDismissedAlerts] = useState([]);

  const { data: patients } = useQuery({
    queryKey: ['compliancePatients'],
    queryFn: () => base44.entities.Patient.filter({ status: 'active' }),
    initialData: [],
  });

  const { data: visits } = useQuery({
    queryKey: ['complianceVisits'],
    queryFn: () => base44.entities.Visit.list('-visit_date', 200),
    initialData: [],
  });

  const { data: carePlans } = useQuery({
    queryKey: ['complianceCarePlans'],
    queryFn: () => base44.entities.CarePlan.list(),
    initialData: [],
  });

  const { data: incidents } = useQuery({
    queryKey: ['complianceIncidents'],
    queryFn: () => base44.entities.Incident.filter({ status: 'reported' }),
    initialData: [],
  });

  const { data: securityLogs } = useQuery({
    queryKey: ['complianceSecurityLogs'],
    queryFn: () => base44.entities.SecurityLog.list('-timestamp', 50),
    initialData: [],
  });

  const aggregatedAlerts = useMemo(() => {
    const alerts = [];
    const today = new Date();

    // Visit Documentation Deadlines
    visits.forEach(visit => {
      if (visit.status === 'scheduled' || visit.status === 'in_progress') {
        const visitDate = new Date(visit.visit_date);
        const daysSince = differenceInDays(today, visitDate);
        
        if (daysSince > 0 && visit.status !== 'completed') {
          const patient = patients.find(p => p.id === visit.patient_id);
          alerts.push({
            id: `visit-overdue-${visit.id}`,
            type: 'documentation',
            severity: daysSince > 2 ? 'critical' : 'warning',
            title: 'Overdue Visit Documentation',
            message: `Visit for ${patient?.first_name || 'Patient'} ${patient?.last_name || ''} on ${format(visitDate, 'MMM d')} needs documentation`,
            daysOverdue: daysSince,
            link: `${createPageUrl("ClinicalDocumentation")}?visitId=${visit.id}`,
            linkText: 'Document Now',
            category: 'Documentation'
          });
        }
      }
    });

    // Recertification Due
    patients.forEach(patient => {
      const patientVisits = visits.filter(v => v.patient_id === patient.id);
      const lastRecert = patientVisits.find(v => v.visit_type === 'recertification' || v.visit_type === 'admission');
      
      if (lastRecert) {
        const recertDate = new Date(lastRecert.visit_date);
        const nextRecertDue = addDays(recertDate, 60);
        const daysUntil = differenceInDays(nextRecertDue, today);
        
        if (daysUntil <= 14 && daysUntil > 0) {
          alerts.push({
            id: `recert-${patient.id}`,
            type: 'recertification',
            severity: daysUntil <= 7 ? 'critical' : 'warning',
            title: 'Recertification Due Soon',
            message: `${patient.first_name} ${patient.last_name} - recertification due in ${daysUntil} days`,
            dueDate: nextRecertDue,
            link: `${createPageUrl("PatientDetails")}?patientId=${patient.id}`,
            linkText: 'View Patient',
            category: 'Recertification'
          });
        } else if (daysUntil <= 0) {
          alerts.push({
            id: `recert-overdue-${patient.id}`,
            type: 'recertification',
            severity: 'critical',
            title: 'Recertification Overdue',
            message: `${patient.first_name} ${patient.last_name} - recertification ${Math.abs(daysUntil)} days overdue`,
            dueDate: nextRecertDue,
            link: `${createPageUrl("PatientDetails")}?patientId=${patient.id}`,
            linkText: 'Schedule Recert',
            category: 'Recertification'
          });
        }
      }
    });

    // Care Plan Reviews
    carePlans.forEach(cp => {
      if (cp.status === 'active' && cp.target_date) {
        const targetDate = new Date(cp.target_date);
        const daysUntil = differenceInDays(targetDate, today);
        
        if (daysUntil <= 7 && daysUntil > 0) {
          const patient = patients.find(p => p.id === cp.patient_id);
          alerts.push({
            id: `careplan-${cp.id}`,
            type: 'careplan',
            severity: 'info',
            title: 'Care Plan Goal Due',
            message: `${patient?.first_name || 'Patient'}'s goal "${cp.goal?.substring(0, 40)}..." due in ${daysUntil} days`,
            dueDate: targetDate,
            link: createPageUrl("CarePlanManagement"),
            linkText: 'Review',
            category: 'Care Plans'
          });
        }
      }
    });

    // Unresolved Incidents
    incidents.forEach(incident => {
      const patient = patients.find(p => p.id === incident.patient_id);
      const daysSince = differenceInDays(today, new Date(incident.incident_date));
      
      alerts.push({
        id: `incident-${incident.id}`,
        type: 'incident',
        severity: incident.severity === 'high' ? 'critical' : 'warning',
        title: `Unresolved ${(incident.incident_type || 'incident').replace(/_/g, ' ')} Incident`,
        message: `${patient?.first_name || 'Patient'} ${patient?.last_name || ''} - reported ${daysSince} days ago`,
        daysAgo: daysSince,
        link: `${createPageUrl("PatientDetails")}?patientId=${incident.patient_id}`,
        linkText: 'Review',
        category: 'Incidents'
      });
    });

    // Security Alerts
    const recentSecurityEvents = securityLogs.filter(log => {
      const logDate = new Date(log.timestamp);
      return differenceInDays(today, logDate) <= 7 && 
             (log.action?.includes('UNAUTHORIZED') || log.action?.includes('FAILED') || log.action?.includes('ERROR'));
    });

    if (recentSecurityEvents.length > 0) {
      alerts.push({
        id: 'security-alerts',
        type: 'security',
        severity: 'warning',
        title: 'Security Events Detected',
        message: `${recentSecurityEvents.length} security event(s) in the last 7 days require review`,
        count: recentSecurityEvents.length,
        link: createPageUrl("AdminOperations"),
        linkText: 'View Logs',
        category: 'Security'
      });
    }

    // Quality Measure Alerts (visits without proper documentation)
    const incompleteVisits = visits.filter(v => 
      v.status === 'completed' && 
      (!v.nurse_notes || v.nurse_notes.length < 100)
    );
    
    if (incompleteVisits.length > 0) {
      alerts.push({
        id: 'quality-documentation',
        type: 'quality',
        severity: 'warning',
        title: 'Incomplete Visit Documentation',
        message: `${incompleteVisits.length} completed visit(s) have minimal documentation`,
        count: incompleteVisits.length,
        link: createPageUrl("ComplianceCenter"),
        linkText: 'Review Quality',
        category: 'Quality Measures'
      });
    }

    // Filter dismissed and sort by severity
    const severityOrder = { critical: 0, warning: 1, info: 2 };
    return alerts
      .filter(a => !dismissedAlerts.includes(a.id))
      .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  }, [patients, visits, carePlans, incidents, securityLogs, dismissedAlerts]);

  const alertCounts = useMemo(() => ({
    critical: aggregatedAlerts.filter(a => a.severity === 'critical').length,
    warning: aggregatedAlerts.filter(a => a.severity === 'warning').length,
    info: aggregatedAlerts.filter(a => a.severity === 'info').length,
    total: aggregatedAlerts.length
  }), [aggregatedAlerts]);

  const getSeverityIcon = (severity) => {
    switch (severity) {
      case 'critical': return <XCircle className="w-5 h-5 text-red-600" />;
      case 'warning': return <AlertTriangle className="w-5 h-5 text-orange-600" />;
      case 'info': return <Bell className="w-5 h-5 text-blue-600" />;
      default: return <Bell className="w-5 h-5" />;
    }
  };

  const getSeverityStyle = (severity) => {
    switch (severity) {
      case 'critical': return 'bg-red-50 border-red-300';
      case 'warning': return 'bg-orange-50 border-orange-300';
      case 'info': return 'bg-blue-50 border-blue-300';
      default: return 'bg-slate-50 border-slate-300';
    }
  };

  const getCategoryIcon = (category) => {
    switch (category) {
      case 'Documentation': return <FileText className="w-4 h-4" />;
      case 'Recertification': return <Calendar className="w-4 h-4" />;
      case 'Care Plans': return <TrendingUp className="w-4 h-4" />;
      case 'Incidents': return <AlertTriangle className="w-4 h-4" />;
      case 'Security': return <Shield className="w-4 h-4" />;
      case 'Quality Measures': return <CheckCircle2 className="w-4 h-4" />;
      default: return <Bell className="w-4 h-4" />;
    }
  };

  return {
    alerts: aggregatedAlerts,
    counts: alertCounts,
    dismissAlert: (id) => setDismissedAlerts([...dismissedAlerts, id]),
    getSeverityIcon,
    getSeverityStyle,
    getCategoryIcon
  };
}