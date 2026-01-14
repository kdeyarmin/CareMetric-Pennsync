import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileText, Shield, AlertTriangle } from "lucide-react";
import { base44 } from "@/api/base44Client";

export default function SignupAgreementModal({ isOpen, onAccept, onDecline }) {
  const [agreed, setAgreed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleAccept = async () => {
    if (!agreed) {
      alert("Please check the box to agree to the terms");
      return;
    }

    setIsSubmitting(true);
    try {
      const user = await base44.auth.me();
      
      // Log agreement acceptance
      await base44.entities.UserActivity.create({
        user_email: user.email,
        user_name: user.full_name,
        action: "terms_accepted",
        details: {
          terms_of_service: true,
          privacy_policy: true,
          business_associate_agreement: true,
          ai_disclaimer_acknowledged: true,
          ai_use_acknowledgment: true,
          probabilistic_models_acknowledged: true,
          no_medical_advice_acknowledged: true,
          accepted_date: new Date().toISOString()
        },
        page: "signup_agreement"
      });

      onAccept?.();
    } catch (error) {
      console.error("Error logging agreement:", error);
      onAccept?.(); // Still proceed even if logging fails
    }
    setIsSubmitting(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onDecline?.()}>
      <DialogContent className="max-w-2xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Shield className="w-6 h-6 text-blue-600" />
            CareMetric AI User Agreement
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="h-[400px] pr-4">
          <div className="space-y-6">
            {/* Main Agreement Text */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-gray-900 leading-relaxed">
                By creating an account, you agree to the <strong>CareMetric AI Terms of Service</strong> and 
                acknowledge the <strong>Privacy Policy</strong>.
              </p>
            </div>

            {/* HIPAA/BAA Notice */}
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <FileText className="w-5 h-5 text-purple-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-gray-900 mb-2">
                    Protected Health Information (PHI)
                  </p>
                  <p className="text-sm text-gray-900 leading-relaxed">
                    If you or your organization use CareMetric AI to create, store, or process protected 
                    health information (PHI), you also agree to the <strong>Business Associate Agreement</strong>.
                  </p>
                </div>
              </div>
            </div>

            {/* AI Disclaimer */}
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-gray-900 mb-2">
                    AI-Assisted Clinical Tools Disclaimer
                  </p>
                  <p className="text-sm text-gray-900 leading-relaxed">
                    CareMetric AI provides <strong>assistive AI tools only</strong> and does not replace 
                    professional clinical judgment. All AI-generated content must be reviewed and approved 
                    by a qualified healthcare professional.
                  </p>
                </div>
              </div>
            </div>

            {/* AI Use Acknowledgment */}
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-gray-900 mb-2">
                    AI Use Acknowledgment
                  </p>
                  <div className="text-sm text-gray-900 leading-relaxed space-y-2">
                    <p>
                      CareMetric AI uses <strong>machine-assisted and probabilistic models</strong>.
                    </p>
                    <p>
                      AI-generated outputs may be <strong>inaccurate, incomplete, or outdated</strong> and 
                      must be reviewed and verified by a qualified professional prior to use.
                    </p>
                    <p>
                      CareMetric AI <strong>does not provide medical advice</strong>, make clinical decisions, 
                      or guarantee compliance or reimbursement outcomes.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Legal Documents Links */}
            <div className="border-t pt-4 space-y-2">
              <p className="text-sm font-semibold text-gray-900 mb-3">Legal Documents:</p>
              <div className="space-y-2">
                <a 
                  href="/TermsOfUse" 
                  target="_blank"
                  className="block text-sm text-blue-600 hover:text-blue-800 hover:underline"
                >
                  → View Terms of Service
                </a>
                <a 
                  href="/PrivacyPolicy" 
                  target="_blank"
                  className="block text-sm text-blue-600 hover:text-blue-800 hover:underline"
                >
                  → View Privacy Policy
                </a>
                <a 
                  href="/About" 
                  target="_blank"
                  className="block text-sm text-blue-600 hover:text-blue-800 hover:underline"
                >
                  → View Business Associate Agreement
                </a>
              </div>
            </div>
          </div>
        </ScrollArea>

        {/* Agreement Checkbox */}
        <div className="border-t pt-4">
          <div className="flex items-start gap-3">
            <Checkbox
              id="agree"
              checked={agreed}
              onCheckedChange={setAgreed}
              className="mt-1"
            />
            <label htmlFor="agree" className="text-sm text-gray-900 leading-relaxed cursor-pointer">
              I have read and agree to the Terms of Service, Privacy Policy, and Business Associate 
              Agreement. I acknowledge that CareMetric AI uses machine-assisted probabilistic models 
              that may produce inaccurate, incomplete, or outdated outputs. I understand that all 
              AI-generated content must be reviewed and verified by a qualified healthcare professional, 
              and that CareMetric AI does not provide medical advice or guarantee clinical outcomes.
            </label>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={onDecline}
            disabled={isSubmitting}
          >
            Decline
          </Button>
          <Button
            onClick={handleAccept}
            disabled={!agreed || isSubmitting}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {isSubmitting ? "Processing..." : "Accept & Continue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}