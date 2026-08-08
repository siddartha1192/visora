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
import { PageHeader } from "@/components/ui/page-header";
import { Settings as SettingsIcon, Globe2, KeyRound } from "lucide-react";

/**
 * Settings: social account connections + API keys. The connect flows and key
 * minting hit the workspace endpoints; rendered here as the management surface.
 */
export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        icon={<SettingsIcon className="h-5 w-5" />}
        title="Settings"
        description="Connect networks and manage programmatic access."
      />

      <Card>
        <CardHeader>
          <CardTitle>Social accounts</CardTitle>
          <CardDescription>
            Each platform publishes through its own OAuth-backed adapter.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2.5">
          {PLATFORMS.map((p) => (
            <div
              key={p}
              className="flex items-center justify-between rounded-lg border border-border bg-secondary/10 p-3 transition-colors hover:bg-secondary/20"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-secondary/60 text-muted-foreground">
                  <Globe2 className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-medium capitalize">{p}</p>
                  <Badge className="mt-0.5 border-none bg-transparent px-0 text-muted-foreground/70">
                    Not connected
                  </Badge>
                </div>
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
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-muted-foreground" />
            API keys
          </CardTitle>
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
