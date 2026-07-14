"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CalendarClock, FileAudio, FileImage, Play } from "lucide-react";
import { StatusPill } from "@/components/status-pill";
import { ErrorRetry, PanelSkeleton } from "@/components/ui-feedback";
import type { TrainingCertificate, TrainingJob, TrainingProgress, TrainingQuizAttempt } from "@/lib/types";

export function TrainingList() {
  const [jobs, setJobs] = useState<TrainingJob[]>([]);
  const [progress, setProgress] = useState<TrainingProgress[]>([]);
  const [quizAttempts, setQuizAttempts] = useState<TrainingQuizAttempt[]>([]);
  const [certificates, setCertificates] = useState<TrainingCertificate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadTraining = useCallback(async () => {
    setLoading(true);

    try {
      const response = await fetch("/api/training", { cache: "no-store" });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "培训列表加载失败");
      }

      setJobs(data.trainingJobs ?? []);
      setProgress(data.trainingProgress ?? []);
      setQuizAttempts(data.quizAttempts ?? []);
      setCertificates(data.certificates ?? []);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "培训列表加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTraining();
  }, [loadTraining]);

  return (
    <div className="space-y-5">
      <section className="ui-card p-5 shadow-soft">
        <h1 className="text-xl font-semibold text-ink">培训讲解</h1>
        <p className="mt-1 text-sm text-slate-500">查看已生成的 PPT 逐页讲稿，并播放语音讲解。</p>
      </section>

      {loading && jobs.length === 0 && <TrainingListSkeleton />}

      {!loading && loadError && jobs.length === 0 && (
        <ErrorRetry
          title="培训列表加载失败"
          message={loadError}
          retrying={loading}
          onRetry={() => void loadTraining()}
        />
      )}

      {(!loading || jobs.length > 0) && (!loadError || jobs.length > 0) && (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {jobs.map((job) => (
            <TrainingCourseCard key={job.id} job={job} progress={progress.find((item) => item.training_job_id === job.id) ?? null} passed={quizAttempts.some((item) => item.training_job_id === job.id && item.passed)} certificate={certificates.find((item) => item.training_job_id === job.id && !item.revoked_at) ?? null} />
          ))}
          {jobs.length === 0 && (
            <div className="rounded-lg border border-dashed border-line bg-white p-8 text-center text-sm leading-6 text-slate-500 md:col-span-2 xl:col-span-3">
              <p className="font-semibold text-ink">暂无已发布培训内容</p>
              <p className="mt-1">管理员上传 PPTX 并发布课程后，员工可在这里查看讲稿、语音和课件视频。</p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function TrainingListSkeleton() {
  return (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="培训列表加载中">
      {Array.from({ length: 3 }).map((_, index) => (
        <PanelSkeleton key={index} rows={3} />
      ))}
    </section>
  );
}

function TrainingCourseCard({ job, progress, passed, certificate }: { job: TrainingJob; progress: TrainingProgress | null; passed: boolean; certificate: TrainingCertificate | null }) {
  const status = courseLearningStatus(job, progress, passed);
  return (
    <Link
      href={`/training/${job.id}`}
      className="ui-card block min-w-0 p-5 transition hover:border-cyan/30 hover:shadow-soft"
    >
      {job.cover_url && (
        <img src={job.cover_url} alt="" className="mb-4 aspect-[16/7] w-full rounded-lg object-cover" />
      )}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-ink">{job.title}</h2>
          <p className="mt-1 truncate text-sm text-slate-500">{job.instructor || "企业培训"}</p>
        </div>
        <span className="grid size-9 place-items-center rounded-lg bg-cyan/10 text-brand">
          <Play size={17} />
        </span>
      </div>
      {job.description && <p className="mt-3 line-clamp-2 text-sm leading-6 text-slate-600">{job.description}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <StatusPill status={job.status} />
        {job.mandatory && <span className="inline-flex rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">必修</span>}
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
          <FileAudio size={13} />
          {job.audio_paths.filter(Boolean).length} 页语音
        </span>
        {job.script_json.some((slide) => slide.image_path) && (
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
            <FileImage size={13} />
            {job.script_json.filter((slide) => slide.image_path).length} 页画面
          </span>
        )}
        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs ${
          status === "completed" ? "bg-emerald-50 text-emerald-700" : status === "awaiting_exam" ? "bg-amber-50 text-amber-700" : "bg-cyan/10 text-brand"
        }`}>
          {status === "completed" ? "已完成" : status === "awaiting_exam" ? "学习完成，待考试" : `${progress?.progress_percent ?? 0}% 学习`}
        </span>
        {certificate && <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700">已获证书</span>}
      </div>
      <p className="mt-4 text-xs leading-5 text-slate-500">
        {job.due_at ? <span className={`inline-flex items-center gap-1 ${progress?.progress_percent !== 100 && new Date(job.due_at).getTime() < Date.now() ? "font-medium text-red-600" : ""}`}><CalendarClock size={13} />{progress?.progress_percent !== 100 && new Date(job.due_at).getTime() < Date.now() ? "已逾期 · " : "截止 "}{new Date(job.due_at).toLocaleDateString("zh-CN")}</span> : `${job.script_json.length} 页讲稿 · ${new Date(job.created_at).toLocaleString("zh-CN")}`}
      </p>
    </Link>
  );
}

function courseLearningStatus(job: TrainingJob, progress: TrainingProgress | null, passed: boolean) {
  if (!progress) return "not_started";
  if (progress.progress_percent < 100) return "learning";
  if (job.quiz_enabled && !passed) return "awaiting_exam";
  return "completed";
}
