import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BookOpen, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import { format } from "date-fns";

const DELIVERY_METHOD_LABELS = {
  in_person: "In-Person",
  via_portal: "Via Portal",
  printed: "Printed",
  email: "Email",
  video_call: "Video Call",
  phone: "Phone",
  other: "Other"
};

const DELIVERY_METHOD_COLORS = {
  in_person: "bg-blue-100 text-blue-800",
  via_portal: "bg-purple-100 text-purple-800",
  printed: "bg-orange-100 text-orange-800",
  email: "bg-green-100 text-green-800",
  video_call: "bg-cyan-100 text-cyan-800",
  phone: "bg-pink-100 text-pink-800",
  other: "bg-gray-100 text-gray-800"
};

export default function EducationHistoryTracker({ patientId }) {
  const { data: assignments = [], isLoading } = useQuery({
    queryKey: ["educationAssignments", patientId],
    queryFn: async () => {
      return await base44.entities.PatientEducationAssignment.filter(
        { patient_id: patientId },
        "-provided_date",
        100
      );
    },
    enabled: !!patientId
  });

  if (!patientId) return null;

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="w-5 h-5" />
            Education History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-sm text-slate-500">Loading...</div>
        </CardContent>
      </Card>
    );
  }

  if (assignments.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="w-5 h-5" />
            Education History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-slate-500 dark:text-slate-400 text-sm">
            <BookOpen className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p>No education materials provided yet</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BookOpen className="w-5 h-5" />
          Education History ({assignments.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {assignments.map((assignment) => (
            <div
              key={assignment.id}
              className="bg-slate-50 dark:bg-slate-900 p-4 rounded-lg border border-slate-200 dark:border-slate-800"
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex-1">
                  <h4 className="font-semibold text-sm mb-1">
                    {assignment.material_title}
                  </h4>
                  {assignment.care_plan_problem && (
                    <p className="text-xs text-slate-600 dark:text-slate-400 mb-2">
                      Care Plan: {assignment.care_plan_problem}
                    </p>
                  )}
                </div>
                <Badge
                  className={DELIVERY_METHOD_COLORS[assignment.delivery_method]}
                >
                  {DELIVERY_METHOD_LABELS[assignment.delivery_method]}
                </Badge>
              </div>

              <div className="flex items-center gap-4 text-xs text-slate-600 dark:text-slate-400 mb-2">
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {assignment.provided_date
                    ? format(new Date(assignment.provided_date), "MMM d, yyyy")
                    : format(new Date(assignment.assigned_date), "MMM d, yyyy")}
                </span>
              </div>

              {/* Understanding Status */}
              <div className="flex items-center gap-2 mb-2">
                {assignment.patient_understood === true && (
                  <div className="flex items-center gap-1 px-2 py-1 bg-green-100 dark:bg-green-900 rounded text-xs text-green-800 dark:text-green-200">
                    <CheckCircle2 className="w-3 h-3" />
                    Patient Understood
                  </div>
                )}
                {assignment.patient_understood === false && (
                  <div className="flex items-center gap-1 px-2 py-1 bg-amber-100 dark:bg-amber-900 rounded text-xs text-amber-800 dark:text-amber-200">
                    <AlertCircle className="w-3 h-3" />
                    Needs Clarification
                  </div>
                )}
              </div>

              {/* Notes */}
              {assignment.notes && (
                <div className="mt-2 p-2 bg-white dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700">
                  <p className="text-xs text-slate-700 dark:text-slate-300 italic">
                    "{assignment.notes}"
                  </p>
                </div>
              )}

              {/* Follow-up Flag */}
              {assignment.follow_up_needed && (
                <div className="mt-2 text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950 p-2 rounded border border-amber-200 dark:border-amber-800">
                  ⚠️ Follow-up education needed
                </div>
              )}

              {/* Assigned By */}
              <p className="text-xs text-slate-500 dark:text-slate-500 mt-2">
                by {assignment.assigned_by}
              </p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}