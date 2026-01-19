import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    // Only allow GET requests
    if (req.method !== 'GET') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const url = new URL(req.url);
    const embedToken = url.pathname.split('/').pop();

    // Get the origin from the request
    const origin = req.headers.get('origin');

    if (!embedToken) {
      return new Response(JSON.stringify({ error: 'Invalid embed token' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const base44 = createClientFromRequest(req);

    // Find the embed config
    const embedConfigs = await base44.asServiceRole.entities.EmbedConfig.filter({
      embed_token: embedToken,
    });

    if (!embedConfigs || embedConfigs.length === 0) {
      return new Response(JSON.stringify({ error: 'Embed not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const embedConfig = embedConfigs[0];

    // Check if embed is active
    if (embedConfig.status !== 'active') {
      return new Response(JSON.stringify({ error: 'Embed is not active' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check expiration
    if (embedConfig.expiration_date) {
      const expirationDate = new Date(embedConfig.expiration_date);
      if (new Date() > expirationDate) {
        // Auto-deactivate expired embed
        await base44.asServiceRole.entities.EmbedConfig.update(embedConfig.id, {
          status: 'expired',
        });
        return new Response(JSON.stringify({ error: 'Embed has expired' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Check view limit
    if (embedConfig.max_views && embedConfig.view_count >= embedConfig.max_views) {
      return new Response(JSON.stringify({ error: 'View limit exceeded' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate domain origin
    const cleanOrigin = origin ? origin.replace('https://', '').replace('http://', '') : null;
    const allowedDomains = embedConfig.allowed_domains || [];
    
    let isDomainAllowed = false;
    if (cleanOrigin) {
      isDomainAllowed = allowedDomains.some((domain) => {
        return cleanOrigin === domain || cleanOrigin.endsWith('.' + domain);
      });
    }

    if (!isDomainAllowed && allowedDomains.length > 0) {
      return new Response(
        JSON.stringify({ error: 'Domain not authorized for this embed' }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Get the document
    const document = await base44.asServiceRole.entities.DocumentRecord.filter({
      id: embedConfig.document_id,
    });

    if (!document || document.length === 0) {
      return new Response(JSON.stringify({ error: 'Document not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const documentData = document[0];

    // Increment view count
    await base44.asServiceRole.entities.EmbedConfig.update(embedConfig.id, {
      view_count: (embedConfig.view_count || 0) + 1,
    });

    // Build response data based on permissions
    const responseData = {
      id: documentData.id,
      document_name: documentData.document_name,
      file_url: documentData.file_url,
      file_type: documentData.file_type,
    };

    if (embedConfig.show_metadata) {
      responseData.category = documentData.category;
      responseData.uploaded_date = documentData.created_date;
      responseData.signature_status = documentData.signature_status;
    }

    if (embedConfig.show_signature_fields) {
      responseData.signature_fields = embedConfig.signature_fields || [];
    }

    responseData.permissions = {
      allow_download: embedConfig.allow_download,
      allow_print: embedConfig.allow_print,
    };

    return new Response(JSON.stringify(responseData), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': origin || '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch (error) {
    console.error('Error serving embedded document:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
});