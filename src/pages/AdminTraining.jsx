import { useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BookOpen, Sparkles, TrendingDown, GraduationCap, Loader2, FileText, BarChart3, Clapperboard, ShieldCheck, FileCheck2 } from "lucide-react";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";
import EducatorReadinessPanel from "@/components/learning/EducatorReadinessPanel";
import CourseManager from "@/components/training/CourseManager";
import TrainingVideoStudio from "@/components/training/TrainingVideoStudio";
import LearningPlanManager from "@/components/training/LearningPlanManager";
import AIComplianceInServicesHub from "@/components/training/AIComplianceInServicesHub";
import AnnualMandatoryEducationHub from "@/components/training/AnnualMandatoryEducationHub";
import ManagerSkillGapSummary from "@/components/training/ManagerSkillGapSummary";
import ManagerSkillGapAreas from "@/components/training/ManagerSkillGapAreas";
import ManagerSkillGapPeople from "@/components/training/ManagerSkillGapPeople";
import StaffEducationComplianceReport from "@/components/training/StaffEducationComplianceReport";
import SMEReviewQueue from "@/components/training/SMEReviewQueue";
import PolicyAcknowledgmentManager from "@/components/training/PolicyAcknowledgmentManager";

const TAB_KEYS = [
  "overview",
  "courses",
  "review",
  "learning-plans",
  "ai-inservices",
  "annual-mandatory",
  "policies",
  "skill-gaps",
  "video-studio",
  "compliance-report",
];

const isManager = (user) => 
  user?.role === "admin" || 
  user?.account_type === "agency_admin" || 
  user?.account_type === "super_admin" || 
  user?.training_role === "supervisor" || 
  /manager|director|supervisor|lead/i.test(user?.job_title || "");

