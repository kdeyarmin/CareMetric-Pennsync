import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    const payload = await req.json();

    const { trigger_event, trigger_data } = payload;

    if (!trigger_event) {
      return Response.json(
        { error: 'trigger_event is required' },
        { status: 400 }
      );
    }

    // Get all active workflows matching this trigger
    const workflows = await base44.asServiceRole.entities.DocumentAutomationWorkflow.filter({
      trigger_event,
      is_active: true,
    });

    const results = [];

    for (const workflow of workflows) {
      try {
        // Fetch template
        const templates = await base44.asServiceRole.entities.DocumentSignatureTemplate.filter({
          id: workflow.template_id,
        });

        if (!templates || templates.length === 0) {
          console.error(`Template not found: ${workflow.template_id}`);
          continue;
        }

        const template = templates[0];
        let documentContent = template.content;
        const placeholderValues = {};

        // Process data sources
        for (const dataSource of workflow.data_sources || []) {
          try {
            let sourceData = {};

            if (dataSource.source_type === 'entity') {
              // Fetch from Base44 entity
              const entity = dataSource.source_reference;
              const entityData = await base44.asServiceRole.entities[entity].list();
              sourceData = entityData[0] || {};
            } else if (dataSource.source_type === 'api') {
              // Fetch from external API
              const response = await fetch(dataSource.source_reference, {
                headers: buildAuthHeaders(dataSource),
              });
              sourceData = await response.json();
            } else if (dataSource.source_type === 'manual') {
              // Use provided trigger data
              sourceData = trigger_data || {};
            }

            // Apply field mapping
            if (dataSource.mapping) {
              for (const [source, target] of Object.entries(dataSource.mapping)) {
                placeholderValues[target] = getNestedValue(sourceData, source);
              }
            }
          } catch (error) {
            console.error(`Error processing data source: ${error.message}`);
            logWorkflowError(workflow.id, error);
          }
        }

        // Replace placeholders in template
        for (const [key, value] of Object.entries(placeholderValues)) {
          const placeholder = `{{${key}}}`;
          documentContent = documentContent.replace(new RegExp(placeholder, 'g'), value || '');
        }

        // Create document record
        const documentRecord = await base44.asServiceRole.entities.DocumentRecord.create({
          document_name: `${workflow.workflow_name} - ${new Date().toLocaleDateString()}`,
          description: `Auto-generated from workflow: ${workflow.workflow_name}`,
          category: 'consent_form',
          file_url: '', // This would be populated after document is actually generated/stored
          file_name: `${workflow.workflow_name.replace(/\s+/g, '_')}_${Date.now()}.html`,
          file_type: 'text/html',
          file_size: documentContent.length,
          is_signed: workflow.signature_settings?.auto_sign || false,
        });

        // Handle signature if configured
        if (workflow.signature_settings?.send_to_signers) {
          for (const signerEmail of workflow.signature_settings.signer_emails || []) {
            // Send signing request
            await base44.integrations.Core.SendEmail({
              to: signerEmail,
              subject: `Sign: ${documentRecord.document_name}`,
              body: `Please sign the document: ${workflow.workflow_name}`,
            });
          }
        }

        // Execute post-generation actions
        for (const action of workflow.post_generation_actions || []) {
          if (action.action_type === 'send_email') {
            await base44.integrations.Core.SendEmail({
              to: action.action_target,
              subject: `Document Generated: ${workflow.workflow_name}`,
              body: `A new document has been generated: ${documentRecord.document_name}`,
            });
          }
        }

        // Update workflow stats
        await base44.asServiceRole.entities.DocumentAutomationWorkflow.update(workflow.id, {
          trigger_count: (workflow.trigger_count || 0) + 1,
          last_triggered: new Date().toISOString(),
        });

        results.push({
          workflow_id: workflow.id,
          document_id: documentRecord.id,
          status: 'success',
        });
      } catch (error) {
        console.error(`Error processing workflow ${workflow.id}: ${error.message}`);
        logWorkflowError(workflow.id, error);

        results.push({
          workflow_id: workflow.id,
          status: 'error',
          error: error.message,
        });
      }
    }

    return Response.json({
      triggered_count: results.length,
      results,
    });
  } catch (error) {
    console.error('Automation trigger error:', error);
    return Response.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
});

function getNestedValue(obj, path) {
  return path.split('.').reduce((curr, prop) => curr?.[prop], obj);
}

function buildAuthHeaders(dataSource) {
  const headers = { 'Content-Type': 'application/json' };

  if (dataSource.auth_type === 'api_key') {
    headers['X-API-Key'] = dataSource.auth_config?.api_key;
  } else if (dataSource.auth_type === 'bearer_token') {
    headers['Authorization'] = `Bearer ${dataSource.auth_config?.token}`;
  }

  return headers;
}

async function logWorkflowError(workflowId, error) {
  try {
    const base44 = Deno.env.get('BASE44_SERVICE_ROLE_KEY');
    // Log error for debugging
    console.error(`Workflow ${workflowId} error:`, error.message);
  } catch (e) {
    console.error('Failed to log workflow error:', e);
  }
}