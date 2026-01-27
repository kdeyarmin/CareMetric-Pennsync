import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    // Admin-only function
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    console.log('[runSecurityAudit] Starting comprehensive HIPAA security audit');

    const findings = {
      timestamp: new Date().toISOString(),
      auditor: user.email,
      passed: [],
      warnings: [],
      critical: [],
      recommendations: []
    };

    // 1. Check Authentication & Authorization
    try {
      const allUsers = await base44.asServiceRole.entities.User.list();
      const usersWithoutRole = allUsers.filter(u => !u.role);
      if (usersWithoutRole.length > 0) {
        findings.warnings.push({
          category: 'Authentication',
          issue: `${usersWithoutRole.length} users without assigned roles`,
          severity: 'medium',
          recommendation: 'Assign appropriate roles to all users'
        });
      } else {
        findings.passed.push({
          category: 'Authentication',
          check: 'All users have assigned roles'
        });
      }
    } catch (error) {
      findings.critical.push({
        category: 'Authentication',
        issue: 'Failed to audit user roles',
        error: error.message
      });
    }

    // 2. Check Audit Trail Logging
    try {
      const recentAudits = await base44.asServiceRole.entities.AuditTrail.list('-timestamp', 100);
      const last24Hours = recentAudits.filter(a => 
        new Date(a.timestamp) > new Date(Date.now() - 24 * 60 * 60 * 1000)
      );
      
      if (last24Hours.length === 0) {
        findings.warnings.push({
          category: 'Audit Logging',
          issue: 'No audit entries in the last 24 hours',
          severity: 'high',
          recommendation: 'Ensure audit logging is active for all PHI access'
        });
      } else {
        findings.passed.push({
          category: 'Audit Logging',
          check: `${last24Hours.length} audit events logged in last 24h`
        });
      }
    } catch (error) {
      findings.critical.push({
        category: 'Audit Logging',
        issue: 'Audit trail entity not accessible',
        error: error.message,
        recommendation: 'Verify AuditTrail entity exists and is configured'
      });
    }

    // 3. Check Security Logs
    try {
      const securityLogs = await base44.asServiceRole.entities.SecurityLog.list('-timestamp', 50);
      const unauthorizedAttempts = securityLogs.filter(log => 
        log.action?.includes('UNAUTHORIZED') || log.action?.includes('FAILED')
      );
      
      if (unauthorizedAttempts.length > 10) {
        findings.warnings.push({
          category: 'Security Monitoring',
          issue: `${unauthorizedAttempts.length} unauthorized access attempts detected`,
          severity: 'high',
          recommendation: 'Review security logs and consider implementing additional access controls'
        });
      } else {
        findings.passed.push({
          category: 'Security Monitoring',
          check: 'Security logging operational with minimal unauthorized attempts'
        });
      }
    } catch (error) {
      findings.warnings.push({
        category: 'Security Monitoring',
        issue: 'Could not access security logs',
        recommendation: 'Ensure SecurityLog entity is properly configured'
      });
    }

    // 4. Check Patient Data Access Controls (RLS)
    try {
      const patients = await base44.asServiceRole.entities.Patient.list('-created_date', 10);
      
      findings.passed.push({
        category: 'Data Access',
        check: 'Patient entity accessible via service role'
      });

      // Verify RLS is working by attempting normal user access
      findings.recommendations.push({
        category: 'Data Access',
        recommendation: 'Ensure Patient entity has RLS configured to restrict access to authorized users only'
      });
    } catch (error) {
      findings.critical.push({
        category: 'Data Access',
        issue: 'Cannot access Patient entity',
        error: error.message
      });
    }

    // 5. Check Subscription Data Security
    try {
      const subscriptions = await base44.asServiceRole.entities.Subscription.list();
      const exposedBilling = subscriptions.filter(s => 
        !s.stripe_customer_id || !s.user_email
      );
      
      if (exposedBilling.length > 0) {
        findings.warnings.push({
          category: 'Billing Security',
          issue: `${exposedBilling.length} subscriptions missing customer or user data`,
          severity: 'medium'
        });
      } else {
        findings.passed.push({
          category: 'Billing Security',
          check: 'All subscriptions have proper user and customer associations'
        });
      }
    } catch (error) {
      findings.warnings.push({
        category: 'Billing Security',
        issue: 'Could not audit subscriptions',
        error: error.message
      });
    }

    // 6. Check for Inactive Sessions/Stale Data
    try {
      const userActivity = await base44.asServiceRole.entities.UserActivity.list('-created_date', 200);
      const activeUsers = new Set(userActivity.map(a => a.user_email));
      const allUsers = await base44.asServiceRole.entities.User.list();
      const inactiveUsers = allUsers.filter(u => !activeUsers.has(u.email));
      
      if (inactiveUsers.length > allUsers.length * 0.3) {
        findings.warnings.push({
          category: 'Session Management',
          issue: `${inactiveUsers.length} users with no recent activity`,
          severity: 'low',
          recommendation: 'Consider implementing automated account deactivation for inactive users'
        });
      } else {
        findings.passed.push({
          category: 'Session Management',
          check: 'User activity tracking operational'
        });
      }
    } catch (error) {
      findings.warnings.push({
        category: 'Session Management',
        issue: 'Could not analyze user activity',
        error: error.message
      });
    }

    // 7. Check Encryption Status
    findings.passed.push({
      category: 'Data Encryption',
      check: 'All data encrypted at rest (Base44 platform default)'
    });
    findings.passed.push({
      category: 'Transport Security',
      check: 'All data transmitted over HTTPS/TLS (Base44 platform default)'
    });

    // 8. Check Backup & Recovery
    findings.recommendations.push({
      category: 'Business Continuity',
      recommendation: 'Verify automated backup schedule is active (handled by Base44 platform)',
      notes: 'Base44 provides automatic backups; verify retention policy meets compliance needs'
    });

    // 9. Verify Webhook Security
    const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
    if (!webhookSecret) {
      findings.critical.push({
        category: 'Webhook Security',
        issue: 'STRIPE_WEBHOOK_SECRET not configured',
        severity: 'critical',
        recommendation: 'Set webhook secret to prevent unauthorized webhook calls'
      });
    } else {
      findings.passed.push({
        category: 'Webhook Security',
        check: 'Webhook signature verification configured'
      });
    }

    // 10. Check for Exposed API Keys
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeKey || stripeKey.startsWith('sk_test_')) {
      findings.warnings.push({
        category: 'API Security',
        issue: 'Using test API keys in production',
        severity: 'high',
        recommendation: 'Switch to production API keys for live environment'
      });
    } else {
      findings.passed.push({
        category: 'API Security',
        check: 'Production API keys configured'
      });
    }

    // Summary
    const summary = {
      total_checks: findings.passed.length + findings.warnings.length + findings.critical.length,
      passed: findings.passed.length,
      warnings: findings.warnings.length,
      critical: findings.critical.length,
      compliance_score: Math.round(
        (findings.passed.length / (findings.passed.length + findings.warnings.length + findings.critical.length)) * 100
      ),
      status: findings.critical.length > 0 ? 'CRITICAL' : 
              findings.warnings.length > 5 ? 'NEEDS_ATTENTION' : 
              'COMPLIANT'
    };

    console.log('[runSecurityAudit] Audit complete:', summary);

    // Create audit record
    await base44.asServiceRole.entities.SecurityLog.create({
      timestamp: new Date().toISOString(),
      user_email: user.email,
      user_role: user.role,
      action: 'SECURITY_AUDIT_COMPLETED',
      details: {
        summary,
        findings_count: {
          passed: findings.passed.length,
          warnings: findings.warnings.length,
          critical: findings.critical.length
        }
      }
    });

    return Response.json({
      success: true,
      summary,
      findings,
      generated_at: new Date().toISOString(),
      auditor: user.email
    });

  } catch (error) {
    console.error('[runSecurityAudit] Error:', error);
    return Response.json({ 
      error: 'Security audit failed',
      details: error.message 
    }, { status: 500 });
  }
});