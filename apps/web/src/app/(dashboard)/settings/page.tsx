"use client";

import { PLATFORMS } from "@visora/shared";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

/**
 * Settings: social account connections + API keys. The connect flows and key
 * minting hit the workspace endpoints; rendered here as the management surface.
 */
export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-[-0.02em]">Settings</h1>
        <p className="text-muted-foreground">
          Connect networks and manage programmatic access.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Social accounts</CardTitle>
          <CardDescription>
            Each platform publishes through its own OAuth-backed adapter.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {PLATFORMS.map((p) => (
            <div
              key={p}
              className="flex items-center justify-between rounded-lg border border-border p-3"
            >
              <div className="flex items-center gap-3">
                <span className="font-medium capitalize">{p}</span>
                <Badge className="text-muted-foreground">Not connected</Badge>
              </div>
              <Button variant="outline" size="sm">
                Connect
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>API keys</CardTitle>
          <CardDescription>
            Trigger any of the 5 workflows programmatically via{" "}
            <code className="rounded bg-secondary px-1">x-api-key</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" size="sm">
            Generate new key
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
