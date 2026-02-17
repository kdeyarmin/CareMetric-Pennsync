import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Clock, User } from "lucide-react";
import { toast } from "sonner";

export default function QuickPatientAccess({ onSelectPatient, onSelectVisitType, currentUser }) {
  const [recentPatients, setRecentPatients] = useState([]);
  const [lastVisitPresets, setLastVisitPresets] = useState({});

  const { data: allPatients = [] } = useQuery({
    queryKey: ['patients'],
    queryFn: () => base44.entities.Patient.list(),
  });

  const { data: recentVisits = [] } = useQuery({
    queryKey: ['recentVisits'],
    queryFn: async () => {
      const visits = await base44.entities.Visit.list('-visit_date', 50);
      return visits;
    },
  });

  // Extract recent unique patients and their last visit info
  useEffect(() => {
    if (recentVisits.length > 0) {
      const seen = new Set();
      const recent = [];
      const presets = {};

      for (const visit of recentVisits) {
        if (!seen.has(visit.patient_id) && recent.length < 5) {
          const patient = allPatients.find(p => p.id === visit.patient_id);
          if (patient) {
            seen.add(visit.patient_id);
            recent.push(patient);
            presets[visit.patient_id] = visit.visit_type;
          }
        }
      }

      setRecentPatients(recent);
      setLastVisitPresets(presets);
    }
  }, [recentVisits, allPatients]);

  const handleQuickSelect = (patient) => {
    onSelectPatient(patient.id);
    const lastVisitType = lastVisitPresets[patient.id];
    if (lastVisitType) {
      onSelectVisitType(lastVisitType);
      toast.success(`Loaded ${patient.first_name} ${patient.last_name} with last visit type`);
    }
  };

  if (recentPatients.length === 0) return null;

  return (
    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 border border-blue-200 dark:border-blue-900 rounded-lg p-3 sm:p-4 mb-4">
      <div className="flex items-center gap-2 mb-3">
        <Clock className="w-4 h-4 text-blue-600 dark:text-blue-400" />
        <p className="text-xs sm:text-sm font-semibold text-blue-900 dark:text-blue-100">Recent Patients</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {recentPatients.map((patient) => (
          <Button
            key={patient.id}
            variant="outline"
            size="sm"
            onClick={() => handleQuickSelect(patient)}
            className="text-xs h-8 border-blue-300 dark:border-blue-700 hover:bg-blue-100 dark:hover:bg-blue-900"
          >
            <User className="w-3 h-3 mr-1" />
            {patient.first_name} {patient.last_name?.charAt(0)}
          </Button>
        ))}
      </div>
    </div>
  );
}