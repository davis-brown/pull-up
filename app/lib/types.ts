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
  xp: number;
  // Only the /me and PATCH /me responses carry it.
  window_alerts_enabled?: boolean;
  play_nudges_enabled?: boolean;
}

// /me/stats: the player card's stats, badges, and home courts.
export interface MeStatsBadge {
  id: string;
  earned: boolean;
  // When the badge was first observed. Null for unearned badges, and for
  // earned ones recorded before earn dates were tracked.
  earned_at: string | null;
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
  // xp_for_next_level is 0 at the level cap.
  level: number;
  tier: string;
  xp: number;
  xp_into_level: number;
  xp_for_next_level: number;
  // W-L across confirmed games only.
  wins: number;
  losses: number;
  // Recent XP by award kind (last 30 days, highest first), and a level
  // crossing not yet shown (null when there is nothing to celebrate).
  xp_breakdown: MeStatsXPEntry[];
  level_up_pending: number | null;
  // Badge ids earned since the app last showed them. Empty, never null.
  new_badges: string[];
  // level/tier above stay LIFETIME and never reset; this is what does.
  season: SeasonStats;
}

// The window a season-scoped payload covers. Shared by /me/stats and both
// leaderboards.
export interface SeasonInfo {
  key: string;
  label: string;
  started_at: string;
  ends_at: string;
}

export interface SeasonStats extends SeasonInfo {
  xp: number;
  tier: string;
}

// One award kind's contribution to recent XP. kind is the raw ledger kind
// (see xpKindLabel in lib/levels.ts for display).
export interface MeStatsXPEntry {
  kind: string;
  points: number;
  events: number;
}

// A player in a recorded game. team is 0 or 1.
export interface GamePlayer {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  team: number;
}

// A confirmed game from GET /courts/{id}/games.
export interface CourtGame {
  id: string;
  court_id: string;
  recorded_by: string;
  winning_team: number;
  score_win: number | null;
  score_lose: number | null;
  played_at: string;
  players: GamePlayer[];
}

// A game awaiting the viewer's confirmation, from GET /me/games/pending.
export interface PendingGame {
  id: string;
  court_id: string;
  court_name: string;
  recorded_by: string;
  recorded_by_name: string;
  winning_team: number;
  score_win: number | null;
  score_lose: number | null;
  played_at: string;
  my_team: number;
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
  fee_amount_cents: number | null;
  /** ISO 4217; pairs with fee_amount_cents, which is never set without it. */
  fee_currency: string | null;
  fee_note: string | null;
  source: "user" | "osm";
  status: CourtStatus;
  active_count: number;
  distance_m?: number;
  latest_report: LatestReport | null;
  /** Earliest non-canceled run in the next 24h — drives the pin's run tick. */
  next_run_at: string | null;
}

export interface CourtSearchHit {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address: string | null;
  distance_m?: number;
}

export interface AreaSearchHit {
  name: string;
  lat: number;
  lng: number;
  /** [west, south, east, north] */
  bbox: [number, number, number, number];
  type: string;
}

export interface DiscoverySearchResults {
  courts: CourtSearchHit[];
  areas: AreaSearchHit[];
  area_search_unavailable: boolean;
}

// A seeker row from GET /courts/{id}/run-intents; grouped into buckets by
// lib/run-intents.ts.
export interface RunIntentSeeker {
  run_date: string;
  window_key: string;
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  skill_level: string | null;
}

// A nearby upcoming run from GET /sessions/nearby.
export interface NearbyRun {
  id: string;
  court_id: string;
  court_name: string;
  distance_m: number;
  created_by: string;
  created_by_name: string;
  starts_at: string;
  note: string | null;
  going_count: number;
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
  fee_amount_cents: number | null;
  /** ISO 4217; pairs with fee_amount_cents, which is never set without it. */
  fee_currency: string | null;
  fee_note: string | null;
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
  source: "commons" | "mapillary";
  source_id: string;
  // Upstream provider URL. Never rendered directly — Mapillary's expires;
  // build the cached URL with externalPhotoURL instead.
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

// Compact view-model for a planned run, shown by RunRow. `capacity` is
// optional; when absent the row shows "N in" without a cap.
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
  // Null when a private account hides its activity from this viewer.
  level: number | null;
  tier: string | null;
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

// Scoped leaderboards. score is check-ins on a court board and XP on a
// circle board; metric says which.
export interface LeaderboardEntry {
  rank: number;
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  score: number;
  metric: string;
}

export interface Leaderboard {
  metric: string;
  season: SeasonInfo;
  entries: LeaderboardEntry[];
  // Null when the viewer does not appear in the returned slice.
  viewer_rank: number | null;
}
