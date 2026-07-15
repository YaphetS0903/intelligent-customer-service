"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, CheckCircle2, ChevronDown, CircleAlert, Clock, Download, Eye, EyeOff, FileAudio, Film, Loader2, Play, Save, Trash2, Trophy, Upload, UserCheck, UserX, Video } from "lucide-react";
import { StatusPill } from "@/components/status-pill";
import { TrainingQuizAdmin } from "@/components/training-quiz-admin";
import { ActionConfirmDialog, ErrorRetry, PanelSkeleton, useToast, type ActionConfirmRequest } from "@/components/ui-feedback";
import type { TrainingAuditEvent, TrainingCertificate, TrainingJob, TrainingProgress, TrainingQuizAttempt, TrainingVideoJob, UserProfile } from "@/lib/types";

type LearnerReportRow = {
  user: UserProfile;
  progress: TrainingProgress | null;
  latestAttempt: TrainingQuizAttempt | null;
  certificate: TrainingCertificate | null;
  status: "not_started" | "learning" | "awaiting_exam" | "completed";
};

type TrainingConfirmDialogState = ActionConfirmRequest & {
  resolve: (confirmed: boolean) => void;
};

export function TrainingAdmin() {
  const [jobs, setJobs] = useState<TrainingJob[]>([]);
  const [videoJobs, setVideoJobs] = useState<TrainingVideoJob[]>([]);
  const [progress, setProgress] = useState<TrainingProgress[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [quizAttempts, setQuizAttempts] = useState<TrainingQuizAttempt[]>([]);
  const [certificates, setCertificates] = useState<TrainingCertificate[]>([]);
  const [auditEvents, setAuditEvents] = useState<TrainingAuditEvent[]>([]);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [instructor, setInstructor] = useState("");
  const [coverUrl, setCoverUrl] = useState("");
  const [visibleDepartments, setVisibleDepartments] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [learnerSearch, setLearnerSearch] = useState("");
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [audioLoadingId, setAudioLoadingId] = useState<string | null>(null);
  const [slideVideoLoadingId, setSlideVideoLoadingId] = useState<string | null>(null);
  const [videoLoadingId, setVideoLoadingId] = useState<string | null>(null);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<TrainingConfirmDialogState | null>(null);
  const [activeView, setActiveView] = useState<"courses" | "learning" | "settings" | "create">("courses");
  const { pushToast } = useToast();

  function requestTrainingConfirm(input: ActionConfirmRequest) {
    return new Promise<boolean>((resolve) => {
      setConfirmDialog({
        ...input,
        cancelLabel: input.cancelLabel ?? "取消",
        tone: input.tone ?? "warning",
        resolve
      });
    });
  }

  function settleTrainingConfirm(confirmed: boolean) {
    setConfirmDialog((current) => {
      current?.resolve(confirmed);
      return null;
    });
  }

  const showError = useCallback((error: unknown, fallback: string) => {
    const message = errorMessage(error, fallback);
    pushToast({
      tone: "error",
      title: fallback,
      description: message === fallback ? undefined : message,
      durationMs: 6500
    });
  }, [pushToast]);

  const loadJobs = useCallback(async () => {
    const response = await fetch("/api/admin/training-report", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error ?? "读取培训数据失败");
    }

    const nextJobs = data.trainingJobs ?? [];
    setJobs(nextJobs);
    setVideoJobs(data.videoJobs ?? []);
    setProgress(data.trainingProgress ?? []);
    setUsers(data.users ?? []);
    setQuizAttempts(data.quizAttempts ?? []);
    setCertificates(data.certificates ?? []);
    setAuditEvents(data.auditEvents ?? []);
    setLoadError(null);
    setSelectedJobId((current) =>
      current && nextJobs.some((job: TrainingJob) => job.id === current) ? current : nextJobs[0]?.id ?? ""
    );
  }, []);

  const loadInitialJobs = useCallback(async () => {
    setInitialLoading(true);

    try {
      await loadJobs();
    } catch (error) {
      const message = errorMessage(error, "读取培训数据失败");
      setLoadError(message);
    } finally {
      setInitialLoading(false);
    }
  }, [loadJobs, showError]);

  useEffect(() => {
    void loadInitialJobs();
  }, [loadInitialJobs]);

  useEffect(() => {
    const hasRunningCourse = jobs.some((job) => job.status === "generating");
    const hasRunningMedia = videoJobs.some((item) =>
      ["training-audio", "slide-video"].includes(item.provider) && ["queued", "generating"].includes(item.status)
    );
    if (!hasRunningCourse && !hasRunningMedia) {
      return;
    }

    const timer = window.setInterval(() => {
      void loadJobs().catch((error) => {
        showError(error, "刷新视频生成状态失败");
      });
    }, 5000);

    return () => window.clearInterval(timer);
  }, [jobs, loadJobs, showError, videoJobs]);

  const activeLearners = useMemo(() => users.filter(isActiveEmployee), [users]);
  const selectedJob = useMemo(
    () => jobs.find((job) => job.id === selectedJobId) ?? jobs[0] ?? null,
    [jobs, selectedJobId]
  );
  const learnerRows = useMemo(
    () => selectedJob ? buildLearnerRows(selectedJob, visibleLearners(selectedJob, activeLearners), progress, quizAttempts, certificates) : [],
    [activeLearners, certificates, progress, quizAttempts, selectedJob]
  );
  const stats = useMemo(() => {
    return jobs.reduce(
      (current, job) => ({
        ...current,
        [job.status]: current[job.status] + 1,
        pages: current.pages + job.script_json.length,
        slideImages: current.slideImages + countSlideImages(job),
        audio: current.audio + job.audio_paths.filter(Boolean).length,
        videos: current.videos + videoJobs.filter((item) =>
          item.training_job_id === job.id && item.provider !== "training-audio" && item.status === "ready"
        ).length,
        total: current.total + 1,
        published: current.published + (job.publish_status === "published" ? 1 : 0),
        unpublished: current.unpublished + (job.publish_status !== "published" ? 1 : 0),
        learners: current.learners,
        completedLearners: current.completedLearners
      }),
      {
        total: 0,
        draft: 0,
        generating: 0,
        ready: 0,
        failed: 0,
        pages: 0,
        slideImages: 0,
        audio: 0,
        videos: 0,
        published: 0,
        unpublished: 0,
        learners: activeLearners.length,
        completedLearners: progress.filter((item) =>
          activeLearners.some((user) => user.id === item.user_id) && item.progress_percent >= 100
        ).length
      }
    );
  }, [activeLearners, jobs, progress, videoJobs]);

  async function createTraining(formData: FormData) {
    setLoading(true);

    try {
      if (title.trim()) {
        formData.set("title", title.trim());
      }
      formData.set("description", description.trim());
      formData.set("instructor", instructor.trim());
      formData.set("cover_url", coverUrl.trim());
      formData.set("visible_departments", visibleDepartments.trim());

      const response = await fetch("/api/training", {
        method: "POST",
        body: formData
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "生成失败");
      }

      setTitle("");
      setDescription("");
      setInstructor("");
      setCoverUrl("");
      setVisibleDepartments("");
      await loadJobs();
      if (data.trainingJob) {
        setJobs((current) => upsertById(current, data.trainingJob));
        setSelectedJobId(data.trainingJob.id);
      }
      pushToast({
        tone: "success",
        title: "课程已提交",
        description: data.message ?? "PPT 讲解课程已进入后台生成队列，可稍后刷新查看进度。"
      });
    } catch (error) {
      showError(error, "生成失败");
    } finally {
      setLoading(false);
    }
  }

  async function generateDigitalHumanVideo(jobId: string) {
    setVideoLoadingId(jobId);

    try {
      const response = await fetch(`/api/training/${jobId}/digital-human`, {
        method: "POST"
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "数字人视频生成失败");
      }

      await loadJobs();
      if (data.videoJob) {
        setVideoJobs((current) => upsertById(current, data.videoJob));
      }
      pushToast({
        tone: "success",
        title: data.videoJob?.status === "ready" ? "数字人视频已生成" : "数字人任务已提交",
        description: data.videoJob?.status === "ready" ? undefined : "可稍后刷新查看状态。"
      });
    } catch (error) {
      showError(error, "数字人视频生成失败");
    } finally {
      setVideoLoadingId(null);
    }
  }

  async function saveCourseMetadata(job: TrainingJob, formData: FormData) {
    setPublishingId(job.id);
    try {
      const response = await fetch(`/api/training/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          title: String(formData.get("title") ?? ""),
          description: String(formData.get("description") ?? ""),
          instructor: String(formData.get("instructor") ?? ""),
          cover_url: String(formData.get("cover_url") ?? ""),
          visible_departments: String(formData.get("visible_departments") ?? "").split(",").map((item) => item.trim()).filter(Boolean)
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "保存课程资料失败");
      setJobs((current) => upsertById(current, data.trainingJob));
      pushToast({ tone: "success", title: "课程资料已保存" });
    } catch (error) {
      showError(error, "保存课程资料失败");
    } finally {
      setPublishingId(null);
    }
  }

  function exportLearningReport() {
    if (!selectedJob) return;
    const rows = learnerRows.filter((row) => !departmentFilter || row.user.department === departmentFilter);
    const csv = [
      ["课程", "员工", "邮箱", "部门", "岗位", "状态", "进度", "学习时长(秒)", "最后学习时间", "完课时间", "考试成绩", "考试结果", "证书编号"],
      ...rows.map((row) => [
        selectedJob.title, row.user.name, row.user.email, row.user.department, row.user.position,
        learnerStatusLabel(row.status), row.progress?.progress_percent ?? 0,
        row.progress?.total_learning_seconds ?? 0, row.progress?.last_active_at ?? "", row.progress?.completed_at ?? "",
        row.latestAttempt?.score ?? "", row.latestAttempt ? (row.latestAttempt.passed ? "通过" : "未通过") : "", row.certificate?.certificate_no ?? ""
      ])
    ].map((row) => row.map(csvCell).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${selectedJob.title}-学习记录.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function revokeCertificate(certificate: TrainingCertificate) {
    const confirmed = await requestTrainingConfirm({ title: "作废培训证书？", description: `证书 ${certificate.certificate_no} 作废后，员工将无法继续下载。`, confirmLabel: "确认作废", tone: "danger" });
    if (!confirmed) return;
    try {
      const response = await fetch(`/api/admin/training-certificates/${certificate.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: "管理员在培训后台作废" }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "作废证书失败");
      setCertificates((current) => current.map((item) => item.id === certificate.id ? data.certificate : item));
      pushToast({ tone: "success", title: "培训证书已作废" });
    } catch (error) {
      showError(error, "作废证书失败");
    }
  }

  async function generateTrainingAudio(jobId: string) {
    setAudioLoadingId(jobId);

    try {
      const response = await fetch(`/api/training/${jobId}/audio-job`, {
        method: "POST"
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "课程语音生成失败");
      }

      await loadJobs();
      if (data.videoJob) {
        setVideoJobs((current) => upsertById(current, data.videoJob));
      }
      pushToast({
        tone: "success",
        title: "课程语音已提交",
        description: data.message ?? "课程语音已进入后台生成队列，可刷新页面查看进度。"
      });
    } catch (error) {
      showError(error, "课程语音生成失败");
    } finally {
      setAudioLoadingId(null);
    }
  }

  async function generateSlideVideo(jobId: string) {
    setSlideVideoLoadingId(jobId);

    try {
      const response = await fetch(`/api/training/${jobId}/slide-video`, {
        method: "POST"
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "课件视频生成失败");
      }

      await loadJobs();
      if (data.videoJob) {
        setVideoJobs((current) => upsertById(current, data.videoJob));
      }
      pushToast({
        tone: "success",
        title: "课件视频已提交",
        description: data.message ?? "课件视频已进入后台生成队列，可刷新页面查看进度。"
      });
    } catch (error) {
      showError(error, "课件视频生成失败");
    } finally {
      setSlideVideoLoadingId(null);
    }
  }

  async function updateCoursePublishStatus(jobId: string, action: "publish" | "unpublish" | "archive") {
    setPublishingId(jobId);

    try {
      const response = await fetch(`/api/training/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "更新课程发布状态失败");
      }

      await loadJobs();
      pushToast({
        tone: "success",
        title: action === "publish" ? "课程已发布" : "课程已下架",
        description: action === "publish" ? "员工可进入培训列表学习。" : "员工端不再展示。"
      });
    } catch (error) {
      showError(error, "更新课程发布状态失败");
    } finally {
      setPublishingId(null);
    }
  }

  async function deleteCourse(job: TrainingJob) {
    if (job.publish_status === "published") {
      pushToast({
        tone: "warning",
        title: "请先下架课程",
        description: "已发布课程不能直接删除。"
      });
      return;
    }

    if (!(await requestTrainingConfirm({
      title: "删除培训课程？",
      description: `确认删除课程「${job.title}」吗？`,
      details: [
        "会同时清理学习进度、测验记录和视频任务。",
        "删除后无法恢复；已发布课程需要先归档。"
      ],
      confirmLabel: "确认删除",
      tone: "danger"
    }))) {
      return;
    }

    setDeletingId(job.id);

    try {
      const response = await fetch(`/api/training/${job.id}`, {
        method: "DELETE"
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "删除课程失败");
      }

      await loadJobs();
      pushToast({
        tone: "success",
        title: "课程已删除"
      });
    } catch (error) {
      showError(error, "删除课程失败");
    } finally {
      setDeletingId(null);
    }
  }

  function renderJobActions(
    job: TrainingJob,
    latestAudioJob: TrainingVideoJob | null,
    latestSlideVideo: TrainingVideoJob | null,
    audioBusy: boolean,
    slideVideoBusy: boolean,
    layout: "table" | "card"
  ) {
    const isCard = layout === "card";
    const labelClass = isCard ? "" : "sr-only";
    const neutralButtonClass = isCard
      ? "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-line bg-white px-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
      : "inline-flex size-9 items-center justify-center rounded-lg border border-line text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300";
    const dangerButtonClass = isCard
      ? "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-red-200 bg-white px-3 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:text-slate-300"
      : "inline-flex size-9 items-center justify-center rounded-lg border border-red-200 text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:text-slate-300";

    return (
      <div className={isCard ? "grid grid-cols-2 gap-2 sm:grid-cols-3" : "flex items-center gap-2"}>
        {job.status === "ready" ? (
          <Link
            href={`/training/${job.id}`}
            className={neutralButtonClass}
            title="预览讲解"
            aria-label="预览讲解"
          >
            <Play size={16} />
            <span className={labelClass}>预览</span>
          </Link>
        ) : (
          <button
            type="button"
            disabled
            className={neutralButtonClass}
            title="生成完成后可预览"
            aria-label="生成完成后可预览"
          >
            <Play size={16} />
            <span className={labelClass}>预览</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => void generateTrainingAudio(job.id)}
          disabled={audioLoadingId === job.id || audioBusy || job.status !== "ready" || isAudioFullyCached(job, latestAudioJob)}
          className={neutralButtonClass}
          title={trainingAudioActionLabel(job, latestAudioJob)}
          aria-label={trainingAudioActionLabel(job, latestAudioJob)}
        >
          {audioLoadingId === job.id ? <Loader2 className="animate-spin" size={16} /> : <FileAudio size={16} />}
          <span className={labelClass}>语音</span>
        </button>
        <button
          type="button"
          onClick={() => void generateSlideVideo(job.id)}
          disabled={slideVideoLoadingId === job.id || slideVideoBusy || job.status !== "ready" || countSlideImages(job) === 0}
          className={neutralButtonClass}
          title={slideVideoActionLabel(latestSlideVideo)}
          aria-label={slideVideoActionLabel(latestSlideVideo)}
        >
          {slideVideoLoadingId === job.id ? <Loader2 className="animate-spin" size={16} /> : <Film size={16} />}
          <span className={labelClass}>课件视频</span>
        </button>
        <button
          type="button"
          onClick={() => void generateDigitalHumanVideo(job.id)}
          disabled={videoLoadingId === job.id || job.status !== "ready"}
          className={neutralButtonClass}
          title="生成数字人视频"
          aria-label="生成数字人视频"
        >
          {videoLoadingId === job.id ? <Loader2 className="animate-spin" size={16} /> : <Video size={16} />}
          <span className={labelClass}>数字人</span>
        </button>
        {job.publish_status === "published" ? (
          <button
            type="button"
            onClick={() => void updateCoursePublishStatus(job.id, "unpublish")}
            disabled={publishingId === job.id}
            className={neutralButtonClass}
            title="下架课程"
            aria-label="下架课程"
          >
            {publishingId === job.id ? <Loader2 className="animate-spin" size={16} /> : <EyeOff size={16} />}
            <span className={labelClass}>下架</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void updateCoursePublishStatus(job.id, "publish")}
            disabled={publishingId === job.id || job.status !== "ready" || job.publish_status === "archived"}
            className={neutralButtonClass}
            title="发布课程"
            aria-label="发布课程"
          >
            {publishingId === job.id ? <Loader2 className="animate-spin" size={16} /> : <Eye size={16} />}
            <span className={labelClass}>发布</span>
          </button>
        )}
        {job.publish_status !== "archived" && (
          <button
            type="button"
            onClick={() => void updateCoursePublishStatus(job.id, "archive")}
            disabled={publishingId === job.id}
            className={dangerButtonClass}
            title="下架课程"
            aria-label="下架课程"
          >
            {publishingId === job.id ? <Loader2 className="animate-spin" size={16} /> : <Archive size={16} />}
            <span className={labelClass}>归档</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => void deleteCourse(job)}
          disabled={deletingId === job.id}
          className={dangerButtonClass}
          title={job.publish_status === "published" ? "请先归档再删除" : "删除课程"}
          aria-label={job.publish_status === "published" ? "请先归档再删除" : "删除课程"}
        >
          {deletingId === job.id ? <Loader2 className="animate-spin" size={16} /> : <Trash2 size={16} />}
          <span className={labelClass}>删除</span>
        </button>
      </div>
    );
  }

  return (
    <>
    <div className="space-y-3 pb-6">
      <header className="flex items-center gap-2.5 border-b border-line pb-3" data-testid="training-header">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-cyan/10 text-brand"><FileAudio size={18} /></span>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-ink">课程管理</h1>
            <p className="truncate text-sm text-slate-500">PPT 讲稿、语音视频、考试发布与学习进度</p>
          </div>
      </header>

      {initialLoading && jobs.length === 0 && <TrainingAdminSkeleton />}

      {!initialLoading && loadError && jobs.length === 0 && (
        <ErrorRetry
          title="培训数据加载失败"
          message={loadError}
          retrying={initialLoading}
          onRetry={() => void loadInitialJobs()}
        />
      )}

      {(!initialLoading || jobs.length > 0) && (!loadError || jobs.length > 0) && (
        <>
          <TrainingReadiness stats={stats} loading={loading} />

          <section className="ui-card grid grid-cols-2 gap-1 p-1.5 lg:grid-cols-4" aria-label="课程管理视图">
            <TrainingViewButton active={activeView === "courses"} onClick={() => setActiveView("courses")}>课程列表 · {jobs.length}</TrainingViewButton>
            <TrainingViewButton active={activeView === "learning"} onClick={() => setActiveView("learning")}>学习跟踪</TrainingViewButton>
            <TrainingViewButton active={activeView === "settings"} onClick={() => setActiveView("settings")}>考试与课程设置</TrainingViewButton>
            <TrainingViewButton active={activeView === "create"} onClick={() => setActiveView("create")}>新建课程</TrainingViewButton>
          </section>

          {activeView === "create" && (
          <section className="ui-card p-5">
            <h2 className="text-base font-semibold text-ink">创建培训讲解</h2>
            <p className="mt-1 text-sm text-slate-500">
              上传后进入后台生成逐页讲稿和课件画面；生成完成后可预览语音讲解并合成课件视频。
            </p>
            <form
              className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4"
              onSubmit={(event) => {
                event.preventDefault();
                void createTraining(new FormData(event.currentTarget));
                event.currentTarget.reset();
              }}
            >
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="课程标题，可选"
                className="h-11 rounded-lg border border-line px-3 text-sm outline-none focus:border-brand"
              />
              <input value={instructor} onChange={(event) => setInstructor(event.target.value)} placeholder="讲师或负责部门" className="h-11 rounded-lg border border-line px-3 text-sm outline-none focus:border-brand" />
              <input value={coverUrl} onChange={(event) => setCoverUrl(event.target.value)} placeholder="封面图片地址，可选" className="h-11 rounded-lg border border-line px-3 text-sm outline-none focus:border-brand" />
              <input value={visibleDepartments} onChange={(event) => setVisibleDepartments(event.target.value)} placeholder="可见部门，逗号分隔；留空为全员" className="h-11 rounded-lg border border-line px-3 text-sm outline-none focus:border-brand" />
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="课程简介" className="min-h-20 rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand md:col-span-2 xl:col-span-3" />
              <input
                name="file"
                type="file"
                accept=".pptx"
                required
                className="h-11 rounded-lg border border-line px-3 py-2 text-sm"
              />
              <button
                disabled={loading}
                className="ui-button-primary h-11"
              >
                {loading ? <Loader2 className="animate-spin" size={16} /> : <Upload size={16} />}
                上传生成
              </button>
            </form>
            <div className="mt-3 rounded-lg border border-cyan/20 bg-cyan/10 px-3 py-2 text-sm leading-6 text-steel">
              上传后会生成逐页课件画面、课件预览和讲解稿；员工端可按页播放语音，也可一键连续讲解。服务器缺少渲染工具时会自动降级为讲稿版课件。
            </div>
          </section>
          )}

          {activeView === "settings" && selectedJob && (
            <CourseSelectionBar jobs={jobs} selectedJobId={selectedJob.id} onChange={setSelectedJobId} />
          )}

          {activeView === "settings" && (
          <>
          {selectedJob && (
            <section className="ui-card p-5">
              <h2 className="text-base font-semibold text-ink">课程资料与可见范围</h2>
              <form
                key={`${selectedJob.id}-${selectedJob.created_at}`}
                className="mt-4 grid gap-3 md:grid-cols-2"
                onSubmit={(event) => { event.preventDefault(); void saveCourseMetadata(selectedJob, new FormData(event.currentTarget)); }}
              >
                <input name="title" defaultValue={selectedJob.title} required placeholder="课程标题" className="h-11 rounded-lg border border-line px-3 text-sm" />
                <input name="instructor" defaultValue={selectedJob.instructor} required placeholder="讲师或负责部门" className="h-11 rounded-lg border border-line px-3 text-sm" />
                <input name="cover_url" defaultValue={selectedJob.cover_url ?? ""} placeholder="封面图片地址" className="h-11 rounded-lg border border-line px-3 text-sm" />
                <input name="visible_departments" defaultValue={selectedJob.visible_departments.join(", ")} placeholder="可见部门，留空为全员" className="h-11 rounded-lg border border-line px-3 text-sm" />
                <textarea name="description" defaultValue={selectedJob.description} required placeholder="课程简介" className="min-h-24 rounded-lg border border-line px-3 py-2 text-sm md:col-span-2" />
                <button disabled={publishingId === selectedJob.id} className="ui-button-primary h-11 md:col-span-2">
                  {publishingId === selectedJob.id ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}保存课程资料
                </button>
              </form>
            </section>
          )}

          {selectedJob && <TrainingQuizAdmin job={selectedJob} onUpdated={loadJobs} />}

          {selectedJob && (
            <TrainingAuditTimeline events={auditEvents.filter((event) => event.training_job_id === selectedJob.id)} users={users} />
          )}
          </>
          )}

          {activeView === "learning" && (
          <TrainingLearnerReport
            jobs={jobs}
            selectedJob={selectedJob}
            selectedJobId={selectedJob?.id ?? selectedJobId}
            onSelectedJobChange={setSelectedJobId}
            rows={learnerRows.filter((row) => {
              const matchesDepartment = !departmentFilter || row.user.department === departmentFilter;
              const keyword = learnerSearch.trim().toLowerCase();
              return matchesDepartment && (!keyword || [row.user.name, row.user.email, row.user.position].some((value) => value.toLowerCase().includes(keyword)));
            })}
            departmentFilter={departmentFilter}
            departments={[...new Set(activeLearners.map((user) => user.department).filter(Boolean))].sort()}
            onDepartmentFilterChange={setDepartmentFilter}
            learnerSearch={learnerSearch}
            onLearnerSearchChange={setLearnerSearch}
            onExport={exportLearningReport}
            onRevokeCertificate={revokeCertificate}
          />
          )}

          {activeView === "courses" && (
          <section className="space-y-3">
        <div className="flex flex-col gap-1 px-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-ink">培训任务</h2>
            <p className="mt-1 text-sm text-slate-500">管理课程发布、视频生成和归档删除。</p>
          </div>
          <p className="text-xs text-slate-500">共 {jobs.length} 个课程</p>
        </div>

        <div className="hidden overflow-hidden ui-card xl:block">
          <div className="overflow-x-auto">
            <table className="min-w-[1180px] divide-y divide-line text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">课程</th>
                  <th className="px-4 py-3">PPT</th>
                  <th className="px-4 py-3">状态</th>
                  <th className="px-4 py-3">发布</th>
                  <th className="px-4 py-3">讲稿/语音</th>
                  <th className="px-4 py-3">课程视频</th>
                  <th className="px-4 py-3">时间</th>
                  <th className="px-4 py-3">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {jobs.map((job) => {
                  const latestAudioJob = latestTrainingAudioForJob(job.id, videoJobs);
                  const latestSlideVideo = latestSlideVideoForJob(job.id, videoJobs);
                  const audioBusy = latestAudioJob ? ["queued", "generating"].includes(latestAudioJob.status) : false;
                  const slideVideoBusy = latestSlideVideo ? ["queued", "generating"].includes(latestSlideVideo.status) : false;
                  return (
                    <tr key={job.id}>
                      <td className="px-4 py-3 font-medium text-ink">{job.title}</td>
                      <td className="px-4 py-3 text-slate-500">{job.ppt_file_name}</td>
                      <td className="px-4 py-3">
                        <StatusPill status={job.status} />
                        <p className="mt-1 max-w-48 text-xs leading-5 text-slate-500">{trainingStatusHint(job)}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${trainingPublishClass(job.publish_status)}`}>
                          {trainingPublishLabel(job.publish_status)}
                        </span>
                        {job.published_at && (
                          <p className="mt-1 text-xs text-slate-500">{new Date(job.published_at).toLocaleString("zh-CN")}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs leading-5 text-slate-500">
                        <p>{job.script_json.length} 页讲稿</p>
                        <p>{countSlideImages(job)} 页课件画面</p>
                        <p>{job.audio_paths.filter(Boolean).length} 页已缓存语音</p>
                        <TrainingAudioStatus job={job} audioJob={latestAudioJob} />
                        <p>{courseCompletionRate(job, progress, quizAttempts, activeLearners)}% 完课率</p>
                      </td>
                      <td className="px-4 py-3 text-xs leading-5 text-slate-500">
                        <SlideVideoStatus videoJob={latestSlideVideo} />
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">{new Date(job.created_at).toLocaleString("zh-CN")}</td>
                      <td className="px-4 py-3">
                        {renderJobActions(job, latestAudioJob, latestSlideVideo, audioBusy, slideVideoBusy, "table")}
                      </td>
                    </tr>
                  );
                })}
                {jobs.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-500">
                      暂无培训任务。上传一份 PPTX 开始生成讲稿。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid gap-3 xl:hidden">
          {jobs.map((job) => {
            const latestAudioJob = latestTrainingAudioForJob(job.id, videoJobs);
            const latestSlideVideo = latestSlideVideoForJob(job.id, videoJobs);
            const audioBusy = latestAudioJob ? ["queued", "generating"].includes(latestAudioJob.status) : false;
            const slideVideoBusy = latestSlideVideo ? ["queued", "generating"].includes(latestSlideVideo.status) : false;
            return (
              <article key={job.id} className="rounded-lg border border-line bg-white p-4 shadow-panel">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="break-words text-sm font-semibold text-ink">{job.title}</h3>
                    <p className="mt-1 break-words text-xs leading-5 text-slate-500">{job.ppt_file_name}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${trainingPublishClass(job.publish_status)}`}>
                    {trainingPublishLabel(job.publish_status)}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <StatusPill status={job.status} />
                  <span className="text-xs text-slate-500">{new Date(job.created_at).toLocaleString("zh-CN")}</span>
                </div>
                <p className="mt-2 text-xs leading-5 text-slate-500">{trainingStatusHint(job)}</p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <div className="rounded-lg border border-line bg-slate-50 px-3 py-2">
                    <p className="text-slate-500">讲稿</p>
                    <p className="mt-1 font-semibold text-ink">{job.script_json.length} 页</p>
                  </div>
                  <div className="rounded-lg border border-line bg-slate-50 px-3 py-2">
                    <p className="text-slate-500">课件画面</p>
                    <p className="mt-1 font-semibold text-ink">{countSlideImages(job)} 页</p>
                  </div>
                  <div className="rounded-lg border border-line bg-slate-50 px-3 py-2">
                    <p className="text-slate-500">语音缓存</p>
                    <p className="mt-1 font-semibold text-ink">{job.audio_paths.filter(Boolean).length} 页</p>
                    <TrainingAudioStatus job={job} audioJob={latestAudioJob} />
                  </div>
                  <div className="rounded-lg border border-line bg-slate-50 px-3 py-2">
                    <p className="text-slate-500">完课率</p>
                    <p className="mt-1 font-semibold text-ink">{courseCompletionRate(job, progress, quizAttempts, activeLearners)}%</p>
                  </div>
                </div>
                <div className="mt-3 rounded-lg border border-line bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
                  <p className="mb-2 font-semibold text-slate-500">课程视频</p>
                  <SlideVideoStatus videoJob={latestSlideVideo} />
                </div>
                <div className="mt-3">
                  {renderJobActions(job, latestAudioJob, latestSlideVideo, audioBusy, slideVideoBusy, "card")}
                </div>
              </article>
            );
          })}
          {jobs.length === 0 && (
            <div className="rounded-lg border border-dashed border-line bg-white px-4 py-8 text-center text-sm text-slate-500">
              暂无培训任务。上传一份 PPTX 开始生成讲稿。
            </div>
          )}
        </div>
          </section>
          )}
        </>
      )}
    </div>
    <ActionConfirmDialog
      request={confirmDialog}
      onCancel={() => settleTrainingConfirm(false)}
      onConfirm={() => settleTrainingConfirm(true)}
    />
    </>
  );
}

function TrainingViewButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={`min-h-11 rounded-md px-3 py-2 text-sm font-semibold transition ${active ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-100"}`}>
      {children}
    </button>
  );
}

function CourseSelectionBar({ jobs, selectedJobId, onChange }: { jobs: TrainingJob[]; selectedJobId: string; onChange: (id: string) => void }) {
  return (
    <section className="ui-card flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
      <label htmlFor="training-course-settings" className="shrink-0 text-sm font-semibold text-slate-700">当前课程</label>
      <select id="training-course-settings" value={selectedJobId} onChange={(event) => onChange(event.target.value)} className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-white px-3 text-sm outline-none focus:border-brand">
        {jobs.map((job) => <option key={job.id} value={job.id}>{job.title}</option>)}
      </select>
    </section>
  );
}

function TrainingAdminSkeleton() {
  return (
    <div className="space-y-5" aria-label="培训后台加载中">
      <section className="grid gap-3 md:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="ui-card p-4">
            <div className="animate-pulse space-y-3">
              <div className="h-3 w-20 rounded-full bg-slate-200" />
              <div className="h-7 w-14 rounded-full bg-slate-100" />
            </div>
          </div>
        ))}
      </section>
      <PanelSkeleton rows={2} />
      <PanelSkeleton rows={4} />
      <div className="hidden xl:block">
        <PanelSkeleton rows={6} />
      </div>
      <div className="grid gap-3 xl:hidden">
        {Array.from({ length: 3 }).map((_, index) => (
          <PanelSkeleton key={index} rows={4} />
        ))}
      </div>
    </div>
  );
}

function upsertById<T extends { id: string }>(items: T[], item: T) {
  const exists = items.some((current) => current.id === item.id);

  if (exists) {
    return items.map((current) => current.id === item.id ? item : current);
  }

  return [item, ...items];
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function TrainingLearnerReport({
  jobs,
  selectedJob,
  selectedJobId,
  onSelectedJobChange,
  rows,
  departmentFilter,
  departments,
  onDepartmentFilterChange,
  learnerSearch,
  onLearnerSearchChange,
  onExport
  ,onRevokeCertificate
}: {
  jobs: TrainingJob[];
  selectedJob: TrainingJob | null;
  selectedJobId: string;
  onSelectedJobChange: (jobId: string) => void;
  rows: LearnerReportRow[];
  departmentFilter: string;
  departments: string[];
  onDepartmentFilterChange: (department: string) => void;
  learnerSearch: string;
  onLearnerSearchChange: (keyword: string) => void;
  onExport: () => void;
  onRevokeCertificate: (certificate: TrainingCertificate) => void;
}) {
  const started = rows.filter((row) => row.progress).length;
  const completed = rows.filter((row) => row.status === "completed").length;
  const notStarted = rows.filter((row) => row.status === "not_started").length;
  const passedQuiz = rows.filter((row) => row.latestAttempt?.passed).length;
  const completionRate = rows.length > 0 ? Math.round((completed / rows.length) * 100) : 0;

  return (
    <section className="overflow-hidden ui-card">
      <div className="flex flex-col gap-3 border-b border-line px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-base font-semibold text-ink">学习跟踪</h2>
          <p className="mt-1 text-sm text-slate-500">按课程查看员工学习进度、完课状态与最近测验成绩。</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input aria-label="搜索员工" value={learnerSearch} onChange={(event) => onLearnerSearchChange(event.target.value)} placeholder="搜索员工" className="h-11 rounded-lg border border-line bg-white px-3 text-sm text-ink" />
          <select aria-label="选择课程" value={selectedJobId} onChange={(event) => onSelectedJobChange(event.target.value)} className="h-11 rounded-lg border border-line bg-white px-3 text-sm text-ink outline-none focus:border-brand sm:min-w-64">
            {jobs.map((job) => <option key={job.id} value={job.id}>{job.title}</option>)}
          </select>
          <select aria-label="筛选部门" value={departmentFilter} onChange={(event) => onDepartmentFilterChange(event.target.value)} className="h-11 rounded-lg border border-line bg-white px-3 text-sm text-ink">
            <option value="">全部部门</option>
            {departments.map((department) => <option key={department} value={department}>{department}</option>)}
          </select>
          <button type="button" onClick={onExport} disabled={!selectedJob} className="ui-button-secondary h-11"><Download size={16} />导出</button>
        </div>
      </div>

      <div className="grid gap-3 border-b border-line bg-slate-50/70 p-4 md:grid-cols-5">
        <LearnerMetric label="员工" value={rows.length} />
        <LearnerMetric label="已开始" value={started} />
        <LearnerMetric label="未开始" value={notStarted} tone="warn" />
        <LearnerMetric label="已完课" value={completed} tone="good" />
        <LearnerMetric label="完课率" value={`${completionRate}%`} tone="good" />
      </div>

      <div className="grid gap-3 p-4 lg:hidden">
        {jobs.length === 0 && (
          <div className="rounded-lg border border-dashed border-line bg-white px-4 py-8 text-center text-sm text-slate-500">
            暂无课程，创建并发布课程后可跟踪学习情况。
          </div>
        )}
        {jobs.length > 0 && rows.length === 0 && (
          <div className="rounded-lg border border-dashed border-line bg-white px-4 py-8 text-center text-sm text-slate-500">
            暂无在职员工账号，请先在用户管理中创建员工。
          </div>
        )}
        {rows.map((row) => (
          <article key={row.user.id} className="rounded-lg border border-line bg-white p-3 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="break-words text-sm font-semibold text-ink">{row.user.name}</p>
                <p className="mt-1 break-words text-xs text-slate-500">{row.user.email}</p>
              </div>
              <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${learnerStatusClass(row.status)}`}>
                {row.status === "completed" ? <UserCheck size={13} /> : row.status === "not_started" ? <UserX size={13} /> : <Clock size={13} />}
                {learnerStatusLabel(row.status)}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">
              <div>
                <p className="font-medium text-slate-600">部门</p>
                <p>{row.user.department || "未填写部门"}</p>
              </div>
              <div>
                <p className="font-medium text-slate-600">岗位</p>
                <p>{row.user.position || "未填写岗位"}</p>
              </div>
            </div>
            <div className="mt-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-medium text-slate-600">学习进度</p>
                <span className="text-xs font-semibold text-ink">{row.progress?.progress_percent ?? 0}%</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-brand transition-all"
                  style={{ width: `${row.progress?.progress_percent ?? 0}%` }}
                />
              </div>
              {selectedJob && row.progress && (
                <p className="mt-1 text-xs text-slate-500">
                  第 {Math.min(row.progress.current_page + 1, selectedJob.script_json.length)} / {selectedJob.script_json.length} 页
                </p>
              )}
            </div>
            <div className="mt-3 grid gap-2 text-xs leading-5 text-slate-500 sm:grid-cols-2">
              <div className="rounded-lg border border-line px-3 py-2">
                <p className="font-medium text-slate-600">最近测验</p>
                {row.latestAttempt ? (
                  <p className="mt-1">
                    {row.latestAttempt.score} 分，{row.latestAttempt.passed ? "已通过" : "未通过"}
                  </p>
                ) : (
                  <p className="mt-1">未提交</p>
                )}
                {row.certificate && <div className="mt-2"><p className={row.certificate.revoked_at ? "text-red-600" : "text-emerald-700"}>{row.certificate.revoked_at ? "证书已作废" : row.certificate.certificate_no}</p>{!row.certificate.revoked_at && <button type="button" onClick={() => onRevokeCertificate(row.certificate!)} className="mt-1 text-red-600 hover:underline">作废证书</button>}</div>}
              </div>
              <div className="rounded-lg border border-line px-3 py-2">
                <p className="font-medium text-slate-600">最近更新</p>
                <p className="mt-1">{row.progress ? formatDateTime(row.progress.last_active_at ?? row.progress.updated_at) : "-"}</p>
                <p>{formatLearningDuration(row.progress?.total_learning_seconds ?? 0)}</p>
              </div>
            </div>
          </article>
        ))}
      </div>

      <div className="hidden overflow-x-auto lg:block">
        <table className="min-w-[860px] divide-y divide-line text-sm">
          <thead className="bg-white text-left text-xs font-semibold uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">员工</th>
              <th className="px-4 py-3">部门 / 岗位</th>
              <th className="px-4 py-3">学习状态</th>
              <th className="px-4 py-3">进度</th>
              <th className="px-4 py-3">最近测验</th>
              <th className="px-4 py-3">最近更新</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <tr key={row.user.id}>
                <td className="px-4 py-3">
                  <p className="font-medium text-ink">{row.user.name}</p>
                  <p className="mt-1 text-xs text-slate-500">{row.user.email}</p>
                </td>
                <td className="px-4 py-3 text-xs leading-5 text-slate-500">
                  <p>{row.user.department || "未填写部门"}</p>
                  <p>{row.user.position || "未填写岗位"}</p>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${learnerStatusClass(row.status)}`}>
                    {row.status === "completed" ? <UserCheck size={13} /> : row.status === "not_started" ? <UserX size={13} /> : <Clock size={13} />}
                    {learnerStatusLabel(row.status)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex min-w-44 items-center gap-3">
                    <div className="h-2 w-28 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-brand"
                        style={{ width: `${row.progress?.progress_percent ?? 0}%` }}
                      />
                    </div>
                    <span className="text-xs font-medium text-slate-600">{row.progress?.progress_percent ?? 0}%</span>
                  </div>
                  {selectedJob && row.progress && (
                    <p className="mt-1 text-xs text-slate-500">
                      第 {Math.min(row.progress.current_page + 1, selectedJob.script_json.length)} / {selectedJob.script_json.length} 页
                    </p>
                  )}
                </td>
                <td className="px-4 py-3 text-xs leading-5 text-slate-500">
                  {row.latestAttempt ? (
                    <>
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${
                        row.latestAttempt.passed ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                      }`}>
                        <Trophy size={12} />
                        {row.latestAttempt.score} 分
                      </span>
                      <p className="mt-1">{row.latestAttempt.passed ? "已通过" : "未通过"} · {formatDateTime(row.latestAttempt.created_at)}</p>
                    </>
                  ) : (
                    "未提交"
                  )}
                  {row.certificate && <div className="mt-1"><p className={row.certificate.revoked_at ? "text-red-600" : "text-emerald-700"}>{row.certificate.revoked_at ? "证书已作废" : row.certificate.certificate_no}</p>{!row.certificate.revoked_at && <button type="button" onClick={() => onRevokeCertificate(row.certificate!)} className="text-red-600 hover:underline">作废</button>}</div>}
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">
                  {row.progress ? formatDateTime(row.progress.last_active_at ?? row.progress.updated_at) : "-"}
                  {row.progress && <p className="mt-1">{formatLearningDuration(row.progress.total_learning_seconds)}</p>}
                </td>
              </tr>
            ))}
            {jobs.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">
                  暂无课程，创建并发布课程后可跟踪学习情况。
                </td>
              </tr>
            )}
            {jobs.length > 0 && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">
                  暂无在职员工账号，请先在用户管理中创建员工。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {selectedJob && (
        <div className="border-t border-line bg-white px-5 py-3 text-xs text-slate-500">
          当前课程：{selectedJob.publish_status === "published" ? "已发布" : "未发布"}；最近通过测验 {passedQuiz} 人。
        </div>
      )}
    </section>
  );
}

function TrainingAuditTimeline({ events, users }: { events: TrainingAuditEvent[]; users: UserProfile[] }) {
  return (
    <section className="ui-card p-5">
      <h2 className="text-base font-semibold text-ink">课程操作记录</h2>
      <div className="mt-4 divide-y divide-line">
        {events.slice(0, 20).map((event) => (
          <div key={event.id} className="flex flex-col gap-1 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <div><p className="font-medium text-ink">{event.detail}</p><p className="mt-1 text-xs text-slate-500">{users.find((user) => user.id === event.actor_id)?.name ?? event.actor_id}</p></div>
            <time className="text-xs text-slate-500">{formatDateTime(event.created_at)}</time>
          </div>
        ))}
        {events.length === 0 && <p className="py-6 text-center text-sm text-slate-500">暂无操作记录，后续发布、下架和语音生成会在这里留痕。</p>}
      </div>
    </section>
  );
}

function TrainingReadiness({
  stats,
  loading
}: {
  stats: {
    total: number;
    draft: number;
    generating: number;
    ready: number;
    failed: number;
    pages: number;
    slideImages: number;
    audio: number;
    learners: number;
    completedLearners: number;
    videos: number;
    published: number;
    unpublished: number;
  };
  loading: boolean;
}) {
  const steps = [
    {
      label: "上传 PPTX",
      ready: stats.total > 0 || loading,
      detail: stats.total > 0 ? `已创建 ${stats.total} 个课程` : "选择文字型 PPTX 文件"
    },
    {
      label: "生成逐页讲稿",
      ready: stats.pages > 0,
      detail: stats.pages > 0 ? `已生成 ${stats.pages} 页讲稿` : "提取页面文字与备注"
    },
    {
      label: "生成课件画面",
      ready: stats.slideImages > 0,
      detail: stats.slideImages > 0 ? `${stats.slideImages} 页课件画面` : "服务器安装渲染工具后自动生成"
    },
    {
      label: "试听语音",
      ready: stats.audio > 0,
      detail: stats.audio > 0 ? `${stats.audio} 页语音已缓存` : "进入播放页后按页生成"
    },
    {
      label: "员工可学习",
      ready: stats.published > 0,
      detail: stats.published > 0 ? `${stats.published} 个课程已发布` : "发布后才出现在员工培训列表"
    },
    {
      label: "课程视频",
      ready: stats.videos > 0,
      detail: stats.videos > 0 ? `${stats.videos} 个视频可播放` : "可生成课件视频，或配置数字人 API"
    }
  ];

  return (
    <section className="space-y-2" data-testid="training-readiness">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="课程" value={stats.total} />
        <Metric label="可用" value={stats.ready} tone="good" />
        <Metric label="已发布" value={stats.published} tone="good" />
        <Metric label="完成学习" value={stats.completedLearners} tone="good" />
      </div>
      <details className="ui-card group overflow-hidden">
        <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
          <span>查看生成进度与媒体指标</span>
          <ChevronDown className="size-4 text-slate-400 transition group-open:rotate-180" />
        </summary>
        <div className="border-t border-line p-3">
          <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
            <Metric label="讲稿页" value={stats.pages} />
            <Metric label="课件页" value={stats.slideImages} />
            <Metric label="语音页" value={stats.audio} tone="warn" />
            <Metric label="视频" value={stats.videos} tone="good" />
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-3 xl:grid-cols-6">
            {steps.map((step) => (
              <div key={step.label} className={`rounded-lg border px-3 py-2 ${step.ready ? "border-emerald-200 bg-emerald-50" : "border-line bg-slate-50"}`}>
                <div className="flex items-center gap-2">
                  {step.ready ? <CheckCircle2 size={15} className="text-emerald-700" /> : <Clock size={15} className="text-slate-500" />}
                  <p className={`text-xs font-semibold ${step.ready ? "text-emerald-800" : "text-slate-700"}`}>{step.label}</p>
                </div>
                <p className={`mt-1 text-xs leading-5 ${step.ready ? "text-emerald-700" : "text-slate-500"}`}>{step.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </details>
      {stats.failed > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <span className="inline-flex items-center gap-2 font-medium">
            <CircleAlert size={15} />
            有 {stats.failed} 个课程生成失败
          </span>
          <p className="mt-1">请检查 PPT 是否包含可解析文字、文件大小是否超限，或确认 OpenAI 配置是否可用。</p>
        </div>
      )}
    </section>
  );
}

function buildLearnerRows(
  job: TrainingJob,
  learners: UserProfile[],
  progress: TrainingProgress[],
  quizAttempts: TrainingQuizAttempt[],
  certificates: TrainingCertificate[]
): LearnerReportRow[] {
  return learners.map((user) => {
    const progressRecord = progress.find((item) => item.training_job_id === job.id && item.user_id === user.id) ?? null;
    const latestAttempt = quizAttempts
      .filter((item) => item.training_job_id === job.id && item.user_id === user.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
    const status = !progressRecord
      ? "not_started"
      : progressRecord.progress_percent >= 100
        ? job.quiz_enabled && !latestAttempt?.passed ? "awaiting_exam" : "completed"
        : "learning";

    return {
      user,
      progress: progressRecord,
      latestAttempt,
      certificate: certificates.find((item) => item.training_job_id === job.id && item.user_id === user.id) ?? null,
      status
    };
  });
}

function isActiveEmployee(user: UserProfile) {
  return user.role === "employee" && user.status === "active";
}

function courseCompletionRate(job: TrainingJob, progress: TrainingProgress[], quizAttempts: TrainingQuizAttempt[], learners: UserProfile[]) {
  const targetLearners = visibleLearners(job, learners);
  if (targetLearners.length === 0) {
    return 0;
  }

  const related = progress.filter((item) => item.training_job_id === job.id);

  const completed = related.filter((item) => {
    if (item.progress_percent < 100 || !targetLearners.some((user) => user.id === item.user_id)) return false;
    return !job.quiz_enabled || quizAttempts.some((attempt) => attempt.training_job_id === job.id && attempt.user_id === item.user_id && attempt.passed);
  }).length;
  return Math.round((completed / targetLearners.length) * 100);
}

function visibleLearners(job: TrainingJob, learners: UserProfile[]) {
  return job.visible_departments.length === 0
    ? learners
    : learners.filter((user) => job.visible_departments.includes(user.department));
}

function learnerStatusLabel(status: LearnerReportRow["status"]) {
  const labels: Record<LearnerReportRow["status"], string> = {
    not_started: "未开始",
    learning: "学习中",
    awaiting_exam: "待考试",
    completed: "已完课"
  };

  return labels[status];
}

function learnerStatusClass(status: LearnerReportRow["status"]) {
  const classes: Record<LearnerReportRow["status"], string> = {
    not_started: "bg-slate-100 text-slate-600",
    learning: "bg-cyan/10 text-brand",
    awaiting_exam: "bg-amber-50 text-amber-700",
    completed: "bg-emerald-50 text-emerald-700"
  };

  return classes[status];
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleString("zh-CN");
}

function LearnerMetric({ label, value, tone }: { label: string; value: number | string; tone?: "good" | "warn" }) {
  const toneClass = tone === "good" ? "text-emerald-700" : tone === "warn" ? "text-amber-700" : "text-ink";

  return (
    <div className="rounded-lg border border-line bg-white px-3 py-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}

function latestSlideVideoForJob(jobId: string, videoJobs: TrainingVideoJob[]) {
  return videoJobs
    .filter((item) => item.training_job_id === jobId && item.provider === "slide-video")
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
}

function latestTrainingAudioForJob(jobId: string, videoJobs: TrainingVideoJob[]) {
  return videoJobs
    .filter((item) => item.training_job_id === jobId && item.provider === "training-audio")
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
}

function TrainingAudioStatus({ job, audioJob }: { job: TrainingJob; audioJob: TrainingVideoJob | null }) {
  const cachedAudio = job.audio_paths.filter(Boolean).length;

  if (!audioJob) {
    return <p className="text-slate-500">{cachedAudio >= job.script_json.length && job.script_json.length > 0 ? "语音已缓存" : "语音未预生成"}</p>;
  }

  const progress = getTrainingAudioProgress(audioJob);

  if (audioJob.status === "ready") {
    return (
      <p className="inline-flex items-center gap-1.5 font-medium text-emerald-700">
        <CheckCircle2 size={13} />
        语音已缓存 {Math.max(cachedAudio, progress.audio_done)}/{job.script_json.length}
      </p>
    );
  }

  if (audioJob.status === "failed") {
    return (
      <p className="inline-flex items-center gap-1.5 font-medium text-red-700">
        <CircleAlert size={13} />
        语音失败，可重试
      </p>
    );
  }

  return (
    <div className="mt-1 min-w-40 space-y-1">
      <div className="flex items-center justify-between gap-3">
        <p className="inline-flex items-center gap-1.5 font-medium text-brand">
          <Clock size={13} />
          语音生成中
        </p>
        <span className="tabular-nums text-slate-500">{progress.progress}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${progress.progress}%` }} />
      </div>
      <p className="text-[11px] text-slate-500">
        语音 {progress.audio_done}/{progress.total_pages || job.script_json.length}
      </p>
    </div>
  );
}

function trainingAudioActionLabel(job: TrainingJob, audioJob: TrainingVideoJob | null) {
  if (isAudioFullyCached(job, audioJob)) {
    return "课程语音已缓存";
  }

  if (!audioJob) {
    return "预生成课程语音";
  }

  if (["queued", "generating"].includes(audioJob.status)) {
    return "课程语音生成中";
  }

  return audioJob.status === "failed" ? "重新生成课程语音" : "补齐课程语音";
}

function isAudioFullyCached(job: TrainingJob, audioJob: TrainingVideoJob | null) {
  return job.script_json.length > 0 &&
    job.audio_paths.filter(Boolean).length >= job.script_json.length &&
    audioJob?.status !== "failed";
}

function getTrainingAudioProgress(audioJob: TrainingVideoJob) {
  const metadata = audioJob.metadata ?? {};
  const totalPages = numberFromMetadata(metadata.total_pages);
  const progress = numberFromMetadata(metadata.progress);

  return {
    progress: Math.max(0, Math.min(100, progress || (audioJob.status === "ready" ? 100 : 0))),
    total_pages: Math.max(0, totalPages),
    audio_done: Math.max(0, numberFromMetadata(metadata.audio_done)),
    message: typeof metadata.message === "string" ? metadata.message : ""
  };
}

function SlideVideoStatus({ videoJob }: { videoJob: TrainingVideoJob | null }) {
  if (!videoJob) {
    return <p>未生成</p>;
  }

  const progress = getSlideVideoProgress(videoJob);

  if (videoJob.status === "ready") {
    return (
      <div className="space-y-1">
        <p className="inline-flex items-center gap-1.5 font-medium text-emerald-700">
          <CheckCircle2 size={13} />
          视频已生成
        </p>
        <p>{progress.total_slides} 页课件视频</p>
      </div>
    );
  }

  if (videoJob.status === "failed") {
    return (
      <div className="space-y-1">
        <p className="inline-flex items-center gap-1.5 font-medium text-red-700">
          <CircleAlert size={13} />
          生成失败，可重新生成
        </p>
        <p className="max-w-52 text-red-600">{videoJob.error_message ?? progress.message ?? "课件视频生成失败"}</p>
      </div>
    );
  }

  return (
    <div className="min-w-48 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="inline-flex items-center gap-1.5 font-medium text-brand">
          <Clock size={13} />
          {videoJob.status === "queued" ? "排队中" : "生成中"}
        </p>
        <span className="tabular-nums text-slate-500">{progress.progress}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${progress.progress}%` }} />
      </div>
      <div className="grid grid-cols-3 gap-1 text-[11px] text-slate-500">
        <span>画面 {progress.slide_images_done}/{progress.total_slides}</span>
        <span>语音 {progress.audio_done}/{progress.total_slides}</span>
        <span>视频 {progress.video_done}/{progress.total_slides}</span>
      </div>
      {progress.message && <p className="max-w-56 leading-5 text-slate-500">{progress.message}</p>}
    </div>
  );
}

function slideVideoActionLabel(videoJob: TrainingVideoJob | null) {
  if (!videoJob) {
    return "生成课件视频";
  }

  if (["queued", "generating"].includes(videoJob.status)) {
    return "课件视频生成中";
  }

  return videoJob.status === "failed" ? "重新生成课件视频" : "重新生成课件视频";
}

function getSlideVideoProgress(videoJob: TrainingVideoJob) {
  const metadata = videoJob.metadata ?? {};
  const totalSlides = numberFromMetadata(metadata.total_slides) || numberFromMetadata(metadata.slide_count);
  const progress = numberFromMetadata(metadata.progress);

  return {
    progress: Math.max(0, Math.min(100, progress || (videoJob.status === "ready" ? 100 : 0))),
    total_slides: Math.max(0, totalSlides),
    slide_images_done: Math.max(0, numberFromMetadata(metadata.slide_images_done)),
    audio_done: Math.max(0, numberFromMetadata(metadata.audio_done)),
    video_done: Math.max(0, numberFromMetadata(metadata.video_done)),
    message: typeof metadata.message === "string" ? metadata.message : ""
  };
}

function numberFromMetadata(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }

  return 0;
}

function csvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function formatLearningDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return minutes < 1 ? `${Math.round(seconds)} 秒` : `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}

function trainingPublishLabel(status: TrainingJob["publish_status"]) {
  const labels: Record<TrainingJob["publish_status"], string> = {
    draft: "未发布",
    published: "已发布",
    archived: "已下架"
  };

  return labels[status];
}

function trainingPublishClass(status: TrainingJob["publish_status"]) {
  const classes: Record<TrainingJob["publish_status"], string> = {
    draft: "bg-slate-100 text-slate-700",
    published: "bg-emerald-50 text-emerald-700",
    archived: "bg-zinc-100 text-zinc-500"
  };

  return classes[status];
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: "good" | "warn" }) {
  const toneClass = tone === "good" ? "text-emerald-700" : tone === "warn" ? "text-amber-700" : "text-ink";

  return (
    <div className="min-w-16 ui-card-muted px-3 py-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}

function countSlideImages(job: TrainingJob) {
  return job.script_json.filter((slide) => slide.image_path).length;
}

function trainingStatusHint(job: TrainingJob) {
  if (job.status === "ready") {
    const slideImages = countSlideImages(job);
    return slideImages > 0
      ? `讲稿已生成，已渲染 ${slideImages} 页课件画面。`
      : "讲稿已生成，进入播放页可按页生成语音。";
  }

  if (job.status === "generating") {
    const slideImages = countSlideImages(job);
    if (job.script_json.length > 0) {
      return `正在后台生成，已解析 ${job.script_json.length} 页，已渲染 ${slideImages} 页课件画面。`;
    }

    return "正在后台解析 PPT 并生成讲稿。";
  }

  if (job.status === "failed") {
    return "生成失败，请检查 PPT 内容或重新上传。";
  }

  return "等待生成。";
}
