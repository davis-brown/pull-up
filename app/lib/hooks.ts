import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api, API_URL } from "./api";
import type {
  CheckIn,
  CheckInHistoryItem,
  CourtActivity,
  CourtDetail,
  CourtPhoto,
  CourtSummary,
  CrowdReport,
  RunQuality,
  Surface,
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

export function useCourtsInBBox(bbox: BBox | null) {
  return useQuery({
    queryKey: ["courts", "bbox", bbox],
    enabled: bbox != null,
    // Court activity moves on a minutes timescale; poll while focused.
    refetchInterval: 45_000,
    queryFn: async () => {
      const b = bbox!;
      const res = await api<{ courts: CourtSummary[] }>(
        `/courts?bbox=${b.minLng},${b.minLat},${b.maxLng},${b.maxLat}`,
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
  return useQuery({
    queryKey: ["me", "check-in"],
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
      const res = await api<{ photos: CourtPhoto[] }>(`/courts/${courtId}/photos`);
      return res.photos;
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
  return useQuery({
    queryKey: ["courts", courtId, "favorite"],
    enabled: !!courtId,
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
  return useQuery({
    queryKey: ["me", "check-in-history"],
    queryFn: async () => {
      const res = await api<{ check_ins: CheckInHistoryItem[] }>("/me/check-ins");
      return res.check_ins;
    },
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
