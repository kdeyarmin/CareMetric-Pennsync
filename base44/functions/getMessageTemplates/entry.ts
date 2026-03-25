import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const url = new URL(req.url);
        const templateType = url.searchParams.get('templateType');
        const triggerEvent = url.searchParams.get('triggerEvent');

        let query = { is_active: true };

        if (templateType) query.template_type = templateType;
        if (triggerEvent) query.trigger_event = triggerEvent;

        const templates = await base44.entities.MessageTemplate.filter(query);

        return Response.json({
            success: true,
            templates: templates,
            count: templates.length
        });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});