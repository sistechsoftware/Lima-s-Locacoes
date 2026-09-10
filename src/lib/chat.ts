import "server-only";
import { all, batch, insert, one, run, scalar } from "./db";
import type { SessionUser } from "./auth";
import { saveChatAttachment } from "./uploads";

/**
 * Chat entre usuarios.
 *
 * Toda consulta parte da participacao do proprio usuario: quem nao participa
 * da conversa simplesmente nao enxerga mensagens, anexos nem contadores.
 * Conversas sao 1:1 (par de usuarios), criadas sob demanda na primeira
 * mensagem, e o "nao lidas" sai de um cursor por participante
 * (last_read_message_id), atualizado com uma unica escrita ao abrir a
 * conversa — sem flag por mensagem.
 */

export class ChatError extends Error {}

const MAX_BODY = 4000;

/* ------------------------------- usuarios ------------------------------- */

/** Usuarios ativos com quem se pode conversar (exceto o proprio). */
export async function contactableUsers(me: number) {
  return await all<{ id: number; name: string; username: string; role: string }>(
    `SELECT id, name, username, role FROM users
      WHERE active = 1 AND id <> ? ORDER BY name`,
    [me],
  );
}

/* ------------------------------ conversas ------------------------------- */

/** Garante a conversa 1:1 do par e devolve o id. Criada sob demanda. */
export async function ensureConversation(me: number, other: number): Promise<number> {
  if (!Number.isInteger(other) || other === me) throw new ChatError("Contato invalido.");
  const alvo = await one<{ id: number; active: number }>(
    `SELECT id, active FROM users WHERE id = ?`,
    [other],
  );
  if (!alvo || !alvo.active) throw new ChatError("Usuário não disponível para conversa.");
  const lo = Math.min(me, other);
  const hi = Math.max(me, other);
  const existente = await one<{ id: number }>(
    `SELECT id FROM chat_conversations WHERE user_low = ? AND user_high = ?`,
    [lo, hi],
  );
  if (existente) return existente.id;
  const conv = await insert(
    `INSERT INTO chat_conversations (user_low, user_high) VALUES (?,?)`,
    [lo, hi],
  );
  await batch([
    { sql: `INSERT INTO chat_participants (conversation_id, user_id) VALUES (?,?)`, params: [conv, lo] },
    { sql: `INSERT INTO chat_participants (conversation_id, user_id) VALUES (?,?)`, params: [conv, hi] },
  ]);
  return conv;
}

export async function isParticipant(conversationId: number, userId: number): Promise<boolean> {
  return !!(await one(
    `SELECT 1 AS ok FROM chat_participants WHERE conversation_id = ? AND user_id = ?`,
    [conversationId, userId],
  ));
}

export type ConversationRow = {
  conversation_id: number;
  other_id: number;
  other_name: string;
  other_username: string;
  last_message_id: number;
  last_body: string | null;
  last_kind: string;
  last_sender_id: number | null;
  last_created_at: string | null;
  unread: number;
  archived: number;
};

/**
 * Lista de conversas do usuario, ordenada pela mensagem mais recente.
 * Uma conversa arquivada so reaparece quando chega mensagem nova.
 */
export async function listConversations(me: number): Promise<ConversationRow[]> {
  return await all<ConversationRow>(
    `SELECT c.id AS conversation_id,
            o.id AS other_id, o.name AS other_name, o.username AS other_username,
            COALESCE(m.id, 0) AS last_message_id, m.body AS last_body,
            m.kind AS last_kind, m.sender_id AS last_sender_id, m.created_at AS last_created_at,
            (SELECT COUNT(*) FROM chat_messages cm
              WHERE cm.conversation_id = c.id AND cm.id > p.last_read_message_id
                AND cm.sender_id <> ?) AS unread,
            CASE WHEN p.archived_at IS NULL THEN 0 ELSE 1 END AS archived
       FROM chat_participants p
       JOIN chat_conversations c ON c.id = p.conversation_id
       JOIN users o ON o.id = CASE WHEN c.user_low = ? THEN c.user_high ELSE c.user_low END
       LEFT JOIN chat_messages m ON m.id = (
         SELECT cm2.id FROM chat_messages cm2 WHERE cm2.conversation_id = c.id ORDER BY cm2.id DESC LIMIT 1
       )
      WHERE p.user_id = ?
        AND (p.archived_at IS NULL OR COALESCE(m.id, 0) > COALESCE(p.archive_before, 0))
      ORDER BY last_message_id DESC, c.id DESC`,
    [me, me, me],
  );
}

