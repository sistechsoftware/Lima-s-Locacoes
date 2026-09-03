import Link from "next/link";
import { notFound } from "next/navigation";
import { all } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { logsFor } from "@/lib/audit";
import {
  getReservation,
  itemsSummary,
  reservationItems,
  reservationMoney,
  reservationOperations,
} from "@/lib/reservations";
import { messagesForReservation } from "@/lib/whatsapp";
import { checkConflicts, holdWindow } from "@/lib/stock";
import {
  CONTRACT_STATUS,
  DEPOSIT_STATUS,
  OPERATION_KINDS,
  OPERATION_STATUS,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABEL,
  RESERVATION_FLOW,
  RESERVATION_STATUS,
  paymentState,
  statusLabel,
} from "@/lib/domain";
import { dateBR, dateTimeBR, mapsLink, money, phoneBR, timeBR, today } from "@/lib/format";
import { Alerta, Badge, Card, Empty, LinkButton, PageHeader, Row, Section, Stat, StatusBadge } from "@/components/ui";
import { Icon } from "@/components/Icons";
import { SubmitButton } from "@/components/SubmitButton";
import { addPayment, changeStatus, deletePayment, deleteReservation, saveDeposit } from "../actions";
import { generateContract } from "../../contratos/actions";

export const dynamic = "force-dynamic";

