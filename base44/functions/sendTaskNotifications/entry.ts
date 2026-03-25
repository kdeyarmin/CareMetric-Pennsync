import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Get all pending and in-progress tasks
    const tasks = await base44.asServiceRole.entities.Task.filter({
      status: { "$in": ["pending", "in_progress"] }
    });

    const now = new Date();
    const today = now.toISOString().split('T')[0];
    
    let notificationsSent = 0;
    
    for (const task of tasks) {
      if (!task.notification_preferences?.enabled) continue;
      if (!task.due_date) continue;
      
      const dueDate = new Date(task.due_date);
      const hoursDiff = (dueDate - now) / (1000 * 60 * 60);
      
      // Check if we should send notification
      const shouldNotify = 
        // Overdue notification
        (hoursDiff < 0 && task.notification_preferences.notify_on_overdue) ||
        // Due soon notification
        (hoursDiff > 0 && hoursDiff <= (task.notification_preferences.notify_before_hours || 24));
      
      if (!shouldNotify) continue;
      
      // Check if we already sent notification recently (within 12 hours)
      if (task.last_notification_sent) {
        const lastSent = new Date(task.last_notification_sent);
        const hoursSinceLastNotification = (now - lastSent) / (1000 * 60 * 60);
        if (hoursSinceLastNotification < 12) continue;
      }
      
      // Prepare notification email
      const isOverdue = hoursDiff < 0;
      const subject = isOverdue 
        ? `⚠️ Overdue Task: ${task.title}`
        : `🔔 Task Due Soon: ${task.title}`;
      
      const body = `
      <h2>${subject}</h2>
      
      <p><strong>Task:</strong> ${task.title}</p>
      ${task.description ? `<p><strong>Description:</strong> ${task.description}</p>` : ''}
      
      <p><strong>Priority:</strong> ${task.priority.toUpperCase()}</p>
      <p><strong>Due Date:</strong> ${task.due_date}${task.due_time ? ` at ${task.due_time}` : ''}</p>
      
      ${isOverdue 
        ? '<p style="color: red; font-weight: bold;">⚠️ This task is overdue. Please complete it as soon as possible.</p>'
        : `<p>This task is due in approximately ${Math.round(hoursDiff)} hours.</p>`
      }
      
      ${task.ai_reason ? `<p><strong>Reason:</strong> ${task.ai_reason}</p>` : ''}
      
      <p>Please log in to your CareMetric AI account to manage this task.</p>
      `;
      
      try {
         // Validate task assignment
         if (!task.assigned_to) {
           console.warn(`Task ${task.id} has no assigned_to email, skipping notification`);
           continue;
         }

         // Send email notification
         await base44.asServiceRole.integrations.Core.SendEmail({
           to: task.assigned_to,
           subject,
           body
         });
        
        // Update last notification sent timestamp
        await base44.asServiceRole.entities.Task.update(task.id, {
          last_notification_sent: now.toISOString()
        });
        
        notificationsSent++;
      } catch (emailError) {
        console.error(`Failed to send notification for task ${task.id}:`, emailError);
      }
    }
    
    return Response.json({
      success: true,
      notifications_sent: notificationsSent,
      tasks_checked: tasks.length
    });
    
  } catch (error) {
    console.error('Task notification error:', error);
    return Response.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
});