import "server-only";
import { insert, nextNumber, one } from "./db";
import { getSettings, renderTemplate } from "./settings";
import { getReservation, reservationItems, reservationMoney } from "./reservations";
import { dateBR, docBR, money, phoneBR } from "./format";

/** Monta o texto do contrato a partir do modelo configurado e dos dados da reserva. */
export async function buildContractBody(reservationId: number, contractNumber: string): Promise<string> {
  const s = await getSettings();
  const r = await getReservation(reservationId);
  if (!r) throw new Error("Reserva nao encontrada");
  const items = await reservationItems(reservationId);
  const m = await reservationMoney(reservationId);

  const itensTexto = items
    .map((i) => `- ${i.qty} x ${i.product_name} .......... ${money(i.subtotal_cents)}`)
    .join("\n");

  return renderTemplate(s.contract_template, {
    empresa: s.company_name,
    cnpj: s.company_doc || "-",
    endereco_empresa: s.company_address || "-",
    telefone_empresa: phoneBR(s.company_phone) || "-",
    cidade_empresa: s.company_city || "-",
    cliente: r.customer_name,
    cliente_doc: docBR(r.customer_doc) || "-",
    cliente_telefone: phoneBR(r.customer_phone) || "-",
    cliente_endereco: [r.address, r.district, r.city].filter(Boolean).join(", ") || "-",
    contrato: contractNumber,
    reserva: r.number,
    data_evento: dateBR(r.event_date),
    endereco_evento: [r.address, r.district, r.city].filter(Boolean).join(", ") || "-",
    itens: itensTexto,
    data_entrega: r.delivery_at ? dateBR(r.delivery_at) + " " + (r.delivery_at.slice(11, 16) || "") : "-",
    data_retirada: r.pickup_at ? dateBR(r.pickup_at) + " " + (r.pickup_at.slice(11, 16) || "") : "-",
    valor_itens: money(r.items_cents),
    valor_frete: money(r.freight_cents),
    valor_montagem: money(r.assembly_cents),
    valor_desmontagem: money(r.disassembly_cents),
    valor_outros: money(r.other_cents),
    valor_desconto: money(r.discount_cents),
    valor_total: money(r.total_cents),
    valor_caucao: money(m.deposit),
    data_hoje: new Date().toLocaleDateString("pt-BR"),
  });
}

/** Cria o contrato da reserva (ou devolve o existente). */
export async function ensureContract(reservationId: number, userId?: number): Promise<number> {
  const existing = await one<any>(
    `SELECT id FROM contracts WHERE reservation_id = ? AND status <> 'cancelado' ORDER BY id DESC LIMIT 1`,
    [reservationId],
  );
  if (existing) return existing.id;
  const number = await nextNumber("contracts", "CTR");
  const body = await buildContractBody(reservationId, number);
  return await insert(
    `INSERT INTO contracts (number, reservation_id, status, body, created_by) VALUES (?,?,'pendente',?,?)`,
    [number, reservationId, body, userId ?? null],
  );
}
