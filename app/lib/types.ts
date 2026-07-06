export interface User {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  reputation: number;
  created_at: string;
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
  opening_hours: string | null;
  website: string | null;
  description: string | null;
  source: "user" | "osm";
  status: CourtStatus;
  created_at: string;
  active_count: number;
  net_votes: number;
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
