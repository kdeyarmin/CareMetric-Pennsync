import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { visitId, visitNotes, patientId } = await req.json();

    if (!visitNotes || !patientId) {
      return Response.json(
        { error: 'visitNotes and patientId are required' },
        { status: 400 }
      );
    }

    // Authorize against the patient (assigned nurse or admin) before writing a
    // SupplyUsageLog stamped with this patient_id and decrementing shared
    // SupplyItem inventory. RLS-independent code check (mirrors getScopedPatientAlerts).
    const [supplyPatient] = await base44.asServiceRole.entities.Patient.filter({ id: patientId }, '', 1);
    if (!supplyPatient) return Response.json({ error: 'Patient not found' }, { status: 404 });
    if (user.role !== 'admin' && supplyPatient.created_by !== user.email && !(Array.isArray(supplyPatient.assigned_nurses) && supplyPatient.assigned_nurses.includes(user.email))) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Use LLM to extract supply/medication usage from visit notes
    const extractionPrompt = `You are a clinical documentation analyzer. Extract all medications and medical supplies mentioned as being used or administered during this visit. For each supply/medication, identify:
1. Name of the medication or supply
2. Quantity used (extract the number)
3. Unit of measurement (tablets, ml, boxes, etc.)
4. Indication/purpose of use

Return as JSON array with objects: { name, quantity, unit, purpose }. Only include items actually used/administered, not just mentioned.

Visit Notes: "${visitNotes}"

Return ONLY valid JSON array, no other text.`;

    // Call LLM integration
    const analysisResult = await base44.integrations.Core.InvokeLLM({
      prompt: extractionPrompt,
      model: 'claude_opus_4_8',
      response_json_schema: {
        type: 'object',
        properties: {
          supplies: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                quantity: { type: 'number' },
                unit: { type: 'string' },
                purpose: { type: 'string' }
              }
            }
          }
        }
      }
    });

    const extractedSupplies = analysisResult?.supplies || [];

    // Look up each supply in SupplyItem entity (bounded to the SDK's 5000/request max)
    const allSupplies = await base44.asServiceRole.entities.SupplyItem.list('-created_date', 5000);
    const usageLogs = [];
    const alertsToCreate = [];

    for (const extracted of extractedSupplies) {
      // The LLM schema marks no field required, so guard against a missing name
      // or a non-numeric/zero quantity: an unchecked value would throw on
      // .toLowerCase() or write NaN into the shared SupplyItem inventory.
      const qty = Number(extracted?.quantity);
      if (!extracted?.name || !Number.isFinite(qty) || qty <= 0) continue;

      // Find matching supply (case-insensitive fuzzy match)
      const extractedName = extracted.name.toLowerCase();
      const matchedSupply = allSupplies.find(s =>
        typeof s.name === 'string' && (
          s.name.toLowerCase().includes(extractedName) ||
          extractedName.includes(s.name.toLowerCase())
        )
      );

      if (matchedSupply) {
        // Create usage log
        const usageLog = await base44.asServiceRole.entities.SupplyUsageLog.create({
          supply_id: matchedSupply.id,
          supply_name: matchedSupply.name,
          patient_id: patientId,
          visit_id: visitId,
          quantity_used: qty,
          unit: extracted.unit,
          usage_date: new Date().toISOString().split('T')[0],
          documented_by: user.email,
          extracted_from_note: true,
          extraction_confidence: 85,
          notes: extracted.purpose
        });

        usageLogs.push(usageLog);

        // Update supply inventory
        const newQuantity = Math.max(0, (Number(matchedSupply.current_quantity) || 0) - qty);
        await base44.asServiceRole.entities.SupplyItem.update(matchedSupply.id, {
          current_quantity: newQuantity,
          status: newQuantity === 0 ? 'out_of_stock' : 
                  newQuantity <= matchedSupply.low_stock_threshold ? 'low_stock' : 'in_stock',
          last_updated: new Date().toISOString()
        });

        // Check if alert needed
        if (newQuantity <= matchedSupply.low_stock_threshold) {
          const severity = newQuantity === 0 ? 'out_of_stock' : 
                          newQuantity <= (matchedSupply.low_stock_threshold * 0.3) ? 'critical' : 'warning';

          // Check if alert already exists
          const existingAlerts = await base44.asServiceRole.entities.SupplyLowStockAlert.filter({
            supply_id: matchedSupply.id,
            status: 'active'
          });

          if (existingAlerts.length === 0) {
            const alert = await base44.asServiceRole.entities.SupplyLowStockAlert.create({
              supply_id: matchedSupply.id,
              supply_name: matchedSupply.name,
              current_quantity: newQuantity,
              threshold_quantity: matchedSupply.low_stock_threshold,
              recommended_reorder: matchedSupply.reorder_quantity,
              severity,
              status: 'active',
              triggered_date: new Date().toISOString()
            });

            // Auto-create reorder task
            const task = await base44.asServiceRole.entities.Task.create({
              title: `Reorder ${matchedSupply.name}`,
              description: `${matchedSupply.name} is ${severity === 'out_of_stock' ? 'out of stock' : 'running low'}. Current: ${newQuantity} ${matchedSupply.unit}, recommend reordering ${matchedSupply.reorder_quantity} units.`,
              status: 'pending',
              priority: severity === 'critical' ? 'high' : severity === 'out_of_stock' ? 'high' : 'medium',
              assigned_to: user.email,
              due_date: new Date().toISOString().split('T')[0]
            });

            // Link task to alert
            await base44.asServiceRole.entities.SupplyLowStockAlert.update(alert.id, {
              reorder_task_created: true,
              task_id: task.id
            });

            alertsToCreate.push(alert);
          }
        }
      }
    }

    return Response.json({
      success: true,
      usageLogs: usageLogs.length,
      alertsCreated: alertsToCreate.length,
      alerts: alertsToCreate
    });
  } catch (error) {
    console.error('Supply analysis error:', error);
    return Response.json(
      { error: error.message },
      { status: 500 }
    );
  }
});