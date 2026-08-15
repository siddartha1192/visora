import { Schema, model, type InferSchemaType, type Types } from "mongoose";

/**
 * The tenant: one customer company. Everything a customer owns hangs off this
 * — users, workspaces (their brands/products), and eventually the subscription.
 *
 * Deliberately a record rather than "the first user's account": billing and
 * company identity belong to the company, not to whichever person signed up,
 * and must survive that person leaving.
 */
const organizationSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },

    // Billing lives here, not on Workspace. Both fields were previously inert
    // placeholders on Workspace; a subscription layer attaches to these.
    plan: { type: String, default: "free" },
    creditBalance: { type: Number, default: 0 },

    status: { type: String, enum: ["active", "suspended"], default: "active" },
  },
  { timestamps: true },
);

export type OrganizationDoc = InferSchemaType<typeof organizationSchema> & {
  _id: Types.ObjectId;
};

export const OrganizationModel = model("Organization", organizationSchema);

/** URL-safe slug from a company name, with a short suffix to avoid collisions. */
export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "org";
}
