import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Shield, AlertTriangle, CheckCircle2, XCircle, TrendingUp,
  BarChart3, FileText, Search, Eye, Wand2, Loader2,
  ScrollText, CalendarDays, BookOpen, GraduationCap, Brain, Award, PlayCircle, Clock
} from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";
import { formatEastern } from "@/components/utils/timezone";
import PullToRefresh from "../components/mobile/PullToRefresh";
import { toast } from "sonner";
import { format } from "date-fns";
import OneClickComplianceFixer from "../components/compliance/OneClickComplianceFixer";
import ProactiveComplianceRiskPredictor from "../components/compliance/ProactiveComplianceRiskPredictor";
import AIComplianceCarePlanSuggester from "../components/compliance/AIComplianceCarePlanSuggester";
import ComplianceErrorAnalyzer from "../components/training/ComplianceErrorAnalyzer";
import PersonalizedComplianceTraining from "../components/training/PersonalizedComplianceTraining";
import ComplianceQuizSimulator from "../components/training/ComplianceQuizSimulator";

export default function ComplianceHub() {
  const [timeframe, setTimeframe] = useState("30");
  const [filterSeverity, setFilterSeverity] = useState("all");
  const [filterStatus, setFilterStatus] = useState("open");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedViolation, setSelectedViolation] = useState(null);
  const [detailDialog, setDetailDialog] = useState(false);
  const [selectedErrorPatterns, setSelectedErrorPatterns] = useState(null);
  const [trainingContent, setTrainingContent] = useState(null);
  const [activeTrainingTab, setActiveTrainingTab] = useState("analysis");
  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: allAudits = [] } = useQuery({
    queryKey: ['allComplianceAudits'],
    queryFn: () => base44.entities.ComplianceAudit.list('-audit_date', 500)
  });

  const { data: allViolations = [] } = useQuery({
    queryKey: ['allComplianceViolations'],
    queryFn: () => base44.entities.ComplianceViolation.list('-created_date', 500)
  });

  const { data: regulatoryUpdates = [] } = useQuery({
    queryKey: ['regulatoryUpdates'],
    queryFn: () => base44.entities.RegulatoryUpdate.list('-effective_date', 50),
  });

  const { data: trainingProgress = [] } = useQuery({
    queryKey: ['complianceTrainingProgress', currentUser?.email],
    queryFn: () => base44.entities.ComplianceTrainingProgress.filter({ user_email: currentUser.email }),
    enabled: !!currentUser?.email
  });

  const { data: visits = [] } = useQuery({
    queryKey: ['allVisits'],
    queryFn: () => base44.entities.Visit.list()
  });

  const { data: carePlans = [] } = useQuery({
    queryKey: ['allCarePlans'],
    queryFn: () => base44.entities.CarePlan.list()
  });

  const { data: userAgency } = useQuery({
    queryKey: ['userAgency', currentUser?.email],
    queryFn: async () => {
      if (currentUser?.role === 'admin') return null;
      const agencies = await base44.entities.Agency.filter({ admin_email: currentUser.email });
      return agencies[0] || null;
    },
    enabled: !!currentUser?.email && currentUser?.role !== 'admin'
  });

  const isAgencyAdmin = !!userAgency;
  const canAccessDashboard = currentUser?.role === 'admin' || isAgencyAdmin;

  const resolveViolationMutation = useMutation({
    mutationFn: ({ id, resolution_notes }) => 
      base44.entities.ComplianceViolation.update(id, {
        status: 'resolved',
        resolved_date: new Date().toISOString(),
        resolution_notes
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['allComplianceViolations'] });
      toast.success("Violation resolved");
    }
  });

  // Metrics
  const metrics = useMemo(() => {
    const days = parseInt(timeframe);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const recentAudits = allAudits.filter(a => new Date(a.audit_date) >= cutoff);
    const recentViolations = allViolations.filter(v => new Date(v.created_date) >= cutoff);
    const openViolations = allViolations.filter(v => v.status === 'open');

    const avgScore = recentAudits.length > 0
      ? (recentAudits.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / recentAudits.length).toFixed(1)
      : 0;

    return {
      avgScore,
      totalViolations: recentViolations.length,
      openViolations: openViolations.length,
      criticalOpen: openViolations.filter(v => v.severity === 'critical').length,
      passedAudits: recentAudits.filter(a => a.status === 'passed').length,
      autoFixableCount: openViolations.filter(v => v.auto_fix_available).length
    };
  }, [allAudits, allViolations, timeframe]);

  const violationsBySeverity = useMemo(() => {
    const counts = allViolations.filter(v => v.status === 'open').reduce((acc, v) => {
      acc[v.severity] = (acc[v.severity] || 0) + 1;
      return acc;
    }, {});

    const colors = { critical: '#EF4444', high: '#F97316', medium: '#EAB308', low: '#3B82F6' };

    return Object.entries(counts).map(([severity, count]) => ({
      name: severity.charAt(0).toUpperCase() + severity.slice(1),
      value: count,
      color: colors[severity]
    }));
  }, [allViolations]);

  const filteredViolations = useMemo(() => {
    return allViolations.filter(v => {
      const matchesSeverity = filterSeverity === 'all' || v.severity === filterSeverity;
      const matchesStatus = filterStatus === 'all' || v.status === filterStatus;
      const matchesSearch = !searchTerm ||
        v.rule_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        v.violation_description?.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesSeverity && matchesStatus && matchesSearch;
    });
  }, [allViolations, filterSeverity, filterStatus, searchTerm]);

  const handleGenerateTraining = (patterns) => {
    setSelectedErrorPatterns(patterns);
    setActiveTrainingTab("training");
  };

  const handleTrainingGenerated = (data) => {
    setTrainingContent(data.training_module);
    setActiveTrainingTab("quiz");
  };

  const completedModules = trainingProgress.filter(p => p.status === 'completed' || p.status === 'mastered');
  const avgTrainingScore = trainingProgress.length > 0
    ? Math.round(trainingProgress.reduce((sum, p) => sum + (p.quiz_score || 0), 0) / trainingProgress.length)
    : 0;

  return (
    <PullToRefresh onRefresh={() => queryClient.invalidateQueries()}>
      <div className="p-3 sm:p-4 md:p-6 max-w-7xl mx-auto w-full max-w-full overflow-x-hidden min-w-0 pb-20 sm:pb-6">
        <div className="mb-4 sm:mb-6">
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Shield className="w-6 h-6 sm:w-8 sm:h-8 text-blue-600" />
            Compliance Hub
          </h1>
          <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400 mt-1">
            Monitor compliance, regulatory updates, and training
          </p>
        </div>

        <Tabs defaultValue="dashboard" className="w-full">
         <div className="w-full overflow-x-auto mb-4 scrollbar-hide">
           <TabsList className="inline-flex w-max min-w-full gap-1 p-1">
             <TabsTrigger value="dashboard" className="text-xs sm:text-sm px-2 sm:px-3 whitespace-nowrap">Dashboard</TabsTrigger>
             <TabsTrigger value="updates" className="text-xs sm:text-sm px-2 sm:px-3 whitespace-nowrap">Updates</TabsTrigger>
             <TabsTrigger value="training" className="text-xs sm:text-sm px-2 sm:px-3 whitespace-nowrap">Training</TabsTrigger>
           </TabsList>
         </div>

          {/* Dashboard Tab */}
          <TabsContent value="dashboard" className="space-y-4 sm:space-y-6 w-full">
            {canAccessDashboard ? (
              <>
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <h2 className="text-lg sm:text-xl font-semibold">Compliance Monitoring</h2>
                  <Select value={timeframe} onValueChange={setTimeframe}>
                    <SelectTrigger className="w-full sm:w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="7">7 Days</SelectItem>
                      <SelectItem value="30">30 Days</SelectItem>
                      <SelectItem value="90">90 Days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Key Metrics */}
                <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
                  <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
                    <CardContent className="p-3 sm:p-4">
                      <TrendingUp className="w-8 h-8 text-blue-600 mb-2" />
                      <p className="text-2xl font-bold text-gray-900">{metrics.avgScore}%</p>
                      <p className="text-xs text-gray-600">Avg Compliance</p>
                    </CardContent>
                  </Card>
                  <Card className="bg-gradient-to-br from-red-50 to-red-100 border-red-200">
                    <CardContent className="p-4">
                      <AlertTriangle className="w-8 h-8 text-red-600 mb-2" />
                      <p className="text-2xl font-bold text-gray-900">{metrics.openViolations}</p>
                      <p className="text-xs text-gray-600">Open Issues</p>
                    </CardContent>
                  </Card>
                  <Card className="bg-gradient-to-br from-orange-50 to-orange-100 border-orange-200">
                    <CardContent className="p-4">
                      <XCircle className="w-8 h-8 text-orange-600 mb-2" />
                      <p className="text-2xl font-bold text-gray-900">{metrics.criticalOpen}</p>
                      <p className="text-xs text-gray-600">Critical</p>
                    </CardContent>
                  </Card>
                  <Card className="bg-gradient-to-br from-green-50 to-green-100 border-green-200">
                    <CardContent className="p-4">
                      <CheckCircle2 className="w-8 h-8 text-green-600 mb-2" />
                      <p className="text-2xl font-bold text-gray-900">{metrics.passedAudits}</p>
                      <p className="text-xs text-gray-600">Passed</p>
                    </CardContent>
                  </Card>
                </div>

                {/* Filters */}
                <Card className="w-full">
                  <CardContent className="p-3 sm:p-4">
                    <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center w-full">
                      <div className="flex-1 relative w-full">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <Input
                          placeholder="Search violations..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          className="pl-10 h-11"
                        />
                      </div>
                      <Select value={filterSeverity} onValueChange={setFilterSeverity}>
                        <SelectTrigger className="w-full sm:w-40 h-11">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Severities</SelectItem>
                          <SelectItem value="critical">Critical</SelectItem>
                          <SelectItem value="high">High</SelectItem>
                          <SelectItem value="medium">Medium</SelectItem>
                          <SelectItem value="low">Low</SelectItem>
                        </SelectContent>
                      </Select>
                      <Select value={filterStatus} onValueChange={setFilterStatus}>
                        <SelectTrigger className="w-full sm:w-32 h-11">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All</SelectItem>
                          <SelectItem value="open">Open</SelectItem>
                          <SelectItem value="resolved">Resolved</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </CardContent>
                </Card>

                {/* Violations */}
                <div className="space-y-3 w-full">
                  {filteredViolations.length === 0 ? (
                    <Card>
                      <CardContent className="p-12 text-center">
                        <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
                        <p className="text-gray-600">No compliance issues!</p>
                      </CardContent>
                    </Card>
                  ) : (
                    filteredViolations.slice(0, 10).map((violation) => (
                      <Card key={violation.id} className={`border-l-4 w-full ${
                       violation.severity === 'critical' ? 'border-l-red-500' :
                       violation.severity === 'high' ? 'border-l-orange-500' : 'border-l-yellow-500'
                      }`}>
                       <CardContent className="p-3 sm:p-4">
                         <div className="flex flex-col sm:flex-row items-start justify-between gap-3">
                            <div className="flex-1 w-full min-w-0">
                              <div className="flex items-start flex-wrap gap-2 mb-2">
                                <h4 className="font-semibold text-sm sm:text-base break-words">{violation.rule_name}</h4>
                                <Badge className={violation.severity === 'critical' ? 'bg-red-600' : violation.severity === 'high' ? 'bg-orange-600' : 'bg-yellow-600'}>
                                  {violation.severity}
                                </Badge>
                                {violation.auto_fix_available && <Badge className="bg-green-600"><Wand2 className="w-3 h-3 mr-1" />Auto-Fix</Badge>}
                              </div>
                              <p className="text-xs sm:text-sm text-gray-700 mb-2 break-words">{violation.violation_description}</p>
                              <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-xs text-gray-500">
                                <span className="break-all">{violation.user_email}</span>
                                <span className="hidden sm:inline">•</span>
                                <span>{formatEastern(violation.created_date, 'MMM d, yyyy')}</span>
                              </div>
                            </div>
                            <div className="flex gap-2 flex-shrink-0 w-full sm:w-auto">
                              <Button size="sm" variant="outline" onClick={() => { setSelectedViolation(violation); setDetailDialog(true); }}>
                                <Eye className="w-4 h-4" />
                              </Button>
                              {violation.status === 'open' && (
                                <Button size="sm" onClick={() => resolveViolationMutation.mutate({ id: violation.id, resolution_notes: 'Resolved' })} className="bg-green-600">
                                  Resolve
                                </Button>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))
                  )}
                </div>
              </>
            ) : (
              <Card>
                <CardContent className="p-12 text-center">
                  <Shield className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                  <h2 className="text-2xl font-bold mb-2">Access Restricted</h2>
                  <p className="text-gray-600">Dashboard access for administrators only</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Regulatory Updates Tab */}
          <TabsContent value="updates" className="space-y-4 w-full">
            <h2 className="text-lg sm:text-xl font-semibold mb-3 sm:mb-4">Regulatory Compliance Center</h2>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mb-4 sm:mb-6">
              Latest healthcare regulatory changes and compliance requirements
            </p>

            {regulatoryUpdates.length === 0 ? (
              <Card>
                <CardContent className="p-12 text-center">
                  <CheckCircle2 className="w-16 h-16 text-green-400 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold">No Recent Updates</h3>
                  <p className="text-sm text-gray-600 mt-2">System will notify you of new regulatory changes</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                {regulatoryUpdates.map((update) => (
                  <Card key={update.id} className="hover:shadow-lg transition-shadow">
                    <CardHeader>
                      <CardTitle className="text-base font-bold flex flex-col gap-2">
                        <span>{update.title}</span>
                        <div className="flex gap-2">
                          <Badge className={update.impact_level === 'critical' ? 'bg-red-600' : update.impact_level === 'high' ? 'bg-orange-500' : 'bg-blue-500'}>
                            {update.impact_level}
                          </Badge>
                          <Badge variant="outline">{update.status}</Badge>
                        </div>
                      </CardTitle>
                      <div className="flex items-center gap-2 text-sm text-slate-500 mt-2">
                        <ScrollText className="w-4 h-4" />
                        <span>{update.source}</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-slate-500">
                        <CalendarDays className="w-4 h-4" />
                        <span>Effective: {update.effective_date ? format(new Date(update.effective_date), 'MMM d, yyyy') : 'N/A'}</span>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-slate-700 dark:text-slate-300 mb-3">{update.summary}</p>
                      {update.reference_url && (
                        <a href={update.reference_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center text-blue-600 hover:text-blue-800 text-sm font-medium">
                          <BookOpen className="w-4 h-4 mr-1" />
                          Read More
                        </a>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Training Tab */}
          <TabsContent value="training" className="space-y-4 sm:space-y-6 w-full">
            {/* Training Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3">
              <Card className="bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
                <CardContent className="p-3 sm:p-4">
                  <Award className="w-6 h-6 sm:w-8 sm:h-8 text-purple-600 mb-1 sm:mb-2 flex-shrink-0" />
                  <p className="text-xl sm:text-2xl font-bold">{completedModules.length}</p>
                  <p className="text-[10px] sm:text-xs text-gray-600 truncate">Modules Done</p>
                </CardContent>
              </Card>
              <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
                <CardContent className="p-3 sm:p-4">
                  <TrendingUp className="w-6 h-6 sm:w-8 sm:h-8 text-blue-600 mb-1 sm:mb-2 flex-shrink-0" />
                  <p className="text-xl sm:text-2xl font-bold">{avgTrainingScore}%</p>
                  <p className="text-[10px] sm:text-xs text-gray-600 truncate">Avg Quiz</p>
                </CardContent>
              </Card>
              <Card className="bg-gradient-to-br from-green-50 to-green-100 border-green-200">
                <CardContent className="p-3 sm:p-4">
                  <Brain className="w-6 h-6 sm:w-8 sm:h-8 text-green-600 mb-1 sm:mb-2 flex-shrink-0" />
                  <p className="text-xl sm:text-2xl font-bold">{trainingProgress.length}</p>
                  <p className="text-[10px] sm:text-xs text-gray-600 truncate">Sessions</p>
                </CardContent>
              </Card>
            </div>

            {/* Training Content */}
            <Tabs value={activeTrainingTab} onValueChange={setActiveTrainingTab} className="w-full">
              <TabsList className="grid w-full grid-cols-3 gap-1 p-1 h-auto">
                <TabsTrigger value="analysis" className="text-xs sm:text-sm">Error Analysis</TabsTrigger>
                <TabsTrigger value="training" disabled={!selectedErrorPatterns} className="text-xs sm:text-sm">Content</TabsTrigger>
                <TabsTrigger value="quiz" disabled={!trainingContent} className="text-xs sm:text-sm">Quiz</TabsTrigger>
              </TabsList>

              <TabsContent value="analysis" className="space-y-4 mt-6">
                <ComplianceErrorAnalyzer
                  userEmail={currentUser?.email}
                  onGenerateTraining={handleGenerateTraining}
                />
                
                {trainingProgress.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Your Training History</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {trainingProgress.map((progress, idx) => (
                          <div key={idx} className="p-3 bg-gray-50 rounded-lg border flex items-center justify-between">
                            <div className="flex-1">
                              <p className="font-medium text-sm">{progress.module_title}</p>
                              <div className="flex items-center gap-2 mt-1">
                                <Badge className={progress.status === 'completed' ? 'bg-green-600' : progress.status === 'mastered' ? 'bg-purple-600' : 'bg-blue-600'}>
                                  {progress.status}
                                </Badge>
                                {progress.quiz_score && <span className="text-xs text-gray-600">Score: {progress.quiz_score}%</span>}
                              </div>
                            </div>
                            {progress.completion_date && (
                              <Badge variant="outline" className="text-xs">
                                {new Date(progress.completion_date).toLocaleDateString()}
                              </Badge>
                            )}
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="training" className="mt-6">
                {selectedErrorPatterns && (
                  <PersonalizedComplianceTraining
                    errorPatterns={selectedErrorPatterns}
                    userEmail={currentUser?.email}
                    onTrainingGenerated={handleTrainingGenerated}
                  />
                )}
              </TabsContent>

              <TabsContent value="quiz" className="mt-6">
                {trainingContent?.quiz_questions && (
                  <ComplianceQuizSimulator
                    quizQuestions={trainingContent.quiz_questions}
                    moduleId={trainingContent.module_id}
                    moduleTitle={trainingContent.module_title}
                    userEmail={currentUser?.email}
                  />
                )}
              </TabsContent>
            </Tabs>
          </TabsContent>
        </Tabs>

        {/* Detail Dialog */}
        <Dialog open={detailDialog} onOpenChange={setDetailDialog}>
          <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Compliance Issue Details</DialogTitle>
            </DialogHeader>
            {selectedViolation && (
              <div className="space-y-4">
                <div>
                  <Label className="text-sm font-semibold">Rule</Label>
                  <p className="text-sm mt-1">{selectedViolation.rule_name}</p>
                </div>
                <div>
                  <Label className="text-sm font-semibold">Description</Label>
                  <p className="text-sm mt-1">{selectedViolation.violation_description}</p>
                </div>
                {selectedViolation.recommended_action && (
                  <div>
                    <Label className="text-sm font-semibold">Recommended Action</Label>
                    <p className="text-sm mt-1 p-3 bg-blue-50 rounded">{selectedViolation.recommended_action}</p>
                  </div>
                )}
                {selectedViolation.status === 'open' && (
                  <Button onClick={() => { resolveViolationMutation.mutate({ id: selectedViolation.id, resolution_notes: 'Manual resolution' }); setDetailDialog(false); }} className="w-full bg-green-600">
                    Mark as Resolved
                  </Button>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </PullToRefresh>
  );
}