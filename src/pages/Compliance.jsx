import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { 
  ShieldAlert, ScrollText, CalendarDays, BookOpen, AlertTriangle, CheckCircle2, Loader2
} from "lucide-react";
import PullToRefresh from "../components/mobile/PullToRefresh";

export default function Compliance() {
  const queryClient = useQueryClient();
  const { data: regulatoryUpdates = [], isLoading, error } = useQuery({
    queryKey: ['regulatoryUpdates'],
    queryFn: () => base44.entities.RegulatoryUpdate.list('-effective_date', 50),
  });

  const getImpactBadge = (impact) => {
    switch (impact) {
      case 'critical': return <Badge className="bg-red-600 text-white">Critical</Badge>;
      case 'high': return <Badge className="bg-orange-500 text-white">High</Badge>;
      case 'medium': return <Badge className="bg-yellow-500 text-white">Medium</Badge>;
      case 'low': return <Badge className="bg-blue-500 text-white">Low</Badge>;
      default: return <Badge variant="secondary">N/A</Badge>;
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'pending_review': return <Badge variant="secondary">Pending Review</Badge>;
      case 'under_review': return <Badge className="bg-blue-500 text-white">Under Review</Badge>;
      case 'approved': return <Badge className="bg-green-500 text-white">Approved</Badge>;
      case 'implemented': return <Badge className="bg-emerald-600 text-white">Implemented</Badge>;
      case 'dismissed': return <Badge variant="outline">Dismissed</Badge>;
      default: return <Badge variant="secondary">Unknown</Badge>;
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-slate-500" />
        <p className="ml-2 text-slate-600">Loading regulatory updates...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen text-red-600">
        <AlertTriangle className="w-10 h-10 mb-2" />
        <p className="text-lg">Error loading updates: {error.message}</p>
      </div>
    );
  }

  return (
    <PullToRefresh onRefresh={() => queryClient.invalidateQueries({ queryKey: ['regulatoryUpdates'] })}>
      <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold mb-6 text-slate-900 dark:text-slate-100">Regulatory Compliance Center</h1>
        <p className="text-slate-600 dark:text-slate-400 mb-8">
          Stay informed about the latest healthcare regulatory changes from various sources. These updates are automatically fetched and categorized to help you maintain compliance.
        </p>

        {regulatoryUpdates.length === 0 ? (
          <div className="text-center py-12">
            <CheckCircle2 className="w-16 h-16 mx-auto text-green-400 mb-4" />
            <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-200">No Recent Regulatory Updates</h2>
            <p className="text-slate-600 dark:text-slate-400">The system will automatically fetch and display new updates as they become available.</p>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {regulatoryUpdates.map((update) => (
              <Card key={update.id} className="hover-lift">
                <CardHeader>
                  <CardTitle className="text-lg font-bold flex items-start justify-between gap-2">
                    <span className="flex-1">{update.title}</span>
                    <div className="flex flex-col gap-2">
                      {getImpactBadge(update.impact_level)}
                      {getStatusBadge(update.status)}
                    </div>
                  </CardTitle>
                  <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 mt-2">
                    <ScrollText className="w-4 h-4" />
                    <span>Source: {update.source}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                    <CalendarDays className="w-4 h-4" />
                    <span>Effective: {update.effective_date ? format(new Date(update.effective_date), 'MMM d, yyyy') : 'N/A'}</span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-slate-700 dark:text-slate-300">{update.summary}</p>
                  {update.affected_areas && update.affected_areas.length > 0 && (
                    <div>
                      <h4 className="font-semibold text-sm mb-1">Affected Areas:</h4>
                      <div className="flex flex-wrap gap-2">
                        {update.affected_areas.map((area, idx) => (
                          <Badge key={idx} variant="outline">{area}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {update.suggested_training && update.suggested_training.length > 0 && (
                    <div>
                      <h4 className="font-semibold text-sm mb-1">Suggested Training:</h4>
                      <div className="flex flex-wrap gap-2">
                        {update.suggested_training.map((training, idx) => (
                          <Badge key={idx} className="bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200">{training}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {update.reference_url && (
                    <a 
                      href={update.reference_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center text-blue-600 hover:text-blue-800 text-sm font-medium"
                    >
                      <BookOpen className="w-4 h-4 mr-1" />
                      Read Full Details
                    </a>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </PullToRefresh>
  );
}