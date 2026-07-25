"use client";

import { ShieldX } from "lucide-react";
import { Button } from "./button";

interface ContentPolicyModalProps {
  message: string;
  onDismiss: () => void;
}

export function ContentPolicyModal({ message, onDismiss }: ContentPolicyModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onDismiss}
    >
      <div
        className="relative mx-4 w-full max-w-md rounded-2xl border border-destructive/30 bg-background p-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
            <ShieldX className="h-7 w-7 text-destructive" />
          </div>

          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Content Policy Violation</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">{message}</p>
          </div>

          <Button
            className="mt-2 w-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={onDismiss}
          >
            Dismiss &amp; Revise
          </Button>
        </div>
      </div>
    </div>
  );
}
