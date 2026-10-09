import { accountDeletionEmailHref } from '@/lib/supportContacts';

/**
 * Account deletion for people who cannot reach Settings.
 *
 * An account can exist with no active agency membership: an invited person whose
 * access is not yet granted, a suspended one, or somebody who signed up on the
 * platform-hosted page without an invitation (onUserSignup leaves that account
 * unapproved). Such an account stops at an access screen whose only actions were
 * Retry and Sign out, so it could not be deleted from the app, which is what
 * App Store Guideline 5.1.1(v) forbids. The same pre-filled support request that
 * Settings → Delete My Account prepares is offered here.
 */
export default function AccountDeletionRequestLink({ email, className = '' }) {
  return (
    <p className={`text-xs text-slate-500 ${className}`.trim()}>
      Want your PennSync account deleted?{' '}
      <a
        href={accountDeletionEmailHref(email)}
        className="font-medium text-navy-700 underline-offset-2 hover:underline"
      >
        Request account deletion
      </a>
    </p>
  );
}
