import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    const payload = await req.json();
    const { workflow_id, trigger_data } = payload;

    if (!workflow_id) {
      return Response.json(
        { error: 'workflow_id is required' },
        { status: 400 }
      );
    }

    // Fetch the workflow
    const workflows = await base44.asServiceRole.entities.DocumentAutomationWorkflow.filter({
      id: workflow_id
    });

    if (!workflows || workflows.length === 0) {
      return Response.json(
        { error: 'Workflow not found' },
        { status: 404 }
      );
    }

    const workflow = workflows[0];
    const results = [];

    // Evaluate conditional branches
    let activeBranch = null;
    if (workflow.conditional_branches && workflow.conditional_branches.length > 0) {
      for (const branch of workflow.conditional_branches) {
        if (evaluateCondition(branch.condition, trigger_data)) {
          activeBranch = branch;
          break;
        }
      }
    }

    // Get template (use branch override or workflow template)
    let templateId = workflow.template_id;
    if (activeBranch?.template_id_override) {
      templateId = activeBranch.template_id_override;
    }

    const templates = await base44.asServiceRole.entities.DocumentSignatureTemplate.filter({
      id: templateId
    });

    if (!templates || templates.length === 0) {
      throw new Error(`Template not found: ${templateId}`);
    }

    const template = templates[0];
    let documentContent = template.content;
    const placeholderValues = {};

    // Process data sources
    for (const dataSource of workflow.data_sources || []) {
      try {
        let sourceData = {};

        if (dataSource.source_type === 'entity') {
          const entity = dataSource.source_reference;
          const entityData = await base44.asServiceRole.entities[entity].list();
          sourceData = entityData[0] || {};
        } else if (dataSource.source_type === 'api') {
          const response = await fetch(dataSource.source_reference, {
            headers: buildAuthHeaders(dataSource),
          });
          sourceData = await response.json();
        } else if (dataSource.source_type === 'manual') {
          sourceData = trigger_data || {};
        }

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

    // Replace placeholders
    for (const [key, value] of Object.entries(placeholderValues)) {
      const placeholder = `{{${key}}}`;
      documentContent = documentContent.replace(new RegExp(placeholder, 'g'), value || '');
    }

    // Create document record
    const documentRecord = await base44.asServiceRole.entities.DocumentRecord.create({
      document_name: `${workflow.workflow_name} - ${new Date().toLocaleDateString()}`,
      description: `Auto-generated from workflow: ${workflow.workflow_name}${activeBranch ? ` (${activeBranch.branch_name})` : ''}`,
      category: 'consent_form',
      file_url: '',
      file_name: `${workflow.workflow_name.replace(/\s+/g, '_')}_${Date.now()}.html`,
      file_type: 'text/html',
      file_size: documentContent.length,
      is_signed: workflow.signature_settings?.auto_sign || false,
    });

    // Extract metadata if enabled
    if (workflow.ai_enrichment?.enabled && (activeBranch?.extract_metadata || workflow.ai_enrichment?.extract_summary || workflow.ai_enrichment?.extract_keywords)) {
      try {
        const metadataResponse = await base44.asServiceRole.functions.invoke('extractDocumentMetadata', {
          document_content: documentContent,
          max_summary_length: workflow.ai_enrichment?.max_summary_length || 300
        });

        if (metadataResponse?.metadata) {
          // Store metadata with document
          await base44.asServiceRole.entities.DocumentRecord.update(documentRecord.id, {
            metadata: metadataResponse.metadata
          });

          results.push({
            document_id: documentRecord.id,
            metadata: metadataResponse.metadata
          });
        }
      } catch (error) {
        console.error(`Error extracting metadata: ${error.message}`);
      }
    }

    // Handle signatures
    if (workflow.signature_settings?.send_to_signers) {
      for (const signerEmail of workflow.signature_settings.signer_emails || []) {
        await base44.integrations.Core.SendEmail({
          to: signerEmail,
          subject: `Sign: ${documentRecord.document_name}`,
          body: `Please sign the document: ${workflow.workflow_name}`,
        });
      }
    }

    // Execute post-generation actions (use branch overrides if available)
    const actions = activeBranch?.action_overrides || workflow.post_generation_actions || [];
    for (const action of actions) {
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
      branch_id: activeBranch?.branch_id || 'default',
      status: 'success',
    });

    return Response.json({
      success: true,
      results,
    });
  } catch (error) {
    console.error('Conditional automation trigger error:', error);
    return Response.json(
      { 
        success: false,
        error: error.message || 'Internal server error',
        details: error.message
      },
      { status: 500 }
    );
  }
});

function evaluateCondition(condition, data) {
  const value = getNestedValue(data, condition.field);

  switch (condition.operator) {
    case 'equals':
      return value == condition.value;
    case 'not_equals':
      return value != condition.value;
    case 'greater_than':
      return Number(value) > Number(condition.value);
    case 'less_than':
      return Number(value) < Number(condition.value);
    case 'contains':
      return String(value).includes(condition.value);
    case 'matches_regex':
      return new RegExp(condition.value).test(String(value));
    default:
      return false;
  }
}

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
    console.error(`Workflow ${workflowId} error:`, error.message);
  } catch (e) {
    console.error('Failed to log workflow error:', e);
  }
}