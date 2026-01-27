import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  Circle,
  User,
  CreditCard,
  BookOpen,
  ArrowRight,
  Loader2
} from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";

export default function OnboardingChecklist({ currentUser, onTaskClick }) {
  const queryClient = useQueryClient();
  const [expandedTask, setExpandedTask] = useState(null);

  const tasks = [
    {
      id: 'profile',
      title: 'Complete Your Profile',
      description: 'Add your professional details and credentials',
      icon: User,
      completed: !!(currentUser?.full_name && currentUser?.phone && currentUser?.credential_type),
      action: 'Go to Settings',
      page: 'Settings'
    },
    {
      id: 'subscription',
      title: 'Choose Your Plan',
      description: 'You have a 14-day free trial. Upgrade to continue after trial.',
      icon: CreditCard,
      completed: currentUser?.subscription_status === 'active' || currentUser?.subscription_status === 'lifetime_free',
      action: 'View Plans',
      page: 'SubscriptionPlans'
    },
    {
      id: 'tour',
      title: 'Complete Feature Tour',
      description: 'Learn about key features to get started',
      icon: BookOpen,
      completed: false,
      action: 'Start Tour',
      onAction: () => onTaskClick('tour')
    }
  ];

  const completedCount = tasks.filter(t => t.completed).length;
  const progress = (completedCount / tasks.length) * 100;

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-gray-700">Setup Progress</h3>
          <span className="text-sm text-gray-500">{completedCount} of {tasks.length}</span>
        </div>
        <Progress value={progress} className="h-2" />
      </div>

      <div className="space-y-3">
        {tasks.map((task) => {
          const Icon = task.icon;
          return (
            <div key={task.id}>
              <div
                className={`p-4 rounded-lg border-2 transition-all cursor-pointer ${
                  task.completed
                    ? 'bg-green-50 border-green-200'
                    : 'bg-white border-gray-200 hover:border-blue-300'
                }`}
                onClick={() => setExpandedTask(expandedTask === task.id ? null : task.id)}
              >
                <div className="flex items-start gap-3">
                  <div className="mt-1">
                    {task.completed ? (
                      <CheckCircle2 className="w-5 h-5 text-green-600" />
                    ) : (
                      <Circle className="w-5 h-5 text-gray-300" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Icon className="w-4 h-4 text-gray-600" />
                      <h4 className={`font-medium text-sm ${task.completed ? 'text-green-900' : 'text-gray-900'}`}>
                        {task.title}
                      </h4>
                      {task.completed && <Badge className="bg-green-600 text-white text-xs">Done</Badge>}
                    </div>
                    <p className="text-xs text-gray-600">{task.description}</p>
                  </div>
                </div>
              </div>

              {expandedTask === task.id && (
                <div className="mt-2 p-3 bg-gray-50 rounded-lg text-sm text-gray-700">
                  <p className="mb-3">{task.description}</p>
                  <Button
                    size="sm"
                    onClick={() => {
                      if (task.onAction) {
                        task.onAction();
                      } else if (task.page) {
                        onTaskClick(task.page);
                      }
                      setExpandedTask(null);
                    }}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    {task.action}
                    <ArrowRight className="w-3 h-3 ml-2" />
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-900">
        <p className="font-semibold mb-1">💡 Pro Tip</p>
        <p>Complete your profile and explore the dashboard to make the most of your free trial!</p>
      </div>
    </div>
  );
}