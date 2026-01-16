import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { credential_type } = body;

    if (!credential_type) {
      return Response.json({ error: 'credential_type is required' }, { status: 400 });
    }

    // Update ProviderSettings with new credential_type
    try {
      const providerSettings = await base44.entities.ProviderSettings.filter({
        provider_email: user.email
      });

      if (providerSettings.length > 0) {
        await base44.asServiceRole.entities.ProviderSettings.update(providerSettings[0].id, {
          credential_type: credential_type
        });
      }
    } catch (error) {
      console.log('Note: ProviderSettings update skipped (may not exist yet)', error.message);
    }

    // Update ProviderPracticeInfo with new credential_type
    try {
      const practiceInfo = await base44.entities.ProviderPracticeInfo.filter({
        provider_email: user.email
      });

      if (practiceInfo.length > 0) {
        await base44.asServiceRole.entities.ProviderPracticeInfo.update(practiceInfo[0].id, {
          credential_type: credential_type
        });
      }
    } catch (error) {
      console.log('Note: ProviderPracticeInfo update skipped (may not exist yet)', error.message);
    }

    // Update AIConfiguration with new provider type
    try {
      const aiConfig = await base44.entities.AIConfiguration.filter({
        user_email: user.email
      });

      if (aiConfig.length > 0) {
        await base44.asServiceRole.entities.AIConfiguration.update(aiConfig[0].id, {
          provider_type: credential_type
        });
      }
    } catch (error) {
      console.log('Note: AIConfiguration update skipped (may not exist yet)', error.message);
    }

    return Response.json({
      success: true,
      message: 'Provider type synced across all settings'
    });
  } catch (error) {
    console.error('Error syncing provider type:', error);
    return Response.json({
      error: error.message || 'Failed to sync provider type'
    }, { status: 500 });
  }
});