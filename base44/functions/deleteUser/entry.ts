import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    // Admin-only function
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const { user_id, user_email } = await req.json();

    if (!user_id) {
      return Response.json({ error: 'user_id is required' }, { status: 400 });
    }

    // Prevent deleting yourself
    if (user_id === user.id) {
      return Response.json({ error: 'Cannot delete your own account' }, { status: 400 });
    }

    console.log(`Deleting user: ${user_id} (${user_email})`);

    // Delete user from User entity using service role
    await base44.asServiceRole.entities.User.delete(user_id);

    // Optional: Clean up related data
    // Delete user's subscriptions
    try {
      const userSubscriptions = await base44.asServiceRole.entities.Subscription.filter({
        user_email: user_email
      });
      for (const sub of userSubscriptions) {
        await base44.asServiceRole.entities.Subscription.delete(sub.id);
      }
      console.log(`Deleted ${userSubscriptions.length} subscription(s) for user`);
    } catch (error) {
      console.error('Error deleting subscriptions:', error);
    }

    // Log the deletion activity
    try {
      await base44.asServiceRole.entities.AuditTrail.create({
        timestamp: new Date().toISOString(),
        user_email: user.email,
        action: 'delete_user',
        entity_type: 'User',
        entity_id: user_id,
        details: {
          deleted_user_email: user_email,
          deleted_by_admin: user.email
        }
      });
    } catch (error) {
      console.error('Error logging audit trail:', error);
    }

    return Response.json({
      success: true,
      message: 'User deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting user:', error);
    return Response.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
});