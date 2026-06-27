import { z } from "zod";
import { PLATFORMS, SCHEDULE_MODES } from "../constants/enums.js";

/** A 24-char hex Mongo ObjectId, as a string over the wire. */
export const objectIdSchema = z
  .string()
  .regex(/^[a-f0-9]{24}$/i, "must be a 24-character hex ObjectId");

export const platformSchema = z.enum(PLATFORMS);

export const publishTargetSchema = z.object({
  platform: platformSchema,
  /** The connected social account on the workspace to publish through. */
  accountId: objectIdSchema,
});
export type PublishTargetInput = z.infer<typeof publishTargetSchema>;

export const scheduleSchema = z
  .object({
    mode: z.enum(SCHEDULE_MODES),
    /** Required when mode === "scheduled". ISO-8601 instant. */
    runAt: z.string().datetime().optional(),
    timezone: z.string().default("UTC"),
  })
  .refine(
    (s) => s.mode === "instant" || Boolean(s.runAt),
    { message: "runAt is required when mode is 'scheduled'", path: ["runAt"] },
  )
  .refine(
    (s) => s.mode === "instant" || !s.runAt || new Date(s.runAt) > new Date(),
    { message: "runAt must be in the future", path: ["runAt"] },
  );
export type ScheduleInput = z.infer<typeof scheduleSchema>;

export const captionSchema = z.object({
  /** When omitted on an AI workflow, the Caption node may generate one. */
  text: z.string().max(4000).optional(),
  hashtags: z.array(z.string()).max(30).default([]),
  /** Ask the agent to author the caption. */
  generate: z.boolean().default(false),
});
export type CaptionInput = z.infer<typeof captionSchema>;
