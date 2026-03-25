import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { message, conversation_history = [] } = await req.json();

    // Build context about CareMetric AI
    const appContext = `
You are a helpful sales assistant for CareMetric AI, an AI-powered clinical documentation platform for home health nurses.

KEY INFORMATION ABOUT CAREMETRIC AI:

Features:
- AI Smart Notes: Transform rough notes into Medicare-compliant documentation in seconds, saving 70% of documentation time
- Voice Dictation: Hands-free documentation with medical terminology recognition
- Real-time Compliance Checking: Live feedback on Medicare compliance (42 CFR 484)
- Patient Analytics: AI-powered risk prediction for readmissions, falls, and deterioration
- Care Plan Management: AI generates evidence-based care plans automatically
- Patient Education: Generate personalized education materials
- Clinical Decision Support: Medication interaction alerts, deterioration prediction
- Task Management: AI prioritizes tasks based on urgency and patient risk
- Training Hub: Personalized learning recommendations based on documentation patterns
- Offline Mode: Document visits without internet connection

Benefits:
- Save 2-3 hours daily on documentation
- 70% reduction in charting time
- 99% Medicare compliance rate
- 30% reduction in patient hospitalizations
- Reduce stress and compliance anxiety
- Better patient outcomes through predictive analytics
- HIPAA compliant and secure

How It Works:
1. Document your visit using voice or typing rough notes
2. AI enhances notes to Medicare-compliant format
3. Review, adjust, and submit with confidence

Pricing:
- Contact us for custom pricing based on agency size
- Free trial available

Getting Started:
- Sign up on the homepage
- No credit card required for trial
- Full onboarding support provided

Security:
- Bank-level encryption
- Full HIPAA compliance
- Secure data storage
- SOC 2 compliant

Target Users:
- Home health nurses
- Hospice nurses
- Home health agencies
- Independent nurses

Answer questions naturally and conversationally. If asked about pricing details, suggest they contact sales or sign up for a demo. Always be helpful and emphasize the time-saving and patient outcome benefits.
`;

    // Build conversation context
    const conversationContext = conversation_history
      .slice(-6) // Last 3 exchanges
      .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
      .join('\n');

    // Call LLM
    const response = await base44.integrations.Core.InvokeLLM({
      prompt: `${appContext}

Previous conversation:
${conversationContext}

User's new question: ${message}

Provide a helpful, friendly response. Keep it concise (2-3 paragraphs max). If appropriate, suggest they try the free trial or contact us for more details.`,
    });

    return Response.json({
      response: response,
      success: true
    });

  } catch (error) {
    console.error('Prospect chatbot error:', error);
    return Response.json(
      { 
        error: 'Failed to process message',
        response: "I apologize for the inconvenience. Please try again or contact us directly for assistance."
      },
      { status: 500 }
    );
  }
});