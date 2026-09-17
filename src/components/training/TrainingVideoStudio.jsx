import CentralLearningPortal from '@/components/learning/CentralLearningPortal';
import { CENTRAL_LEARNING_ENABLED } from '@/lib/centralLearning';
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Video, Sparkles, Loader2, CheckCircle2, AlertTriangle, RefreshCw, Play,
  Settings2, Info, Clapperboard,
} from "lucide-react";
import { base44 } from "@/api/base44Client";
import { manageTrainingVideos } from "@/functions/manageTrainingVideos";
import PresenterPicker from "@/components/training/PresenterPicker";
import ModuleScriptPanel from "@/components/training/ModuleScriptPanel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { isSafeExternalUrl } from "@/components/utils/security";

import { formatVideoDuration, readGenerationResult, readVideoStatus } from './videoStudioResults';

function TrainingReadNotice({ failed, pending, paused, fetching, subject, retry }) {
  if (failed) return <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
    <p>{subject} could not be loaded. Previously loaded results are not confirmed.</p>
    <Button type="button" variant="outline" className="mt-2" disabled={fetching} onClick={retry}>Retry {subject.toLowerCase()}</Button>
  </div>;
  if (paused || pending) return <p role="status" className="text-sm text-slate-600">{paused ? `Waiting for a connection to load ${subject.toLowerCase()}…` : `Loading ${subject.toLowerCase()}…`}</p>;
  return null;
}

const statusMeta = {
  completed: { label: "Ready", cls: "bg-emerald-100 text-emerald-800", icon: CheckCircle2 },
  processing: { label: "Generating…", cls: "bg-blue-100 text-blue-800", icon: Loader2 },
  failed: { label: "Failed", cls: "bg-red-100 text-red-800", icon: AlertTriangle },
  none: { label: "No video", cls: "bg-slate-100 text-slate-600", icon: Video },
};

