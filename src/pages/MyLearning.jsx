import { lazy, Suspense, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GraduationCap, FileText, Award, Sparkles, Calendar, Loader2 } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import PageContainer from "@/components/ui/PageContainer";
import EmbeddedPage from "@/components/ui/embeddedPage";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Button } from "@/components/ui/button";

// Lazy spokes — each former standalone page now renders inside a tab.
const MyTraining = lazy(() => import("@/components/hub-tabs/MyTraining"));
const MyAnnualEducation = lazy(() => import("@/components/hub-tabs/MyAnnualEducation"));
const AnnualMandatoryEducation = lazy(() => import("@/components/hub-tabs/AnnualMandatoryEducation"));
const AnnualEducationTranscript = lazy(() => import("@/components/hub-tabs/AnnualEducationTranscript"));
const EmployeeTranscript = lazy(() => import("@/components/hub-tabs/EmployeeTranscript"));

// Tab keys, kept in sync with the TabsTrigger values below. Used to validate the
// ?tab= deep-link so the retired standalone pages (My Training / In-Services,
// Annual Education, Mandatory Education, and the Annual/Employee transcripts)
// redirect to the right tab. "courses" is the default.
const TAB_KEYS = ["courses", "inservices", "annual", "transcripts"];

const tabLoader = (
  <div className="flex justify-center py-12">
    <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
  </div>
);

export default function MyLearning() {
  const { isLoading } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const activeTab = TAB_KEYS.includes(requestedTab) ? requestedTab : "courses";

  // Reflect the active tab in the URL so tabs are shareable/bookmarkable and
  // redirects from the retired pages deep-link correctly. "courses" is the
  // default, so it stays a clean /MyLearning with no query string.
  const handleTabChange = (value) => {
    setSearchParams(value === "courses" ? {} : { tab: value });
  };

  // Converge on the canonical URL: strip a redundant or unknown ?tab= (e.g. a
  // bookmarked ?tab=courses or a stale tab key) so the default tab is plain
  // /MyLearning. Only fires when the param resolved to the default tab, so a
  // valid deep-link like ?tab=annual is left untouched.
  useEffect(() => {
    if (requestedTab !== null && activeTab === "courses") {
      setSearchParams({}, { replace: true });
    }
  }, [requestedTab, activeTab, setSearchParams]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        icon={GraduationCap}
        eyebrow="Learning & Resources"
        title="My Learning"
        description="Your courses, in-services, annual education, and transcripts — all in one place."
        favoritePage="MyLearning"
        actions={
          <Link to={createPageUrl('LearningCenter')}>
            <Button variant="outline" size="sm">
              Learning Center
            </Button>
          </Link>
        }
      />

      <EmbeddedPage>
      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
          <TabsList className="inline-flex w-max min-w-full gap-1 h-auto p-1">
            <TabsTrigger value="courses" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <FileText className="w-4 h-4 mr-2" />
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
            <TabsTrigger value="transcripts" className="min-h-[44px] px-4 text-sm whitespace-nowrap">
              <Award className="w-4 h-4 mr-2" />
              Transcripts
            </TabsTrigger>
          </TabsList>
        </div>

        {/* My Courses — the existing course dashboard. */}
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
    </PageContainer>
  );
}
