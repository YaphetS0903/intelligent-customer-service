"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Building2, Loader2, LogIn, UserPlus } from "lucide-react";

type Mode = "login" | "signup";

export function AuthPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [department, setDepartment] = useState("");
  const [loading, setLoading] = useState(false);
  const [ssoEnabled, setSsoEnabled] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const error = searchParams.get("error");
    if (error) {
      setMessage(decodeURIComponent(error));
    }

    void fetch("/api/auth/sso/status", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => setSsoEnabled(Boolean(data.enabled)))
      .catch(() => setSsoEnabled(false));
  }, [searchParams]);

  async function submit() {
    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch(mode === "login" ? "/api/auth/login" : "/api/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(
          mode === "login"
            ? {
                email,
                password
              }
            : {
                email,
                password,
                name,
                department
              }
        )
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "认证失败，请稍后重试。");
      }

      await fetch("/api/auth/me");
      const next = searchParams.get("next") || "/";
      router.replace(next);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "认证失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }

  function startSsoLogin() {
    const next = searchParams.get("next") || "/";
    window.location.href = `/api/auth/sso/start?next=${encodeURIComponent(next)}`;
  }

  return (
    <div className="w-full max-w-md rounded-lg border border-line bg-panel p-6 shadow-panel">
      <div>
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="ui-page-kicker">{mode === "login" ? "SECURE ACCESS" : "NEW IDENTITY"}</p>
          <span className="rounded-full bg-mint/10 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-mint/20">
            ONLINE
          </span>
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-normal text-ink">
          {mode === "login" ? "登录天瑞内饰智能客服" : "注册员工账号"}
        </h1>
        <p className="mt-2 ui-muted">
          登录后可以使用员工问答；管理员账号可以创建知识库并上传资料。
        </p>
      </div>

      <div className="mt-6 space-y-4">
        {mode === "signup" && (
          <>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700">姓名</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="请输入姓名"
                className="ui-input h-11 w-full"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700">部门</span>
              <input
                value={department}
                onChange={(event) => setDepartment(event.target.value)}
                placeholder="例如：生产部"
                className="ui-input h-11 w-full"
              />
            </label>
          </>
        )}
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-slate-700">邮箱</span>
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            autoComplete="email"
            placeholder="name@company.com"
            className="ui-input h-11 w-full"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-slate-700">密码</span>
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            placeholder="请输入密码"
            className="ui-input h-11 w-full"
          />
        </label>
      </div>

      {message && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {message}
        </div>
      )}

      <button
        onClick={() => void submit()}
        disabled={loading || !email || !password}
        className="ui-button-primary mt-5 h-11 w-full"
      >
        {loading ? (
          <Loader2 className="animate-spin" size={17} />
        ) : mode === "login" ? (
          <LogIn size={17} />
        ) : (
          <UserPlus size={17} />
        )}
        {mode === "login" ? "登录" : "注册"}
      </button>

      {mode === "login" && (
        <button
          onClick={startSsoLogin}
          disabled={!ssoEnabled}
          className="ui-button-secondary mt-3 h-11 w-full"
        >
          <Building2 size={17} />
          企业统一登录
        </button>
      )}

      <button
        onClick={() => {
          setMode(mode === "login" ? "signup" : "login");
          setMessage(null);
        }}
        className="mt-4 w-full text-center text-sm font-medium text-brand hover:text-brand"
      >
        {mode === "login" ? "没有账号？注册一个" : "已有账号？返回登录"}
      </button>
    </div>
  );
}
