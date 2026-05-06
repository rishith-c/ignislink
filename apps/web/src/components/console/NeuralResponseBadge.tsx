"use client";

// NeuralResponseBadge — shows the TRIBE v2 predicted neural-response
// amplitude for the active incident.
//
// Honest labelling matters here: TRIBE v2 is a brain-encoding model, not a
// fear/threat classifier. The badge says "Neural Response · TRIBE v2" and
// the Tooltip explains exactly what the scalar represents and notes when
// we're showing the deterministic synthetic fallback.

import { Brain, Loader2, RotateCw, XCircle } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useTribeNeuralResponse } from "@/lib/hooks/useTribeNeuralResponse";

const TOOLTIP_LIVE =
  "Predicted whole-brain fMRI response amplitude from TRIBE v2 (Meta, 2025). " +
  "The scalar is the RMS of the response vector; higher = stronger predicted " +
  "neural activation to the incident summary. NOT a fear or threat classifier " +
  "— TRIBE v2 is a brain-encoding model. License: CC-BY-NC-4.0.";

const TOOLTIP_SYNTHETIC =
  "TRIBE v2 Space unavailable — showing a deterministic estimate derived from " +
  "intensity/population/fuel signals. Click ↻ to retry.";

const TOOLTIP_LOADING =
  "Calling Meta TRIBE v2 via HuggingFace Space — first call may take ~10 s " +
  "while the Space wakes up.";

export function NeuralResponseBadge({
  incidentId,
}: {
  incidentId: string | null;
}) {
  const { data, isLoading, isError, refetch, isFetching } =
    useTribeNeuralResponse(incidentId);

  const mode = data?.mode ?? null;
  const amplitude = data?.amplitude;

  const dotCls = isLoading
    ? "text-zinc-400"
    : isError
      ? "text-red-400"
      : mode === "synthetic"
        ? "text-amber-400"
        : "text-emerald-400";

  const tooltipText = isLoading
    ? TOOLTIP_LOADING
    : mode === "synthetic"
      ? TOOLTIP_SYNTHETIC
      : TOOLTIP_LIVE;

  const valueLabel =
    isLoading || amplitude === undefined || !Number.isFinite(amplitude)
      ? "—"
      : amplitude.toFixed(2);

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              "inline-flex w-full items-center gap-2 rounded-full border border-white/10 bg-black/60 px-3 py-1.5 text-[11px]",
              "text-zinc-200",
            )}
          >
            <Brain className="h-3.5 w-3.5 text-zinc-300" />
            <span className="font-medium tracking-tight">
              Neural Response · TRIBE v2
            </span>
            <span className="text-muted-foreground">·</span>
            <span className="font-mono tabular-nums text-zinc-100">
              {valueLabel}
            </span>
            {mode === "synthetic" && !isLoading && (
              <span className="text-[10px] uppercase tracking-wide text-amber-300">
                synthetic estimate
              </span>
            )}
            <span className="ml-auto inline-flex items-center gap-1.5">
              {isLoading ? (
                <Loader2 className={cn("h-3 w-3 animate-spin", dotCls)} />
              ) : isError ? (
                <XCircle className={cn("h-3 w-3", dotCls)} />
              ) : (
                <span
                  className={cn(
                    "h-2 w-2 rounded-full",
                    mode === "synthetic"
                      ? "bg-amber-400"
                      : "bg-emerald-400",
                  )}
                  aria-hidden
                />
              )}
              {(mode === "synthetic" || isError) && !isLoading && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void refetch();
                  }}
                  className="text-zinc-400 transition-colors hover:text-zinc-100 disabled:opacity-50"
                  aria-label="Retry TRIBE v2"
                  disabled={isFetching}
                >
                  <RotateCw
                    className={cn(
                      "h-3 w-3",
                      isFetching && "animate-spin",
                    )}
                  />
                </button>
              )}
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs text-[11px] leading-snug">
          {tooltipText}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
