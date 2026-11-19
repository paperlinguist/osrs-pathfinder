import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Skill Explorer · Quest Pathfinder",
  description:
    "Pick a skill and see every quest that rewards XP in it (and whether you can do it now), what your next levels unlock — quests and diaries — plus rough training methods.",
};

export default function SkillsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
