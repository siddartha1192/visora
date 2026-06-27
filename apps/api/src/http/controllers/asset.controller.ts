import type { FastifyReply, FastifyRequest } from "fastify";
import { BadRequestError } from "../../lib/errors.js";
import { getAsset, uploadAsset } from "../../modules/assets/asset.service.js";
import { created, ok } from "../reply.js";

const ALLOWED = ["image/png", "image/jpeg", "image/webp"];

/** Streams a multipart image upload to the object store and records the Asset. */
export async function upload(req: FastifyRequest, reply: FastifyReply) {
  const file = await req.file({ limits: { fileSize: 15 * 1024 * 1024 } });
  if (!file) throw new BadRequestError("No file provided");
  if (!ALLOWED.includes(file.mimetype)) {
    throw new BadRequestError(`Unsupported type ${file.mimetype}`);
  }
  const bytes = await file.toBuffer();
  const dto = await uploadAsset({
    workspaceId: req.auth!.workspaceId,
    bytes,
    mime: file.mimetype,
  });
  return created(reply, dto);
}

export async function getOne(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  return ok(reply, await getAsset(req.auth!.workspaceId, id));
}
