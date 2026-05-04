export const tokens = {
  verification: {
    UNREPORTED: { fg: "var(--color-amber-50)", bg: "var(--color-amber-600)", icon: "AlertTriangle" },
    EMERGING: { fg: "var(--color-orange-50)", bg: "var(--color-orange-600)", icon: "Flame" },
    CREWS_ACTIVE: { fg: "var(--color-emerald-50)", bg: "var(--color-emerald-700)", icon: "Truck" },
    KNOWN_PRESCRIBED: { fg: "var(--color-zinc-50)", bg: "var(--color-zinc-600)", icon: "Calendar" },
    LIKELY_INDUSTRIAL: { fg: "var(--color-zinc-50)", bg: "var(--color-zinc-700)", icon: "Factory" },
  },
  probability: {
    p25: "var(--color-yellow-300)",
    p50: "var(--color-orange-400)",
    p75: "var(--color-red-500)",
  },
} as const;

export type VerificationStatus = keyof typeof tokens.verification;
