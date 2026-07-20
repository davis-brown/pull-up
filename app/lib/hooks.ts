import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  api,
  fetchWithTimeout,
  photoURLFromAPIBase,
  resolveApiURL,
  responseBlobWithTimeout,
  responseTextWithTimeout,
} from "./api";
import * as ImageManipulator from "expo-image-manipulator";
import { useAuth } from "./auth-context";
import { filtersToQuery, type CourtFilters } from "./court-filters";
import { forecastIdSet, type CourtForecast } from "./forecast";
import { safePathSegment } from "./routes";
import type {
  AdminAction,
  AdminUser,
  BlockedUser,
  CheckIn,
  CheckInHistoryItem,
  CourtActivity,
  CourtDetail,
  CourtFact,
  CourtMessage,
  CourtPhoto,
  CourtSession,
  CourtStatus,
  CourtSummary,
  CrowdReport,
  ExternalPhoto,
  FeedRun,
  Flag,
  FlagEntityType,
  FollowRequest,
  FollowUser,
  FriendPresence,
  MeStats,
  NearbyRun,
  PhotoStatus,
  Profile,
  RunIntentSeeker,
  RunQuality,
  Surface,
  User,
} from "./types";

export function photoURL(storageKey: string): string {
  return photoURLFromAPIBase(resolveApiURL("/").replace(/\/+$/, ""), storageKey);
}

const idSegment = safePathSegment;

export interface BBox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

export function useCourtsInBBox(bbox: BBox | null, filters?: CourtFilters) {
  return useQuery({
    queryKey: ["courts", "bbox", bbox, filters],
    enabled: bbox != null,
    // Poll every 5s while the region is still importing courts, else every 45s.
    refetchInterval: (q) => (q.state.data?.seeding ? 5_000 : 45_000),
    refetchIntervalInBackground: false,
    queryFn: async () => {
      const b = bbox!;
      const res = await api<{ courts: CourtSummary[]; seeding?: boolean }>(
        "/courts/search",
        {
          method: "POST",
          body: JSON.stringify({
            query: `bbox=${b.minLng},${b.minLat},${b.maxLng},${b.maxLat}${filtersToQuery(filters ?? {})}`,
          }),
        },
      );
      return { courts: res.courts, seeding: !!res.seeding };
    },
  });
}

// Forecast lookups are batched by id set, not per-court — the scrubber reads
// the response locally (see lib/forecast.ts) so dragging it never refetches.
// Ids are deduped and sorted (via forecastIdSet) before joining, keeping the
// query key (and therefore the cache entry) stable regardless of array
// order; capping at 50 keeps the query string bounded for very large
// viewports. priorityId (the map sheet's selected court, if any) is
// guaranteed a slot in the capped set even if it would otherwise sort
// outside it — see forecastIdSet's doc comment.
const MAX_FORECAST_IDS = 50;

export function useForecasts(
  courtIds: string[],
  priorityId?: string | null,
): Record<string, CourtForecast> {
  const ids = forecastIdSet(courtIds, priorityId, MAX_FORECAST_IDS);
  const { data } = useQuery({
    queryKey: ["courts", "forecast", ids],
    enabled: ids.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const tzOffsetMinutes = -new Date().getTimezoneOffset();
      const res = await api<{ forecasts: CourtForecast[] }>(
        `/courts/forecast?ids=${ids.map(idSegment).join(",")}&tz_offset_minutes=${tzOffsetMinutes}`,
      );
      return res.forecasts;
    },
  });
  return useMemo(() => {
    const byId: Record<string, CourtForecast> = {};
    for (const f of data ?? []) byId[f.court_id] = f;
    return byId;
  }, [data]);
}

export function useCourt(id: string | undefined) {
  return useQuery({
    queryKey: ["courts", id],
    enabled: !!id,
    queryFn: () => api<CourtDetail>(`/courts/${idSegment(id!)}`),
  });
}

export function useCourtActivity(id: string | undefined) {
  return useQuery({
    queryKey: ["courts", id, "activity"],
    enabled: !!id,
    refetchInterval: 20_000,
    refetchIntervalInBackground: false,
    queryFn: () => api<CourtActivity>(`/courts/${idSegment(id!)}/activity`),
  });
}

