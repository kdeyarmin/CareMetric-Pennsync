import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Edit2, Trash2, BookOpen, Eye } from "lucide-react";
import CourseForm from "./CourseForm";
import { createPageUrl } from "@/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export default function CourseManager() {
  const [selectedCourse, setSelectedCourse] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [businessLineFilter, setBusinessLineFilter] = useState('all');
  const queryClient = useQueryClient();

  const { data: allCourses = [] } = useQuery({
    queryKey: ['training-courses'],
    queryFn: () => base44.entities.TrainingCourse.list('-created_date', 100),
    initialData: [],
  });

  const courses = allCourses.filter(course => {
    if (categoryFilter !== 'all' && course.category !== categoryFilter) return false;
    if (statusFilter !== 'all' && course.status !== statusFilter) return false;
    if (businessLineFilter !== 'all' && course.business_line_scope !== businessLineFilter) return false;
    return true;
  });

  const deleteMutation = useMutation({
    mutationFn: (courseId) => base44.entities.TrainingCourse.delete(courseId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['training-courses'] });
    },
  });

  const getCategoryColor = (category) => {
    const colors = {
      compliance: 'bg-blue-100 text-blue-800',
      clinical: 'bg-green-100 text-green-800',
      safety: 'bg-yellow-100 text-yellow-800',
      documentation: 'bg-navy-100 text-navy-800',
      onboarding: 'bg-indigo-100 text-indigo-800',
      leadership: 'bg-red-100 text-red-800',
    };
    return colors[category] || 'bg-slate-100 text-slate-800';
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h2 className="text-xl font-bold">Training Courses</h2>
        <Dialog open={showForm} onOpenChange={setShowForm}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Add Course
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <div className="bg-white rounded-2xl">
              <DialogHeader>
                <DialogTitle>{selectedCourse ? 'Edit Course' : 'Create New Course'}</DialogTitle>
              </DialogHeader>
              <CourseForm
                course={selectedCourse}
                onSuccess={() => {
                  setShowForm(false);
                  setSelectedCourse(null);
                  queryClient.invalidateQueries({ queryKey: ['training-courses'] });
                }}
              />
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-[200px]">
              <label htmlFor="course-category-filter" className="text-sm font-medium text-slate-700 mb-2 block">Category</label>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger id="course-category-filter">
                  <SelectValue placeholder="All Categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  <SelectItem value="compliance">Compliance</SelectItem>
                  <SelectItem value="clinical">Clinical</SelectItem>
                  <SelectItem value="safety">Safety</SelectItem>
                  <SelectItem value="documentation">Documentation</SelectItem>
                  <SelectItem value="hospice">Hospice</SelectItem>
                  <SelectItem value="home_health">Home Health</SelectItem>
                  <SelectItem value="dme">DME</SelectItem>
                  <SelectItem value="onboarding">Onboarding</SelectItem>
                  <SelectItem value="leadership">Leadership</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 min-w-[200px]">
              <label htmlFor="course-status-filter" className="text-sm font-medium text-slate-700 mb-2 block">Status</label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger id="course-status-filter">
                  <SelectValue placeholder="All Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="pending_review">Pending Review</SelectItem>
                  <SelectItem value="published">Published</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 min-w-[200px]">
              <label htmlFor="course-business-line-filter" className="text-sm font-medium text-slate-700 mb-2 block">Business Line</label>
              <Select value={businessLineFilter} onValueChange={setBusinessLineFilter}>
                <SelectTrigger id="course-business-line-filter">
                  <SelectValue placeholder="All Business Lines" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Business Lines</SelectItem>
                  <SelectItem value="home_health">Home Health</SelectItem>
                  <SelectItem value="hospice">Hospice</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="mt-3 text-sm text-slate-600">
            Showing {courses.length} of {allCourses.length} courses
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {courses.length > 0 ? (
          courses.map((course) => (
            <Card key={course.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">{course.title}</CardTitle>
                    <Badge className={`mt-2 ${getCategoryColor(course.category)}`}>
                      {course.category}
                    </Badge>
                  </div>
                  <Badge className={course.status === 'published' ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-800'}>
                    {course.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm mb-4">
                  <p><span className="text-slate-600">Estimated Time:</span> {course.estimated_minutes} mins</p>
                  <p><span className="text-slate-600">Passing Score:</span> {course.passing_score}%</p>
                  <p><span className="text-slate-600">Required:</span> {course.is_mandatory ? 'Yes' : 'No'}</p>
                </div>
                <div className="flex gap-2">
                  <Link to={`${createPageUrl('TrainingCoursePlayer')}?courseId=${course.id}&preview=true`}>
                    <Button variant="outline" size="sm">
                      <Eye className="w-4 h-4 mr-1" />
                      Preview
                    </Button>
                  </Link>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSelectedCourse(course);
                      setShowForm(true);
                    }}
                  >
                    <Edit2 className="w-4 h-4" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="sm">
                        <Trash2 className="w-4 h-4 text-red-600" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete Course</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to delete &ldquo;{course.title}&rdquo;? This action cannot be undone and will remove all associated modules and questions.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-red-600 hover:bg-red-700"
                          onClick={() => deleteMutation.mutate(course.id)}
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardContent>
            </Card>
          ))
        ) : (
          <Card className="col-span-full">
            <CardContent className="py-12 text-center">
              <BookOpen className="w-12 h-12 mx-auto mb-3 text-slate-300" />
              <p className="text-slate-600">No courses yet. Create your first course!</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}