import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Activity,
  ArrowRight,
  BookOpen,
  Cpu,
  Database,
  FileAudio,
  FileCheck2,
  FileUp,
  Gauge,
  MessageSquareText,
  Radar,
  ThumbsUp
} from "lucide-react";
import { Shell } from "@/components/shell";
import { StatusPill } from "@/components/status-pill";
import { getCurrentUserOrNull } from "@/lib/db";
import { getDashboardStats } from "@/lib/dashboard";

const actions = [
  {
    title: "上传企业资料",
    body: "把制度、培训手册、产品资料加入知识库。",
    href: "/admin/documents",
    icon: FileUp
  },
  {
    title: "员工智能问答",
    body: "基于 RAG 知识库回答，并保留引用来源。",
    href: "/chat",
    icon: MessageSquareText
  },
  {
    title: "PPT 语音讲解",
    body: "上传 PPTX，生成逐页讲稿和语音播放。",
    href: "/admin/training",
    icon: FileAudio
  },
  {
    title: "培训播放",
    body: "查看已生成课程，按页播放讲解语音。",
    href: "/training",
    icon: BookOpen
  }
];

export default async function HomePage() {
  const user = await getCurrentUserOrNull();

  if (user?.role !== "admin") {
    redirect("/chat");
  }

  const dashboard = await getDashboardStats();

  const stats = [
    {
      label: "知识库",
      value: dashboard.totals.knowledgeBases,
      detail: `${dashboard.totals.documents} 份资料`,
      icon: Database
    },
    {
      label: "可用资料",
      value: dashboard.totals.readyDocuments,
      detail: `就绪率 ${dashboard.rates.documentReadyRate}%`,
      icon: FileCheck2
    },
    {
      label: "对话消息",
      value: dashboard.totals.messages,
      detail: `${dashboard.totals.conversations} 个会话`,
      icon: MessageSquareText
    },
    {
      label: "反馈满意度",
      value: `${dashboard.rates.satisfactionRate}%`,
      detail: `${dashboard.totals.likes} 赞 / ${dashboard.totals.dislikes} 踩`,
      icon: ThumbsUp
    }
  ];
  const commandSignals = [
    { label: "RAG 检索", value: `${dashboard.totals.readyDocuments} 份资料可用`, icon: Activity },
    { label: "问答链路", value: `${dashboard.totals.conversations} 个会话`, icon: Cpu },
    { label: "试运行质量", value: `${dashboard.rates.satisfactionRate}% 满意度`, icon: Gauge }
  ];

  return (
    <Shell>
      <section className="relative overflow-hidden rounded-lg border border-line bg-white p-5 text-ink shadow-panel">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(16,32,51,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(16,32,51,0.035)_1px,transparent_1px),linear-gradient(135deg,rgba(0,166,214,0.12),transparent_440px)] bg-[length:34px_34px,34px_34px,auto]" />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan to-transparent" />
        <div className="relative flex flex-col gap-7 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan/20 bg-cyan/10 px-3 py-1 text-xs font-semibold text-cyan">
              <Radar size={14} />
              AI KNOWLEDGE COMMAND
            </div>
            <h1 className="mt-4 text-3xl font-semibold leading-tight tracking-normal text-ink sm:text-4xl">
              西安天瑞汽车内饰件有限公司智能客服中控台
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
              统一监测知识库、资料处理、员工问答、反馈整改和培训讲解的运行状态，让制度和现场经验以可追踪、可验证的方式流动。
            </p>
          </div>
          <Link
            href="/chat"
            className="ui-button-primary h-11 w-fit"
          >
            开始对话
            <ArrowRight size={18} />
          </Link>
        </div>
        <div className="relative mt-6 grid gap-3 md:grid-cols-3">
          {commandSignals.map((item) => {
            const Icon = item.icon;
            return (
            <div key={item.label} className="rounded-lg border border-line bg-white/90 p-3 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-medium text-muted">{item.label}</p>
                <Icon className="text-brand" size={16} />
              </div>
              <p className="mt-2 text-sm font-semibold text-ink">{item.value}</p>
            </div>
            );
          })}
        </div>
      </section>

      <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="ui-card p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="ui-label">{stat.label}</p>
                  <p className="mt-2 text-3xl font-semibold text-ink">{stat.value}</p>
                </div>
                <span className="grid size-11 place-items-center rounded-lg bg-cyan/10 text-brand ring-1 ring-cyan/20">
                  <Icon size={20} />
                </span>
              </div>
              <div className="mt-4 h-1 rounded-full bg-slate-100">
                <div className="h-full w-2/3 rounded-full bg-cyan" />
              </div>
              <p className="mt-3 text-sm font-medium text-slate-500">{stat.detail}</p>
            </div>
          );
        })}
      </section>

      <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {actions.map((card) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.title}
              href={card.href}
              className="ui-card group p-5 transition hover:-translate-y-0.5 hover:border-cyan hover:shadow-glow"
            >
              <span className="grid size-11 place-items-center rounded-lg bg-slate-100 text-brand ring-1 ring-line transition group-hover:bg-cyan/10 group-hover:text-cyan">
                <Icon size={20} />
              </span>
              <h2 className="mt-4 text-base font-semibold text-ink">{card.title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{card.body}</p>
            </Link>
          );
        })}
      </section>

      <section className="mt-6 grid gap-5 xl:grid-cols-2">
        <RecentDocuments items={dashboard.recent.documents} />
        <RecentTraining items={dashboard.recent.trainingJobs} />
        <RecentConversations items={dashboard.recent.conversations} />
        <RecentFeedback items={dashboard.recent.feedback} />
      </section>
    </Shell>
  );
}

