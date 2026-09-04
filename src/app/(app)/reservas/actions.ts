"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { all, insert, one, run, scalar, tx } from "@/lib/db";
import { nextNumber } from "@/lib/db";
import { assertAdmin, currentUser, requireUser } from "@/lib/auth";
import { logAction } from "@/lib/audit";
import { removeAttachment } from "@/lib/uploads";
import { recalcReservation, reservationMoney, syncOperations, getReservation, itemsSummary } from "@/lib/reservations";
import {
  checkConflicts,
  conflictsMessage,
  findOverbookings,
  holdWindow,
  rebuildReservationComponents,
  stamp,
} from "@/lib/stock";
import { HOLDING_STATUSES } from "@/lib/domain";
import { money, parseMoney, today } from "@/lib/format";

export type ItemInput = { product_id: number; qty: number; unit_price_cents: number; discount_cents: number };

function readItems(fd: FormData): ItemInput[] {
  try {
    const raw = JSON.parse(String(fd.get("items") ?? "[]"));
    return (Array.isArray(raw) ? raw : [])
      .map((i: any) => ({
        product_id: Number(i.product_id),
        qty: Math.max(0, Number(i.qty) || 0),
        unit_price_cents: Number(i.unit_price_cents) || 0,
        discount_cents: Number(i.discount_cents) || 0,
      }))
      .filter((i) => i.product_id && i.qty > 0);
  } catch {
    return [];
  }
}

function readHeader(fd: FormData) {
  const event_date = String(fd.get("event_date") ?? "").slice(0, 10);
  return {
    customer_id: Number(fd.get("customer_id")),
    event_date,
    event_time: String(fd.get("event_time") ?? ""),
    address: String(fd.get("address") ?? "").trim(),
    district: String(fd.get("district") ?? "").trim(),
    city: String(fd.get("city") ?? "").trim(),
    delivery_at: stamp(String(fd.get("delivery_at") ?? "") || event_date, "08:00"),
    pickup_at: stamp(String(fd.get("pickup_at") ?? "") || event_date, "18:00"),
    needs_delivery: fd.get("needs_delivery") ? 1 : 0,
    needs_pickup: fd.get("needs_pickup") ? 1 : 0,
    needs_assembly: fd.get("needs_assembly") ? 1 : 0,
    needs_disassembly: fd.get("needs_disassembly") ? 1 : 0,
    freight_cents: parseMoney(String(fd.get("freight") ?? "")),
    assembly_cents: parseMoney(String(fd.get("assembly") ?? "")),
    disassembly_cents: parseMoney(String(fd.get("disassembly") ?? "")),
    other_cents: parseMoney(String(fd.get("other") ?? "")),
    discount_cents: parseMoney(String(fd.get("discount") ?? "")),
    notes: String(fd.get("notes") ?? "").trim(),
    status: String(fd.get("status") ?? "pre_reserva"),
    deposit_cents: parseMoney(String(fd.get("deposit") ?? "")),
  };
}

const conflictMessage = conflictsMessage;

/**
 * Confere, apos gravar, se esta reserva estourou o estoque por causa de uma
 * gravacao concorrente. Se estourou, desfaz a propria reserva e devolve o
 * erro. Ver findOverbookings para o criterio de desempate.
 */
async function guardStock(reservationId: number, authorized: boolean): Promise<string | null> {
  if (authorized) return null;
  const excessos = await findOverbookings(reservationId);
  if (!excessos.length) return null;

  await run(`DELETE FROM reservation_items WHERE reservation_id = ?`, [reservationId]);
  await run(`DELETE FROM reservation_item_components WHERE reservation_id = ?`, [reservationId]);
  await run(`DELETE FROM deposits WHERE reservation_id = ?`, [reservationId]);
  await run(`DELETE FROM operations WHERE reservation_id = ?`, [reservationId]);
  await run(`DELETE FROM reservations WHERE id = ?`, [reservationId]);

  return (
    "ESTOQUE INSUFICIENTE. " +
    excessos
      .map((e) => `${e.product}: faltam ${e.excess} unidade(s) (outra reserva ocupou o estoque agora ha pouco).`)
      .join(" ") +
    " Refaca a operacao com as quantidades disponiveis."
  );
}

/* ------------------------------------------------------------------ */
/* Criacao                                                             */
/* ------------------------------------------------------------------ */

