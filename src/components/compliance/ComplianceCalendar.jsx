import { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Calendar as CalendarIcon,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Bell,
  FileText,
  Users,
  ClipboardList,
  Filter,
  Download
} from "lucide-react";
import { 
  format, 
  parseISO, 
  addDays, 
  differenceInDays, 
  isBefore,
  isAfter,
  startOfDay
} from "date-fns";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { toCsvRows } from "@/components/admin/csvExport";

export default function ComplianceCalendar() {
  const [filterUrgency, setFilterUrgency] = useState("all");
  const [filterType, setFilterType] = useState("all");
  const [_selectedView, _setSelectedView] = useState("list");

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: patients = [] } = useQuery({
    queryKey: ['allPatients'],
    queryFn: () => base44.entities.Patient.list('-updated_date', 2000),
    initialData: [],
  });

  const { data: visits = [] } = useQuery({
    queryKey: ['allVisits'],
    queryFn: () => base44.entities.Visit.list('-visit_date', 1000),
    initialData: [],
  });

  // Calculate compliance alerts
  const complianceAlerts = useMemo(() => {
    const alerts = [];
    const today = startOfDay(new Date());

    patients.forEach(patient => {
      if (patient.status !== 'active') return;

      const patientVisits = visits.filter(v => v.patient_id === patient.id);
      
      const admissionVisit = patientVisits.find(v => v.visit_type === 'admission');
      if (!admissionVisit) return;

      const admissionDate = parseISO(admissionVisit.visit_date);

      const recertVisits = patientVisits
        .filter(v => v.visit_type === 'recertification')
        .sort((a, b) => new Date(b.visit_date) - new Date(a.visit_date));
      
      const lastRecertDate = recertVisits.length > 0 
        ? parseISO(recertVisits[0].visit_date)
        : admissionDate;

      // 60-day Recertification
      const recertDueDate = addDays(lastRecertDate, 60);
      const daysUntilRecert = differenceInDays(recertDueDate, today);

      if (daysUntilRecert <= 14 && daysUntilRecert >= -7) {
        alerts.push({
          id: `recert-${patient.id}`,
          type: 'recertification',
          patient: patient,
          title: 'Recertification Due',
          description: `60-day recertification period ending`,
          dueDate: recertDueDate,
          daysRemaining: daysUntilRecert,
          urgency: daysUntilRecert <= 3 ? 'critical' : daysUntilRecert <= 7 ? 'warning' : 'upcoming',
          action: 'Schedule recertification visit',
          details: {
            currentPeriodStart: lastRecertDate,
            nextPeriodStart: addDays(lastRecertDate, 61)
          }
        });
      }

      // Face-to-Face Encounter
      const f2fDueDate = addDays(recertDueDate, -30);
      const daysUntilF2F = differenceInDays(f2fDueDate, today);

      if (daysUntilF2F <= 14 && daysUntilF2F >= -30) {
        const f2fCompleted = patientVisits.some(v => 
          v.visit_type === 'recertification' && 
          isBefore(parseISO(v.visit_date), recertDueDate) &&
          isAfter(parseISO(v.visit_date), addDays(recertDueDate, -30))
        );

        if (!f2fCompleted) {
          alerts.push({
            id: `f2f-${patient.id}`,
            type: 'face_to_face',
            patient: patient,
            title: 'Face-to-Face Encounter Required',
            description: 'Physician encounter needed 30 days before recert',
            dueDate: f2fDueDate,
            daysRemaining: daysUntilF2F,
            urgency: daysUntilF2F <= 3 ? 'critical' : daysUntilF2F <= 7 ? 'warning' : 'upcoming',
            action: 'Coordinate physician encounter',
            details: {
              windowStart: addDays(recertDueDate, -30),
              windowEnd: recertDueDate,
              recertDate: recertDueDate
            }
          });
        }
      }

      // OASIS Assessment
      if (patient.care_type === 'home_health') {
        const oasisWindowStart = addDays(recertDueDate, -5);
        const daysUntilOASIS = differenceInDays(oasisWindowStart, today);

        if (daysUntilOASIS <= 10 && daysUntilOASIS >= -5) {
          alerts.push({
            id: `oasis-${patient.id}`,
            type: 'oasis',
            patient: patient,
            title: 'OASIS Assessment Window',
            description: 'OASIS recertification assessment due',
            dueDate: oasisWindowStart,
            daysRemaining: daysUntilOASIS,
            urgency: daysUntilOASIS <= 2 ? 'critical' : daysUntilOASIS <= 5 ? 'warning' : 'upcoming',
            action: 'Complete OASIS assessment',
            details: {
              windowStart: oasisWindowStart,
              windowEnd: recertDueDate,
              assessmentType: 'Recertification'
            }
          });
        }
      }

      // Physician Orders Review (every 60 days)
      const ordersDueDate = addDays(lastRecertDate, 60);
      const daysUntilOrders = differenceInDays(ordersDueDate, today);

      if (daysUntilOrders <= 10 && daysUntilOrders >= -5) {
        alerts.push({
          id: `orders-${patient.id}`,
          type: 'orders',
          patient: patient,
          title: 'Physician Orders Review',
          description: 'Verify current physician orders',
          dueDate: ordersDueDate,
          daysRemaining: daysUntilOrders,
          urgency: daysUntilOrders <= 3 ? 'critical' : daysUntilOrders <= 7 ? 'warning' : 'upcoming',
          action: 'Review and update orders',
          details: {
            lastReview: lastRecertDate
          }
        });
      }

      // Visit Frequency Check
      const recentPatientVisits = patientVisits
        .filter(v => v.status === 'completed')
        .sort((a, b) => new Date(b.visit_date) - new Date(a.visit_date));

      if (recentPatientVisits.length > 0) {
        const lastVisit = parseISO(recentPatientVisits[0].visit_date);
        const daysSinceLastVisit = differenceInDays(today, lastVisit);

        if (daysSinceLastVisit >= 7) {
          alerts.push({
            id: `visit-freq-${patient.id}`,
            type: 'visit_frequency',
            patient: patient,
            title: 'Visit Frequency Alert',
            description: `${daysSinceLastVisit} days since last visit`,
            dueDate: addDays(lastVisit, 7),
            daysRemaining: -daysSinceLastVisit + 7,
            urgency: daysSinceLastVisit >= 14 ? 'critical' : 'warning',
            action: 'Schedule next visit',
            details: {
              lastVisitDate: lastVisit,
              daysSinceLastVisit
            }
          });
        }
      }
    });

    return alerts.sort((a, b) => a.daysRemaining - b.daysRemaining);
  }, [patients, visits]);

  // Filter alerts
  const filteredAlerts = useMemo(() => {
    return complianceAlerts.filter(alert => {
      if (filterUrgency !== 'all' && alert.urgency !== filterUrgency) return false;
      if (filterType !== 'all' && alert.type !== filterType) return false;
      return true;
    });
  }, [complianceAlerts, filterUrgency, filterType]);

  // Group alerts by urgency
  const alertsByUrgency = useMemo(() => {
    return {
      critical: filteredAlerts.filter(a => a.urgency === 'critical'),
      warning: filteredAlerts.filter(a => a.urgency === 'warning'),
      upcoming: filteredAlerts.filter(a => a.urgency === 'upcoming')
    };
  }, [filteredAlerts]);

  // Export function
  const exportComplianceReport = () => {
    // Build via toCsvRows so patient names/descriptions (free text) are escaped
    // and formula-injection-neutralized rather than raw-interpolated.
    const csvContent = toCsvRows([
      ['Penn Sync Medicare Compliance Report'],
      [`Generated: ${format(new Date(), 'PPpp')}`],
      [`Total Alerts: ${complianceAlerts.length}`],
      [],
      ['Patient', 'MRN', 'Alert Type', 'Description', 'Due Date', 'Days Remaining', 'Urgency', 'Action Required'],
      ...complianceAlerts.map(alert => [
        `${alert.patient.first_name} ${alert.patient.last_name}`,
        alert.patient.medical_record_number || 'N/A',
        alert.type,
        alert.description,
        format(alert.dueDate, 'MM/dd/yyyy'),
        alert.daysRemaining,
        alert.urgency,
        alert.action,
      ]),
    ]);

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `penn-sync-compliance-report-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
  };

  const getUrgencyColor = (urgency) => {
    switch (urgency) {
      case 'critical': return 'bg-red-100 border-red-300 text-red-900';
      case 'warning': return 'bg-yellow-100 border-yellow-300 text-yellow-900';
      case 'upcoming': return 'bg-blue-100 border-blue-300 text-blue-900';
      default: return 'bg-slate-100 border-slate-300 text-slate-900';
    }
  };

  const getUrgencyBadge = (urgency) => {
    switch (urgency) {
      case 'critical': return 'bg-red-600';
      case 'warning': return 'bg-yellow-500';
      case 'upcoming': return 'bg-blue-500';
      default: return 'bg-slate-500';
    }
  };

  const getTypeIcon = (type) => {
    switch (type) {
      case 'recertification': return CalendarIcon;
      case 'face_to_face': return Users;
      case 'oasis': return FileText;
      case 'orders': return ClipboardList;
      case 'visit_frequency': return Clock;
      default: return Bell;
    }
  };

  const getTypeLabel = (type) => {
    const labels = {
      recertification: 'Recertification',
      face_to_face: 'Face-to-Face',
      oasis: 'OASIS Assessment',
      orders: 'Physician Orders',
      visit_frequency: 'Visit Frequency'
    };
    return labels[type] || type;
  };

  if (!currentUser) {
    return (
      <Card>
        <CardContent className="p-12 text-center text-slate-500">
          Loading compliance data...
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="bg-gradient-to-br from-red-500 to-red-600 text-white border-none">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-red-100 text-sm mb-1">Critical</p>
                <p className="text-4xl font-bold">{alertsByUrgency.critical.length}</p>
              </div>
              <AlertTriangle className="w-12 h-12 text-red-200" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-yellow-500 to-yellow-600 text-white border-none">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-yellow-100 text-sm mb-1">Warning</p>
                <p className="text-4xl font-bold">{alertsByUrgency.warning.length}</p>
              </div>
              <Clock className="w-12 h-12 text-yellow-200" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-blue-500 to-blue-600 text-white border-none">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-blue-100 text-sm mb-1">Upcoming</p>
                <p className="text-4xl font-bold">{alertsByUrgency.upcoming.length}</p>
              </div>
              <CalendarIcon className="w-12 h-12 text-blue-200" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-500 to-green-600 text-white border-none">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-green-100 text-sm mb-1">Total Alerts</p>
                <p className="text-4xl font-bold">{complianceAlerts.length}</p>
              </div>
              <Bell className="w-12 h-12 text-green-200" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters and Actions */}
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Filter className="w-5 h-5 text-slate-500" />
              <span className="text-sm font-medium text-slate-700">Filters:</span>
            </div>

            <Select value={filterUrgency} onValueChange={setFilterUrgency}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Urgency" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Urgency</SelectItem>
                <SelectItem value="critical">Critical Only</SelectItem>
                <SelectItem value="warning">Warning Only</SelectItem>
                <SelectItem value="upcoming">Upcoming Only</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="recertification">Recertification</SelectItem>
                <SelectItem value="face_to_face">Face-to-Face</SelectItem>
                <SelectItem value="oasis">OASIS</SelectItem>
                <SelectItem value="orders">Physician Orders</SelectItem>
                <SelectItem value="visit_frequency">Visit Frequency</SelectItem>
              </SelectContent>
            </Select>

            <div className="ml-auto flex gap-2">
              <Button
                variant="outline"
                onClick={exportComplianceReport}
                className="gap-2"
              >
                <Download className="w-4 h-4" />
                Export Report
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Alerts List */}
      {filteredAlerts.length === 0 ? (
        <Card className="border-2 border-dashed border-slate-200">
          <CardContent className="p-12 text-center">
            <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-slate-900 mb-2">
              All Clear!
            </h3>
            <p className="text-slate-600">
              No compliance alerts match your current filters.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredAlerts.map((alert) => {
            const TypeIcon = getTypeIcon(alert.type);
            
            return (
              <Card 
                key={alert.id} 
                className={`border-l-4 ${getUrgencyColor(alert.urgency)}`}
              >
                <CardContent className="p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4 flex-1">
                      <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${getUrgencyBadge(alert.urgency)}`}>
                        <TypeIcon className="w-6 h-6 text-white" />
                      </div>

                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="text-lg font-bold text-slate-900">
                            {alert.title}
                          </h3>
                          <Badge className={getUrgencyBadge(alert.urgency)}>
                            {alert.urgency.toUpperCase()}
                          </Badge>
                          <Badge variant="outline">
                            {getTypeLabel(alert.type)}
                          </Badge>
                        </div>

                        <p className="text-slate-700 mb-3">
                          <strong>Patient:</strong> {alert.patient.first_name} {alert.patient.last_name}
                          {alert.patient.medical_record_number && ` (MRN: ${alert.patient.medical_record_number})`}
                        </p>

                        <p className="text-slate-600 mb-3">
                          {alert.description}
                        </p>

                        <div className="flex flex-wrap gap-4 text-sm text-slate-600">
                          <div className="flex items-center gap-1">
                            <CalendarIcon className="w-4 h-4" />
                            <span>Due: {format(alert.dueDate, 'MMM d, yyyy')}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Clock className="w-4 h-4" />
                            <span>
                              {alert.daysRemaining < 0 
                                ? `${Math.abs(alert.daysRemaining)} days overdue`
                                : alert.daysRemaining === 0
                                ? 'DUE TODAY'
                                : `${alert.daysRemaining} days remaining`}
                            </span>
                          </div>
                        </div>

                        {alert.details && (
                          <div className="mt-3 p-3 bg-white bg-opacity-50 rounded-lg text-sm">
                            <p className="font-medium text-slate-700 mb-1">Details:</p>
                            <ul className="list-disc list-inside space-y-1 text-slate-600">
                              {Object.entries(alert.details).map(([key, value]) => (
                                <li key={key}>
                                  {key.replace(/_/g, ' ')}: {
                                    value instanceof Date 
                                      ? format(value, 'MMM d, yyyy')
                                      : typeof value === 'string' && value.match && value.match(/^\d{4}-\d{2}-\d{2}/)
                                      ? format(parseISO(value), 'MMM d, yyyy')
                                      : String(value)
                                  }
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col gap-2">
                      <Link to={`${createPageUrl("PatientDetails")}?patientId=${alert.patient.id}`}>
                        <Button size="sm" className="w-full">
                          View Patient
                        </Button>
                      </Link>
                      <Button asChild size="sm" variant="outline" className="w-full">
                        <Link to={`${createPageUrl("PatientDetails")}?patientId=${alert.patient.id}`} title={alert.action}>
                          {alert.action}
                        </Link>
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}