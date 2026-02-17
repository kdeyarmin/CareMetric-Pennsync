import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Shield, GraduationCap, Loader2 } from "lucide-react";
import TopicSuggester from "./TopicSuggester";
import EducationContentGenerator from "./EducationContentGenerator";
import EducationDraftReviewer from "./EducationDraftReviewer";

export default function PersonalizedEducationModule({ patientId, patient, carePlans, currentUser }) {
  const queryClient = useQueryClient();
  const [selectedTopic, setSelectedTopic] = useState(null);

  const { data: drafts = [], isLoading } = useQuery({
    queryKey: ["educationDrafts", patientId],
    queryFn: () => base44.entities.PatientEducationDraft.filter({ patient_id: patientId }),
    enabled: !!patientId,
  });

  const handleGenerated = async (material) => {
    await base44.entities.PatientEducationDraft.create({
      patient_id: patientId,
      generated_by: currentUser.email,
      title: material.title,
      topic: material.topic,
      reading_level: material.reading_level,
      content: material.content,
      key_points: material.key_points || [],
      warning_signs: material.warning_signs || [],
      action_items: material.action_items || [],
      status: "draft",
    });
    queryClient.invalidateQueries({ queryKey: ["educationDrafts", patientId] });
    setSelectedTopic(null);
  };

  const pendingDrafts = drafts.filter(d => d.status === "draft");
  const approvedDrafts = drafts.filter(d => d.status === "approved");
  const sentDrafts = drafts.filter(d => d.status === "sent");
  const patientName = `${patient?.first_name || ""} ${patient?.last_name || ""}`.trim();

  return (
    <Card className="w-full max-w-full overflow-hidden">
      <CardHeader className="p-3 pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <GraduationCap className="w-4 h-4 text-blue-600" />
            Patient Education
          </CardTitle>
          <div className="flex gap-1">
            {pendingDrafts.length > 0 && (
              <Badge className="bg-amber-100 text-amber-700 text-[9px]">{pendingDrafts.length} pending review</Badge>
            )}
            {approvedDrafts.length > 0 && (
              <Badge className="bg-green-100 text-green-700 text-[9px]">{approvedDrafts.length} ready to send</Badge>
            )}
            <Badge className="bg-slate-100 text-slate-500 text-[9px]">
              <Shield className="w-2.5 h-2.5 mr-0.5" /> HIPAA
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-3 space-y-4">
        {/* Step 1: AI suggests topics */}
        <TopicSuggester
          patient={patient}
          carePlans={carePlans}
          onSelectTopic={(t) => setSelectedTopic(t)}
        />

        {/* Step 2: Generate content */}
        <EducationContentGenerator
          patient={patient}
          carePlans={carePlans}
          selectedTopic={selectedTopic}
          onGenerated={handleGenerated}
        />

        {/* Step 3: Review queue */}
        {isLoading && (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
          </div>
        )}

        {/* Drafts needing review */}
        {pendingDrafts.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-amber-600">⏳ Awaiting Review ({pendingDrafts.length})</p>
            {pendingDrafts.map(d => (
              <EducationDraftReviewer
                key={d.id}
                draft={d}
                currentUser={currentUser}
                patientId={patientId}
                patientName={patientName}
              />
            ))}
          </div>
        )}

        {/* Approved, ready to send */}
        {approvedDrafts.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-green-600">✅ Approved — Ready to Send ({approvedDrafts.length})</p>
            {approvedDrafts.map(d => (
              <EducationDraftReviewer
                key={d.id}
                draft={d}
                currentUser={currentUser}
                patientId={patientId}
                patientName={patientName}
              />
            ))}
          </div>
        )}

        {/* Sent history */}
        {sentDrafts.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-blue-600">📨 Sent ({sentDrafts.length})</p>
            {sentDrafts.map(d => (
              <EducationDraftReviewer
                key={d.id}
                draft={d}
                currentUser={currentUser}
                patientId={patientId}
                patientName={patientName}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}