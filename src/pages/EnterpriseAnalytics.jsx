import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  BarChart3, Users, Target, Calendar, Shield, Activity, Building2,
  Download, Lock, Loader2
} from "lucide-react";
import { format, subDays } from "date-fns";

import EntPatientPopulation from "@/components/enterprise/EntPatientPopulation";
import EntCarePlanEffectiveness from "@/components/enterprise/EntCarePlanEffectiveness";
import EntVisitPerformance from "@/components/enterprise/EntVisitPerformance";
import EntComplianceTrends from "@/components/enterprise/EntComplianceTrends";
import EntUserProductivity from "@/components/enterprise/EntUserProductivity";

export default function EnterpriseAnalytics() {
  const [dateRange, setDateRange] = useState("30");
  const [startDate, setStartDate] = useState(format(subDays(new Date(), 30), "yyyy-MM-dd"));
  const [endDate, setEndDate] = useState(format(new Date(), "yyyy-MM-dd"));

  const { data: currentUser, isLoading: userLoading } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me(),
  });

  const hasEnterprise = !!currentUser?.agency_id;

  // All data fetches — enabled only when enterprise
  const { data: patients = [], isLoading: pLoad } = useQuery({
    queryKey: ["ent-patients"],
    queryFn: () => base44.entities.Patient.list("-updated_date", 500),
    enabled: hasEnterprise,
  });

  const { data: carePlans = [], isLoading: cpLoad } = useQuery({
    queryKey: ["ent-careplans"],
    queryFn: () => base44.entities.CarePlan.list("-created_date", 500),
    enabled: hasEnterprise,
  });

  const { data: visits = [], isLoading: vLoad } = useQuery({
    queryKey: ["ent-visits"],
    queryFn: () => base44.entities.Visit.list("-visit_date", 500),
    enabled: hasEnterprise,
  });

  const { data: audits = [] } = useQuery({
    queryKey: ["ent-audits"],
    queryFn: () => base44.entities.ComplianceAudit.list("-created_date", 500),
    enabled: hasEnterprise,
  });

  const { data: violations = [] } = useQuery({
    queryKey: ["ent-violations"],
    queryFn: () => base44.entities.ComplianceViolation.list("-created_date", 500),
    enabled: hasEnterprise,
  });

  const { data: activities = [] } = useQuery({
    queryKey: ["ent-activities"],
    queryFn: () => base44.entities.UserActivity.list("-created_date", 500),
    enabled: hasEnterprise,
  });

  const { data: noteConversions = [] } = useQuery({
    queryKey: ["ent-noteConversions"],
    queryFn: () => base44.entities.NoteConversion.list("-created_date", 500),
    enabled: hasEnterprise,
  });

  const { data: tasks = [] } = useQuery({
    queryKey: ["ent-tasks"],
    queryFn: () => base44.entities.Task.list("-created_date", 500),
    enabled: hasEnterprise,
  });

  const { data: allUsers = [] } = useQuery({
    queryKey: ["ent-users"],
    queryFn: () => base44.entities.User.list(),
    enabled: hasEnterprise && currentUser?.role === "admin",
  });

  // Date filter helper
  const filterByDate = (items, dateField = "created_date") => {
    const s = new Date(startDate);
    const e = new Date(endDate);
    e.setHours(23, 59, 59, 999);
    return items.filter(item => {
      const d = new Date(item[dateField] || item.created_date);
      return d >= s && d <= e;
    });
  };

  const handleDateRangeChange = (value) => {
    setDateRange(value);
    if (value !== "custom") {
      setStartDate(format(subDays(new Date(), parseInt(value)), "yyyy-MM-dd"));
      setEndDate(format(new Date(), "yyyy-MM-dd"));
    }
  };

  if (userLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  // Gate: must have enterprise/agency ID
  if (!hasEnterprise) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center space-y-4">
            <div className="mx-auto w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center">
              <Lock className="w-8 h-8 text-slate-400" />
            </div>
            <h2 className="text-xl font-bold text-slate-900">Agency Analytics</h2>
            <p className="text-sm text-slate-600">
              This feature is for home health & hospice agencies. Your agency admin can provide an Agency Code — enter it in <strong>Settings → Advanced → Agency Code</strong> to access benchmarking, nurse performance, and agency-wide reporting.
            </p>
            <Badge className="bg-blue-100 text-blue-700">
              <Building2 className="w-3 h-3 mr-1" />
              Enterprise Feature
            </Badge>
          </CardContent>
        </Card>
      </div>
    );
  }

  const filteredVisits = filterByDate(visits, "visit_date");
  const filteredAudits = filterByDate(audits);
  const filteredViolations = filterByDate(violations);
  const filteredActivities = filterByDate(activities);
  const filteredNotes = filterByDate(noteConversions);
  const filteredTasks = filterByDate(tasks);

  const isLoading = pLoad || cpLoad || vLoad;

  return (
    <div className="p-3 sm:p-4 md:p-6 max-w-7xl mx-auto pb-20 sm:pb-6 bg-gradient-to-br from-slate-200 via-blue-100 to-slate-300 min-h-screen">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4">
        <div>
          <h1 className="text-lg sm:text-xl md:text-2xl font-bold text-slate-900 flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-blue-600" />
            Agency Analytics
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 mt-0.5">
            Agency-wide nurse benchmarking, compliance, and performance reporting
          </p>
        </div>
        <Badge className="bg-blue-100 text-blue-700 text-xs">
          <Building2 className="w-3 h-3 mr-1" />
          {currentUser?.agency_id}
        </Badge>
      </div>

      {/* Date filters */}
      <Card className="mb-4">
        <CardContent className="p-3">
          <div className="flex flex-wrap gap-2 items-end">
            <div>
              <Label className="text-xs">Date Range</Label>
              <Select value={dateRange} onValueChange={handleDateRangeChange}>
                <SelectTrigger className="w-[140px] h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">Last 7 Days</SelectItem>
                  <SelectItem value="30">Last 30 Days</SelectItem>
                  <SelectItem value="90">Last 90 Days</SelectItem>
                  <SelectItem value="180">Last 6 Months</SelectItem>
                  <SelectItem value="365">Last Year</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {dateRange === "custom" && (
              <>
                <div>
                  <Label className="text-xs">From</Label>
                  <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-9 text-xs w-[140px]" />
                </div>
                <div>
                  <Label className="text-xs">To</Label>
                  <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-9 text-xs w-[140px]" />
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        </div>
      ) : (
        <Tabs defaultValue="population" className="w-full">
          <div className="w-full overflow-x-auto mb-4">
            <TabsList className="flex w-max min-w-full gap-1 p-1">
              <TabsTrigger value="population" className="text-[10px] sm:text-xs gap-1 whitespace-nowrap">
                <Users className="w-3 h-3" /> Patients
              </TabsTrigger>
              <TabsTrigger value="careplans" className="text-[10px] sm:text-xs gap-1 whitespace-nowrap">
                <Target className="w-3 h-3" /> Care Plans
              </TabsTrigger>
              <TabsTrigger value="visits" className="text-[10px] sm:text-xs gap-1 whitespace-nowrap">
                <Calendar className="w-3 h-3" /> Visits
              </TabsTrigger>
              <TabsTrigger value="compliance" className="text-[10px] sm:text-xs gap-1 whitespace-nowrap">
                <Shield className="w-3 h-3" /> Compliance
              </TabsTrigger>
              <TabsTrigger value="productivity" className="text-[10px] sm:text-xs gap-1 whitespace-nowrap">
                <Activity className="w-3 h-3" /> Productivity
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="population">
            <EntPatientPopulation patients={patients} />
          </TabsContent>

          <TabsContent value="careplans">
            <EntCarePlanEffectiveness carePlans={carePlans} />
          </TabsContent>

          <TabsContent value="visits">
            <EntVisitPerformance visits={filteredVisits} />
          </TabsContent>

          <TabsContent value="compliance">
            <EntComplianceTrends audits={filteredAudits} violations={filteredViolations} />
          </TabsContent>

          <TabsContent value="productivity">
            <EntUserProductivity
              activities={filteredActivities}
              noteConversions={filteredNotes}
              tasks={filteredTasks}
              users={allUsers}
            />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}