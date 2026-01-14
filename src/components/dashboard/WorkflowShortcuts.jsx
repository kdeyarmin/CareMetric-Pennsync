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
    color: 'bg-slate-300 hover:bg-slate-400 dark:bg-slate-700 dark:hover:bg-slate-600',
    textColor: 'text-slate-900 dark:text-slate-300'
  },
  {
    icon: FileText,
    label: 'Smart Note',
    description: 'AI documentation',
    action: 'SmartNoteAssistant',
    color: 'bg-slate-300 hover:bg-slate-400 dark:bg-slate-600 dark:hover:bg-slate-700',
    textColor: 'text-slate-900 dark:text-slate-300'
  },
  {
    icon: Clock,
    label: 'Schedule',
    description: 'View schedule',
    action: 'ProviderScheduling',
    color: 'bg-slate-300 hover:bg-slate-400 dark:bg-slate-700 dark:hover:bg-slate-600',
    textColor: 'text-slate-900 dark:text-slate-300'
  },
  {
    icon: Users,
    label: 'Patients',
    description: 'View patients',
    action: 'Patients',
    color: 'bg-slate-300 hover:bg-slate-400 dark:bg-slate-600 dark:hover:bg-slate-700',
    textColor: 'text-slate-900 dark:text-slate-300'
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