export default function AdminTraining() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const { data: currentUser, isLoading: userLoading } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const hasAccess = !userLoading && currentUser && (currentUser.role === 'admin' || isManager(currentUser));
  // The compliance report aggregates org-wide staff PII (names, emails, scores,
  // completions). Unlike the team-scoped Skill Gaps tab, it is not limited to a
  // manager's team, so restrict it to admins.
  const isAdmin = currentUser?.role === 'admin';
  const requestedTab = searchParams.get("tab");
  const adminOnlyTabs = new Set(["video-studio", "compliance-report"]);
  let activeTab = TAB_KEYS.includes(requestedTab) ? requestedTab : "overview";
  if (adminOnlyTabs.has(activeTab) && !isAdmin) activeTab = "overview";

  const handleTabChange = (value) => {
    setSearchParams(value === "overview" ? {} : { tab: value });
  };

  useEffect(() => {
    if (!userLoading && !hasAccess) {
      navigate('/', { replace: true });
    }
  }, [hasAccess, navigate, userLoading]);

  const { data: users = [] } = useQuery({
    queryKey: ["skill-gap-users"],
    queryFn: () => base44.entities.User.list('-created_date', 500),
    initialData: [],
    enabled: hasAccess,
  });

  const { data: assignments = [] } = useQuery({
    queryKey: ["skill-gap-assignments"],
    queryFn: () => base44.entities.TrainingAssignment.list('-created_date', 1000),
    initialData: [],
    enabled: hasAccess,
  });

  const { data: attempts = [] } = useQuery({
    queryKey: ["skill-gap-attempts"],
    queryFn: () => base44.entities.TrainingAttempt.list('-submitted_at', 1000),
    initialData: [],
    enabled: hasAccess,
  });

  const { data: courses = [] } = useQuery({
    queryKey: ["skill-gap-courses"],
    queryFn: () => base44.entities.TrainingCourse.list('-updated_date', 500),
    initialData: [],
    enabled: hasAccess,
  });

  const teamMembers = useMemo(() => {
    if (!currentUser) return [];
    if (currentUser.account_type === "super_admin") return users.filter((user) => user.email && user.role !== "admin");
    return users.filter((user) => {
      if (!user.email || user.role === "admin") return false;
      if (currentUser.account_type === "agency_admin" && currentUser.agency_name) 
        return user.agency_name === currentUser.agency_name;
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
    const stats = { 
      teamSize: teamMembers.length, 
      attemptCount: teamAttempts.length, 
      averageScore: Math.round((teamAttempts.reduce((sum, attempt) => sum + (attempt.score || 0), 0) / Math.max(teamAttempts.length, 1)) || 0), 
      followUpCount: 0 
    };

    const peopleMap = new Map();
    const areaMap = new Map();
    const missedMap = new Map();

    teamAttempts.forEach((attempt) => {
      const member = teamMembers.find((user) => user.email === attempt.user_id);
      const course = courseMap[attempt.course_id] || {};
      const category = course.category || "general";
      const personEntry = peopleMap.get(attempt.user_id) || { 
        email: attempt.user_id, 
        name: member?.full_name || attempt.user_id, 
        roleLabel: member?.job_title || member?.credential_type || member?.department || "Employee", 
        scores: [], 
        failedAttempts: 0 
      };
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

    const people = [...peopleMap.values()]
      .map((person) => ({ 
        ...person, 
        averageScore: Math.round(person.scores.reduce((sum, score) => sum + score, 0) / Math.max(person.scores.length, 1)) 
      }))
      .filter((person) => person.averageScore < 80 || person.failedAttempts > 0)
      .sort((a, b) => a.averageScore - b.averageScore);

    stats.followUpCount = people.length;

    const areas = [...areaMap.values()]
      .map((area) => ({ 
        name: area.name, 
        averageScore: Math.round(area.scores.reduce((sum, score) => sum + score, 0) / Math.max(area.scores.length, 1)), 
        failureRate: Math.round((area.failed / Math.max(area.attemptCount, 1)) * 100), 
        attemptCount: area.attemptCount, 
        courseCount: area.courses.size, 
        topIssue: area.topIssue 
      }))
      .sort((a, b) => a.averageScore - b.averageScore);

    const missedTopics = [...missedMap.values()]
      .map((topic) => ({ 
        ...topic, 
        missRate: Math.min(100, Math.round((topic.missCount / Math.max(topic.seen, 1)) * 100)) 
      }))
      .sort((a, b) => b.missCount - a.missCount)
      .slice(0, 10);

    return { stats, areas, people, missedTopics, assignmentCount: teamAssignments.length };
  }, [teamMembers, assignments, attempts, courses]);

  // Auth guards — placed after all hooks to satisfy Rules of Hooks
  if (userLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  if (!hasAccess) {
    return null;
  }

  return (
    <PageContainer>
      <PageHeader
        icon={GraduationCap}
        eyebrow="Manage"
        title="Training & Education Management"
        description="Manage courses, assign learning paths, monitor skill gaps, and generate AI-powered training"
        favoritePage="AdminTraining"
      />

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
          <TabsList className="inline-flex w-max min-w-full gap-1 h-auto p-1">
            <TabsTrigger value="overview" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <BarChart3 className="w-4 h-4 mr-2" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="courses" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <BookOpen className="w-4 h-4 mr-2" />
              Courses
            </TabsTrigger>
            <TabsTrigger value="review" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <ShieldCheck className="w-4 h-4 mr-2" />
              Review Queue
            </TabsTrigger>
            <TabsTrigger value="learning-plans" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              Learning Plans
            </TabsTrigger>
            <TabsTrigger value="ai-inservices" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <Sparkles className="w-4 h-4 mr-2" />
              AI In-Services
            </TabsTrigger>
            <TabsTrigger value="annual-mandatory" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              Annual Mandatory
            </TabsTrigger>
            <TabsTrigger value="policies" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <FileCheck2 className="w-4 h-4 mr-2" />
              Policies
            </TabsTrigger>
            <TabsTrigger value="skill-gaps" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <TrendingDown className="w-4 h-4 mr-2" />
              Skill Gaps
            </TabsTrigger>
            {isAdmin && (
              <TabsTrigger value="video-studio" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
                <Clapperboard className="w-4 h-4 mr-2" />
                Video Studio
              </TabsTrigger>
            )}
            {isAdmin && (
              <TabsTrigger value="compliance-report" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
                <FileText className="w-4 h-4 mr-2" />
                Compliance Report
              </TabsTrigger>
            )}
          </TabsList>
        </div>

        <TabsContent value="overview" className="space-y-6">
          <EducatorReadinessPanel />
        </TabsContent>

        <TabsContent value="courses">
          <CourseManager />
        </TabsContent>

        <TabsContent value="review">
          <SMEReviewQueue />
        </TabsContent>

        <TabsContent value="learning-plans">
          <LearningPlanManager />
        </TabsContent>

        <TabsContent value="ai-inservices">
          <AIComplianceInServicesHub />
        </TabsContent>

        <TabsContent value="annual-mandatory">
          <AnnualMandatoryEducationHub />
        </TabsContent>

        <TabsContent value="policies">
          <PolicyAcknowledgmentManager />
        </TabsContent>

        <TabsContent value="skill-gaps">
          <div className="space-y-6">
            <ManagerSkillGapSummary stats={analysis.stats} />
            <ManagerSkillGapAreas areas={analysis.areas} />
            <ManagerSkillGapPeople people={analysis.people} missedTopics={analysis.missedTopics} />
          </div>
        </TabsContent>

        {isAdmin && (
          <TabsContent value="video-studio">
            <TrainingVideoStudio />
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="compliance-report">
            <StaffEducationComplianceReport />
          </TabsContent>
        )}
      </Tabs>
    </PageContainer>
  );
}