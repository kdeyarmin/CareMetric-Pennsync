import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { User, Edit3, Save, X, Shield, AlertTriangle } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import DataRetentionSettings from "../components/settings/DataRetentionSettings";
import ReferralCodeDisplay from "../components/referral/ReferralCodeDisplay";

export default function Settings() {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [formData, setFormData] = useState({
    full_name: '',
    credential_type: 'RN',
    service_type: 'home_health',
    preferred_language: 'en-US',
    phone_number: '',
    two_factor_enabled: false
  });

  const navigate = useNavigate();

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: async () => {
      try {
        return await base44.auth.me();
      } catch (error) {
        navigate(createPageUrl("Home"));
        return null;
      }
    },
  });

  React.useEffect(() => {
    if (currentUser) {
      setFormData({
        full_name: currentUser.full_name || '',
        credential_type: currentUser.credential_type || 'RN',
        service_type: currentUser.service_type || 'home_health',
        preferred_language: currentUser.preferred_language || 'en-US',
        phone_number: currentUser.phone_number || '',
        two_factor_enabled: currentUser.two_factor_enabled || false
      });
    }
  }, [currentUser]);

  const handleSaveProfile = async () => {
    setIsSaving(true);
    try {
      await base44.auth.updateMe({
        full_name: formData.full_name,
        credential_type: formData.credential_type,
        service_type: formData.service_type,
        preferred_language: formData.preferred_language,
        phone_number: formData.phone_number,
        two_factor_enabled: formData.two_factor_enabled
      });
      queryClient.invalidateQueries({ queryKey: ['currentUser'] });
      setIsEditing(false);
    } catch (error) {
      console.error('Error updating profile:', error);
      alert('Failed to update profile. Please try again.');
    }
    setIsSaving(false);
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== 'DELETE') {
      alert('Please type DELETE to confirm');
      return;
    }

    setIsDeleting(true);
    try {
      const { deleteAccount } = await import('@/functions/deleteAccount');
      await deleteAccount();
      // Logout and redirect
      base44.auth.logout('/');
    } catch (error) {
      console.error('Error deleting account:', error);
      alert('Failed to delete account. Please try again or contact support.');
      setIsDeleting(false);
    }
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
                        credential_type: currentUser?.credential_type || 'RN',
                        preferred_language: currentUser?.preferred_language || 'en-US'
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
                  <Label htmlFor="service_type">Service Type</Label>
                  <Select
                    value={formData.service_type}
                    onValueChange={(value) => setFormData({ ...formData, service_type: value })}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="home_health">🏥 Home Health</SelectItem>
                      <SelectItem value="hospice">🕊️ Hospice</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-gray-500 mt-1">
                    This determines which compliance standards apply to your documentation
                  </p>
                </div>
                <div>
                  <Label htmlFor="preferred_language">Preferred Language</Label>
                  <Select
                    value={formData.preferred_language}
                    onValueChange={(value) => setFormData({ ...formData, preferred_language: value })}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en-US">🇺🇸 English (US)</SelectItem>
                      <SelectItem value="es-ES">🇪🇸 Español</SelectItem>
                      <SelectItem value="fr-FR">🇫🇷 Français</SelectItem>
                      <SelectItem value="de-DE">🇩🇪 Deutsch</SelectItem>
                      <SelectItem value="it-IT">🇮🇹 Italiano</SelectItem>
                      <SelectItem value="pt-BR">🇧🇷 Português</SelectItem>
                      <SelectItem value="zh-CN">🇨🇳 中文</SelectItem>
                      <SelectItem value="ja-JP">🇯🇵 日本語</SelectItem>
                      <SelectItem value="ko-KR">🇰🇷 한국어</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-gray-500">Email (Cannot be changed)</Label>
                  <p className="text-gray-900 mt-1">{currentUser?.email}</p>
                </div>
                <div>
                  <Label htmlFor="phone_number">Phone Number (for 2FA)</Label>
                  <Input
                    id="phone_number"
                    type="tel"
                    value={formData.phone_number}
                    onChange={(e) => setFormData({ ...formData, phone_number: e.target.value })}
                    placeholder="+1234567890"
                    className="mt-1"
                  />
                  <p className="text-xs text-gray-500 mt-1">Include country code (e.g., +1 for US)</p>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Two-Factor Authentication</Label>
                    <p className="text-xs text-gray-500 mt-1">Require SMS code on login</p>
                  </div>
                  <Switch
                    checked={formData.two_factor_enabled}
                    onCheckedChange={(checked) => setFormData({ ...formData, two_factor_enabled: checked })}
                    disabled={!formData.phone_number}
                  />
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
                <div>
                  <p className="text-sm font-medium text-gray-500">Service Type</p>
                  <p className="text-gray-900">
                    {currentUser?.service_type === 'hospice' ? '🕊️ Hospice' : '🏥 Home Health'}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500">Preferred Language</p>
                  <p className="text-gray-900">
                    {currentUser?.preferred_language === 'es-ES' ? '🇪🇸 Español' :
                     currentUser?.preferred_language === 'fr-FR' ? '🇫🇷 Français' :
                     currentUser?.preferred_language === 'de-DE' ? '🇩🇪 Deutsch' :
                     currentUser?.preferred_language === 'it-IT' ? '🇮🇹 Italiano' :
                     currentUser?.preferred_language === 'pt-BR' ? '🇧🇷 Português' :
                     currentUser?.preferred_language === 'zh-CN' ? '🇨🇳 中文' :
                     currentUser?.preferred_language === 'ja-JP' ? '🇯🇵 日本語' :
                     currentUser?.preferred_language === 'ko-KR' ? '🇰🇷 한국어' :
                     '🇺🇸 English (US)'}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500">Phone Number</p>
                  <p className="text-gray-900">{currentUser?.phone_number || 'Not set'}</p>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Two-Factor Authentication */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-green-600" />
              Two-Factor Authentication
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <p className="text-gray-600">
                Two-factor authentication adds an extra layer of security to your account by requiring a verification code sent to your phone when you log in.
              </p>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <Shield className="w-5 h-5 text-blue-600 mt-0.5" />
                  <div>
                    <p className="font-semibold text-blue-900">Status: {currentUser?.two_factor_enabled ? 'Enabled' : 'Disabled'}</p>
                    {currentUser?.two_factor_enabled ? (
                      <p className="text-sm text-blue-700 mt-1">
                        You'll receive a verification code at {currentUser?.phone_number} when logging in.
                      </p>
                    ) : (
                      <p className="text-sm text-blue-700 mt-1">
                        Enable 2FA by adding your phone number and toggling the switch above.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Data Retention Settings */}
        <DataRetentionSettings />

        {/* Referral Program */}
        <ReferralCodeDisplay user={currentUser} />

        {/* Danger Zone */}
        <Card className="border-red-200">
          <CardHeader className="bg-red-50">
            <CardTitle className="flex items-center gap-2 text-red-700">
              <AlertTriangle className="w-5 h-5" />
              Danger Zone
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="space-y-4">
              <div>
                <h3 className="font-semibold text-red-900 mb-2">Delete Account</h3>
                <p className="text-sm text-gray-600 mb-4">
                  Permanently delete your account and all associated data. This action cannot be undone.
                  All patient records, visits, notes, and other data will be permanently removed.
                </p>
              </div>
              
              {!showDeleteConfirm ? (
                <Button
                  variant="destructive"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="bg-red-600 hover:bg-red-700"
                >
                  <AlertTriangle className="w-4 h-4 mr-2" />
                  Delete My Account
                </Button>
              ) : (
                <div className="border-2 border-red-200 rounded-lg p-4 bg-red-50">
                  <p className="text-sm font-semibold text-red-900 mb-3">
                    Are you absolutely sure? This action is permanent and irreversible.
                  </p>
                  <p className="text-sm text-gray-700 mb-3">
                    Type <span className="font-mono font-bold">DELETE</span> to confirm:
                  </p>
                  <Input
                    value={deleteConfirmText}
                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                    placeholder="Type DELETE"
                    className="mb-3"
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="destructive"
                      onClick={handleDeleteAccount}
                      disabled={deleteConfirmText !== 'DELETE' || isDeleting}
                      className="bg-red-600 hover:bg-red-700"
                    >
                      {isDeleting ? 'Deleting...' : 'Permanently Delete Account'}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setShowDeleteConfirm(false);
                        setDeleteConfirmText('');
                      }}
                      disabled={isDeleting}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}