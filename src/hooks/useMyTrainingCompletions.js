import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

// Single source of truth for a learner's training completion data, derived from
// the LIVE entities the grading/certificate pipeline actually writes
// (TrainingAssignment + TrainingAttempt + TrainingCertificate), plus
// MicroLearningProgress for AI personalized micro-training. Replaces the
// retired TrainingCompletion entity. Mirrors the query shape used by
// MyTrainingDashboard.jsx so the whole app reads completion the same way.
//
// `completedCourseIds` is a Set of course_id values the user has completed —
// a TrainingModule is "complete" when completedCourseIds.has(module.course_id).
export function useMyTrainingCompletions(email) {
  const enabled = !!email;

  const { data: assignments = [], isLoading: loadingAssignments } = useQuery({
    queryKey: ["my-training-assignments", email],
    queryFn: () => base44.entities.TrainingAssignment.filter({ assigned_to_user_id: email }, "-due_date", 500),
    enabled,
    initialData: [],
  });

  const { data: attempts = [] } = useQuery({
    queryKey: ["my-training-attempts", email],
    queryFn: () => base44.entities.TrainingAttempt.filter({ user_id: email }, "-submitted_at", 500),
    enabled,
    initialData: [],
  });

  const { data: certificates = [] } = useQuery({
    queryKey: ["my-training-certificates", email],
    queryFn: () => base44.entities.TrainingCertificate.filter({ user_id: email }, "-issued_at", 200),
    enabled,
    initialData: [],
  });

  const { data: microProgress = [] } = useQuery({
    queryKey: ["my-micro-progress", email],
    queryFn: () => base44.entities.MicroLearningProgress.filter({ nurse_email: email }, "-created_date", 500),
    enabled,
    initialData: [],
  });

  const isCompleted = (a) => a.status === "completed" || a.pass_fail_result === "passed";

  const completedCourseIds = useMemo(() => {
    const ids = new Set();
    assignments.forEach((a) => { if (isCompleted(a) && a.course_id) ids.add(a.course_id); });
    certificates.forEach((c) => { if (!c.revoked && c.course_id) ids.add(c.course_id); });
    return ids;
  }, [assignments, certificates]);

  // Latest score per course (from attempts, then assignment fallback).
  const scoreByCourse = useMemo(() => {
    const map = {};
    [...attempts]
      .sort((a, b) => new Date(a.submitted_at || 0) - new Date(b.submitted_at || 0))
      .forEach((at) => { if (at.course_id && typeof at.score === "number") map[at.course_id] = at.score; });
    assignments.forEach((a) => {
      if (a.course_id && map[a.course_id] == null && typeof a.score_percentage === "number") map[a.course_id] = a.score_percentage;
    });
    return map;
  }, [attempts, assignments]);

  return {
    assignments,
    attempts,
    certificates,
    microProgress,
    completedCourseIds,
    scoreByCourse,
    isCompleted,
    isLoading: loadingAssignments,
  };
}

export default useMyTrainingCompletions;
