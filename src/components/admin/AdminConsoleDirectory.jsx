import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { createPageUrl } from "@/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Search, ArrowRight, Users, GraduationCap, Stethoscope,
  ShieldCheck, BarChart3, Database, Settings, LayoutGrid,
} from "lucide-react";
import { NAV_MAP, isLinkablePage } from "@/lib/nav.manifest";
import { isSuperAdminView } from "@/lib/roles";

/**
 * AdminConsoleDirectory — a single launchpad that surfaces EVERY admin tool in
 * the app, grouped by function, so an agency admin can reach any task from one
 * place.
 *
 * Tiles are data-driven: each group lists page keys, and the label + icon are
 * read from the nav manifest (NAV_MAP) so this directory can never drift from
 * the real pages. Any page that isn't actually routed (isLinkablePage === false)
 * is skipped automatically, so a tile never dead-ends on PageNotFound.
 */

const GROUPS = [
  {
    title: "Users & Staff",
    description: "Accounts, onboarding, personnel files, credentials, and activity.",
    icon: Users,
    color: "text-blue-600 bg-blue-50",
    pages: [
      "UserManagement", "AdminUserSetup", "PersonnelFile", "CredentialCompliance",
      "NursePerformanceDashboard", "ManagerSkillGapDashboard",
      "UserActivityReport",
    ],
  },
  {
    title: "Training & Education",
    description: "Assign training, track completion, and generate AI courses.",
    icon: GraduationCap,
    color: "text-indigo-600 bg-indigo-50",
    pages: [
      "AdminTraining", "AdminTrainingAnalytics",
      "LearningReports", "AITrainingGenerator", "AIComplianceInServices",
    ],
  },
  {
    title: "Clinical Oversight",
    description: "Pathways, clinical insights, and OASIS audit & analytics.",
    icon: Stethoscope,
    color: "text-navy-600 bg-navy-50",
    pages: [
      "ClinicalPathwayManager", "OASISCenter", "IncidentReview",
    ],
  },
  {
    title: "Compliance & Security",
    description: "Compliance monitoring, regulatory readiness, and security policy.",
    icon: ShieldCheck,
    color: "text-emerald-600 bg-emerald-50",
    pages: [
      "ComplianceCenter",
    ],
  },
  {
    title: "Reports & Analytics",
    description: "Agency reporting, KPIs, predictive analytics, and exports.",
    icon: BarChart3,
    color: "text-navy-600 bg-navy-50",
    pages: [
      "ReportsAnalytics", "AgencyAnalytics", "PredictiveAnalytics",
    ],
  },
  {
    title: "Data & Documents",
    description: "Patient data, quality, duplicates, imports, templates, the document hub, and AI document tooling.",
    icon: Database,
    color: "text-amber-600 bg-amber-50",
    pages: [
      "PatientDataManagement", "DuplicatePatients",
      "BulkDischargeImport", "TemplateManagement",
      "DocumentHub", "AIToolsCenter",
    ],
  },
  {
    title: "System & Configuration",
    description: "Agency settings, PDGM rates, integrations, communications, and system health.",
    icon: Settings,
    color: "text-slate-600 bg-slate-100",
    pages: [
      "AgencySettings", "PDGMRateSettings", "CommsDashboard",
      "SuperAdminConfig", "SystemJobMonitor",
    ],
  },
];

function ToolTile({ page }) {
  const entry = NAV_MAP[page];
  if (!entry || !isLinkablePage(page)) return null;
  const Icon = entry.icon ?? LayoutGrid;
  return (
    <Link
      to={createPageUrl(page)}
      className="group flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5 transition-all hover:border-blue-300 hover:bg-blue-50/40 hover:shadow-sm active:scale-[0.99]"
    >
      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600 group-hover:bg-white group-hover:text-blue-600">
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700 group-hover:text-slate-900">
        {entry.navLabel ?? entry.label}
      </span>
      <ArrowRight className="h-4 w-4 flex-shrink-0 text-slate-300 group-hover:text-blue-500" />
    </Link>
  );
}

export default function AdminConsoleDirectory() {
  const [query, setQuery] = useState("");

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me().catch(() => null),
    retry: false,
  });
  const superAdmin = isSuperAdminView(currentUser);

  // Pre-resolve linkable pages per group, then apply the text filter. Groups
  // with no matching tiles are hidden so the directory stays tight while searching.
  // Platform-level (superAdminOnly) tools are hidden from facility admins.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return GROUPS.map((group) => {
      const pages = group.pages.filter((page) => {
        const entry = NAV_MAP[page];
        if (!entry || !isLinkablePage(page)) return false;
        if (entry.superAdminOnly && !superAdmin) return false;
        if (!q) return true;
        const label = `${entry.navLabel ?? entry.label} ${(entry.keywords ?? []).join(" ")} ${group.title}`.toLowerCase();
        return label.includes(q);
      });
      return { ...group, resolvedPages: pages };
    }).filter((group) => group.resolvedPages.length > 0);
  }, [query, superAdmin]);

  const totalTools = useMemo(
    () => groups.reduce((sum, g) => sum + g.resolvedPages.length, 0),
    [groups],
  );

  return (
    <Card className="modern-card">
      <CardHeader className="pb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <LayoutGrid className="h-5 w-5 text-indigo-600" />
              Admin Tools
            </CardTitle>
            <CardDescription>
              Every administrative tool in one place — jump straight to any task.
            </CardDescription>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter tools…"
              className="pl-9"
              aria-label="Filter admin tools"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {groups.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">
            No tools match “{query}”.
          </p>
        ) : (
          <div className="space-y-6">
            {groups.map((group) => {
              const GroupIcon = group.icon;
              return (
                <div key={group.title}>
                  <div className="mb-2.5 flex items-center gap-2">
                    <span className={`flex h-7 w-7 items-center justify-center rounded-md ${group.color}`}>
                      <GroupIcon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-slate-900">{group.title}</h3>
                      <p className="truncate text-xs text-slate-500">{group.description}</p>
                    </div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {group.resolvedPages.map((page) => (
                      <ToolTile key={page} page={page} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {!query && (
          <p className="mt-5 text-right text-xs text-slate-400">
            {totalTools} tools available
          </p>
        )}
      </CardContent>
    </Card>
  );
}