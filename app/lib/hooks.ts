import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api, API_URL } from "./api";
import { useAuth } from "./auth-context";
import { filtersToQuery, type CourtFilters } from "./court-filters";
import type {
  AdminAction,
  AdminUser,
  BlockedUser,
  CheckIn,
  CheckInHistoryItem,
  CourtActivity,
  CourtDetail,
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
  PhotoStatus,
  Profile,
  RunQuality,
  Surface,
  User,
} from "./types";

export function photoURL(storageKey: string): string {
  return `${API_URL}/photos/${storageKey}`;
}

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
    // Court activity moves on a minutes timescale; poll while focused.
    refetchInterval: 45_000,
    queryFn: async () => {
      const b = bbox!;
      const res = await api<{ courts: CourtSummary[] }>(
        `/courts?bbox=${b.minLng},${b.minLat},${b.maxLng},${b.maxLat}${filtersToQuery(filters ?? {})}`,
      );
      return res.courts;
    },
  });
}

export function useCourt(id: string | undefined) {
  return useQuery({
    queryKey: ["courts", id],
    enabled: !!id,
    queryFn: () => api<CourtDetail>(`/courts/${id}`),
  });
}

export function useCourtActivity(id: string | undefined) {
  return useQuery({
    queryKey: ["courts", id, "activity"],
    enabled: !!id,
    refetchInterval: 20_000,
    queryFn: () => api<CourtActivity>(`/courts/${id}/activity`),
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

export function useCheckIn(courtId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (coords: { lat: number; lng: number }) =>
      api<CheckIn>(`/courts/${courtId}/check-ins`, {
        method: "POST",
        body: JSON.stringify(coords),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["courts"] });
      void qc.invalidateQueries({ queryKey: ["me", "check-in"] });
    },
  });
}

export function useCheckOut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>("/check-ins/current", { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["courts"] });
      void qc.invalidateQueries({ queryKey: ["me", "check-in"] });
    },
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
      api<CrowdReport>(`/courts/${courtId}/reports`, {
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
        `/courts/${courtId}/photos`,
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
      const created = await api<{ photo: CourtPhoto; upload_path: string }>(
        `/courts/${courtId}/photos`,
        { method: "POST", body: JSON.stringify({}) },
      );
      const blob = await (await fetch(asset.uri)).blob();
      const res = await fetch(`${API_URL}${created.upload_path}`, {
        method: "PUT",
        headers: { "Content-Type": asset.mimeType ?? "image/jpeg" },
        body: blob,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
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
    queryFn: () => api<{ favorite: boolean }>(`/courts/${courtId}/favorite`),
  });
}

export function useSetFavorite(courtId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (favorite: boolean) =>
      api<{ favorite: boolean }>(`/courts/${courtId}/favorite`, {
        method: favorite ? "PUT" : "DELETE",
      }),
    onSuccess: (data) => {
      qc.setQueryData(["courts", courtId, "favorite"], data);
      void qc.invalidateQueries({ queryKey: ["me", "favorites"] });
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
    queryFn: async () => {
      const res = await api<{ sessions: CourtSession[] }>(`/courts/${courtId}/sessions`);
      return res.sessions;
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
      api<CourtSession>(`/courts/${courtId}/sessions`, {
        method: "POST",
        body: JSON.stringify(session),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["courts", courtId, "sessions"] });
    },
  });
}

export function useRSVP(courtId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rsvp: { sessionId: string; status: "going" | "out" }) =>
      api<{ status: string; going_count: number }>(`/sessions/${rsvp.sessionId}/rsvp`, {
        method: "PUT",
        body: JSON.stringify({ status: rsvp.status }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["courts", courtId, "sessions"] });
    },
  });
}

