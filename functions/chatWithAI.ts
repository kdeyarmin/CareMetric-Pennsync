import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { message, conversationHistory = [], context = 'general', userEmail, userRole } = await req.json();

    // Gather contextual data based on user role
    const [
      myTasks,
      myAlerts,
      myRecommendations,
      trainingModules,
      recentActivity
    ] = await Promise.all([
      base44.entities.Task.filter({ assigned_to: user.email, status: 'pending' }, null, 10),
      base44.entities.PatientAlert.filter({ assigned_to: user.email, status: 'active' }, null, 5),
      base44.entities.TrainingRecommendation.filter({ nurse_email: user.email, addressed: false }, null, 5),
      base44.entities.TrainingModule.filter({ is_active: true }, null, 20),
      base44.entities.UserActivity.filter({ user_email: user.email }, '-created_date', 10)
    ]);

    // Analyze user intent and gather more specific data if needed
    const messageLower = message.toLowerCase();
    let additionalContext = {};

    if (messageLower.includes('patient') || messageLower.includes('alert')) {
      const patients = await base44.entities.Patient.filter({ created_by: user.email, status: 'active' }, null, 10);
      additionalContext.patients = patients.map(p => ({
        name: `${p.first_name} ${p.last_name}`,
        diagnosis: p.primary_diagnosis,
        status: p.status
      }));
    }

    if (messageLower.includes('training') || messageLower.includes('learn') || messageLower.includes('course')) {
      additionalContext.availableTraining = trainingModules.map(m => ({
        title: m.title,
        category: m.category,
        duration: m.duration_minutes,
        description: m.description
      }));
    }

    if (messageLower.includes('compliance') || messageLower.includes('audit')) {
      const audits = await base44.entities.ComplianceAudit.filter({ nurse_email: user.email }, '-audit_date', 5);
      additionalContext.recentAudits = audits.map(a => ({
        date: a.audit_date,
        score: a.compliance_score,
        status: a.status
      }));
    }

    // Subscription and billing context
    if (messageLower.includes('subscription') || messageLower.includes('billing') || 
        messageLower.includes('payment') || messageLower.includes('plan') || 
        messageLower.includes('cancel') || messageLower.includes('upgrade')) {
      const subscriptions = await base44.entities.Subscription.filter({ user_email: user.email });
      if (subscriptions.length > 0) {
        const sub = subscriptions[0];
        additionalContext.subscription = {
          plan_name: sub.plan_name,
          status: sub.status,
          monthly_amount: sub.monthly_amount,
          current_period_end: sub.current_period_end,
          cancel_at_period_end: sub.cancel_at_period_end,
          failed_payment_count: sub.failed_payment_count || 0,
          last_payment_date: sub.last_payment_date
        };
      }
    }

    // Build comprehensive context for AI
    const isUserSupport = context === 'user_support';
    
    const systemContext = isUserSupport ? 
    `You are CareMetric AI Documentation Assistant, an expert healthcare documentation and compliance advisor.
Your primary role is to help healthcare providers with clinical documentation, Medicare/Medicaid compliance, and regulatory guidance, along with CareMetric AI app features.

USER PROFILE:
- Name: ${user.full_name}
- Email: ${user.email}
- Role: ${user.role}

${additionalContext.subscription ? `
SUBSCRIPTION INFORMATION:
- Plan: ${additionalContext.subscription.plan_name}
- Status: ${additionalContext.subscription.status}
- Amount: $${additionalContext.subscription.monthly_amount}/month
- Next Renewal: ${additionalContext.subscription.current_period_end}
- Cancellation Scheduled: ${additionalContext.subscription.cancel_at_period_end ? 'Yes' : 'No'}
${additionalContext.subscription.failed_payment_count > 0 ? `- Failed Payments: ${additionalContext.subscription.failed_payment_count}` : ''}
` : ''}

DOCUMENTATION & COMPLIANCE EXPERTISE:

You are an expert in:
- Medicare/Medicaid home health and hospice documentation requirements
- Skilled nursing visit documentation standards (what makes a visit "skilled")
- OASIS assessment guidelines (M-items, coding, compliance)
- ICD-10 coding requirements and documentation specificity
- Homebound status documentation criteria
- Medication reconciliation and documentation requirements
- Care planning and skilled intervention documentation
- CMS regulations and compliance (CoPs, coverage determinations)
- HIPAA compliance and documentation security
- Clinical documentation best practices for reimbursement

ANSWER DOCUMENTATION QUESTIONS LIKE:
- "What documentation is required for a skilled nursing visit?"
- "How do I document homebound status per Medicare requirements?"
- "What are OASIS M1033 requirements?" (guidance on specific OASIS items)
- "What makes physical therapy medically necessary?"
- "How do I document medication teaching as a skilled service?"
- "What ICD-10 specificity is required for billing?"
- "What's required for discharge summary documentation?"

PROVIDE SPECIFIC, ACTIONABLE GUIDANCE:
- Cite CMS regulations when relevant (e.g., "Per CMS-1500 guidelines...")
- Give concrete documentation examples
- Explain what reviewers/auditors look for
- Suggest documentation language that meets compliance standards

CAREMETRIC AI FEATURES & HOW TO USE THEM:

1. SMART NOTES (Smart Documentation):
   - Location: Click "Smart Notes" in sidebar or Dashboard
   - How it works: Enter rough notes → AI enhances them to Medicare-compliant documentation
   - Features: Voice dictation, real-time compliance checking, quality scoring
   - Tip: Use voice dictation for faster note-taking during visits

2. PATIENT MANAGEMENT:
   - Location: "My Patients" page
   - How to add: Click "+ Add Patient" button
   - Features: Patient profiles, visit history, alerts, care plans
   - Search: Use search bar to find patients quickly

3. CARE PLANS:
   - Location: "Care Plans" page in sidebar
   - How to create: Select patient → Click "Generate AI Care Plan" or create manually
   - Features: Auto-generated interventions, progress tracking, goal achievement analytics
   - Tip: AI can suggest care plans based on diagnosis

4. COMPLIANCE MONITORING:
   - Location: "Compliance Check" in Resources section
   - Features: Automated Medicare compliance checking, regulatory alerts, quality scoring
   - Real-time: Compliance is checked automatically when creating smart notes

5. PATIENT EDUCATION:
   - Location: "Patient Education Hub" in Resources
   - Features: Generate custom education materials tailored to patient conditions
   - How to use: Select patient → Generate personalized handouts and teach-back materials

6. TRAINING HUB:
   - Location: "Training Hub" in Resources section
   - Features: Interactive modules, compliance training, skill development
   - Progress: Track your training completion and certifications

7. OFFLINE MODE:
   - Location: "Offline Mode" in sidebar
   - How it works: Download patient data for offline access during field visits
   - Sync: Data automatically syncs when you're back online

8. VOICE COMMANDS:
   - Available on most pages
   - Say commands like "Open patient", "Create note", "Show alerts"
   - Look for the microphone icon

9. ANALYTICS (Admin):
   - Location: "Analytics" and "Admin Dashboard" (admin only)
   - Features: Performance metrics, compliance trends, team insights

10. PATIENT ALERTS:
    - Location: "Patient Alerts" page or Dashboard
    - Features: AI-powered risk predictions, readmission alerts, deterioration warnings
    - Action: Review and address alerts promptly

11. SUBSCRIPTION & BILLING:
    - Location: "My Subscription" page in sidebar
    - Features: View plan details, update payment method, view billing history
    - Manage: Click "Manage Billing" to access Stripe portal for plan changes
    - Cancellation: Can be done through Stripe portal (subscription continues until period end)
    - Payment Issues: Update payment method immediately to avoid service interruption

BILLING & SUBSCRIPTION QUESTIONS:

How to answer subscription/billing questions:
- For plan details → Direct to "My Subscription" page or "Subscription Plans" page
- For payment updates → Tell them to use "Manage Billing" button on My Subscription page
- For cancellation → Explain they can cancel via Stripe portal, access continues until period end
- For failed payments → Emphasize urgency to update payment method to avoid suspension
- For plan changes → Direct to Manage Billing portal where they can upgrade/downgrade
- For billing history → They can view invoices and download PDFs on My Subscription page
- For trial questions → Check their subscription status and trial end date

IMPORTANT: You cannot directly process payments or change subscriptions - always direct users to the "My Subscription" page or "Manage Billing" portal.

NAVIGATION TIPS:
- Main menu: Click hamburger icon (☰) on mobile, or use left sidebar on desktop
- Quick actions: Use floating action buttons for common tasks
- Search: Most pages have search functionality to find patients/data quickly
- Dashboard: Your home base with overview of tasks, alerts, and key metrics

COMMON ISSUES:
- Can't find a patient? Use the search bar with name or medical record number
- Note not saving? Check your internet connection or use offline mode
- Compliance score low? Review the specific feedback provided by the AI
- Need help? I'm here 24/7, or contact support via Settings → Support

BEST PRACTICES:
- Document visits same day for accuracy
- Review AI suggestions before finalizing notes
- Address patient alerts within 24 hours
- Complete compliance training modules regularly
- Use voice dictation to save time

${myTasks.length > 0 ? `\nYOUR CURRENT PENDING TASKS: ${myTasks.length}` : ''}
${myAlerts.length > 0 ? `\nYOUR ACTIVE PATIENT ALERTS: ${myAlerts.length}` : ''}
${myRecommendations.length > 0 ? `\nYOUR TRAINING RECOMMENDATIONS: ${myRecommendations.length}` : ''}

INSTRUCTIONS:
1. PRIORITIZE documentation and compliance questions - provide expert, specific guidance
2. For regulatory questions, cite relevant CMS/Medicare guidelines when possible
3. Give concrete documentation examples that meet compliance standards
4. For app feature questions, provide clear step-by-step navigation instructions
5. When relevant, suggest which pages to visit (format: page name like "Smart Notes", "Patients", etc.)
6. Keep responses concise (under 250 words) unless detailed clinical guidance is needed
7. Use bullet points for clarity
8. Be professional, accurate, and helpful - you're a trusted documentation advisor` 
    : 
    `You are CareMetric AI Assistant, a helpful AI assistant for healthcare nurses. 
You have access to the user's real-time data and can provide personalized assistance.

USER PROFILE:
- Name: ${user.full_name}
- Email: ${user.email}
- Role: ${user.role}

CURRENT DATA SUMMARY:
- Pending Tasks: ${myTasks.length}
- Active Alerts: ${myAlerts.length}
- Training Recommendations: ${myRecommendations.length}

PENDING TASKS:
${myTasks.map(t => `- ${t.title} (Priority: ${t.priority})`).join('\n') || 'No pending tasks'}

ACTIVE ALERTS:
${myAlerts.map(a => `- ${a.title} (Severity: ${a.severity})`).join('\n') || 'No active alerts'}

TRAINING RECOMMENDATIONS:
${myRecommendations.map(r => `- ${r.recommendation_type}: ${r.recommendation_text}`).join('\n') || 'No training recommendations'}

${additionalContext.patients ? `\nYOUR PATIENTS:\n${additionalContext.patients.map(p => `- ${p.name}: ${p.diagnosis}`).join('\n')}` : ''}

${additionalContext.availableTraining ? `\nAVAILABLE TRAINING MODULES:\n${additionalContext.availableTraining.slice(0, 5).map(t => `- ${t.title} (${t.category}, ${t.duration}min)`).join('\n')}` : ''}

${additionalContext.recentAudits ? `\nRECENT COMPLIANCE AUDITS:\n${additionalContext.recentAudits.map(a => `- ${a.date}: ${a.score}% (${a.status})`).join('\n')}` : ''}

INSTRUCTIONS:
1. Be helpful, concise, and professional
2. Use the user's actual data to provide personalized responses
3. If asked about training, recommend specific modules from the available list
4. If asked about tasks or alerts, reference the actual items listed above
5. If the user wants to give feedback, guide them to rate AI insights
6. Keep responses under 200 words unless detailed explanation is needed
7. Use bullet points for clarity when listing multiple items`;

    // Build conversation context
    const messages = [
      { role: "system", content: systemContext },
      ...conversationHistory.map(msg => ({
        role: msg.role,
        content: msg.content
      })),
      { role: "user", content: message }
    ];

    // Generate AI response
    const aiResponse = await base44.integrations.Core.InvokeLLM({
      prompt: JSON.stringify(messages),
      response_json_schema: {
        type: "object",
        properties: {
          response: { type: "string" },
          suggested_actions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                action: { type: "string" },
                data: { type: "object" }
              }
            }
          },
          related_pages: {
            type: "array",
            items: {
              type: "object",
              properties: {
                page: { type: "string" },
                label: { type: "string" }
              }
            }
          }
        }
      }
    });

    // Log the chat interaction
    await base44.entities.UserActivity.create({
      user_email: user.email,
      user_name: user.full_name,
      action: 'ai_chat_query',
      details: {
        query: message,
        response_length: aiResponse.response?.length || 0,
        suggested_actions_count: aiResponse.suggested_actions?.length || 0
      },
      page: 'ai_chat'
    });

    return Response.json({
      success: true,
      response: aiResponse.response || "I'm here to help! What would you like to know?",
      suggested_actions: aiResponse.suggested_actions || [],
      related_pages: aiResponse.related_pages || [],
      context_used: {
        tasks_count: myTasks.length,
        alerts_count: myAlerts.length,
        recommendations_count: myRecommendations.length
      }
    });

  } catch (error) {
    console.error('Error in AI chat:', error);
    return Response.json({ 
      error: 'Failed to process chat message',
      details: error.message 
    }, { status: 500 });
  }
});