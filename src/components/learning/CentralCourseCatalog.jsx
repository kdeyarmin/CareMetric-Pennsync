import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { GraduationCap, ExternalLink } from 'lucide-react';
import PageContainer from '@/components/ui/PageContainer';
import PageHeader from '@/components/ui/PageHeader';
import LoadingState from '@/components/ui/LoadingState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CENTRAL_MY_LEARNING_URL } from '@/lib/centralLearning';
import { listCentralLearningCourses } from '@/functions/listCentralLearningCourses';
import CentralCourseCard from '@/components/learning/CentralCourseCard';

export default function CentralCourseCatalog() {
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [category, setCategory] = useState('');
  const [offset, setOffset] = useState(0);
  useEffect(() => { const timer = setTimeout(() => { setTerm(search); setOffset(0); }, 300); return () => clearTimeout(timer); }, [search]);
  const catalog = useQuery({ queryKey: ['centralLearningCatalog', term, category, offset], queryFn: async () => {
    const response = await listCentralLearningCourses({ search: term, category, offset });
    if (response.data?.error) throw new Error(response.data.error);
    return response.data;
  }, retry: false });
  const data = catalog.data;
  return <PageContainer>
    <PageHeader icon={GraduationCap} title="Learning Center" eyebrow="Centralized education" description="Browse courses from the CareMetric Support Hub without leaving PennSync." favoritePage="LearningCenter" actions={<Button asChild variant="outline"><a href={CENTRAL_MY_LEARNING_URL} target="_blank" rel="noopener noreferrer">My Hub learning<ExternalLink className="ml-2 h-4 w-4" /></a></Button>} />
    <p className="text-sm text-muted-foreground">Course delivery and completion records stay with the Hub or the course’s existing CareBase provider. <Link className="text-primary underline" to="/LearningCenter?view=legacy">View existing PennSync training records</Link>.</p>
    <div className="flex flex-col gap-3 sm:flex-row">
      <Input aria-label="Search centralized courses" placeholder="Search courses and topics…" value={search} onChange={event => setSearch(event.target.value)} className="sm:flex-1" />
      <select aria-label="Filter courses by category" value={category} onChange={event => { setCategory(event.target.value); setOffset(0); }} className="rounded-md border border-input bg-background px-3 py-2 text-foreground sm:max-w-xs">
        <option value="">All categories</option>{data?.categories.map(value => <option key={value} value={value}>{value}</option>)}
      </select>
    </div>
    {catalog.isPending ? <LoadingState className="py-12" /> : catalog.isError ? <div role="alert" className="space-y-3"><p>Unable to load the Support Hub courses.</p><Button variant="outline" onClick={() => catalog.refetch()}>Try again</Button></div> : <>
      <p className="text-sm text-muted-foreground">{data.total} {data.total === 1 ? 'course' : 'courses'}{data.total > 0 && ` · Showing ${offset + 1}–${offset + data.items.length}`}</p>
      {data.items.length ? <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{data.items.map(course => <CentralCourseCard key={course.id} course={course} />)}</div> : <p className="py-8 text-center text-muted-foreground">{term || category ? 'No courses match your search.' : 'No published courses are available for PennSync yet.'}</p>}
      {(offset > 0 || data.next_offset !== null) && <div className="flex justify-center gap-3"><Button variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 12))}>Previous</Button><Button variant="outline" disabled={data.next_offset === null} onClick={() => setOffset(data.next_offset)}>Next</Button></div>}
    </>}
  </PageContainer>;
}