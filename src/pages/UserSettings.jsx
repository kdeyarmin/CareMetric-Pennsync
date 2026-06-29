import { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Settings,
  Brain,
  Sparkles,
  Save,
  CheckCircle2,
  RotateCcw,
  FileText,
  MessageSquare,
  BookOpen,
  Heart,
  Home,
  Users,
  Trash2,
  AlertTriangle,
  Shield
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import { logSecurityEvent } from "@/components/utils/security";
import PageContainer from "@/components/ui/PageContainer";
import PersonnelCredentialForm from "@/components/personnel/PersonnelCredentialForm";
import PersonnelStatusBadge from "@/components/personnel/PersonnelStatusBadge";
import CredentialRenewalPortal from "@/components/personnel/CredentialRenewalPortal";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import CareScopeSelector from "../components/profile/CareScopeSelector";
import CareScopeBadge from "../components/profile/CareScopeBadge";
import DutyStatusCard from "../components/voice/DutyStatusCard";

export default function UserSettings() {
  const queryClient = useQueryClient();
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [showCredentialForm, setShowCredentialForm] = useState(false);
  const [editingCredential, setEditingCredential] = useState(null);
  const [profileData, setProfileData] = useState({
    full_name: '',
    phone: '',
    credential_type: '',
  });

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  useEffect(() => {
    if (currentUser) {
      setProfileData({
        full_name: currentUser.full_name || '',
        phone: currentUser.phone || '',
        credential_type: currentUser.credential_type || '',
      });
    }
  }, [currentUser]);

  const { data: existingConfig } = useQuery({
    queryKey: ['aiConfig', currentUser?.email],
    queryFn: async () => {
      // AIConfiguration is RLS-scoped to the current user's own records (created_by),
      // so no explicit user filter is needed (and AIConfiguration has no user_email field).
      const configs = await base44.entities.AIConfiguration.filter({});
      return configs[0] || null;
    },
    enabled: !!currentUser?.email,
  });

  const { data: credentials = [] } = useQuery({
    queryKey: ['personnel-credentials'],
    queryFn: () => base44.entities.PersonnelCredential.list('-expiration_date', 500),
    initialData: [],
  });

  const myCredentials = useMemo(() =>
    credentials.filter((item) => item.user_id === currentUser?.email), 
    [credentials, currentUser]
  );

  const [preferences, setPreferences] = useState({
    ai_verbosity: 'balanced',
    clinical_terminology: 'standard',
    enable_oasis_analysis: true,
    enable_auto_summarization: true,
    enable_compliance_checking: true,
    enable_care_plan_suggestions: true,
    enable_task_generation: true,
    enable_proactive_suggestions: false,
    auto_enhance_on_completion: false,
    preferred_note_style: 'narrative',
    include_assessment_details: true,
    include_teaching_points: true,
    show_confidence_scores: false
  });

  useEffect(() => {
    if (existingConfig) {
      setPreferences({
        ai_verbosity: existingConfig.ai_verbosity || 'balanced',
        clinical_terminology: existingConfig.clinical_terminology || 'standard',
        enable_oasis_analysis: existingConfig.enable_oasis_analysis ?? true,
        enable_auto_summarization: existingConfig.enable_auto_summarization ?? true,
        enable_compliance_checking: existingConfig.enable_compliance_checking ?? true,
        enable_care_plan_suggestions: existingConfig.enable_care_plan_suggestions ?? true,
        enable_task_generation: existingConfig.enable_task_generation ?? true,
        enable_proactive_suggestions: existingConfig.enable_proactive_suggestions ?? false,
        auto_enhance_on_completion: existingConfig.auto_enhance_on_completion ?? false,
        preferred_note_style: existingConfig.preferred_note_style || 'narrative',
        include_assessment_details: existingConfig.include_assessment_details ?? true,
        include_teaching_points: existingConfig.include_teaching_points ?? true,
        show_confidence_scores: existingConfig.show_confidence_scores ?? false
      });
    }
  }, [existingConfig]);

  const handleSave = async () => {
    if (!currentUser?.email) return;

    setIsSaving(true);
    try {
      // full_name is admin-set at invite time and must not be changed by the user.
      await base44.auth.updateMe({
        phone: profileData.phone,
        credential_type: profileData.credential_type,
      });

      // Update AI config
      const configData = {
        user_email: currentUser.email,
        user_name: currentUser.full_name,
        ...preferences
      };

      if (existingConfig?.id) {
        await base44.entities.AIConfiguration.update(existingConfig.id, configData);
      } else {
        await base44.entities.AIConfiguration.create(configData);
      }

      queryClient.invalidateQueries({ queryKey: ['aiConfig', currentUser.email] });
      queryClient.invalidateQueries({ queryKey: ['currentUser'] });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (error) {
      console.error('Error saving preferences:', error);
      toast.error('Failed to save preferences. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!currentUser?.email) return;
    setIsSavingProfile(true);
    try {
      // full_name is admin-set at invite time and is intentionally NOT sent here.
      await base44.auth.updateMe({
        phone: profileData.phone,
        credential_type: profileData.credential_type,
      });
      // Refetch so the field (and dashboard greeting) reflect the saved value.
      await queryClient.invalidateQueries({ queryKey: ['currentUser'] });
      toast.success('Profile saved.');
    } catch (error) {
      console.error('Error saving profile:', error);
      toast.error('Failed to save profile. Please try again.');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleReset = () => {
    setPreferences({
      ai_verbosity: 'balanced',
      clinical_terminology: 'standard',
      enable_oasis_analysis: true,
      enable_auto_summarization: true,
      enable_compliance_checking: true,
      enable_care_plan_suggestions: true,
      enable_task_generation: true,
      enable_proactive_suggestions: false,
      auto_enhance_on_completion: false,
      preferred_note_style: 'narrative',
      include_assessment_details: true,
      include_teaching_points: true,
      show_confidence_scores: false
    });
  };

  const togglePreference = (key) => {
    setPreferences(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirm !== "DELETE") return;

    setIsDeleting(true);
    try {
      // A user cannot hard-delete their own record under RLS, and clinical/PHI
      // records are subject to retention rules. Submit an audited deletion request
      // that an administrator processes, then sign the user out.
      await logSecurityEvent('ACCOUNT_DELETION_REQUESTED', {
        user_email: currentUser?.email,
        requested_at: new Date().toISOString(),
      }, 'warning');

      const admins = await base44.entities.User.filter({ role: 'admin' }).catch(() => []);
      await Promise.all((admins || []).map((admin) =>
        base44.functions.invoke('createNotification', {
          user_email: admin.email,
          title: 'Account deletion requested',
          message: `${currentUser?.full_name || currentUser?.email} has requested deletion of their account. Please review and process per your data-retention policy.`,
          type: 'system_update',
          priority: 'high',
          metadata: { requested_by: currentUser?.email },
        }).catch((e) => console.warn("Failed to notify admin of account-deletion request:", e?.message))
      ));

      toast.success('Your account deletion request has been submitted. An administrator will process it. You will be signed out now.');
      await base44.auth.logout();
    } catch (error) {
      console.error('Error requesting account deletion:', error);
      toast.error('Failed to submit account deletion request. Please contact support.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <PageContainer>
      <PageHeader
        icon={Settings}
        eyebrow="Tools"
        title="Settings & Profile"
        description="Manage your profile, credentials, and AI preferences"
        favoritePage="UserSettings"
      />

      {saveSuccess && (
        <Alert className="mb-6 bg-emerald-50 border-emerald-300">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <AlertDescription className="text-emerald-800">
            Your preferences have been saved successfully!
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="profile" className="space-y-4 sm:space-y-6">
        <TabsList>
          <TabsTrigger value="profile"><Heart /> Profile</TabsTrigger>
          <TabsTrigger value="credentials"><Shield /> Credentials</TabsTrigger>
          <TabsTrigger value="ai-behavior"><Brain /> AI</TabsTrigger>
          <TabsTrigger value="features"><Sparkles /> Features</TabsTrigger>
          <TabsTrigger value="documentation"><FileText /> Docs</TabsTrigger>
        </TabsList>

        {/* Profile / Role Tab */}
        <TabsContent value="profile" className="space-y-6">
          <DutyStatusCard />

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="w-5 h-5 text-indigo-600" />
                Profile Information
              </CardTitle>
              <CardDescription>
                Complete your profile information for compliance tracking
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-sm font-medium">Full Name</Label>
                <div className="mt-1 px-3 py-2 rounded-md border border-slate-200 bg-slate-50 text-slate-900">
                  {currentUser?.full_name || '—'}
                </div>
                <p className="mt-1 text-xs text-slate-500">Your name is set by your administrator and cannot be changed here. Contact your administrator if it needs to be corrected.</p>
              </div>
              <div>
                <Label htmlFor="phone" className="text-sm font-medium">Phone Number *</Label>
                <Input
                  id="phone"
                  type="tel"
                  placeholder="(555) 123-4567"
                  value={profileData.phone}
                  onChange={(e) => setProfileData(prev => ({ ...prev, phone: e.target.value }))}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="credential_type" className="text-sm font-medium">Credential Type *</Label>
                <Select
                  value={profileData.credential_type}
                  onValueChange={(value) => setProfileData(prev => ({ ...prev, credential_type: value }))}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select your credential" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="RN">RN - Registered Nurse</SelectItem>
                    <SelectItem value="LPN">LPN - Licensed Practical Nurse</SelectItem>
                    <SelectItem value="LVN">LVN - Licensed Vocational Nurse</SelectItem>
                    <SelectItem value="NP">NP - Nurse Practitioner</SelectItem>
                    <SelectItem value="CNS">CNS - Clinical Nurse Specialist</SelectItem>
                    <SelectItem value="PT">PT - Physical Therapist</SelectItem>
                    <SelectItem value="OT">OT - Occupational Therapist</SelectItem>
                    <SelectItem value="ST">ST - Speech Therapist</SelectItem>
                    <SelectItem value="MSW">MSW - Medical Social Worker</SelectItem>
                    <SelectItem value="HHA">HHA - Home Health Aide</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-end pt-2 border-t">
                <Button onClick={handleSaveProfile} disabled={isSavingProfile} className="min-h-[44px] bg-blue-600 hover:bg-blue-700">
                  {isSavingProfile ? (
                    <><Sparkles className="w-4 h-4 mr-2 animate-spin" /> Saving...</>
                  ) : (
                    <><Save className="w-4 h-4 mr-2" /> Save Contact Info</>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Heart className="w-5 h-5 text-indigo-600" />
                Your Care Service Line
              </CardTitle>
              <CardDescription>
                Tell us what type of nursing you do. This customizes compliance checks, documentation templates, and dashboard widgets to your specific service.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {currentUser?.care_scope && (
                <div className="mb-4 flex items-center gap-2">
                  <span className="text-sm text-slate-600">Current setting:</span>
                  <CareScopeBadge careScope={currentUser.care_scope} />
                </div>
              )}
              <CareScopeSelector
                currentUser={currentUser}
                onSaved={() => {
                  queryClient.invalidateQueries({ queryKey: ['currentUser'] });
                  toast.success('Care scope updated successfully');
                }}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="w-5 h-5 text-indigo-600" />
                Service Line Compliance Focus
              </CardTitle>
              <CardDescription>
                Key Medicare compliance requirements for your service line
              </CardDescription>
            </CardHeader>
            <CardContent>
              {(!currentUser?.care_scope || currentUser.care_scope === "home_health" || currentUser.care_scope === "both") && (
                <div className="mb-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
                  <div className="flex items-center gap-2 mb-2">
                    <Home className="w-4 h-4 text-blue-600" />
                    <p className="font-semibold text-blue-800 text-sm">Home Health Requirements</p>
                  </div>
                  <ul className="text-xs text-blue-700 space-y-1">
                    <li>• Homebound status documented every visit (42 CFR §484.55)</li>
                    <li>• Skilled need justified per Medicare coverage guidelines</li>
                    <li>• OASIS-E assessments at SOC, ROC, Recert, Discharge</li>
                    <li>• 60-day certification periods with physician signature</li>
                    <li>• Care plan updated every 60 days or with change in condition</li>
                    <li>• ICD-10 primary diagnosis supports skilled service need</li>
                  </ul>
                </div>
              )}
              {(!currentUser?.care_scope || currentUser.care_scope === "hospice" || currentUser.care_scope === "both") && (
                <div className="p-4 bg-navy-50 rounded-lg border border-navy-200">
                  <div className="flex items-center gap-2 mb-2">
                    <Heart className="w-4 h-4 text-navy-600" />
                    <p className="font-semibold text-navy-800 text-sm">Hospice Requirements</p>
                  </div>
                  <ul className="text-xs text-navy-700 space-y-1">
                    <li>• Terminal prognosis ≤6 months documented (42 CFR §418.22)</li>
                    <li>• IDG/IDT meeting documentation every 15 days at minimum</li>
                    <li>• Comfort-focused goals — curative treatments discontinued</li>
                    <li>• Symptom management notes (pain, dyspnea, nausea, anxiety)</li>
                    <li>• Medicare Benefit elections and revocations documented</li>
                    <li>• Bereavement assessment and follow-up plan</li>
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Credentials Tab */}
        <TabsContent value="credentials" className="space-y-6">
          <Tabs defaultValue="my-credentials" className="space-y-4">
            <TabsList>
              <TabsTrigger value="my-credentials">My Credentials</TabsTrigger>
              <TabsTrigger value="renewals">Renewals</TabsTrigger>
            </TabsList>

            <TabsContent value="my-credentials" className="space-y-4">
              <div className="flex justify-end">
                <Button onClick={() => { setEditingCredential(null); setShowCredentialForm(!showCredentialForm); }}>
                  {showCredentialForm ? 'Close Form' : 'Add License/Certification'}
                </Button>
              </div>

              {showCredentialForm && currentUser && (
                <Card>
                  <CardHeader>
                    <CardTitle>{editingCredential ? 'Update Credential' : 'Add License, Certification, or Insurance'}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <PersonnelCredentialForm 
                      currentUser={currentUser} 
                      existingItem={editingCredential} 
                      onDone={() => { setShowCredentialForm(false); setEditingCredential(null); }} 
                    />
                  </CardContent>
                </Card>
              )}

              <div className="space-y-4">
                {myCredentials.length === 0 ? (
                  <Card>
                    <CardContent className="p-10 text-center text-slate-500">
                      <Shield className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                      <p>No credentials uploaded yet. Add your license, certifications, and insurance.</p>
                    </CardContent>
                  </Card>
                ) : (
                  myCredentials.map((item) => (
                    <Card key={item.id}>
                      <CardContent className="p-5 flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap mb-2">
                            <h3 className="font-semibold text-slate-900">{item.title}</h3>
                            <PersonnelStatusBadge status={item.status} />
                          </div>
                          <p className="text-sm text-slate-600">
                            {item.item_type} • Expires {new Date(item.expiration_date).toLocaleDateString()}
                          </p>
                          {item.issuing_organization && (
                            <p className="text-sm text-slate-500">{item.issuing_organization}</p>
                          )}
                          {item.credential_number && (
                            <p className="text-sm text-slate-500">#{item.credential_number}</p>
                          )}
                          {item.uploaded_file_url && (
                            <a href={item.uploaded_file_url} target="_blank" rel="noreferrer" className="text-sm text-indigo-600 underline hover:text-indigo-700 mt-2 inline-block">
                              View Document
                            </a>
                          )}
                          {item.rejection_reason && (
                            <p className="text-sm text-red-600 mt-2 bg-red-50 p-2 rounded">
                              <strong>Rejected:</strong> {item.rejection_reason}
                            </p>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <Button 
                            variant="outline" 
                            onClick={() => { setEditingCredential(item); setShowCredentialForm(true); }}
                            className="min-h-[44px]"
                          >
                            Upload New Copy
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            </TabsContent>

            <TabsContent value="renewals">
              <CredentialRenewalPortal userId={currentUser?.email} />
            </TabsContent>
          </Tabs>
        </TabsContent>

        {/* AI Behavior Tab */}
        <TabsContent value="ai-behavior" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-blue-600" />
                AI Verbosity
              </CardTitle>
              <CardDescription>
                Control how much detail the AI includes in suggestions and enhancements
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-base font-medium mb-3 block">Verbosity Level</Label>
                <Select
                  value={preferences.ai_verbosity}
                  onValueChange={(value) => setPreferences(prev => ({ ...prev, ai_verbosity: value }))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="concise">
                      <div className="flex flex-col items-start">
                        <span className="font-medium">Concise</span>
                        <span className="text-xs text-slate-500">Brief, essential information only</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="balanced">
                      <div className="flex flex-col items-start">
                        <span className="font-medium">Balanced</span>
                        <span className="text-xs text-slate-500">Standard detail level (recommended)</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="detailed">
                      <div className="flex flex-col items-start">
                        <span className="font-medium">Detailed</span>
                        <span className="text-xs text-slate-500">Comprehensive documentation with full context</span>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-blue-600" />
                Clinical Terminology
              </CardTitle>
              <CardDescription>
                Choose your preferred medical terminology style
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-base font-medium mb-3 block">Terminology Style</Label>
                <Select
                  value={preferences.clinical_terminology}
                  onValueChange={(value) => setPreferences(prev => ({ ...prev, clinical_terminology: value }))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="standard">
                      <div className="flex flex-col items-start">
                        <span className="font-medium">Standard Medical</span>
                        <span className="text-xs text-slate-500">Traditional clinical terminology</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="simplified">
                      <div className="flex flex-col items-start">
                        <span className="font-medium">Simplified</span>
                        <span className="text-xs text-slate-500">Easier to understand, less jargon</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="technical">
                      <div className="flex flex-col items-start">
                        <span className="font-medium">Technical/Academic</span>
                        <span className="text-xs text-slate-500">Advanced medical terminology</span>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Features Tab */}
        <TabsContent value="features" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>AI Features</CardTitle>
              <CardDescription>
                Enable or disable specific AI capabilities in Smart Note Assistant
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FeatureToggle
                label="OASIS Analysis"
                description="AI-powered OASIS assessment suggestions and compliance checking"
                enabled={preferences.enable_oasis_analysis}
                onToggle={() => togglePreference('enable_oasis_analysis')}
                badge="Admission/Recert"
              />
              <FeatureToggle
                label="Auto Summarization"
                description="Automatically generate patient history and context summaries"
                enabled={preferences.enable_auto_summarization}
                onToggle={() => togglePreference('enable_auto_summarization')}
              />
              <FeatureToggle
                label="Compliance Checking"
                description="Real-time Medicare compliance validation and suggestions"
                enabled={preferences.enable_compliance_checking}
                onToggle={() => togglePreference('enable_compliance_checking')}
              />
              <FeatureToggle
                label="Care Plan Suggestions"
                description="AI-generated care plan recommendations based on assessments"
                enabled={preferences.enable_care_plan_suggestions}
                onToggle={() => togglePreference('enable_care_plan_suggestions')}
              />
              <FeatureToggle
                label="Task Generation"
                description="Automatically suggest follow-up tasks from visit notes"
                enabled={preferences.enable_task_generation}
                onToggle={() => togglePreference('enable_task_generation')}
              />
              <FeatureToggle
                label="Proactive Suggestions"
                description="AI offers real-time suggestions while you type (may slow typing)"
                enabled={preferences.enable_proactive_suggestions}
                onToggle={() => togglePreference('enable_proactive_suggestions')}
                badge="Experimental"
              />
              <FeatureToggle
                label="Auto-Enhance on Completion"
                description="Automatically enhance notes when you finish typing (no review step)"
                enabled={preferences.auto_enhance_on_completion}
                onToggle={() => togglePreference('auto_enhance_on_completion')}
                badge="Advanced"
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Documentation Tab */}
        <TabsContent value="documentation" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Note Formatting</CardTitle>
              <CardDescription>
                Customize how your enhanced notes are structured
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-base font-medium mb-3 block">Preferred Note Style</Label>
                <Select
                  value={preferences.preferred_note_style}
                  onValueChange={(value) => setPreferences(prev => ({ ...prev, preferred_note_style: value }))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="narrative">
                      <div className="flex flex-col items-start">
                        <span className="font-medium">Narrative</span>
                        <span className="text-xs text-slate-500">Story-like flow, paragraph format</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="soap">
                      <div className="flex flex-col items-start">
                        <span className="font-medium">SOAP Format</span>
                        <span className="text-xs text-slate-500">Subjective, Objective, Assessment, Plan</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="structured">
                      <div className="flex flex-col items-start">
                        <span className="font-medium">Structured Sections</span>
                        <span className="text-xs text-slate-500">Clear headings and bullet points</span>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="pt-4 border-t">
                <Label className="text-base font-medium mb-3 block">Content Options</Label>
                <div className="space-y-3">
                  <FeatureToggle
                    label="Include Assessment Details"
                    description="Add detailed clinical assessment observations"
                    enabled={preferences.include_assessment_details}
                    onToggle={() => togglePreference('include_assessment_details')}
                    compact
                  />
                  <FeatureToggle
                    label="Include Teaching Points"
                    description="Document patient education and teaching provided"
                    enabled={preferences.include_teaching_points}
                    onToggle={() => togglePreference('include_teaching_points')}
                    compact
                  />
                  <FeatureToggle
                    label="Show Confidence Scores"
                    description="Display AI confidence levels for suggestions (for transparency)"
                    enabled={preferences.show_confidence_scores}
                    onToggle={() => togglePreference('show_confidence_scores')}
                    compact
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row gap-3 mt-4 sm:mt-6">
        <Button
          onClick={handleSave}
          disabled={isSaving}
          className="bg-blue-600 hover:bg-blue-700 flex-1 min-h-[44px]"
        >
          {isSaving ? (
            <>
              <Sparkles className="w-4 h-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="w-4 h-4 mr-2" />
              Save Preferences
            </>
          )}
        </Button>
        <Button
          onClick={handleReset}
          variant="outline"
          className="flex-1 min-h-[44px]"
        >
          <RotateCcw className="w-4 h-4 mr-2" />
          <span className="hidden sm:inline">Reset to Defaults</span>
          <span className="sm:hidden">Reset</span>
        </Button>
      </div>

      <Alert className="mt-6 bg-blue-50 border-blue-200">
        <Sparkles className="w-4 h-4 text-blue-600" />
        <AlertDescription className="text-blue-900">
          <strong>Note:</strong> These preferences will be applied across all your Smart Note Assistant sessions and affect how AI assists you with documentation.
        </AlertDescription>
      </Alert>

      {/* Delete Account Section - Danger Zone */}
      <div className="mt-8 pt-8 border-t-2 border-red-300">
        <div className="mb-4">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-600" />
            Danger Zone
          </h2>
          <p className="text-sm text-slate-600 mt-1">Actions that cannot be undone</p>
        </div>

        <Card className="border-red-200 bg-red-50">
          <CardHeader>
            <CardTitle className="text-red-700 flex items-center gap-2">
              <Trash2 className="w-5 h-5" />
              Delete Account
            </CardTitle>
            <CardDescription className="text-red-600">
              Permanently delete your account and all associated data. This action cannot be undone.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" className="min-h-[44px]">
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete My Account
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="max-w-md">
                <AlertDialogTitle>Request Account Deletion?</AlertDialogTitle>
                <AlertDialogDescription className="space-y-3">
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                    <p className="text-sm text-red-900 font-semibold flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                      This submits a deletion request
                    </p>
                  </div>
                  <p className="text-sm text-slate-700">
                    You are about to request deletion of your PENNSync account. This action:
                  </p>
                  <ul className="text-sm text-slate-700 space-y-1 ml-4 list-disc">
                    <li>Notifies your administrators to process the deletion</li>
                    <li>Is recorded in the security audit log</li>
                    <li>Signs you out immediately</li>
                    <li>Retains clinical/PHI records per your agency's data-retention policy</li>
                  </ul>
                  <div className="pt-3 border-t">
                    <label htmlFor="delete-account-confirm" className="text-sm font-medium text-slate-900 block mb-2">
                      Type <span className="font-bold text-red-600">DELETE</span> to confirm:
                    </label>
                    <Input
                      id="delete-account-confirm"
                      type="text"
                      placeholder="Type DELETE"
                      value={deleteConfirm}
                      onChange={(e) => setDeleteConfirm(e.target.value.toUpperCase())}
                      className="font-mono text-center"
                    />
                  </div>
                </AlertDialogDescription>
                <div className="flex gap-3 justify-end">
                  <AlertDialogCancel onClick={() => setDeleteConfirm("")}>
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDeleteAccount}
                    disabled={deleteConfirm !== "DELETE" || isDeleting}
                    className="bg-red-600 hover:bg-red-700 text-white"
                  >
                    {isDeleting ? "Submitting..." : "Request Deletion"}
                  </AlertDialogAction>
                </div>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}

function FeatureToggle({ label, description, enabled, onToggle, badge, compact }) {
  return (
    <div className={`flex items-start justify-between ${compact ? 'py-2' : 'p-4'} bg-slate-50 rounded-lg border border-slate-200`}>
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <Label className="font-medium text-slate-900 cursor-pointer" onClick={onToggle}>
            {label}
          </Label>
          {badge && (
            <Badge variant="outline" className="text-xs">
              {badge}
            </Badge>
          )}
        </div>
        <p className="text-sm text-slate-600">{description}</p>
      </div>
      <button
        onClick={onToggle}
        className={`ml-4 relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
          enabled ? 'bg-blue-600' : 'bg-slate-300'
        }`}
        role="switch"
        aria-checked={enabled}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
            enabled ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}