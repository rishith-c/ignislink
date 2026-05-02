import Link from "next/link";

export default function NotFound() {
  return (
    <main className="container mx-auto flex min-h-screen flex-col items-center justify-center gap-4 px-4 py-12 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Not found</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        That route doesn&apos;t exist yet. Try the{" "}
        <Link href="/" className="underline underline-offset-4">
          public map
        </Link>{" "}
        or the{" "}
        <Link href="/console" className="underline underline-offset-4">
          dispatcher console
        </Link>
        .
      </p>
    </main>
  );
}
