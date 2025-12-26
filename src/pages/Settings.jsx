import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { User, Edit3, Save, X } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import DataRetentionSettings from "../components/settings/DataRetentionSettings";

export default function Settings() {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    full_name: '',
    credential_type: 'RN'
  });

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  React.useEffect(() => {
    if (currentUser) {
      setFormData({
        full_name: currentUser.full_name || '',
        credential_type: currentUser.credential_type || 'RN'
      });
    }
  }, [currentUser]);

  const handleSaveProfile = async () => {
    setIsSaving(true);
    try {
      await base44.auth.updateMe({
        full_name: formData.full_name,
        credential_type: formData.credential_type
      });
      queryClient.invalidateQueries({ queryKey: ['currentUser'] });
      setIsEditing(false);
    } catch (error) {
      console.error('Error updating profile:', error);
      alert('Failed to update profile. Please try again.');
    }
    setIsSaving(false);
  };

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Settings</h1>
        <p className="text-gray-600">Manage your account and data preferences</p>
      </div>

      <div className="space-y-6">
        {/* Profile Info */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <User className="w-5 h-5 text-blue-600" />
                Profile Information
              </CardTitle>
              {!isEditing ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsEditing(true)}
                  className="gap-2"
                >
                  <Edit3 className="w-4 h-4" />
                  Edit Profile
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setIsEditing(false);
                      setFormData({
                        full_name: currentUser?.full_name || '',
                        credential_type: currentUser?.credential_type || 'RN'
                      });
                    }}
                    disabled={isSaving}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSaveProfile}
                    disabled={isSaving}
                    className="gap-2 bg-blue-600 hover:bg-blue-700"
                  >
                    <Save className="w-4 h-4" />
                    {isSaving ? 'Saving...' : 'Save'}
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {isEditing ? (
              <>
                <div>
                  <Label htmlFor="full_name">Full Name</Label>
                  <Input
                    id="full_name"
                    value={formData.full_name}
                    onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                    placeholder="Enter your full name"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="credential_type">Credential Type</Label>
                  <Select
                    value={formData.credential_type}
                    onValueChange={(value) => setFormData({ ...formData, credential_type: value })}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="RN">RN (Registered Nurse)</SelectItem>
                      <SelectItem value="LPN">LPN (Licensed Practical Nurse)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-gray-500">Email (Cannot be changed)</Label>
                  <p className="text-gray-900 mt-1">{currentUser?.email}</p>
                </div>
              </>
            ) : (
              <>
                <div>
                  <p className="text-sm font-medium text-gray-500">Name</p>
                  <p className="text-gray-900">{currentUser?.full_name}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500">Email</p>
                  <p className="text-gray-900">{currentUser?.email}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500">Credential Type</p>
                  <p className="text-gray-900">{currentUser?.credential_type || 'RN'}</p>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Data Retention Settings */}
        <DataRetentionSettings />
      </div>
    </div>
  );
}