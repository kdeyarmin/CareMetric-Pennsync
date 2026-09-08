import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  Trophy, 
  Award, 
  Zap,
  Medal,
  Crown,
  Target
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { getMyTrainingGamification } from '@/functions/getMyTrainingGamification';

export default function GamificationDashboard({ userId }) {
  const { data: gamification = { leaderboard: null, badges: [], team_rank_available: false } } = useQuery({
    queryKey: ['my-training-gamification', userId],
    queryFn: async () => {
      const response = await getMyTrainingGamification({});
      return response?.data || response;
    },
    enabled: !!userId,
    initialData: { leaderboard: null, badges: [], team_rank_available: false },
  });
  const leaderboard = gamification?.leaderboard || null;
  const badges = gamification?.badges || [];

  const rarityColors = {
    common: 'bg-slate-400',
    uncommon: 'bg-green-500',
    rare: 'bg-blue-500',
    epic: 'bg-navy-500',
    legendary: 'bg-yellow-500'
  };

  return (
    <div className="space-y-6">
      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-l-4 border-l-yellow-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">Total Points</p>
                <p className="text-2xl font-bold text-yellow-600">{leaderboard?.total_points || 0}</p>
              </div>
              <Trophy className="w-8 h-8 text-yellow-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-blue-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">Badges Earned</p>
                <p className="text-2xl font-bold text-blue-600">{leaderboard?.badges_earned || 0}</p>
              </div>
              <Award className="w-8 h-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-green-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">Current Streak</p>
                <p className="text-2xl font-bold text-green-600">{leaderboard?.current_streak || 0}</p>
              </div>
              <Zap className="w-8 h-8 text-green-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-navy-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">Courses Completed</p>
                <p className="text-2xl font-bold text-navy-600">{leaderboard?.courses_completed || 0}</p>
              </div>
              <Crown className="w-8 h-8 text-navy-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Badges */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Award className="w-5 h-5 text-blue-600" />
            Recent Badges
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {badges.slice(0, 8).map(badge => (
              <div key={badge.id} className="flex flex-col items-center p-4 bg-gradient-to-br from-slate-50 to-slate-100 rounded-lg border-2 border-slate-200 hover:border-blue-300 transition">
                <div className={`w-16 h-16 rounded-full ${rarityColors[badge.trigger_context?.rarity || 'common']} flex items-center justify-center mb-2`}>
                  <Medal className="w-8 h-8 text-white" />
                </div>
                <p className="text-sm font-semibold text-slate-900 text-center">{badge.badge_name}</p>
                <p className="text-xs text-slate-600 mt-1">{badge.points_awarded} pts</p>
                <Badge variant="outline" className="mt-2 text-xs">
                  {new Date(badge.earned_at).toLocaleDateString()}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Next Milestone */}
      <Card className="bg-gradient-to-br from-navy-50 to-indigo-50 border-2 border-navy-200">
        <CardContent className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <Target className="w-6 h-6 text-navy-600" />
            <h3 className="text-lg font-semibold text-navy-900">Next Milestone</h3>
          </div>
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-navy-900">Streak Goal: 10 Courses</span>
                <span className="text-sm font-semibold text-navy-600">
                  {leaderboard?.current_streak || 0} / 10
                </span>
              </div>
              <Progress
                value={Math.min(100, ((leaderboard?.current_streak || 0) / 10) * 100)}
                className="h-2 bg-navy-200"
              />
            </div>
            <p className="text-sm text-navy-700">
              Complete {Math.max(0, 10 - (leaderboard?.current_streak || 0))} more courses to earn the "Dedicated Learner" badge!
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