export function useCurrentCheckIn() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["me", "check-in"],
    enabled: !!user,
    queryFn: () => api<{ check_in: CheckIn | null }>("/me/check-ins/current"),
  });
}

// Shared by check-in and check-out: both change which court the user is
// currently at, which court lists, the feed, and their own check-in state.
function invalidateCheckInState(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: ["courts"] });
  void qc.invalidateQueries({ queryKey: ["me", "check-in"] });
  void qc.invalidateQueries({ queryKey: ["feed"] });
}

// Shared by session create/RSVP/cancel: all change a court's session list,
// its turnout forecast, and the feed's upcoming runs.
function invalidateCourtSessions(qc: QueryClient, courtId: string) {
  void qc.invalidateQueries({ queryKey: ["courts", courtId, "sessions"] });
  void qc.invalidateQueries({ queryKey: ["courts", "forecast"] });
  void qc.invalidateQueries({ queryKey: ["feed"] });
}

export interface CheckInInput {
  party_size: number;
  has_ball: boolean;
  lat?: number;
  lng?: number;
}

export function useCheckIn(courtId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CheckInInput) =>
      api<CheckIn>(`/courts/${idSegment(courtId)}/check-ins`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => invalidateCheckInState(qc),
  });
}

export function useCheckOut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>("/check-ins/current", { method: "DELETE" }),
    onSuccess: () => invalidateCheckInState(qc),
  });
}

export interface NewReport {
  player_count?: number;
  run_quality?: RunQuality;
  note?: string;
}

export function useCreateReport(courtId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (report: NewReport) =>
      api<CrowdReport>(`/courts/${idSegment(courtId)}/reports`, {
        method: "POST",
        body: JSON.stringify(report),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["courts"] });
    },
  });
}

export interface NewCourt {
  name: string;
  lat: number;
  lng: number;
  hoop_count?: number;
  indoor: boolean;
  surface?: Surface;
  lighting?: boolean;
  ignore_duplicates?: boolean;
}

export function useCreateCourt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (court: NewCourt) =>
      api<CourtDetail>("/courts", {
        method: "POST",
        body: JSON.stringify(court),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["courts"] });
    },
  });
}

export function useCourtPhotos(courtId: string | undefined) {
  return useQuery({
    queryKey: ["courts", courtId, "photos"],
    enabled: !!courtId,
    queryFn: async () => {
      const res = await api<{ photos: CourtPhoto[]; external?: ExternalPhoto[] }>(
        `/courts/${idSegment(courtId!)}/photos`,
      );
      return { photos: res.photos, external: res.external ?? [] };
    },
  });
}

// Two-step upload: the API returns an HMAC-signed path on the photos worker,
// then the image bytes are PUT directly there (never through the Go API).
export function useUploadPhoto(courtId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (asset: { uri: string; mimeType?: string }) => {
      const created = await api<{
        photo: CourtPhoto;
        upload_path: string;
        upload_authorization: string;
      }>(
        `/courts/${idSegment(courtId)}/photos`,
        { method: "POST", body: JSON.stringify({}) },
      );
      const normalized = await ImageManipulator.manipulateAsync(asset.uri, [], {
        compress: 0.85,
        format: ImageManipulator.SaveFormat.JPEG,
      });
      const blobResponse = await fetchWithTimeout(normalized.uri);
      const blob = await responseBlobWithTimeout(blobResponse);
      const res = await fetchWithTimeout(resolveApiURL(created.upload_path), {
        method: "PUT",
        headers: {
          Authorization: created.upload_authorization,
          "Content-Type": "image/jpeg",
        },
        body: blob,
      });
      if (!res.ok) {
        const text = await responseTextWithTimeout(res).catch(() => "");
        let body: { error?: string } = {};
        try {
          body = JSON.parse(text) as { error?: string };
        } catch {
          // Keep the status fallback for empty/non-JSON upload errors.
        }
        throw new Error(body.error ?? `upload failed (${res.status})`);
      }
      return created.photo;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["courts", courtId, "photos"] });
    },
  });
}

export function useIsFavorite(courtId: string | undefined) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["courts", courtId, "favorite"],
    enabled: !!courtId && !!user,
    queryFn: () => api<{ favorite: boolean }>(`/courts/${idSegment(courtId!)}/favorite`),
  });
}

