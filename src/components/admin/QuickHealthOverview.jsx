import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ArrowRight, CheckCircle2, Database } from "lucide-react";

export default function QuickHealthOverview() {
  const { data: patients = [] } = useQuery({
    queryKey: ['patients-health'],
    queryFn: () => base44.entities.Patient.filter({ status: 'active' }),
    initialData: [],
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users-health'],
    queryFn: () => base44.entities.User.list('-created_date', 200),
    initialData: [],
  });

  const { data: credentials = [] } = useQuery({
    queryKey: ['credentials-health'],
    queryFn: () => base44.entities.PersonnelCredential.list(),
    initialData: [],
  });

  const incompletePatients = patients.filter(p => 
    !p.emergency_contact_name || !p.emergency_contact_phone || !p.physician_name
  ).length;

  const incompleteUsers = users.filter(u => 
    !u.phone || u.phone === '' || !u.care_scope
  ).length;

  const usersWithoutCreds = users.length - new Set(credentials.map(c => c.user_id)).size;

  const now = new Date();
  const expiredCreds = credentials.filter(c => new Date(c.expiration_date) < now).length;

  const hasIssues = incompletePatients > 0 || incompleteUsers > 0 || usersWithoutCreds > 0 || expiredCreds > 0;

  if (!hasIssues) {
    return (
      <Alert className="border-green-300 bg-green-50 mb-6">
        <CheckCircle2 className="h-4 w-4 text-green-600" />
        <AlertDescription className="text-green-800">
          All systems healthy. No critical data quality issues detected.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert className="border-amber-300 bg-amber-50 mb-6">
      <AlertTriangle className="h-4 w-4 text-amber-600" />
      <AlertDescription className="text-amber-800">
        <div className="space-y-3">
          <p className="font-semibold">Action Required: Data Quality Issues Detected</p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {incompletePatients > 0 && (
              <div className="flex items-center justify-between text-sm bg-white p-2 rounded">
                <span>{incompletePatients} patients missing emergency info</span>
                <Link to="/AdminOperations?tab=data-quality">
                  <Button size="sm" variant="outline">View</Button>
                </Link>
              </div>
            )}
            
            {incompleteUsers > 0 && (
              <div className="flex items-center justify-between text-sm bg-white p-2 rounded">
                <span>{incompleteUsers} incomplete user profiles</span>
                <Link to="/AdminOperations?tab=data-quality">
                  <Button size="sm" variant="outline">View</Button>
                </Link>
              </div>
            )}
            
            {usersWithoutCreds > 0 && (
              <div className="flex items-center justify-between text-sm bg-white p-2 rounded">
                <span>{usersWithoutCreds} staff need credential upload</span>
                <Link to="/AdminDashboard">
                  <Button size="sm" variant="outline">Review</Button>
                </Link>
              </div>
            )}
            
            {expiredCreds > 0 && (
              <div className="flex items-center justify-between text-sm bg-red-100 p-2 rounded border border-red-300">
                <span className="text-red-800 font-semibold">{expiredCreds} expired credentials</span>
                <Link to="/AdminDashboard">
                  <Button size="sm" variant="destructive">Urgent</Button>
                </Link>
              </div>
            )}
          </div>

          <Link to="/AdminOperations?tab=system-health">
            <Button size="sm" className="w-full mt-2 gap-2">
              <Database className="h-4 w-4" />
              Run Data Migration & Quality Update
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </AlertDescription>
    </Alert>
  );
}