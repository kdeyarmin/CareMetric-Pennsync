import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { 
  Search, 
  User, 
  Calendar, 
  Phone, 
  AlertCircle,
  ChevronRight,
  Clock
} from "lucide-react";
import { formatEastern, todayEastern } from "../utils/timezone";

export default function QuickPatientAccess({ userEmail }) {
  const [searchQuery, setSearchQuery] = useState("");

  const { data: todayVisits = [] } = useQuery({
    queryKey: ['todayVisits', userEmail],
    queryFn: async () => {
      const today = todayEastern();
      return base44.entities.Visit.filter({ 
        visit_date: today,
        created_by: userEmail 
      }, '-visit_time', 10);
    },
    enabled: !!userEmail
  });

  const { data: patients = [] } = useQuery({
    queryKey: ['allPatients'],
    queryFn: () => base44.entities.Patient.list('-updated_date', 100),
    initialData: []
  });

  const { data: urgentAlerts = [] } = useQuery({
    queryKey: ['urgentAlerts', userEmail],
    queryFn: async () => {
      return base44.entities.PatientAlert.filter({
        assigned_to: userEmail,
        status: 'active',
        severity: 'critical'
      }, '-created_date', 5);
    },
    enabled: !!userEmail
  });

  const todayPatients = patients.filter(p => 
    todayVisits.some(v => v.patient_id === p.id)
  );

  const filteredPatients = searchQuery
    ? patients.filter(p => 
        `${p.first_name} ${p.last_name}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.medical_record_number?.toLowerCase().includes(searchQuery.toLowerCase())
      ).slice(0, 5)
    : todayPatients.slice(0, 5);

  return (
    <div className="space-y-3 w-full">
      {/* Quick Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <Input
          placeholder="Search patients..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9 h-12 text-base"
        />
      </div>

      {/* Urgent Alerts */}
      {urgentAlerts.length > 0 && (
        <Card className="border-2 border-red-300 bg-red-50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-600" />
              Urgent Alerts ({urgentAlerts.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {urgentAlerts.slice(0, 2).map(alert => {
              const patient = patients.find(p => p.id === alert.patient_id);
              return (
                <Link 
                  key={alert.id}
                  to={createPageUrl("PatientAlerts")}
                  className="block"
                >
                  <div className="bg-white rounded-lg p-2.5 border border-red-200 active:bg-red-50">
                    <p className="text-sm font-medium text-red-900">
                      {patient?.first_name} {patient?.last_name}
                    </p>
                    <p className="text-xs text-red-700">{alert.title}</p>
                  </div>
                </Link>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Today's Schedule or Search Results */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            {searchQuery ? (
              <>
                <Search className="w-4 h-4" />
                Search Results
              </>
            ) : (
              <>
                <Calendar className="w-4 h-4 text-blue-600" />
                Today's Patients ({todayPatients.length})
              </>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {filteredPatients.length === 0 ? (
            <p className="text-xs text-gray-500 text-center py-4">
              {searchQuery ? 'No patients found' : 'No visits scheduled today'}
            </p>
          ) : (
            filteredPatients.map(patient => {
              const visit = todayVisits.find(v => v.patient_id === patient.id);
              return (
                <Link
                  key={patient.id}
                  to={createPageUrl("PatientDetails") + `?id=${patient.id}`}
                  className="block"
                >
                  <div className="bg-white hover:bg-gray-50 active:bg-gray-100 rounded-lg p-3 border border-gray-200 transition-colors">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">
                          {patient.first_name} {patient.last_name}
                        </p>
                        <p className="text-xs text-gray-600 truncate">{patient.primary_diagnosis}</p>
                        {visit && (
                          <div className="flex items-center gap-2 mt-1">
                            <Clock className="w-3 h-3 text-blue-600" />
                            <span className="text-xs text-blue-600">{visit.visit_time || 'Today'}</span>
                            <Badge className="text-xs bg-blue-100 text-blue-800">
                              {visit.visit_type.replace(/_/g, ' ')}
                            </Badge>
                          </div>
                        )}
                        {patient.phone && (
                          <a 
                            href={`tel:${patient.phone}`}
                            onClick={(e) => e.stopPropagation()}
                            className="flex items-center gap-1 mt-1 text-xs text-green-600"
                          >
                            <Phone className="w-3 h-3" />
                            {patient.phone}
                          </a>
                        )}
                      </div>
                      <ChevronRight className="w-5 h-5 text-gray-400 flex-shrink-0" />
                    </div>
                  </div>
                </Link>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}