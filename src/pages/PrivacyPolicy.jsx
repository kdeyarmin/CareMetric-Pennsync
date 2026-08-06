import React from 'react';
import { useNavigate } from 'react-router';
import { Shield, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * PrivacyPolicy — PUBLIC page (routed pre-auth in App.jsx).
 *
 * Apple App Store Guideline 5.1.1(i) requires a privacy policy link that is
 * accessible from WITHIN the app (not only in App Store Connect), and it must
 * describe the data collected, how it is used, and retention/deletion. This
 * page is that in-app policy; the same URL is entered in App Store Connect.
 *
 * The text below is a working draft tailored to how PennSync actually handles
 * data (agency-provisioned accounts, PHI processed for the agency, no ads, no
 * data sales, request-based account deletion). Have counsel review it before
 * public App Store submission.
 */

const SectionTitle = ({ children }) => (
  <h2 className="mt-8 text-lg font-semibold text-slate-900">{children}</h2>
);

const PrivacyPolicy = () => {
  const navigate = useNavigate();
  // navigate (not window.location) so the app's router basename is honored
  // when the SPA is hosted under a sub-path.
  const goBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate('/');
  };

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto w-full max-w-3xl">
        <Button variant="ghost" onClick={goBack} className="mb-4 -ml-2 text-slate-600">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>

        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 sm:p-10">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-navy-50 ring-1 ring-inset ring-navy-200/60">
              <Shield className="h-6 w-6 text-navy-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Privacy Policy</h1>
              <p className="text-sm text-slate-500">PennSync by CareMetric · Effective July 22, 2026</p>
            </div>
          </div>

          <p className="text-sm leading-6 text-slate-600">
            PennSync by CareMetric (&quot;PennSync&quot;, &quot;we&quot;, &quot;us&quot;) is a clinical
            documentation and care-coordination platform used by home health and hospice agencies
            and their staff. This policy explains what information the PennSync application collects,
            how it is used, and the choices available to you. PennSync is provided to you by, or on
            behalf of, the healthcare agency that provisioned your account (&quot;your agency&quot;).
          </p>

          <SectionTitle>Information we collect</SectionTitle>
          <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-600">
            <li>
              <span className="font-medium text-slate-800">Account information</span> — your name,
              work email address, role, credentials, and training records, provided by you or your
              agency when your account is created.
            </li>
            <li>
              <span className="font-medium text-slate-800">Patient health information (PHI)</span> —
              clinical documentation, assessments, care plans, medications, visit notes, documents,
              and related records that you or your agency enter or upload while providing care. This
              information is processed on behalf of your agency, which is the covered entity
              responsible for it under HIPAA. PennSync acts as a business associate.
            </li>
            <li>
              <span className="font-medium text-slate-800">Usage and audit data</span> — sign-in
              events, pages and records accessed, and actions taken. Healthcare regulations require
              audit trails over access to patient records; this data is collected for security and
              compliance, linked to your account.
            </li>
            <li>
              <span className="font-medium text-slate-800">Device data you choose to share</span> —
              camera and microphone input when you use telehealth, dictation, document scanning, or
              photo attachment features. Access is requested only when you use those features and can
              be revoked in your device settings.
            </li>
          </ul>

          <SectionTitle>How we use information</SectionTitle>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Information is used solely to operate the platform for your agency: clinical
            documentation, scheduling and coordination, messaging, training, compliance monitoring,
            analytics for your agency, and security auditing. AI-assisted features process clinical
            text and documents to draft or check documentation; AI output is always subject to
            clinician review. We do not sell personal information, we do not use it for advertising,
            and we do not use health information for any purpose other than providing the service to
            your agency.
          </p>

          <SectionTitle>Sharing</SectionTitle>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Information is shared only with: (1) your agency and the colleagues your agency
            authorizes; (2) service providers that host and operate the platform under
            confidentiality and business-associate obligations (cloud hosting, secure file storage,
            fax/SMS/voice delivery, AI processing); and (3) authorities when required by law. Patient
            information is never shared for marketing.
          </p>

          <SectionTitle>Retention and deletion</SectionTitle>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Clinical records are retained according to your agency&apos;s medical-record retention
            obligations under federal and state law; the retention period is controlled by your
            agency, not by PennSync. You can request deletion of your account at any time from
            Settings &rarr; Delete My Account inside the app. Deletion requests are routed to your
            agency&apos;s administrators, who must complete them within the timeframes the law
            allows; records your agency is legally required to retain (for example, signed clinical
            documentation and audit trails) are retained by the agency for the mandated period and
            then destroyed.
          </p>

          <SectionTitle>Security</SectionTitle>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Data is encrypted in transit, access is role-based and audited, sessions time out after
            inactivity, and locally cached patient data on shared devices is purged on sign-out and
            idle timeout. Report suspected security issues to your agency administrator or the
            contact below.
          </p>

          <SectionTitle>Your choices</SectionTitle>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            You may access and update your profile in Settings, control notification preferences,
            revoke camera/microphone permissions in your device settings, and request account
            deletion in-app. Patients seeking access to or correction of their records should
            contact the agency providing their care, which is the record holder.
          </p>

          <SectionTitle>Contact</SectionTitle>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Questions about this policy or our data practices: contact your agency administrator, or
            reach CareMetric at the support contact provided by your agency.
          </p>

          <p className="mt-8 border-t border-slate-100 pt-4 text-xs text-slate-600">
            This policy applies to the PennSync application on the web and on mobile devices,
            including the iOS app.
          </p>
        </div>
      </div>
    </div>
  );
};

export default PrivacyPolicy;
