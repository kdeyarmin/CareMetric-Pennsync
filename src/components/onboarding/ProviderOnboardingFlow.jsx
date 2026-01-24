import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { toast } from "sonner";
import { CheckCircle, ArrowRight, ArrowLeft, AlertCircle, Loader2 } from "lucide-react";

const STEPS = [
  { id: 1, title: "Professional Information", description: "Your credentials and role" },
  { id: 2, title: "Practice Details", description: "Where and how you work" },
  { id: 3, title: "Agency Connection", description: "Link to your organization" },
  { id: 4, title: "Goals & Preferences", description: "Customize your experience" }
];

export default function ProviderOnboardingFlow({ currentUser, onComplete }) {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState({});

  const [formData, setFormData] = useState({
    // Step 1: Professional Information
    credential_type: currentUser?.credential_type || "",
    credentials: currentUser?.credentials || "",
    license_number: "",
    license_state: "",
    npi_number: "",
    
    // Step 2: Practice Details
    service_type: currentUser?.service_type || "",
    care_scope: currentUser?.care_scope || "",
    specializations: [],
    years_experience: "",
    phone: currentUser?.phone || "",
    
    // Step 3: Agency Connection
    agency_code: "",
    skip_agency: false,
    
    // Step 4: Goals & Preferences
    onboarding_goals: [],
    preferred_language: "en-US",
    ai_assistance_level: "balanced"
  });

  const validateStep = (step) => {
    const newErrors = {};

    if (step === 1) {
      if (!formData.credential_type) newErrors.credential_type = "Provider type is required";
      if (!formData.credentials) newErrors.credentials = "Credentials are required";
      if (!formData.license_state) newErrors.license_state = "License state is required";
    }

    if (step === 2) {
      if (!formData.service_type) newErrors.service_type = "Service type is required";
      if (!formData.care_scope) newErrors.care_scope = "Care scope is required";
      if (!formData.phone) newErrors.phone = "Phone number is required";
      if (!formData.years_experience) newErrors.years_experience = "Experience is required";
    }

    if (step === 3) {
      if (!formData.skip_agency && !formData.agency_code) {
        // Agency code is optional, just warn
      }
    }

    if (step === 4) {
      if (formData.onboarding_goals.length === 0) {
        newErrors.onboarding_goals = "Select at least one goal";
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = () => {
    if (validateStep(currentStep)) {
      if (currentStep < STEPS.length) {
        setCurrentStep(currentStep + 1);
      } else {
        handleComplete();
      }
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
      setErrors({});
    }
  };

  const handleComplete = async () => {
    setIsSubmitting(true);
    try {
      // Update user profile
      await base44.auth.updateMe({
        credential_type: formData.credential_type,
        credentials: formData.credentials,
        service_type: formData.service_type,
        care_scope: formData.care_scope,
        phone: formData.phone,
        preferred_language: formData.preferred_language,
        onboarding_completed: true,
        onboarding_goals: formData.onboarding_goals
      });

      // Save provider practice info if applicable
      if (!['RN', 'LPN', 'THERAPIST'].includes(formData.credential_type)) {
        try {
          await base44.entities.ProviderPracticeInfo.create({
            user_email: currentUser.email,
            credential_type: formData.credential_type,
            license_number: formData.license_number,
            license_state: formData.license_state,
            npi_number: formData.npi_number,
            years_experience: parseInt(formData.years_experience) || 0,
            specializations: formData.specializations
          });
        } catch (e) {
          console.error('Error saving practice info:', e);
        }
      }

      // Join agency if code provided
      if (formData.agency_code && !formData.skip_agency) {
        try {
          const { joinAgency } = await import('@/functions/joinAgency');
          await joinAgency({ agency_code: formData.agency_code });
        } catch (e) {
          console.error('Error joining agency:', e);
          toast.error('Could not join agency with provided code');
        }
      }

      toast.success('Welcome to CareMetric AI! Your profile is complete.');
      
      if (onComplete) {
        onComplete();
      } else {
        navigate(createPageUrl('Dashboard'));
      }
    } catch (error) {
      console.error('Error completing onboarding:', error);
      toast.error('Failed to complete onboarding. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateField = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: undefined }));
    }
  };

  const toggleGoal = (goal) => {
    const current = formData.onboarding_goals;
    const updated = current.includes(goal)
      ? current.filter(g => g !== goal)
      : [...current, goal];
    updateField('onboarding_goals', updated);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 dark:from-slate-900 dark:to-slate-800 p-4">
      <div className="max-w-3xl mx-auto py-8">
        {/* Progress Bar */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            {STEPS.map((step, idx) => (
              <React.Fragment key={step.id}>
                <div className="flex flex-col items-center">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold ${
                    step.id < currentStep ? 'bg-green-500 text-white' :
                    step.id === currentStep ? 'bg-blue-600 text-white' :
                    'bg-slate-200 text-slate-500'
                  }`}>
                    {step.id < currentStep ? <CheckCircle className="w-5 h-5" /> : step.id}
                  </div>
                  <span className={`text-xs mt-1 text-center max-w-[80px] ${
                    step.id === currentStep ? 'text-blue-600 font-medium' : 'text-slate-500'
                  }`}>
                    {step.title}
                  </span>
                </div>
                {idx < STEPS.length - 1 && (
                  <div className={`flex-1 h-1 mx-2 ${
                    step.id < currentStep ? 'bg-green-500' : 'bg-slate-200'
                  }`} />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Step Content */}
        <Card>
          <CardHeader>
            <CardTitle>{STEPS[currentStep - 1].title}</CardTitle>
            <CardDescription>{STEPS[currentStep - 1].description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Step 1: Professional Information */}
            {currentStep === 1 && (
              <>
                <div>
                  <Label htmlFor="credential_type">Provider Type *</Label>
                  <Select value={formData.credential_type} onValueChange={(v) => updateField('credential_type', v)}>
                    <SelectTrigger className={errors.credential_type ? 'border-red-500' : ''}>
                      <SelectValue placeholder="Select your role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="RN">RN (Registered Nurse)</SelectItem>
                      <SelectItem value="LPN">LPN (Licensed Practical Nurse)</SelectItem>
                      <SelectItem value="NP">NP (Nurse Practitioner)</SelectItem>
                      <SelectItem value="Physician">Physician (MD/DO)</SelectItem>
                      <SelectItem value="PT">PT (Physical Therapist)</SelectItem>
                      <SelectItem value="OT">OT (Occupational Therapist)</SelectItem>
                      <SelectItem value="ST">ST (Speech Therapist)</SelectItem>
                      <SelectItem value="MSW">MSW (Medical Social Worker)</SelectItem>
                      <SelectItem value="Chiropractor">Chiropractor</SelectItem>
                      <SelectItem value="Other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                  {errors.credential_type && <p className="text-xs text-red-600 mt-1">{errors.credential_type}</p>}
                </div>

                <div>
                  <Label htmlFor="credentials">Professional Credentials *</Label>
                  <Input
                    id="credentials"
                    value={formData.credentials}
                    onChange={(e) => updateField('credentials', e.target.value)}
                    placeholder="e.g., RN, BSN, CCRN"
                    className={errors.credentials ? 'border-red-500' : ''}
                  />
                  {errors.credentials && <p className="text-xs text-red-600 mt-1">{errors.credentials}</p>}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="license_number">License Number</Label>
                    <Input
                      id="license_number"
                      value={formData.license_number}
                      onChange={(e) => updateField('license_number', e.target.value)}
                      placeholder="License #"
                    />
                  </div>
                  <div>
                    <Label htmlFor="license_state">License State *</Label>
                    <Input
                      id="license_state"
                      value={formData.license_state}
                      onChange={(e) => updateField('license_state', e.target.value.toUpperCase())}
                      placeholder="e.g., NY"
                      maxLength={2}
                      className={errors.license_state ? 'border-red-500' : ''}
                    />
                    {errors.license_state && <p className="text-xs text-red-600 mt-1">{errors.license_state}</p>}
                  </div>
                </div>

                <div>
                  <Label htmlFor="npi_number">NPI Number (if applicable)</Label>
                  <Input
                    id="npi_number"
                    value={formData.npi_number}
                    onChange={(e) => updateField('npi_number', e.target.value)}
                    placeholder="10-digit NPI"
                    maxLength={10}
                  />
                </div>
              </>
            )}

            {/* Step 2: Practice Details */}
            {currentStep === 2 && (
              <>
                <div>
                  <Label htmlFor="service_type">Primary Work Setting *</Label>
                  <Select value={formData.service_type} onValueChange={(v) => updateField('service_type', v)}>
                    <SelectTrigger className={errors.service_type ? 'border-red-500' : ''}>
                      <SelectValue placeholder="Select work setting" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="home_health">🏠 Home Health</SelectItem>
                      <SelectItem value="hospice">🕊️ Hospice</SelectItem>
                      <SelectItem value="hospital">🏥 Hospital</SelectItem>
                      <SelectItem value="clinic">🏢 Clinic / Outpatient</SelectItem>
                      <SelectItem value="rehab">🔄 Rehabilitation Facility</SelectItem>
                      <SelectItem value="ltc">🏛️ Long-Term Care</SelectItem>
                      <SelectItem value="assisted_living">🏘️ Assisted Living</SelectItem>
                      <SelectItem value="behavioral_health">🧠 Behavioral Health</SelectItem>
                      <SelectItem value="school_based">🎓 School-Based Services</SelectItem>
                      <SelectItem value="other">📍 Other</SelectItem>
                    </SelectContent>
                  </Select>
                  {errors.service_type && <p className="text-xs text-red-600 mt-1">{errors.service_type}</p>}
                </div>

                <div>
                  <Label htmlFor="care_scope">Care Scope *</Label>
                  <Select value={formData.care_scope} onValueChange={(v) => updateField('care_scope', v)}>
                    <SelectTrigger className={errors.care_scope ? 'border-red-500' : ''}>
                      <SelectValue placeholder="Select care scope" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="home_health">Home Health Only</SelectItem>
                      <SelectItem value="hospice">Hospice Only</SelectItem>
                      <SelectItem value="both">Both Home Health & Hospice</SelectItem>
                    </SelectContent>
                  </Select>
                  {errors.care_scope && <p className="text-xs text-red-600 mt-1">{errors.care_scope}</p>}
                </div>

                <div>
                  <Label htmlFor="years_experience">Years of Experience *</Label>
                  <Select value={formData.years_experience} onValueChange={(v) => updateField('years_experience', v)}>
                    <SelectTrigger className={errors.years_experience ? 'border-red-500' : ''}>
                      <SelectValue placeholder="Select experience" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0-1">Less than 1 year</SelectItem>
                      <SelectItem value="1-3">1-3 years</SelectItem>
                      <SelectItem value="3-5">3-5 years</SelectItem>
                      <SelectItem value="5-10">5-10 years</SelectItem>
                      <SelectItem value="10+">10+ years</SelectItem>
                    </SelectContent>
                  </Select>
                  {errors.years_experience && <p className="text-xs text-red-600 mt-1">{errors.years_experience}</p>}
                </div>

                <div>
                  <Label htmlFor="phone">Phone Number *</Label>
                  <Input
                    id="phone"
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => updateField('phone', e.target.value)}
                    placeholder="+1234567890"
                    className={errors.phone ? 'border-red-500' : ''}
                  />
                  <p className="text-xs text-slate-500 mt-1">Include country code (e.g., +1 for US)</p>
                  {errors.phone && <p className="text-xs text-red-600 mt-1">{errors.phone}</p>}
                </div>
              </>
            )}

            {/* Step 3: Agency Connection */}
            {currentStep === 3 && (
              <>
                <Alert>
                  <AlertCircle className="w-4 h-4" />
                  <AlertDescription>
                    If your agency uses CareMetric AI Enterprise, enter the agency code to link your account and access shared resources.
                  </AlertDescription>
                </Alert>

                <div>
                  <Label htmlFor="agency_code">Agency Code (Optional)</Label>
                  <Input
                    id="agency_code"
                    value={formData.agency_code}
                    onChange={(e) => updateField('agency_code', e.target.value.toUpperCase())}
                    placeholder="Enter 8-character code"
                    maxLength={8}
                    disabled={formData.skip_agency}
                    className="font-mono text-lg"
                  />
                  <p className="text-xs text-slate-500 mt-1">Get this code from your agency administrator</p>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="skip_agency"
                    checked={formData.skip_agency}
                    onCheckedChange={(checked) => updateField('skip_agency', checked)}
                  />
                  <label htmlFor="skip_agency" className="text-sm text-slate-600">
                    I don't have an agency code or will add this later
                  </label>
                </div>
              </>
            )}

            {/* Step 4: Goals & Preferences */}
            {currentStep === 4 && (
              <>
                <div>
                  <Label>What are your main goals with CareMetric AI? *</Label>
                  <p className="text-xs text-slate-500 mb-3">Select all that apply</p>
                  <div className="space-y-2">
                    {[
                      { value: 'improve_documentation', label: 'Improve documentation quality' },
                      { value: 'save_time', label: 'Save time on paperwork' },
                      { value: 'compliance', label: 'Ensure compliance' },
                      { value: 'better_outcomes', label: 'Improve patient outcomes' },
                      { value: 'training', label: 'Professional development & training' },
                      { value: 'analytics', label: 'Track my performance' }
                    ].map(goal => (
                      <div key={goal.value} className="flex items-center space-x-2">
                        <Checkbox
                          id={goal.value}
                          checked={formData.onboarding_goals.includes(goal.value)}
                          onCheckedChange={() => toggleGoal(goal.value)}
                        />
                        <label htmlFor={goal.value} className="text-sm text-slate-700">
                          {goal.label}
                        </label>
                      </div>
                    ))}
                  </div>
                  {errors.onboarding_goals && <p className="text-xs text-red-600 mt-1">{errors.onboarding_goals}</p>}
                </div>

                <div>
                  <Label htmlFor="preferred_language">Preferred Language</Label>
                  <Select value={formData.preferred_language} onValueChange={(v) => updateField('preferred_language', v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en-US">🇺🇸 English (US)</SelectItem>
                      <SelectItem value="es-ES">🇪🇸 Español</SelectItem>
                      <SelectItem value="fr-FR">🇫🇷 Français</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="ai_assistance_level">AI Assistance Level</Label>
                  <Select value={formData.ai_assistance_level} onValueChange={(v) => updateField('ai_assistance_level', v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="minimal">Minimal - Only when I ask</SelectItem>
                      <SelectItem value="balanced">Balanced - Helpful suggestions</SelectItem>
                      <SelectItem value="maximum">Maximum - Proactive assistance</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            {/* Navigation Buttons */}
            <div className="flex justify-between pt-4 border-t">
              <Button
                variant="outline"
                onClick={handleBack}
                disabled={currentStep === 1 || isSubmitting}
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
              <Button
                onClick={handleNext}
                disabled={isSubmitting}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Completing...
                  </>
                ) : currentStep === STEPS.length ? (
                  <>
                    Complete Setup
                    <CheckCircle className="w-4 h-4 ml-2" />
                  </>
                ) : (
                  <>
                    Continue
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}