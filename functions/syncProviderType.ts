import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  let user;
  try {
    const base44 = createClientFromRequest(req);
    user = await base44.auth.me();

    if (!user) {
      console.error('[syncProviderType] Unauthorized access attempt');
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { credential_type } = body;

    if (!credential_type) {
      console.error('[syncProviderType] Missing credential_type');
      return Response.json({ error: 'credential_type is required' }, { status: 400 });
    }

    console.log('[syncProviderType] Syncing provider type to:', credential_type, 'for user:', user.email);

    let updatedCount = 0;

    // Update ProviderSettings with new credential_type
    try {
      const providerSettings = await base44.entities.ProviderSettings.filter({
        provider_email: user.email
      });

      if (providerSettings.length > 0) {
        await base44.asServiceRole.entities.ProviderSettings.update(providerSettings[0].id, {
          credential_type: credential_type
        });
        updatedCount++;
        console.log('[syncProviderType] Updated ProviderSettings');
      }
    } catch (error) {
      console.warn('[syncProviderType] ProviderSettings update skipped (may not exist yet):', error.message);
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
        updatedCount++;
        console.log('[syncProviderType] Updated ProviderPracticeInfo');
      }
    } catch (error) {
      console.warn('[syncProviderType] ProviderPracticeInfo update skipped (may not exist yet):', error.message);
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
        updatedCount++;
        console.log('[syncProviderType] Updated AIConfiguration');
      }
    } catch (error) {
      console.warn('[syncProviderType] AIConfiguration update skipped (may not exist yet):', error.message);
    }

    console.log('[syncProviderType] Sync complete. Updated', updatedCount, 'records');

    return Response.json({
      success: true,
      message: 'Provider type synced across all settings',
      updated_count: updatedCount
    });
  } catch (error) {
    console.error('[syncProviderType] Error:', {
      message: error.message,
      stack: error.stack,
      userEmail: user?.email
    });
    return Response.json({
      error: 'Failed to sync provider type',
      details: error.message
    }, { status: 500 });
  }
});