import React from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Activity,
  Users,
  Target,
  TrendingUp,
  AlertCircle,
  BookOpen,
  FileText,
  Heart,
  Brain,
  Stethoscope,
  Accessibility,
  MessageSquare
} from "lucide-react";

/**
 * Provider-specific dashboard that adapts to the provider's role
 * Shows relevant metrics, alerts, and workflows
 */
export default function ProviderSpecificDashboard({ user }) {
  const providerType = user?.provider_type || user?.credential_type || 'RN';

  // Fetch provider settings for customization
  const { data: providerSettings } = useQuery({
    queryKey: ['providerSettings', providerType],
    queryFn: async () => {
      const settings = await base44.entities.ProviderSettings.filter({
        provider_type: providerType,
        is_active: true
      });
      return settings[0];
    }
  });

  // Fetch actual metrics data
  const { data: metricsData } = useQuery({
    queryKey: ['providerMetrics', user?.email, providerType],
    queryFn: async () => {
      const [patients, visits, carePlans, tasks, noteConversions, audits] = await Promise.all([
        base44.entities.Patient.filter({ status: 'active' }),
        base44.entities.Visit.filter({ 
          created_by: user.email,
          status: { $in: ['scheduled', 'in_progress'] }
        }),
        base44.entities.CarePlan.filter({ status: 'active' }),
        base44.entities.Task.filter({ 
          assigned_to: user.email, 
          status: 'pending' 
        }),
        base44.entities.NoteConversion.filter({ nurse_email: user.email }, '-created_date', 30),
        base44.entities.ComplianceAudit.filter({ nurse_email: user.email }, '-audit_date', 10)
      ]);

      const avgComplianceScore = audits.length > 0 
        ? Math.round(audits.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / audits.length)
        : 0;

      return {
        activePatients: patients.length,
        pendingNotes: visits.filter(v => !v.nurse_notes).length,
        complianceScore: avgComplianceScore,
        activeCarePlans: carePlans.length,
        pendingTasks: tasks.length,
        noteEnhancements: noteConversions.length,
        avgQualityScore: noteConversions.length > 0
          ? Math.round(noteConversions.reduce((sum, n) => sum + (n.quality_score || 0), 0) / noteConversions.length)
          : 0
      };
    },
    enabled: !!user?.email
  });

  // Get provider-specific icon
  const getProviderIcon = () => {
    const icons = {
      'NP': Stethoscope,
      'MD': Stethoscope,
      'DO': Stethoscope,
      'PT': Accessibility,
      'OT': Accessibility,
      'ST': MessageSquare,
      'MSW': Heart,
      'Chiropractor': Activity,
      'RN': Heart,
      'LPN': Heart
    };
    return icons[providerType] || Heart;
  };

  const ProviderIcon = getProviderIcon();

  // Provider-specific quick stats configuration
  const getProviderStats = () => {
    const baseStats = [
      { label: 'Active Patients', icon: Users, color: 'blue' },
      { label: 'Pending Notes', icon: FileText, color: 'orange' },
      { label: 'Compliance Score', icon: Target, color: 'green' }
    ];

    const providerSpecific = {
      'NP': [
        ...baseStats,
        { label: 'Prescriptions Written', icon: FileText, color: 'purple' }
      ],
      'MD': [
        ...baseStats,
        { label: 'Consultations', icon: Stethoscope, color: 'purple' }
      ],
      'PT': [
        ...baseStats,
        { label: 'Mobility Goals Met', icon: TrendingUp, color: 'green' }
      ],
      'OT': [
        ...baseStats,
        { label: 'ADL Goals Achieved', icon: TrendingUp, color: 'green' }
      ],
      'ST': [
        ...baseStats,
        { label: 'Communication Goals', icon: MessageSquare, color: 'purple' }
      ],
      'MSW': [
        ...baseStats,
        { label: 'Care Coordination', icon: Users, color: 'purple' }
      ]
    };

    return providerSpecific[providerType] || baseStats;
  };

  // Provider-specific quick actions
  const getQuickActions = () => {
    const baseActions = [
      { label: 'Document Visit', route: 'SmartNoteAssistant', priority: 'high' },
      { label: 'View Patients', route: 'Patients', priority: 'medium' }
    ];

    const providerSpecific = {
      'NP': [
        { label: 'Write Prescription', route: 'SmartNoteAssistant', priority: 'high' },
        { label: 'Review Labs', route: 'Patients', priority: 'medium' },
        ...baseActions
      ],
      'PT': [
        { label: 'Update PT Plan', route: 'CarePlanManagement', priority: 'high' },
        { label: 'Track Mobility', route: 'Patients', priority: 'medium' },
        ...baseActions
      ],
      'OT': [
        { label: 'Update OT Plan', route: 'CarePlanManagement', priority: 'high' },
        { label: 'ADL Assessment', route: 'SmartNoteAssistant', priority: 'medium' },
        ...baseActions
      ],
      'ST': [
        { label: 'Speech Assessment', route: 'SmartNoteAssistant', priority: 'high' },
        { label: 'Update ST Goals', route: 'CarePlanManagement', priority: 'medium' },
        ...baseActions
      ],
      'MSW': [
        { label: 'Social Assessment', route: 'SmartNoteAssistant', priority: 'high' },
        { label: 'Resource Coordination', route: 'Tasks', priority: 'medium' },
        ...baseActions
      ]
    };

    return providerSpecific[providerType] || baseActions;
  };

  // Provider-specific alerts/priorities
  const getPriorityAlerts = () => {
    const alerts = {
      'NP': [
        'Review lab results requiring follow-up',
        'Prescriptions pending renewal',
        'Patients due for reassessment'
      ],
      'MD': [
        'Physician orders pending signature',
        'Complex cases requiring consultation',
        'Medication reconciliation needed'
      ],
      'PT': [
        'Fall risk assessments due',
        'DME orders pending',
        'Progress notes requiring completion'
      ],
      'OT': [
        'Home safety evaluations due',
        'Adaptive equipment recommendations',
        'ADL reassessments needed'
      ],
      'ST': [
        'Swallow assessments due',
        'Communication device evaluations',
        'Cognitive assessments pending'
      ],
      'MSW': [
        'Discharge planning coordination',
        'Resource referrals pending',
        'Caregiver support assessments'
      ],
      'RN': [
        'Medication education pending',
        'Wound assessments due',
        'Patient education completion'
      ],
      'LPN': [
        'Vital sign monitoring due',
        'RN supervision documentation',
        'Delegated tasks pending'
      ]
    };

    return alerts[providerType] || alerts['RN'];
  };

  const stats = getProviderStats();
  const quickActions = getQuickActions();
  const priorityAlerts = getPriorityAlerts();

  return (
    <div className="space-y-4">
      {/* Provider Header */}
      <Card className="border-2 border-blue-400 bg-gradient-to-r from-blue-50 to-indigo-50">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-blue-600 flex items-center justify-center">
              <ProviderIcon className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1">
              <h2 className="text-xl font-bold text-gray-900">
                {providerSettings?.display_name || providerType} Dashboard
              </h2>
              <p className="text-sm text-gray-600">
                Welcome back, {user?.full_name}
              </p>
            </div>
            <Badge className="bg-blue-600">
              {providerType}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Provider-Specific Priority Alerts */}
      <Alert className="bg-orange-50 border-orange-300">
        <AlertCircle className="w-4 h-4 text-orange-600" />
        <AlertDescription>
          <p className="font-semibold text-orange-900 mb-2">
            Priority Items for {providerType}s
          </p>
          <ul className="space-y-1 text-sm text-orange-800">
            {priorityAlerts.slice(0, 3).map((alert, idx) => (
              <li key={idx}>• {alert}</li>
            ))}
          </ul>
        </AlertDescription>
      </Alert>

      {/* Provider-Specific Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {stats.map((stat, idx) => {
          const Icon = stat.icon;
          const colorClasses = {
            blue: 'bg-blue-100 text-blue-600',
            green: 'bg-green-100 text-green-600',
            orange: 'bg-orange-100 text-orange-600',
            purple: 'bg-purple-100 text-purple-600'
          };

          // Map stat to actual data
          const getValue = () => {
            if (!metricsData) return '--';
            switch(stat.label) {
              case 'Active Patients': return metricsData.activePatients;
              case 'Pending Notes': return metricsData.pendingNotes;
              case 'Compliance Score': return `${metricsData.complianceScore}%`;
              case 'Prescriptions Written': return metricsData.noteEnhancements;
              case 'Consultations': return metricsData.activePatients;
              case 'Mobility Goals Met': return metricsData.activeCarePlans;
              case 'ADL Goals Achieved': return metricsData.activeCarePlans;
              case 'Communication Goals': return metricsData.activeCarePlans;
              case 'Care Coordination': return metricsData.pendingTasks;
              default: return '--';
            }
          };
          
          return (
            <Card key={idx} className="hover:shadow-lg transition-shadow">
              <CardContent className="p-4">
                <div className={`w-10 h-10 rounded-lg ${colorClasses[stat.color]} flex items-center justify-center mb-2`}>
                  <Icon className="w-5 h-5" />
                </div>
                <p className="text-2xl font-bold text-gray-900">{getValue()}</p>
                <p className="text-xs text-gray-600 mt-1">{stat.label}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Provider-Specific Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quick Actions for {providerType}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {quickActions.map((action, idx) => (
              <button
                key={idx}
                onClick={() => window.location.href = `/${action.route}`}
                className={`p-3 rounded-lg border-2 text-left hover:shadow-md transition-all ${
                  action.priority === 'high' 
                    ? 'border-orange-300 bg-orange-50 hover:bg-orange-100' 
                    : 'border-gray-300 bg-gray-50 hover:bg-gray-100'
                }`}
              >
                <p className="text-sm font-semibold text-gray-900">{action.label}</p>
                {action.priority === 'high' && (
                  <Badge className="mt-1 bg-orange-600 text-xs">Priority</Badge>
                )}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Provider-Specific Documentation Checklist */}
      {providerSettings?.documentation_checklist?.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <BookOpen className="w-4 h-4" />
              {providerType} Documentation Checklist
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {providerSettings.documentation_checklist
                .filter(item => item.priority === 'critical' || item.priority === 'high')
                .slice(0, 5)
                .map((item, idx) => (
                  <div key={idx} className="flex items-start gap-2 p-2 rounded bg-gray-50">
                    <div className={`w-2 h-2 rounded-full mt-1.5 ${
                      item.priority === 'critical' ? 'bg-red-500' :
                      item.priority === 'high' ? 'bg-orange-500' :
                      'bg-yellow-500'
                    }`} />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900">{item.element}</p>
                      <p className="text-xs text-gray-600">{item.description}</p>
                    </div>
                    {item.required && (
                      <Badge variant="outline" className="text-xs">Required</Badge>
                    )}
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Provider-Specific Regulatory References */}
      {providerSettings?.regulatory_references?.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Quick Reference for {providerType}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {providerSettings.regulatory_references.slice(0, 3).map((ref, idx) => (
                <a
                  key={idx}
                  href={ref.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block p-2 rounded border hover:bg-gray-50 transition-colors"
                >
                  <p className="text-sm font-medium text-blue-600">{ref.title}</p>
                  <p className="text-xs text-gray-600">{ref.description}</p>
                  {ref.category && (
                    <Badge variant="outline" className="mt-1 text-xs">{ref.category}</Badge>
                  )}
                </a>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}