import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { ShieldAlert, LogOut } from "lucide-react";

const LOGO_URL =
  "https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/68ee80d98929370f9e8f2932/02eed9872_pennsynclogoupdated.png";

const UserNotRegisteredError = () => {
  // Route sign-out through AuthContext.logout (not base44.auth.logout directly)
  // so cached PHI is purged — queryClient.clear() + clearCachedPHI() — before
  // the token is removed. A de-registered user who was previously approved may
  // still have patient data cached in localStorage/IndexedDB on a shared device.
  const { logout } = useAuth();

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-navy-50 via-white to-navy-100 p-4">
      <div className="w-full max-w-md">
        {/* Brand lockup */}
        <div className="mb-6 flex items-center justify-center gap-2">
          <img src={LOGO_URL} alt="PennSync" className="h-9 w-9 rounded-lg" />
          <span className="text-xl font-bold tracking-tight text-navy-900">
            Penn<span className="text-gold-600">Sync</span>
          </span>
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-navy-600 via-navy-500 to-gold-400" />
          <div className="p-8 text-center">
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-navy-50 to-navy-100 ring-1 ring-inset ring-navy-200/60">
              <ShieldAlert className="h-8 w-8 text-navy-600" />
            </div>
            <h1 className="mb-2 text-2xl font-bold text-slate-900">Access Restricted</h1>
            <p className="mb-6 text-slate-600">
              Your account isn’t registered for this application yet. Please contact your
              agency administrator to request access.
            </p>

            <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50 p-4 text-left text-sm text-slate-600">
              <p className="mb-2 font-medium text-slate-700">If you believe this is an error:</p>
              <ul className="list-inside list-disc space-y-1.5">
                <li>Verify you’re signed in with the correct account</li>
                <li>Contact your agency administrator for access</li>
                <li>Try signing out and back in</li>
              </ul>
            </div>

            <Button onClick={() => { void logout(); }} variant="outline" className="w-full">
              <LogOut className="mr-2 h-4 w-4" /> Sign out
            </Button>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">
          Secure clinical platform · HIPAA compliant
        </p>
      </div>
    </div>
  );
};

export default UserNotRegisteredError;
