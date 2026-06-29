import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, CheckCircle2, XCircle, Clock, AlertTriangle } from "lucide-react";
import OASISComparisonView from "@/components/oasis/OASISComparisonView";
import OASISApprovalWorkflow from "@/components/oasis/OASISApprovalWorkflow";

export default function OASISReview() {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [_severityFilter, _setSeverityFilter] = useState("all");
  const [selectedPatient, setSelectedPatient] = useState(null);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const isAdmin = currentUser?.role === 'admin';

  // Fetch patients with pending OASIS reviews
  const { data: patients = [] } = useQuery({
    queryKey: ['patients'],
    queryFn: () => base44.entities.Patient.list('-updated_date', 2000),
  });

  // Fetch all OASIS uploads with AI suggestions
  const { data: oasisRecords = [] } = useQuery({
    queryKey: ['oasisRecords'],
    queryFn: async () => {
      // Routed through listOASISUploads so financial fields are stripped server-side for non-financial users.
      const records = (await base44.functions.invoke('listOASISUploads', { limit: 200 }))?.data?.uploads || [];
      // Filter records that have AI-generated suggestions needing review
      return records.filter(r => r.extracted_data && Object.keys(r.extracted_data).some(
        key => r.extracted_data[key]?.source?.includes('ai_automation')
      ));
    },
  });

  // Group by patient and get latest
  const patientOASISMap = oasisRecords.reduce((acc, record) => {
    if (!acc[record.patient_id] || new Date(record.created_date) > new Date(acc[record.patient_id].created_date)) {
      acc[record.patient_id] = record;
    }
    return acc;
  }, {});

  const reviewItems = Object.entries(patientOASISMap).map(([patientId, oasis]) => {
    const patient = patients.find(p => p.id === patientId);
    const aiSuggestions = Object.entries(oasis.extracted_data || {}).filter(
      ([_key, data]) => data?.source?.includes('ai_automation')
    );
    
    const pendingCount = aiSuggestions.filter(([_k, d]) => !d.reviewed).length;
    const approvedCount = aiSuggestions.filter(([_k, d]) => d.approved).length;
    const rejectedCount = aiSuggestions.filter(([_k, d]) => d.rejected).length;
    
    return {
      patientId,
      patient,
      oasis,
      aiSuggestions,
      pendingCount,
      approvedCount,
      rejectedCount,
      totalSuggestions: aiSuggestions.length,
      lastUpdated: oasis.updated_date || oasis.created_date,
      status: pendingCount > 0 ? 'pending' : approvedCount > 0 ? 'approved' : 'rejected'
    };
  });

  // Apply filters
  const filteredItems = reviewItems.filter(item => {
    const matchesSearch = !searchTerm || 
      item.patient?.first_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.patient?.last_name?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = statusFilter === 'all' || item.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  });

  const pendingReviews = reviewItems.filter(i => i.status === 'pending');
  const needsApproval = reviewItems.filter(i => i.approvedCount > 0 && !isAdmin);

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-6">
        <Card className="border-2 border-blue-200 bg-blue-50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-blue-600 font-medium">Total Pending</p>
                <p className="text-3xl font-bold text-blue-700">{pendingReviews.length}</p>
              </div>
              <Clock className="w-10 h-10 text-blue-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-2 border-green-200 bg-green-50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-green-600 font-medium">Approved</p>
                <p className="text-3xl font-bold text-green-700">
                  {reviewItems.reduce((sum, i) => sum + i.approvedCount, 0)}
                </p>
              </div>
              <CheckCircle2 className="w-10 h-10 text-green-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-2 border-red-200 bg-red-50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-red-600 font-medium">Rejected</p>
                <p className="text-3xl font-bold text-red-700">
                  {reviewItems.reduce((sum, i) => sum + i.rejectedCount, 0)}
                </p>
              </div>
              <XCircle className="w-10 h-10 text-red-400" />
            </div>
          </CardContent>
        </Card>

        {isAdmin && (
          <Card className="border-2 border-navy-200 bg-navy-50">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-navy-600 font-medium">Needs Approval</p>
                  <p className="text-3xl font-bold text-navy-700">{needsApproval.length}</p>
                </div>
                <AlertTriangle className="w-10 h-10 text-navy-400" />
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Filters */}
      <Card className="mb-4 sm:mb-6">
        <CardContent className="p-3 sm:p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Search patients..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 h-11 touch-target"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-11 touch-target">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="pending">Pending Review</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Main Content */}
      <Tabs defaultValue="review" className="space-y-6">
        <TabsList>
          <TabsTrigger value="review">Review Suggestions</TabsTrigger>
          {isAdmin && <TabsTrigger value="approval">Supervisor Approval</TabsTrigger>}
        </TabsList>

        <TabsContent value="review" className="space-y-4">
          {/* Check selectedPatient first: a reviewer mid-review must not lose
              the open comparison view if the filtered list empties out (e.g.
              they type in search or the records query is invalidated). */}
          {selectedPatient ? (
            <OASISComparisonView
              patient={selectedPatient.patient}
              oasisRecord={selectedPatient.oasis}
              aiSuggestions={selectedPatient.aiSuggestions}
              onClose={() => setSelectedPatient(null)}
              onUpdate={() => {
                queryClient.invalidateQueries({ queryKey: ['oasisRecords'] });
                setSelectedPatient(null);
              }}
            />
          ) : filteredItems.length === 0 ? (
            <Card>
              <CardContent className="p-12 text-center">
                <CheckCircle2 className="w-16 h-16 text-green-400 mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-slate-900 mb-2">All caught up!</h3>
                <p className="text-slate-600">No OASIS suggestions pending review.</p>
              </CardContent>
            </Card>
          ) : (
            filteredItems.map((item) => (
              <Card key={item.patientId} className="hover:shadow-lg transition-shadow">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-3">
                        <h3 className="text-lg font-semibold">
                          {item.patient?.first_name} {item.patient?.last_name}
                        </h3>
                        <Badge className={
                          item.status === 'pending' ? 'bg-blue-100 text-blue-800' :
                          item.status === 'approved' ? 'bg-green-100 text-green-800' :
                          'bg-slate-100 text-slate-800'
                        }>
                          {item.status}
                        </Badge>
                      </div>
                      
                      <div className="grid grid-cols-3 gap-4 text-sm">
                        <div>
                          <p className="text-slate-600">Total Suggestions</p>
                          <p className="font-bold text-lg">{item.totalSuggestions}</p>
                        </div>
                        <div>
                          <p className="text-slate-600">Pending Review</p>
                          <p className="font-bold text-lg text-blue-600">{item.pendingCount}</p>
                        </div>
                        <div>
                          <p className="text-slate-600">Last Updated</p>
                          <p className="font-medium">{new Date(item.lastUpdated).toLocaleDateString()}</p>
                        </div>
                      </div>
                    </div>

                    <Button
                      onClick={() => setSelectedPatient(item)}
                      disabled={!item.patient}
                      title={!item.patient ? "Patient record not found" : undefined}
                      className="bg-blue-600 hover:bg-blue-700"
                    >
                      Review OASIS
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        {isAdmin && (
          <TabsContent value="approval">
            <OASISApprovalWorkflow
              pendingItems={reviewItems.filter(i => i.approvedCount > 0)}
              onApprove={(_patientId) => {
                queryClient.invalidateQueries({ queryKey: ['oasisRecords'] });
              }}
            />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}