export function useSetFavorite(courtId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (favorite: boolean) =>
      api<{ favorite: boolean }>(`/courts/${idSegment(courtId)}/favorite`, {
        method: favorite ? "PUT" : "DELETE",
      }),
    onSuccess: (data) => {
      qc.setQueryData(["courts", courtId, "favorite"], data);
      void qc.invalidateQueries({ queryKey: ["me", "favorites"] });
      void qc.invalidateQueries({ queryKey: ["feed"] });
    },
  });
}

export function useCheckInHistory() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["me", "check-in-history"],
    enabled: !!user,
    queryFn: async () => {
      const res = await api<{ check_ins: CheckInHistoryItem[] }>("/me/check-ins");
      return res.check_ins;
    },
  });
}

export function useCourtSessions(courtId: string | undefined) {
  return useQuery({
    queryKey: ["courts", courtId, "sessions"],
    enabled: !!courtId,
    refetchInterval: 45_000,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      const res = await api<{ sessions: CourtSession[] }>(`/courts/${idSegment(courtId!)}/sessions`);
      return res.sessions;
    },
  });
}

// Phase 19: looking-for-a-run. Public — no `enabled: !!user` gate, since
// guests benefit from seeing demand before deciding whether to sign in.
export function useRunIntents(courtId: string | undefined) {
  return useQuery({
    queryKey: ["courts", courtId, "run-intents"],
    enabled: !!courtId,
    queryFn: async () => {
      const res = await api<{ seekers: RunIntentSeeker[] }>(
        `/courts/${idSegment(courtId!)}/run-intents`,
      );
      return res.seekers;
    },
  });
}

export function useSetRunIntent(courtId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ joined, run_date, window_key }: { joined: boolean; run_date: string; window_key: string }) =>
      api<{ joined: boolean; count: number }>(`/courts/${idSegment(courtId)}/run-intents`, {
        method: joined ? "PUT" : "DELETE",
        body: JSON.stringify({ run_date, window_key }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["courts", courtId, "run-intents"] });
    },
  });
}

export interface NewFlag {
  entity_type: FlagEntityType;
  entity_id: string;
  reason: string;
}

export function useCreateFlag() {
  return useMutation({
    mutationFn: (flag: NewFlag) =>
      api<void>("/flags", { method: "POST", body: JSON.stringify(flag) }),
  });
}

export function useCourtFacts(courtId: string) {
  return useQuery({
    queryKey: ["courts", courtId, "facts"],
    queryFn: async () => {
      const res = await api<{ facts: CourtFact[] }>(`/courts/${safePathSegment(courtId)}/facts`);
      return res.facts;
    },
  });
}

export function useConfirmCourtFact(courtId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { fact: string; value: string }) => {
      const res = await api<{ facts: CourtFact[] }>(
        `/courts/${safePathSegment(courtId)}/facts`,
        { method: "POST", body: JSON.stringify(input) },
      );
      return res.facts;
    },
    onSuccess: (facts) => {
      queryClient.setQueryData(["courts", courtId, "facts"], facts);
      // The stored court value may have moved with the majority.
      void queryClient.invalidateQueries({ queryKey: ["courts", courtId] });
    },
  });
}

export function useAdminFlags() {
  return useQuery({
    queryKey: ["admin", "flags"],
    queryFn: async () => {
      const res = await api<{ flags: Flag[] }>("/admin/flags");
      return res.flags;
    },
  });
}

export function useCreateSession(courtId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (session: { starts_at: string; note?: string }) =>
      api<CourtSession>(`/courts/${idSegment(courtId)}/sessions`, {
        method: "POST",
        body: JSON.stringify(session),
      }),
    onSuccess: () => invalidateCourtSessions(qc, courtId),
  });
}

export function useRSVP(courtId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rsvp: { sessionId: string; status: "going" | "out" }) =>
      api<{ status: string; going_count: number }>(`/sessions/${idSegment(rsvp.sessionId)}/rsvp`, {
        method: "PUT",
        body: JSON.stringify({ status: rsvp.status }),
      }),
    onSuccess: () => invalidateCourtSessions(qc, courtId),
  });
}

export function useCancelSession(courtId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      api<void>(`/sessions/${idSegment(sessionId)}`, { method: "DELETE" }),
    onSuccess: () => invalidateCourtSessions(qc, courtId),
  });
}

