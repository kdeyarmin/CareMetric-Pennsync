import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { User, Phone, MapPin, ChevronRight } from "lucide-react";
import { getPatientDisplayName } from "@/components/patient/patientDisplay";

export default function SwipeablePatientCard({ 
  patient, 
  onEdit, 
  onDelete, 
  isSelected, 
  onToggleSelect 
}) {
  const [touchStart, setTouchStart] = useState(null);
  const [touchEnd, setTouchEnd] = useState(null);
  const [swiped, setSwiped] = useState(false);

  const minSwipeDistance = 50;

  const onTouchStart = (e) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };

  const onTouchMove = (e) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const onTouchEnd = () => {
    if (!touchStart || !touchEnd) return;
    
    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;
    
    if (isLeftSwipe) {
      setSwiped(true);
    } else if (isRightSwipe) {
      setSwiped(false);
    }
  };

  const calculateAge = (dob) => {
    if (!dob) return null;
    const today = new Date();
    const birthDate = new Date(dob);
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
  };

  const age = calculateAge(patient.date_of_birth);

  return (
    <div className="relative overflow-hidden">
      {/* Swipe Actions Background */}
      {swiped && (
        <div className="absolute inset-0 bg-red-500 flex items-center justify-end pr-4 rounded-xl">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSwiped(false);
              onDelete(patient);
            }}
            className="text-white hover:bg-red-600"
          >
            Delete
          </Button>
        </div>
      )}

      {/* Card Content */}
      <Card
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        className={`transition-transform duration-300 border-l-4 ${
          isSelected ? 'border-l-green-500 bg-green-50' : 'border-l-blue-500'
        } ${swiped ? '-translate-x-20' : 'translate-x-0'}`}
      >
        <CardContent className="p-4">
          <div className="flex items-start gap-3 mb-3">
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => onToggleSelect(patient)}
              className="mt-1 w-5 h-5 touch-target"
              onClick={(e) => e.stopPropagation()}
            />
            <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-full flex items-center justify-center flex-shrink-0">
              <User className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-bold text-slate-900 truncate">
                {getPatientDisplayName(patient)}
              </h3>
              <div className="flex items-center gap-2 flex-wrap">
                {age && <Badge variant="outline" className="text-xs">{age} yrs</Badge>}
                {patient.status && (
                  <Badge className={`text-xs ${
                    patient.status === 'active' ? 'bg-green-500' : 'bg-slate-500'
                  }`}>
                    {patient.status}
                  </Badge>
                )}
              </div>
            </div>
          </div>

          {patient.primary_diagnosis && (
            <div className="mb-3 p-2 bg-blue-50 rounded-lg">
              <p className="text-xs font-semibold text-blue-900 mb-1">Primary Diagnosis</p>
              <p className="text-sm text-blue-800">{patient.primary_diagnosis}</p>
            </div>
          )}

          <div className="space-y-1 mb-3 text-sm">
            <div className="flex items-center gap-2 text-slate-600">
              <Phone className="w-4 h-4 flex-shrink-0" />
              <a href={`tel:${patient.phone}`} className="hover:text-blue-600 truncate">
                {patient.phone || 'No phone'}
              </a>
            </div>
            {patient.address && (
              <div className="flex items-start gap-2 text-slate-600">
                <MapPin className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span className="text-xs truncate">{patient.address}</span>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onEdit(patient)}
              className="flex-1 min-h-[44px]"
            >
              Edit
            </Button>
            <Link to={`${createPageUrl("PatientDetails")}?id=${patient.id}`} className="flex-1">
              <Button size="sm" className="w-full bg-blue-600 hover:bg-blue-700 min-h-[44px]">
                <span className="mr-1">View</span>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}