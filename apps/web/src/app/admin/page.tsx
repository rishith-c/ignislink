import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

/**
 * Admin — placeholder. See PRD §4.3 for full surface.
 *
 * Sections to come: bounding boxes, routing rules, camera registry, model
 * versions, audit log, mute regions.
 */
export default function AdminPage() {
  return (
    <main className="container mx-auto flex min-h-screen flex-col gap-6 px-4 py-12">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <p className="text-sm text-muted-foreground">
          Configuration, audit, and model-version management. Auth-gated; arrives in Stage 5.
        </p>
      </header>
      <ul className="grid gap-3 sm:grid-cols-2">
        {[
          "Bounding boxes",
          "Routing rules",
          "Camera registry",
          "Model versions",
          "Audit log",
          "Mute regions",
        ].map((label) => (
          <li
            key={label}
            className="rounded-lg border border-dashed border-border bg-card p-5 text-sm text-muted-foreground"
          >
            {label}
          </li>
        ))}
      </ul>
    </main>
  );
}
