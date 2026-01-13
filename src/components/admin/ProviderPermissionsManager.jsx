/**
 * Admin interface for managing provider permissions and access control
 */

import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Plus,
  Edit2,
  Trash2,
  ChevronDown,
  CheckCircle2,
  XCircle,
  Users,
  Building2,
  Shield,
  Settings
} from 'lucide-react';
import { toast } from 'sonner';

export default function ProviderPermissionsManager() {
  const [selectedProvider, setSelectedProvider] = useState(null);
  const [activeTab, setActiveTab] = useState('permissions');
  const [showAddPermission, setShowAddPermission] = useState(false);

  const { data: providers = [] } = useQuery({
    queryKey: ['allProviders'],
    queryFn: async () => {
      const users = await base44.entities.User.filter({ role: 'user' });
      return users.filter(u => u.provider_type);
    }
  });

  const { data: permissions = [] } = useQuery({
    queryKey: ['permissions', selectedProvider?.email],
    queryFn: () => selectedProvider 
      ? base44.entities.ProviderPermission.filter({ provider_email: selectedProvider.email })
      : Promise.resolve([]),
    enabled: !!selectedProvider
  });

  const { data: patientAssignments = [] } = useQuery({
    queryKey: ['patientAssignments', selectedProvider?.email],
    queryFn: () => selectedProvider
      ? base44.entities.ProviderPatientAssignment.filter({ provider_email: selectedProvider.email })
      : Promise.resolve([]),
    enabled: !!selectedProvider
  });

  const { data: facilityAssignments = [] } = useQuery({
    queryKey: ['facilityAssignments', selectedProvider?.email],
    queryFn: () => selectedProvider
      ? base44.entities.ProviderFacilityAssignment.filter({ provider_email: selectedProvider.email })
      : Promise.resolve([]),
    enabled: !!selectedProvider
  });

  const handleDeletePermission = async (permId) => {
    try {
      await base44.entities.ProviderPermission.delete(permId);
      toast.success('Permission removed');
    } catch (error) {
      toast.error('Failed to remove permission');
    }
  };

  const handleDeletePatientAssignment = async (assignmentId) => {
    try {
      await base44.entities.ProviderPatientAssignment.delete(assignmentId);
      toast.success('Patient assignment removed');
    } catch (error) {
      toast.error('Failed to remove assignment');
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Provider List */}
        <div className="lg:col-span-1 space-y-4">
          <h3 className="font-semibold text-gray-900">Providers</h3>
          <div className="space-y-2 max-h-96 overflow-y-auto border rounded-lg p-2">
            {providers.map((provider) => (
              <button
                key={provider.id}
                onClick={() => setSelectedProvider(provider)}
                className={`w-full text-left p-2 rounded text-sm transition ${
                  selectedProvider?.id === provider.id
                    ? 'bg-blue-100 text-blue-900 border border-blue-300'
                    : 'hover:bg-gray-100'
                }`}
              >
                <p className="font-medium">{provider.full_name}</p>
                <p className="text-xs text-gray-600">{provider.provider_type}</p>
                <p className="text-xs text-gray-500">{provider.email}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Main Content */}
        {selectedProvider ? (
          <div className="lg:col-span-3 space-y-4">
            {/* Provider Header */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>{selectedProvider.full_name}</CardTitle>
                    <p className="text-sm text-gray-600">{selectedProvider.email}</p>
                  </div>
                  <Badge variant="secondary">{selectedProvider.provider_type}</Badge>
                </div>
              </CardHeader>
            </Card>

            {/* Tabs */}
            <div className="border-b border-gray-200">
              <div className="flex gap-4">
                {['permissions', 'patients', 'facilities'].map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-4 py-2 font-medium border-b-2 transition ${
                      activeTab === tab
                        ? 'border-blue-600 text-blue-600'
                        : 'border-transparent text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* Permissions Tab */}
            {activeTab === 'permissions' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-gray-900">Custom Permissions</h4>
                  <Button size="sm" onClick={() => setShowAddPermission(true)}>
                    <Plus className="w-4 h-4 mr-2" />
                    Add Permission
                  </Button>
                </div>

                <div className="space-y-2">
                  {permissions.length === 0 ? (
                    <p className="text-sm text-gray-600 py-4">No custom permissions. Using role defaults.</p>
                  ) : (
                    permissions.map((perm) => (
                      <Card key={perm.id} className="border-l-4 border-l-blue-500">
                        <CardContent className="pt-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="flex items-center gap-2">
                                {perm.is_allowed ? (
                                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                                ) : (
                                  <XCircle className="w-4 h-4 text-red-600" />
                                )}
                                <span className="font-medium">{perm.permission_name}</span>
                                <Badge variant="outline" className="text-xs">
                                  {perm.permission_category}
                                </Badge>
                              </div>
                              <p className="text-sm text-gray-600 mt-1">
                                {perm.notes || 'No notes'}
                              </p>
                              {perm.expiration_date && (
                                <p className="text-xs text-amber-600 mt-1">
                                  Expires: {new Date(perm.expiration_date).toLocaleDateString()}
                                </p>
                              )}
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDeletePermission(perm.id)}
                            >
                              <Trash2 className="w-4 h-4 text-red-600" />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* Patients Tab */}
            {activeTab === 'patients' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-gray-900">Assigned Patients</h4>
                  <Button size="sm">
                    <Plus className="w-4 h-4 mr-2" />
                    Assign Patient
                  </Button>
                </div>

                <div className="space-y-2">
                  {patientAssignments.length === 0 ? (
                    <p className="text-sm text-gray-600 py-4">No patient assignments.</p>
                  ) : (
                    patientAssignments.map((assignment) => (
                      <Card key={assignment.id}>
                        <CardContent className="pt-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-medium">Patient ID: {assignment.patient_id}</p>
                              <div className="flex gap-2 mt-2">
                                <Badge>{assignment.assignment_type}</Badge>
                                <Badge variant="outline">{assignment.access_level}</Badge>
                                {!assignment.is_active && (
                                  <Badge variant="destructive">Inactive</Badge>
                                )}
                              </div>
                              {assignment.end_date && (
                                <p className="text-xs text-gray-600 mt-2">
                                  End: {new Date(assignment.end_date).toLocaleDateString()}
                                </p>
                              )}
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDeletePatientAssignment(assignment.id)}
                            >
                              <Trash2 className="w-4 h-4 text-red-600" />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* Facilities Tab */}
            {activeTab === 'facilities' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-gray-900">Facility Assignments</h4>
                  <Button size="sm">
                    <Plus className="w-4 h-4 mr-2" />
                    Add Facility
                  </Button>
                </div>

                <div className="space-y-2">
                  {facilityAssignments.length === 0 ? (
                    <p className="text-sm text-gray-600 py-4">No facility assignments.</p>
                  ) : (
                    facilityAssignments.map((facility) => (
                      <Card key={facility.id}>
                        <CardContent className="pt-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-medium">{facility.facility_name}</p>
                              <div className="flex gap-2 mt-2">
                                {facility.is_primary_facility && (
                                  <Badge className="bg-purple-100 text-purple-900">Primary</Badge>
                                )}
                                {facility.supervision_permissions?.can_supervise && (
                                  <Badge className="bg-amber-100 text-amber-900">Supervisor</Badge>
                                )}
                                {!facility.is_active && (
                                  <Badge variant="destructive">Inactive</Badge>
                                )}
                              </div>
                              {facility.departments?.length > 0 && (
                                <p className="text-xs text-gray-600 mt-2">
                                  Depts: {facility.departments.join(', ')}
                                </p>
                              )}
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                            >
                              <Edit2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="lg:col-span-3 flex items-center justify-center p-12 border rounded-lg bg-gray-50">
            <p className="text-gray-600">Select a provider to manage permissions</p>
          </div>
        )}
      </div>
    </div>
  );
}