export function useCourtMessages(courtId: string | undefined) {
  return useQuery({
    queryKey: ["courts", courtId, "messages"],
    enabled: !!courtId,
    // Chat is the fastest-moving surface; still fine to poll.
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      const res = await api<{ messages: CourtMessage[] }>(`/courts/${idSegment(courtId!)}/messages`);
      // Server returns newest first; display oldest → newest.
      return res.messages.slice().reverse();
    },
  });
}

export function useResolveFlag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (flagId: string) =>
      api<void>(`/admin/flags/${idSegment(flagId)}/resolve`, { method: "POST" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin", "flags"] }),
  });
}

export function useAdminSetCourtStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ courtId, status }: { courtId: string; status: CourtStatus }) =>
      api<void>(`/admin/courts/${idSegment(courtId)}/status`, {
        method: "POST",
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["courts"] }),
  });
}

export function useAdminSetPhotoStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ photoId, status }: { photoId: string; status: PhotoStatus }) =>
      api<void>(`/admin/photos/${idSegment(photoId)}/status`, {
        method: "POST",
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["courts"] }),
  });
}

export function useAdminSearchUsers(query: string) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: ["admin", "users", trimmed],
    enabled: trimmed.length > 0,
    queryFn: async () => {
      const res = await api<{ users: AdminUser[] }>(
        `/admin/users?q=${encodeURIComponent(trimmed)}`,
      );
      return res.users;
    },
  });
}

export function useSendMessage(courtId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) =>
      api<CourtMessage>(`/courts/${idSegment(courtId)}/messages`, {
        method: "POST",
        body: JSON.stringify({ body }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["courts", courtId, "messages"] });
    },
  });
}

export function useSetUserAdmin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, isAdmin }: { userId: string; isAdmin: boolean }) =>
      api<{ user: AdminUser }>(`/admin/users/${idSegment(userId)}/admin`, {
        method: "POST",
        body: JSON.stringify({ is_admin: isAdmin }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "users"] });
      void qc.invalidateQueries({ queryKey: ["admin", "actions"] });
    },
  });
}

export function useAdminActions() {
  return useQuery({
    queryKey: ["admin", "actions"],
    queryFn: async () => {
      const res = await api<{ actions: AdminAction[] }>("/admin/actions");
      return res.actions;
    },
  });
}

export function useBlockedUsers() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["me", "blocked"],
    enabled: !!user,
    queryFn: async () => {
      const res = await api<{ blocked: BlockedUser[] }>("/me/blocked");
      return res.blocked;
    },
  });
}

export function useSetBlocked() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, blocked }: { userId: string; blocked: boolean }) =>
      api<void>(`/users/${idSegment(userId)}/block`, { method: blocked ? "PUT" : "DELETE" }),
    onSuccess: () => {
      // Blocking changes what chat/reports/sessions show — refetch broadly.
      void qc.invalidateQueries({ queryKey: ["me", "blocked"] });
      void qc.invalidateQueries({ queryKey: ["courts"] });
      void qc.invalidateQueries({ queryKey: ["users"] });
      void qc.invalidateQueries({ queryKey: ["feed"] });
      void qc.invalidateQueries({ queryKey: ["me", "follow-requests"] });
    },
  });
}

export function useDeleteAccount() {
  return useMutation({
    mutationFn: () => api<void>("/me", { method: "DELETE" }),
  });
}

// /me/stats: the player card's lifetime stats, badges, and home courts.
export function useMeStats() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["me", "stats"],
    enabled: !!user,
    queryFn: () => {
      const tzOffsetMinutes = -new Date().getTimezoneOffset();
      return api<MeStats>(`/me/stats?tz_offset_minutes=${tzOffsetMinutes}`);
    },
  });
}

export function useProfile(id: string | undefined) {
  return useQuery({
    queryKey: ["users", id],
    enabled: !!id,
    queryFn: () => api<Profile>(`/users/${idSegment(id!)}`),
  });
}

export function useFollowers(id: string | undefined) {
  return useQuery({
    queryKey: ["users", id, "followers"],
    enabled: !!id,
    queryFn: async () => (await api<{ users: FollowUser[] }>(`/users/${idSegment(id!)}/followers`)).users,
  });
}

