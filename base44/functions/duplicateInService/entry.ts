import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const isAdminUser = (user) => user?.role === 'admin' || user?.account_type === 'agency_admin' || user?.account_type === 'super_admin';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!isAdminUser(user)) {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { courseId } = await req.json();
    if (!courseId) {
      return Response.json({ error: 'courseId is required' }, { status: 400 });
    }

    const [course] = await base44.asServiceRole.entities.TrainingCourse.filter({ id: courseId });
    if (!course) {
      return Response.json({ error: 'Course not found' }, { status: 404 });
    }

    const modules = await base44.asServiceRole.entities.TrainingModule.filter({ course_id: courseId }, 'order_index', 500);
    const questions = await base44.asServiceRole.entities.TrainingQuestion.filter({ course_id: courseId }, 'order_index', 500);

    // Strip server-managed fields before re-creating: spreading the source id /
    // created_date / updated_date into create risks colliding with or aliasing
    // the original record (the codebase strips id before create elsewhere).
    const stripMeta = (record) => {
      const copy = { ...record };
      delete copy.id;
      delete copy.created_date;
      delete copy.updated_date;
      return copy;
    };

    const duplicatedCourse = await base44.asServiceRole.entities.TrainingCourse.create({
      ...stripMeta(course),
      title: `${course.title} (Copy)`,
      status: 'draft',
      published_by: null,
      published_date: null,
      archived_status: false
    });

    await Promise.all(modules.map((module, index) =>
      base44.asServiceRole.entities.TrainingModule.create({
        ...stripMeta(module),
        course_id: duplicatedCourse.id,
        order_index: index
      })
    ));

    await Promise.all(questions.map((question, index) =>
      base44.asServiceRole.entities.TrainingQuestion.create({
        ...stripMeta(question),
        course_id: duplicatedCourse.id,
        order_index: index
      })
    ));

    await base44.asServiceRole.entities.TrainingAuditLog.create({
      actor_id: user.email,
      actor_name: user.full_name,
      action: 'course_created',
      entity_type: 'TrainingCourse',
      entity_id: duplicatedCourse.id,
      after_json: {
        source_course_id: courseId,
        duplicated_title: duplicatedCourse.title
      },
      severity: 'info'
    });

    return Response.json({ success: true, course_id: duplicatedCourse.id, title: duplicatedCourse.title });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});