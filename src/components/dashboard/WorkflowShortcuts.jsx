import React from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Plus, FileText, Clock, Users } from 'lucide-react';

const SHORTCUTS = [
  {
    icon: Plus,
    label: 'New Visit',
    description: 'Create a visit',
    action: 'DocumentVisit',
    color: 'bg-blue-500 hover:bg-blue-600',
    textColor: 'text-blue-600'
  },
  {
    icon: FileText,
    label: 'Smart Note',
    description: 'AI documentation',
    action: 'SmartNoteAssistant',
    color: 'bg-purple-500 hover:bg-purple-600',
    textColor: 'text-purple-600'
  },
  {
    icon: Clock,
    label: 'Schedule',
    description: 'View schedule',
    action: 'ProviderScheduling',
    color: 'bg-orange-500 hover:bg-orange-600',
    textColor: 'text-orange-600'
  },
  {
    icon: Users,
    label: 'Patients',
    description: 'View patients',
    action: 'Patients',
    color: 'bg-green-500 hover:bg-green-600',
    textColor: 'text-green-600'
  }
];

export default function WorkflowShortcuts() {
  const navigate = useNavigate();

  return (
    <div className="mb-6">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">Quick Actions</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {SHORTCUTS.map((shortcut) => {
          const Icon = shortcut.icon;
          return (
            <Button
              key={shortcut.label}
              onClick={() => navigate(createPageUrl(shortcut.action))}
              className={`h-auto py-3 px-4 flex flex-col items-center justify-center gap-2 rounded-lg text-white transition-all ${shortcut.color}`}
            >
              <Icon className="w-6 h-6" />
              <div className="text-center">
                <div className="text-sm font-semibold">{shortcut.label}</div>
                <div className="text-xs opacity-90">{shortcut.description}</div>
              </div>
            </Button>
          );
        })}
      </div>
    </div>
  );
}