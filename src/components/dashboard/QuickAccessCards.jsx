import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Brain, Video, Mic, Target } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';

const QUICK_ACCESS_CARDS = [
  {
    icon: Brain,
    label: 'Smart Note',
    description: 'AI documentation',
    page: 'SmartNoteAssistant',
    color: 'text-purple-400'
  },
  {
    icon: Video,
    label: 'Telehealth',
    description: 'Video visits with AI',
    page: 'TelehealthDashboard',
    color: 'text-blue-400'
  },
  {
    icon: Mic,
    label: 'Medical Scribe',
    description: 'Record interactions',
    page: 'MedicalScribe',
    color: 'text-orange-400'
  },
  {
    icon: Target,
    label: 'Care Plans',
    description: 'Care plans & billing',
    page: 'CarePlanManagement',
    color: 'text-green-400'
  }
];

export default function QuickAccessCards() {
  const navigate = useNavigate();

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {QUICK_ACCESS_CARDS.map((card) => {
        const Icon = card.icon;
        return (
          <Card
            key={card.label}
            className="border-2 border-white/30 hover:shadow-lg transition-all cursor-pointer bg-white/10 backdrop-blur hover:bg-white/20"
            onClick={() => navigate(createPageUrl(card.page))}
          >
            <CardContent className="p-4 text-center">
              <Icon className={`w-10 h-10 ${card.color} mx-auto mb-2`} />
              <h3 className="font-bold text-sm text-white mb-1">{card.label}</h3>
              <p className="text-xs text-white/80">{card.description}</p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}