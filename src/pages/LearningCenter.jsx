import { useState, useMemo, useEffect, useCallback, lazy, Suspense } from 'react';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import EmptyState from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  GraduationCap,
  BookOpen,
  Award,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Users,
  BarChart3,
  Sparkles,
  Search,
  Filter,
  TrendingUp,
  Calendar,
  ChevronRight,
  Target,
  Loader2,
  BookOpenCheck,
  LayoutDashboard,
  PlayCircle,
  ShieldCheck,
  ArrowRight,
  CalendarClock,
  UserPlus,
  Check,
  Trophy,
  Flame,
  Star,
  Download,
  CalendarPlus,
  FileCheck2,
  Brain
} from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import PageContainer from '@/components/ui/PageContainer';
import PageHeader from '@/components/ui/PageHeader';
import EmbeddedPage from '@/components/ui/embeddedPage';
import { createPageUrl } from '@/utils';
import { Link, useSearchParams } from 'react-router-dom';
import CertificateDownloadButton from '@/components/training/CertificateDownloadButton';
import LearnerPolicyAcknowledgments from '@/components/training/LearnerPolicyAcknowledgments';
import LearnerMemoryBoosters from '@/components/training/LearnerMemoryBoosters';
import EducatorReadinessPanel from '@/components/learning/EducatorReadinessPanel';
import GamificationDashboard from '@/components/training/GamificationDashboard';
import { selfEnrollCourse } from '@/functions/selfEnrollCourse';
import { generateLearningTranscriptPDF } from '@/functions/generateLearningTranscriptPDF';
import { submitCourseFeedback } from '@/functions/submitCourseFeedback';
import { getCourseFeedbackSummary } from '@/functions/getCourseFeedbackSummary';

// Lazy spokes — the former My Learning hub's tabs (My Courses, In-Services,
// Annual Education, Transcripts) now render inside this canonical Learning Center.
// /MyLearning and its sub-page paths redirect here (see REDIRECTS in src/routes.jsx).
const MyTraining = lazy(() => import('@/components/hub-tabs/MyTraining'));
const MyAnnualEducation = lazy(() => import('@/components/hub-tabs/MyAnnualEducation'));
const AnnualMandatoryEducation = lazy(() => import('@/components/hub-tabs/AnnualMandatoryEducation'));
const AnnualEducationTranscript = lazy(() => import('@/components/hub-tabs/AnnualEducationTranscript'));
const EmployeeTranscript = lazy(() => import('@/components/hub-tabs/EmployeeTranscript'));

// Tab keys kept in sync with the TabsTrigger values below, so the ?tab= deep-link
// (and the redirects from the retired My Learning pages) resolve to the right tab.
// "active" is the default.
const TAB_KEYS = [
  'active', 'plans', 'catalog', 'competencies', 'certificates', 'renewals', 'achievements',
  'boosters', 'courses', 'inservices', 'annual', 'policies', 'transcripts',
];

const tabLoader = (
  <div className="flex justify-center py-12">
    <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
  </div>
);

const formatDate = (value) => value ? new Date(value).toLocaleDateString() : '—';

// Build an all-day .ics calendar from renewal items (client-side, browser only)
const icsEscape = (s) => String(s || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
const toIcsDate = (value) => {
  const d = new Date(value);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
};
const buildRenewalIcs = (items) => {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//PENNSync//Learning//EN', 'CALSCALE:GREGORIAN'];
  items.forEach((item) => {
    const start = new Date(item.date);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${item.id}@pennsync`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${toIcsDate(start)}`,
      `DTEND;VALUE=DATE:${toIcsDate(end)}`,
      `SUMMARY:${icsEscape(`${item.kind}: ${item.title}`)}`,
      `DESCRIPTION:${icsEscape(`${item.kind} for ${item.title}. Tracked in PENNSync My Learning.`)}`,
      'END:VEVENT'
    );
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
};
const downloadBlob = (filename, content, type) => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// Read-only average rating display
function StarsDisplay({ value, count }) {
  return (
    <div className="flex items-center gap-1" title={`${value.toFixed(1)} average from ${count} rating${count === 1 ? '' : 's'}`}>
      <div className="flex">
        {[1, 2, 3, 4, 5].map(n => (
          <Star key={n} className={`w-3.5 h-3.5 ${n <= Math.round(value) ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`} />
        ))}
      </div>
      <span className="text-xs text-slate-500">{value.toFixed(1)} ({count})</span>
    </div>
  );
}

// Interactive star input for submitting a rating
function RateStars({ value, onRate, disabled }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          disabled={disabled}
          onClick={() => onRate(n)}
          className="rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-1 disabled:opacity-50"
          aria-label={`Rate ${n} star${n === 1 ? '' : 's'}`}
        >
          <Star className={`w-5 h-5 transition-colors ${n <= (value || 0) ? 'fill-amber-400 text-amber-400' : 'text-slate-300 hover:text-amber-300'}`} />
        </button>
      ))}
    </div>
  );
}
const daysUntil = (date) => {
  if (!date) return Infinity;
  const target = new Date(date);
  const now = new Date();
  // Compare dates only, ignoring time to avoid timezone edge cases
  target.setHours(23, 59, 59, 999);
  now.setHours(0, 0, 0, 0);
  return Math.ceil((target - now) / (1000 * 60 * 60 * 24));
};

