"use client";

import Script from "next/script";
import { ArrowUpRight, CheckCircle2, Loader2, MonitorUp, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type JsSdkConfig = {
  appId: string;
  nonceStr: string;
  timestamp: number;
  signature: string;
};

type WecomSdk = {
  config(input: JsSdkConfig & { beta: boolean; debug: boolean; jsApiList: string[] }): void;
  error(callback: (error: { errMsg?: string }) => void): void;
  invoke(
    name: string,
    params: { url: string },
    callback: (result: { err_msg?: string; errMsg?: string }) => void
  ): void;
  ready(callback: () => void): void;
};

declare global {
  interface Window {
    wx?: WecomSdk;
  }
}

export function WecomBrowserHandoff({
  externalLoginUrl,
  fallbackUrl,
  sdkConfig
}: {
  externalLoginUrl: string;
  fallbackUrl: string;
  sdkConfig: JsSdkConfig;
}) {
  const [scriptReady, setScriptReady] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const [status, setStatus] = useState<"preparing" | "opening" | "opened" | "error">("preparing");
  const [message, setMessage] = useState("正在连接系统浏览器...");
  const configuredRef = useRef(false);
  const openedRef = useRef(false);

  const openDefaultBrowser = useCallback(() => {
    const wx = window.wx;
    if (!wx || !sdkReady) {
      setStatus("error");
      setMessage("企业微信浏览器组件尚未就绪，请稍后重试。");
      return;
    }

    setStatus("opening");
    setMessage("正在打开系统默认浏览器...");
    wx.invoke("openDefaultBrowser", { url: externalLoginUrl }, (result) => {
      const resultMessage = result.err_msg ?? result.errMsg ?? "";
      if (resultMessage === "openDefaultBrowser:ok") {
        setStatus("opened");
        setMessage("已在系统浏览器中打开并登录。");
        return;
      }
      setStatus("error");
      setMessage("未能自动打开系统浏览器，请点击下方按钮重试。");
    });
  }, [externalLoginUrl, sdkReady]);

  useEffect(() => {
    const wx = window.wx;
    if (!scriptReady || !wx || configuredRef.current) return;
    configuredRef.current = true;
    wx.config({
      ...sdkConfig,
      beta: true,
      debug: false,
      jsApiList: ["openDefaultBrowser"]
    });
    wx.ready(() => setSdkReady(true));
    wx.error(() => {
      setStatus("error");
      setMessage("企业微信安全校验失败，请关闭页面后重新进入工作台。");
    });
  }, [scriptReady, sdkConfig]);

  useEffect(() => {
    if (!sdkReady || openedRef.current) return;
    openedRef.current = true;
    openDefaultBrowser();
  }, [openDefaultBrowser, sdkReady]);

  const StatusIcon = status === "opened" ? CheckCircle2 : status === "error" ? RefreshCw : Loader2;

  return (
    <>
      <Script
        src="https://res.wx.qq.com/open/js/jweixin-1.2.0.js"
        strategy="afterInteractive"
        onLoad={() => setScriptReady(true)}
        onError={() => {
          setStatus("error");
          setMessage("企业微信浏览器组件加载失败，请检查网络后重试。");
        }}
      />
      <main className="grid min-h-dvh place-items-center bg-slate-50 px-4 py-6 text-ink">
        <section className="w-full max-w-md rounded-lg border border-line bg-white p-6 shadow-panel" aria-live="polite">
          <div className="flex items-center gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-brand text-white">
              <MonitorUp size={21} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">天瑞内饰智能客服</p>
              <p className="mt-1 text-xs text-slate-500">企业微信安全登录</p>
            </div>
          </div>

          <div className="mt-6 flex items-start gap-3 rounded-lg border border-line bg-slate-50 px-4 py-4">
            <StatusIcon
              size={20}
              className={status === "opened" ? "mt-0.5 shrink-0 text-emerald-600" : status === "error" ? "mt-0.5 shrink-0 text-amber-600" : "mt-0.5 shrink-0 animate-spin text-brand"}
            />
            <div>
              <h1 className="text-base font-semibold text-ink">
                {status === "opened" ? "浏览器已打开" : status === "error" ? "需要重新尝试" : "正在为你打开"}
              </h1>
              <p className="mt-1 text-sm leading-6 text-slate-600">{message}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={openDefaultBrowser}
            disabled={!sdkReady || status === "opening"}
            className="ui-button-primary mt-5 h-11 w-full justify-center disabled:cursor-not-allowed disabled:opacity-50"
          >
            {status === "opening" ? <Loader2 size={17} className="animate-spin" /> : <ArrowUpRight size={17} />}
            {status === "opened" ? "再次打开浏览器" : "在系统浏览器中打开"}
          </button>

          <a href={fallbackUrl} className="ui-button-secondary mt-3 h-11 w-full justify-center">
            继续在企业微信中使用
          </a>
        </section>
      </main>
    </>
  );
}