export async function archiveConversation(me: number, conversationId: number, archived: boolean) {
  await assertParticipant(conversationId, me);
  if (!archived) {
    await run(
      `UPDATE chat_participants SET archived_at = NULL WHERE conversation_id = ? AND user_id = ?`,
      [conversationId, me],
    );
    return;
  }
  // Guarda o id da ultima mensagem existente no momento do arquivamento:
  // "arquivar ate aqui". A conversa reaparece so quando houver mensagem com
  // id maior — sem depender de relogio e sem corrida com o segundo em que a
  // mensagem nova e gravada. archived_at fica so como registro de quando foi.
  const ultima = await scalar<number>(
    `SELECT COALESCE(MAX(id),0) FROM chat_messages WHERE conversation_id = ?`,
    [conversationId],
  );
  await run(
    `UPDATE chat_participants
        SET archived_at = datetime('now','localtime'),
            archive_before = ?
      WHERE conversation_id = ? AND user_id = ?`,
    [ultima, conversationId, me],
  );
}

/* ------------------------------ mensagens ------------------------------- */

export type ChatMessage = {
  id: number;
  conversation_id: number;
  sender_id: number;
  body: string | null;
  kind: string;
  file_id: string | null;
  file_name: string | null;
  file_mime: string | null;
  file_size: number | null;
  audio_seconds: number | null;
  duration_ms: number | null;
  read_at: string | null;
  deleted_at: string | null;
  created_at: string;
  /** Preenchido no payload da API, nao no banco. */
  sender_name?: string;
  mine?: boolean;
};

async function assertParticipant(conversationId: number, userId: number) {
  if (!Number.isInteger(conversationId) || !(await isParticipant(conversationId, userId))) {
    throw new ChatError("Conversa inexistente.");
  }
}

/**
 * Pagina de mensagens: as mais recentes primeiro, paginando para tras com
 * `before` (id exclusivo). Traz tambem o nome do outro participante para o
 * cabecalho sem consulta extra.
 */
export async function listMessages(
  me: number,
  conversationId: number,
  before = 0,
  limit = 40,
): Promise<{ messages: ChatMessage[]; other: { id: number; name: string; username: string } }> {
  await assertParticipant(conversationId, me);
  const outra = await one<{ id: number; name: string; username: string }>(
    `SELECT u.id, u.name, u.username FROM chat_conversations c
       JOIN users u ON u.id = CASE WHEN c.user_low = ? THEN c.user_high ELSE c.user_low END
      WHERE c.id = ?`,
    [me, conversationId],
  );
  const lim = Math.min(Math.max(Number(limit) || 40, 1), 80);
  const messages = await all<ChatMessage>(
    `SELECT m.* FROM chat_messages m
      WHERE m.conversation_id = ? AND m.id < ? ORDER BY m.id DESC LIMIT ?`,
    [conversationId, before || Number.MAX_SAFE_INTEGER, lim],
  );
  return { messages: messages.reverse(), other: outra! };
}

export type NewMessage = {
  conversationId?: number;
  otherUserId?: number;
  body?: string | null;
  files?: (File | null)[] | null;
  audio?: File | null;
  audioSeconds?: number | null;
  clientDurationMs?: number | null;
};

/**
 * Envia uma mensagem (texto, audio ou arquivos).
 * Texto e anexos podem coexistir; arquivos viram uma mensagem por arquivo.
 */
