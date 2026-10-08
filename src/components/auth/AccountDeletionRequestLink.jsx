import { accountDeletionEmailHref } from '@/lib/supportContacts';

/**
 * Account deletion for people who cannot reach Settings.
 *
 * The sign-in screen's "Sign up" creates an account with no agency membership,
 * and such an account stops at an access screen whose only actions were Retry
 * and Sign out — so it could be created in the app and never deleted from it,
 * which is what App Store Guideline 5.1.1(v) forbids. The same pre-filled
 * support request that Settings → Delete My Account prepares is offered here.
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
