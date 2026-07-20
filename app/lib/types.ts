export type Position = "guard" | "wing" | "forward" | "center";

export interface User {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  reputation: number;
  created_at: string;
  is_admin: boolean;
  is_private: boolean;
  jersey_number: number | null;
  position: Position | null;
  height_cm: number | null;
  style_tags: string[];
  skill_level: string | null;
  availability: string[];
  // Optional: only the /me and PATCH /me responses carry it (login/register
  // payloads predate phase 16 and are left untouched).
  window_alerts_enabled?: boolean;
}

// /me/stats (Task 6): the player card's stats, badges, and home courts.
export interface MeStatsBadge {
  id: string;
  earned: boolean;
}

export interface MeStatsHomeCourt {
  court_id: string;
  name: string;
  check_ins: number;
  live_count: number;
}

export interface MeStats {
  games: number;
  courts: number;
  week_streak: number;
  badges: MeStatsBadge[];
  home_courts: MeStatsHomeCourt[];
}

export interface LatestReport {
  player_count: number | null;
  run_quality: RunQuality | null;
  created_at: string;
}

export type RunQuality = "empty" | "casual" | "good_run" | "packed";
export type CourtStatus = "pending" | "verified" | "rejected";
export type Surface = "asphalt" | "concrete" | "hardwood" | "rubber" | "other";

export interface CourtSummary {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address: string | null;
  hoop_count: number | null;
  indoor: boolean;
  surface: Surface | null;
  lighting: boolean | null;
  is_public: boolean;
  drinking_water: boolean | null;
  toilets: boolean | null;
  parking: boolean | null;
  fenced: boolean | null;
  covered: boolean | null;
  fee: boolean | null;
  access: "public" | "private" | "customers" | null;
  source: "user" | "osm";
  status: CourtStatus;
  active_count: number;
  distance_m?: number;
  latest_report: LatestReport | null;
}

export interface CourtDetail {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address: string | null;
  hoop_count: number | null;
  indoor: boolean;
  surface: Surface | null;
  lighting: boolean | null;
  is_public: boolean;
  access: "public" | "private" | "customers" | null;
  fee: boolean | null;
  covered: boolean | null;
  drinking_water: boolean | null;
  toilets: boolean | null;
  parking: boolean | null;
  fenced: boolean | null;
  rim_type: "single" | "double" | null;
  net_type: "chain" | "nylon" | "none" | null;
  opening_hours: string | null;
  website: string | null;
  description: string | null;
  source: "user" | "osm";
  status: CourtStatus;
  created_at: string;
  active_count: number;
  net_votes: number;
}

// Per-fact confirmation freshness from GET /courts/{id}/facts.
export interface CourtFact {
  fact: string;
  confirmations: number;
  last_confirmed_at: string;
  majority_value: string;
}

export interface ExternalPhoto {
  id: string;
  source: "commons";
  image_url: string;
  page_url: string;
  attribution: string | null;
  created_at: string;
}

export interface CheckIn {
  id: string;
  court_id: string;
  court_name?: string;
  source: "manual" | "geofence_prompt" | "geofence_auto";
  created_at: string;
  expires_at: string;
  party_size?: number;
  has_ball?: boolean;
}

export interface CrowdReport {
  id: string;
  user_id: string;
  display_name?: string;
  player_count: number | null;
  run_quality: RunQuality | null;
  note: string | null;
  created_at: string;
}

export interface CourtActivity {
  active_count: number;
  check_ins: Array<{
    id: string;
    user_id: string;
    display_name: string;
    source: string;
    created_at: string;
    expires_at: string;
    party_size: number;
    has_ball: boolean;
  }>;
  reports: CrowdReport[];
}

export interface CourtPhoto {
  id: string;
  user_id: string;
  storage_key: string;
  created_at: string;
}

export interface CheckInHistoryItem {
  id: string;
  court_id: string;
  court_name: string;
  source: string;
  created_at: string;
  checked_out_at: string | null;
  expires_at: string;
}

export interface CourtSession {
  id: string;
  court_id: string;
  created_by: string;
  created_by_name: string;
  starts_at: string;
  note: string | null;
  created_at: string;
  going_count: number;
  my_rsvp: "" | "going" | "out";
}

export interface FeedRun extends CourtSession {
  court_name: string;
}

// Compact view-model for a planned run, shown by the RunRow building block
// (court detail + Task 14 desktop panel). `capacity` is optional — when
// absent the row shows "N in" without a cap.
export interface SessionSummary {
  id: string;
  starts_at: string;
  going_count: number;
  capacity?: number | null;
  host_name: string;
}

export interface FriendPresence {
  id: string;
  display_name: string;
  avatar_url: string | null;
  court_id: string;
  court_name: string;
  since: string;
}

export interface CourtMessage {
  id: string;
  court_id: string;
  user_id: string;
  display_name: string;
  body: string;
  created_at: string;
}

export interface NearbyDuplicate {
  id: string;
  name: string;
  lat: number;
  lng: number;
  status: CourtStatus;
  distance_m: number;
}

export type FlagEntityType =
  | "court"
  | "photo"
  | "report"
  | "message"
  | "session"
  | "user"
  | "feedback";

export interface BlockedUser {
  blocked_id: string;
  display_name: string;
  created_at: string;
}
export type PhotoStatus = "visible" | "flagged" | "removed";

export interface Flag {
  id: string;
  user_id: string;
  reporter: string;
  entity_type: FlagEntityType;
  entity_id: string;
  reason: string;
  created_at: string;
}

export interface AdminUser {
  id: string;
  email: string;
  display_name: string;
  reputation: number;
  is_admin: boolean;
  created_at: string;
}

export interface AdminAction {
  id: string;
  action: "promote" | "demote";
  created_at: string;
  actor_id: string;
  actor_name: string;
  target_id: string;
  target_name: string;
}

export interface Profile {
  id: string;
  display_name: string;
  avatar_url: string | null;
  reputation: number;
  member_since: string;
  check_in_count: number;
  courts_added_count: number;
  follower_count: number;
  following_count: number;
  streak_days: number;
  is_following: boolean;
  follows_you: boolean;
  is_private: boolean;
  has_requested: boolean;
}

export interface FollowUser {
  id: string;
  display_name: string;
  avatar_url: string | null;
}

export interface FollowRequest {
  id: string;
  display_name: string;
  avatar_url: string | null;
  created_at: string;
}