function RecentDocuments({
  items
}: {
  items: Array<{ id: string; title: string; status: string; created_at: string }>;
}) {
  return (
    <Panel title="最近资料">
      {items.length > 0 ? (
        items.map((item) => (
          <div key={item.id} className="flex items-center justify-between gap-3 border-b border-slate-100 py-3 last:border-b-0">
            <div>
              <p className="text-sm font-medium text-ink">{item.title}</p>
              <p className="mt-1 text-xs text-slate-500">{formatDate(item.created_at)}</p>
            </div>
            <StatusPill status={item.status} />
          </div>
        ))
      ) : (
        <EmptyText text="暂无资料。" />
      )}
    </Panel>
  );
}

function RecentTraining({
  items
}: {
  items: Array<{ id: string; title: string; status: string; created_at: string }>;
}) {
  return (
    <Panel title="最近培训">
      {items.length > 0 ? (
        items.map((item) => (
          <Link
            key={item.id}
            href={`/training/${item.id}`}
            className="flex items-center justify-between gap-3 border-b border-slate-100 py-3 last:border-b-0 hover:bg-slate-50"
          >
            <div>
              <p className="text-sm font-medium text-ink">{item.title}</p>
              <p className="mt-1 text-xs text-slate-500">{formatDate(item.created_at)}</p>
            </div>
            <StatusPill status={item.status} />
          </Link>
        ))
      ) : (
        <EmptyText text="暂无培训任务。" />
      )}
    </Panel>
  );
}

function RecentConversations({
  items
}: {
  items: Array<{ id: string; title: string; updated_at: string }>;
}) {
  return (
    <Panel title="最近会话">
      {items.length > 0 ? (
        items.map((item) => (
          <div key={item.id} className="border-b border-slate-100 py-3 last:border-b-0">
            <p className="text-sm font-medium text-ink">{item.title}</p>
            <p className="mt-1 text-xs text-slate-500">{formatDate(item.updated_at)}</p>
          </div>
        ))
      ) : (
        <EmptyText text="暂无会话。" />
      )}
    </Panel>
  );
}

function RecentFeedback({
  items
}: {
  items: Array<{ id: string; rating: string; comment: string | null; created_at: string }>;
}) {
  return (
    <Panel title="最近反馈">
      {items.length > 0 ? (
        items.map((item) => (
          <div key={item.id} className="border-b border-slate-100 py-3 last:border-b-0">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-ink">{item.rating === "like" ? "有帮助" : "需改进"}</p>
              <p className="text-xs text-slate-500">{formatDate(item.created_at)}</p>
            </div>
            {item.comment && <p className="mt-2 text-sm leading-6 text-slate-600">{item.comment}</p>}
          </div>
        ))
      ) : (
        <EmptyText text="暂无反馈。" />
      )}
    </Panel>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="ui-card p-5">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function EmptyText({ text }: { text: string }) {
  return <p className="py-8 text-center text-sm text-slate-500">{text}</p>;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("zh-CN");
}
