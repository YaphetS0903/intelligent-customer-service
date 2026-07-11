const statusText: Record<string, string> = {
  ready: "可用",
  processing: "处理中",
  uploading: "上传中",
  generating: "生成中",
  failed: "失败",
  draft: "草稿"
};

const statusClass: Record<string, string> = {
  ready: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  processing: "bg-cyan/10 text-brand ring-cyan/30",
  uploading: "bg-amber-50 text-amber-700 ring-amber-200",
  generating: "bg-cyan/10 text-brand ring-cyan/30",
  failed: "bg-red-50 text-red-700 ring-red-200",
  draft: "bg-slate-100 text-slate-700 ring-line"
};

export function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${
        statusClass[status] ?? statusClass.draft
      }`}
    >
      {statusText[status] ?? status}
    </span>
  );
}
