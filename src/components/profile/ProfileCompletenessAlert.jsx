import { useMemo } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { PATIENT_HISTORY_ROWS } from '@/lib/queryLimits';

export default function ProfileCompletenessAlert({ user }) {
  const { data: credentials = [] } = useQuery({
    queryKey: ['myCredentials', user?.email],
    queryFn: () => user?.email ? base44.entities.PersonnelCredential.filter({ user_id: user.email }, undefined, PATIENT_HISTORY_ROWS) : Promise.resolve([]),
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
    <div className="rounded-lg border border-amber-400 bg-amber-50 px-4 py-3 mb-4 flex items-center gap-3">
      <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0" />
      <p className="text-sm text-amber-800 flex-1 min-w-0">
        <span className="font-semibold">Complete your profile: </span>
        {validation.missing.length > 0 && validation.needsCredentials
          ? `${validation.missing.join(', ')} • Upload credentials`
          : validation.missing.length > 0
          ? validation.missing.join(', ')
          : "Upload your license, certifications, and insurance"}
      </p>
      <Link to="/UserSettings" className="flex-shrink-0">
        <Button size="sm" variant="outline" className="gap-1.5 text-xs h-8 px-3">
          Update
          <ArrowRight className="h-3 w-3" />
        </Button>
      </Link>
    </div>
  );
}