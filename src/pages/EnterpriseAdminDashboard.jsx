import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Building2, Users, Search, ChevronRight, Mail, Phone, CreditCard, ArrowLeft } from "lucide-react";

export default function EnterpriseAdminDashboard() {
  const [selectedAgency, setSelectedAgency] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: agencies = [] } = useQuery({
    queryKey: ['enterpriseAgencies'],
    queryFn: async () => {
      const allAgencies = await base44.asServiceRole.entities.Agency.list();
      return allAgencies.filter(a => a.is_enterprise);
    },
    enabled: currentUser?.role === 'admin'
  });

  const { data: agencyUsers = [] } = useQuery({
    queryKey: ['agencyUsers', selectedAgency?.agency_code],
    queryFn: async () => {
      const allUsers = await base44.asServiceRole.entities.User.list();
      return allUsers.filter(u => u.agency_code === selectedAgency.agency_code);
    },
    enabled: !!selectedAgency
  });

  if (currentUser?.role !== 'admin') {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-6">
            <p className="text-center text-slate-600">Access denied. Admin privileges required.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const filteredAgencies = agencies.filter(agency =>
    agency.agency_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    agency.agency_code?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // If an agency is selected, show its users
  if (selectedAgency) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4 md:p-6">
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="flex items-center gap-4">
            <Button variant="outline" onClick={() => setSelectedAgency(null)}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Agencies
            </Button>
            <div>
              <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
                {selectedAgency.agency_name}
              </h1>
              <p className="text-slate-600 mt-1">
                {agencyUsers.length} users • {selectedAgency.package_name || 'Custom Package'}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-600">Total Users</p>
                    <p className="text-2xl font-bold">{agencyUsers.length}</p>
                  </div>
                  <Users className="w-8 h-8 text-blue-600" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-600">Monthly Rate</p>
                    <p className="text-2xl font-bold">${selectedAgency.price_per_user}/user</p>
                  </div>
                  <CreditCard className="w-8 h-8 text-green-600" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-600">Status</p>
                    <Badge className={
                      selectedAgency.status === 'active' ? 'bg-green-500' :
                      selectedAgency.status === 'trial' ? 'bg-blue-500' :
                      'bg-red-500'
                    }>
                      {selectedAgency.status}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-600">Features</p>
                    <p className="text-2xl font-bold">{selectedAgency.enabled_features?.length || 0}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Agency Users</CardTitle>
              <CardDescription>All users under this agency</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {agencyUsers.map((user) => (
                  <div key={user.id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-slate-50">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-full flex items-center justify-center">
                        <span className="text-white text-sm font-semibold">
                          {user.full_name?.substring(0, 2).toUpperCase() || 'U'}
                        </span>
                      </div>
                      <div>
                        <p className="font-medium">{user.full_name || 'Unknown'}</p>
                        <div className="flex items-center gap-2 text-sm text-slate-600">
                          <Mail className="w-3 h-3" />
                          {user.email}
                        </div>
                        {user.phone && (
                          <div className="flex items-center gap-2 text-sm text-slate-600">
                            <Phone className="w-3 h-3" />
                            {user.phone}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {user.credential_type && (
                        <Badge variant="outline">{user.credential_type}</Badge>
                      )}
                      <Badge className={user.role === 'admin' ? 'bg-purple-500' : 'bg-blue-500'}>
                        {user.role}
                      </Badge>
                    </div>
                  </div>
                ))}
                {agencyUsers.length === 0 && (
                  <div className="text-center py-8 text-slate-500">
                    No users found for this agency
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Show agency list
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
            <Building2 className="w-8 h-8 text-blue-600" />
            Enterprise Agencies
          </h1>
          <p className="text-slate-600 mt-1">
            Manage all enterprise customer agencies
          </p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Enterprise Customers ({agencies.length})</CardTitle>
              <div className="relative w-64">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  placeholder="Search agencies..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {filteredAgencies.map((agency) => (
                <div
                  key={agency.id}
                  onClick={() => setSelectedAgency(agency)}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-slate-50 cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-lg flex items-center justify-center">
                      <Building2 className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <p className="font-semibold text-slate-900">{agency.agency_name}</p>
                      <p className="text-sm text-slate-600">Code: {agency.agency_code}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="outline" className="text-xs">
                          {agency.current_user_count || 0} users
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          ${agency.price_per_user}/user
                        </Badge>
                        {agency.package_name && (
                          <Badge className="bg-blue-600 text-xs">{agency.package_name}</Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge className={
                      agency.status === 'active' ? 'bg-green-500' :
                      agency.status === 'trial' ? 'bg-blue-500' :
                      agency.status === 'suspended' ? 'bg-red-500' :
                      'bg-slate-500'
                    }>
                      {agency.status}
                    </Badge>
                    <ChevronRight className="w-5 h-5 text-slate-400" />
                  </div>
                </div>
              ))}
            </div>

            {filteredAgencies.length === 0 && (
              <div className="text-center py-12">
                <Building2 className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                <p className="text-slate-600">
                  {searchTerm ? 'No agencies found matching your search' : 'No enterprise agencies yet'}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}