export function useCancelSession(courtId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) =>
      api<void>(`/sessions/${sessionId}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["courts", courtId, "sessions"] });
    },
  });
}

export function useCourtMessages(courtId: string | undefined) {
  return useQuery({
    queryKey: ["courts", courtId, "messages"],
    enabled: !!courtId,
    // Chat is the fastest-moving surface; still fine to poll.
    refetchInterval: 15_000,
    queryFn: async () => {
      const res = await api<{ messages: CourtMessage[] }>(`/courts/${courtId}/messages`);
      // Server returns newest first; display oldest → newest.
      return res.messages.slice().reverse();
    },
  });
}

export function useResolveFlag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (flagId: string) =>
      api<void>(`/admin/flags/${flagId}/resolve`, { method: "POST" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin", "flags"] }),
  });
}

export function useAdminSetCourtStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ courtId, status }: { courtId: string; status: CourtStatus }) =>
      api<void>(`/admin/courts/${courtId}/status`, {
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
      api<void>(`/admin/photos/${photoId}/status`, {
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
      api<CourtMessage>(`/courts/${courtId}/messages`, {
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
      api<{ user: AdminUser }>(`/admin/users/${userId}/admin`, {
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
      api<void>(`/users/${userId}/block`, { method: blocked ? "PUT" : "DELETE" }),
    onSuccess: () => {
      // Blocking changes what chat/reports/sessions show — refetch broadly.
      void qc.invalidateQueries({ queryKey: ["me", "blocked"] });
      void qc.invalidateQueries({ queryKey: ["courts"] });
    },
  });
}

export function useDeleteAccount() {
  return useMutation({
    mutationFn: () => api<void>("/me", { method: "DELETE" }),
  });
}

export function useProfile(id: string | undefined) {
  return useQuery({
    queryKey: ["users", id],
    enabled: !!id,
    queryFn: () => api<Profile>(`/users/${id}`),
  });
}

export function useFollowers(id: string | undefined) {
  return useQuery({
    queryKey: ["users", id, "followers"],
    enabled: !!id,
    queryFn: async () => (await api<{ users: FollowUser[] }>(`/users/${id}/followers`)).users,
  });
}

export function useFollowing(id: string | undefined) {
  return useQuery({
    queryKey: ["users", id, "following"],
    enabled: !!id,
    queryFn: async () => (await api<{ users: FollowUser[] }>(`/users/${id}/following`)).users,
  });
}

export function useSetFollow(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (follow: boolean) =>
      api<{ following?: boolean; requested?: boolean; follower_count?: number }>(`/users/${id}/follow`, {
        method: follow ? "PUT" : "DELETE",
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["users", id] });
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
      api<void>(`/users/${requesterId}/follow-requests/accept`, { method: "POST" }),
    onSuccess: (_data, requesterId) => {
      void qc.invalidateQueries({ queryKey: ["me", "follow-requests"] });
      void qc.invalidateQueries({ queryKey: ["users", requesterId] });
    },
  });
}

export function useRejectFollowRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (requesterId: string) =>
      api<void>(`/users/${requesterId}/follow-requests/reject`, { method: "POST" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["me", "follow-requests"] }),
  });
}

export function useUploadAvatar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (asset: { uri: string; mimeType?: string }) => {
      const created = await api<{ avatar_url: string; upload_path: string }>("/me/avatar", {
        method: "POST",
        body: JSON.stringify({}),
      });
      const blob = await (await fetch(asset.uri)).blob();
      const res = await fetch(`${API_URL}${created.upload_path}`, {
        method: "PUT",
        headers: { "Content-Type": asset.mimeType ?? "image/jpeg" },
        body: blob,
      });
      if (!res.ok) throw new Error(`avatar upload failed (${res.status})`);
      await api<User>("/me", { method: "PATCH", body: JSON.stringify({ avatar_url: created.avatar_url }) });
      return created.avatar_url;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["me"] }),
  });
}

export function useClearAvatar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>("/me/avatar", { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["me"] }),
  });
}

export function useFeed() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["feed"],
    enabled: !!user,
    refetchInterval: 45_000,
    queryFn: () =>
      api<{ friends_here: FriendPresence[]; upcoming_runs: FeedRun[] }>("/feed"),
  });
}

export function usePatchCourtAttributes(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (attrs: Partial<CourtDetail>) =>
      api<CourtDetail>(`/courts/${id}/attributes`, { method: "PATCH", body: JSON.stringify(attrs) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["courts", id] }),
  });
}

export function useVoteCourt(courtId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vote: 1 | -1) =>
      api<{ net_votes: number; status: string }>(`/courts/${courtId}/vote`, {
        method: "POST",
        body: JSON.stringify({ vote }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["courts", courtId] });
    },
  });
}
