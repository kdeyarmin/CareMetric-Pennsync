import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Shield, AlertTriangle, Eye } from "lucide-react";

/**
 * HIPAA Page Audit Component
 * Automatically logs page access and displays security status
 */
export default function HIPAAPageAudit({ 
  pageName, 
  containsPHI = true,
  showBanner = true 
}) {
  const [securityStatus, setSecurityStatus] = useState('checking');
  const [user, setUser] = useState(null);

  useEffect(() => {
    const logPageAccess = async () => {
      try {
        const currentUser = await base44.auth.me();
        setUser(currentUser);

        // Log page access for HIPAA audit trail
        if (containsPHI) {
          await base44.entities.AuditTrail.create({
            timestamp: new Date().toISOString(),
            user_email: currentUser.email,
            user_role: currentUser.role,
            action: 'PHI_PAGE_ACCESS',
            entity_type: 'page',
            entity_id: pageName,
            details: {
              page_name: pageName,
              contains_phi: containsPHI,
              user_agent: navigator.userAgent,
              referrer: document.referrer || 'direct'
            }
          });
        }

        // Update last activity for session timeout
        localStorage.setItem('lastActivity', Date.now().toString());
        setSecurityStatus('verified');

      } catch (error) {
        console.error('HIPAA audit failed:', error);
        setSecurityStatus('error');
        
        // Log failed access attempt
        try {
          await base44.entities.SecurityLog.create({
            timestamp: new Date().toISOString(),
            user_email: 'unknown',
            user_role: 'unknown',
            action: 'FAILED_PHI_ACCESS',
            details: {
              page: pageName,
              error: error.message
            }
          });
        } catch (logError) {
          console.error('Failed to log security event:', logError);
        }
      }
    };

    logPageAccess();

    // Set up activity monitoring
    const activityEvents = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    const updateActivity = () => {
      localStorage.setItem('lastActivity', Date.now().toString());
    };

    activityEvents.forEach(event => {
      window.addEventListener(event, updateActivity);
    });

    return () => {
      activityEvents.forEach(event => {
        window.removeEventListener(event, updateActivity);
      });
    };
  }, [pageName, containsPHI]);

  // Check session timeout every minute
  useEffect(() => {
    const checkTimeout = setInterval(() => {
      const lastActivity = localStorage.getItem('lastActivity');
      if (lastActivity) {
        const inactiveMinutes = (Date.now() - parseInt(lastActivity)) / 60000;
        if (inactiveMinutes > 15) {
          alert('Your session has expired due to inactivity (15 minutes). Please log in again.');
          base44.auth.logout();
        }
      }
    }, 60000); // Check every minute

    return () => clearInterval(checkTimeout);
  }, []);

  if (!showBanner || !containsPHI) return null;

  return (
    <Alert className="mb-4 border-blue-200 bg-blue-50">
      <Shield className="h-4 w-4 text-blue-600" />
      <AlertDescription className="text-xs">
        <div className="flex items-center justify-between">
          <span className="text-blue-900">
            <strong>Protected:</strong> This page contains PHI. Access is logged and monitored.
          </span>
          {user && (
            <span className="text-blue-700">
              User: {user.email} ({user.role})
            </span>
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
}