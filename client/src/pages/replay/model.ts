export type ReplayRole = "tank" | "healer" | "melee" | "ranged";

export type TimelineTrackKind =
  | "damage"
  | "healing"
  | "buff"
  | "debuff"
  | "raid-cooldown"
  | "boss";

export interface ReplayMember {
  id: string;
  name: string;
  specialization: string;
  role: ReplayRole;
  avatar: string;
  status: "ready" | "processing";
}

export interface TimelineEvent {
  id: string;
  time: number;
  label: string;
  shortLabel: string;
}

export interface TimelineTrack {
  kind: TimelineTrackKind;
  label: string;
  events: TimelineEvent[];
}

export interface ReplayFixture {
  id: string;
  instance: string;
  boss: string;
  difficulty: string;
  pullLabel: string;
  date: string;
  durationSeconds: number;
  initialTime: number;
  members: ReplayMember[];
  tracks: TimelineTrack[];
}
