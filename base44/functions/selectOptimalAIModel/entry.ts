import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Intelligently selects the optimal AI model and parameters based on:
 * - Provider type and specialty
 * - Task complexity
 * - Context requirements
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { 
      taskType, 
      providerType, 
      complexity = 'medium',
      requiresWebSearch = false,
      patientContext = null 
    } = await req.json();

    // Check for custom configurations first
    const customConfigs = await base44.entities.AIModelConfiguration.filter({
      provider_type: providerType,
      task_type: taskType,
      is_active: true
    }, '-version');

    // Handle A/B testing if enabled
    let selectedConfig = null;
    if (customConfigs.length > 0) {
      const abTestConfigs = customConfigs.filter(c => c.is_ab_test);
      
      if (abTestConfigs.length > 0) {
        // A/B test active - select based on weights
        selectedConfig = selectABTestVariant(abTestConfigs, user.email);
      } else {
        // Use latest non-test configuration
        selectedConfig = customConfigs[0];
      }
    }

    // If custom config exists, use it
    if (selectedConfig) {
      const finalConfig = {
        model: selectedConfig.model,
        temperature: selectedConfig.temperature,
        max_tokens: selectedConfig.max_tokens,
        system_prompt: selectedConfig.system_prompt,
        requiresWebSearch,
        configuration_id: selectedConfig.id,
        ab_test_group: selectedConfig.ab_test_group || null,
        is_custom: true,
        features: {
          useProviderSettings: true,
          includeRegulatoryContext: ['compliance_check', 'note_enhancement'].includes(taskType),
          includePatientHistory: patientContext ? true : false,
          structuredOutput: ['compliance_check', 'risk_analysis', 'care_plan'].includes(taskType)
        }
      };

      // Track usage
      await trackConfigurationUsage(base44, selectedConfig.id);

      return Response.json({
        success: true,
        config: finalConfig,
        explanation: `Using custom configuration v${selectedConfig.version} for ${providerType} ${taskType}${selectedConfig.is_ab_test ? ` (Test Group ${selectedConfig.ab_test_group})` : ''}`
      });
    }

    // Provider-specific model preferences
    const providerModelMap = {
      'NP': { model: 'gpt-4o', temperature: 0.2, max_tokens: 3000 }, // Nurse Practitioners need detailed clinical reasoning
      'MD': { model: 'gpt-4o', temperature: 0.2, max_tokens: 3000 }, // Physicians need comprehensive analysis
      'DO': { model: 'gpt-4o', temperature: 0.2, max_tokens: 3000 },
      'PT': { model: 'gpt-4o', temperature: 0.3, max_tokens: 2500 }, // Physical therapy specific
      'OT': { model: 'gpt-4o', temperature: 0.3, max_tokens: 2500 },
      'ST': { model: 'gpt-4o', temperature: 0.3, max_tokens: 2500 }, // Speech therapy
      'MSW': { model: 'gpt-4o', temperature: 0.4, max_tokens: 2500 }, // Social work - more narrative
      'Chiropractor': { model: 'gpt-4o', temperature: 0.3, max_tokens: 2000 },
      'RN': { model: 'gpt-4o', temperature: 0.3, max_tokens: 2500 },
      'LPN': { model: 'gpt-4o', temperature: 0.3, max_tokens: 2000 }
    };

    // Task-specific model preferences
    const taskModelMap = {
      'note_enhancement': { model: 'gpt-4o', temperature: 0.3 },
      'compliance_check': { model: 'gpt-4o', temperature: 0.2 }, // Stricter for compliance
      'clinical_decision': { model: 'gpt-4o', temperature: 0.2 },
      'patient_education': { model: 'gpt-4o', temperature: 0.5 }, // More creative for education
      'care_plan': { model: 'gpt-4o', temperature: 0.3 },
      'risk_analysis': { model: 'gpt-4o', temperature: 0.2 },
      'documentation': { model: 'gpt-4o', temperature: 0.3 },
      'general_chat': { model: 'gpt-4o', temperature: 0.7 } // More conversational
    };

    // Complexity adjustments
    const complexityAdjustments = {
      'low': { temperature_delta: 0, max_tokens: 1500 },
      'medium': { temperature_delta: 0, max_tokens: 2500 },
      'high': { temperature_delta: -0.1, max_tokens: 4000 } // Lower temp for complex tasks
    };

    // Start with provider preferences
    const baseConfig = providerModelMap[providerType] || providerModelMap['RN'];
    
    // Override with task-specific preferences
    const taskConfig = taskModelMap[taskType] || {};
    
    // Apply complexity adjustments
    const complexityConfig = complexityAdjustments[complexity] || complexityAdjustments['medium'];

    // Build final configuration
    const finalConfig = {
      model: taskConfig.model || baseConfig.model,
      temperature: Math.max(0.1, Math.min(1.0, 
        (taskConfig.temperature || baseConfig.temperature) + complexityConfig.temperature_delta
      )),
      max_tokens: complexityConfig.max_tokens || baseConfig.max_tokens,
      requiresWebSearch,
      
      // Provider-specific system prompt enhancements
      systemPromptEnhancement: getProviderPromptEnhancement(providerType, taskType),
      
      // Recommended features
      features: {
        useProviderSettings: true,
        includeRegulatoryContext: ['compliance_check', 'note_enhancement'].includes(taskType),
        includePatientHistory: patientContext ? true : false,
        structuredOutput: ['compliance_check', 'risk_analysis', 'care_plan'].includes(taskType)
      }
    };

    // Log model selection for analytics
    await base44.entities.UserActivity.create({
      user_email: user.email,
      user_name: user.full_name,
      action: 'ai_model_selected',
      details: {
        taskType,
        providerType,
        complexity,
        selectedModel: finalConfig.model,
        temperature: finalConfig.temperature
      },
      page: 'ai_model_selector'
    });

    return Response.json({
      success: true,
      config: finalConfig,
      explanation: `Selected ${finalConfig.model} with temperature ${finalConfig.temperature} for ${providerType} performing ${taskType} task`
    });

  } catch (error) {
    console.error('AI model selection error:', error);
    return Response.json({ 
      success: false, 
      error: error.message,
      // Fallback configuration
      config: {
        model: 'gpt-4o',
        temperature: 0.3,
        max_tokens: 2500
      }
    }, { status: 500 });
  }
});

