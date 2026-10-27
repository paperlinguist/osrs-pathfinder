import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Quest Completions · Quest Pathfinder",
  description:
    "Bulk-set your OSRS quest completions and quest points — the planner trims every path accordingly.",
};

export default function CompletionsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
