"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, RefreshCw, X } from "lucide-react";

type ToastTone = "success" | "error" | "warning" | "info";

type ToastInput = {
  tone?: ToastTone;
  title: string;
  description?: string;
  durationMs?: number;
};

export type ActionConfirmTone = "danger" | "warning" | "info";

export type ActionConfirmRequest = {
  title: string;
  description: string;
  details?: string[];
  confirmLabel: string;
  cancelLabel?: string;
  tone?: ActionConfirmTone;
};

type ToastRecord = Required<Pick<ToastInput, "tone" | "title" | "durationMs">> &
  Pick<ToastInput, "description"> & {
    id: string;
  };

type ToastContextValue = {
  pushToast: (toast: ToastInput) => string;
  dismissToast: (id: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const toastToneClass: Record<ToastTone, string> = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  error: "border-red-200 bg-red-50 text-red-900",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  info: "border-blue-200 bg-blue-50 text-blue-900"
};

const toastIconClass: Record<ToastTone, string> = {
  success: "text-emerald-700",
  error: "text-red-700",
  warning: "text-amber-700",
  info: "text-blue-700"
};

export function AppFeedbackProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const pushToast = useCallback((toast: ToastInput) => {
    const id = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const record: ToastRecord = {
      id,
      tone: toast.tone ?? "info",
      title: toast.title,
      description: toast.description,
      durationMs: toast.durationMs ?? 4200
    };

    setToasts((current) => [record, ...current].slice(0, 4));
    return id;
  }, []);

  const value = useMemo(() => ({ pushToast, dismissToast }), [dismissToast, pushToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);

  if (!context) {
    return {
      pushToast: () => "",
      dismissToast: () => undefined
    };
  }

  return context;
}

function ToastViewport({
  toasts,
  onDismiss
}: {
  toasts: ToastRecord[];
  onDismiss: (id: string) => void;
}) {
  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed inset-x-3 top-3 z-[1000] flex flex-col items-stretch gap-2 sm:left-auto sm:right-4 sm:w-[390px]"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={() => onDismiss(toast.id)} />
      ))}
    </div>
  );
}

function ToastItem({
  toast,
  onDismiss
}: {
  toast: ToastRecord;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (toast.durationMs <= 0) {
      return;
    }

    const timer = window.setTimeout(onDismiss, toast.durationMs);
    return () => window.clearTimeout(timer);
  }, [onDismiss, toast.durationMs]);

  const Icon = toast.tone === "success"
    ? CheckCircle2
    : toast.tone === "error"
      ? AlertTriangle
      : toast.tone === "warning"
        ? AlertTriangle
        : Info;

  return (
    <div
      className={`pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3 shadow-panel backdrop-blur transition ${toastToneClass[toast.tone]}`}
      role={toast.tone === "error" ? "alert" : "status"}
    >
      <Icon size={18} className={`mt-0.5 shrink-0 ${toastIconClass[toast.tone]}`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-5">{toast.title}</p>
        {toast.description && (
          <p className="mt-1 break-words text-sm leading-5 opacity-80">{toast.description}</p>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="关闭提示"
        className="grid size-8 shrink-0 place-items-center rounded-lg text-current opacity-70 transition hover:bg-white/60 hover:opacity-100"
      >
        <X size={15} />
      </button>
    </div>
  );
}

export function PanelSkeleton({
  rows = 3,
  className = ""
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div className={`ui-card p-4 ${className}`} aria-label="正在加载">
      <div className="animate-pulse space-y-3">
        <div className="h-4 w-32 rounded-full bg-slate-200" />
        {Array.from({ length: rows }).map((_, index) => (
          <div key={index} className="grid gap-3 md:grid-cols-[1fr_120px]">
            <div className="h-10 rounded-lg bg-slate-100" />
            <div className="h-10 rounded-lg bg-slate-100" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ErrorRetry({
  title = "加载失败",
  message,
  actionLabel = "重试",
  retrying = false,
  onRetry
}: {
  title?: string;
  message: string;
  actionLabel?: string;
  retrying?: boolean;
  onRetry?: () => void;
}) {
  return (
    <section className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-700" />
          <div className="min-w-0">
            <h2 className="font-semibold">{title}</h2>
            <p className="mt-1 break-words leading-6">{message}</p>
          </div>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-red-700 px-4 text-sm font-semibold text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:bg-red-300"
          >
            {retrying ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />}
            {actionLabel}
          </button>
        )}
      </div>
    </section>
  );
}

export function ActionConfirmDialog({
  request,
  onCancel,
  onConfirm
}: {
  request: ActionConfirmRequest | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!request) {
    return null;
  }

  const tone = request.tone ?? "warning";
  const toneClass = tone === "danger"
    ? "border-red-200 bg-red-50 text-red-800"
    : tone === "warning"
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : "border-blue-200 bg-blue-50 text-blue-800";
  const confirmClass = tone === "danger"
    ? "bg-red-700 text-white hover:bg-red-800"
    : tone === "warning"
      ? "bg-amber-700 text-white hover:bg-amber-800"
      : "bg-brand text-white hover:bg-brand-strong";
  const Icon = tone === "info" ? Info : tone === "danger" ? AlertTriangle : AlertTriangle;

  return (
    <div className="fixed inset-0 z-[950] flex items-end justify-center bg-slate-950/45 px-3 py-4 backdrop-blur-sm sm:items-center">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="action-confirm-title"
        className="w-full max-w-lg rounded-lg border border-line bg-white p-4 text-ink shadow-panel"
      >
        <div className="flex items-start gap-3">
          <span className={`grid size-10 shrink-0 place-items-center rounded-lg border ${toneClass}`}>
            <Icon size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <h2 id="action-confirm-title" className="text-base font-semibold text-ink">
                {request.title}
              </h2>
              <button
                type="button"
                onClick={onCancel}
                aria-label="关闭确认框"
                className="grid size-9 shrink-0 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-ink"
              >
                <X size={16} />
              </button>
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-600">{request.description}</p>
            {request.details && request.details.length > 0 && (
              <div className="mt-3 space-y-1.5 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600 ring-1 ring-line">
                {request.details.map((detail) => (
                  <p key={detail}>{detail}</p>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="mt-4 grid gap-2 sm:flex sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="ui-button-secondary h-11 justify-center px-4 text-sm"
          >
            {request.cancelLabel ?? "取消"}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`inline-flex h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition ${confirmClass}`}
          >
            {request.confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