function getProviderPromptEnhancement(providerType, taskType) {
  const enhancements = {
    'NP': 'You are assisting a Nurse Practitioner with advanced practice authority. Focus on differential diagnosis, prescriptive decision-making, and comprehensive assessment.',
    'MD': 'You are assisting a Medical Doctor. Emphasize medical decision-making, diagnostic reasoning, and evidence-based treatment protocols.',
    'DO': 'You are assisting a Doctor of Osteopathic Medicine. Consider holistic assessment and osteopathic principles.',
    'PT': 'You are assisting a Physical Therapist. Focus on functional mobility, therapeutic exercises, and rehabilitation goals.',
    'OT': 'You are assisting an Occupational Therapist. Emphasize activities of daily living, adaptive equipment, and functional independence.',
    'ST': 'You are assisting a Speech Therapist. Focus on communication, swallowing, and cognitive-linguistic interventions.',
    'MSW': 'You are assisting a Medical Social Worker. Emphasize psychosocial assessment, resource coordination, and support systems.',
    'Chiropractor': 'You are assisting a Chiropractor. Focus on musculoskeletal assessment, spinal alignment, and conservative care.',
    'RN': 'You are assisting a Registered Nurse in home health. Focus on skilled nursing interventions, patient education, and care coordination.',
    'LPN': 'You are assisting a Licensed Practical Nurse. Focus on delegated tasks, medication administration, and vital sign monitoring under RN supervision.'
  };

  return enhancements[providerType] || enhancements['RN'];
}

function selectABTestVariant(configs, userEmail) {
  // Use user email hash for consistent variant assignment
  const hash = userEmail.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const randomValue = (hash % 100);
  
  // Sort by weight and select based on cumulative weights
  const sortedConfigs = configs.sort((a, b) => (b.ab_test_weight || 50) - (a.ab_test_weight || 50));
  let cumulativeWeight = 0;
  
  for (const config of sortedConfigs) {
    cumulativeWeight += (config.ab_test_weight || 50);
    if (randomValue < cumulativeWeight) {
      return config;
    }
  }
  
  // Fallback to first config
  return sortedConfigs[0];
}

async function trackConfigurationUsage(base44, configId) {
  try {
    const config = await base44.entities.AIModelConfiguration.filter({ id: configId });
    if (config[0]) {
      const metrics = config[0].performance_metrics || {};
      await base44.entities.AIModelConfiguration.update(configId, {
        performance_metrics: {
          ...metrics,
          total_uses: (metrics.total_uses || 0) + 1
        }
      });
    }
  } catch (error) {
    console.error('Error tracking usage:', error);
  }
}