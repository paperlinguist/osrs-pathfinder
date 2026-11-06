import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Boss Gear Planner · Quest Pathfinder",
  description:
    "Check whether your account is ready for a boss and what gear to wear — readiness verdicts, budget-tier loadouts and buy lists from your imported character, bank and equipment.",
};

export default function BossesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
