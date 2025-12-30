import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  User,
  Calendar,
  Pill,
  AlertTriangle,
  Activity,
  Heart,
  Phone,
  MapPin,
  Shield,
  Stethoscope,
  Clock,
  FileText
} from "lucide-react";
import { formatEastern } from "../utils/timezone";
import { differenceInYears } from "date-fns";

export default function EnhancedPatientContext({ patient, visits = [], carePlans = [] }) {
  if (!patient) {
    return (
      <Alert>
        <AlertDescription className="text-sm">
          Select a patient to view their clinical context
        </AlertDescription>
      </Alert>
    );
  }

  const calculateAge = (dob) => {
    if (!dob) return null;
    try {
      return differenceInYears(new Date(), new Date(dob));
    } catch {
      return null;
    }
  };

  const age = calculateAge(patient.date_of_birth);
  const recentVisits = visits.slice(0, 5);
  const activeCarePlans = carePlans.filter(cp => cp.status === 'active');
  const recentHospitalizations = patient.past_hospitalizations?.slice(0, 3) || [];

  return (
    <div className="space-y-3">
      {/* Patient Header */}
      <Card className="border-2 border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 bg-blue-600 rounded-full flex items-center justify-center flex-shrink-0">
              <User className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-bold text-gray-900 break-words">
                {patient.first_name} {patient.middle_name || ''} {patient.last_name}
              </h3>
              <div className="flex flex-wrap gap-2 mt-1">
                {age && <Badge variant="outline">{age} years old</Badge>}
                {patient.date_of_birth && (
                  <Badge variant="outline">DOB: {new Date(patient.date_of_birth).toLocaleDateString()}</Badge>
                )}
                <Badge className={patient.status === 'active' ? 'bg-green-600' : 'bg-gray-600'}>
                  {patient.status}
                </Badge>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 text-xs text-gray-600">
                {patient.phone && (
                  <div className="flex items-center gap-1">
                    <Phone className="w-3 h-3" />
                    <span>{patient.phone}</span>
                  </div>
                )}
                {patient.address && (
                  <div className="flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    <span className="truncate">{patient.address}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Critical Alerts */}
      {patient.allergies && (
        <Alert className="bg-red-50 border-2 border-red-400">
          <AlertTriangle className="w-5 h-5 text-red-600" />
          <AlertDescription>
            <p className="font-semibold text-red-900 text-sm mb-1">Known Allergies</p>
            <p className="text-sm text-red-800">{patient.allergies}</p>
          </AlertDescription>
        </Alert>
      )}

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Diagnoses */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Stethoscope className="w-4 h-4 text-red-600" />
              Diagnoses
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {patient.primary_diagnosis && (
              <div className="p-2 bg-red-50 rounded border border-red-200">
                <Badge className="bg-red-600 mb-1">Primary</Badge>
                <p className="text-sm font-medium text-gray-900">{patient.primary_diagnosis}</p>
              </div>
            )}
            {patient.secondary_diagnoses?.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-gray-600">Secondary:</p>
                {patient.secondary_diagnoses.slice(0, 3).map((dx, idx) => (
                  <div key={idx} className="p-2 bg-gray-50 rounded border text-sm">
                    {dx}
                  </div>
                ))}
                {patient.secondary_diagnoses.length > 3 && (
                  <p className="text-xs text-gray-500">+{patient.secondary_diagnoses.length - 3} more</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Current Medications */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Pill className="w-4 h-4 text-purple-600" />
              Current Medications
            </CardTitle>
          </CardHeader>
          <CardContent>
            {patient.current_medications?.length > 0 ? (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {patient.current_medications.slice(0, 5).map((med, idx) => (
                  <div key={idx} className="p-2 bg-purple-50 rounded border border-purple-200">
                    <p className="text-sm font-medium text-gray-900">{med.name}</p>
                    <div className="flex gap-2 mt-1">
                      {med.dosage && <Badge variant="outline" className="text-xs">{med.dosage}</Badge>}
                      {med.frequency && <Badge variant="outline" className="text-xs">{med.frequency}</Badge>}
                    </div>
                    {med.prescriber && (
                      <p className="text-xs text-gray-600 mt-1">Prescriber: {med.prescriber}</p>
                    )}
                  </div>
                ))}
                {patient.current_medications.length > 5 && (
                  <p className="text-xs text-gray-500">+{patient.current_medications.length - 5} more medications</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No medications documented</p>
            )}
          </CardContent>
        </Card>

        {/* Recent Hospitalizations */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="w-4 h-4 text-orange-600" />
              Recent Hospitalizations
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentHospitalizations.length > 0 ? (
              <div className="space-y-2">
                {recentHospitalizations.map((hosp, idx) => (
                  <div key={idx} className="p-2 bg-orange-50 rounded border border-orange-200">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm font-medium text-gray-900">{hosp.reason}</p>
                      {hosp.length_of_stay && (
                        <Badge variant="outline" className="text-xs">{hosp.length_of_stay} days</Badge>
                      )}
                    </div>
                    <p className="text-xs text-gray-600">
                      {hosp.date && new Date(hosp.date).toLocaleDateString()} • {hosp.hospital || 'Hospital'}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No recent hospitalizations documented</p>
            )}
          </CardContent>
        </Card>

        {/* Active Care Plans */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Heart className="w-4 h-4 text-green-600" />
              Active Care Plans ({activeCarePlans.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {activeCarePlans.length > 0 ? (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {activeCarePlans.slice(0, 3).map((plan) => (
                  <div key={plan.id} className="p-2 bg-green-50 rounded border border-green-200">
                    <p className="text-sm font-medium text-gray-900">{plan.problem}</p>
                    <p className="text-xs text-gray-600 mt-1">Goal: {plan.goal}</p>
                    {plan.target_date && (
                      <p className="text-xs text-green-700 mt-1">
                        Target: {new Date(plan.target_date).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                ))}
                {activeCarePlans.length > 3 && (
                  <p className="text-xs text-gray-500">+{activeCarePlans.length - 3} more care plans</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No active care plans</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Visit History */}
      {recentVisits.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="w-4 h-4 text-blue-600" />
              Recent Visits (Last 5)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {recentVisits.map((visit) => (
                <div key={visit.id} className="p-2 bg-blue-50 rounded border border-blue-200 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-900">
                      {visit.visit_date && new Date(visit.visit_date).toLocaleDateString()}
                    </span>
                    <Badge className={
                      visit.status === 'completed' ? 'bg-green-600' :
                      visit.status === 'in_progress' ? 'bg-yellow-600' :
                      'bg-blue-600'
                    }>
                      {visit.status}
                    </Badge>
                  </div>
                  {visit.visit_type && (
                    <p className="text-gray-600 mt-1">{visit.visit_type.replace(/_/g, ' ')}</p>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Additional Clinical Info */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="w-4 h-4 text-indigo-600" />
            Additional Clinical Information
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          {patient.payor && (
            <div>
              <p className="font-semibold text-gray-600 mb-1">Primary Payor</p>
              <Badge variant="outline">{patient.payor}</Badge>
            </div>
          )}
          {patient.physician_name && (
            <div>
              <p className="font-semibold text-gray-600 mb-1">Primary Physician</p>
              <p className="text-gray-900">{patient.physician_name}</p>
              {patient.physician_phone && (
                <p className="text-gray-600">{patient.physician_phone}</p>
              )}
            </div>
          )}
          {patient.emergency_contact_name && (
            <div>
              <p className="font-semibold text-gray-600 mb-1">Emergency Contact</p>
              <p className="text-gray-900">{patient.emergency_contact_name}</p>
              {patient.emergency_contact_phone && (
                <p className="text-gray-600">{patient.emergency_contact_phone}</p>
              )}
            </div>
          )}
          {patient.admission_date && (
            <div>
              <p className="font-semibold text-gray-600 mb-1">Admission Date</p>
              <p className="text-gray-900">{new Date(patient.admission_date).toLocaleDateString()}</p>
            </div>
          )}
          {patient.functional_status?.ambulation && (
            <div>
              <p className="font-semibold text-gray-600 mb-1">Ambulation</p>
              <Badge variant="outline">{patient.functional_status.ambulation}</Badge>
            </div>
          )}
          {patient.functional_status?.fall_risk && (
            <div>
              <p className="font-semibold text-gray-600 mb-1">Fall Risk</p>
              <Badge className={
                patient.functional_status.fall_risk === 'high' ? 'bg-red-600' :
                patient.functional_status.fall_risk === 'medium' ? 'bg-yellow-600' :
                'bg-green-600'
              }>
                {patient.functional_status.fall_risk}
              </Badge>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}