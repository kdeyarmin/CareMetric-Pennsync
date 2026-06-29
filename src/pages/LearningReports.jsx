import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  BarChart3,
  FileText,
  Users,
  AlertCircle,
  Calendar,
  Award
} from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import EnrollmentSummaryDashboard from '../components/learning/EnrollmentSummaryDashboard';
import EmployeeTranscriptCenter from '../components/learning/EmployeeTranscriptCenter';
import CourseRosterReport from '../components/learning/CourseRosterReport';
import PlanComplianceReport from '../components/learning/PlanComplianceReport';
import OverdueRemindersReport from '../components/learning/OverdueRemindersReport';
import CertificateExpirationReport from '../components/learning/CertificateExpirationReport';
import PageContainer from '@/components/ui/PageContainer';
import PageHeader from '@/components/ui/PageHeader';
import AccessDeniedState from '@/components/ui/AccessDeniedState';

const BUSINESS_LINES = [
  { value: 'home_health', label: 'Home Health' },
  { value: 'hospice', label: 'Hospice' },
  { value: 'all', label: 'All' }
];

export default function LearningReports() {
  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
    retry: false
  });

  const isAdmin = currentUser?.role === 'admin' || currentUser?.account_type === 'agency_admin';
  const isSuperAdmin = currentUser?.account_type === 'super_admin';

  if (!isAdmin && !isSuperAdmin) {
    return (
      <AccessDeniedState
        title="Access Denied"
        description="Only administrators can access learning reports."
      />
    );
  }

  const _adminBusinessLines = isSuperAdmin ? BUSINESS_LINES : [
    { value: currentUser?.business_line || 'home_health', label: currentUser?.business_line === 'home_health' ? 'Home Health' : 'Hospice' }
  ];

  return (
    <PageContainer>
      <PageHeader
        icon={BarChart3}
        eyebrow="My Learning"
        title="Learning Reports & Analytics"
        description="View training completion rates, employee transcripts, certificates, and compliance reports."
        favoritePage="LearningReports"
      />

      <Tabs defaultValue="summary" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3 lg:grid-cols-6">
          <TabsTrigger value="summary" className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4" />
            <span className="hidden sm:inline">Summary</span>
          </TabsTrigger>
          <TabsTrigger value="transcript" className="flex items-center gap-2">
            <FileText className="w-4 h-4" />
            <span className="hidden sm:inline">Transcript</span>
          </TabsTrigger>
          <TabsTrigger value="roster" className="flex items-center gap-2">
            <Users className="w-4 h-4" />
            <span className="hidden sm:inline">Roster</span>
          </TabsTrigger>
          <TabsTrigger value="plan-compliance" className="flex items-center gap-2">
            <Award className="w-4 h-4" />
            <span className="hidden sm:inline">Plans</span>
          </TabsTrigger>
          <TabsTrigger value="overdue" className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            <span className="hidden sm:inline">Overdue</span>
          </TabsTrigger>
          <TabsTrigger value="expiring" className="flex items-center gap-2">
            <Calendar className="w-4 h-4" />
            <span className="hidden sm:inline">Expiring</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="summary">
          <EnrollmentSummaryDashboard />
        </TabsContent>

        <TabsContent value="transcript">
          <EmployeeTranscriptCenter />
        </TabsContent>

        <TabsContent value="roster">
          <CourseRosterReport />
        </TabsContent>

        <TabsContent value="plan-compliance">
          <PlanComplianceReport />
        </TabsContent>

        <TabsContent value="overdue">
          <OverdueRemindersReport />
        </TabsContent>

        <TabsContent value="expiring">
          <CertificateExpirationReport />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}