"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Asset library placeholder. Wire to a GET /v1/assets listing endpoint to show
 * uploads, generations, stock, and scraped images with their platform variants.
 */
export default function LibraryPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Library</h1>
        <p className="text-muted-foreground">
          Every asset the agents have produced, with per-platform variants.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Coming online</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          The backend already records every Asset (uploads, AI generations, stock,
          scraped) with Cloudinary variants per platform. Add a{" "}
          <code className="rounded bg-secondary px-1">GET /v1/assets</code> listing
          route and this grid lights up.
        </CardContent>
      </Card>
    </div>
  );
}
