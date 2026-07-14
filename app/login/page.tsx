import { Suspense } from "react";
import { Activity } from "lucide-react";
import { AuthPanel } from "@/components/auth-panel";

export default function LoginPage() {
  return (
    <main className="grid min-h-dvh bg-white text-ink lg:grid-cols-[minmax(0,1fr)_480px]">
      <section className="relative hidden min-h-dvh overflow-hidden border-r border-line bg-[linear-gradient(rgba(16,32,51,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(16,32,51,0.035)_1px,transparent_1px),linear-gradient(135deg,rgba(11,99,246,0.09),transparent_420px),linear-gradient(180deg,#ffffff,#f6faff)] bg-[length:36px_36px,36px_36px,auto,auto] px-10 py-9 lg:block">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan to-transparent" />
        <div className="relative flex h-full flex-col justify-between">
          <div>
            <div className="inline-flex items-center gap-3 rounded-lg border border-line bg-white/90 px-4 py-3 shadow-panel">
              <span className="grid size-11 place-items-center rounded-lg bg-brand text-white shadow-glow">AI</span>
              <div>
                <p className="text-sm font-semibold text-ink">西安天瑞汽车内饰件有限公司</p>
                <p className="text-xs font-medium text-brand">AI Knowledge Command Platform</p>
              </div>
            </div>

            <div className="mt-16 max-w-3xl">
              <p className="text-sm font-semibold text-brand">INTELLIGENT MANUFACTURING KNOWLEDGE OS</p>
              <h1 className="mt-4 text-5xl font-semibold leading-tight tracking-normal text-ink">
                让生产现场的制度、培训和经验进入可查询的智能中枢。
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-8 text-slate-600">
                汇聚知识库、问答验证、资料治理、培训讲解和试运行验收，用一个中控台管理员工获取答案的全过程。
              </p>
            </div>

          </div>

          <div className="max-w-3xl rounded-lg border border-line bg-white/90 p-5 shadow-panel">
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-lg bg-mint/10 text-emerald-700 ring-1 ring-mint/25">
                <Activity size={19} />
              </span>
              <div>
                <p className="text-sm font-semibold text-ink">运行状态正常</p>
                <p className="mt-1 text-xs text-slate-500">问答、资料、培训与验收模块已接入同一工作流。</p>
              </div>
            </div>
          </div>
        </div>
      </section>
      <section className="grid min-h-dvh place-items-center bg-[linear-gradient(180deg,#ffffff,#f6faff)] px-4 py-8 text-ink">
        <Suspense>
          <AuthPanel />
        </Suspense>
      </section>
    </main>
  );
}
