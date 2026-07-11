import type { Metadata } from "next";
import { AppFeedbackProvider } from "@/components/ui-feedback";
import "./globals.css";

export const metadata: Metadata = {
  title: "西安天瑞汽车内饰件有限公司智能客服",
  description: "面向西安天瑞汽车内饰件有限公司员工的知识问答与语音讲解系统",
  icons: {
    icon: "/favicon.svg"
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        <AppFeedbackProvider>{children}</AppFeedbackProvider>
      </body>
    </html>
  );
}
