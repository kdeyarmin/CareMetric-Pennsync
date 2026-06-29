import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Award, Calendar, Clock, CheckCircle2, AlertCircle } from 'lucide-react';
import CertificateDownloadButton from './CertificateDownloadButton';

export default function CertificateViewer({ certificate }) {
    if (!certificate) {
        return null;
    }

    const isExpired = certificate.expiration_date && new Date(certificate.expiration_date) < new Date();
    const isRevoked = certificate.revoked;

    const formatDate = (dateString) => {
        if (!dateString) return 'N/A';
        return new Date(dateString).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    };

    return (
        <Card className="modern-card">
            <CardHeader>
                <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-blue-100">
                            <Award className="h-6 w-6 text-blue-600" />
                        </div>
                        <div>
                            <CardTitle className="text-lg">{certificate.course_title}</CardTitle>
                            <p className="text-sm text-slate-500 mt-1">Certificate ID: {certificate.certificate_id}</p>
                        </div>
                    </div>
                    {isRevoked ? (
                        <Badge variant="destructive" className="gap-1">
                            <AlertCircle className="h-3 w-3" />
                            Revoked
                        </Badge>
                    ) : isExpired ? (
                        <Badge variant="outline" className="gap-1 border-amber-300 text-amber-700 bg-amber-50">
                            <Clock className="h-3 w-3" />
                            Expired
                        </Badge>
                    ) : (
                        <Badge className="gap-1 bg-green-100 text-green-700 border-green-300">
                            <CheckCircle2 className="h-3 w-3" />
                            Valid
                        </Badge>
                    )}
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <p className="text-xs text-slate-500 mb-1">Completed</p>
                        <div className="flex items-center gap-2">
                            <Calendar className="h-4 w-4 text-slate-400" />
                            <span className="text-sm font-medium">{formatDate(certificate.completion_date)}</span>
                        </div>
                    </div>
                    <div>
                        <p className="text-xs text-slate-500 mb-1">Issued</p>
                        <div className="flex items-center gap-2">
                            <Calendar className="h-4 w-4 text-slate-400" />
                            <span className="text-sm font-medium">{formatDate(certificate.issued_at)}</span>
                        </div>
                    </div>
                    {certificate.expiration_date && (
                        <div>
                            <p className="text-xs text-slate-500 mb-1">Expires</p>
                            <div className="flex items-center gap-2">
                                <Clock className="h-4 w-4 text-slate-400" />
                                <span className={`text-sm font-medium ${isExpired ? 'text-red-600' : ''}`}>
                                    {formatDate(certificate.expiration_date)}
                                </span>
                            </div>
                        </div>
                    )}
                    {certificate.score !== null && certificate.score !== undefined && (
                        <div>
                            <p className="text-xs text-slate-500 mb-1">Score</p>
                            <span className="text-sm font-medium">{certificate.score}%</span>
                        </div>
                    )}
                    {certificate.hours && (
                        <div>
                            <p className="text-xs text-slate-500 mb-1">CEU Hours</p>
                            <span className="text-sm font-medium">{certificate.hours}</span>
                        </div>
                    )}
                    {certificate.training_category && (
                        <div>
                            <p className="text-xs text-slate-500 mb-1">Category</p>
                            <Badge variant="outline" className="text-xs">{certificate.training_category}</Badge>
                        </div>
                    )}
                </div>

                {certificate.verification_hash && (
                    <div className="pt-3 border-t">
                        <p className="text-xs text-slate-500 mb-1">Verification Code</p>
                        <code className="text-xs bg-slate-100 px-2 py-1 rounded font-mono">
                            {certificate.verification_hash.substring(0, 16).toUpperCase()}
                        </code>
                    </div>
                )}

                {!isRevoked && (
                    <div className="pt-2">
                        <CertificateDownloadButton 
                            certificate={certificate}
                            size="default"
                            variant="default"
                        />
                    </div>
                )}

                {isRevoked && certificate.revoked_reason && (
                    <div className="pt-3 border-t">
                        <p className="text-xs text-red-600 font-medium">Revocation Reason:</p>
                        <p className="text-sm text-slate-700 mt-1">{certificate.revoked_reason}</p>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}