export async function createReservation(_prev: string | null, fd: FormData): Promise<string | null> {
  const user = await requireUser();
  const h = readHeader(fd);
  const items = readItems(fd);
  const override = fd.get("override") === "1";

  if (!h.customer_id) return "Selecione o cliente.";
  if (!h.event_date) return "Informe a data do evento.";
  if (!items.length) return "Adicione ao menos um item a reserva.";
  if (h.pickup_at < h.delivery_at) return "A retirada nao pode ser anterior a entrega.";

  const holds = (HOLDING_STATUSES as readonly string[]).includes(h.status);
  if (holds) {
    const conflicts = await checkConflicts(items, h.delivery_at, h.pickup_at);
    if (conflicts.length) {
      if (!override) return conflictMessage(conflicts);
      if (user.role !== "admin") return conflictMessage(conflicts) + " Somente o administrador pode prosseguir.";
    }
  }

  let id = 0;
  await tx(async () => {
    const number = await nextNumber("reservations", "LIMA");
    id = await insert(
      `INSERT INTO reservations
        (number, customer_id, status, event_date, event_time, address, district, city, delivery_at, pickup_at,
         needs_delivery, needs_pickup, needs_assembly, needs_disassembly,
         freight_cents, assembly_cents, disassembly_cents, other_cents, discount_cents, notes, stock_override, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        number,
        h.customer_id,
        h.status,
        h.event_date,
        h.event_time,
        h.address,
        h.district,
        h.city,
        h.delivery_at,
        h.pickup_at,
        h.needs_delivery,
        h.needs_pickup,
        h.needs_assembly,
        h.needs_disassembly,
        h.freight_cents,
        h.assembly_cents,
        h.disassembly_cents,
        h.other_cents,
        h.discount_cents,
        h.notes,
        override ? 1 : 0,
        user.id,
      ],
    );
    for (const i of items) {
      await insert(
        `INSERT INTO reservation_items (reservation_id, product_id, qty, unit_price_cents, discount_cents)
         VALUES (?,?,?,?,?)`,
        [id, i.product_id, i.qty, i.unit_price_cents, i.discount_cents],
      );
    }
    await insert(`INSERT INTO deposits (reservation_id, amount_cents, status) VALUES (?,?,'nao_recebida')`, [
      id,
      h.deposit_cents,
    ]);
    // expande kits nos componentes fisicos antes de qualquer calculo de estoque
    await rebuildReservationComponents(id);
    await recalcReservation(id);
    await syncOperations(id);
    await logAction(user, "criar", "reserva", id, `${user.name} criou a reserva ${number}`, { items: items.length });
  });

  const corrida = await guardStock(id, override && user.role === "admin");
  if (corrida) return corrida;

  revalidatePath("/reservas");
  revalidatePath("/dashboard");
  redirect(`/reservas/${id}`);
}

/* ------------------------------------------------------------------ */
/* Edicao                                                              */
/* ------------------------------------------------------------------ */

export async function updateReservation(_prev: string | null, fd: FormData): Promise<string | null> {
  const user = await requireUser();
  const id = Number(fd.get("id"));
  const h = readHeader(fd);
  const items = readItems(fd);
  const override = fd.get("override") === "1";

  const current = await one<any>(`SELECT * FROM reservations WHERE id = ?`, [id]);
  if (!current) return "Reserva nao encontrada.";
  if (!items.length) return "A reserva precisa ter ao menos um item.";
  if (h.pickup_at < h.delivery_at) return "A retirada nao pode ser anterior a entrega.";

  const holds = (HOLDING_STATUSES as readonly string[]).includes(h.status);
  if (holds) {
    const conflicts = await checkConflicts(items, h.delivery_at, h.pickup_at, id);
    if (conflicts.length) {
      if (!override) return conflictMessage(conflicts);
      if (user.role !== "admin") return conflictMessage(conflicts) + " Somente o administrador pode prosseguir.";
    }
  }

  await tx(async () => {
    await run(
      `UPDATE reservations SET customer_id=?, status=?, event_date=?, event_time=?, address=?, district=?, city=?,
              delivery_at=?, pickup_at=?, needs_delivery=?, needs_pickup=?, needs_assembly=?, needs_disassembly=?,
              freight_cents=?, assembly_cents=?, disassembly_cents=?, other_cents=?, discount_cents=?, notes=?,
              stock_override=?, updated_at=datetime('now','localtime')
        WHERE id = ?`,
      [
        h.customer_id,
        h.status,
        h.event_date,
        h.event_time,
        h.address,
        h.district,
        h.city,
        h.delivery_at,
        h.pickup_at,
        h.needs_delivery,
        h.needs_pickup,
        h.needs_assembly,
        h.needs_disassembly,
        h.freight_cents,
        h.assembly_cents,
        h.disassembly_cents,
        h.other_cents,
        h.discount_cents,
        h.notes,
        override ? 1 : current.stock_override,
        id,
      ],
    );
    await run(`DELETE FROM reservation_items WHERE reservation_id = ?`, [id]);
    for (const i of items) {
      await insert(
        `INSERT INTO reservation_items (reservation_id, product_id, qty, unit_price_cents, discount_cents)
         VALUES (?,?,?,?,?)`,
        [id, i.product_id, i.qty, i.unit_price_cents, i.discount_cents],
      );
    }
    const dep = await one<any>(`SELECT id FROM deposits WHERE reservation_id = ? ORDER BY id DESC LIMIT 1`, [id]);
    if (dep) await run(`UPDATE deposits SET amount_cents = ? WHERE id = ?`, [h.deposit_cents, dep.id]);
    else await insert(`INSERT INTO deposits (reservation_id, amount_cents, status) VALUES (?,?,'nao_recebida')`, [id, h.deposit_cents]);

    // regrava a expansao: alterar quantidade de kits ajusta o consumo fisico
    await rebuildReservationComponents(id);
    await recalcReservation(id);
    await syncOperations(id);
    await logAction(user, "editar", "reserva", id, `${user.name} alterou a reserva ${current.number}`);
  });

  revalidatePath(`/reservas/${id}`);
  redirect(`/reservas/${id}`);
}

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

export async function changeStatus(fd: FormData) {
  const user = await requireUser();
  const id = Number(fd.get("id"));
  const status = String(fd.get("status"));
  const r = await one<any>(`SELECT * FROM reservations WHERE id = ?`, [id]);
  if (!r) return;

  if (status === "cancelada" && user.role !== "admin") {
    redirect(`/reservas/${id}?erro=${encodeURIComponent("Somente o administrador pode cancelar reservas.")}`);
  }

  // ao voltar a ocupar estoque, revalida disponibilidade
  if ((HOLDING_STATUSES as readonly string[]).includes(status) && !(HOLDING_STATUSES as readonly string[]).includes(r.status)) {
    const items = await all<any>(`SELECT product_id, qty FROM reservation_items WHERE reservation_id = ?`, [id]);
    const w = holdWindow(r);
    const conflicts = await checkConflicts(items, w.from, w.to, id);
    if (conflicts.length && !r.stock_override) {
      redirect(`/reservas/${id}?erro=${encodeURIComponent(conflictMessage(conflicts))}`);
    }
  }

  await run(`UPDATE reservations SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?`, [status, id]);
  if (status === "cancelada") {
    await run(`UPDATE reservations SET cancel_reason = ? WHERE id = ?`, [String(fd.get("reason") ?? ""), id]);
  }
  // cancelar libera o estoque automaticamente: a reserva deixa de ocupar a
  // janela, e a expansao fisica deixa de ser contabilizada pelo motor.
  await syncOperations(id);
  await logAction(user, "status", "reserva", id, `${user.name} alterou o status da reserva ${r.number} para ${status}`);
  revalidatePath(`/reservas/${id}`);
  revalidatePath("/dashboard");
}

/* ------------------------------------------------------------------ */
/* Pagamentos e caucao                                                 */
/* ------------------------------------------------------------------ */

export async function addPayment(fd: FormData) {
  const user = await requireUser();
  const id = Number(fd.get("reservation_id"));
  const amount = parseMoney(String(fd.get("amount") ?? ""));
  if (amount <= 0) redirect(`/reservas/${id}?erro=${encodeURIComponent("Informe um valor valido.")}`);

  const r = await one<any>(`SELECT number FROM reservations WHERE id = ?`, [id]);
  await insert(
    `INSERT INTO payments (reservation_id, amount_cents, method, paid_at, notes, created_by) VALUES (?,?,?,?,?,?)`,
    [
      id,
      amount,
      String(fd.get("method") ?? "pix"),
      String(fd.get("paid_at") ?? "") || today(),
      String(fd.get("notes") ?? ""),
      user.id,
    ],
  );
  await logAction(user, "pagamento", "reserva", id, `${user.name} registrou pagamento de ${money(amount)} na reserva ${r?.number}`);
  revalidatePath(`/reservas/${id}`);
  revalidatePath("/financeiro");
}

export async function deletePayment(fd: FormData) {
  const user = await assertAdmin();
  const paymentId = Number(fd.get("payment_id"));
  const p = await one<any>(`SELECT * FROM payments WHERE id = ?`, [paymentId]);
  if (!p) return;
  await run(`DELETE FROM payments WHERE id = ?`, [paymentId]);
  await logAction(user, "excluir", "reserva", p.reservation_id, `${user.name} removeu um pagamento de ${money(p.amount_cents)}`);
  revalidatePath(`/reservas/${p.reservation_id}`);
}

export async function saveDeposit(fd: FormData) {
  const user = await requireUser();
  const id = Number(fd.get("reservation_id"));
  const amount = parseMoney(String(fd.get("amount") ?? ""));
  const status = String(fd.get("status") ?? "nao_recebida");
  const retained = parseMoney(String(fd.get("retained") ?? ""));
  const dep = await one<any>(`SELECT id FROM deposits WHERE reservation_id = ? ORDER BY id DESC LIMIT 1`, [id]);

  const values = [
    amount,
    String(fd.get("method") ?? ""),
    String(fd.get("received_at") ?? "") || null,
    String(fd.get("returned_at") ?? "") || null,
    status,
    status === "retida_integral" ? amount : retained,
    String(fd.get("reason") ?? ""),
  ];

  if (dep) {
    await run(
      `UPDATE deposits SET amount_cents=?, method=?, received_at=?, returned_at=?, status=?, retained_cents=?, reason=?
        WHERE id = ?`,
      [...values, dep.id],
    );
  } else {
    await insert(
      `INSERT INTO deposits (amount_cents, method, received_at, returned_at, status, retained_cents, reason, reservation_id)
       VALUES (?,?,?,?,?,?,?,?)`,
      [...values, id],
    );
  }
  await logAction(user, "caucao", "reserva", id, `${user.name} atualizou a caucao (${status})`);
  revalidatePath(`/reservas/${id}`);
}

/* ------------------------------------------------------------------ */
/* Exclusao                                                            */
/* ------------------------------------------------------------------ */

export async function deleteReservation(fd: FormData) {
  const user = await assertAdmin();
  const id = Number(fd.get("id"));
  const r = await one<any>(`SELECT number FROM reservations WHERE id = ?`, [id]);
  if (!r) redirect("/reservas");

  // O orcamento de origem aponta para a reserva sem ON DELETE CASCADE, entao
  // esse vinculo precisa ser desfeito antes, senao a chave estrangeira barra a
  // exclusao. O orcamento em si e preservado e volta a ficar como aprovado.
  const origem = await all<any>(`SELECT id, number FROM quotes WHERE reservation_id = ?`, [id]);
  for (const q of origem) {
    await run(`UPDATE quotes SET reservation_id = NULL, status = 'aprovado' WHERE id = ?`, [q.id]);
  }

  // anexos sao polimorficos (sem chave estrangeira), logo nao caem no cascade
  const anexos = await all<any>(
    `SELECT id FROM attachments WHERE entity = 'operacao' AND entity_id IN (SELECT id FROM operations WHERE reservation_id = ?)`,
    [id],
  );
  for (const a of anexos) await removeAttachment(a.id);
  const anexosDano = await all<any>(`SELECT id FROM attachments WHERE entity = 'dano' AND entity_id = ?`, [id]);
  for (const a of anexosDano) await removeAttachment(a.id);

  await run(`DELETE FROM reservations WHERE id = ?`, [id]);
  await logAction(
    user,
    "excluir",
    "reserva",
    id,
    `${user.name} excluiu definitivamente a reserva ${r.number}` +
      (origem.length ? ` (orcamento ${origem.map((q) => q.number).join(", ")} voltou para aprovado)` : ""),
  );

  revalidatePath("/reservas");
  revalidatePath("/orcamentos");
  redirect("/reservas");
}

/* ------------------------------------------------------------------ */
/* Consulta de disponibilidade usada pelo formulario                   */
/* ------------------------------------------------------------------ */

export async function checkStock(payload: {
  items: ItemInput[];
  from: string;
  to: string;
  excludeId?: number | null;
}) {
  await requireUser();
  const conflicts = await checkConflicts(payload.items, payload.from, payload.to, payload.excludeId ?? null);
  return conflicts.map((c) => ({
    product_id: c.product_id,
    product: c.product,
    kind: c.kind,
    requested: c.requested,
    available: c.available,
    missing: c.missing,
    components: c.components,
    holds: c.holds.map((h) => ({ number: h.number, customer: h.customer, qty: h.qty })),
  }));
}

/** Envia mensagem de WhatsApp: apenas registra no historico (o link abre no cliente). */
export async function logWhatsApp(fd: FormData) {
  const user = await currentUser();
  const id = Number(fd.get("reservation_id"));
  const kind = String(fd.get("kind") ?? "mensagem");
  await logAction(user, "whatsapp", "reserva", id, `${user?.name} enviou mensagem de ${kind} pelo WhatsApp`);
  revalidatePath(`/reservas/${id}`);
}