function LegacyTrainingVideoStudio({ course = null }) {
  const queryClient = useQueryClient();
  const [selectedCourseIdState, setSelectedCourseId] = useState("");
  const selectedCourseId = course?.id || selectedCourseIdState;
  const [avatarId, setAvatarId] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const currentCourse = useRef(selectedCourseId);
  const generationInFlight = useRef(false);
  useLayoutEffect(() => {
    currentCourse.current = selectedCourseId;
    return () => { currentCourse.current = null; };
  }, [selectedCourseId]);

  // Drafts are included (labeled) because the AI course generator kicks off
  // videos on courses that are still drafts — admins need to watch those render
  // and retry failures here BEFORE publishing, not after.
  const coursesQuery = useQuery({
    queryKey: ["video-studio-courses"],
    queryFn: async () => {
      const [published, drafts] = await Promise.all([
        base44.entities.TrainingCourse.filter({ status: "published" }, "-updated_date", 500),
        base44.entities.TrainingCourse.filter({ status: "draft" }, "-updated_date", 500),
      ]);
      // Re-sort the merged list so recency ordering holds across both statuses.
      return [...published, ...drafts].sort(
        (a, b) => new Date(b.updated_date || 0) - new Date(a.updated_date || 0)
      );
    },
    retry: false,
    enabled: !course?.id,
  });

  const courses = coursesQuery.isSuccess && !coursesQuery.isPaused ? coursesQuery.data || [] : [];
  const statusKey = ["training-video-status", selectedCourseId];
  const statusQuery = useQuery({
    queryKey: statusKey,
    queryFn: async () => {
      const res = await manageTrainingVideos({ action: "status", course_id: selectedCourseId });
      return readVideoStatus(res);
    },
    enabled: !!selectedCourseId,
    retry: false,
    // Keep polling while any module is still generating.
    refetchInterval: (query) =>
      query.state.status === "success" && (query.state.data?.modules || []).some((m) => m.video_status === "processing") ? 12000 : false,
  });

  const statusData = statusQuery.data;
  const videoReady = statusQuery.isSuccess && !statusQuery.isPaused;
  const modules = useMemo(() => statusData?.modules || [], [statusData]);

  // Full module records (with content_json) back the per-lesson script panels.
  // Shares its query key with the course builder's Lessons tab so an edit in
  // either place refreshes both.
  const scriptsQuery = useQuery({
    queryKey: ["training-modules", selectedCourseId],
    queryFn: () => base44.entities.TrainingModule.filter({ course_id: selectedCourseId }, "order_index", 100),
    enabled: !!selectedCourseId,
    retry: false,
  });
  const scriptsReady = scriptsQuery.isSuccess && !scriptsQuery.isPaused;
  const fullModuleById = useMemo(
    () => Object.fromEntries((scriptsQuery.data || []).map((m) => [m.id, m])),
    [scriptsQuery.data]
  );
  const heygenConfigured = statusData?.heygen_configured;
  const anyProcessing = modules.some((m) => m.video_status === "processing");
  const missingCount = modules.filter((m) => m.video_status !== "completed").length;

  const startMutation = useMutation({
    retry: false,
    mutationFn: async ({ payload, avatar, voice }) => readGenerationResult(await manageTrainingVideos({
      action: 'start', avatar_id: avatar, voice_id: voice, ...payload,
    })),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['training-video-status', variables.courseId] });
      if (currentCourse.current !== variables.courseId) return;
      const failed = data.modules.filter(module => module.video_status === 'failed').length;
      if (data.started === 0) toast.warning('No videos were started. Review the lesson statuses before trying again.');
      else if (failed > 0) toast.warning(`Started ${data.started} video${data.started === 1 ? '' : 's'}; ${failed} lesson${failed === 1 ? ' reports' : 's report'} a failure. Review their statuses.`);
      else toast.success(`Started generating ${data.started} video${data.started === 1 ? '' : 's'}. They'll appear here when ready.`);
    },
    onError: (_error, variables) => {
      queryClient.invalidateQueries({ queryKey: ['training-video-status', variables.courseId] });
      if (currentCourse.current === variables.courseId) toast.error('Could not confirm video generation. Refresh status before trying again.');
    },
    onSettled: () => { generationInFlight.current = false; },
  });
  const canGenerate = videoReady && !statusQuery.isFetching && heygenConfigured === true && !startMutation.isPending;
  function startGeneration(payload) {
    if (!canGenerate || generationInFlight.current) return;
    generationInFlight.current = true;
    startMutation.mutate({ courseId: selectedCourseId, avatar: avatarId || undefined, voice: voiceId || undefined, payload });
  }

  const selectedCourse = course?.id === selectedCourseId
    ? course
    : courses.find((c) => c.id === selectedCourseId);

  return (
    <div className="space-y-6">
      {!course && (
        <Card className="border-indigo-200 bg-indigo-50/40">
          <CardContent className="p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center flex-shrink-0">
                <Clapperboard className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h2 className="font-semibold text-slate-900">AI Presenter Video Studio</h2>
                <p className="text-sm text-slate-600">
                  Generate an AI presenter video for each lesson from its script, or regenerate to
                  enhance an existing one. Videos generate in the background and attach to the module
                  automatically — staff see the video at the top of the lesson, then take the quiz.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* HeyGen not configured */}
      {selectedCourseId && videoReady && heygenConfigured === false && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
          <Info className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-900">
            <p className="font-semibold">HeyGen isn’t connected yet</p>
            <p className="mt-0.5">
              Add a <code className="bg-amber-100 px-1 rounded">HEYGEN_API_KEY</code> to this environment’s
              function secrets to enable AI presenter videos. Until then, lessons fall back to the built-in
              narrated player. You can get a key from your HeyGen account’s API settings.
            </p>
          </div>
        </div>
      )}

      {/* Course picker + actions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Video className="w-4 h-4 text-indigo-600" />
            {course ? `Presenter videos for “${course.title}”` : "Choose a course"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!course?.id && <TrainingReadNotice subject="Course list" failed={coursesQuery.isError} pending={coursesQuery.isPending}
            paused={coursesQuery.isPaused} fetching={coursesQuery.isFetching} retry={() => coursesQuery.refetch()} />}
          {!course?.id && coursesQuery.isSuccess && !coursesQuery.isPaused && courses.length === 0 && <p className="text-sm text-slate-600">No published or draft courses are available.</p>}
          <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
            {course ? (
              <p className="flex-1 text-sm text-slate-600">
                Each lesson’s AI-written narration script becomes a presenter video. Status refreshes automatically while HeyGen renders.
              </p>
            ) : (
              <div className="flex-1">
                <Label className="text-xs text-slate-500">Course</Label>
                <Select value={selectedCourseId} onValueChange={setSelectedCourseId} disabled={!coursesQuery.isSuccess || coursesQuery.isPaused || startMutation.isPending}>
                  <SelectTrigger aria-label="Course"><SelectValue placeholder="Select a course to add videos to" /></SelectTrigger>
                  <SelectContent>
                    {courses.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.title}{c.status === "draft" ? " — Draft" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {selectedCourseId && (
              <Button
                onClick={() => startGeneration({ course_id: selectedCourseId, action: missingCount > 0 ? "start" : "regenerate" })}
                disabled={!canGenerate || anyProcessing || modules.length === 0}
              >
                {startMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Starting…</>
                ) : missingCount === 0 ? (
                  <><RefreshCw className="w-4 h-4 mr-2" />Regenerate all</>
                ) : (
                  <><Sparkles className="w-4 h-4 mr-2" />{missingCount < modules.length ? `Generate ${missingCount} missing` : "Generate all"}</>
                )}
              </Button>
            )}
          </div>

          {/* Advanced avatar/voice */}
          {selectedCourseId && (
            <div>
              <button
                type="button"
                className="text-xs text-slate-500 hover:text-slate-700 inline-flex items-center gap-1.5"
                onClick={() => setShowAdvanced((v) => !v)}
              >
                <Settings2 className="w-3.5 h-3.5" /> Presenter options {showAdvanced ? "▲" : "▼"}
              </button>
              {showAdvanced && (
                <div className="mt-2 rounded-xl border bg-slate-50 p-3 space-y-2">
                  <PresenterPicker
                    avatarId={avatarId}
                    voiceId={voiceId}
                    onAvatarChange={setAvatarId}
                    onVoiceChange={setVoiceId}
                    idPrefix="video-studio"
                  />
                  <p className="text-xs text-slate-400">
                    Applies to videos you generate from this page. Leave on the defaults for the standard friendly presenter.
                  </p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Module list */}
      {selectedCourseId && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <CardTitle className="text-base flex items-center gap-2">
                Lessons in “{selectedCourse?.title}”{videoReady ? ` (${modules.length})` : ''}
                {selectedCourse?.status === "draft" && (
                  <Badge className="bg-slate-100 text-slate-600 text-xs font-medium">Draft</Badge>
                )}
              </CardTitle>
              <div className="flex items-center gap-2 text-xs text-slate-400">
                {statusQuery.isFetching && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {videoReady ? (statusQuery.isFetching ? "Refreshing video status…" : anyProcessing ? "Generating — auto-refreshing…" : "Up to date") : null}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <TrainingReadNotice subject="Video status" failed={statusQuery.isError} pending={statusQuery.isPending}
              paused={statusQuery.isPaused} fetching={statusQuery.isFetching} retry={() => statusQuery.refetch()} />
            {videoReady && <TrainingReadNotice subject="Lesson scripts" failed={scriptsQuery.isError} pending={scriptsQuery.isPending}
              paused={scriptsQuery.isPaused} fetching={scriptsQuery.isFetching} retry={() => scriptsQuery.refetch()} />}
            <div hidden={!videoReady} inert={!videoReady}>
            {modules.length === 0 ? (
              videoReady && <p className="text-sm text-slate-500 text-center py-8">
                This course has no lesson modules to turn into videos.
              </p>
            ) : (
              modules.map((m, i) => {
                const meta = statusMeta[m.video_status] || statusMeta.none;
                const Icon = meta.icon;
                const busy = m.video_status === "processing";
                return (
                  <div key={m.module_id} className="p-3 rounded-xl border bg-white">
                    <div className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-600 text-xs font-bold flex items-center justify-center flex-shrink-0">
                      {i + 1}
                    </span>

                    {m.video_thumbnail_url && isSafeExternalUrl(m.video_thumbnail_url) ? (
                      <img src={m.video_thumbnail_url} alt="" className="w-20 h-12 rounded object-cover border flex-shrink-0" />
                    ) : (
                      <div className="w-20 h-12 rounded bg-slate-100 border flex items-center justify-center flex-shrink-0">
                        <Video className="w-4 h-4 text-slate-400" />
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm text-slate-900 truncate">{m.title}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge className={`${meta.cls} text-xs`}>
                          <Icon className={`w-3 h-3 mr-1 ${busy ? "animate-spin" : ""}`} />
                          {meta.label}
                        </Badge>
                        {formatVideoDuration(m.video_duration_seconds) !== null && (
                          <span className="text-xs text-slate-400">{formatVideoDuration(m.video_duration_seconds)}</span>
                        )}
                        {m.video_status === "failed" && m.video_error && (
                          <span className="text-xs text-red-500 truncate max-w-[260px]" title={m.video_error}>{m.video_error}</span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {m.video_url && isSafeExternalUrl(m.video_url) && (
                        <Button size="sm" variant="outline" asChild>
                          <a href={m.video_url}>
                            <Play className="w-3.5 h-3.5 mr-1.5" />Preview
                          </a>
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant={m.video_status === "completed" ? "outline" : "default"}
                        disabled={!canGenerate || busy}
                        onClick={() => startGeneration({ module_id: m.module_id, action: m.video_status === "completed" ? "regenerate" : "start" })}
                      >
                        {m.video_status === "completed" ? (
                          <><RefreshCw className="w-3.5 h-3.5 mr-1.5" />Regenerate</>
                        ) : busy ? (
                          <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Generating</>
                        ) : (
                          <><Sparkles className="w-3.5 h-3.5 mr-1.5" />Generate</>
                        )}
                      </Button>
                    </div>
                    </div>
                    <div hidden={!scriptsReady} inert={!scriptsReady}>
                    <ModuleScriptPanel
                      module={fullModuleById[m.module_id]}
                      courseId={selectedCourseId}
                      disabled={busy || !videoReady || !scriptsReady || statusQuery.isFetching || scriptsQuery.isFetching || startMutation.isPending}
                    />
                    </div>
                  </div>
                );
              })
            )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
export default function TrainingVideoStudio(props) {
  return CENTRAL_LEARNING_ENABLED ? <CentralLearningPortal authoring={true} /> : <LegacyTrainingVideoStudio {...props} />;
}
