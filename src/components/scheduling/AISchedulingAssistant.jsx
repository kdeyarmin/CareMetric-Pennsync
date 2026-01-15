import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Brain, Calendar, Clock, AlertTriangle, CheckCircle2, Sparkles } from "lucide-react";
import { toast } from "sonner";

export default function AISchedulingAssistant({ patientId, providerEmail, appointmentType = "telehealth", onSlotSelected }) {
    const [loading, setLoading] = useState(false);
    const [suggestedSlots, setSuggestedSlots] = useState([]);
    const [conflicts, setConflicts] = useState(null);

    const getSuggestions = async () => {
        setLoading(true);
        try {
            const response = await base44.functions.invoke('suggestOptimalSlots', {
                patient_id: patientId,
                provider_email: providerEmail,
                appointment_type: appointmentType,
                duration_minutes: 30
            });

            setSuggestedSlots(response.data.suggested_slots);
            toast.success('AI found optimal appointment slots!');
        } catch (error) {
            toast.error('Failed to get suggestions: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    const checkConflicts = async (date, startTime, endTime) => {
        try {
            const response = await base44.functions.invoke('detectSchedulingConflicts', {
                appointment_date: date,
                start_time: startTime,
                end_time: endTime,
                provider_email: providerEmail,
                duration_minutes: 30
            });

            setConflicts(response.data);
            
            if (response.data.has_conflicts) {
                toast.warning('Conflicts detected - see resolutions');
            } else {
                toast.success('No conflicts - time slot is clear!');
            }
        } catch (error) {
            toast.error('Failed to check conflicts');
        }
    };

    const selectSlot = (slot) => {
        if (slot.has_conflict) {
            checkConflicts(slot.date, slot.start_time, slot.end_time);
            return;
        }
        
        onSlotSelected?.(slot);
        toast.success('Slot selected!');
    };

    return (
        <Card className="border-slate-200">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-slate-800">
                    <Brain className="w-5 h-5 text-slate-600" />
                    AI Scheduling Assistant
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <Button 
                    onClick={getSuggestions} 
                    disabled={loading}
                    className="w-full bg-slate-700 hover:bg-slate-800 text-white"
                >
                    {loading ? (
                        <>
                            <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2" />
                            Analyzing Schedule...
                        </>
                    ) : (
                        <>
                            <Sparkles className="w-4 h-4 mr-2" />
                            Get AI Suggestions
                        </>
                    )}
                </Button>

                {suggestedSlots.length > 0 && (
                    <div className="space-y-3">
                        <h3 className="text-sm font-semibold text-slate-700">Suggested Time Slots</h3>
                        {suggestedSlots.map((slot, idx) => (
                            <Card 
                                key={idx}
                                className={`cursor-pointer hover:border-slate-400 transition-all ${
                                    slot.has_conflict ? 'border-red-300 bg-red-50' : 'border-slate-200 hover:shadow-md'
                                }`}
                                onClick={() => selectSlot(slot)}
                            >
                                <CardContent className="p-4">
                                    <div className="flex items-start justify-between">
                                        <div className="space-y-2">
                                            <div className="flex items-center gap-2">
                                                <Calendar className="w-4 h-4 text-slate-600" />
                                                <span className="font-medium text-slate-800">{slot.date}</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Clock className="w-4 h-4 text-slate-600" />
                                                <span className="text-sm text-slate-700">{slot.start_time} - {slot.end_time}</span>
                                            </div>
                                            <p className="text-xs text-slate-600 mt-1">{slot.reason}</p>
                                        </div>
                                        <div className="flex flex-col items-end gap-2">
                                            <Badge className="bg-slate-100 text-slate-700 border-slate-300">
                                                {slot.confidence_score}% match
                                            </Badge>
                                            {slot.has_conflict ? (
                                                <Badge className="bg-red-100 text-red-700 border-red-300">
                                                    <AlertTriangle className="w-3 h-3 mr-1" />
                                                    Conflict
                                                </Badge>
                                            ) : (
                                                <Badge className="bg-green-100 text-green-700 border-green-300">
                                                    <CheckCircle2 className="w-3 h-3 mr-1" />
                                                    Available
                                                </Badge>
                                            )}
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                )}

                {conflicts && conflicts.has_conflicts && (
                    <Card className="border-amber-300 bg-amber-50">
                        <CardHeader>
                            <CardTitle className="text-sm text-amber-900 flex items-center gap-2">
                                <AlertTriangle className="w-4 h-4" />
                                Conflicts Detected
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            {conflicts.conflicts.map((conflict, idx) => (
                                <div key={idx} className="text-xs text-amber-800 p-2 bg-white rounded border border-amber-200">
                                    {conflict.message}
                                </div>
                            ))}
                            
                            {conflicts.suggested_resolutions && conflicts.suggested_resolutions.length > 0 && (
                                <div className="mt-4">
                                    <h4 className="text-sm font-semibold text-slate-700 mb-2">AI Suggested Alternatives:</h4>
                                    {conflicts.suggested_resolutions.map((res, idx) => (
                                        <Button
                                            key={idx}
                                            variant="outline"
                                            size="sm"
                                            className="w-full mb-2 justify-start text-left border-slate-300 hover:bg-slate-50"
                                            onClick={() => onSlotSelected?.({ 
                                                start_time: res.start_time, 
                                                end_time: res.end_time 
                                            })}
                                        >
                                            <Clock className="w-3 h-3 mr-2" />
                                            <div className="text-xs">
                                                <div className="font-medium">{res.start_time} - {res.end_time}</div>
                                                <div className="text-slate-600">{res.reason}</div>
                                            </div>
                                        </Button>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                )}
            </CardContent>
        </Card>
    );
}