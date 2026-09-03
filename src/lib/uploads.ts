import "server-only";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { insert, all, one, run } from "./db";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/gif"];

/** Salva um arquivo enviado e devolve o caminho publico, ou null. */
export async function saveUpload(file: File | null): Promise<string | null> {
  if (!file || typeof file === "string" || file.size === 0) return null;
  if (file.size > MAX_BYTES) throw new Error("Arquivo muito grande (limite de 8 MB).");
  if (file.type && !ALLOWED.includes(file.type)) throw new Error("Formato de imagem nao suportado.");

  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "jpg";
  const name = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${ext}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(path.join(UPLOAD_DIR, name), bytes);
  return `/uploads/${name}`;
}

export async function attach(
  entity: string,
  entityId: number,
  files: File[],
  userId?: number,
  caption?: string,
): Promise<number> {
  let saved = 0;
  for (const f of files) {
    const p = await saveUpload(f);
    if (!p) continue;
    insert(`INSERT INTO attachments (entity, entity_id, path, caption, created_by) VALUES (?,?,?,?,?)`, [
      entity,
      entityId,
      p,
      caption ?? null,
      userId ?? null,
    ]);
    saved++;
  }
  return saved;
}

export function attachmentsFor(entity: string, entityId: number) {
  return all<any>(`SELECT * FROM attachments WHERE entity = ? AND entity_id = ? ORDER BY id DESC`, [entity, entityId]);
}

export async function removeAttachment(id: number) {
  const a = one<any>(`SELECT * FROM attachments WHERE id = ?`, [id]);
  if (!a) return;
  run(`DELETE FROM attachments WHERE id = ?`, [id]);
  try {
    await fs.unlink(path.join(process.cwd(), "public", a.path.replace(/^\//, "")));
  } catch {
    // arquivo ja removido: nada a fazer
  }
}
