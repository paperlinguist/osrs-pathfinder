import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: "Quest Pathfinder — OSRS Prerequisite Planner",
  description:
    "Pick any Old School RuneScape quest and get the optimal prerequisite chain: quest order, skill gaps, boost flags and quest-XP coverage, with character import via the hiscores.",
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased min-h-screen flex flex-col bg-stone-950 text-stone-100">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
