import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2, Plus, Users, DollarSign, Copy, Edit, CheckCircle, XCircle, Clock } from "lucide-react";
import { format } from "date-fns";

export default function AgencyManagement() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingAgency, setEditingAgency] = useState(null);
  const [formData, setFormData] = useState({
    agency_name: "",
    contact_name: "",
    contact_email: "",
    contact_phone: "",
    billing_address: "",
    max_users: 10,
    price_per_user: 29.99,
    billing_cycle: "monthly",
    status: "active"
  });

  const { data: agencies = [] } = useQuery({
    queryKey: ['agencies'],
    queryFn: () => base44.entities.Agency.list('-created_date')
  });

  const { data: allUsers = [] } = useQuery({
    queryKey: ['allUsers'],
    queryFn: () => base44.entities.User.list()
  });

  const createAgencyMutation = useMutation({
    mutationFn: async (data) => {
      // Generate unique agency code
      const code = `AG${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      return base44.entities.Agency.create({
        ...data,
        agency_code: code,
        current_user_count: 0,
        next_billing_date: format(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd')
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agencies'] });
      toast.success('Agency created successfully');
      resetForm();
    }
  });

  const updateAgencyMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Agency.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agencies'] });
      toast.success('Agency updated');
      resetForm();
    }
  });

  const resetForm = () => {
    setFormData({
      agency_name: "",
      contact_name: "",
      contact_email: "",
      contact_phone: "",
      billing_address: "",
      max_users: 10,
      price_per_user: 29.99,
      billing_cycle: "monthly",
      status: "active"
    });
    setEditingAgency(null);
    setShowForm(false);
  };

  const handleEdit = (agency) => {
    setEditingAgency(agency);
    setFormData({
      agency_name: agency.agency_name,
      contact_name: agency.contact_name || "",
      contact_email: agency.contact_email || "",
      contact_phone: agency.contact_phone || "",
      billing_address: agency.billing_address || "",
      max_users: agency.max_users,
      price_per_user: agency.price_per_user,
      billing_cycle: agency.billing_cycle,
      status: agency.status
    });
    setShowForm(true);
  };

  const handleSubmit = () => {
    if (editingAgency) {
      updateAgencyMutation.mutate({ id: editingAgency.id, data: formData });
    } else {
      createAgencyMutation.mutate(formData);
    }
  };

  const copyAgencyCode = (code) => {
    navigator.clipboard.writeText(code);
    toast.success('Agency code copied to clipboard');
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'active': return <Badge className="bg-green-600"><CheckCircle className="w-3 h-3 mr-1" />Active</Badge>;
      case 'trial': return <Badge className="bg-blue-600"><Clock className="w-3 h-3 mr-1" />Trial</Badge>;
      case 'suspended': return <Badge className="bg-orange-600">Suspended</Badge>;
      case 'cancelled': return <Badge className="bg-red-600"><XCircle className="w-3 h-3 mr-1" />Cancelled</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  // Calculate metrics
  const totalAgencies = agencies.length;
  const activeAgencies = agencies.filter(a => a.status === 'active').length;
  const totalUsers = agencies.reduce((sum, a) => sum + (a.current_user_count || 0), 0);
  const totalMRR = agencies
    .filter(a => a.status === 'active')
    .reduce((sum, a) => sum + ((a.current_user_count || 0) * (a.price_per_user || 0)), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Building2 className="w-6 h-6 text-blue-600" />
            Agency Management
          </h2>
          <p className="text-slate-600">Manage enterprise agencies and billing</p>
        </div>
        <Button onClick={() => setShowForm(true)} className="bg-blue-600 hover:bg-blue-700">
          <Plus className="w-4 h-4 mr-2" />
          New Agency
        </Button>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <Building2 className="w-8 h-8 text-blue-600" />
            </div>
            <p className="text-3xl font-bold text-slate-900">{totalAgencies}</p>
            <p className="text-xs text-slate-600">Total Agencies</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-50 to-green-100 border-green-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <CheckCircle className="w-8 h-8 text-green-600" />
            </div>
            <p className="text-3xl font-bold text-slate-900">{activeAgencies}</p>
            <p className="text-xs text-slate-600">Active Agencies</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <Users className="w-8 h-8 text-purple-600" />
            </div>
            <p className="text-3xl font-bold text-slate-900">{totalUsers}</p>
            <p className="text-xs text-slate-600">Total Agency Users</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-amber-50 to-amber-100 border-amber-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <DollarSign className="w-8 h-8 text-amber-600" />
            </div>
            <p className="text-3xl font-bold text-slate-900">${totalMRR.toFixed(2)}</p>
            <p className="text-xs text-slate-600">Agency MRR</p>
          </CardContent>
        </Card>
      </div>

      {/* Create/Edit Form */}
      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>{editingAgency ? 'Edit Agency' : 'Create New Agency'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Agency Name *</Label>
                <Input
                  value={formData.agency_name}
                  onChange={(e) => setFormData({ ...formData, agency_name: e.target.value })}
                  placeholder="e.g., Metro Home Health"
                />
              </div>
              <div>
                <Label>Contact Name</Label>
                <Input
                  value={formData.contact_name}
                  onChange={(e) => setFormData({ ...formData, contact_name: e.target.value })}
                  placeholder="John Doe"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Contact Email</Label>
                <Input
                  type="email"
                  value={formData.contact_email}
                  onChange={(e) => setFormData({ ...formData, contact_email: e.target.value })}
                  placeholder="contact@agency.com"
                />
              </div>
              <div>
                <Label>Contact Phone</Label>
                <Input
                  value={formData.contact_phone}
                  onChange={(e) => setFormData({ ...formData, contact_phone: e.target.value })}
                  placeholder="(555) 123-4567"
                />
              </div>
            </div>

            <div>
              <Label>Billing Address</Label>
              <Input
                value={formData.billing_address}
                onChange={(e) => setFormData({ ...formData, billing_address: e.target.value })}
                placeholder="123 Main St, City, State ZIP"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label>Max Users</Label>
                <Input
                  type="number"
                  value={formData.max_users}
                  onChange={(e) => setFormData({ ...formData, max_users: parseInt(e.target.value) })}
                />
              </div>
              <div>
                <Label>Price Per User/Month ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.price_per_user}
                  onChange={(e) => setFormData({ ...formData, price_per_user: parseFloat(e.target.value) })}
                />
              </div>
              <div>
                <Label>Billing Cycle</Label>
                <Select value={formData.billing_cycle} onValueChange={(v) => setFormData({ ...formData, billing_cycle: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="quarterly">Quarterly</SelectItem>
                    <SelectItem value="annually">Annually</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>Status</Label>
              <Select value={formData.status} onValueChange={(v) => setFormData({ ...formData, status: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="trial">Trial</SelectItem>
                  <SelectItem value="suspended">Suspended</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-2 justify-end pt-4 border-t">
              <Button variant="outline" onClick={resetForm}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={!formData.agency_name}>
                {editingAgency ? 'Update' : 'Create'} Agency
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Agencies List */}
      <div className="space-y-4">
        {agencies.map((agency) => {
          const agencyUsers = allUsers.filter(u => u.agency_code === agency.agency_code);
          const monthlyBill = agencyUsers.length * agency.price_per_user;

          return (
            <Card key={agency.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="text-xl flex items-center gap-2">
                      {agency.agency_name}
                      {getStatusBadge(agency.status)}
                    </CardTitle>
                    <CardDescription className="mt-2 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-semibold text-blue-600">{agency.agency_code}</span>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => copyAgencyCode(agency.agency_code)}
                          className="h-6 px-2"
                        >
                          <Copy className="w-3 h-3" />
                        </Button>
                      </div>
                      {agency.contact_name && <p className="text-xs">Contact: {agency.contact_name}</p>}
                      {agency.contact_email && <p className="text-xs">{agency.contact_email}</p>}
                    </CardDescription>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => handleEdit(agency)}>
                    <Edit className="w-4 h-4 mr-2" />
                    Edit
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                  <div className="text-center p-3 bg-slate-100 rounded-lg">
                    <p className="text-2xl font-bold text-slate-900">{agencyUsers.length}</p>
                    <p className="text-xs text-slate-600">Active Users</p>
                    <p className="text-xs text-slate-500">of {agency.max_users} max</p>
                  </div>
                  <div className="text-center p-3 bg-slate-100 rounded-lg">
                    <p className="text-2xl font-bold text-slate-900">${agency.price_per_user}</p>
                    <p className="text-xs text-slate-600">Per User/Month</p>
                  </div>
                  <div className="text-center p-3 bg-slate-100 rounded-lg">
                    <p className="text-2xl font-bold text-green-600">${monthlyBill.toFixed(2)}</p>
                    <p className="text-xs text-slate-600">Monthly Bill</p>
                  </div>
                  <div className="text-center p-3 bg-slate-100 rounded-lg">
                    <p className="text-2xl font-bold text-slate-900">${agency.total_billed_amount?.toFixed(2) || '0.00'}</p>
                    <p className="text-xs text-slate-600">Total Billed</p>
                  </div>
                </div>

                {/* Agency Users */}
                {agencyUsers.length > 0 && (
                  <div>
                    <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
                      <Users className="w-4 h-4" />
                      Agency Users ({agencyUsers.length})
                    </h4>
                    <div className="space-y-2">
                      {agencyUsers.map((user) => (
                        <div key={user.id} className="flex items-center justify-between p-2 bg-slate-50 rounded">
                          <div>
                            <p className="text-sm font-medium">{user.full_name || user.email}</p>
                            <p className="text-xs text-slate-600">{user.email}</p>
                          </div>
                          <div className="text-right">
                            <Badge variant="outline" className="text-xs">
                              {user.credential_type || user.provider_type || 'Provider'}
                            </Badge>
                            {user.joined_agency_date && (
                              <p className="text-xs text-slate-500 mt-1">
                                Joined: {format(new Date(user.joined_agency_date), 'MMM d, yyyy')}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Billing Info */}
                <div className="mt-4 pt-4 border-t">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-slate-600">Billing Cycle:</span>
                      <span className="ml-2 font-medium">{agency.billing_cycle}</span>
                    </div>
                    <div>
                      <span className="text-slate-600">Next Billing:</span>
                      <span className="ml-2 font-medium">
                        {agency.next_billing_date ? format(new Date(agency.next_billing_date), 'MMM d, yyyy') : 'Not set'}
                      </span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}

        {agencies.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center">
              <Building2 className="w-16 h-16 text-slate-300 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-slate-900 mb-2">No Agencies Yet</h3>
              <p className="text-slate-600 mb-4">Create your first enterprise agency account</p>
              <Button onClick={() => setShowForm(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Create First Agency
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}