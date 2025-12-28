import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Brain,
  AlertTriangle,
  Clock,
  CheckCircle2,
  X,
  RefreshCw,
  ChevronRight,
  Sparkles,
  Shield,
  Activity,
  Target,
  TrendingUp,
  Bell
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function AINudgesWidget() {
  const queryClient = useQueryClient();
  const [dismissedNudges, setDismissedNudges] = useState(new Set());

  const { data: nudgesData, isLoading, error, refetch } = useQuery({
    queryKey: ['aiNudges'],
    queryFn: async () => {
      const response = await base44.functions.invoke('generateAINudges', {});
      return response.data;
    },
    refetchInterval: 5 * 60 * 1000, // Refetch every 5 minutes
    staleTime: 2 * 60 * 1000 // Consider data stale after 2 minutes
  });

  const handleDismiss = (nudgeId) => {
    setDismissedNudges(prev => new Set([...prev, nudgeId]));
  };

  const handleRefresh = () => {
    setDismissedNudges(new Set());
    refetch();
  };

  const getIconForCategory = (category) => {
    switch (category) {
      case 'patient_safety': return AlertTriangle;
      case 'compliance': return Shield;
      case 'task': return CheckCircle2;
      case 'clinical': return Activity;
      case 'workflow': return TrendingUp;
      default: return Bell;
    }
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'critical': return 'from-red-500 to-red-600';
      case 'high': return 'from-orange-500 to-orange-600';
      case 'medium': return 'from-yellow-500 to-yellow-600';
      case 'low': return 'from-blue-500 to-blue-600';
      default: return 'from-gray-500 to-gray-600';
    }
  };

  const getPriorityBadgeColor = (priority) => {
    switch (priority) {
      case 'critical': return 'bg-red-600';
      case 'high': return 'bg-orange-600';
      case 'medium': return 'bg-yellow-600';
      case 'low': return 'bg-blue-600';
      default: return 'bg-gray-600';
    }
  };

  if (isLoading) {
    return (
      <Card className="border-2 border-purple-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-purple-600 animate-pulse" />
            AI Smart Nudges
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="w-6 h-6 text-purple-600 animate-spin mr-2" />
            <span className="text-gray-600">Analyzing your workflow...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-2 border-red-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-red-600" />
            AI Smart Nudges
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert className="bg-red-50 border-red-200">
            <AlertTriangle className="w-4 h-4 text-red-600" />
            <AlertDescription className="text-red-900">
              Failed to load AI nudges. Please try again.
            </AlertDescription>
          </Alert>
          <Button onClick={handleRefresh} variant="outline" className="mt-4">
            <RefreshCw className="w-4 h-4 mr-2" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const activeNudges = nudgesData?.nudges?.filter(n => !dismissedNudges.has(n.id)) || [];
  const criticalCount = activeNudges.filter(n => n.priority === 'critical').length;
  const highCount = activeNudges.filter(n => n.priority === 'high').length;

  return (
    <Card className="border-2 border-purple-200 shadow-lg">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <motion.div
              animate={{ rotate: [0, 10, -10, 0] }}
              transition={{ repeat: Infinity, duration: 3 }}
            >
              <Brain className="w-5 h-5 text-purple-600" />
            </motion.div>
            AI Smart Nudges
            {(criticalCount > 0 || highCount > 0) && (
              <Badge className="bg-red-600 ml-2">
                {criticalCount + highCount} Urgent
              </Badge>
            )}
          </CardTitle>
          <Button
            onClick={handleRefresh}
            variant="ghost"
            size="sm"
            className="text-purple-600 hover:text-purple-700"
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
        <p className="text-sm text-gray-600 mt-1">
          Intelligent recommendations based on your current workload
        </p>
      </CardHeader>
      <CardContent>
        {activeNudges.length === 0 ? (
          <div className="text-center py-8">
            <CheckCircle2 className="w-12 h-12 text-green-600 mx-auto mb-3" />
            <p className="text-gray-900 font-semibold mb-1">You're all caught up!</p>
            <p className="text-sm text-gray-600">No urgent actions needed right now.</p>
          </div>
        ) : (
          <div className="space-y-3">
            <AnimatePresence>
              {activeNudges.map((nudge, index) => {
                const IconComponent = getIconForCategory(nudge.category);
                const priorityColor = getPriorityColor(nudge.priority);
                const badgeColor = getPriorityBadgeColor(nudge.priority);

                return (
                  <motion.div
                    key={nudge.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -100 }}
                    transition={{ delay: index * 0.1 }}
                  >
                    <div className={`relative rounded-lg border-2 overflow-hidden ${
                      nudge.priority === 'critical' ? 'border-red-300 bg-red-50' :
                      nudge.priority === 'high' ? 'border-orange-300 bg-orange-50' :
                      'border-gray-200 bg-white'
                    }`}>
                      {/* Priority Indicator */}
                      <div className={`absolute left-0 top-0 bottom-0 w-1.5 bg-gradient-to-b ${priorityColor}`} />
                      
                      <div className="pl-4 pr-3 py-3">
                        <div className="flex items-start gap-3">
                          <div className={`mt-0.5 p-2 rounded-lg bg-gradient-to-br ${priorityColor}`}>
                            <IconComponent className="w-4 h-4 text-white" />
                          </div>
                          
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2 mb-1">
                              <h4 className="font-semibold text-gray-900 text-sm leading-tight">
                                {nudge.title}
                              </h4>
                              <Badge className={`${badgeColor} text-xs flex-shrink-0`}>
                                {nudge.priority}
                              </Badge>
                            </div>
                            
                            <p className="text-sm text-gray-700 mb-2 leading-relaxed">
                              {nudge.message}
                            </p>
                            
                            <div className="flex items-center gap-2 flex-wrap">
                              {nudge.actionUrl && (
                                <Link to={nudge.actionUrl}>
                                  <Button
                                    size="sm"
                                    className={`bg-gradient-to-r ${priorityColor} hover:opacity-90 text-xs h-7`}
                                  >
                                    {nudge.action}
                                    <ChevronRight className="w-3 h-3 ml-1" />
                                  </Button>
                                </Link>
                              )}
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleDismiss(nudge.id)}
                                className="text-gray-500 hover:text-gray-700 text-xs h-7"
                              >
                                <X className="w-3 h-3 mr-1" />
                                Dismiss
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}

        {/* Summary Stats */}
        {nudgesData?.summary && activeNudges.length > 0 && (
          <div className="mt-4 pt-4 border-t flex items-center justify-between text-xs text-gray-600">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-red-600" />
                {nudgesData.summary.critical} Critical
              </span>
              <span className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-orange-600" />
                {nudgesData.summary.high} High
              </span>
              <span className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-yellow-600" />
                {nudgesData.summary.medium} Medium
              </span>
            </div>
            <span className="text-gray-500">
              Updated {new Date(nudgesData.generatedAt).toLocaleTimeString()}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}