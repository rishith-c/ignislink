import { ImageResponse } from "next/og";

// Browser-tab icon — generated at build/request time as a real PNG so we
// never ship a corrupt binary in the repo. Replaces the broken icon.png that
// was committed as ASCII text.

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          fontSize: 28,
          background: "#0a0a0d",
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#f97316",
          borderRadius: 6,
        }}
      >
        🔥
      </div>
    ),
    { ...size },
  );
}
