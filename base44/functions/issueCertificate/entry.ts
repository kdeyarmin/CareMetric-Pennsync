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
        const { assignment_id, user_id, course_id, score } = body;

        if (!assignment_id || !user_id || !course_id) {
            return Response.json({
                error: 'assignment_id, user_id, and course_id are required'
            }, { status: 400 });
        }

        // Opt-in lockdown: this should only be invoked by the training system
        // (gradeTrainingAttempt passes _internal_secret) or an admin. When
        // INTERNAL_FN_SECRET is configured we ENFORCE that; unset => no
        // enforcement (so nothing breaks before it's set). Set it at launch to
        // stop a user self-issuing a certificate by calling this endpoint.
        const internalSecret = Deno.env.get('INTERNAL_FN_SECRET');
        if (internalSecret) {
            const isInternal = body._internal_secret === internalSecret;
            if (!isInternal && user.role !== 'admin') {
                return Response.json({ error: 'Certificates may only be issued by the training system or an admin.' }, { status: 403 });
            }
        }

        // Fetch assignment and course details
        const assignment = await base44.asServiceRole.entities.TrainingAssignment.get(assignment_id);
        const course = await base44.asServiceRole.entities.TrainingCourse.get(course_id);
        const userData = await base44.asServiceRole.entities.User.filter({ email: user_id });

        if (!assignment || !course) {
            return Response.json({ error: 'Assignment or course not found' }, { status: 404 });
        }

        // The certificate subject must match the assignment's assignee — prevents
        // minting a certificate against someone else's assignment. (The training
        // system passes user_id === assignment.assigned_to_user_id.)
        if (assignment.assigned_to_user_id && assignment.assigned_to_user_id !== user_id) {
            return Response.json({ error: 'user_id does not match the assignment assignee.' }, { status: 403 });
        }

        const userName = userData && userData.length > 0 ? userData[0].full_name : user_id;

        // Check if certificate already exists
        const existingCerts = await base44.asServiceRole.entities.TrainingCertificate.filter({
            assignment_id,
            user_id
        });

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
            score: score !== undefined ? score : assignment.score_percentage,
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
            details: error.message 
        }, { status: 500 });
    }
});