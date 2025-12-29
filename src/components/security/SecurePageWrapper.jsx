import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { createPageUrl } from "@/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Shield, Loader2 } from "lucide-react";

/**
 * HIPAA-Grade Security Wrapper
 * Ensures authenticated access and logs security events
 */
export default function SecurePageWrapper({ 
  children, 
  requireAdmin = false,
  pageName = "Protected Page" 
}) {
  const navigate = useNavigate();

  const { data: currentUser, isLoading, error } = useQuery({
    queryKey: ['currentUser'],
    queryFn: async () => {
      try {
        const user = await base44.auth.me();
        
        // Log secure page access
        await base44.entities.SecurityLog.create({
          timestamp: new Date().toISOString(),
          user_email: user.email,
          user_role: user.role,
          action: 'PAGE_ACCESS',
          details: {
            page: pageName,
            ip_address: window.location.hostname,
            user_agent: navigator.userAgent
          }
        });
        
        return user;
      } catch (error) {
        // Log unauthorized access attempt
        try {
          await base44.entities.SecurityLog.create({
            timestamp: new Date().toISOString(),
            user_email: 'anonymous',
            user_role: 'none',
            action: 'UNAUTHORIZED_ACCESS_ATTEMPT',
            details: {
              page: pageName,
              error: error.message,
              ip_address: window.location.hostname,
              user_agent: navigator.userAgent
            }
          });
        } catch (logError) {
          console.error('Failed to log security event:', logError);
        }
        
        throw error;
      }
    },
    retry: false,
    staleTime: 60000
  });

  useEffect(() => {
    if (error) {
      // Redirect to login if authentication fails
      base44.auth.redirectToLogin(window.location.pathname);
    }
  }, [error]);

  useEffect(() => {
    if (currentUser && requireAdmin && currentUser.role !== 'admin') {
      // Log unauthorized admin access attempt
      base44.entities.SecurityLog.create({
        timestamp: new Date().toISOString(),
        user_email: currentUser.email,
        user_role: currentUser.role,
        action: 'UNAUTHORIZED_ADMIN_ACCESS',
        details: {
          page: pageName,
          ip_address: window.location.hostname,
          user_agent: navigator.userAgent
        }
      });
      
      // Redirect to dashboard
      navigate(createPageUrl("Dashboard"));
    }
  }, [currentUser, requireAdmin, navigate, pageName]);

  // Show loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-96">
          <CardContent className="p-12 text-center">
            <Shield className="w-12 h-12 text-blue-600 mx-auto mb-4 animate-pulse" />
            <h3 className="text-lg font-semibold mb-2">Verifying Access</h3>
            <p className="text-sm text-gray-600 mb-4">Authenticating your credentials...</p>
            <Loader2 className="w-6 h-6 animate-spin mx-auto text-blue-600" />
          </CardContent>
        </Card>
      </div>
    );
  }

  // Show error state
  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-96 border-red-300 bg-red-50">
          <CardContent className="p-12 text-center">
            <Shield className="w-12 h-12 text-red-600 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-red-900 mb-2">Authentication Required</h3>
            <p className="text-sm text-red-700">Redirecting to login...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Show unauthorized access for admin pages
  if (requireAdmin && currentUser?.role !== 'admin') {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-96 border-red-300 bg-red-50">
          <CardContent className="p-12 text-center">
            <Shield className="w-12 h-12 text-red-600 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-red-900 mb-2">Access Denied</h3>
            <p className="text-sm text-red-700 mb-4">Administrator privileges required</p>
            <p className="text-xs text-gray-600">Redirecting to dashboard...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Render protected content
  return <>{children}</>;
}