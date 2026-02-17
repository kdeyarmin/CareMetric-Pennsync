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
import { toast } from "sonner";
import DataRetentionSettings from "../components/settings/DataRetentionSettings";
import ReferralCodeDisplay from "../components/referral/ReferralCodeDisplay";

import ProviderTypeSelector from "../components/settings/ProviderTypeSelector";
import AdvancedAICustomization from "../components/settings/AdvancedAICustomization";
import OfflineSyncManager from "../components/mobile/OfflineSyncManager";
import ProviderPracticeInfoManager from "../components/settings/ProviderPracticeInfoManager";
import ProviderSpecializationManager from "../components/settings/ProviderSpecializationManager";
import BiometricAuth from "../components/auth/BiometricAuth";
import SecurityAuditLog from "../components/security/SecurityAuditLog";
import AgencyCodeInput from "../components/settings/AgencyCodeInput";
import AgencyCodeManager from "../components/settings/AgencyCodeManager";
import NotificationPreferences from "../components/settings/NotificationPreferences";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
    two_factor_enabled: false,
    sending_fax_number: ''
  });

  const navigate = useNavigate();

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: async () => {
      try {
        return await base44.auth.me();
      } catch (error) {
        base44.auth.redirectToLogin();
        return null;
      }
    }
  });

  React.useEffect(() => {
    if (currentUser) {
      setFormData({
        full_name: currentUser.full_name || '',
        credential_type: currentUser.credential_type || 'RN',
        service_type: currentUser.service_type || 'home_health',
        preferred_language: currentUser.preferred_language || 'en-US',
        phone_number: currentUser.phone_number || '',
        two_factor_enabled: currentUser.two_factor_enabled || false,
        sending_fax_number: currentUser.sending_fax_number || ''
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
        two_factor_enabled: formData.two_factor_enabled,
        sending_fax_number: formData.sending_fax_number
      });

      // Sync provider type to other settings if it changed
      if (currentUser?.credential_type !== formData.credential_type) {
        try {
          await base44.functions.invoke('syncProviderType', {
            credential_type: formData.credential_type
          });
        } catch (syncError) {
          console.error('Error syncing provider type:', syncError);
        }
      }

      queryClient.invalidateQueries({ queryKey: ['currentUser'] });
      setIsEditing(false);
    } catch (error) {
      toast.error('Failed to update profile. Please try again.');
    }
    setIsSaving(false);
  };

  const handleDeleteAccount = async () => {
     if (deleteConfirmText !== 'DELETE') {
       toast.warning('Please type DELETE to confirm');
       return;
     }

     setIsDeleting(true);
     try {
       await base44.functions.invoke('deleteAccount');
       // Logout and redirect
       base44.auth.logout();
     } catch (error) {
       toast.error('Failed to delete account. Please try again or contact support.');
       setIsDeleting(false);
     }
   };

  return (
    <div className="p-3 sm:p-4 md:p-6 max-w-4xl mx-auto w-full max-w-full overflow-x-hidden min-w-0 bg-gradient-to-br from-slate-200 via-blue-100 to-slate-300 pb-20 sm:pb-6">
      <div className="mb-3 sm:mb-4 md:mb-6">
         <h1 className="text-lg sm:text-xl md:text-2xl lg:text-3xl font-bold text-slate-900 dark:text-slate-100 mb-1 sm:mb-2">Settings</h1>
          <p className="text-xs sm:text-sm md:text-base text-slate-600 dark:text-slate-400">Manage account and preferences</p>
       </div>

      <Tabs defaultValue="profile" className="w-full">
         <div className="w-full overflow-x-auto mb-3 sm:mb-4 md:mb-6">
           <TabsList className="grid w-max min-w-full grid-cols-2 sm:grid-cols-4 gap-1 p-1">
             <TabsTrigger value="profile" className="text-[10px] sm:text-xs md:text-sm px-2 sm:px-3">Profile</TabsTrigger>
             <TabsTrigger value="notifications" className="text-[10px] sm:text-xs md:text-sm px-2 sm:px-3">Alerts</TabsTrigger>
             <TabsTrigger value="security" className="text-[10px] sm:text-xs md:text-sm px-2 sm:px-3">Security</TabsTrigger>
             <TabsTrigger value="advanced" className="text-[10px] sm:text-xs md:text-sm px-2 sm:px-3">Advanced</TabsTrigger>
           </TabsList>
         </div>

         <TabsContent value="profile" className="space-y-3 sm:space-y-4 md:space-y-6 w-full max-w-full overflow-x-hidden min-w-0">
        {/* Profile Info */}
        <Card className="w-full max-w-full overflow-hidden">
          <CardHeader className="bg-slate-200 p-3 sm:p-4 md:p-6 flex flex-col space-y-1.5">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-3">
              <CardTitle className="flex items-center gap-2 text-xs sm:text-sm md:text-base lg:text-lg text-slate-900 dark:text-slate-100">
                <User className="w-4 h-4 sm:w-5 sm:h-5 text-slate-700 dark:text-slate-400" />
                Profile Information
              </CardTitle>
              {!isEditing ?
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsEditing(true)}
                className="gap-2 min-h-[44px] w-full sm:w-auto">

                  <Edit3 className="w-4 h-4" />
                  Edit Profile
                </Button> :

              <div className="flex gap-2 w-full sm:w-auto">
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
                      disabled={isSaving}>

                        <X className="w-4 h-4" />
                      </Button>
                  <Button
                  size="sm"
                  onClick={handleSaveProfile}
                  disabled={isSaving} className="bg-blue-600 hover:bg-blue-700 text-white">


                    <Save className="w-4 h-4" />
                    {isSaving ? 'Saving...' : 'Save'}
                  </Button>
                </div>
              }
            </div>
          </CardHeader>
          <CardContent className="bg-gradient-to-r from-blue-50/40 to-slate-50/40 dark:from-slate-800/20 dark:to-slate-900/20 pt-0 p-3 sm:p-4 md:p-6 space-y-3 sm:space-y-4">
            {isEditing ?
            <>
                <div>
                  <Label htmlFor="full_name" className="text-sm sm:text-base">Full Name</Label>
                  <Input
                  id="full_name"
                  value={formData.full_name}
                  onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                  placeholder="Enter your full name"
                  className="mt-1 h-11 sm:h-12 text-base" />

                </div>
                <div>
                   <Label htmlFor="credential_type">Provider Type</Label>
                   <Select
                  value={formData.credential_type}
                  onValueChange={(value) => setFormData({ ...formData, credential_type: value })}>

                     <SelectTrigger className="mt-1">
                       <SelectValue />
                     </SelectTrigger>
                     <SelectContent>
                       <SelectItem value="RN">RN (Registered Nurse)</SelectItem>
                       <SelectItem value="LPN">LPN (Licensed Practical Nurse)</SelectItem>
                       <SelectItem value="NP">NP (Nurse Practitioner)</SelectItem>
                       <SelectItem value="PHYSICIAN">Physician (MD/DO)</SelectItem>
                       <SelectItem value="THERAPIST">Therapist (PT/OT/ST)</SelectItem>
                       <SelectItem value="MSW">MSW (Medical Social Worker)</SelectItem>
                       <SelectItem value="Chiropractor">Chiropractor</SelectItem>
                     </SelectContent>
                   </Select>
                 </div>
                <div>
                   <Label htmlFor="service_type">Service Type / Work Setting</Label>
                   <Select
                  value={formData.service_type}
                  onValueChange={(value) => setFormData({ ...formData, service_type: value })}>

                     <SelectTrigger className="mt-1">
                       <SelectValue />
                     </SelectTrigger>
                     <SelectContent>
                       <SelectItem value="home_health">🏠 Home Health</SelectItem>
                       <SelectItem value="hospice">🕊️ Hospice</SelectItem>
                       <SelectItem value="hospital">🏥 Hospital</SelectItem>
                       <SelectItem value="clinic">🏢 Clinic / Outpatient</SelectItem>
                       <SelectItem value="rehab">🔄 Rehabilitation Facility</SelectItem>
                       <SelectItem value="ltc">🏛️ Long-Term Care / Skilled Nursing</SelectItem>
                       <SelectItem value="assisted_living">🏘️ Assisted Living</SelectItem>
                       <SelectItem value="behavioral_health">🧠 Behavioral Health / Mental Health</SelectItem>
                       <SelectItem value="school_based">🎓 School-Based Services</SelectItem>
                       <SelectItem value="other">📍 Other</SelectItem>
                     </SelectContent>
                   </Select>
                   <p className="text-xs text-gray-500 mt-1">
                     This determines which compliance standards and documentation guidelines apply
                   </p>
                 </div>
                <div>
                  <Label htmlFor="preferred_language">Preferred Language</Label>
                  <Select
                  value={formData.preferred_language}
                  onValueChange={(value) => setFormData({ ...formData, preferred_language: value })}>

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
                  <Label className="text-slate-600 dark:text-slate-400">Email (Cannot be changed)</Label>
                  <p className="text-slate-900 dark:text-slate-100 mt-1">{currentUser?.email}</p>
                </div>
                {currentUser?.role === 'admin' &&
              <div>
                    <Label htmlFor="role">Role (Admin Testing Only)</Label>
                    <Select
                  value={currentUser?.role}
                  onValueChange={async (value) => {
                    try {
                      await base44.auth.updateMe({ role: value });
                      queryClient.invalidateQueries({ queryKey: ['currentUser'] });
                      window.location.reload();
                    } catch (error) {
                      alert('Failed to update role');
                    }
                  }}>

                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="user">User</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-amber-600 mt-1">⚠️ Admin testing: Switch roles to test different permissions</p>
                  </div>
              }
                <div>
                  <Label htmlFor="phone_number">Phone Number (for 2FA)</Label>
                  <Input
                  id="phone_number"
                  type="tel"
                  value={formData.phone_number}
                  onChange={(e) => setFormData({ ...formData, phone_number: e.target.value })}
                  placeholder="+1234567890"
                  className="mt-1" />

                  <p className="text-xs text-gray-500 mt-1">Include country code (e.g., +1 for US)</p>
                </div>
                <div>
                  <Label htmlFor="sending_fax_number">Outgoing Fax Number</Label>
                  <Input
                    id="sending_fax_number"
                    type="tel"
                    value={formData.sending_fax_number}
                    onChange={(e) => setFormData({ ...formData, sending_fax_number: e.target.value })}
                    placeholder="+15551234567"
                    className="mt-1" />
                  <p className="text-xs text-gray-500 mt-1">This number will appear as the sender on your faxes</p>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Two-Factor Authentication</Label>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      {currentUser?.data_retention_preference === 'save' ?
                    'Automatically enabled when saving patient data' :
                    'Require SMS code on login'}
                    </p>
                  </div>
                  <Switch
                  checked={formData.two_factor_enabled}
                  onCheckedChange={(checked) => setFormData({ ...formData, two_factor_enabled: checked })}
                  disabled={!formData.phone_number || currentUser?.data_retention_preference === 'save'} />

                </div>
              </> :

            <>
                <div>
                  <p className="text-sm font-medium text-slate-600 dark:text-slate-400">Name</p>
                   <p className="text-slate-900 dark:text-slate-100">{currentUser?.full_name}</p>
                  </div>
                  <div>
                   <p className="text-sm font-medium text-slate-600 dark:text-slate-400">Email</p>
                   <p className="text-slate-900 dark:text-slate-100">{currentUser?.email}</p>
                  </div>
                  <div>
                   <p className="text-sm font-medium text-slate-600 dark:text-slate-400">Provider Type</p>
                   <p className="text-slate-900 dark:text-slate-100">{currentUser?.credential_type || 'RN'}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-600 dark:text-slate-400">Service Type</p>
                    <p className="text-slate-900 dark:text-slate-100">
                     {currentUser?.service_type === 'hospice' ? '🕊️ Hospice' :
                  currentUser?.service_type === 'hospital' ? '🏥 Hospital' :
                  currentUser?.service_type === 'clinic' ? '🏢 Clinic / Outpatient' :
                  currentUser?.service_type === 'rehab' ? '🔄 Rehabilitation Facility' :
                  currentUser?.service_type === 'ltc' ? '🏛️ Long-Term Care / Skilled Nursing' :
                  currentUser?.service_type === 'assisted_living' ? '🏘️ Assisted Living' :
                  currentUser?.service_type === 'behavioral_health' ? '🧠 Behavioral Health / Mental Health' :
                  currentUser?.service_type === 'school_based' ? '🎓 School-Based Services' :
                  currentUser?.service_type === 'other' ? '📍 Other' :
                  '🏠 Home Health'}
                   </p>
                 </div>
                <div>
                  <p className="text-sm font-medium text-slate-600 dark:text-slate-400">Preferred Language</p>
                  <p className="text-slate-900 dark:text-slate-100">
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
                  <p className="text-sm font-medium text-slate-600 dark:text-slate-400">Phone Number</p>
                  <p className="text-slate-900 dark:text-slate-100">{currentUser?.phone_number || 'Not set'}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-600 dark:text-slate-400">Outgoing Fax Number</p>
                  <p className="text-slate-900 dark:text-slate-100">{currentUser?.sending_fax_number || 'Not set'}</p>
                </div>
              </>
            }
          </CardContent>
        </Card>

        {/* Two-Factor Authentication */}
        <Card className="w-full max-w-full overflow-hidden">
          <CardHeader className="bg-gradient-to-r from-blue-100/60 to-slate-100/60 dark:from-slate-800/40 dark:to-slate-900/30 p-3 sm:p-4 md:p-6 flex flex-col space-y-1.5">
            <CardTitle className="flex items-center gap-2 text-xs sm:text-sm md:text-base text-slate-900 dark:text-slate-100">
              <Shield className="w-4 h-4 sm:w-5 sm:h-5 text-slate-700 dark:text-slate-400" />
              Two-Factor Authentication
            </CardTitle>
          </CardHeader>
          <CardContent className="bg-gradient-to-r from-blue-50/40 to-slate-50/40 dark:from-slate-800/20 dark:to-slate-900/20 pt-0 p-3 sm:p-4 md:p-6">
            <div className="space-y-3 sm:space-y-4">
              <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">
                Two-factor authentication adds an extra layer of security to your account by requiring a verification code sent to your phone when you log in.
              </p>
              <div className="bg-gradient-to-r from-blue-50/60 to-slate-50/60 dark:from-slate-800/40 dark:to-slate-900/30 border border-slate-300 dark:border-slate-600 rounded-lg p-4">
               <div className="flex items-start gap-3">
                  <Shield className="w-5 h-5 text-slate-700 dark:text-slate-400 mt-0.5" />
                  <div>
                    <p className="font-semibold text-slate-900 dark:text-slate-100">Status: {currentUser?.two_factor_enabled ? 'Enabled' : 'Disabled'}</p>
                    {currentUser?.two_factor_enabled ?
                    <p className="text-sm text-slate-800 dark:text-slate-200 mt-1">
                        You'll receive a verification code at {currentUser?.phone_number} when logging in.
                      </p> :

                    <p className="text-sm text-slate-800 dark:text-slate-200 mt-1">
                        Enable 2FA by adding your phone number and toggling the switch above.
                      </p>
                    }
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Referral Program */}
        <ReferralCodeDisplay user={currentUser} />
        </TabsContent>

        <TabsContent value="notifications" className="space-y-3 sm:space-y-4 md:space-y-6">
           <NotificationPreferences currentUser={currentUser} />
         </TabsContent>

         <TabsContent value="security" className="space-y-3 sm:space-y-4 md:space-y-6">
          {/* Two-Factor Authentication */}
          <Card className="w-full max-w-full overflow-hidden">
            <CardHeader className="bg-gradient-to-r from-blue-100/60 to-slate-100/60 dark:from-slate-800/40 dark:to-slate-900/30 p-3 sm:p-4 md:p-6 flex flex-col space-y-1.5">
              <CardTitle className="flex items-center gap-2 text-xs sm:text-sm md:text-base text-slate-900 dark:text-slate-100">
                <Shield className="w-4 h-4 sm:w-5 sm:h-5 text-slate-700 dark:text-slate-400" />
                Two-Factor Authentication
              </CardTitle>
            </CardHeader>
            <CardContent className="bg-slate-100 pt-0 p-3 sm:p-4 md:p-6">
              <div className="space-y-3 sm:space-y-4">
                <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">
                  Two-factor authentication adds an extra layer of security to your account by requiring a verification code sent to your phone when you log in.
                </p>
                <div className="bg-gradient-to-r from-blue-50/60 to-slate-50/60 dark:from-slate-800/40 dark:to-slate-900/30 border border-slate-300 dark:border-slate-600 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <Shield className="w-5 h-5 text-slate-700 dark:text-slate-400 mt-0.5" />
                    <div>
                      <p className="font-semibold text-slate-900 dark:text-slate-100">Status: {currentUser?.two_factor_enabled ? 'Enabled' : 'Disabled'}</p>
                      {currentUser?.two_factor_enabled ? (
                        <p className="text-sm text-slate-800 dark:text-slate-200 mt-1">
                          You'll receive a verification code at {currentUser?.phone_number} when logging in.
                        </p>
                      ) : (
                        <p className="text-sm text-slate-800 dark:text-slate-200 mt-1">
                          Enable 2FA in your profile settings by adding your phone number.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Biometric Authentication */}
          {currentUser?.email && (
            <BiometricAuth 
              userEmail={currentUser.email}
              onAuthSuccess={() => toast.success('Biometric login successful!')}
            />
          )}

          {/* Security Audit Log */}
          {currentUser?.email && (
            <SecurityAuditLog userEmail={currentUser.email} />
          )}

          {/* Data Retention Settings */}
          <DataRetentionSettings />
        </TabsContent>

        <TabsContent value="advanced" className="space-y-3 sm:space-y-4 md:space-y-6">
          {/* Provider Profile */}
          <ProviderTypeSelector currentUser={currentUser} allowAdminOverride={currentUser?.role === 'admin'} />

          {/* Advanced AI Customization */}
          <AdvancedAICustomization currentUser={currentUser} />

          {/* Agency Code Manager */}
          <AgencyCodeManager currentUser={currentUser} />

          {/* Offline Sync Manager */}
          <OfflineSyncManager />

          {/* Professional Specializations - Only for Physicians */}
          {currentUser && currentUser.credential_type === 'PHYSICIAN' && (
            <ProviderSpecializationManager currentUser={currentUser} />
          )}

          {/* Practice Information */}
          {currentUser && !['RN', 'LPN', 'THERAPIST'].includes(currentUser.credential_type) && (
            <ProviderPracticeInfoManager userEmail={currentUser.email} credentialType={currentUser.credential_type} />
          )}

          {/* Danger Zone */}
          <Card className="border-slate-300 dark:border-slate-600 w-full max-w-full overflow-hidden">
           <CardHeader className="bg-gradient-to-r from-red-100/40 to-slate-100/40 dark:from-red-900/20 dark:to-slate-900/30 p-3 sm:p-4 md:p-6">
             <CardTitle className="flex items-center gap-2 text-slate-900 dark:text-slate-100 text-xs sm:text-sm md:text-base lg:text-lg">
              <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5" />
              Danger Zone
            </CardTitle>
           </CardHeader>
           <CardContent className="bg-gradient-to-r from-red-50/30 to-slate-50/30 dark:from-red-900/10 dark:to-slate-900/20 pt-3 sm:pt-4 p-3 sm:p-4 md:p-6">
            <div className="space-y-3">
              <div>
                <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-2 text-sm sm:text-base">Delete Account</h3>
                 <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                  Permanently delete your account and all associated data. This action cannot be undone.
                  All patient records, visits, notes, and other data will be permanently removed.
                </p>
              </div>
              
              {!showDeleteConfirm ?
              <Button
                variant="destructive"
                onClick={() => setShowDeleteConfirm(true)} className="bg-red-600 text-white px-4 py-2 text-sm font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 shadow-sm h-9 hover:bg-slate-700 dark:bg-slate-500 dark:hover:bg-slate-600 min-h-[44px] w-full sm:w-auto">


                  <AlertTriangle className="w-4 h-4 mr-2" />
                  Delete My Account
                </Button> :

              <div className="border-2 border-red-200 rounded-lg p-3 sm:p-4 bg-red-50">
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
                    Are you absolutely sure? This action is permanent and irreversible.
                  </p>
                  <p className="text-sm text-slate-700 dark:text-slate-300 mb-3">
                    Type <span className="font-mono font-bold">DELETE</span> to confirm:
                  </p>
                  <Input
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder="Type DELETE"
                  className="mb-3" />

                  <div className="flex flex-col sm:flex-row gap-2">
                    <Button
                    variant="destructive"
                    onClick={handleDeleteAccount}
                    disabled={deleteConfirmText !== 'DELETE' || isDeleting}
                    className="bg-slate-600 hover:bg-slate-700 dark:bg-slate-500 dark:hover:bg-slate-600 min-h-[44px] text-white">

                      {isDeleting ? 'Deleting...' : 'Permanently Delete Account'}
                    </Button>
                    <Button
                    variant="outline"
                    onClick={() => {
                      setShowDeleteConfirm(false);
                      setDeleteConfirmText('');
                    }}
                    disabled={isDeleting}
                    className="min-h-[44px]">

                      Cancel
                    </Button>
                  </div>
                </div>
              }
            </div>
          </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}