export async function sendMessage(me: SessionUser, input: NewMessage): Promise<ChatMessage[]> {
  const conversationId = input.conversationId
    ? Number(input.conversationId)
    : await ensureConversation(me.id, Number(input.otherUserId));
  await assertParticipant(conversationId, me.id);

  const texto = String(input.body ?? "").slice(0, MAX_BODY).trim();
  const audio = input.audio && input.audio.size > 0 ? input.audio : null;
  const arquivos = (input.files ?? []).filter((f): f is File => !!f && f.size > 0);

  if (!texto && !audio && !arquivos.length) throw new ChatError("Mensagem vazia.");

  const criadas: ChatMessage[] = [];

  if (audio) {
    const salvo = await saveChatAttachment(audio, {
      esperado: "audio/*",
      maxBytes: 1_500_000,
      tipo: "audio",
      audioSeconds: input.audioSeconds ?? null,
    });
    criadas.push(await gravar(conversationId, me.id, {
      body: null,
      kind: "audio",
      file_id: salvo.id,
      file_name: salvo.name,
      file_mime: salvo.mime,
      file_size: salvo.size,
      audio_seconds: salvo.audioSeconds ?? null,
      duration_ms: Math.min(Math.max(Number(input.clientDurationMs) || 0, 0), 600000) || null,
    }));
  }

  for (const f of arquivos) {
    const salvo = await saveChatAttachment(f, { maxBytes: 1_500_000 });
    criadas.push(await gravar(conversationId, me.id, {
      body: null,
      kind: salvo.mime.startsWith("image/") ? "image" : "file",
      file_id: salvo.id,
      file_name: salvo.name,
      file_mime: salvo.mime,
      file_size: salvo.size,
    }));
  }

  if (texto) {
    // uma unica mensagem de texto: anexos individuais vao separado
    criadas.push(await gravar(conversationId, me.id, { body: texto, kind: "text" }));
  }

  await notificarDestinatario(conversationId, me, criadas[criadas.length - 1]);
  return criadas;
}

