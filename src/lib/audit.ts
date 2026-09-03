import "server-only";
import { all, insert } from "./db";
import type { SessionUser } from "./auth";

/** Registra uma alteracao relevante no historico do sistema. */
export function logAction(
  user: SessionUser | null,
  action: string,
  entity: string,
  entityId: number | null,
  summary: string,
  meta?: unknown,
) {
  insert(
    `INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, summary, meta)
     VALUES (?,?,?,?,?,?,?)`,
    [user?.id ?? null, user?.name ?? "sistema", action, entity, entityId, summary, meta ? JSON.stringify(meta) : null],
  );
}

export function recentLogs(limit = 100, offset = 0) {
  return all(
    `SELECT * FROM audit_logs ORDER BY id DESC LIMIT ? OFFSET ?`,
    [limit, offset],
  );
}

export function logsFor(entity: string, entityId: number) {
  return all(`SELECT * FROM audit_logs WHERE entity = ? AND entity_id = ? ORDER BY id DESC`, [entity, entityId]);
}
