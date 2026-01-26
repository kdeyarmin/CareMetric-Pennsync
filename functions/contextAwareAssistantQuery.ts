import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const SYSTEM_PROMPTS = {
  OASIS: `You are a healthcare documentation expert specializing in OASIS (Outcome and Assessment Information Set) requirements. Provide detailed guidance on OASIS fields, documentation standards, compliance rules, data collection best practices, and regulatory requirements. Include specific examples and references to CMS guidelines when relevant.`,
  
  Compliance: `You are a healthcare compliance specialist with expertise in HIPAA, CMS Conditions of Participation, state regulations, and quality standards. Help users understand regulatory requirements, document appropriately, identify compliance risks, and implement best practices. Cite relevant regulations and provide actionable guidance.`,
  
  SmartNoteAssistant: `You are a clinical documentation quality expert. Help users improve note writing, understand medical terminology, suggest relevant clinical details, ensure regulatory compliance, and enhance documentation clarity. Provide specific examples based on the clinical context provided.`,
  
  CarePlanManagement: `You are an expert care coordinator and care plan specialist. Help users develop comprehensive, evidence-based care plans aligned with patient goals, diagnoses, and regulatory requirements. Suggest appropriate interventions and goals.`,
  
  BillingOptimization: `You are a healthcare billing and coding specialist. Provide guidance on ICD-10, CPT, HCPCS codes, billing regulations, compliance, and revenue optimization. Help users understand billing requirements and identify coding opportunities while maintaining accuracy and compliance.`,
  
  DocumentGenerator: `You are a healthcare documentation specialist. Help users understand document types, templates, regulatory requirements for various documents, improve document quality, and ensure clinical accuracy and compliance.`,
  
  default: `You are a knowledgeable healthcare AI assistant with expertise in clinical documentation, healthcare regulations, platform features, and best practices. Help users with their questions while maintaining accuracy and regulatory compliance.`
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { query, currentPage, patientContext, visitContext, conversationHistory = [] } = await req.json();

    if (!query) {
      return new Response(
        JSON.stringify({ error: 'Query is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Select appropriate system prompt based on current page
    const systemPrompt = SYSTEM_PROMPTS[currentPage] || SYSTEM_PROMPTS.default;

    // Build context string
    let contextString = `Current Module: ${currentPage}\n`;
    if (patientContext) {
      contextString += `Patient Context: Name: ${patientContext.name}, Age: ${patientContext.age}, Primary Diagnosis: ${patientContext.diagnosis}\n`;
    }
    if (visitContext) {
      contextString += `Visit Context: Type: ${visitContext.type}, Date: ${visitContext.date}, Provider: ${visitContext.provider}\n`;
    }

    // Build messages array for conversation
    const messages = [
      ...conversationHistory,
      {
        role: "user",
        content: query
      }
    ];

    // Call LLM with context and conversation history
    const response = await base44.integrations.Core.InvokeLLM({
      prompt: `${systemPrompt}

${contextString}

${conversationHistory.length > 0 ? 'Continue this conversation:' : 'User Query:'}
${messages.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n')}`,
      add_context_from_internet: true
    });

    // Log for audit trail
    await base44.asServiceRole.entities.SystemLog.create({
      timestamp: new Date().toISOString(),
      user_email: user.email,
      action: 'ai_assistant_query',
      details: {
        page: currentPage,
        query_length: query.length,
        response_length: response.length
      }
    });

    return new Response(
      JSON.stringify({ response }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('AI Assistant Query Error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Failed to process query' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});