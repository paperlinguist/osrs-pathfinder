import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Manage Quests · Quest Pathfinder",
  description:
    "Bulk-set your OSRS quest completions (or import them from RuneLite) — the planner trims every path accordingly.",
};

export default function CompletionsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
