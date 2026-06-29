import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Phone,
  Calendar,
  FileText,
  AlertCircle,
  ChevronRight,
  Heart
} from "lucide-react";
import { createPageUrl } from "@/utils";
import { Link } from "react-router-dom";

export default function PatientOverviewCard({ patient, visits, carePlans, alerts, isSelected, onSelect, view }) {
  // Copy before sorting — sort() mutates in place, and `visits` is a prop owned
  // by the parent; reordering it as a render side effect corrupts the caller.
  const recentVisit = [...visits].sort((a, b) => new Date(b.visit_date) - new Date(a.visit_date))[0];
  const activeCarePlans = carePlans.filter(cp => cp.status === 'active');
  const criticalAlerts = alerts.filter(a => a.severity === 'critical' || a.severity === 'high');

  const getStatusColor = (status) => {
    switch (status) {
      case 'active': return 'bg-green-100 text-green-800 border-green-300';
      case 'discharged': return 'bg-slate-100 text-slate-800 border-slate-300';
      case 'hospitalized': return 'bg-orange-100 text-orange-800 border-orange-300';
      default: return 'bg-blue-100 text-blue-800 border-blue-300';
    }
  };

  if (view === "list") {
    return (
      <Card
        className={`cursor-pointer transition-all hover:shadow-md ${
          isSelected ? 'border-blue-500 bg-blue-50' : ''
        }`}
        onClick={onSelect}
      >
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 flex-1">
              <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-full flex items-center justify-center text-white font-bold text-lg">
                {patient.first_name?.[0]}{patient.last_name?.[0]}
              </div>
              
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-slate-900">
                    {patient.first_name} {patient.last_name}
                  </h3>
                  <Badge className={getStatusColor(patient.status)}>
                    {patient.status}
                  </Badge>
                  {criticalAlerts.length > 0 && (
                    <Badge variant="destructive" className="text-xs">
                      {criticalAlerts.length} Alert{criticalAlerts.length > 1 ? 's' : ''}
                    </Badge>
                  )}
                </div>
                <div className="flex gap-4 text-xs text-slate-600">
                  <span>MRN: {patient.medical_record_number || 'N/A'}</span>
                  <span>•</span>
                  <span>{patient.primary_diagnosis || 'No diagnosis'}</span>
                  <span>•</span>
                  <span>{visits.length} visit{visits.length !== 1 ? 's' : ''}</span>
                </div>
              </div>
            </div>

            <Link to={createPageUrl(`PatientDetails?id=${patient.id}`)}>
              <Button variant="ghost" size="sm">
                <ChevronRight className="w-4 h-4" />
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      className={`cursor-pointer transition-all hover:shadow-lg ${
        isSelected ? 'border-2 border-blue-500 shadow-md' : ''
      }`}
      onClick={onSelect}
    >
      <CardContent className="p-5">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-full flex items-center justify-center text-white font-bold text-lg">
              {patient.first_name?.[0]}{patient.last_name?.[0]}
            </div>
            <div>
              <h3 className="font-semibold text-slate-900 text-lg">
                {patient.first_name} {patient.last_name}
              </h3>
              <p className="text-xs text-slate-500">MRN: {patient.medical_record_number || 'Not assigned'}</p>
            </div>
          </div>
          <Badge className={getStatusColor(patient.status)}>
            {patient.status}
          </Badge>
        </div>

        {/* Key Info */}
        <div className="space-y-2 mb-4">
          <div className="flex items-center gap-2 text-sm text-slate-700">
            <Heart className="w-4 h-4 text-red-500" />
            <span className="font-medium">Diagnosis:</span>
            <span>{patient.primary_diagnosis || 'Not specified'}</span>
          </div>
          
          {patient.phone && (
            <div className="flex items-center gap-2 text-sm text-slate-700">
              <Phone className="w-4 h-4 text-blue-500" />
              <span>{patient.phone}</span>
            </div>
          )}

          {patient.admission_date && (
            <div className="flex items-center gap-2 text-sm text-slate-700">
              <Calendar className="w-4 h-4 text-green-500" />
              <span>Admitted: {new Date(patient.admission_date).toLocaleDateString()}</span>
            </div>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 mb-4 p-3 bg-slate-50 rounded-lg">
          <div className="text-center">
            <p className="text-xs text-slate-600">Visits</p>
            <p className="text-lg font-bold text-blue-600">{visits.length}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-slate-600">Care Plans</p>
            <p className="text-lg font-bold text-green-600">{activeCarePlans.length}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-slate-600">Alerts</p>
            <p className={`text-lg font-bold ${criticalAlerts.length > 0 ? 'text-red-600' : 'text-slate-400'}`}>
              {criticalAlerts.length}
            </p>
          </div>
        </div>

        {/* Recent Visit */}
        {recentVisit && (
          <div className="p-2 bg-blue-50 rounded border border-blue-200 mb-3">
            <p className="text-xs text-blue-600 font-medium mb-1">Last Visit</p>
            <p className="text-xs text-slate-700">
              {new Date(recentVisit.visit_date).toLocaleDateString()} - {recentVisit.visit_type?.replace('_', ' ')}
            </p>
          </div>
        )}

        {/* Alerts */}
        {criticalAlerts.length > 0 && (
          <div className="p-2 bg-red-50 rounded border border-red-200 mb-3">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-600" />
              <p className="text-xs text-red-600 font-medium">
                {criticalAlerts.length} Critical Alert{criticalAlerts.length > 1 ? 's' : ''}
              </p>
            </div>
          </div>
        )}

        {/* View Details Button */}
        <Link to={createPageUrl(`PatientDetails?id=${patient.id}`)}>
          <Button variant="outline" className="w-full" size="sm">
            <FileText className="w-4 h-4 mr-2" />
            View Full Record
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}