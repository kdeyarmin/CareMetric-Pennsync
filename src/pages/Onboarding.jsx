import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Stethoscope, Heart, UserCircle, CheckCircle2, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { createPageUrl } from "@/utils";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

export const publicPage = true;

export default function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [serviceType, setServiceType] = useState("");
  const [credentialType, setCredentialType] = useState("");

  const { data: currentUser, isLoading } = useQuery({
    queryKey: ['currentUser'],
    queryFn: async () => {
      try {
        return await base44.auth.me();
      } catch (error) {
        base44.auth.redirectToLogin(window.location.pathname);
        return null;
      }
    },
  });

  // Redirect if already completed onboarding
  useEffect(() => {
    if (currentUser?.onboarding_completed) {
      navigate(createPageUrl("Dashboard"));
    }
  }, [currentUser, navigate]);

  const completeOnboardingMutation = useMutation({
    mutationFn: async (data) => {
      await base44.auth.updateMe({
        service_type: data.serviceType,
        credential_type: data.credentialType,
        onboarding_completed: true
      });
    },
    onSuccess: () => {
      navigate(createPageUrl("Dashboard"));
    },
    onError: (error) => {
      toast.error('Failed to save your preferences. Please try again.');
    }
  });

  const handleComplete = () => {
    if (!serviceType || !credentialType) {
      toast.warning('Please complete all selections');
      return;
    }
    completeOnboardingMutation.mutate({ serviceType, credentialType });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
        <Loader2 className="w-8 h-8 animate-spin text-slate-700 dark:text-slate-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-slate-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-2xl mx-auto"
      >
        <Card className="border-2 shadow-2xl">
          <CardHeader className="text-center pb-8 pt-8">
            <div className="flex justify-center mb-4">
              <img 
                src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/694ec16e72e01b60d22f7cbf/b4b46082f_CareMetric-removebg-preview.png"
                alt="CareMetric AI Logo"
                className="w-20 h-20 object-contain"
              />
            </div>
            <CardTitle className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-2">
              Welcome to CareMetric AI! 👋
            </CardTitle>
            <p className="text-slate-600 dark:text-slate-400">
              Let's personalize your experience in just 2 quick steps
            </p>
          </CardHeader>

          <CardContent className="px-8 pb-8">
            {/* Progress Indicator */}
            <div className="flex justify-center gap-2 mb-8">
              <div className={`h-2 w-20 rounded-full ${step >= 1 ? 'bg-slate-600 dark:bg-slate-400' : 'bg-slate-300 dark:bg-slate-700'}`} />
               <div className={`h-2 w-20 rounded-full ${step >= 2 ? 'bg-slate-600 dark:bg-slate-400' : 'bg-slate-300 dark:bg-slate-700'}`} />
            </div>

            {/* Step 1: Service Type */}
            {step === 1 && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="space-y-6"
              >
                <div className="text-center mb-6">
                  <h3 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-2">
                    What's your work setting?
                  </h3>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    This determines which compliance standards and documentation guidelines apply
                  </p>
                </div>

                <div className="space-y-3 max-h-[400px] overflow-y-auto">
                  <RadioGroup value={serviceType} onValueChange={setServiceType} className="space-y-3">
                    <label
                      className={`flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all ${
                        serviceType === 'home_health' 
                          ? 'border-slate-600 dark:border-slate-400 bg-slate-200 dark:bg-slate-800 shadow-lg' 
                          : 'border-slate-300 dark:border-slate-600 hover:border-slate-400 dark:hover:border-slate-500'
                      }`}
                    >
                      <RadioGroupItem value="home_health" id="home_health" />
                      <div className="flex items-center gap-3 flex-1">
                        <div className="w-10 h-10 bg-slate-300 dark:bg-slate-600 rounded-full flex items-center justify-center flex-shrink-0">
                          <span className="text-lg">🏠</span>
                        </div>
                        <div className="text-left">
                          <p className="font-semibold text-slate-900 dark:text-slate-100">Home Health</p>
                        </div>
                      </div>
                      {serviceType === 'home_health' && <CheckCircle2 className="w-5 h-5 text-blue-600 flex-shrink-0" />}
                    </label>

                    <label
                      className={`flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all ${
                        serviceType === 'hospice' 
                          ? 'border-slate-600 dark:border-slate-400 bg-slate-200 dark:bg-slate-800 shadow-lg' 
                          : 'border-slate-300 dark:border-slate-600 hover:border-slate-400 dark:hover:border-slate-500'
                      }`}
                    >
                      <RadioGroupItem value="hospice" id="hospice" />
                      <div className="flex items-center gap-3 flex-1">
                        <div className="w-10 h-10 bg-slate-300 dark:bg-slate-600 rounded-full flex items-center justify-center flex-shrink-0">
                          <span className="text-lg">🕊️</span>
                        </div>
                        <div className="text-left">
                          <p className="font-semibold text-slate-900 dark:text-slate-100">Hospice</p>
                        </div>
                      </div>
                      {serviceType === 'hospice' && <CheckCircle2 className="w-5 h-5 text-purple-600 flex-shrink-0" />}
                    </label>

                    <label
                      className={`flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all ${
                        serviceType === 'hospital' 
                          ? 'border-slate-600 dark:border-slate-400 bg-slate-200 dark:bg-slate-800 shadow-lg' 
                          : 'border-slate-300 dark:border-slate-600 hover:border-slate-400 dark:hover:border-slate-500'
                      }`}
                    >
                      <RadioGroupItem value="hospital" id="hospital" />
                      <div className="flex items-center gap-3 flex-1">
                        <div className="w-10 h-10 bg-slate-300 dark:bg-slate-600 rounded-full flex items-center justify-center flex-shrink-0">
                          <span className="text-lg">🏥</span>
                        </div>
                        <div className="text-left">
                          <p className="font-semibold text-slate-900 dark:text-slate-100">Hospital</p>
                        </div>
                      </div>
                      {serviceType === 'hospital' && <CheckCircle2 className="w-5 h-5 text-blue-600 flex-shrink-0" />}
                    </label>

                    <label
                      className={`flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all ${
                        serviceType === 'clinic' 
                          ? 'border-slate-600 dark:border-slate-400 bg-slate-200 dark:bg-slate-800 shadow-lg' 
                          : 'border-slate-300 dark:border-slate-600 hover:border-slate-400 dark:hover:border-slate-500'
                      }`}
                    >
                      <RadioGroupItem value="clinic" id="clinic" />
                      <div className="flex items-center gap-3 flex-1">
                        <div className="w-10 h-10 bg-slate-300 dark:bg-slate-600 rounded-full flex items-center justify-center flex-shrink-0">
                          <span className="text-lg">🏢</span>
                        </div>
                        <div className="text-left">
                          <p className="font-semibold text-slate-900 dark:text-slate-100">Clinic / Outpatient</p>
                        </div>
                      </div>
                      {serviceType === 'clinic' && <CheckCircle2 className="w-5 h-5 text-blue-600 flex-shrink-0" />}
                    </label>

                    <label
                      className={`flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all ${
                        serviceType === 'rehab' 
                          ? 'border-slate-600 dark:border-slate-400 bg-slate-200 dark:bg-slate-800 shadow-lg' 
                          : 'border-slate-300 dark:border-slate-600 hover:border-slate-400 dark:hover:border-slate-500'
                      }`}
                    >
                      <RadioGroupItem value="rehab" id="rehab" />
                      <div className="flex items-center gap-3 flex-1">
                        <div className="w-10 h-10 bg-slate-300 dark:bg-slate-600 rounded-full flex items-center justify-center flex-shrink-0">
                          <span className="text-lg">🔄</span>
                        </div>
                        <div className="text-left">
                          <p className="font-semibold text-slate-900 dark:text-slate-100">Rehabilitation Facility</p>
                        </div>
                      </div>
                      {serviceType === 'rehab' && <CheckCircle2 className="w-5 h-5 text-blue-600 flex-shrink-0" />}
                    </label>

                    <label
                      className={`flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all ${
                        serviceType === 'ltc' 
                          ? 'border-slate-600 dark:border-slate-400 bg-slate-200 dark:bg-slate-800 shadow-lg' 
                          : 'border-slate-300 dark:border-slate-600 hover:border-slate-400 dark:hover:border-slate-500'
                      }`}
                    >
                      <RadioGroupItem value="ltc" id="ltc" />
                      <div className="flex items-center gap-3 flex-1">
                        <div className="w-10 h-10 bg-slate-300 dark:bg-slate-600 rounded-full flex items-center justify-center flex-shrink-0">
                          <span className="text-lg">🏛️</span>
                        </div>
                        <div className="text-left">
                          <p className="font-semibold text-slate-900 dark:text-slate-100">Long-Term Care / Skilled Nursing</p>
                        </div>
                      </div>
                      {serviceType === 'ltc' && <CheckCircle2 className="w-5 h-5 text-blue-600 flex-shrink-0" />}
                    </label>

                    <label
                      className={`flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all ${
                        serviceType === 'assisted_living' 
                          ? 'border-slate-600 dark:border-slate-400 bg-slate-200 dark:bg-slate-800 shadow-lg' 
                          : 'border-slate-300 dark:border-slate-600 hover:border-slate-400 dark:hover:border-slate-500'
                      }`}
                    >
                      <RadioGroupItem value="assisted_living" id="assisted_living" />
                      <div className="flex items-center gap-3 flex-1">
                        <div className="w-10 h-10 bg-slate-300 dark:bg-slate-600 rounded-full flex items-center justify-center flex-shrink-0">
                          <span className="text-lg">🏘️</span>
                        </div>
                        <div className="text-left">
                          <p className="font-semibold text-slate-900 dark:text-slate-100">Assisted Living</p>
                        </div>
                      </div>
                      {serviceType === 'assisted_living' && <CheckCircle2 className="w-5 h-5 text-blue-600 flex-shrink-0" />}
                    </label>

                    <label
                      className={`flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all ${
                        serviceType === 'behavioral_health' 
                          ? 'border-slate-600 dark:border-slate-400 bg-slate-200 dark:bg-slate-800 shadow-lg' 
                          : 'border-slate-300 dark:border-slate-600 hover:border-slate-400 dark:hover:border-slate-500'
                      }`}
                    >
                      <RadioGroupItem value="behavioral_health" id="behavioral_health" />
                      <div className="flex items-center gap-3 flex-1">
                        <div className="w-10 h-10 bg-slate-300 dark:bg-slate-600 rounded-full flex items-center justify-center flex-shrink-0">
                          <span className="text-lg">🧠</span>
                        </div>
                        <div className="text-left">
                          <p className="font-semibold text-slate-900 dark:text-slate-100">Behavioral Health / Mental Health</p>
                        </div>
                      </div>
                      {serviceType === 'behavioral_health' && <CheckCircle2 className="w-5 h-5 text-blue-600 flex-shrink-0" />}
                    </label>

                    <label
                      className={`flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all ${
                        serviceType === 'school_based' 
                          ? 'border-slate-600 dark:border-slate-400 bg-slate-200 dark:bg-slate-800 shadow-lg' 
                          : 'border-slate-300 dark:border-slate-600 hover:border-slate-400 dark:hover:border-slate-500'
                      }`}
                    >
                      <RadioGroupItem value="school_based" id="school_based" />
                      <div className="flex items-center gap-3 flex-1">
                        <div className="w-10 h-10 bg-slate-300 dark:bg-slate-600 rounded-full flex items-center justify-center flex-shrink-0">
                          <span className="text-lg">🎓</span>
                        </div>
                        <div className="text-left">
                          <p className="font-semibold text-slate-900 dark:text-slate-100">School-Based Services</p>
                        </div>
                      </div>
                      {serviceType === 'school_based' && <CheckCircle2 className="w-5 h-5 text-blue-600 flex-shrink-0" />}
                    </label>

                    <label
                      className={`flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all ${
                        serviceType === 'other' 
                          ? 'border-slate-600 dark:border-slate-400 bg-slate-200 dark:bg-slate-800 shadow-lg' 
                          : 'border-slate-300 dark:border-slate-600 hover:border-slate-400 dark:hover:border-slate-500'
                      }`}
                    >
                      <RadioGroupItem value="other" id="other" />
                      <div className="flex items-center gap-3 flex-1">
                        <div className="w-10 h-10 bg-slate-300 dark:bg-slate-600 rounded-full flex items-center justify-center flex-shrink-0">
                          <span className="text-lg">📍</span>
                        </div>
                        <div className="text-left">
                          <p className="font-semibold text-slate-900 dark:text-slate-100">Other</p>
                        </div>
                      </div>
                      {serviceType === 'other' && <CheckCircle2 className="w-5 h-5 text-blue-600 flex-shrink-0" />}
                    </label>
                  </RadioGroup>
                </div>

                <div className="flex justify-end pt-4">
                  <Button
                    onClick={() => setStep(2)}
                    disabled={!serviceType}
                    className="bg-slate-600 dark:bg-slate-700 hover:bg-slate-700 dark:hover:bg-slate-600 text-white px-8"
                  >
                    Next Step →
                  </Button>
                </div>
              </motion.div>
            )}

            {/* Step 2: Credentials */}
            {step === 2 && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="space-y-6"
              >
                <div className="text-center mb-6">
                  <h3 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-2">
                    What are your credentials?
                  </h3>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    This helps us provide you with role-appropriate features
                  </p>
                </div>

                <RadioGroup value={credentialType} onValueChange={setCredentialType} className="space-y-4">
                  <label
                    className={`flex items-center gap-4 p-6 rounded-xl border-2 cursor-pointer transition-all hover:scale-105 ${
                      credentialType === 'RN' 
                        ? 'border-slate-600 dark:border-slate-400 bg-slate-200 dark:bg-slate-800 shadow-lg' 
                        : 'border-slate-300 dark:border-slate-600 hover:border-slate-400 dark:hover:border-slate-500'
                    }`}
                  >
                    <RadioGroupItem value="RN" id="RN" />
                    <div className="flex items-center gap-4 flex-1">
                      <div className="w-12 h-12 bg-slate-300 dark:bg-slate-600 rounded-full flex items-center justify-center">
                        <UserCircle className="w-6 h-6 text-slate-700 dark:text-slate-300" />
                      </div>
                      <div className="text-left">
                        <p className="font-semibold text-slate-900 dark:text-slate-100">RN</p>
                        <p className="text-sm text-slate-600 dark:text-slate-400">Registered Nurse</p>
                      </div>
                    </div>
                    {credentialType === 'RN' && (
                      <CheckCircle2 className="w-6 h-6 text-blue-600" />
                    )}
                  </label>

                  <label
                    className={`flex items-center gap-4 p-6 rounded-xl border-2 cursor-pointer transition-all hover:scale-105 ${
                      credentialType === 'LPN' 
                        ? 'border-slate-600 dark:border-slate-400 bg-slate-200 dark:bg-slate-800 shadow-lg' 
                        : 'border-slate-300 dark:border-slate-600 hover:border-slate-400 dark:hover:border-slate-500'
                    }`}
                  >
                    <RadioGroupItem value="LPN" id="LPN" />
                    <div className="flex items-center gap-4 flex-1">
                      <div className="w-12 h-12 bg-slate-300 dark:bg-slate-600 rounded-full flex items-center justify-center">
                        <UserCircle className="w-6 h-6 text-slate-700 dark:text-slate-300" />
                      </div>
                      <div className="text-left">
                        <p className="font-semibold text-slate-900 dark:text-slate-100">LPN</p>
                        <p className="text-sm text-slate-600 dark:text-slate-400">Licensed Practical Nurse</p>
                      </div>
                    </div>
                    {credentialType === 'LPN' && (
                      <CheckCircle2 className="w-6 h-6 text-slate-700 dark:text-slate-400" />
                    )}
                  </label>

                  <label
                    className={`flex items-center gap-4 p-6 rounded-xl border-2 cursor-pointer transition-all hover:scale-105 ${
                      credentialType === 'Admin Staff' 
                        ? 'border-slate-600 dark:border-slate-400 bg-slate-200 dark:bg-slate-800 shadow-lg' 
                        : 'border-slate-300 dark:border-slate-600 hover:border-slate-400 dark:hover:border-slate-500'
                    }`}
                  >
                    <RadioGroupItem value="Admin Staff" id="admin_staff" />
                    <div className="flex items-center gap-4 flex-1">
                      <div className="w-12 h-12 bg-slate-300 dark:bg-slate-600 rounded-full flex items-center justify-center">
                        <UserCircle className="w-6 h-6 text-slate-700 dark:text-slate-300" />
                      </div>
                      <div className="text-left">
                        <p className="font-semibold text-slate-900 dark:text-slate-100">Admin Staff</p>
                        <p className="text-sm text-slate-600 dark:text-slate-400">Administrative personnel</p>
                      </div>
                    </div>
                    {credentialType === 'Admin Staff' && (
                      <CheckCircle2 className="w-6 h-6 text-purple-600" />
                    )}
                  </label>
                </RadioGroup>

                <div className="flex justify-between pt-4">
                  <Button
                    variant="outline"
                    onClick={() => setStep(1)}
                  >
                    ← Back
                  </Button>
                  <Button
                    onClick={handleComplete}
                    disabled={!credentialType || completeOnboardingMutation.isPending}
                    className="bg-slate-600 dark:bg-slate-700 hover:bg-slate-700 dark:hover:bg-slate-600 px-8"
                  >
                    {completeOnboardingMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Setting up...
                      </>
                    ) : (
                      <>
                        Complete Setup
                        <CheckCircle2 className="w-4 h-4 ml-2" />
                      </>
                    )}
                  </Button>
                </div>
              </motion.div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}