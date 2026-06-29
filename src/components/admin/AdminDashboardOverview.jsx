import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import StatCard from "@/components/ui/stat-card";
import { Users, FileText, PenTool, Settings, ArrowRight, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import SystemHealthMonitor from "./SystemHealthMonitor";
import QuickHealthOverview from "./QuickHealthOverview";
import { getDocumentDisplayName, getNormalizedSignatureStatus, getSignatureStatusLabel } from "@/components/signature/signatureUtils";

export default function AdminDashboardOverview() {
  // Fetch user count
  const { data: users = [] } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => base44.entities.User.list('-created_date', 1000),
    initialData: [],
  });

  // Fetch recent documents
  const { data: recentDocuments = [] } = useQuery({
    queryKey: ['admin-documents'],
    queryFn: () => base44.entities.DocumentSignature.list('-created_date', 50),
    initialData: [],
  });

  const normalizedRecentDocuments = useMemo(() => recentDocuments.map((doc) => ({
    ...doc,
    normalizedName: getDocumentDisplayName(doc),
    normalizedStatus: getNormalizedSignatureStatus(doc),
    normalizedStatusLabel: getSignatureStatusLabel(doc),
  })), [recentDocuments]);

  const pendingSignatures = normalizedRecentDocuments.filter((doc) => doc.normalizedStatus === 'pending');
  const inProgressSignatures = normalizedRecentDocuments.filter((doc) => doc.normalizedStatus === 'in_progress');

  const totalUsers = users.length;
  const pendingRequests = pendingSignatures.length + inProgressSignatures.length;
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
      description: "Monitor signature requests",
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

  const getStatusClasses = (status) => {
    switch (status) {
      case 'signed':
      case 'completed':
        return 'bg-green-100 text-green-700';
      case 'pending':
        return 'bg-yellow-100 text-yellow-700';
      case 'in_progress':
        return 'bg-blue-100 text-blue-700';
      case 'declined':
        return 'bg-red-100 text-red-700';
      default:
        return 'bg-slate-100 text-slate-700';
    }
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
      <div className="grid md:grid-cols-3 gap-4">
        <StatCard
          icon={Users}
          label="Total Users"
          value={totalUsers}
          trend={`${this30Days} new this month`}
        />
        <StatCard
          icon={FileText}
          label="Recent Documents"
          value={normalizedRecentDocuments.length}
          trend="Last 50 documents"
        />
        <StatCard
          icon={PenTool}
          label="Pending Signatures"
          value={pendingRequests}
          trend={`${pendingSignatures.length} pending, ${inProgressSignatures.length} in progress`}
        />
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

      {/* Recent Documents */}
      {normalizedRecentDocuments.length > 0 && (
        <Card className="modern-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Recently Generated Documents
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {normalizedRecentDocuments.slice(0, 5).map((doc) => (
                <div key={doc.id} className="flex items-start justify-between p-3 bg-slate-50 rounded-lg">
                  <div>
                    <p className="font-medium text-slate-900">{doc.normalizedName}</p>
                    <p className="text-sm text-slate-600">{doc.document_type}</p>
                    <p className="text-xs text-slate-500 mt-1">
                      Created: {format(new Date(doc.created_date), 'MMM d, yyyy')}
                    </p>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusClasses(doc.normalizedStatus)}`}>
                    {doc.normalizedStatusLabel}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pending Signatures */}
      {pendingRequests > 0 && (
        <Card className="modern-card border-orange-200 bg-white">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-orange-900">
              <AlertCircle className="w-5 h-5" />
              Pending E-Signature Requests
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 mb-4">
              <p className="text-sm text-orange-900">
                <strong>{pendingSignatures.length}</strong> documents awaiting signatures
              </p>
              <p className="text-sm text-orange-900">
                <strong>{inProgressSignatures.length}</strong> documents in progress
              </p>
            </div>
            <div className="space-y-3 mb-4">
              {[...pendingSignatures, ...inProgressSignatures].slice(0, 5).map((doc) => (
                <div key={doc.id} className="flex items-center justify-between p-3 bg-white rounded-lg border border-orange-100">
                  <div>
                    <p className="font-medium text-slate-900">{doc.normalizedName}</p>
                    <p className="text-sm text-slate-600">{doc.document_type || 'Document signature request'}</p>
                  </div>
                  <Button asChild size="sm" variant="outline">
                    <Link to={createPageUrl('DocumentSignatures')}>Review</Link>
                  </Button>
                </div>
              ))}
            </div>
            <Link to={createPageUrl("DocumentSignatures")}>
              <Button className="w-full bg-orange-600 hover:bg-orange-700">
                Review Signature Requests
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
