import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // This function should be called by the system, not directly by users
        // Verify it's being called internally or by admin
        const user = await base44.auth.me();
        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
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
        const callerIsAdmin = user.role === 'admin' ||
            user.account_type === 'super_admin' || user.account_type === 'agency_admin';
        const attempts = await base44.asServiceRole.entities.TrainingAttempt
            .filter({ assignment_id }, '-created_date', 20).catch(() => []);
        const passedAttempt = (attempts || []).find((a) => a.passed === true) || null;
        const assignmentPassed = callerIsAdmin &&
            (assignment.pass_fail_result === 'passed' || assignment.status === 'completed');
        if (!passedAttempt && !assignmentPassed) {
            return Response.json({ error: 'Certificate can only be issued for a passed assignment.' }, { status: 403 });
        }
        // Derive the recorded score from the verified source, never from the request
        // body — a forged high score must not land on the certificate. For a
        // non-admin caller the only trusted source is the server-written attempt;
        // the assignee-writable assignment score is honored for admin issuance only.
        const verifiedScore = passedAttempt?.score ??
            (callerIsAdmin ? (assignment.score_percentage ?? null) : null);

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

        // Generate unique certificate ID
        const certificateId = `CERT-${Date.now()}-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;

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
                certificate_id: certificateId
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