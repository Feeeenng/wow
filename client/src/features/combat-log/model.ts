export interface CombatLogStatus {
  directory: string | null;
  currentFile: string | null;
  monitoring: boolean;
  discoveryState: "notFound" | "found" | "multiple";
  candidates: string[];
  error: string | null;
}

export const emptyCombatLogStatus: CombatLogStatus = {
  directory: null,
  currentFile: null,
  monitoring: true,
  discoveryState: "notFound",
  candidates: [],
  error: null,
};
