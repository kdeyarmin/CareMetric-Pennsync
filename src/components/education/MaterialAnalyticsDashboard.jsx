import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line } from 'recharts';
import { Eye, Star, TrendingUp, Users } from 'lucide-react';

export default function MaterialAnalyticsDashboard() {
  const { data: allMaterials = [] } = useQuery({
    queryKey: ['allEducationMaterials'],
    queryFn: () => base44.entities.PatientEducationMaterial.list(),
  });

  const { data: allInteractions = [] } = useQuery({
    queryKey: ['allMaterialInteractions'],
    queryFn: () => base44.entities.MaterialInteraction.list(),
  });

  const { data: allAssignments = [] } = useQuery({
    queryKey: ['allEducationAssignments'],
    queryFn: () => base44.entities.PatientEducationAssignment.list(),
  });

  const analytics = useMemo(() => {
    if (!allMaterials.length) return {};

    const materialStats = allMaterials.map((material) => {
      const interactions = allInteractions.filter(
        (i) => i.material_id === material.id
      );
      const views = interactions.filter((i) => i.interaction_type === 'view').length;
      const reads = interactions.filter((i) => i.interaction_type === 'read').length;
      const ratings = interactions.filter(
        (i) => i.interaction_type === 'rating' && i.rating
      );
      const avgRating =
        ratings.length > 0
          ? (ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length).toFixed(1)
          : 0;
      const assignments = allAssignments.filter(
        (a) => a.material_id === material.id
      ).length;
      const completedAssignments = allAssignments.filter(
        (a) => a.material_id === material.id && a.status === 'completed'
      ).length;

      return {
        title: material.title,
        materialId: material.id,
        views,
        reads,
        assignments,
        completionRate: assignments > 0 ? ((completedAssignments / assignments) * 100).toFixed(0) : 0,
        rating: avgRating,
        ratingCount: ratings.length,
      };
    });

    const sortedByViews = [...materialStats].sort((a, b) => b.views - a.views).slice(0, 8);
    const sortedByRating = [...materialStats]
      .filter((m) => m.ratingCount > 0)
      .sort((a, b) => b.rating - a.rating)
      .slice(0, 8);

    return {
      topViewed: sortedByViews,
      topRated: sortedByRating,
      totalMaterials: allMaterials.length,
      totalViews: allInteractions.filter((i) => i.interaction_type === 'view').length,
      totalReads: allInteractions.filter((i) => i.interaction_type === 'read').length,
      totalAssignments: allAssignments.length,
      avgCompletionRate: (
        allAssignments.filter((a) => a.status === 'completed').length / Math.max(1, allAssignments.length) * 100
      ).toFixed(0),
    };
  }, [allMaterials, allInteractions, allAssignments]);

  return (
    <div className="space-y-6">
      {/* Key Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">Total Materials</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{analytics.totalMaterials || 0}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-600 flex items-center gap-2">
              <Eye className="w-4 h-4" /> Total Views
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{analytics.totalViews || 0}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-600 flex items-center gap-2">
              <Users className="w-4 h-4" /> Assignments
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{analytics.totalAssignments || 0}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">Completion Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{analytics.avgCompletionRate || 0}%</div>
          </CardContent>
        </Card>
      </div>

      {/* Top Viewed Materials */}
      {analytics.topViewed && analytics.topViewed.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Most Viewed Materials</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={analytics.topViewed}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="title" angle={-45} textAnchor="end" height={80} tick={{ fontSize: 12 }} />
                <YAxis />
                <Tooltip />
                <Bar dataKey="views" fill="#3b82f6" name="Views" />
                <Bar dataKey="reads" fill="#10b981" name="Reads" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Top Rated Materials */}
      {analytics.topRated && analytics.topRated.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Highest Rated Materials</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {analytics.topRated.map((material) => (
              <div key={material.materialId} className="flex items-start justify-between border-b pb-3 last:border-0">
                <div className="flex-1">
                  <p className="font-medium text-sm">{material.title}</p>
                  <div className="flex gap-2 mt-1">
                    <Badge variant="outline" className="text-xs">
                      {material.ratingCount} ratings
                    </Badge>
                    <Badge className="bg-yellow-100 text-yellow-800 text-xs">
                      <Star className="w-3 h-3 mr-1 fill-current" />
                      {material.rating}/5
                    </Badge>
                  </div>
                </div>
                <div className="text-right text-sm">
                  <p className="font-medium">{material.assignments}</p>
                  <p className="text-xs text-slate-500">assignments</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Material Performance Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Material Performance</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 px-2">Material</th>
                <th className="text-center py-2 px-2">Views</th>
                <th className="text-center py-2 px-2">Reads</th>
                <th className="text-center py-2 px-2">Assignments</th>
                <th className="text-center py-2 px-2">Completion</th>
                <th className="text-center py-2 px-2">Rating</th>
              </tr>
            </thead>
            <tbody>
              {allMaterials.slice(0, 10).map((material) => {
                const stats = analytics.topViewed?.find((m) => m.materialId === material.id) ||
                  analytics.topRated?.find((m) => m.materialId === material.id) || {
                    views: 0,
                    reads: 0,
                    assignments: 0,
                    completionRate: 0,
                    rating: 0,
                  };
                return (
                  <tr key={material.id} className="border-b hover:bg-slate-50">
                    <td className="py-3 px-2 text-xs max-w-xs truncate">{material.title}</td>
                    <td className="py-3 px-2 text-center">{stats.views}</td>
                    <td className="py-3 px-2 text-center">{stats.reads}</td>
                    <td className="py-3 px-2 text-center">{stats.assignments}</td>
                    <td className="py-3 px-2 text-center">{stats.completionRate}%</td>
                    <td className="py-3 px-2 text-center">
                      {stats.rating > 0 ? (
                        <Badge className="bg-yellow-100 text-yellow-800 mx-auto">
                          {stats.rating}⭐
                        </Badge>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}