export default async function ReservaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ erro?: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const { erro } = await searchParams;
  const r = await getReservation(Number(id));
  if (!r) notFound();

  const items = await reservationItems(r.id);
  const m = await reservationMoney(r.id);
  const ops = await reservationOperations(r.id);
  const payments = await all<any>(`SELECT * FROM payments WHERE reservation_id = ? ORDER BY paid_at DESC, id DESC`, [r.id]);
  const contracts = await all<any>(`SELECT * FROM contracts WHERE reservation_id = ? ORDER BY id DESC`, [r.id]);
  const damages = await all<any>(
    `SELECT d.*, p.name AS product_name FROM damage_reports d LEFT JOIN products p ON p.id = d.product_id
      WHERE d.reservation_id = ? ORDER BY d.id DESC`,
    [r.id],
  );
  const historico = await logsFor("reserva", r.id);
  const pay = paymentState(m.total, m.paid);
  const resumo = await itemsSummary(r.id);
  const mensagens = await messagesForReservation(r, resumo, m.balance);
  const maps = mapsLink(r.address, r.district, r.city);

  const w = holdWindow(r);
  const conflicts =
    r.status !== "cancelada"
      ? await checkConflicts(
          items.map((i) => ({ product_id: i.product_id, qty: i.qty })),
          w.from,
          w.to,
          r.id,
        )
      : [];

  const flowIndex = (RESERVATION_FLOW as readonly string[]).indexOf(r.status);
  const proximo = flowIndex >= 0 && flowIndex < RESERVATION_FLOW.length - 1 ? RESERVATION_FLOW[flowIndex + 1] : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title={r.number}
        subtitle={`${r.customer_name} - evento em ${dateBR(r.event_date)}${r.event_time ? ` as ${r.event_time}` : ""}`}
        action={
          <>
            <LinkButton href={`/reservas/${r.id}/editar`}>Editar</LinkButton>
            <LinkButton href={`/clientes/${r.customer_id}`}>Cliente</LinkButton>
          </>
        }
      />

      {erro && <Alerta tone="vermelho" title="Nao foi possivel concluir">{erro}</Alerta>}

      {conflicts.length > 0 && (
        <Alerta tone="vermelho" title="Conflito de estoque nesta reserva">
          <ul className="mt-1 space-y-0.5 text-xs">
            {conflicts.map((c) => (
              <li key={c.product_id}>
                <b>{c.product}</b>: reservados {c.requested}, disponivel {c.available} (faltam {c.missing}).
              </li>
            ))}
          </ul>
          {r.stock_override ? (
            <p className="mt-1 text-xs font-semibold">Autorizado manualmente pelo administrador.</p>
          ) : (
            <p className="mt-1 text-xs font-semibold">Ajuste as quantidades ou as datas para resolver.</p>
          )}
        </Alerta>
      )}

      {/* status e fluxo */}
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge defs={RESERVATION_STATUS} value={r.status} />
          <Badge tone={pay.tone}>Pagamento: {pay.label}</Badge>
          <Badge tone={m.depositStatus === "recebida" ? "verde" : "ambar"}>
            Caucao: {statusLabel(DEPOSIT_STATUS, m.depositStatus)}
          </Badge>
          {r.contract_status && (
            <Badge tone={r.contract_status === "assinado" ? "verde" : "ambar"}>
              Contrato: {statusLabel(CONTRACT_STATUS, r.contract_status)}
            </Badge>
          )}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {proximo && r.status !== "cancelada" && (
            <form action={changeStatus}>
              <input type="hidden" name="id" value={r.id} />
              <input type="hidden" name="status" value={proximo} />
              <SubmitButton variant="sucesso">
                Avancar para: {statusLabel(RESERVATION_STATUS, proximo)}
              </SubmitButton>
            </form>
          )}
          <form action={changeStatus} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="id" value={r.id} />
            <select name="status" defaultValue={r.status} className="campo w-auto">
              {RESERVATION_STATUS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <SubmitButton variant="secundario">Alterar status</SubmitButton>
          </form>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat label="Total" value={money(m.total)} />
        <Stat label="Pago" value={money(m.paid)} tone="verde" />
        <Stat label="Saldo" value={money(m.balance)} tone={m.balance > 0 ? "vermelho" : "verde"} />
        <Stat label="Caucao" value={money(m.deposit)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Dados da reserva">
          <Row label="Cliente" value={<Link href={`/clientes/${r.customer_id}`} className="text-terra-600">{r.customer_name}</Link>} />
          <Row label="Telefone" value={phoneBR(r.customer_phone) || "-"} />
          <Row label="Data do evento" value={`${dateBR(r.event_date)}${r.event_time ? ` as ${r.event_time}` : ""}`} />
          <Row label="Endereco" value={[r.address, r.district, r.city].filter(Boolean).join(", ") || "-"} />
          <Row label="Entrega" value={dateTimeBR(r.delivery_at)} />
          <Row label="Retirada" value={dateTimeBR(r.pickup_at)} />
          <Row
            label="Servicos"
            value={
              [
                r.needs_delivery && "entrega",
                r.needs_pickup && "retirada",
                r.needs_assembly && "montagem",
                r.needs_disassembly && "desmontagem",
              ]
                .filter(Boolean)
                .join(", ") || "-"
            }
          />
          {r.notes && <Row label="Observacoes" value={r.notes} />}
          {r.cancel_reason && <Row label="Motivo do cancelamento" value={r.cancel_reason} />}

          {maps && (
            <a
              href={maps}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-2 rounded-xl border border-areia-300 bg-white px-4 py-2.5 text-sm font-semibold"
            >
              <Icon name="operacao" className="h-4 w-4" /> Abrir rota no Google Maps
            </a>
          )}
        </Section>

        <Section title={`Itens (${items.length})`}>
          {items.length === 0 ? (
            <Empty>Nenhum item.</Empty>
          ) : (
            <ul className="divide-y divide-areia-200">
              {items.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-carvao-900">
                      {i.qty} x {i.product_name}
                    </span>
                    <span className="block text-xs text-stone-500">
                      {money(i.unit_price_cents)} cada
                      {i.discount_cents > 0 ? ` - desconto ${money(i.discount_cents)}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-bold">{money(i.subtotal_cents)}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 space-y-1 rounded-xl bg-areia-100 p-3 text-sm">
            <Row label="Produtos" value={money(r.items_cents)} />
            <Row label="Frete" value={money(r.freight_cents)} />
            <Row label="Montagem" value={money(r.assembly_cents)} />
            <Row label="Desmontagem" value={money(r.disassembly_cents)} />
            <Row label="Outros" value={money(r.other_cents)} />
            <Row label="Desconto" value={"- " + money(r.discount_cents)} />
            <div className="flex items-center justify-between pt-1 text-base font-bold">
              <span>Total</span>
              <span>{money(r.total_cents)}</span>
            </div>
          </div>
        </Section>
      </div>

      {/* operacoes */}
      <Section
        title="Agenda operacional"
        action={<Link href="/operacao" className="text-xs font-semibold text-terra-600">ver operacao</Link>}
      >
        {ops.length === 0 ? (
          <Empty>Nenhuma operacao agendada. Marque entrega, retirada ou montagem ao editar a reserva.</Empty>
        ) : (
          <div className="space-y-2">
            {ops.map((o) => {
              const kind = OPERATION_KINDS.find((k) => k.value === o.kind)!;
              return (
                <Link
                  key={o.id}
                  href={`/operacao/${o.id}`}
                  className="flex items-center gap-3 rounded-xl border border-areia-300 bg-white p-3"
                >
                  <span className="text-lg">{kind.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-carvao-900">
                      {kind.label} - {dateBR(o.scheduled_at)} {timeBR(o.scheduled_at)}
                    </span>
                    <span className="block text-xs text-stone-500">
                      {o.assignee ? `Responsavel: ${o.assignee}` : "Sem responsavel definido"}
                      {o.vehicle_name ? ` - ${o.vehicle_name}` : ""}
                    </span>
                  </span>
                  <StatusBadge defs={OPERATION_STATUS} value={o.status} />
                </Link>
              );
            })}
          </div>
        )}
      </Section>

      {/* financeiro */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Pagamentos">
          <form action={addPayment} className="grid grid-cols-2 gap-2">
            <input type="hidden" name="reservation_id" value={r.id} />
            <input name="amount" placeholder="Valor (R$)" inputMode="decimal" className="campo" required />
            <input name="paid_at" type="date" defaultValue={today()} className="campo" />
            <select name="method" className="campo">
              {PAYMENT_METHODS.map((mth) => (
                <option key={mth} value={mth}>
                  {PAYMENT_METHOD_LABEL[mth]}
                </option>
              ))}
            </select>
            <input name="notes" placeholder="Observacao" className="campo" />
            <div className="col-span-2">
              <SubmitButton className="w-full">Registrar pagamento</SubmitButton>
            </div>
          </form>

          <div className="mt-3">
            {payments.length === 0 ? (
              <Empty>Nenhum pagamento registrado.</Empty>
            ) : (
              <ul className="divide-y divide-areia-200">
                {payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 py-2">
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{money(p.amount_cents)}</span>
                      <span className="block text-xs text-stone-500">
                        {dateBR(p.paid_at)} - {PAYMENT_METHOD_LABEL[p.method] ?? p.method}
                        {p.notes ? ` - ${p.notes}` : ""}
                      </span>
                    </span>
                    {user.role === "admin" && (
                      <form action={deletePayment}>
                        <input type="hidden" name="payment_id" value={p.id} />
                        <SubmitButton variant="perigo" confirm="Remover este pagamento?" className="px-2.5 py-1.5 text-xs">
                          Remover
                        </SubmitButton>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2 flex items-center justify-between rounded-xl bg-areia-100 px-3 py-2 text-sm font-bold">
              <span>Saldo</span>
              <span className={m.balance > 0 ? "text-red-600" : "text-emerald-600"}>{money(m.balance)}</span>
            </div>
          </div>
        </Section>

        <Section title="Caucao">
          <form action={saveDeposit} className="grid grid-cols-2 gap-2">
            <input type="hidden" name="reservation_id" value={r.id} />
            <label className="col-span-2 block">
              <span className="rotulo">Valor da caucao</span>
              <input name="amount" defaultValue={(m.deposit / 100).toFixed(2)} inputMode="decimal" className="campo" />
            </label>
            <label className="block">
              <span className="rotulo">Forma recebida</span>
              <select name="method" className="campo" defaultValue="pix">
                {PAYMENT_METHODS.map((mth) => (
                  <option key={mth} value={mth}>
                    {PAYMENT_METHOD_LABEL[mth]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="rotulo">Status</span>
              <select name="status" defaultValue={m.depositStatus} className="campo">
                {DEPOSIT_STATUS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="rotulo">Recebida em</span>
              <input name="received_at" type="date" className="campo" />
            </label>
            <label className="block">
              <span className="rotulo">Devolvida em</span>
              <input name="returned_at" type="date" className="campo" />
            </label>
            <label className="block">
              <span className="rotulo">Valor retido</span>
              <input name="retained" defaultValue={(m.depositRetained / 100).toFixed(2)} inputMode="decimal" className="campo" />
            </label>
            <label className="block">
              <span className="rotulo">Motivo da retencao</span>
              <input name="reason" className="campo" placeholder="Ex.: 2 cadeiras quebradas" />
            </label>
            <div className="col-span-2">
              <SubmitButton className="w-full">Salvar caucao</SubmitButton>
            </div>
          </form>

          {damages.length > 0 && (
            <div className="mt-3">
              <h3 className="mb-1.5 text-xs font-bold uppercase text-stone-500">Danos registrados</h3>
              <ul className="space-y-1 text-sm">
                {damages.map((d) => (
                  <li key={d.id} className="rounded-lg bg-red-50 px-3 py-2 text-red-800">
                    {d.qty}x {d.product_name} - {d.damage_type ?? "dano"} - estimado {money(d.estimated_cents)}
                    {d.charged_cents > 0 ? `, descontado ${money(d.charged_cents)}` : ""}
                    {d.description ? <span className="block text-xs opacity-80">{d.description}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>
      </div>

      {/* contrato e whatsapp */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Contrato / termo de responsabilidade">
          {contracts.length === 0 ? (
            <>
              <p className="mb-3 text-sm text-stone-500">
                Nenhum contrato gerado. O documento e montado automaticamente com os dados desta reserva.
              </p>
              <form action={generateContract}>
                <input type="hidden" name="reservation_id" value={r.id} />
                <SubmitButton>Gerar contrato</SubmitButton>
              </form>
            </>
          ) : (
            <div className="space-y-2">
              {contracts.map((c) => (
                <Link
                  key={c.id}
                  href={`/contratos/${c.id}`}
                  className="flex items-center justify-between gap-2 rounded-xl border border-areia-300 bg-white p-3"
                >
                  <span>
                    <span className="block text-sm font-bold">{c.number}</span>
                    <span className="block text-xs text-stone-500">Gerado em {dateBR(c.created_at)}</span>
                  </span>
                  <StatusBadge defs={CONTRACT_STATUS} value={c.status} />
                </Link>
              ))}
            </div>
          )}
        </Section>

        <Section title="Mensagens de WhatsApp">
          {r.customer_whatsapp || r.customer_phone ? (
            <div className="space-y-2">
              {mensagens.map((msg) => (
                <a
                  key={msg.key}
                  href={msg.href ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm font-semibold text-emerald-800"
                >
                  <Icon name="whatsapp" className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block">{msg.label}</span>
                    <span className="block truncate text-xs font-normal opacity-80">{msg.text}</span>
                  </span>
                </a>
              ))}
            </div>
          ) : (
            <Empty>Cliente sem telefone cadastrado.</Empty>
          )}
        </Section>
      </div>

      {historico.length > 0 && (
        <Section title="Historico da reserva">
          <ul className="space-y-1.5 text-sm">
            {historico.slice(0, 20).map((h: any) => (
              <li key={h.id} className="flex gap-2 text-stone-600">
                <span className="shrink-0 text-xs text-stone-400">{h.created_at}</span>
                <span>{h.summary}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {user.role === "admin" && (
        <Card className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-carvao-900">Area do administrador</p>
            <p className="text-xs text-stone-500">
              Prefira cancelar a reserva: o cancelamento preserva o historico e libera o estoque.
            </p>
          </div>
          <form action={deleteReservation}>
            <input type="hidden" name="id" value={r.id} />
            <SubmitButton
              variant="perigo"
              confirm={`Excluir definitivamente a reserva ${r.number} e todos os seus pagamentos? Esta acao nao pode ser desfeita.`}
            >
              Excluir reserva
            </SubmitButton>
          </form>
        </Card>
      )}
    </div>
  );
}
