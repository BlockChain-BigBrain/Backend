import { ContributionRole } from "@prisma/client";

export interface ContributionInput {
  userId: number;
  role: ContributionRole;
  percentage: number;
}

export interface CreateTrackInput {
  title: string;
  prompt?: string;
  workLog?: string;
  contributors?: ContributionInput[];
}