import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Clock, FileText, GraduationCap, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";

export default function ExpirationAlertsWidget({ currentUser }) {
  const [refreshKey, setRefreshKey] = useState(0);

  const { data: assignments = [], isLoading: loadingAssignments } = useQuery({
    queryKey: ['expiring-assignments', currentUser?.email, refreshKey],
    queryFn: async () => {
      const today = new Date();

      const all = await base44.entities.TrainingAssignment.filter(
        { assigned_to_user_id: currentUser?.email, status: 'completed' },
        '-renewal_due_date',
        100
      );

      return all.filter(a => {
        if (!a.renewal_due_date) return false;
        const renewalDate = new Date(a.renewal_due_date);
        const daysUntil = Math.ceil((renewalDate - today) / (1000 * 60 * 60 * 24));
        return daysUntil > 0 && daysUntil <= 90;
      }).map(a => {
        const renewalDate = new Date(a.renewal_due_date);
        const daysUntil = Math.ceil((renewalDate - today) / (1000 * 60 * 60 * 24));
        return { ...a, daysUntilExpiration: daysUntil };
      }).sort((a, b) => a.daysUntilExpiration - b.daysUntilExpiration);
    },
    initialData: [],
    enabled: !!currentUser?.email && currentUser?.role !== 'admin'
  });

  const { data: credentials = [], isLoading: loadingCredentials } = useQuery({
    queryKey: ['expiring-credentials', currentUser?.email, refreshKey],
    queryFn: async () => {
      const today = new Date();

      const all = await base44.entities.PersonnelCredential.filter(
        { user_id: currentUser?.email, status: 'approved' },
        '-expiration_date',
        100
      );

      return all.filter(c => {
        if (!c.expiration_date) return false;
        const expirationDate = new Date(c.expiration_date);
        const daysUntil = Math.ceil((expirationDate - today) / (1000 * 60 * 60 * 24));
        return daysUntil > 0 && daysUntil <= 90;
      }).map(c => {
        const expirationDate = new Date(c.expiration_date);
        const daysUntil = Math.ceil((expirationDate - today) / (1000 * 60 * 60 * 24));
        return { ...c, daysUntilExpiration: daysUntil };
      }).sort((a, b) => a.daysUntilExpiration - b.daysUntilExpiration);
    },
    initialData: [],
    enabled: !!currentUser?.email && currentUser?.role !== 'admin'
  });

  const { data: adminExpirations = [], isLoading: loadingAdmin } = useQuery({
    queryKey: ['admin-expirations', refreshKey],
    queryFn: async () => {
      const today = new Date();

      // Fetch all assignments and credentials
      const [allAssignments, allCredentials] = await Promise.all([
        base44.entities.TrainingAssignment.filter({ status: 'completed' }, '-renewal_due_date', 500),
        base44.entities.PersonnelCredential.filter({ status: 'approved' }, '-expiration_date', 500)
      ]);

      const expirations = [];

      // Process assignments
      allAssignments.forEach(a => {
        if (!a.renewal_due_date) return;
        const renewalDate = new Date(a.renewal_due_date);
        const daysUntil = Math.ceil((renewalDate - today) / (1000 * 60 * 60 * 24));
        if (daysUntil > 0 && daysUntil <= 90) {
          expirations.push({
            type: 'training',
            user_id: a.assigned_to_user_id,
            title: a.course_title,
            expiration_date: a.renewal_due_date,
            daysUntilExpiration: daysUntil
          });
        }
      });

      // Process credentials
      allCredentials.forEach(c => {
        if (!c.expiration_date) return;
        const expirationDate = new Date(c.expiration_date);
        const daysUntil = Math.ceil((expirationDate - today) / (1000 * 60 * 60 * 24));
        if (daysUntil > 0 && daysUntil <= 90) {
          expirations.push({
            type: 'credential',
            user_id: c.user_id,
            user_name: c.user_name,
            title: c.title,
            expiration_date: c.expiration_date,
            daysUntilExpiration: daysUntil
          });
        }
      });

      return expirations.sort((a, b) => a.daysUntilExpiration - b.daysUntilExpiration);
    },
    initialData: [],
    enabled: !!currentUser?.email && currentUser?.role === 'admin'
  });

  const isAdmin = currentUser?.role === 'admin';
  const isLoading = isAdmin ? loadingAdmin : (loadingAssignments || loadingCredentials);
  const totalExpirations = isAdmin ? adminExpirations.length : (assignments.length + credentials.length);

  const getPriorityColor = (days) => {
    if (days <= 7) return 'text-red-600 bg-red-50';
    if (days <= 14) return 'text-orange-600 bg-orange-50';
    return 'text-yellow-600 bg-yellow-50';
  };

  const getPriorityBadge = (days) => {
    if (days <= 7) return { label: 'Urgent', variant: 'destructive' };
    if (days <= 30) return { label: 'Soon', variant: 'default' };
    return { label: '90 Days', variant: 'secondary' };
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5" />
            Upcoming Expirations
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="w-6 h-6 animate-spin text-slate-400" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="flex items-center gap-2">
          <Clock className="w-5 h-5" />
          Upcoming Expirations
        </CardTitle>
        <div className="flex items-center gap-2">
          {totalExpirations > 0 && (
            <Badge variant="destructive" className="text-sm">
              {totalExpirations}
            </Badge>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setRefreshKey(k => k + 1)}
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {totalExpirations === 0 ? (
          <div className="text-center py-8">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <Clock className="w-8 h-8 text-green-600" />
            </div>
            <p className="text-sm text-slate-600">No upcoming expirations in the next 90 days</p>
          </div>
        ) : (
          <div className="space-y-3">
            {isAdmin ? (
              // Admin view
              <>
                {adminExpirations.slice(0, 5).map((item, idx) => {
                  const badge = getPriorityBadge(item.daysUntilExpiration);
                  return (
                    <div key={idx} className={`p-3 rounded-lg border ${getPriorityColor(item.daysUntilExpiration)}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2 flex-1">
                          {item.type === 'training' ? (
                            <GraduationCap className="w-4 h-4 mt-0.5 flex-shrink-0" />
                          ) : (
                            <FileText className="w-4 h-4 mt-0.5 flex-shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{item.title}</p>
                            <p className="text-xs opacity-80">
                              {item.user_name || item.user_id} · Expires {new Date(item.expiration_date).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                        <Badge variant={badge.variant} className="text-xs flex-shrink-0">
                          {item.daysUntilExpiration}d
                        </Badge>
                      </div>
                    </div>
                  );
                })}
                {adminExpirations.length > 5 && (
                  <p className="text-xs text-center text-slate-500 pt-2">
                    +{adminExpirations.length - 5} more expiring soon
                  </p>
                )}
                <Link to="/UserManagement">
                  <Button variant="outline" size="sm" className="w-full mt-2">
                    View All Expirations
                  </Button>
                </Link>
              </>
            ) : (
              // Employee view
              <>
                {assignments.slice(0, 3).map((item) => {
                  const badge = getPriorityBadge(item.daysUntilExpiration);
                  return (
                    <div key={item.id} className={`p-3 rounded-lg border ${getPriorityColor(item.daysUntilExpiration)}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2 flex-1">
                          <GraduationCap className="w-4 h-4 mt-0.5 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{item.course_title}</p>
                            <p className="text-xs opacity-80">
                              Renewal due {new Date(item.renewal_due_date).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                        <Badge variant={badge.variant} className="text-xs flex-shrink-0">
                          {item.daysUntilExpiration}d
                        </Badge>
                      </div>
                    </div>
                  );
                })}
                {credentials.slice(0, 3).map((item) => {
                  const badge = getPriorityBadge(item.daysUntilExpiration);
                  return (
                    <div key={item.id} className={`p-3 rounded-lg border ${getPriorityColor(item.daysUntilExpiration)}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2 flex-1">
                          <FileText className="w-4 h-4 mt-0.5 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{item.title}</p>
                            <p className="text-xs opacity-80">
                              Expires {new Date(item.expiration_date).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                        <Badge variant={badge.variant} className="text-xs flex-shrink-0">
                          {item.daysUntilExpiration}d
                        </Badge>
                      </div>
                    </div>
                  );
                })}
                <div className="flex gap-2 pt-2">
                  {assignments.length > 0 && (
                    <Link to="/MyTraining" className="flex-1">
                      <Button variant="outline" size="sm" className="w-full">
                        My Training
                      </Button>
                    </Link>
                  )}
                  {credentials.length > 0 && (
                    <Link to="/PersonnelFile" className="flex-1">
                      <Button variant="outline" size="sm" className="w-full">
                        Personnel File
                      </Button>
                    </Link>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}