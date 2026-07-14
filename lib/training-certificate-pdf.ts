import { access } from "fs/promises";
import PDFDocument from "pdfkit";
import type { TrainingCertificate, TrainingJob, TrainingQuizAttempt, UserProfile } from "@/lib/types";

type CertificateFont = { path: string; face?: string };

const fontCandidates: CertificateFont[] = [
  ...(process.env.CERTIFICATE_FONT_PATH ? [{ path: process.env.CERTIFICATE_FONT_PATH, face: process.env.CERTIFICATE_FONT_FACE || undefined }] : []),
  { path: "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", face: "NotoSansCJKsc-Regular" },
  { path: "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc", face: "NotoSerifCJKsc-Regular" },
  { path: "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc", face: "WenQuanYiMicroHei" },
  { path: "/System/Library/Fonts/STHeiti Medium.ttc", face: "STHeitiSC-Medium" },
  { path: "/System/Library/Fonts/Hiragino Sans GB.ttc", face: "HiraginoSansGB-W3" }
];

export async function resolveCertificateFont() {
  for (const candidate of fontCandidates) {
    try {
      await access(candidate.path);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

export async function renderTrainingCertificatePdf(input: {
  certificate: TrainingCertificate;
  job: TrainingJob;
  user: UserProfile;
  attempt: TrainingQuizAttempt;
}) {
  const font = await resolveCertificateFont();
  if (!font) throw new Error("服务器缺少中文证书字体，请配置 CERTIFICATE_FONT_PATH");
  const document = new PDFDocument({ size: "A4", layout: "landscape", margin: 0, font: null as unknown as string, info: { Title: `${input.job.title} 完课证书`, Author: "企业智能培训平台" } });
  const chunks: Buffer[] = [];
  document.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  const completed = new Promise<Buffer>((resolve, reject) => {
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
  });
  if (font.face) document.font(font.path, font.face); else document.font(font.path);
  const width = document.page.width;
  const height = document.page.height;
  document.rect(0, 0, width, height).fill("#f8fafc");
  document.lineWidth(3).strokeColor("#0f766e").rect(28, 28, width - 56, height - 56).stroke();
  document.lineWidth(1).strokeColor("#99f6e4").rect(38, 38, width - 76, height - 76).stroke();
  document.fillColor("#0f766e").fontSize(17).text("TIANRUI LEARNING", 0, 72, { align: "center" });
  document.fillColor("#102033").fontSize(34).text("培训完课证书", 0, 112, { align: "center" });
  document.fillColor("#64748b").fontSize(12).text("CERTIFICATE OF COMPLETION", 0, 156, { align: "center" });
  document.fillColor("#334155").fontSize(15).text("兹证明", 0, 205, { align: "center" });
  document.fillColor("#0f172a").fontSize(28).text(input.user.name, 0, 235, { align: "center" });
  document.moveTo(width / 2 - 115, 274).lineTo(width / 2 + 115, 274).strokeColor("#94a3b8").stroke();
  document.fillColor("#475569").fontSize(15).text("已完成企业培训课程", 0, 300, { align: "center" });
  document.fillColor("#0f172a").fontSize(24).text(input.job.title, 90, 332, { align: "center", width: width - 180 });
  document.fillColor("#475569").fontSize(13).text(`讲师：${input.job.instructor}    考试成绩：${input.attempt.score} 分`, 0, 382, { align: "center" });

  const issuedDate = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Shanghai" }).format(new Date(input.certificate.issued_at));
  document.fillColor("#64748b").fontSize(11).text(`签发日期：${issuedDate}`, 70, height - 105);
  document.text(`证书编号：${input.certificate.certificate_no}`, width - 335, height - 105, { width: 265, align: "right" });
  document.fillColor("#0f766e").fontSize(13).text("企业智能培训平台", width - 310, height - 75, { width: 240, align: "right" });
  document.end();
  return completed;
}
