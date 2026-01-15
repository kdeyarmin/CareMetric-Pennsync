import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Brain, Mail, Star, Calendar, CheckCircle2, Clock, AlertCircle } from "lucide-react";
import { toast } from "sonner";

export default function PostAppointmentFollowUp({ appointmentId, patientName, appointmentDate }) {
    const [processing, setProcessing] = useState(false);
    const [results, setResults] = useState(null);

    const triggerFollowUp = async () => {
        setProcessing(true);
        try {
            const response = await base44.functions.invoke('handlePostAppointmentFollowUp', {
                appointment_id: appointmentId
            });

            setResults(response.data.results);
            toast.success('Post-appointment follow-up initiated!');
        } catch (error) {
            toast.error('Failed to trigger follow-up: ' + error.message);
        } finally {
            setProcessing(false);
        }
    };

    const sendSurvey = async () => {
        try {
            await base44.functions.invoke('sendSatisfactionSurvey', {
                appointment_id: appointmentId
            });
            toast.success('Satisfaction survey sent!');
        } catch (error) {
            toast.error('Failed to send survey');
        }
    };

    const requestReview = async () => {
        try {
            await base44.functions.invoke('requestPatientReview', {
                appointment_id: appointmentId
            });
            toast.success('Review request sent!');
        } catch (error) {
            toast.error('Failed to send review request');
        }
    };

    const analyzeFollowUp = async () => {
        try {
            const response = await base44.functions.invoke('analyzeFollowUpNeeds', {
                appointment_id: appointmentId
            });
            setResults({ followup_analysis: response.data });
            toast.success('AI analysis complete!');
        } catch (error) {
            toast.error('Failed to analyze');
        }
    };

    return (
        <Card className="border-slate-200">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-slate-800">
                    <Brain className="w-5 h-5 text-slate-600" />
                    Post-Appointment Follow-Up
                </CardTitle>
                <p className="text-sm text-slate-600">
                    {patientName} • {appointmentDate}
                </p>
            </CardHeader>
            <CardContent className="space-y-4">
                <Button 
                    onClick={triggerFollowUp} 
                    disabled={processing}
                    className="w-full bg-slate-700 hover:bg-slate-800 text-white"
                >
                    {processing ? (
                        <>
                            <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2" />
                            Processing...
                        </>
                    ) : (
                        <>
                            <Brain className="w-4 h-4 mr-2" />
                            Auto-Process All Follow-Ups
                        </>
                    )}
                </Button>

                <div className="grid grid-cols-3 gap-2">
                    <Button 
                        variant="outline" 
                        size="sm"
                        onClick={sendSurvey}
                        className="border-slate-300 hover:bg-slate-50"
                    >
                        <Mail className="w-3 h-3 mr-1" />
                        Survey
                    </Button>
                    <Button 
                        variant="outline" 
                        size="sm"
                        onClick={requestReview}
                        className="border-slate-300 hover:bg-slate-50"
                    >
                        <Star className="w-3 h-3 mr-1" />
                        Review
                    </Button>
                    <Button 
                        variant="outline" 
                        size="sm"
                        onClick={analyzeFollowUp}
                        className="border-slate-300 hover:bg-slate-50"
                    >
                        <Calendar className="w-3 h-3 mr-1" />
                        Analyze
                    </Button>
                </div>

                {results && (
                    <div className="space-y-3 mt-4">
                        {results.satisfaction_survey && (
                            <Card className="border-green-200 bg-green-50">
                                <CardContent className="p-3">
                                    <div className="flex items-center gap-2">
                                        <CheckCircle2 className="w-4 h-4 text-green-600" />
                                        <span className="text-sm text-green-800 font-medium">
                                            Satisfaction survey sent
                                        </span>
                                    </div>
                                </CardContent>
                            </Card>
                        )}

                        {results.followup_analysis?.analysis && (
                            <Card className={`border-slate-200 ${
                                results.followup_analysis.analysis.needs_followup ? 'bg-amber-50 border-amber-300' : 'bg-slate-50'
                            }`}>
                                <CardContent className="p-3 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm font-medium text-slate-800">
                                            Follow-Up Assessment
                                        </span>
                                        {results.followup_analysis.analysis.needs_followup ? (
                                            <Badge className="bg-amber-100 text-amber-800 border-amber-300">
                                                <AlertCircle className="w-3 h-3 mr-1" />
                                                Needed
                                            </Badge>
                                        ) : (
                                            <Badge className="bg-green-100 text-green-700 border-green-300">
                                                <CheckCircle2 className="w-3 h-3 mr-1" />
                                                Not Required
                                            </Badge>
                                        )}
                                    </div>
                                    {results.followup_analysis.analysis.needs_followup && (
                                        <>
                                            <p className="text-xs text-slate-700">
                                                <strong>Recommended:</strong> {results.followup_analysis.analysis.recommended_timeframe}
                                            </p>
                                            <p className="text-xs text-slate-700">
                                                <strong>Reason:</strong> {results.followup_analysis.analysis.reason}
                                            </p>
                                            {results.followup_analysis.task_created && (
                                                <div className="flex items-center gap-1 text-xs text-green-700 mt-1">
                                                    <CheckCircle2 className="w-3 h-3" />
                                                    Task automatically created
                                                </div>
                                            )}
                                        </>
                                    )}
                                </CardContent>
                            </Card>
                        )}

                        {results.review_request?.scheduled && (
                            <Card className="border-blue-200 bg-blue-50">
                                <CardContent className="p-3">
                                    <div className="flex items-center gap-2">
                                        <Clock className="w-4 h-4 text-blue-600" />
                                        <span className="text-sm text-blue-800">
                                            Review request scheduled in {results.review_request.in_days} days
                                        </span>
                                    </div>
                                </CardContent>
                            </Card>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}