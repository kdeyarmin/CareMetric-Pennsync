import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        const user = await base44.auth.me().catch(() => null);
        const body = await req.json();
        const expectedSecret = String(Deno.env.get('INTERNAL_FN_SECRET') || '').trim();
        const providedSecret = String(body?.internal_secret || '').trim();
        let internalOk = false;
        if (expectedSecret && providedSecret.length === expectedSecret.length) {
          let mismatch = 0;
          for (let i = 0; i < expectedSecret.length; i++) {
            mismatch |= expectedSecret.charCodeAt(i) ^ providedSecret.charCodeAt(i);
          }
          internalOk = mismatch === 0;
        }
        // Direct user call OR nested invoke from gradeTrainingAttempt (service-role
        // invoke has no end-user session).
        if (!user && !internalOk) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }
        if (user && isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

        const { assignment_id, user_id, course_id } = body;

        if (!assignment_id || !user_id || !course_id) {
            return Response.json({
                error: 'assignment_id, user_id, and course_id are required'
            }, { status: 400 });
        }

        // Fetch assignment and course details
        const assignment = await base44.asServiceRole.entities.TrainingAssignment.get(assignment_id);
        const course = await base44.asServiceRole.entities.TrainingCourse.get(course_id);
        const userData = await base44.asServiceRole.entities.User.filter({ email: user_id }, undefined, 5000);

        if (!assignment || !course) {
            return Response.json({ error: 'Assignment or course not found' }, { status: 404 });
        }

        // Agency admins may only mint certificates for assignees in their agency
        // (skip trusted internal gradeTrainingAttempt path).
        if (!internalOk && user?.account_type === 'agency_admin') {
            const assignee = userData?.[0];
            if (!user.agency_name || !assignee || assignee.agency_name !== user.agency_name) {
                return Response.json({
                    error: 'Forbidden: assignee is outside your agency',
                }, { status: 403 });
            }
        }

        // The certificate subject must match the assignment's assignee — prevents
        // minting a certificate against someone else's assignment. (The training
        // system passes user_id === assignment.assigned_to_user_id.)
        if (assignment.assigned_to_user_id && assignment.assigned_to_user_id !== user_id) {
            return Response.json({ error: 'user_id does not match the assignment assignee.' }, { status: 403 });
        }

        // Verify the assignment was genuinely PASSED before minting a certificate —
        // this gate must not depend on caller-supplied trust. The only evidence a
        // NON-ADMIN caller can present is a passing TrainingAttempt row: attempts
        // are written exclusively server-side by gradeTrainingAttempt (entity RLS
        // allows admin writes only; the grader uses the service role), whereas
        // TrainingAssignment rows are writable by their assignee and must not be
        // trusted for issuance. gradeTrainingAttempt writes the passing attempt
        // BEFORE invoking this, so the internal flow always qualifies. An admin
        // caller may additionally issue manually from the assignment's recorded
        // state (pass_fail_result / status).
        const callerIsAdmin = !!user && (user.role === 'admin' ||
            user.account_type === 'super_admin' || user.account_type === 'agency_admin');
        // Bind the certificate subject to the authenticated caller for non-admin
        // direct calls. Without this, any authenticated user who knows another
        // user's assignment_id/user_id could mint/re-fetch their certificate once
        // a passed TrainingAttempt exists. Nested gradeTrainingAttempt invokes
        // (internalOk) and admins may still issue for any subject.
        if (user && !callerIsAdmin && !internalOk) {
            if (String(user.email || '').toLowerCase() !== String(user_id || '').toLowerCase()) {
                return Response.json({
                    error: 'Forbidden: certificates can only be issued for the authenticated user.'
                }, { status: 403 });
            }
        }
        // Nested service-role path (gradeTrainingAttempt) is trusted like an admin
        // for the assignmentPassed fallback once a server-written attempt exists —
        // but we still require a passed TrainingAttempt for non-admin callers.
        const attempts = await base44.asServiceRole.entities.TrainingAttempt
            .filter({ assignment_id }, '-created_date', 20).catch(() => []);
        const passedAttempt = (attempts || []).find((a) => a.passed === true) || null;
        const assignmentPassed = (callerIsAdmin || internalOk) &&
            (assignment.pass_fail_result === 'passed' || assignment.status === 'completed');
        if (!passedAttempt && !assignmentPassed) {
            return Response.json({ error: 'Certificate can only be issued for a passed assignment.' }, { status: 403 });
        }
        // Derive the recorded score from the verified source, never from the request
        // body — a forged high score must not land on the certificate. For a
        // non-admin caller the only trusted source is the server-written attempt;
        // the assignee-writable assignment score is honored for admin issuance only.
        const verifiedScore = passedAttempt?.score ??
            ((callerIsAdmin || internalOk) ? (assignment.score_percentage ?? null) : null);

        const userName = userData && userData.length > 0 ? userData[0].full_name : user_id;

        // Check if certificate already exists
        const existingCerts = await base44.asServiceRole.entities.TrainingCertificate.filter({
            assignment_id,
            user_id
        }, undefined, 5000);

        if (existingCerts && existingCerts.length > 0) {
            // Certificate already exists, return it
            return Response.json({
                success: true,
                certificate: existingCerts[0],
                message: 'Certificate already issued'
            });
        }

        // Claim the assignment before create so concurrent grade/issue paths
        // cannot mint duplicate certificates for the same assignment.
        const claimToken = typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `cert-issue-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        try {
            await base44.asServiceRole.entities.TrainingAssignment.update(assignment_id, {
                certificate_issue_claimed_by: claimToken,
            });
        } catch {
            return Response.json({ error: 'Could not claim assignment for certificate issue' }, { status: 409 });
        }
        const claimCheck = await base44.asServiceRole.entities.TrainingAssignment
            .filter({ id: assignment_id }, undefined, 1).catch(() => []);
        if (!claimCheck[0] || claimCheck[0].certificate_issue_claimed_by !== claimToken) {
            const raced = await base44.asServiceRole.entities.TrainingCertificate.filter({
                assignment_id,
                user_id
            }, undefined, 1).catch(() => []);
            if (raced?.[0]) {
                return Response.json({
                    success: true,
                    certificate: raced[0],
                    message: 'Certificate already issued',
                });
            }
            return Response.json({ error: 'Certificate issue already in progress' }, { status: 409 });
        }

        // Generate unique certificate ID with CSPRNG bytes (not Math.random).
        const rand = crypto.getRandomValues(new Uint8Array(5));
        const suffix = Array.from(rand, (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 9).toUpperCase();
        const certificateId = `CERT-${Date.now()}-${suffix}`;

        // Generate verification hash
        const verificationData = `${user_id}|${course_id}|${assignment.completion_date || new Date().toISOString()}`;
        const encoder = new TextEncoder();
        const data = encoder.encode(verificationData);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const verificationHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

        // Calculate expiration date
        let expirationDate = null;
        if (course.certificate_valid_months) {
            // Clamp day-of-month before shifting: a plain setMonth overflows on
            // the 29th-31st into the following month (e.g. Aug 31 + 6mo -> Mar 3).
            const expDate = new Date();
            const targetDay = expDate.getDate();
            expDate.setDate(1);
            expDate.setMonth(expDate.getMonth() + course.certificate_valid_months);
            const lastDay = new Date(expDate.getFullYear(), expDate.getMonth() + 1, 0).getDate();
            expDate.setDate(Math.min(targetDay, lastDay));
            expirationDate = expDate.toISOString().split('T')[0];
        }

        // Create certificate record
        const certificateData = {
            user_id,
            user_name: userName,
            assignment_id,
            course_id,
            course_title: course.title,
            training_category: course.category,
            business_line: course.business_line_scope,
            annual_cycle_year: course.annual_cycle_year,
            certificate_id: certificateId,
            issued_at: new Date().toISOString(),
            completion_date: assignment.completion_date || new Date().toISOString(),
            expiration_date: expirationDate,
            score: verifiedScore,
            hours: course.ceu_hours,
            verification_hash: verificationHash,
            revoked: false
        };

        const certificate = await base44.asServiceRole.entities.TrainingCertificate.create(certificateData);

        // Generate PDF asynchronously by calling the PDF generation function
        try {
            await base44.asServiceRole.functions.invoke('generateTrainingCertificatePDF', {
                certificate_id: certificateId,
                internal_secret: Deno.env.get('INTERNAL_FN_SECRET') || '',
            });
        } catch (pdfError) {
            console.error('PDF generation failed, but certificate created:', pdfError);
        }

        // Update assignment with certificate ID
        await base44.asServiceRole.entities.TrainingAssignment.update(assignment_id, {
            certificate_id: certificateId
        });

        return Response.json({
            success: true,
            certificate,
            certificate_id: certificateId
        });

    } catch (error) {
        console.error('Certificate issuance error:', error);
        return Response.json({ 
            error: 'Failed to issue certificate',
            details: 'Internal server error' 
        }, { status: 500 });
    }
});