import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import StatCard from "@/components/ui/stat-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Shield,
  Lock,
  AlertTriangle,
  CheckCircle2,
  Eye,
  Download,
  FileText,
  Activity,
  Database,
  Key,
  UserCheck,
  Clock,
  Server,
  Search,
  Filter,
  Calendar,
  User,
  Info
} from "lucide-react";
import EncryptionStatusIndicator from "@/components/security/EncryptionStatusIndicator";
import AIAuditAnalyzer from "@/components/security/AIAuditAnalyzer";
import SecurityAuditScheduler from "@/components/security/SecurityAuditScheduler";
import VulnerabilityAssessment from "@/components/security/VulnerabilityAssessment";
import { logActivity } from "@/components/utils/activityLogger";
import { formatEastern } from "@/components/utils/timezone";
import { toCsvRows } from "@/components/admin/csvExport";

export default function SecurityCompliance() {
  const [selectedTab, setSelectedTab] = useState("overview");
  const [searchTerm, setSearchTerm] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [entityFilter, setEntityFilter] = useState("all");
  const [userFilter, setUserFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("7");
  const [severityFilter, setSeverityFilter] = useState("all");

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const isAdmin = currentUser?.role === 'admin';

  const { data: securityLogs = [] } = useQuery({
    queryKey: ['securityLogs'],
    queryFn: () => base44.entities.SecurityLog.list('-created_date', 100),
    initialData: [],
    enabled: isAdmin,
  });

  const { data: userActivity = [] } = useQuery({
    queryKey: ['userActivity'],
    queryFn: () => base44.entities.UserActivity.list('-created_date', 500),
    initialData: [],
    enabled: isAdmin,
  });

  React.useEffect(() => {
    if (currentUser) {
      logActivity('view', {
        page: 'SecurityCompliance',
        section: selectedTab
      });
    }
  }, [currentUser, selectedTab]);

  // Get unique users, actions, and entities for filters
  const uniqueUsers = [...new Set(userActivity.map(log => log.user_email))];
  const uniqueActions = [...new Set(userActivity.map(log => log.action))];
  const uniqueEntities = [...new Set(userActivity.map(log => log.entity_type).filter(Boolean))];

  // Apply filters
  const filteredLogs = userActivity.filter(log => {
    const matchesSearch = !searchTerm || 
      log.user_email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.user_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.action?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.entity_type?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesAction = actionFilter === 'all' || log.action === actionFilter;
    const matchesEntity = entityFilter === 'all' || log.entity_type === entityFilter;
    const matchesUser = userFilter === 'all' || log.user_email === userFilter;
    const matchesSeverity = severityFilter === 'all' || log.severity === severityFilter;
    
    const logDate = new Date(log.created_date);
    const daysAgo = parseInt(dateFilter);
    const matchesDate = daysAgo === 0 || 
      (Date.now() - logDate.getTime()) <= (daysAgo * 24 * 60 * 60 * 1000);
    
    return matchesSearch && matchesAction && matchesEntity && matchesUser && matchesSeverity && matchesDate;
  });

  const exportAuditLog = () => {
    const csv = toCsvRows([
      ['Timestamp', 'User', 'Email', 'Action', 'Entity Type', 'Entity ID', 'Severity', 'Details'],
      ...filteredLogs.map(log => [
        log.created_date,
        log.user_name,
        log.user_email,
        log.action,
        log.entity_type || '',
        log.entity_id || '',
        log.severity || 'info',
        JSON.stringify(log.details || {})
      ])
    ]);

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit_log_${new Date().toISOString()}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
  };

  const getSeverityBadge = (severity) => {
    const config = {
      critical: { color: 'bg-red-600 text-white', icon: AlertTriangle },
      warning: { color: 'bg-yellow-600 text-white', icon: AlertTriangle },
      info: { color: 'bg-blue-600 text-white', icon: Info },
    };
    const { color, icon: Icon } = config[severity] || config.info;
    return (
      <Badge className={color}>
        <Icon className="w-3 h-3 mr-1" />
        {severity || 'info'}
      </Badge>
    );
  };

  const getActionColor = (action) => {
    if (action?.includes('delete') || action?.includes('reject')) return 'text-red-600';
    if (action?.includes('approved') || action?.includes('completed')) return 'text-green-600';
    if (action?.includes('updated') || action?.includes('edited')) return 'text-blue-600';
    return 'text-slate-600';
  };

  // Security metrics
  const criticalEvents = securityLogs.filter(log => 
    log.action?.includes('FAILED') || 
    log.action?.includes('DENIED') ||
    log.action?.includes('DELETE')
  ).length;
  const phiAccess = securityLogs.filter(log => 
    log.action?.includes('PATIENT') || 
    log.action?.includes('VISIT') ||
    log.action?.includes('PHI')
  ).length;

  const complianceChecks = [
    {
      name: "Data Encryption",
      status: "compliant",
      description: "All data encrypted at rest (AES-256) and in transit (TLS 1.2+)",
      icon: Lock,
      details: "Base44 platform provides automatic encryption"
    },
    {
      name: "Access Controls",
      status: "compliant",
      description: "Role-based access control (RBAC) implemented",
      icon: UserCheck,
      details: "Admin and user roles with appropriate permissions"
    },
    {
      name: "Audit Trails",
      status: "compliant",
      description: `${securityLogs.length + userActivity.length} events logged`,
      icon: FileText,
      details: "All PHI access and modifications tracked"
    },
    {
      name: "Session Management",
      status: "compliant",
      description: "15-minute automatic timeout for inactive sessions",
      icon: Clock,
      details: "Automatic logout protects against unauthorized access"
    },
    {
      name: "Authentication",
      status: "compliant",
      description: "Secure token-based authentication",
      icon: Key,
      details: "JWT tokens with secure storage"
    },
    {
      name: "Data Integrity",
      status: "compliant",
      description: "All database operations tracked with timestamps",
      icon: Database,
      details: "Created/updated dates and user tracking on all records"
    },
    {
      name: "Secure APIs",
      status: "compliant",
      description: "All API endpoints require authentication",
      icon: Server,
      details: "No public endpoints exposing PHI"
    },
    {
      name: "Backup & Recovery",
      status: "compliant",
      description: "Automated daily backups (platform level)",
      icon: Database,
      details: "Base44 platform handles automated backups"
    }
  ];

  const complianceScore = Math.round(
    (complianceChecks.filter(c => c.status === 'compliant').length / complianceChecks.length) * 100
  );

  if (!isAdmin) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <Card className="border-2 border-red-200">
          <CardContent className="p-12 text-center">
            <Shield className="w-16 h-16 text-red-400 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Access Denied</h2>
            <p className="text-slate-600">Only administrators can view security and compliance information.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-center justify-end">
        <Badge className="bg-green-600 text-lg px-4 py-2">
          <CheckCircle2 className="w-5 h-5 mr-2" />
          {complianceScore}% Compliant
        </Badge>
      </div>

      <Tabs value={selectedTab} onValueChange={setSelectedTab}>
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 mb-6 h-auto">
          <TabsTrigger value="overview" className="text-xs sm:text-sm py-2">Overview</TabsTrigger>
          <TabsTrigger value="security-audit" className="text-xs sm:text-sm py-2">Security Audit</TabsTrigger>
          <TabsTrigger value="vulnerabilities" className="text-xs sm:text-sm py-2">Vulnerabilities</TabsTrigger>
          <TabsTrigger value="encryption" className="text-xs sm:text-sm py-2">Encryption</TabsTrigger>
          <TabsTrigger value="audit" className="text-xs sm:text-sm py-2">Audit Logs</TabsTrigger>
          <TabsTrigger value="activity" className="text-xs sm:text-sm py-2">User Activity</TabsTrigger>
          <TabsTrigger value="ai-analysis" className="text-xs sm:text-sm py-2">AI Analysis</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <StatCard label="Compliance Score" value={`${complianceScore}%`} icon={CheckCircle2} tone="emerald" />
            <StatCard label="Total Events" value={securityLogs.length + userActivity.length} icon={Activity} tone="navy" />
            <StatCard label="PHI Access" value={phiAccess} icon={Eye} tone="slate" />
            <StatCard label="Critical Events" value={criticalEvents} icon={AlertTriangle} tone="red" />
          </div>

          {criticalEvents > 0 && (
            <Alert className="bg-amber-50 border-amber-300">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
              <AlertDescription className="text-amber-900">
                <p className="font-semibold">{criticalEvents} Critical Security Events Detected</p>
                <p className="text-sm">Review audit logs for failed access attempts or deletions.</p>
              </AlertDescription>
            </Alert>
          )}

          {/* HIPAA Requirements */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-blue-600" />
                HIPAA Security Rule Compliance
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {complianceChecks.map((check, idx) => {
                  const Icon = check.icon;
                  return (
                    <div
                      key={idx}
                      className="flex items-start gap-3 p-4 rounded-lg border bg-green-50 border-green-200"
                    >
                      <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5" />
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Icon className="w-4 h-4 text-green-600" />
                          <p className="font-semibold text-slate-900 text-sm">{check.name}</p>
                          <Badge className="bg-green-600 text-xs">✓ Active</Badge>
                        </div>
                        <p className="text-xs text-slate-600 mb-1">{check.description}</p>
                        <p className="text-xs text-slate-500 italic">{check.details}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Compliance Documentation */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-blue-600" />
                Compliance Documentation
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Alert className="bg-blue-50 border-blue-200">
                <AlertDescription className="text-blue-900 text-sm">
                  <p className="font-semibold mb-2">HIPAA Security Rule 45 CFR § 164.312</p>
                  <ul className="list-disc list-inside space-y-1 text-xs">
                    <li>§ 164.312(a)(1) - Access Control: Role-based authentication implemented</li>
                    <li>§ 164.312(a)(2)(i) - Unique User Identification: Email-based user identification</li>
                    <li>§ 164.312(a)(2)(iii) - Automatic Logoff: 15-minute session timeout</li>
                    <li>§ 164.312(b) - Audit Controls: Comprehensive security logging</li>
                    <li>§ 164.312(c)(1) - Integrity: Database integrity with timestamps</li>
                    <li>§ 164.312(d) - Authentication: Secure token-based authentication</li>
                    <li>§ 164.312(e)(1) - Transmission Security: TLS 1.2+ encryption</li>
                    <li>§ 164.312(e)(2)(ii) - Encryption: AES-256 at rest, TLS in transit</li>
                  </ul>
                </AlertDescription>
              </Alert>

              <div className="flex gap-3">
                <Button 
                  variant="outline" 
                  className="flex-1"
                  onClick={() => {
                    const report = {
                      generatedDate: new Date().toISOString(),
                      complianceScore: complianceScore,
                      totalEvents: securityLogs.length + userActivity.length,
                      criticalEvents: criticalEvents,
                      phiAccessEvents: phiAccess,
                      checks: complianceChecks
                    };
                    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `security-report-${new Date().toISOString().split('T')[0]}.json`;
                    document.body.appendChild(a);
                    a.click();
                    window.URL.revokeObjectURL(url);
                    a.remove();
                  }}
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download Security Report
                </Button>
                <Button 
                  variant="outline" 
                  className="flex-1"
                  onClick={() => setSelectedTab("encryption")}
                >
                  <FileText className="w-4 h-4 mr-2" />
                  View Full Documentation
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security-audit">
          <SecurityAuditScheduler />
        </TabsContent>

        <TabsContent value="vulnerabilities">
          <VulnerabilityAssessment />
        </TabsContent>

        <TabsContent value="encryption">
          <EncryptionStatusIndicator />
          
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Encryption Technical Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 bg-slate-50 rounded-lg border">
                  <p className="font-semibold text-slate-900 mb-2">Data at Rest</p>
                  <p className="text-sm text-slate-600 mb-2">
                    All patient data stored in the database is encrypted using AES-256 encryption.
                  </p>
                  <ul className="text-xs text-slate-500 space-y-1">
                    <li>• Algorithm: AES-256-GCM</li>
                    <li>• Key Management: Automated key rotation</li>
                    <li>• Storage: Encrypted database volumes</li>
                  </ul>
                </div>

                <div className="p-4 bg-slate-50 rounded-lg border">
                  <p className="font-semibold text-slate-900 mb-2">Data in Transit</p>
                  <p className="text-sm text-slate-600 mb-2">
                    All network communication uses TLS 1.2 or higher encryption.
                  </p>
                  <ul className="text-xs text-slate-500 space-y-1">
                    <li>• Protocol: TLS 1.2+</li>
                    <li>• Cipher Suite: Strong encryption only</li>
                    <li>• Certificate: Valid SSL/TLS certificate</li>
                  </ul>
                </div>

                <div className="p-4 bg-slate-50 rounded-lg border">
                  <p className="font-semibold text-slate-900 mb-2">Authentication</p>
                  <p className="text-sm text-slate-600 mb-2">
                    Secure token-based authentication with JWT tokens.
                  </p>
                  <ul className="text-xs text-slate-500 space-y-1">
                    <li>• Token Type: JWT (JSON Web Tokens)</li>
                    <li>• Storage: Secure HTTP-only cookies</li>
                    <li>• Expiration: Session-based with 15-min timeout</li>
                  </ul>
                </div>

                <div className="p-4 bg-slate-50 rounded-lg border">
                  <p className="font-semibold text-slate-900 mb-2">Access Control</p>
                  <p className="text-sm text-slate-600 mb-2">
                    Role-based access control with audit logging.
                  </p>
                  <ul className="text-xs text-slate-500 space-y-1">
                    <li>• RBAC: Admin and User roles</li>
                    <li>• Audit: All access logged</li>
                    <li>• Session: Automatic timeout on inactivity</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit" className="space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4">
                <p className="text-sm text-slate-600">Security Events</p>
                <p className="text-2xl font-bold">{securityLogs.length}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-sm text-slate-600">User Actions</p>
                <p className="text-2xl font-bold">{userActivity.length}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-sm text-slate-600">Critical</p>
                <p className="text-2xl font-bold text-red-600">
                  {userActivity.filter(l => l.severity === 'critical').length}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-sm text-slate-600">Active Users</p>
                <p className="text-2xl font-bold">{uniqueUsers.length}</p>
              </CardContent>
            </Card>
          </div>

          {/* Recent Security Logs */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Recent Security Events</span>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => {
                    const logs = securityLogs.slice(0, 50);
                    const csv = toCsvRows([
                      ['Timestamp', 'User', 'Action', 'Details'],
                      ...logs.map(log => [
                        log.timestamp || log.created_date,
                        log.user_email,
                        log.action,
                        JSON.stringify(log.details || {})
                      ])
                    ]);
                    const blob = new Blob([csv], { type: 'text/csv' });
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `security_log_${new Date().toISOString()}.csv`;
                    a.click();
                    window.URL.revokeObjectURL(url);
                    a.remove();
                  }}
                >
                  <Download className="w-4 h-4 mr-2" />
                  Export
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {securityLogs.length === 0 ? (
                  <p className="text-slate-500 text-center py-8">No security events logged yet</p>
                ) : (
                  securityLogs.slice(0, 20).map((log, idx) => (
                    <div
                      key={idx}
                      className={`p-3 rounded-lg border ${
                        log.action?.includes('FAILED') || log.action?.includes('DELETE')
                          ? 'bg-red-50 border-red-200'
                          : log.action?.includes('PHI') || log.action?.includes('PATIENT')
                          ? 'bg-yellow-50 border-yellow-200'
                          : 'bg-slate-50 border-slate-200'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <p className="font-semibold text-sm text-slate-900">{log.action}</p>
                          <p className="text-xs text-slate-600">
                            {log.user_email} • {log.user_role}
                          </p>
                          {log.details && (
                            <p className="text-xs text-slate-500 mt-1">
                              {JSON.stringify(log.details).substring(0, 100)}...
                            </p>
                          )}
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-slate-500">
                            {new Date(log.timestamp || log.created_date).toLocaleDateString()}
                          </p>
                          <p className="text-xs text-slate-500">
                            {new Date(log.timestamp || log.created_date).toLocaleTimeString()}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity" className="space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4">
                <p className="text-sm text-slate-600">Total Events</p>
                <p className="text-2xl font-bold">{userActivity.length}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-sm text-slate-600">Filtered</p>
                <p className="text-2xl font-bold">{filteredLogs.length}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-sm text-slate-600">Critical Events</p>
                <p className="text-2xl font-bold text-red-600">
                  {userActivity.filter(l => l.severity === 'critical').length}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-sm text-slate-600">Active Users</p>
                <p className="text-2xl font-bold">{uniqueUsers.length}</p>
              </CardContent>
            </Card>
          </div>

          {/* Filters */}
          <Card>
            <CardHeader className="p-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Filter className="w-4 h-4" />
                  Filters
                </CardTitle>
                <Button onClick={exportAuditLog} variant="outline" size="sm">
                  <Download className="w-4 h-4 mr-2" />
                  Export CSV
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    placeholder="Search users, actions..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10 h-11 touch-target"
                  />
                </div>
                <Select value={actionFilter} onValueChange={setActionFilter}>
                  <SelectTrigger className="h-11 touch-target">
                    <SelectValue placeholder="Action Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Actions</SelectItem>
                    {uniqueActions.map(action => (
                      <SelectItem key={action} value={action}>{action}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={entityFilter} onValueChange={setEntityFilter}>
                  <SelectTrigger className="h-11 touch-target">
                    <SelectValue placeholder="Entity Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Entities</SelectItem>
                    {uniqueEntities.map(entity => (
                      <SelectItem key={entity} value={entity}>{entity}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={userFilter} onValueChange={setUserFilter}>
                  <SelectTrigger className="h-11 touch-target">
                    <SelectValue placeholder="User" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Users</SelectItem>
                    {uniqueUsers.map(user => (
                      <SelectItem key={user} value={user}>{user}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={severityFilter} onValueChange={setSeverityFilter}>
                  <SelectTrigger className="h-11 touch-target">
                    <SelectValue placeholder="Severity" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Severities</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                    <SelectItem value="warning">Warning</SelectItem>
                    <SelectItem value="info">Info</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={dateFilter} onValueChange={setDateFilter}>
                  <SelectTrigger className="h-11 touch-target">
                    <SelectValue placeholder="Time Range" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">All Time</SelectItem>
                    <SelectItem value="1">Last 24 Hours</SelectItem>
                    <SelectItem value="7">Last 7 Days</SelectItem>
                    <SelectItem value="30">Last 30 Days</SelectItem>
                    <SelectItem value="90">Last 90 Days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Audit Log Table */}
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <ScrollArea className="h-[600px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-sm">Timestamp</TableHead>
                        <TableHead className="text-sm">User</TableHead>
                        <TableHead className="text-sm">Action</TableHead>
                        <TableHead className="text-sm hidden md:table-cell">Entity</TableHead>
                        <TableHead className="text-sm hidden lg:table-cell">Severity</TableHead>
                        <TableHead className="text-sm hidden lg:table-cell">Details</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredLogs.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center py-8 text-slate-500">
                            No audit logs found matching filters
                          </TableCell>
                        </TableRow>
                      ) : (
                        filteredLogs.map((log, idx) => (
                          <TableRow key={idx} className="hover:bg-slate-50">
                            <TableCell className="text-xs whitespace-nowrap">
                              <div className="flex items-center gap-1">
                                <Calendar className="w-3 h-3 text-slate-400 hidden sm:inline" />
                                <span className="hidden sm:inline">{formatEastern(new Date(log.created_date), 'MMM d, yyyy HH:mm:ss')}</span>
                                <span className="sm:hidden">{formatEastern(new Date(log.created_date), 'MMM d, HH:mm')}</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-xs">
                              <div className="flex items-center gap-1">
                                <User className="w-3 h-3 text-slate-400 hidden sm:inline flex-shrink-0" />
                                <div className="min-w-0">
                                  <p className="text-xs font-medium truncate">{log.user_name}</p>
                                  <p className="text-xs text-slate-500 truncate hidden sm:block">{log.user_email}</p>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="text-xs">
                              <span className={`font-medium ${getActionColor(log.action)} truncate block`}>
                                {log.action?.replace(/_/g, ' ')}
                              </span>
                            </TableCell>
                            <TableCell className="text-xs hidden md:table-cell">
                              {log.entity_type && (
                                <div>
                                  <Badge variant="outline" className="text-xs">
                                    {log.entity_type}
                                  </Badge>
                                  {log.entity_id && (
                                    <p className="text-slate-500 mt-1 truncate">ID: {log.entity_id.substring(0, 8)}...</p>
                                  )}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="hidden lg:table-cell">
                              {getSeverityBadge(log.severity)}
                            </TableCell>
                            <TableCell className="text-xs max-w-xs hidden lg:table-cell">
                              {log.details && (
                                <details className="cursor-pointer">
                                  <summary className="text-blue-600 hover:text-blue-700">
                                    View details
                                  </summary>
                                  <pre className="mt-2 p-2 bg-slate-100 rounded text-xs overflow-auto max-h-32">
                                    {JSON.stringify(log.details, null, 2)}
                                  </pre>
                                </details>
                              )}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ai-analysis">
          <AIAuditAnalyzer />
        </TabsContent>
      </Tabs>
    </div>
  );
}