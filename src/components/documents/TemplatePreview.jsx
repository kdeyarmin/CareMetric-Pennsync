import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function TemplatePreview({ content }) {
  return (
    <Card className="border-slate-300 dark:border-slate-600">
      <CardHeader>
        <CardTitle className="text-base">Live Preview</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="prose prose-sm dark:prose-invert max-w-none bg-white dark:bg-slate-900 p-4 rounded border border-slate-200 dark:border-slate-700">
          <div dangerouslySetInnerHTML={{ __html: content }} />
        </div>
      </CardContent>
    </Card>
  );
}