async function gravar(
  conversationId: number,
  senderId: number,
  campos: Partial<ChatMessage> & { body: string | null; kind: string },
): Promise<ChatMessage> {
  const id = await insert(
    `INSERT INTO chat_messages
       (conversation_id, sender_id, body, kind, file_id, file_name, file_mime, file_size,
        audio_seconds, duration_ms)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      conversationId,
      senderId,
      campos.body,
      campos.kind,
      campos.file_id ?? null,
      campos.file_name ?? null,
      campos.file_mime ?? null,
      campos.file_size ?? null,
      campos.audio_seconds ?? null,
      campos.duration_ms ?? null,
    ],
  );
  // O anexo/ audio ja foi gravado na tabela files antes deste INSERT; se o
  // processo morrer entre os dois, sobra apenas um blob orfao, sem efeito
  // funcional — o mesmo trade-off aceito no resto do sistema (uploads.ts).
  return (await one<ChatMessage>(`SELECT * FROM chat_messages WHERE id = ?`, [id]))!;
}

/**
 * Notificacao na central existente + push, reutilizando user_notifications
 * e a fila do push-scheduler. Titulo so com o nome do remetente — o conteudo
 * da mensagem nao vaza para a tela de bloqueio.
 */
async function notificarDestinatario(conversationId: number, remetente: SessionUser, msg: ChatMessage) {
  const destino = await one<{ user_id: number; last_read: number }>(
    `SELECT user_id, last_read_message_id AS last_read FROM chat_participants
      WHERE conversation_id = ? AND user_id <> ?`,
    [conversationId, remetente.id],
  );
  if (!destino) return;

  const link = `/chat?c=${conversationId}`;
  const title = `Nova mensagem de ${remetente.name}`;
  const preview =
    msg.kind === "audio" ? "Mensagem de audio" :
    msg.kind === "image" ? "Imagem" :
    msg.kind === "file" ? `Arquivo: ${msg.file_name ?? ""}` :
    (msg.body ?? "").slice(0, 140);

  await batch([
    {
      sql: `INSERT INTO user_notifications (user_id, event_id, type, title, body, link, created_at)
            VALUES (?,?,?,?,?,?,unixepoch())
            ON CONFLICT(user_id,event_id) DO NOTHING`,
      params: [destino.user_id, null, "chat", title, preview, link],
    },
    // a fila de push pega apenas notificacoes novas de chat (event_id nulo);
    // este gatilho leve evita duplicar quando o mesmo par reabre a conversa
    {
      sql: `INSERT INTO push_deliveries (notification_id, subscription_id)
            SELECT n.id, s.id FROM user_notifications n
            JOIN push_subscriptions s ON s.user_id = n.user_id AND s.enabled = 1
            WHERE n.id = (SELECT MAX(id) FROM user_notifications WHERE user_id = ? AND type = 'chat' AND link = ?)
              AND s.expiration_time IS NULL
            ON CONFLICT(notification_id,subscription_id) DO NOTHING`,
      params: [destino.user_id, link],
    },
  ]);
}

/* ------------------------------- leitura -------------------------------- */

/** Cursor de leitura atual do participante. */
export async function lastReadOf(conversationId: number, userId: number): Promise<number> {
  const p = await one<{ last_read_message_id: number }>(
    `SELECT last_read_message_id FROM chat_participants WHERE conversation_id = ? AND user_id = ?`,
    [conversationId, userId],
  );
  return p?.last_read_message_id ?? 0;
}

/** Marca como lidas as mensagens do outro usuario ate `upTo` (id incluso). */
export async function markRead(me: number, conversationId: number, upTo?: number) {
  await assertParticipant(conversationId, me);
  const maximo =
    upTo ??
    (await scalar<number>(`SELECT COALESCE(MAX(id),0) FROM chat_messages WHERE conversation_id = ?`, [conversationId]));
  await run(
    `UPDATE chat_participants SET last_read_message_id = ?
      WHERE conversation_id = ? AND user_id = ? AND last_read_message_id < ?`,
    [maximo, conversationId, me, maximo],
  );
  // consome as notificacoes internas desta conversa que ficaram para tras
  await run(
    `UPDATE user_notifications SET read_at = unixepoch()
      WHERE user_id = ? AND read_at IS NULL AND link = ?`,
    [me, `/chat?c=${conversationId}`],
  );
}

/* ----------------------------- exclui mensagem --------------------------- */

/** Exclusao logica: o texto some para todos, o registro permanece. */
export async function deleteMessage(me: number, messageId: number) {
  const m = await one<{ id: number; conversation_id: number; sender_id: number; deleted_at: string | null }>(
    `SELECT id, conversation_id, sender_id, deleted_at FROM chat_messages WHERE id = ?`,
    [messageId],
  );
  if (!m) throw new ChatError("Mensagem inexistente.");
  if (m.sender_id !== me) throw new ChatError("Somente o remetente pode excluir a mensagem.");
  if (m.deleted_at) return;
  await run(
    `UPDATE chat_messages SET deleted_at = (datetime('now','localtime')), body = NULL,
        file_id = NULL, audio_seconds = NULL, duration_ms = NULL
      WHERE id = ?`,
    [m.id],
  );
}

/* ------------------------- incremental / agregados ----------------------- */

/** Quantas conversas tem mensagem nao lida para mim (sino do chat). */
export async function unreadConversations(me: number): Promise<number> {
  return await scalar<number>(
    `SELECT COUNT(*) FROM chat_participants p
      WHERE p.user_id = ? AND p.last_read_message_id < (
        SELECT COALESCE(MAX(id),0) FROM chat_messages m
         WHERE m.conversation_id = p.conversation_id AND m.sender_id <> p.user_id)`,
    [me],
  );
}

/** Total de mensagens nao lidas (badge numerico). */
export async function unreadMessages(me: number): Promise<number> {
  return await scalar<number>(
    `SELECT (SELECT COUNT(*) FROM chat_messages m
              JOIN chat_participants p ON p.conversation_id = m.conversation_id AND p.user_id = ?
              WHERE m.id > p.last_read_message_id AND m.sender_id <> ?)`,
    [me, me],
  );
}

/** Estado incremental: mensagens novas desde `after` + contadores. */
export async function stateSince(me: number, conversationId: number, after: number) {
  const participantes = await isParticipant(conversationId, me);
  if (!participantes) throw new ChatError("Conversa inexistente.");
  const mensagens = await all<ChatMessage>(
    `SELECT * FROM chat_messages WHERE conversation_id = ? AND id > ? ORDER BY id LIMIT 60`,
    [conversationId, after],
  );
  return {
    messages: mensagens,
    readCursor: await lastReadOf(conversationId, me),
    unreadConversations: await unreadConversations(me),
    unreadMessages: await unreadMessages(me),
  };
}

/** Alteracoes na lista de conversas desde uma versao (soma de ids + contagem). */
export async function conversationsSnapshot(me: number) {
  const lista = await listConversations(me);
  return {
    conversations: lista,
    stamp: lista.reduce((s, c) => s + c.last_message_id * 31 + c.unread, 0) + lista.length,
  };
}
