"use client";

import { useEffect, useState } from "react";
import { BellRing, BookOpenCheck, CirclePlus, Loader2, Save, Sparkles, Trash2 } from "lucide-react";
import { useToast } from "@/components/ui-feedback";
import type { TrainingJob, TrainingQuestionType, TrainingQuizQuestion } from "@/lib/types";

export function TrainingQuizAdmin({ job, onUpdated }: { job: TrainingJob; onUpdated: () => Promise<void> }) {
  const [questions, setQuestions] = useState<TrainingQuizQuestion[]>([]);
  const [settings, setSettings] = useState(() => settingsFromJob(job));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { pushToast } = useToast();

  useEffect(() => {
    setSettings(settingsFromJob(job));
    setLoading(true);
    fetch(`/api/admin/training-quiz/${job.id}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "读取题库失败");
        setQuestions(data.questions ?? []);
      })
      .catch((error) => pushToast({ tone: "error", title: "读取题库失败", description: error instanceof Error ? error.message : undefined }))
      .finally(() => setLoading(false));
  }, [job, pushToast]);

  async function generateQuestions() {
    setSaving(true);
    try {
      const response = await fetch(`/api/admin/training-quiz/${job.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "generate" }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "生成题目失败");
      setQuestions(data.questions ?? []);
      pushToast({ tone: "success", title: "题目初稿已生成", description: "请核对题干、答案和解析后发布。" });
    } catch (error) {
      pushToast({ tone: "error", title: "生成题目失败", description: error instanceof Error ? error.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  async function saveQuestions(publish: boolean) {
    setSaving(true);
    try {
      const response = await fetch(`/api/admin/training-quiz/${job.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questions, settings, publish })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "保存考试失败");
      setQuestions(data.questions ?? []);
      await onUpdated();
      pushToast({ tone: "success", title: publish ? "正式考试已发布" : "考试草稿已保存" });
    } catch (error) {
      pushToast({ tone: "error", title: "保存考试失败", description: error instanceof Error ? error.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  async function sendReminder() {
    setSaving(true);
    try {
      const response = await fetch(`/api/admin/training-reminders/${job.id}`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "发送提醒失败");
      pushToast({ tone: "success", title: "学习提醒已发送", description: data.message });
    } catch (error) {
      pushToast({ tone: "error", title: "发送提醒失败", description: error instanceof Error ? error.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  function updateQuestion(index: number, patch: Partial<TrainingQuizQuestion>) {
    setQuestions((current) => current.map((question, questionIndex) => questionIndex === index ? { ...question, ...patch } : question));
  }

  function addQuestion() {
    const now = new Date().toISOString();
    setQuestions((current) => [...current, {
      id: `new-${Date.now()}`,
      training_job_id: job.id,
      type: "single",
      prompt: "",
      options: ["选项 A", "选项 B"],
      correct_answers: ["选项 A"],
      explanation: "",
      score_weight: 1,
      order_index: current.length,
      status: "draft",
      created_by: null,
      created_at: now,
      updated_at: now
    }]);
  }

  return (
    <section className="ui-card p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2"><BookOpenCheck size={18} className="text-brand" /><h2 className="text-base font-semibold text-ink">正式考试与完课证书</h2></div>
          <p className="mt-1 text-sm text-slate-500">管理员审核题目后发布；员工完成全部课程学习后才能参加考试。</p>
        </div>
        <button type="button" onClick={() => void generateQuestions()} disabled={saving || job.script_json.length === 0} className="ui-button-secondary h-10">
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}根据讲稿生成初稿
        </button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm text-slate-600">合格分数<input type="number" min={60} max={100} value={settings.quiz_pass_score} onChange={(event) => setSettings((current) => ({ ...current, quiz_pass_score: Number(event.target.value) }))} className="mt-1 h-10 w-full rounded-lg border border-line px-3" /></label>
        <label className="text-sm text-slate-600">最多考试次数<input type="number" min={1} max={10} value={settings.quiz_max_attempts} onChange={(event) => setSettings((current) => ({ ...current, quiz_max_attempts: Number(event.target.value) }))} className="mt-1 h-10 w-full rounded-lg border border-line px-3" /></label>
        <label className="text-sm text-slate-600">考试时限（分钟）<input type="number" min={5} max={180} value={settings.quiz_time_limit_minutes} onChange={(event) => setSettings((current) => ({ ...current, quiz_time_limit_minutes: Number(event.target.value) }))} className="mt-1 h-10 w-full rounded-lg border border-line px-3" /></label>
        <label className="text-sm text-slate-600">完成期限<input type="datetime-local" value={settings.due_at} onChange={(event) => setSettings((current) => ({ ...current, due_at: event.target.value }))} className="mt-1 h-10 w-full rounded-lg border border-line px-3" /></label>
      </div>
      <div className="mt-3 flex flex-wrap gap-5 text-sm text-slate-700">
        <label className="flex items-center gap-2"><input type="checkbox" checked={settings.mandatory} onChange={(event) => setSettings((current) => ({ ...current, mandatory: event.target.checked }))} />必修课程</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={settings.quiz_enabled} onChange={(event) => setSettings((current) => ({ ...current, quiz_enabled: event.target.checked }))} />启用考试</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={settings.certificate_enabled} onChange={(event) => setSettings((current) => ({ ...current, certificate_enabled: event.target.checked }))} />通过后签发证书</label>
      </div>

      {loading ? <div className="mt-5 flex items-center gap-2 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" />正在读取题库</div> : (
        <div className="mt-5 space-y-3">
          {questions.length === 0 && <div className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-slate-500">尚未配置题目，可以根据讲稿生成初稿或手动添加。</div>}
          {questions.map((question, index) => <QuestionEditor key={question.id} question={question} index={index} onChange={(patch) => updateQuestion(index, patch)} onDelete={() => setQuestions((current) => current.filter((_, itemIndex) => itemIndex !== index))} />)}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={addQuestion} className="ui-button-secondary h-10"><CirclePlus size={16} />添加题目</button>
        <button type="button" onClick={() => void saveQuestions(false)} disabled={saving || (settings.quiz_enabled && questions.length === 0)} className="ui-button-secondary h-10"><Save size={16} />保存考试设置</button>
        <button type="button" onClick={() => void saveQuestions(true)} disabled={saving || !settings.quiz_enabled || questions.length === 0} className="ui-button-primary h-10">{saving ? <Loader2 size={16} className="animate-spin" /> : <BookOpenCheck size={16} />}发布正式考试</button>
        <button type="button" onClick={() => void sendReminder()} disabled={saving || job.publish_status !== "published"} className="ui-button-secondary h-10"><BellRing size={16} />提醒未完课员工</button>
      </div>
    </section>
  );
}

function QuestionEditor({ question, index, onChange, onDelete }: { question: TrainingQuizQuestion; index: number; onChange: (patch: Partial<TrainingQuizQuestion>) => void; onDelete: () => void }) {
  return <div className="rounded-lg border border-line p-4">
    <div className="flex items-center gap-3">
      <span className="text-sm font-semibold text-ink">第 {index + 1} 题</span>
      <select value={question.type} onChange={(event) => { const type = event.target.value as TrainingQuestionType; onChange({ type, options: type === "true_false" ? ["正确", "错误"] : question.options, correct_answers: type === "true_false" ? ["正确"] : question.correct_answers }); }} className="h-9 rounded-lg border border-line px-2 text-sm">
        <option value="single">单选题</option><option value="multiple">多选题</option><option value="true_false">判断题</option>
      </select>
      <button type="button" onClick={onDelete} className="ml-auto grid h-9 w-9 place-items-center rounded-lg text-red-600 hover:bg-red-50" aria-label={`删除第 ${index + 1} 题`}><Trash2 size={16} /></button>
    </div>
    <textarea value={question.prompt} onChange={(event) => onChange({ prompt: event.target.value })} placeholder="题干" className="mt-3 min-h-20 w-full rounded-lg border border-line px-3 py-2 text-sm" />
    <div className="mt-3 grid gap-3 md:grid-cols-2">
      <label className="text-xs text-slate-500">选项（每行一个）<textarea disabled={question.type === "true_false"} value={question.options.join("\n")} onChange={(event) => onChange({ options: event.target.value.split("\n").map((item) => item.trim()).filter(Boolean) })} className="mt-1 min-h-24 w-full rounded-lg border border-line px-3 py-2 text-sm disabled:bg-slate-50" /></label>
      <label className="text-xs text-slate-500">正确答案（多选用逗号分隔）<input value={question.correct_answers.join(",")} onChange={(event) => onChange({ correct_answers: event.target.value.split(/[,，]/).map((item) => item.trim()).filter(Boolean) })} className="mt-1 h-10 w-full rounded-lg border border-line px-3 text-sm" /><span className="mt-2 block">解析</span><textarea value={question.explanation} onChange={(event) => onChange({ explanation: event.target.value })} className="mt-1 min-h-14 w-full rounded-lg border border-line px-3 py-2 text-sm" /></label>
    </div>
  </div>;
}

function settingsFromJob(job: TrainingJob) {
  return {
    mandatory: job.mandatory,
    due_at: job.due_at ? new Date(job.due_at).toISOString().slice(0, 16) : "",
    quiz_enabled: job.quiz_enabled,
    quiz_pass_score: job.quiz_pass_score,
    quiz_max_attempts: job.quiz_max_attempts,
    quiz_time_limit_minutes: job.quiz_time_limit_minutes,
    certificate_enabled: job.certificate_enabled
  };
}