export default function LearningCenter() {
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [businessLineFilter, setBusinessLineFilter] = useState('all');
  const [requiredOnly, setRequiredOnly] = useState(false);
  const [catalogLimit, setCatalogLimit] = useState(12);
  const queryClient = useQueryClient();

  const { data: user, isLoading: userLoading } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: assignments = [], isLoading: assignmentsLoading } = useQuery({
    queryKey: ['lc-assignments', user?.email],
    queryFn: () => base44.entities.TrainingAssignment.filter({
      assigned_to_user_id: user.email,
    }, '-due_date', 200),
    enabled: !!user?.email,
    initialData: []
  });

  const { data: certificates = [] } = useQuery({
    queryKey: ['lc-certificates', user?.email],
    queryFn: () => base44.entities.TrainingCertificate.filter({
      user_id: user.email,
      revoked: false
    }, '-issued_at', 100),
    enabled: !!user?.email,
    initialData: []
  });

  const { data: enrollments = [] } = useQuery({
    queryKey: ['lc-plan-enrollments', user?.email],
    queryFn: () => base44.entities.PlanEnrollment.filter({
      user_id: user.email,
    }, '-enrolled_at', 50),
    enabled: !!user?.email,
    initialData: []
  });

  const { data: courses = [] } = useQuery({
    queryKey: ['lc-published-courses'],
    queryFn: () => base44.entities.TrainingCourse.filter({
      status: 'published'
    }, '-updated_date', 200),
    initialData: []
  });

  const { data: competencies = [] } = useQuery({
    queryKey: ['my-competencies', user?.role],
    queryFn: () => base44.entities.Competency.filter({
      role_target: user.role,
      active: true
    }),
    enabled: !!user?.role,
    initialData: []
  });

  const { data: leaderboardEntry = null } = useQuery({
    queryKey: ['lc-leaderboard', user?.email],
    queryFn: async () => {
      const entries = await base44.entities.Leaderboard.filter({ user_id: user.email });
      return entries[0] || null;
    },
    enabled: !!user?.email,
    initialData: null
  });

  const { data: feedbackData = { summaries: {}, mine: {} } } = useQuery({
    queryKey: ['lc-course-feedback', user?.email],
    queryFn: async () => {
      const res = await getCourseFeedbackSummary({});
      return res?.data || res;
    },
    enabled: !!user?.email,
    initialData: { summaries: {}, mine: {} }
  });

  // Derived data
  const activeAssignments = useMemo(() =>
    assignments.filter(a => ['assigned', 'in_progress', 'overdue'].includes(a.status)),
    [assignments]
  );
  const completedAssignments = useMemo(() =>
    assignments.filter(a => a.status === 'completed' || a.pass_fail_result === 'passed'),
    [assignments]
  );
  const overdueAssignments = useMemo(() =>
    assignments.filter(a => a.status === 'overdue'),
    [assignments]
  );
  const dueSoonAssignments = useMemo(() =>
    activeAssignments.filter(a => {
      const days = daysUntil(a.due_date);
      return days >= 0 && days <= 7 && a.status !== 'overdue';
    }),
    [activeAssignments]
  );

  // Lookup of published courses by id for joining assignments to course metadata
  const courseById = useMemo(
    () => Object.fromEntries(courses.map(c => [c.id, c])),
    [courses]
  );

  // An assignment counts as "required" when the assignment is flagged required,
  // or its course is an annual mandatory / compliance in-service.
  const isRequiredAssignment = useCallback(
    (a) =>
      a.required === true ||
      ['annual_mandatory', 'in_service'].includes(courseById[a.course_id]?.training_type),
    [courseById]
  );

  const requiredAssignments = useMemo(
    () => assignments.filter(isRequiredAssignment),
    [assignments, isRequiredAssignment]
  );
  const requiredCompleted = useMemo(
    () => requiredAssignments.filter(a => a.status === 'completed' || a.pass_fail_result === 'passed'),
    [requiredAssignments]
  );
  const requiredOutstanding = useMemo(
    () => requiredAssignments
      .filter(a => !(a.status === 'completed' || a.pass_fail_result === 'passed'))
      .sort((a, b) => new Date(a.due_date || '9999') - new Date(b.due_date || '9999')),
    [requiredAssignments]
  );
  const requiredReadiness = requiredAssignments.length > 0
    ? Math.round((requiredCompleted.length / requiredAssignments.length) * 100)
    : 100;

  // Most recently touched in-progress course, for a quick "continue" entry point
  const resumeAssignment = useMemo(() => {
    const inProgress = assignments.filter(a => a.status === 'in_progress');
    return [...inProgress].sort(
      (a, b) => new Date(b.last_accessed || b.started_date || 0) - new Date(a.last_accessed || a.started_date || 0)
    )[0] || null;
  }, [assignments]);

  // CEU hours earned from completed courses, with a per-category breakdown
  const ceu = useMemo(() => {
    let total = 0;
    const byCategory = {};
    completedAssignments.forEach(a => {
      const course = courseById[a.course_id];
      const hours = Number(course?.ceu_hours) || 0;
      if (hours <= 0) return;
      total += hours;
      const cat = course?.category || 'general';
      byCategory[cat] = (byCategory[cat] || 0) + hours;
    });
    const breakdown = Object.entries(byCategory)
      .map(([category, hours]) => ({ category, hours }))
      .sort((x, y) => y.hours - x.hours);
    return { total: Math.round(total * 10) / 10, breakdown };
  }, [completedAssignments, courseById]);

  // Courses the user already has an assignment for (to gate self-enrollment)
  const assignedCourseIds = useMemo(
    () => new Set(assignments.map(a => a.course_id)),
    [assignments]
  );

  // Upcoming renewals: certificate expirations + scheduled training renewals
  const renewals = useMemo(() => {
    const items = [];
    certificates.forEach(c => {
      if (c.expiration_date) {
        items.push({ id: `cert-${c.id}`, title: c.course_title, kind: 'Certificate expiration', date: c.expiration_date });
      }
    });
    assignments.forEach(a => {
      if (a.renewal_due_date) {
        items.push({ id: `asg-${a.id}`, title: a.course_title, kind: 'Training renewal', date: a.renewal_due_date });
      }
    });
    return items.sort((x, y) => new Date(x.date) - new Date(y.date));
  }, [certificates, assignments]);

  // Self-enrollment for elective (non-required) catalog courses
  const [enrollFeedback, setEnrollFeedback] = useState({});
  const enrollMutation = useMutation({
    mutationFn: (courseId) => selfEnrollCourse({ courseId }),
    onMutate: (courseId) => setEnrollFeedback(prev => ({ ...prev, [courseId]: 'loading' })),
    onSuccess: (_data, courseId) => {
      setEnrollFeedback(prev => ({ ...prev, [courseId]: 'done' }));
      queryClient.invalidateQueries({ queryKey: ['lc-assignments', user?.email] });
    },
    onError: (_err, courseId) => setEnrollFeedback(prev => ({ ...prev, [courseId]: 'error' })),
  });

  // Download the current user's training transcript as a PDF
  const [downloadingTranscript, setDownloadingTranscript] = useState(false);
  const downloadTranscript = async () => {
    if (!user?.email) return;
    setDownloadingTranscript(true);
    try {
      const response = await generateLearningTranscriptPDF({ employeeId: user.email });
      downloadBlob(`Training_Transcript_${new Date().toISOString().split('T')[0]}.pdf`, response.data, 'application/pdf');
    } catch (error) {
      console.error('Failed to download transcript:', error);
    } finally {
      setDownloadingTranscript(false);
    }
  };

  const exportRenewalsCalendar = (items) => {
    if (!items.length) return;
    downloadBlob(`learning_renewals_${new Date().toISOString().split('T')[0]}.ics`, buildRenewalIcs(items), 'text/calendar;charset=utf-8;');
  };

  // Aggregate course ratings: average, count, and the current user's own rating
  const feedbackByCourse = useMemo(() => {
    const map = {};
    const summaries = feedbackData?.summaries || {};
    const mine = feedbackData?.mine || {};
    Object.entries(summaries).forEach(([id, s]) => {
      map[id] = { avg: s.avg || 0, count: s.count || 0, mine: mine[id] ?? null };
    });
    Object.entries(mine).forEach(([id, rating]) => {
      if (!map[id]) map[id] = { avg: 0, count: 0, mine: rating };
    });
    return map;
  }, [feedbackData]);

  const [ratingFeedback, setRatingFeedback] = useState({});
  const feedbackMutation = useMutation({
    mutationFn: ({ courseId, rating }) => submitCourseFeedback({ courseId, rating }),
    onMutate: ({ courseId }) => setRatingFeedback(prev => ({ ...prev, [courseId]: 'saving' })),
    onSuccess: (_data, { courseId }) => {
      setRatingFeedback(prev => ({ ...prev, [courseId]: 'done' }));
      queryClient.invalidateQueries({ queryKey: ['lc-course-feedback'] });
    },
    onError: (_err, { courseId }) => setRatingFeedback(prev => ({ ...prev, [courseId]: 'error' })),
  });

  // Sort active assignments: overdue first, then due soonest
  const sortedActive = useMemo(() => {
    const order = { overdue: 0, in_progress: 1, assigned: 2 };
    return [...activeAssignments].sort((a, b) => {
      const orderDiff = (order[a.status] ?? 3) - (order[b.status] ?? 3);
      if (orderDiff !== 0) return orderDiff;
      return new Date(a.due_date || '9999') - new Date(b.due_date || '9999');
    });
  }, [activeAssignments]);

  const isRequiredCourse = (c) =>
    c.is_mandatory === true || ['annual_mandatory', 'in_service'].includes(c.training_type);

  // Filter courses for catalog
  const filteredCourses = useMemo(() => {
    let filtered = courses;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(c =>
        c.title?.toLowerCase().includes(q) ||
        c.short_description?.toLowerCase().includes(q) ||
        c.category?.toLowerCase().includes(q)
      );
    }
    if (categoryFilter !== 'all') {
      filtered = filtered.filter(c => c.category === categoryFilter);
    }
    if (businessLineFilter !== 'all') {
      filtered = filtered.filter(c =>
        !c.business_line_scope || c.business_line_scope === 'all' || c.business_line_scope === businessLineFilter
      );
    }
    if (requiredOnly) {
      filtered = filtered.filter(isRequiredCourse);
    }
    return filtered;
  }, [courses, searchQuery, categoryFilter, businessLineFilter, requiredOnly]);

  const categories = useMemo(() => {
    const cats = new Set(courses.map(c => c.category).filter(Boolean));
    return Array.from(cats).sort();
  }, [courses]);

  // Expiring certificates (within 90 days)
  const expiringCerts = useMemo(() =>
    certificates.filter(c => {
      if (!c.expiration_date) return false;
      const days = daysUntil(c.expiration_date);
      return days >= 0 && days <= 90;
    }),
    [certificates]
  );

  // Active learning plans
  const activePlans = useMemo(() =>
    enrollments.filter(e => e.status !== 'completed'),
    [enrollments]
  );

  const isEducatorOrAdmin = user?.role === 'admin' || user?.training_role === 'educator';
  const isSupervisor = user?.training_role === 'supervisor';

  // Overall completion rate
  const completionRate = assignments.length > 0
    ? Math.round((completedAssignments.length / assignments.length) * 100)
    : 0;

  // Controlled tabs so the active tab is shareable/bookmarkable and the redirects
  // from the retired My Learning pages deep-link correctly. "active" is the default,
  // so it stays a clean /LearningCenter with no query string.
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const activeTab = TAB_KEYS.includes(requestedTab) ? requestedTab : 'active';
  const handleTabChange = (value) => {
    setSearchParams(value === 'active' ? {} : { tab: value });
  };
  // Converge on the canonical URL: strip a redundant or unknown ?tab= so the
  // default tab is plain /LearningCenter (a valid deep-link like ?tab=annual is
  // left untouched).
  useEffect(() => {
    if (requestedTab !== null && activeTab === 'active') {
      setSearchParams({}, { replace: true });
    }
  }, [requestedTab, activeTab, setSearchParams]);

  if (userLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        icon={GraduationCap}
        eyebrow="My Learning"
        title={`Welcome back${user?.full_name ? `, ${user.full_name.split(' ')[0]}` : ''}`}
        description="Your professional development hub — courses, certifications, and learning plans"
        favoritePage="LearningCenter"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={downloadTranscript} disabled={downloadingTranscript || !user?.email}>
              {downloadingTranscript ? (
                <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Preparing...</>
              ) : (
                <><Download className="w-4 h-4 mr-1.5" /> Transcript PDF</>
              )}
            </Button>
            {isEducatorOrAdmin && (
              <Link to={createPageUrl('AdminTraining')}>
                <Button variant="outline" size="sm">
                  <Sparkles className="w-4 h-4 mr-1.5" />
                  Training Admin
                </Button>
              </Link>
            )}
          </div>
        }
      />

      {/* Quick Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Active Courses', value: activeAssignments.length, icon: BookOpen, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200' },
          { label: 'Overdue', value: overdueAssignments.length, icon: AlertTriangle, color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200' },
          { label: 'Due This Week', value: dueSoonAssignments.length, icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200' },
          { label: 'Completed', value: completedAssignments.length, icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200' },
          { label: 'Certificates', value: certificates.length, icon: Award, color: 'text-navy-600', bg: 'bg-navy-50', border: 'border-navy-200' },
          { label: 'Competencies', value: competencies.length, icon: Target, color: 'text-indigo-600', bg: 'bg-indigo-50', border: 'border-indigo-200' },
        ].map(item => {
          const Icon = item.icon;
          return (
            <Card key={item.label} className={`border ${item.border}`}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-slate-500">{item.label}</p>
                    <p className={`text-2xl font-bold mt-1 ${item.color}`}>{item.value}</p>
                  </div>
                  <div className={`w-10 h-10 ${item.bg} rounded-xl flex items-center justify-center`}>
                    <Icon className={`w-5 h-5 ${item.color}`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Continue Learning */}
      {resumeAssignment && (
        <Card className="border-l-4 border-l-navy-500">
          <CardContent className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-11 h-11 bg-blue-100 rounded-xl flex items-center justify-center flex-shrink-0">
                <PlayCircle className="w-6 h-6 text-blue-600" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Continue Learning</p>
                <h3 className="font-bold text-slate-900 truncate">{resumeAssignment.course_title}</h3>
                <div className="flex items-center gap-2 mt-1">
                  <Progress value={resumeAssignment.progress_percentage || 0} className="h-1.5 w-32 sm:w-48" />
                  <span className="text-xs text-slate-500 flex-shrink-0">{resumeAssignment.progress_percentage || 0}% complete</span>
                </div>
              </div>
            </div>
            <Link to={`${createPageUrl('TrainingCoursePlayer')}?assignment=${resumeAssignment.id}`} className="flex-shrink-0">
              <Button className="w-full sm:w-auto">
                Resume
                <ArrowRight className="w-4 h-4 ml-1.5" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Required Training Compliance Readiness */}
      {requiredAssignments.length > 0 && (
        <Card className={`border-2 ${requiredReadiness === 100 ? 'border-emerald-200 bg-emerald-50/30' : 'border-indigo-200 bg-indigo-50/30'}`}>
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex items-start gap-3 min-w-0">
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${requiredReadiness === 100 ? 'bg-emerald-100' : 'bg-indigo-100'}`}>
                  <ShieldCheck className={`w-6 h-6 ${requiredReadiness === 100 ? 'text-emerald-600' : 'text-indigo-600'}`} />
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-slate-900">Required Training Readiness</h3>
                  <p className="text-sm text-slate-600">
                    {requiredReadiness === 100
                      ? 'All your required in-services are complete. You are survey-ready.'
                      : `${requiredOutstanding.length} required ${requiredOutstanding.length === 1 ? 'in-service' : 'in-services'} still need your attention.`}
                  </p>
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <p className={`text-3xl font-bold ${requiredReadiness === 100 ? 'text-emerald-600' : 'text-indigo-600'}`}>{requiredReadiness}%</p>
                <p className="text-xs text-slate-500">{requiredCompleted.length}/{requiredAssignments.length} complete</p>
              </div>
            </div>
            <Progress
              value={requiredReadiness}
              className={`h-2.5 mt-3 ${requiredReadiness === 100 ? '[&>div]:bg-emerald-500' : '[&>div]:bg-indigo-600'}`}
            />
            {requiredOutstanding.length > 0 && (
              <div className="mt-3 space-y-2">
                {requiredOutstanding.slice(0, 3).map(a => {
                  const overdue = a.status === 'overdue';
                  return (
                    <div key={a.id} className="flex items-center justify-between gap-3 p-2.5 bg-white rounded-lg border border-slate-200">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-800 truncate">{a.course_title}</p>
                        <p className={`text-xs ${overdue ? 'text-red-600 font-medium' : 'text-slate-500'}`}>
                          {overdue ? 'Overdue — ' : 'Due '}{formatDate(a.due_date)}
                        </p>
                      </div>
                      <Link to={`${createPageUrl('TrainingCoursePlayer')}?assignment=${a.id}`} className="flex-shrink-0">
                        <Button size="sm" variant={overdue ? 'default' : 'outline'} className={overdue ? 'bg-red-600 hover:bg-red-700' : ''}>
                          {a.status === 'in_progress' ? 'Continue' : 'Start'}
                        </Button>
                      </Link>
                    </div>
                  );
                })}
                {requiredOutstanding.length > 3 && (
                  <p className="text-xs text-slate-500 text-center pt-1">
                    +{requiredOutstanding.length - 3} more required {requiredOutstanding.length - 3 === 1 ? 'in-service' : 'in-services'} outstanding
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Completion Progress Bar */}
      {assignments.length > 0 && (
        <Card className="border-slate-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-indigo-600" />
                <span className="text-sm font-semibold text-slate-700">Overall Completion Rate</span>
              </div>
              <span className="text-sm font-bold text-indigo-600">{completionRate}%</span>
            </div>
            <Progress value={completionRate} className="h-2.5 [&>div]:bg-indigo-600" />
            <p className="text-xs text-slate-500 mt-1.5">
              {completedAssignments.length} of {assignments.length} courses completed
            </p>
          </CardContent>
        </Card>
      )}

      {/* Continuing Education (CEU) earned */}
      {ceu.total > 0 && (
        <Card className="border-navy-200 bg-navy-50/30">
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-11 h-11 bg-navy-100 rounded-xl flex items-center justify-center flex-shrink-0">
                  <GraduationCap className="w-6 h-6 text-navy-600" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900">Continuing Education Earned</h3>
                  <p className="text-sm text-slate-600">CEU hours from your completed courses</p>
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-3xl font-bold text-navy-600">{ceu.total}</p>
                <p className="text-xs text-slate-500">CEU hours</p>
              </div>
            </div>
            {ceu.breakdown.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-3">
                {ceu.breakdown.map(b => (
                  <Badge key={b.category} variant="outline" className="capitalize text-xs">
                    {b.category.replace(/_/g, ' ')}: {b.hours} hr{b.hours === 1 ? '' : 's'}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Achievements highlight */}
      {leaderboardEntry && (
        (leaderboardEntry.total_points > 0 || leaderboardEntry.badges_earned > 0 || leaderboardEntry.current_streak > 0) && (
          <Card className="border-l-4 border-l-gold-400">
            <CardContent className="p-4 sm:p-5">
              <div className="flex items-center justify-between gap-3 mb-3">
                <h3 className="font-bold text-slate-900 flex items-center gap-2">
                  <Trophy className="w-5 h-5 text-amber-500" /> Your Achievements
                </h3>
                <span className="text-xs text-amber-700 font-medium">Keep the streak going!</span>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {[
                  { label: 'Points', value: leaderboardEntry.total_points || 0, icon: Trophy, color: 'text-amber-600' },
                  { label: 'Badges', value: leaderboardEntry.badges_earned || 0, icon: Award, color: 'text-blue-600' },
                  { label: 'Day Streak', value: leaderboardEntry.current_streak || 0, icon: Flame, color: 'text-orange-600' },
                  { label: 'Perfect Scores', value: leaderboardEntry.perfect_scores || 0, icon: Star, color: 'text-navy-600' },
                ].map(item => {
                  const Icon = item.icon;
                  return (
                    <div key={item.label} className="bg-white rounded-xl border border-amber-100 p-3 flex items-center justify-between">
                      <div>
                        <p className="text-xs text-slate-500">{item.label}</p>
                        <p className={`text-xl font-bold ${item.color}`}>{item.value}</p>
                      </div>
                      <Icon className={`w-6 h-6 ${item.color} opacity-70`} />
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )
      )}

      {/* Educator / admin team readiness */}
      {isEducatorOrAdmin && <EducatorReadinessPanel />}

      {/* Overdue Alert Banner */}
      {overdueAssignments.length > 0 && (
        <Card className="border-2 border-red-300 bg-red-50 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-start gap-3 mb-3">
              <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-bold text-red-900">
                  {overdueAssignments.length} Overdue {overdueAssignments.length === 1 ? 'Course' : 'Courses'}
                </h3>
                <p className="text-sm text-red-700">Complete these immediately to stay compliant</p>
              </div>
            </div>
            <div className="space-y-2">
              {overdueAssignments.slice(0, 3).map(a => (
                <div key={a.id} className="flex items-center justify-between p-3 bg-white rounded-lg border border-red-200">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-900 truncate">{a.course_title}</p>
                    <p className="text-xs text-red-600">Due: {formatDate(a.due_date)}</p>
                  </div>
                  <Link to={`${createPageUrl('TrainingCoursePlayer')}?assignment=${a.id}`}>
                    <Button size="sm" className="bg-red-600 hover:bg-red-700 ml-3 flex-shrink-0">
                      Start Now
                    </Button>
                  </Link>
                </div>
              ))}
              {overdueAssignments.length > 3 && (
                <Link to={`${createPageUrl('LearningCenter')}?tab=courses`}>
                  <Button variant="ghost" size="sm" className="text-red-700 w-full">
                    View all {overdueAssignments.length} overdue courses
                  </Button>
                </Link>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Expiring Certificates Alert */}
      {expiringCerts.length > 0 && (
        <Card className="border-2 border-amber-300 bg-amber-50">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <Clock className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-bold text-amber-900">
                  {expiringCerts.length} {expiringCerts.length === 1 ? 'Certificate' : 'Certificates'} Expiring Soon
                </h3>
                <div className="mt-2 space-y-1">
                  {expiringCerts.slice(0, 3).map(c => (
                    <p key={c.id} className="text-sm text-amber-800">
                      <span className="font-medium">{c.course_title}</span> — expires {formatDate(c.expiration_date)}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Content Tabs */}
      <EmbeddedPage>
      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
        <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
          <TabsList className="inline-flex w-max min-w-full gap-1 h-auto p-1">
            <TabsTrigger value="active" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <Target className="w-4 h-4 mr-2" />
              My Assignments ({activeAssignments.length})
            </TabsTrigger>
            <TabsTrigger value="plans" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <LayoutDashboard className="w-4 h-4 mr-2" />
              Learning Plans ({activePlans.length})
            </TabsTrigger>
            <TabsTrigger value="catalog" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <BookOpenCheck className="w-4 h-4 mr-2" />
              Course Catalog ({courses.length})
            </TabsTrigger>
            <TabsTrigger value="competencies" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <CheckCircle2 className="w-4 h-4 mr-2" />
              Competencies ({competencies.length})
            </TabsTrigger>
            <TabsTrigger value="certificates" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <Award className="w-4 h-4 mr-2" />
              Certificates ({certificates.length})
            </TabsTrigger>
            <TabsTrigger value="renewals" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <CalendarClock className="w-4 h-4 mr-2" />
              Renewals ({renewals.length})
            </TabsTrigger>
            <TabsTrigger value="achievements" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <Trophy className="w-4 h-4 mr-2" />
              Achievements
            </TabsTrigger>
            <TabsTrigger value="boosters" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <Brain className="w-4 h-4 mr-2" />
              Memory Boosters
            </TabsTrigger>
            <TabsTrigger value="courses" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <BookOpen className="w-4 h-4 mr-2" />
              My Courses
            </TabsTrigger>
            <TabsTrigger value="inservices" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <Sparkles className="w-4 h-4 mr-2" />
              In-Services
            </TabsTrigger>
            <TabsTrigger value="annual" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <Calendar className="w-4 h-4 mr-2" />
              Annual Education
            </TabsTrigger>
            <TabsTrigger value="policies" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <FileCheck2 className="w-4 h-4 mr-2" />
              Policies
            </TabsTrigger>
            <TabsTrigger value="transcripts" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <Award className="w-4 h-4 mr-2" />
              Transcripts
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Active Assignments Tab */}
        <TabsContent value="active" className="space-y-3">
          {assignmentsLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
            </div>
          ) : sortedActive.length === 0 ? (
            <Card>
              <CardContent className="p-12 text-center">
                <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
                <h3 className="text-lg font-semibold text-slate-800">All caught up!</h3>
                <p className="text-slate-500 mt-1">You have no pending assignments. Browse the course catalog to keep learning.</p>
              </CardContent>
            </Card>
          ) : (
            sortedActive.map(assignment => {
              const isOverdue = assignment.status === 'overdue';
              const isInProgress = assignment.status === 'in_progress';
              const days = daysUntil(assignment.due_date);
              const isDueSoon = days >= 0 && days <= 7 && !isOverdue;
              return (
                <Card key={assignment.id} className={`border transition-all hover:shadow-md ${
                  isOverdue ? 'border-red-200 bg-red-50/30' :
                  isDueSoon ? 'border-amber-200 bg-amber-50/20' :
                  isInProgress ? 'border-blue-200 bg-blue-50/20' :
                  'border-slate-200'
                }`}>
                  <CardContent className="p-4 sm:p-5">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div className="space-y-2 min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-bold text-slate-900">{assignment.course_title}</h3>
                          {isOverdue && <Badge className="bg-red-100 text-red-700 border-red-200">Overdue</Badge>}
                          {isDueSoon && <Badge className="bg-amber-100 text-amber-700 border-amber-200">Due Soon</Badge>}
                          {isInProgress && !isOverdue && <Badge className="bg-blue-100 text-blue-700 border-blue-200">In Progress</Badge>}
                          {assignment.priority === 'critical' && <Badge className="bg-red-500 text-white">Critical</Badge>}
                          {assignment.priority === 'high' && <Badge className="bg-orange-500 text-white">High</Badge>}
                        </div>
                        <div className="flex items-center gap-4 text-sm text-slate-500">
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3.5 h-3.5" />
                            Due {formatDate(assignment.due_date)}
                          </span>
                          {assignment.score_percentage != null && (
                            <span>Score: {assignment.score_percentage}%</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Progress value={assignment.progress_percentage || assignment.progress || 0} className="h-1.5 flex-1" />
                          <span className="text-xs text-slate-400 flex-shrink-0">{assignment.progress_percentage || assignment.progress || 0}%</span>
                        </div>
                      </div>
                      <Link to={`${createPageUrl('TrainingCoursePlayer')}?assignment=${assignment.id}`} className="sm:w-40 flex-shrink-0">
                        <Button className={`w-full ${isOverdue ? 'bg-red-600 hover:bg-red-700' : ''}`}>
                          {isInProgress ? 'Continue' : 'Start'} Course
                          <ChevronRight className="w-4 h-4 ml-1" />
                        </Button>
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
          {activeAssignments.length > 0 && (
            <Link to={`${createPageUrl('LearningCenter')}?tab=courses`}>
              <Button variant="outline" className="w-full">
                View Full Training Dashboard
              </Button>
            </Link>
          )}
          <Link to={createPageUrl('MyTraining')}>
            <Button variant="outline" className="w-full">
              View All In-Services
            </Button>
          </Link>
        </TabsContent>

        {/* Learning Plans Tab */}
        <TabsContent value="plans" className="space-y-3">
          {activePlans.length === 0 ? (
            <EmptyState
              icon={LayoutDashboard}
              title="No learning plans assigned"
              description="Your manager or admin will assign learning plans as needed."
            />
          ) : (
            activePlans.map(enrollment => {
              const isOverdue = enrollment.status === 'overdue' ||
                (enrollment.due_date && new Date(enrollment.due_date) < new Date() && enrollment.status !== 'completed');
              return (
                <Card key={enrollment.id} className={`border transition-all hover:shadow-md ${
                  isOverdue ? 'border-red-200 bg-red-50/20' : 'border-slate-200'
                }`}>
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div>
                        <h3 className="font-bold text-slate-900">{enrollment.plan_name}</h3>
                        <p className="text-sm text-slate-500 mt-0.5">
                          {enrollment.courses_completed || 0} of {enrollment.courses_total || 0} courses completed
                          {enrollment.due_date && <> — Due {formatDate(enrollment.due_date)}</>}
                        </p>
                      </div>
                      <Badge className={isOverdue ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-800'}>
                        {isOverdue ? 'Overdue' : enrollment.status || 'Active'}
                      </Badge>
                    </div>
                    <Progress value={enrollment.progress_percentage || 0} className="h-2" />
                    <p className="text-xs text-slate-400 mt-1 text-right">{enrollment.progress_percentage || 0}% complete</p>
                  </CardContent>
                </Card>
              );
            })
          )}
          {enrollments.filter(e => e.status === 'completed').length > 0 && (
            <div className="pt-2">
              <p className="text-sm text-slate-500 mb-2 font-medium">Completed Plans</p>
              {enrollments.filter(e => e.status === 'completed').map(enrollment => (
                <Card key={enrollment.id} className="border-emerald-200 bg-emerald-50/30 mb-2">
                  <CardContent className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      <span className="font-medium text-slate-800">{enrollment.plan_name}</span>
                    </div>
                    <Badge className="bg-emerald-100 text-emerald-700">Completed</Badge>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Course Catalog Tab */}
        <TabsContent value="catalog" className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Search courses..."
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setCatalogLimit(12); }}
                className="pl-9"
              />
            </div>
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-slate-400" />
              <select
                value={categoryFilter}
                onChange={(e) => { setCategoryFilter(e.target.value); setCatalogLimit(12); }}
                className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Categories</option>
                {categories.map(cat => (
                  <option key={cat} value={cat}>{cat.replace(/_/g, ' ')}</option>
                ))}
              </select>
              <select
                value={businessLineFilter}
                onChange={(e) => { setBusinessLineFilter(e.target.value); setCatalogLimit(12); }}
                className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Lines</option>
                <option value="home_health">Home Health</option>
                <option value="hospice">Hospice</option>
              </select>
              <button
                type="button"
                aria-pressed={requiredOnly}
                onClick={() => { setRequiredOnly(v => !v); setCatalogLimit(12); }}
                className={`text-sm rounded-lg px-3 py-2 border transition-colors whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                  requiredOnly
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
                Required only
              </button>
            </div>
          </div>

          {filteredCourses.length === 0 ? (
            <EmptyState
              icon={Search}
              title="No courses found"
              description={searchQuery || categoryFilter !== 'all'
                ? 'Try adjusting your search or filter.'
                : 'No published courses are available yet.'}
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredCourses.slice(0, catalogLimit).map(course => (
                <Card key={course.id} className="border-slate-200 hover:shadow-md transition-all group">
                  <CardContent className="p-5 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <Badge variant="outline" className="text-xs capitalize">
                        {course.category?.replace(/_/g, ' ') || 'General'}
                      </Badge>
                      <div className="flex items-center gap-1 flex-wrap justify-end">
                        {course.business_line_scope && course.business_line_scope !== 'all' && (
                          <Badge variant="outline" className="text-xs">
                            {course.business_line_scope === 'home_health' ? 'Home Health' : 'Hospice'}
                          </Badge>
                        )}
                        {course.training_type === 'annual_mandatory' && (
                          <Badge className="bg-indigo-100 text-indigo-700 text-xs">Annual</Badge>
                        )}
                        {course.training_type === 'in_service' && (
                          <Badge className="bg-navy-100 text-navy-700 text-xs">In-Service</Badge>
                        )}
                        {isRequiredCourse(course) && (
                          <Badge className="bg-red-100 text-red-700 text-xs">Required</Badge>
                        )}
                      </div>
                    </div>
                    <h3 className="font-bold text-slate-900 leading-tight group-hover:text-blue-700 transition-colors">
                      {course.title}
                    </h3>
                    {course.short_description && (
                      <p className="text-sm text-slate-500 line-clamp-2">{course.short_description}</p>
                    )}
                    <div className="flex items-center gap-3 text-xs text-slate-400 pt-1">
                      {course.estimated_minutes && (
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" /> {course.estimated_minutes} min
                        </span>
                      )}
                      {course.passing_score && (
                        <span className="flex items-center gap-1">
                          <Target className="w-3 h-3" /> {course.passing_score}% to pass
                        </span>
                      )}
                      {course.enable_certificate && (
                        <span className="flex items-center gap-1">
                          <Award className="w-3 h-3" /> Certificate
                        </span>
                      )}
                    </div>
                    {feedbackByCourse[course.id]?.count > 0 && (
                      <StarsDisplay value={feedbackByCourse[course.id].avg} count={feedbackByCourse[course.id].count} />
                    )}
                    <div className="space-y-2 pt-1">
                      {(() => {
                        const state = enrollFeedback[course.id];
                        if (assignedCourseIds.has(course.id) || state === 'done') {
                          return (
                            <div className="flex items-center justify-center gap-1.5 text-sm text-emerald-600 font-medium py-1.5">
                              <Check className="w-4 h-4" /> Enrolled
                            </div>
                          );
                        }
                        if (!isRequiredCourse(course)) {
                          return (
                            <Button
                              size="sm"
                              className="w-full"
                              disabled={state === 'loading'}
                              onClick={() => enrollMutation.mutate(course.id)}
                            >
                              {state === 'loading' ? (
                                <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Enrolling...</>
                              ) : (
                                <><UserPlus className="w-4 h-4 mr-1.5" /> Enroll</>
                              )}
                            </Button>
                          );
                        }
                        return (
                          <p className="text-xs text-slate-400 text-center py-1.5">Assigned by your administrator</p>
                        );
                      })()}
                      {enrollFeedback[course.id] === 'error' && (
                        <p className="text-xs text-red-600 text-center">Could not enroll. Please try again.</p>
                      )}
                      {isEducatorOrAdmin && (
                        <Link to={`${createPageUrl('TrainingCoursePlayer')}?courseId=${course.id}&preview=true`}>
                          <Button variant="outline" size="sm" className="w-full">
                            Preview Course
                          </Button>
                        </Link>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
          {filteredCourses.length > catalogLimit && (
            <div className="text-center space-y-2">
              <p className="text-sm text-slate-500">
                Showing {Math.min(catalogLimit, filteredCourses.length)} of {filteredCourses.length} courses
              </p>
              <Button variant="outline" onClick={() => setCatalogLimit(l => l + 12)}>
                Load more courses
              </Button>
            </div>
          )}
        </TabsContent>

        {/* Competencies Tab */}
        <TabsContent value="competencies" className="space-y-3">
          {competencies.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="No competencies assigned"
              description="Competencies for your role will appear here."
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {competencies.map(comp => (
                <Card key={comp.id} className="border-slate-200">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-slate-900">{comp.name}</h3>
                        <p className="text-sm text-slate-500">{comp.frequency} validation</p>
                      </div>
                      <Badge className="bg-emerald-500">Active</Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
          <Link to={`${createPageUrl('LearningCenter')}?tab=competencies`}>
            <Button variant="outline" className="w-full">
              View All Competencies
            </Button>
          </Link>
        </TabsContent>

        {/* Certificates Tab */}
        <TabsContent value="certificates" className="space-y-3">
          {certificates.length === 0 ? (
            <EmptyState
              icon={Award}
              title="No certificates yet"
              description="Complete courses to earn certificates of completion."
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {certificates.map(cert => {
                const isExpiring = cert.expiration_date && daysUntil(cert.expiration_date) <= 90 && daysUntil(cert.expiration_date) >= 0;
                const isExpired = cert.expiration_date && daysUntil(cert.expiration_date) < 0;
                return (
                  <Card key={cert.id} className={`border transition-all hover:shadow-md ${
                    isExpired ? 'border-red-200 bg-red-50/20' :
                    isExpiring ? 'border-amber-200 bg-amber-50/20' :
                    'border-slate-200'
                  }`}>
                    <CardContent className="p-5">
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 bg-gold-100 ring-1 ring-inset ring-gold-200 rounded-xl flex items-center justify-center flex-shrink-0">
                          <Award className="w-5 h-5 text-gold-700" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-bold text-slate-900 truncate">{cert.course_title}</h3>
                          <p className="text-sm text-slate-500 mt-0.5">
                            Issued {formatDate(cert.issued_at || cert.completion_date)}
                            {cert.score && <> — Score: {cert.score}%</>}
                          </p>
                          {cert.expiration_date && (
                            <p className={`text-xs mt-0.5 ${
                              isExpired ? 'text-red-600 font-semibold' :
                              isExpiring ? 'text-amber-600 font-semibold' :
                              'text-slate-400'
                            }`}>
                              {isExpired ? 'Expired' : 'Expires'} {formatDate(cert.expiration_date)}
                            </p>
                          )}
                          {cert.certificate_id && (
                            <p className="text-xs text-slate-400 mt-0.5">ID: {cert.certificate_id}</p>
                          )}
                        </div>
                      </div>
                      <div className="mt-3">
                        <CertificateDownloadButton certificate={cert} size="sm" variant="outline" />
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
          {certificates.length > 0 && (
            <Link to={`${createPageUrl('LearningCenter')}?tab=certificates`}>
              <Button variant="outline" className="w-full">
                View All Certificates
              </Button>
            </Link>
          )}
        </TabsContent>

        {/* Renewals Tab */}
        <TabsContent value="renewals" className="space-y-3">
          {renewals.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title="No upcoming renewals"
              description="Certificate expirations and training renewal dates will appear here."
            />
          ) : (
            <>
              <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={() => exportRenewalsCalendar(renewals)}>
                  <CalendarPlus className="w-4 h-4 mr-1.5" />
                  Export all to calendar
                </Button>
              </div>
              {(() => {
              let lastMonth = null;
              return renewals.map(item => {
                const monthLabel = new Date(item.date).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
                const showHeader = monthLabel !== lastMonth;
                lastMonth = monthLabel;
                const days = daysUntil(item.date);
                const isPast = days < 0;
                const isSoon = days >= 0 && days <= 30;
                return (
                  <div key={item.id}>
                    {showHeader && (
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mt-4 mb-1.5 first:mt-0">{monthLabel}</p>
                    )}
                    <Card className={`border ${isPast ? 'border-red-200 bg-red-50/30' : isSoon ? 'border-amber-200 bg-amber-50/20' : 'border-slate-200'}`}>
                      <CardContent className="p-3.5 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${isPast ? 'bg-red-100' : isSoon ? 'bg-amber-100' : 'bg-slate-100'}`}>
                            <CalendarClock className={`w-4.5 h-4.5 ${isPast ? 'text-red-600' : isSoon ? 'text-amber-600' : 'text-slate-500'}`} />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-900 truncate">{item.title}</p>
                            <p className="text-xs text-slate-500">{item.kind}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <div className="text-right">
                            <p className={`text-sm font-medium ${isPast ? 'text-red-600' : isSoon ? 'text-amber-700' : 'text-slate-700'}`}>{formatDate(item.date)}</p>
                            <p className={`text-xs ${isPast ? 'text-red-500' : 'text-slate-400'}`}>
                              {isPast ? `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue` : days === 0 ? 'Due today' : `in ${days} day${days === 1 ? '' : 's'}`}
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-slate-400 hover:text-indigo-600"
                            title="Add to calendar"
                            onClick={() => exportRenewalsCalendar([item])}
                          >
                            <CalendarPlus className="w-4 h-4" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                );
              });
            })()}
            </>
          )}
        </TabsContent>

        {/* Achievements Tab */}
        <TabsContent value="achievements" className="space-y-3">
          {user?.email && <GamificationDashboard userId={user.email} />}
        </TabsContent>

        {/* Memory Boosters — spaced-repetition reviews of passed in-services. */}
        <TabsContent value="boosters" className="space-y-3">
          <LearnerMemoryBoosters />
        </TabsContent>

        {/* My Courses — the full course dashboard (formerly the My Learning page). */}
        <TabsContent value="courses">
          <Suspense fallback={tabLoader}>
            <MyTraining />
          </Suspense>
        </TabsContent>

        {/* In-Services — same dashboard, filtered to assigned in-services. */}
        <TabsContent value="inservices">
          <Suspense fallback={tabLoader}>
            <MyTraining filterByType="in_service" />
          </Suspense>
        </TabsContent>

        {/* Annual Education — the employee dashboard plus the admin builder
            (the builder self-gates to admins via AccessDeniedState). */}
        <TabsContent value="annual">
          <Suspense fallback={tabLoader}>
            <Tabs defaultValue="my-education" className="space-y-4">
              <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
                <TabsList className="inline-flex w-max min-w-full gap-1 h-auto p-1">
                  <TabsTrigger value="my-education" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
                    My Education
                  </TabsTrigger>
                  <TabsTrigger value="builder" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
                    Education Builder
                  </TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="my-education">
                <Suspense fallback={tabLoader}>
                  <MyAnnualEducation />
                </Suspense>
              </TabsContent>
              <TabsContent value="builder">
                <Suspense fallback={tabLoader}>
                  <AnnualMandatoryEducation />
                </Suspense>
              </TabsContent>
            </Tabs>
          </Suspense>
        </TabsContent>

        {/* Policies — read & acknowledge agency policies (Relias-style sign-off). */}
        <TabsContent value="policies" className="space-y-3">
          <LearnerPolicyAcknowledgments />
        </TabsContent>

        {/* Transcripts — Annual and Employee certificate history. */}
        <TabsContent value="transcripts">
          <Suspense fallback={tabLoader}>
            <Tabs defaultValue="annual" className="space-y-4">
              <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
                <TabsList className="inline-flex w-max min-w-full gap-1 h-auto p-1">
                  <TabsTrigger value="annual" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
                    Annual
                  </TabsTrigger>
                  <TabsTrigger value="employee" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
                    Employee
                  </TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="annual">
                <Suspense fallback={tabLoader}>
                  <AnnualEducationTranscript />
                </Suspense>
              </TabsContent>
              <TabsContent value="employee">
                <Suspense fallback={tabLoader}>
                  <EmployeeTranscript />
                </Suspense>
              </TabsContent>
            </Tabs>
          </Suspense>
        </TabsContent>
      </Tabs>
      </EmbeddedPage>

      {/* Recently Completed Section */}
      {completedAssignments.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-slate-800">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              Recently Completed
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {completedAssignments.slice(0, 6).map(a => {
                const fb = feedbackByCourse[a.course_id];
                const state = ratingFeedback[a.course_id];
                return (
                  <div key={a.id} className="p-3 bg-emerald-50/50 rounded-xl border border-emerald-100 space-y-2">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{a.course_title}</p>
                        <p className="text-xs text-slate-500">
                          {a.score_percentage != null ? `Score: ${a.score_percentage}%` : 'Completed'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 pl-6">
                      <RateStars
                        value={fb?.mine || 0}
                        disabled={state === 'saving'}
                        onRate={(n) => feedbackMutation.mutate({ courseId: a.course_id, rating: n })}
                      />
                      {state === 'done' ? (
                        <span className="text-xs text-emerald-600">Thanks!</span>
                      ) : state === 'saving' ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />
                      ) : fb?.mine ? (
                        <span className="text-xs text-slate-400">Your rating</span>
                      ) : (
                        <span className="text-xs text-slate-400">Rate this</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {completedAssignments.length > 6 && (
              <Link to={`${createPageUrl('LearningCenter')}?tab=courses`}>
                <Button variant="ghost" size="sm" className="w-full mt-3 text-slate-500">
                  View all {completedAssignments.length} completed courses
                </Button>
              </Link>
            )}
          </CardContent>
        </Card>
      )}

      {/* Admin/Supervisor Quick Links */}
      {(isEducatorOrAdmin || isSupervisor) && (
        <Card className="border-indigo-200 bg-indigo-50/30">
          <CardContent className="p-5">
            <h3 className="font-bold text-indigo-900 mb-3 flex items-center gap-2">
              <Users className="w-5 h-5" />
              {isEducatorOrAdmin ? 'Administration' : 'Team Management'}
            </h3>
            <div className="flex flex-wrap gap-2">
              {isEducatorOrAdmin && (
                <>
                  <Link to={createPageUrl('AdminTraining')}>
                    <Button variant="outline" size="sm">
                      <Sparkles className="w-4 h-4 mr-1.5" /> Course Manager
                    </Button>
                  </Link>
                  <Link to={createPageUrl('AdminTraining')}>
                    <Button variant="outline" size="sm">
                      <BarChart3 className="w-4 h-4 mr-1.5" /> Training Analytics
                    </Button>
                  </Link>
                  <Link to={createPageUrl('AIComplianceInServices')}>
                    <Button variant="outline" size="sm">
                      <Sparkles className="w-4 h-4 mr-1.5" /> AI Compliance In-Services
                    </Button>
                  </Link>
                  <Link to={createPageUrl('AdminTraining')}>
                    <Button variant="outline" size="sm">
                      <BookOpen className="w-4 h-4 mr-1.5" /> Approval Queue
                    </Button>
                  </Link>
                  <Link to={createPageUrl('AnnualMandatoryEducation')}>
                    <Button variant="outline" size="sm">
                      <Sparkles className="w-4 h-4 mr-1.5" /> Penn Annual Builder
                    </Button>
                  </Link>
                </>
              )}
              {isSupervisor && (
                <>
                  <Link to={createPageUrl('AdminTraining')}>
                    <Button variant="outline" size="sm">
                      <Users className="w-4 h-4 mr-1.5" /> Team Dashboard
                    </Button>
                  </Link>
                  <Link to={createPageUrl('ManagerSkillGapDashboard')}>
                    <Button variant="outline" size="sm">
                      <BarChart3 className="w-4 h-4 mr-1.5" /> Skill Gap Dashboard
                    </Button>
                  </Link>
                </>
              )}
              <Link to={createPageUrl('ReportsAnalytics')}>
                <Button variant="outline" size="sm">
                  <BarChart3 className="w-4 h-4 mr-1.5" /> Reports
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}
    </PageContainer>
  );
}
