import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Brain, FileText, Mail, DollarSign, MessageCircle, Sparkles, Clock } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

const ACTION_CONFIGS = {
  smart_note: { 
    icon: Brain, 
    label: "Smart Notes", 
    page: "SmartNoteAssistant",
    color: "bg-blue-500 hover:bg-blue-600"
  },
  medical_scribe: { 
    icon: FileText, 
    label: "Medical Scribe", 
    page: "MedicalScribe",
    color: "bg-purple-500 hover:bg-purple-600"
  },
  patient_email: { 
    icon: Mail, 
    label: "Patient Email", 
    page: "SmartNoteAssistant",
    color: "bg-green-500 hover:bg-green-600"
  },
  billing_codes: { 
    icon: DollarSign, 
    label: "Billing Codes", 
    page: "SmartNoteAssistant",
    color: "bg-emerald-500 hover:bg-emerald-600"
  },
  patient_chat: { 
    icon: MessageCircle, 
    label: "Patient Chat", 
    page: "SmartNoteAssistant",
    color: "bg-cyan-500 hover:bg-cyan-600"
  }
};

export default function SmartQuickActions({ userEmail, maxActions = 4 }) {
  const { data: usagePattern } = useQuery({
    queryKey: ['usagePattern', userEmail],
    queryFn: async () => {
      const patterns = await base44.entities.ProviderUsagePattern.filter({ provider_email: userEmail });
      return patterns[0] || null;
    },
    enabled: !!userEmail
  });

  if (!usagePattern?.feature_usage) {
    // Show default actions if no pattern exists
    return (
      <div className="flex flex-wrap gap-2">
        <Link to={createPageUrl("SmartNoteAssistant")}>
          <Button size="sm" className="bg-blue-500 hover:bg-blue-600">
            <Brain className="w-3 h-3 mr-1" />
            Smart Notes
          </Button>
        </Link>
        <Link to={createPageUrl("MedicalScribe")}>
          <Button size="sm" className="bg-purple-500 hover:bg-purple-600">
            <FileText className="w-3 h-3 mr-1" />
            Medical Scribe
          </Button>
        </Link>
      </div>
    );
  }

  // Sort features by usage count
  const sortedFeatures = Object.entries(usagePattern.feature_usage)
    .filter(([key, count]) => count > 0 && key in { 
      magic_edit_count: 'smart_note',
      voice_dictation_count: 'medical_scribe', 
      patient_chat_count: 'patient_chat',
      letter_generation_count: 'patient_email',
      billing_codes_count: 'billing_codes'
    })
    .map(([key, count]) => {
      const actionMap = {
        magic_edit_count: 'smart_note',
        voice_dictation_count: 'medical_scribe',
        patient_chat_count: 'patient_chat',
        letter_generation_count: 'patient_email',
        billing_codes_count: 'billing_codes'
      };
      return { action: actionMap[key], count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, maxActions);

  if (sortedFeatures.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-purple-600" />
        <h4 className="text-sm font-semibold text-gray-900">Your Go-To Tools</h4>
      </div>
      <div className="flex flex-wrap gap-2">
        {sortedFeatures.map(({ action, count }) => {
          const config = ACTION_CONFIGS[action];
          if (!config) return null;
          
          const Icon = config.icon;
          return (
            <Link key={action} to={createPageUrl(config.page)}>
              <Button size="sm" className={config.color}>
                <Icon className="w-3 h-3 mr-1" />
                {config.label}
                <Badge className="ml-2 bg-white/20 text-white text-xs">{count}</Badge>
              </Button>
            </Link>
          );
        })}
      </div>
    </div>
  );
}