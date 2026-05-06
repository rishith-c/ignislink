"use client";

// React Query hook for the TRIBE v2 neural-response endpoint.
//
// Surfaces the predicted whole-brain fMRI response amplitude for an incident
// summary. Cached for 5 min — the upstream Space response is deterministic
// for the same input, and we don't want to hammer free-tier HF endpoints.

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

export type TribeMode = "space" | "synthetic";

export interface TribeNeuralResponse {
  incidentId: string;
  amplitude: number;
  rawNorm: number | null;
  mode: TribeMode;
  spaceId: string | null;
  stimulus: string;
  fetchedAt: string;
}

export function useTribeNeuralResponse(
  incidentId: string | null,
): UseQueryResult<TribeNeuralResponse, Error> {
  return useQuery<TribeNeuralResponse, Error>({
    queryKey: ["tribe", incidentId],
    enabled: !!incidentId,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 0,
    queryFn: async () => {
      const res = await fetch(`/api/tribe/${incidentId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as TribeNeuralResponse;
    },
  });
}
