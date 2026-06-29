import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Sparkles, BarChart3 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { createPageUrl } from "@/utils";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";
import ManagerSkillGapSummary from "@/components/training/ManagerSkillGapSummary";
import ManagerSkillGapAreas from "@/components/training/ManagerSkillGapAreas";
import ManagerSkillGapPeople from "@/components/training/ManagerSkillGapPeople";

const isManager = (user) => user?.role === "admin" || user?.account_type === "agency_admin" || user?.account_type === "super_admin" || user?.training_role === "supervisor" || /manager|director|supervisor|lead/i.test(user?.job_title || "");

export default function ManagerSkillGapDashboard() {
  const { data: currentUser } = useQuery({ queryKey: ["currentUser"], queryFn: () => base44.auth.me() });
  const { data: users = [] } = useQuery({ queryKey: ["skill-gap-users"], queryFn: () => base44.entities.User.list('-created_date', 500), initialData: [] });
  const { data: assignments = [] } = useQuery({ queryKey: ["skill-gap-assignments"], queryFn: () => base44.entities.TrainingAssignment.list('-created_date', 1000), initialData: [] });
  const { data: attempts = [] } = useQuery({ queryKey: ["skill-gap-attempts"], queryFn: () => base44.entities.TrainingAttempt.list('-submitted_at', 1000), initialData: [] });
  const { data: courses = [] } = useQuery({ queryKey: ["skill-gap-courses"], queryFn: () => base44.entities.TrainingCourse.list('-updated_date', 500), initialData: [] });

  const teamMembers = useMemo(() => {
    if (!currentUser) return [];
    if (currentUser.account_type === "super_admin") return users.filter((user) => user.email && user.role !== "admin");
    return users.filter((user) => {
      if (!user.email || user.role === "admin") return false;
      if (currentUser.account_type === "agency_admin" && currentUser.agency_name) return user.agency_name === currentUser.agency_name;
      if (currentUser.department && user.department === currentUser.department) return true;
      if (currentUser.location && user.location === currentUser.location) return true;
      if (currentUser.business_line && user.business_line === currentUser.business_line) return true;
      return false;
    });
  }, [currentUser, users]);

  const analysis = useMemo(() => {
    const teamEmails = new Set(teamMembers.map((member) => member.email));
    const teamAssignments = assignments.filter((assignment) => teamEmails.has(assignment.assigned_to_user_id));
    const teamAttempts = attempts.filter((attempt) => teamEmails.has(attempt.user_id));
    const courseMap = Object.fromEntries(courses.map((course) => [course.id, course]));
    const stats = { teamSize: teamMembers.length, attemptCount: teamAttempts.length, averageScore: Math.round((teamAttempts.reduce((sum, attempt) => sum + (attempt.score || 0), 0) / Math.max(teamAttempts.length, 1)) || 0), followUpCount: 0 };
    const peopleMap = new Map();
    const areaMap = new Map();
    const missedMap = new Map();

    teamAttempts.forEach((attempt) => {
      const member = teamMembers.find((user) => user.email === attempt.user_id);
      const course = courseMap[attempt.course_id] || {};
      const category = course.category || "general";
      const personEntry = peopleMap.get(attempt.user_id) || { email: attempt.user_id, name: member?.full_name || attempt.user_id, roleLabel: member?.job_title || member?.credential_type || member?.department || "Employee", scores: [], failedAttempts: 0 };
      personEntry.scores.push(attempt.score || 0);
      if (attempt.pass_fail_result === "failed" || attempt.passed === false) personEntry.failedAttempts += 1;
      peopleMap.set(attempt.user_id, personEntry);
      const areaEntry = areaMap.get(category) || { name: category, scores: [], failed: 0, attemptCount: 0, courses: new Set(), topIssue: "" };
      areaEntry.scores.push(attempt.score || 0);
      areaEntry.attemptCount += 1;
      areaEntry.courses.add(attempt.course_id);
      if (attempt.pass_fail_result === "failed" || attempt.passed === false) areaEntry.failed += 1;
      (attempt.answers_json || []).forEach((answer) => {
        if (answer.correct === false || (answer.points_earned ?? 0) < (answer.points_possible ?? 1)) {
          const missKey = `${category}__${answer.prompt}`;
          const missEntry = missedMap.get(missKey) || { category, prompt: answer.prompt, missCount: 0, seen: 0 };
          missEntry.missCount += 1;
          missEntry.seen += 1;
          missedMap.set(missKey, missEntry);
          if (!areaEntry.topIssue) areaEntry.topIssue = answer.prompt;
        }
      });
      areaMap.set(category, areaEntry);
    });

    const people = [...peopleMap.values()].map((person) => ({ ...person, averageScore: Math.round(person.scores.reduce((sum, score) => sum + score, 0) / Math.max(person.scores.length, 1)) })).filter((person) => person.averageScore < 80 || person.failedAttempts > 0).sort((a, b) => a.averageScore - b.averageScore);
    stats.followUpCount = people.length;
    const areas = [...areaMap.values()].map((area) => ({ name: area.name, averageScore: Math.round(area.scores.reduce((sum, score) => sum + score, 0) / Math.max(area.scores.length, 1)), failureRate: Math.round((area.failed / Math.max(area.attemptCount, 1)) * 100), attemptCount: area.attemptCount, courseCount: area.courses.size, topIssue: area.topIssue })).sort((a, b) => a.averageScore - b.averageScore);
    const missedTopics = [...missedMap.values()].map((topic) => ({ ...topic, missRate: Math.min(100, Math.round((topic.missCount / Math.max(topic.seen, 1)) * 100)) })).sort((a, b) => b.missCount - a.missCount).slice(0, 10);
    return { stats, areas, people, missedTopics, assignmentCount: teamAssignments.length };
  }, [teamMembers, assignments, attempts, courses]);

  if (currentUser && !isManager(currentUser)) return <div className="max-w-3xl mx-auto p-6 text-slate-600">This dashboard is available to managers, supervisors, and admins only.</div>;

  return (
    <PageContainer>
      <PageHeader
        icon={BarChart3}
        eyebrow="Manage"
        title="Skill Gap Dashboard"
        description="Identify team-wide clinical and operational skill gaps based on competency test performance and failed attempts."
        favoritePage="ManagerSkillGapDashboard"
        actions={
          <Link to={createPageUrl('AIComplianceInServices')}>
            <button className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              <Sparkles className="w-4 h-4 mr-2" /> Open AI Compliance In-Services
            </button>
          </Link>
        }
      />
      <ManagerSkillGapSummary stats={analysis.stats} />
      <ManagerSkillGapAreas areas={analysis.areas} />
      <ManagerSkillGapPeople people={analysis.people} missedTopics={analysis.missedTopics} />
    </PageContainer>
  );
}