import React, { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, FileText, Loader2, BookOpen, Zap } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";

export default function GuideDownloadSection() {
  const [loadingFull, setLoadingFull] = useState(false);
  const [loadingQuick, setLoadingQuick] = useState(false);

  const downloadGuide = async (guideType) => {
    const setLoading = guideType === 'full' ? setLoadingFull : setLoadingQuick;
    setLoading(true);

    try {
      const response = await base44.functions.invoke('generateUserGuidePDF', {
        guide_type: guideType
      });
      const data = response.data || response;

      if (data.file_url) {
        const link = document.createElement('a');
        link.href = data.file_url;
        link.download = data.file_name;
        link.target = '_blank';
        document.body.appendChild(link);
        link.click();
        link.remove();
        toast.success(`${guideType === 'full' ? 'User Guide' : 'Quick Reference Guide'} downloaded!`);
      } else {
        toast.error('Failed to generate PDF');
      }
    } catch (error) {
      toast.error('Failed to generate guide: ' + (error.message || 'Unknown error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Full User Guide */}
      <Card className="border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950 dark:to-indigo-950 hover:shadow-lg transition-shadow">
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-blue-100 dark:bg-blue-900 rounded-xl flex-shrink-0">
              <BookOpen className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-semibold text-slate-900 dark:text-white">Complete User Guide</h3>
                <Badge variant="outline" className="text-[10px] border-blue-300 text-blue-700">PDF</Badge>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 mb-4">
                Comprehensive guide covering all features, workflows, settings, and best practices. Ideal for new users and reference.
              </p>
              <Button
                onClick={() => downloadGuide('full')}
                disabled={loadingFull}
                size="sm"
                className="w-full bg-blue-600 hover:bg-blue-700"
              >
                {loadingFull ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating...</>
                ) : (
                  <><Download className="w-4 h-4 mr-2" /> Download User Guide</>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quick Reference Guide */}
      <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950 dark:to-teal-950 hover:shadow-lg transition-shadow">
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-emerald-100 dark:bg-emerald-900 rounded-xl flex-shrink-0">
              <Zap className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-semibold text-slate-900 dark:text-white">Quick Reference Guide</h3>
                <Badge variant="outline" className="text-[10px] border-emerald-300 text-emerald-700">PDF</Badge>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 mb-4">
                One-page cheat sheet with essential workflows, navigation, and keyboard shortcuts. Perfect for quick lookup.
              </p>
              <Button
                onClick={() => downloadGuide('quick')}
                disabled={loadingQuick}
                size="sm"
                className="w-full bg-emerald-600 hover:bg-emerald-700"
              >
                {loadingQuick ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating...</>
                ) : (
                  <><Download className="w-4 h-4 mr-2" /> Download Quick Reference</>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}