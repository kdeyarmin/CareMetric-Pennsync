import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
    FileText, Mail, CheckCircle2, AlertCircle, Clock, 
    Brain, Send, RefreshCw 
} from "lucide-react";
import { toast } from "sonner";

export default function PreAppointmentFormManager({ appointmentId, patientId }) {
    const [processing, setProcessing] = useState(false);

    // Get forms for this appointment
    const { data: forms = [], refetch } = useQuery({
        queryKey: ['appointmentForms', appointmentId],
        queryFn: () => base44.entities.AppointmentForm.filter({ appointment_id: appointmentId }),
        enabled: !!appointmentId
    });

    const sendForms = async () => {
        setProcessing(true);
        try {
            const response = await base44.functions.invoke('sendPreAppointmentForms', {
                appointment_id: appointmentId
            });
            toast.success(response.data.message);
            refetch();
        } catch (error) {
            toast.error('Failed to send forms: ' + error.message);
        } finally {
            setProcessing(false);
        }
    };

    const analyzeForm = async (formId) => {
        try {
            const response = await base44.functions.invoke('analyzeFormCompleteness', {
                appointment_form_id: formId
            });
            toast.success('Form analyzed by AI');
            refetch();
        } catch (error) {
            toast.error('Analysis failed');
        }
    };

    const sendReminder = async (formId) => {
        try {
            await base44.functions.invoke('sendFormReminder', {
                appointment_form_id: formId
            });
            toast.success('Reminder sent');
            refetch();
        } catch (error) {
            toast.error('Failed to send reminder');
        }
    };

    const getStatusIcon = (status) => {
        switch (status) {
            case 'completed': return <CheckCircle2 className="w-4 h-4 text-green-600" />;
            case 'in_progress': return <Clock className="w-4 h-4 text-blue-600" />;
            case 'incomplete': return <AlertCircle className="w-4 h-4 text-amber-600" />;
            default: return <Mail className="w-4 h-4 text-slate-500" />;
        }
    };

    const getStatusColor = (status) => {
        switch (status) {
            case 'completed': return 'bg-green-100 text-green-800 border-green-300';
            case 'in_progress': return 'bg-blue-100 text-blue-800 border-blue-300';
            case 'incomplete': return 'bg-amber-100 text-amber-800 border-amber-300';
            default: return 'bg-slate-100 text-slate-700 border-slate-300';
        }
    };

    return (
        <Card className="border-slate-200">
            <CardHeader>
                <CardTitle className="flex items-center justify-between text-slate-800">
                    <div className="flex items-center gap-2">
                        <FileText className="w-5 h-5 text-slate-600" />
                        Pre-Appointment Forms
                    </div>
                    <Button 
                        size="sm" 
                        onClick={sendForms} 
                        disabled={processing}
                        className="bg-slate-700 hover:bg-slate-800 text-white"
                    >
                        {processing ? (
                            <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                        ) : (
                            <>
                                <Send className="w-3 h-3 mr-1" />
                                Send Forms
                            </>
                        )}
                    </Button>
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                {forms.length === 0 ? (
                    <div className="text-center py-6 text-slate-600">
                        <FileText className="w-8 h-8 mx-auto mb-2 text-slate-400" />
                        <p className="text-sm">No forms sent yet</p>
                        <p className="text-xs text-slate-500 mt-1">
                            Click "Send Forms" to automatically send required pre-appointment forms
                        </p>
                    </div>
                ) : (
                    forms.map((form) => (
                        <Card key={form.id} className="border-slate-200 hover:shadow-md transition-shadow">
                            <CardContent className="p-4 space-y-3">
                                <div className="flex items-start justify-between">
                                    <div className="space-y-1">
                                        <div className="flex items-center gap-2">
                                            {getStatusIcon(form.status)}
                                            <span className="font-medium text-slate-800">{form.form_name}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Badge className={getStatusColor(form.status)}>
                                                {form.status.replace('_', ' ')}
                                            </Badge>
                                            {form.ai_completeness_score !== undefined && (
                                                <Badge className="bg-slate-100 text-slate-700 border-slate-300">
                                                    <Brain className="w-3 h-3 mr-1" />
                                                    {form.ai_completeness_score}% complete
                                                </Badge>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex gap-1">
                                        <Button 
                                            size="sm" 
                                            variant="outline"
                                            onClick={() => analyzeForm(form.id)}
                                            className="border-slate-300 hover:bg-slate-50"
                                        >
                                            <Brain className="w-3 h-3" />
                                        </Button>
                                        <Button 
                                            size="sm" 
                                            variant="outline"
                                            onClick={() => sendReminder(form.id)}
                                            className="border-slate-300 hover:bg-slate-50"
                                        >
                                            <RefreshCw className="w-3 h-3" />
                                        </Button>
                                    </div>
                                </div>

                                {form.ai_completeness_score !== undefined && (
                                    <div className="space-y-1">
                                        <Progress value={form.ai_completeness_score} className="h-2" />
                                        <p className="text-xs text-slate-600">
                                            AI Completeness Score: {form.ai_completeness_score}%
                                        </p>
                                    </div>
                                )}

                                {form.missing_fields && form.missing_fields.length > 0 && (
                                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-2">
                                        <p className="text-xs font-medium text-amber-900 mb-1">
                                            Missing Fields:
                                        </p>
                                        <ul className="text-xs text-amber-800 space-y-0.5">
                                            {form.missing_fields.map((field, idx) => (
                                                <li key={idx}>• {field}</li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                {form.ai_analysis?.critical_concerns && form.ai_analysis.critical_concerns.length > 0 && (
                                    <div className="bg-red-50 border border-red-200 rounded-lg p-2">
                                        <p className="text-xs font-medium text-red-900 mb-1 flex items-center gap-1">
                                            <AlertCircle className="w-3 h-3" />
                                            Critical Concerns:
                                        </p>
                                        <ul className="text-xs text-red-800 space-y-0.5">
                                            {form.ai_analysis.critical_concerns.map((concern, idx) => (
                                                <li key={idx}>• {concern}</li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                <div className="flex items-center justify-between text-xs text-slate-500">
                                    <span>Sent: {new Date(form.sent_date).toLocaleDateString()}</span>
                                    {form.reminder_count > 0 && (
                                        <span>{form.reminder_count} reminder(s) sent</span>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    ))
                )}
            </CardContent>
        </Card>
    );
}