import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { 
  Sparkles, 
  TrendingUp, 
  Clock, 
  FileText, 
  Users,
  ChevronRight,
  Zap,
  Star
} from "lucide-react";

export default function PersonalizedDashboardWidget({ userEmail, providerType }) {
  const { data: usagePattern } = useQuery({
    queryKey: ['usagePattern', userEmail],
    queryFn: async () => {
      const patterns = await base44.entities.ProviderUsagePattern.filter({ provider_email: userEmail });
      return patterns[0] || null;
    },
    enabled: !!userEmail
  });

  const { data: templates = [] } = useQuery({
    queryKey: ['recommendedTemplates', providerType, usagePattern],
    queryFn: async () => {
      if (!usagePattern?.frequent_visit_types?.length) return [];
      
      const topVisitType = usagePattern.frequent_visit_types[0]?.visit_type;
      if (!topVisitType) return [];

      const results = await base44.entities.NoteTemplate.filter({
        visit_type: topVisitType,
        provider_type: providerType
      });
      return results.slice(0, 3);
    },
    enabled: !!usagePattern?.frequent_visit_types?.length
  });

  const { data: todayPatients = [] } = useQuery({
    queryKey: ['todayRecommendedPatients', userEmail, usagePattern],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0];
      const visits = await base44.entities.Visit.filter({ 
        visit_date: today,
        created_by: userEmail 
      }, '-visit_time', 5);
      
      const patientIds = visits.map(v => v.patient_id).filter(Boolean);
      if (patientIds.length === 0) return [];

      const patients = await base44.entities.Patient.list('-updated_date', 100);
      return patients.filter(p => patientIds.includes(p.id)).slice(0, 3);
    },
    enabled: !!userEmail
  });

  if (!usagePattern) return null;

  const topVisitType = usagePattern.frequent_visit_types?.[0];
  const topDiagnosis = usagePattern.frequent_diagnoses?.[0];
  const mostUsedTemplate = usagePattern.template_usage?.[0];

  const getTimeGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Start your morning with";
    if (hour < 17) return "Continue your day with";
    return "Finish your day with";
  };

  return (
    <Card className="border-2 border-purple-300 bg-gradient-to-br from-purple-50 via-pink-50 to-indigo-50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-purple-600" />
          Personalized for You
        </CardTitle>
        <p className="text-xs text-gray-600">AI recommendations based on your patterns</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Quick Stats */}
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-white rounded-lg p-2 text-center border border-purple-200">
            <p className="text-lg font-bold text-purple-600">{usagePattern.total_notes_generated || 0}</p>
            <p className="text-xs text-gray-600">Notes</p>
          </div>
          <div className="bg-white rounded-lg p-2 text-center border border-purple-200">
            <p className="text-lg font-bold text-purple-600">
              {Math.round(usagePattern.ai_suggestion_acceptance_rate || 0)}%
            </p>
            <p className="text-xs text-gray-600">AI Accepted</p>
          </div>
          <div className="bg-white rounded-lg p-2 text-center border border-purple-200">
            <p className="text-lg font-bold text-purple-600">
              {usagePattern.preferred_time_of_day || 'N/A'}
            </p>
            <p className="text-xs text-gray-600">Peak Time</p>
          </div>
        </div>

        {/* Frequent Visit Type */}
        {topVisitType && (
          <div className="bg-white rounded-lg p-3 border border-purple-200">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-purple-600" />
              <h4 className="text-sm font-semibold">Your Most Common Visit</h4>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {topVisitType.visit_type.replace(/_/g, ' ')}
                </p>
                <p className="text-xs text-gray-600">Used {topVisitType.count} times</p>
              </div>
              <Badge className="bg-purple-100 text-purple-800">
                {Math.round((topVisitType.count / (usagePattern.total_notes_generated || 1)) * 100)}%
              </Badge>
            </div>
          </div>
        )}

        {/* Recommended Templates */}
        {templates.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Star className="w-4 h-4 text-yellow-600" />
              <h4 className="text-sm font-semibold">Suggested Templates</h4>
            </div>
            {templates.map((template, idx) => (
              <Link 
                key={template.id}
                to={`${createPageUrl("SmartNoteAssistant")}?template=${template.id}`}
                className="block"
              >
                <div className="bg-white rounded-lg p-2.5 border border-purple-200 hover:shadow-md hover:border-purple-400 transition-all cursor-pointer">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{template.name}</p>
                      <p className="text-xs text-gray-600 truncate">{template.description}</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* Top Diagnosis */}
        {topDiagnosis && (
          <div className="bg-white rounded-lg p-3 border border-purple-200">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-4 h-4 text-purple-600" />
              <h4 className="text-sm font-semibold">Common Diagnosis</h4>
            </div>
            <p className="text-sm text-gray-900">{topDiagnosis.diagnosis}</p>
            <p className="text-xs text-gray-600 mt-1">
              {topDiagnosis.count} recent cases
            </p>
          </div>
        )}

        {/* Today's Patients */}
        {todayPatients.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-purple-600" />
              <h4 className="text-sm font-semibold">{getTimeGreeting()}:</h4>
            </div>
            {todayPatients.map((patient) => (
              <Link 
                key={patient.id}
                to={createPageUrl("PatientDetails") + `?id=${patient.id}`}
                className="block"
              >
                <div className="bg-white rounded-lg p-2.5 border border-purple-200 hover:shadow-md hover:border-purple-400 transition-all cursor-pointer">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {patient.first_name} {patient.last_name}
                      </p>
                      <p className="text-xs text-gray-600">{patient.primary_diagnosis}</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-400" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* Most Used Feature */}
        {usagePattern.feature_usage && (
          <div className="bg-gradient-to-r from-purple-100 to-pink-100 rounded-lg p-3 border border-purple-200">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-4 h-4 text-purple-600" />
              <h4 className="text-sm font-semibold">Your Favorite AI Feature</h4>
            </div>
            <p className="text-sm text-purple-900">
              {Object.entries(usagePattern.feature_usage)
                .filter(([k, v]) => v > 0)
                .sort((a, b) => b[1] - a[1])[0]?.[0]
                .replace(/_/g, ' ')
                .replace(' count', '') || 'Not enough data yet'}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}