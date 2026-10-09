import { Clock, ExternalLink } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export default function CentralCourseCard({ course }) {
  return <Card className="flex flex-col bg-card text-card-foreground">
    <CardContent className="flex flex-1 flex-col gap-3 p-5">
      <Badge variant="outline" className="self-start">{course.category || 'CareMetric training'}</Badge>
      <h3 className="text-lg font-semibold text-foreground">{course.title}</h3>
      <p className="text-sm text-muted-foreground">{course.summary}</p>
      <div className="mt-auto space-y-3 pt-2">
        {course.duration_minutes && <span className="flex items-center gap-1 text-sm text-muted-foreground"><Clock className="h-4 w-4" />{course.duration_minutes} minutes</span>}
        <p className="text-xs text-muted-foreground">Delivered in {course.delivery}. Sign in there to complete training.</p>
        {course.url ? <Button asChild className="w-full"><a href={course.url} target="_blank" rel="noopener noreferrer">Open course<ExternalLink className="ml-2 h-4 w-4" /></a></Button>
          : <p className="text-sm text-muted-foreground">This course is awaiting a delivery link.</p>}
      </div>
    </CardContent>
  </Card>;
}