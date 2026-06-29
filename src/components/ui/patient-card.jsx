import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { User, MapPin, Phone, AlertCircle } from "lucide-react";
import { RiskDot } from "./risk-indicator";

export default function PatientCard({ patient, showRisk = true, onClick }) {
  const initials = `${patient.first_name?.charAt(0) || ''}${patient.last_name?.charAt(0) || ''}`;
  const fullName = `${patient.first_name || ''} ${patient.last_name || ''}`.trim();
  const age = patient.date_of_birth ? calculateAge(patient.date_of_birth) : null;
  
  // Determine risk level based on patient data
  const riskLevel = determineRiskLevel(patient);
  
  const CardWrapper = onClick ? "div" : Link;
  const cardProps = onClick 
    ? { onClick, className: "modern-card-interactive block" }
    : { to: createPageUrl(`PatientDetails?id=${patient.id}`), className: "modern-card-interactive block" };

  return (
    <CardWrapper {...cardProps}>
      <div className="p-4">
        <div className="flex items-start gap-4">
          {/* Avatar */}
          <div className="avatar-circle flex-shrink-0">
            {initials || <User className="w-5 h-5" />}
          </div>
          
          {/* Main Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold text-slate-900 truncate">{fullName}</h3>
                <div className="flex items-center gap-2 mt-1">
                  {age && (
                    <span className="text-sm text-slate-500">{age} years</span>
                  )}
                  {patient.medical_record_number && (
                    <span className="text-xs text-slate-400">MRN: {patient.medical_record_number}</span>
                  )}
                </div>
              </div>
              
              {/* Risk Indicator */}
              {showRisk && riskLevel && (
                <div className="flex items-center gap-1">
                  <RiskDot level={riskLevel} />
                </div>
              )}
            </div>
            
            {/* Patient Details */}
            <div className="mt-3 space-y-1.5">
              {patient.primary_diagnosis && (
                <div className="flex items-start gap-2 text-sm">
                  <AlertCircle className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
                  <span className="text-slate-600 line-clamp-1">{patient.primary_diagnosis}</span>
                </div>
              )}
              
              {patient.phone && (
                <div className="flex items-center gap-2 text-sm">
                  <Phone className="w-4 h-4 text-slate-400 flex-shrink-0" />
                  <span className="text-slate-600">{patient.phone}</span>
                </div>
              )}
              
              {patient.address && (
                <div className="flex items-start gap-2 text-sm">
                  <MapPin className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
                  <span className="text-slate-600 line-clamp-1">{patient.address}</span>
                </div>
              )}
            </div>
            
            {/* Status Badge */}
            <div className="mt-3 flex items-center gap-2">
              {patient.status === 'active' && (
                <span className="status-active">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                  Active
                </span>
              )}
              {patient.status === 'discharged' && (
                <span className="status-completed">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                  Discharged
                </span>
              )}
              {patient.care_type && (
                <span className="badge-info capitalize">{patient.care_type.replace('_', ' ')}</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </CardWrapper>
  );
}

function calculateAge(dateOfBirth) {
  const today = new Date();
  const birthDate = new Date(dateOfBirth);
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

function determineRiskLevel(patient) {
  let riskScore = 0;
  
  // Age-based risk
  const age = patient.date_of_birth ? calculateAge(patient.date_of_birth) : 0;
  if (age > 85) riskScore += 2;
  else if (age > 75) riskScore += 1;
  
  // Functional status risk
  if (patient.functional_status?.fall_risk === 'high') riskScore += 2;
  if (patient.functional_status?.ambulation?.includes('assist')) riskScore += 1;
  
  // Wound risk
  if (patient.wounds?.length > 0) riskScore += 2;
  
  // Recent hospitalization
  if (patient.past_hospitalizations?.some(h => {
    const hospDate = new Date(h.date);
    const daysSince = (new Date() - hospDate) / (1000 * 60 * 60 * 24);
    return daysSince < 30;
  })) {
    riskScore += 2;
  }
  
  // Multiple diagnoses
  if (patient.secondary_diagnoses?.length > 3) riskScore += 1;
  
  // Determine level
  if (riskScore >= 5) return 'critical';
  if (riskScore >= 3) return 'high';
  if (riskScore >= 1) return 'moderate';
  return 'low';
}