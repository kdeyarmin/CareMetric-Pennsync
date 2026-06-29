import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ArrowRight, FileText } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

export default function ProfileCompletenessAlert({ user }) {
  const { data: credentials = [] } = useQuery({
    queryKey: ['myCredentials', user?.email],
    queryFn: () => user?.email ? base44.entities.PersonnelCredential.filter({ user_id: user.email }) : Promise.resolve([]),
    enabled: !!user?.email,
    initialData: [],
  });

  const validation = useMemo(() => {
    if (!user) return { isComplete: true, missing: [], needsCredentials: false };

    const requiredFields = [
      { key: 'phone', label: 'Phone Number' },
      { key: 'care_scope', label: 'Care Scope' },
      { key: 'credential_type', label: 'Credential Type' },
    ];

    const missing = requiredFields.filter(field => 
      !user[field.key] || user[field.key] === ''
    );

    const hasActiveCredential = credentials.some(c => c.status === 'approved' || c.status === 'pending_approval');

    return {
      isComplete: missing.length === 0 && hasActiveCredential,
      missing: missing.map(m => m.label),
      needsCredentials: !hasActiveCredential
    };
  }, [user, credentials]);

  if (validation.isComplete) {
    return null;
  }

  return (
    <div className="rounded-xl border border-amber-600 bg-amber-50 p-5 mb-6 shadow-sm">
      <div className="flex gap-4">
        <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-amber-900 mb-2">Complete Your Profile</h3>
          <p className="text-sm text-amber-800 mb-3">
            {validation.missing.length > 0 && validation.needsCredentials
              ? `Missing profile info: ${validation.missing.join(', ')} • Upload your license, certifications, and insurance`
              : validation.missing.length > 0
              ? `Missing profile info: ${validation.missing.join(', ')}`
              : "Upload your license, certifications, and insurance"}
          </p>
          <Link to="/UserSettings" className="inline-block">
            <Button size="sm" className="gap-2 min-h-[40px] bg-amber-600 hover:bg-amber-700">
              <FileText className="h-4 w-4" />
              Update Profile & Upload Credentials
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}