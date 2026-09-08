import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { agencyQueryKey } from '@/lib/agencyRoster';
import { Link } from "react-router";
import { createPageUrl } from "@/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import StatCard from "@/components/ui/stat-card";
import { Users, FileText, PenTool, Settings, ArrowRight } from "lucide-react";
import SystemHealthMonitor from "./SystemHealthMonitor";
import QuickHealthOverview from "./QuickHealthOverview";
import SigningUnavailable from '@/components/signature/SigningUnavailable';

export default function AdminDashboardOverview() {
  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });


  // Fetch user count
  const { data: users = [] } = useQuery({
    queryKey: ['admin-users', agencyQueryKey(currentUser)],
    queryFn: async () => {
      const _rows = await base44.entities.User.list('-created_date', 1000);
      const { filterUsersByCallerAgency } = await import('@/lib/agencyScope');
      return filterUsersByCallerAgency(_rows, currentUser);
    },
    enabled: !!currentUser,
    initialData: [],
  });

  const totalUsers = users.length;
  const this30Days = users.filter(u => {
    const createdDate = new Date(u.created_date);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    return createdDate >= thirtyDaysAgo;
  }).length;

  const adminQuickLinks = [
    {
      title: "User Setup",
      description: "Create and manage user accounts",
      icon: Users,
      page: "AdminUserSetup",
      color: "blue"
    },
    {
      title: "User Management",
      description: "View and manage all users",
      icon: Settings,
      page: "UserManagement",
      color: "purple"
    },
    {
      title: "Document Templates",
      description: "Manage document templates",
      icon: FileText,
      page: "DocumentManagement",
      color: "green"
    },
    {
      title: "E-Signatures",
      description: "Unavailable until tenant-scoped brokers are verified",
      icon: PenTool,
      page: "DocumentSignatures",
      color: "orange"
    }
  ];

  const colorMap = {
    blue: "bg-slate-100 text-blue-600 group-hover:bg-blue-50 transition-colors",
    purple: "bg-slate-100 text-navy-600 group-hover:bg-navy-50 transition-colors",
    green: "bg-slate-100 text-emerald-600 group-hover:bg-emerald-50 transition-colors",
    orange: "bg-slate-100 text-orange-600 group-hover:bg-orange-50 transition-colors"
  };

  return (
    <div className="space-y-6">
      {/* Section header — the page-level "Admin Console" header and the tools
          directory render above this, so keep this a secondary (h2) heading. */}
      <div>
        <h2 className="text-xl font-bold text-slate-900">System Overview</h2>
        <p className="text-slate-600 mt-1">Live health, key metrics, and recent administrative activity</p>
      </div>

      {/* Quick Health Overview */}
      <QuickHealthOverview />

      {/* System Health Monitoring */}
      <SystemHealthMonitor />

      {/* Key Metrics */}
      <div className="grid md:grid-cols-2 gap-4">
        <StatCard
          icon={Users}
          label="Total Users"
          value={totalUsers}
          trend={`${this30Days} new this month`}
        />
        <SigningUnavailable title="Signature dashboard data unavailable" />
      </div>

      {/* Quick Actions */}
      <Card className="modern-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5" />
            Quick Admin Links
          </CardTitle>
          <CardDescription>Fast access to key administrative functions</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-4">
            {adminQuickLinks.map((link) => {
              const Icon = link.icon;
              return (
                <Link
                  key={link.page}
                  to={createPageUrl(link.page)}
                  className="p-4 border border-slate-200 rounded-xl hover:border-blue-200 hover:shadow-md hover:-translate-y-0.5 active:scale-[0.99] transition-all duration-300 ease-out cursor-pointer group bg-white"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3 flex-1">
                      <div className={`p-2 rounded-lg ${colorMap[link.color]}`}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-slate-900 group-hover:text-slate-600">{link.title}</h3>
                        <p className="text-sm text-slate-600">{link.description}</p>
                      </div>
                    </div>
                    <ArrowRight className="w-5 h-5 text-slate-400 group-hover:text-slate-600 flex-shrink-0 mt-1" />
                  </div>
                </Link>
              );
            })}
          </div>
        </CardContent>
      </Card>

    </div>
  );
}