export function useFollowing(id: string | undefined) {
  return useQuery({
    queryKey: ["users", id, "following"],
    enabled: !!id,
    queryFn: async () => (await api<{ users: FollowUser[] }>(`/users/${idSegment(id!)}/following`)).users,
  });
}

export function useSetFollow(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (follow: boolean) =>
      api<{ following?: boolean; requested?: boolean; follower_count?: number }>(`/users/${idSegment(id)}/follow`, {
        method: follow ? "PUT" : "DELETE",
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["users", id] });
      void qc.invalidateQueries({ queryKey: ["users"] });
      void qc.invalidateQueries({ queryKey: ["feed"] });
    },
  });
}

export function useFollowRequests() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["me", "follow-requests"],
    enabled: !!user,
    queryFn: async () => (await api<{ requests: FollowRequest[] }>("/me/follow-requests")).requests,
  });
}

export function useAcceptFollowRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (requesterId: string) =>
      api<void>(`/users/${idSegment(requesterId)}/follow-requests/accept`, { method: "POST" }),
    onSuccess: (_data, requesterId) => {
      void qc.invalidateQueries({ queryKey: ["me", "follow-requests"] });
      void qc.invalidateQueries({ queryKey: ["users", requesterId] });
      void qc.invalidateQueries({ queryKey: ["users"] });
      void qc.invalidateQueries({ queryKey: ["feed"] });
    },
  });
}

export function useRejectFollowRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (requesterId: string) =>
      api<void>(`/users/${idSegment(requesterId)}/follow-requests/reject`, { method: "POST" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["me", "follow-requests"] }),
  });
}

export function useUploadAvatar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (asset: { uri: string; mimeType?: string }) => {
      const created = await api<{
        avatar_url: string;
        upload_path: string;
        upload_authorization: string;
      }>("/me/avatar", {
        method: "POST",
        body: JSON.stringify({}),
      });
      const normalized = await ImageManipulator.manipulateAsync(asset.uri, [], {
        compress: 0.85,
        format: ImageManipulator.SaveFormat.JPEG,
      });
      const blobResponse = await fetchWithTimeout(normalized.uri);
      const blob = await responseBlobWithTimeout(blobResponse);
      const res = await fetchWithTimeout(resolveApiURL(created.upload_path), {
        method: "PUT",
        headers: {
          Authorization: created.upload_authorization,
          "Content-Type": "image/jpeg",
        },
        body: blob,
      });
      if (!res.ok) throw new Error(`avatar upload failed (${res.status})`);
      await api<User>("/me", { method: "PATCH", body: JSON.stringify({ avatar_url: created.avatar_url }) });
      return created.avatar_url;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["me"] });
      void qc.invalidateQueries({ queryKey: ["users"] });
    },
  });
}

export function useClearAvatar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>("/me/avatar", { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["me"] });
      void qc.invalidateQueries({ queryKey: ["users"] });
    },
  });
}

// Upcoming runs at any court near the given point — public discovery, no
// account needed (phase 17). Same 10km radius as the Activity tab's court
// list so the two rails describe the same neighborhood.
export function useNearbyRuns(pos: { lat: number; lng: number } | null) {
  return useQuery({
    queryKey: ["runs", "nearby", pos],
    enabled: pos != null,
    refetchInterval: 45_000,
    refetchIntervalInBackground: false,
    queryFn: () =>
      api<{ runs: NearbyRun[] }>(
        `/sessions/nearby?lat=${pos!.lat}&lng=${pos!.lng}&radius_m=10000`,
      ),
  });
}

export function useFeed() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["feed"],
    enabled: !!user,
    refetchInterval: 45_000,
    refetchIntervalInBackground: false,
    queryFn: () =>
      api<{ friends_here: FriendPresence[]; upcoming_runs: FeedRun[] }>("/feed"),
  });
}

export function usePatchCourtAttributes(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (attrs: Partial<CourtDetail>) =>
      api<CourtDetail>(`/courts/${idSegment(id)}/attributes`, { method: "PATCH", body: JSON.stringify(attrs) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["courts"] }),
  });
}

export function useVoteCourt(courtId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vote: 1 | -1) =>
      api<{ net_votes: number; status: string }>(`/courts/${idSegment(courtId)}/vote`, {
        method: "POST",
        body: JSON.stringify({ vote }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["courts"] });
    },
  });
}
