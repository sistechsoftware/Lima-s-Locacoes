import Link from "next/link";
import { notFound } from "next/navigation";
import { all, one } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getOperation } from "@/lib/queries";
import { attachmentsFor } from "@/lib/uploads";
import { checklistFor } from "@/lib/checklists";
import { logsFor } from "@/lib/audit";
import { OPERATION_KINDS, OPERATION_STATUS, RESERVATION_STATUS } from "@/lib/domain";
import { dateBR, dateTimeBR, mapsLink, money, phoneBR, timeBR, waLink } from "@/lib/format";
import { Alerta, Badge, Card, Empty, LinkButton, PageHeader, Row, Section, StatusBadge } from "@/components/ui";
import { Icon } from "@/components/Icons";
import { SubmitButton } from "@/components/SubmitButton";
import ImageInput from "@/components/ImageInput";
import { cancelOperation, deletePhoto, reportDamage, saveChecklist, setOperationStatus, updateOperation } from "../actions";

export const dynamic = "force-dynamic";

export default async function OperacaoDetalhePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ erro?: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const { erro } = await searchParams;
  const op = await getOperation(Number(id));
  if (!op) notFound();

  const kind = OPERATION_KINDS.find((k) => k.value === op.kind)!;
  const itens = op.reservation_id
    ? await all<any>(
        `SELECT i.*, p.name AS product_name, p.id AS product_id FROM reservation_items i
           JOIN products p ON p.id = i.product_id WHERE i.reservation_id = ? ORDER BY p.name`,
        [op.reservation_id],
      )
    : [];
  const vehicles = await all<any>(`SELECT id, name FROM vehicles WHERE active = 1 ORDER BY name`);
  const checklist = await one<any>(`SELECT * FROM checklists WHERE operation_id = ? ORDER BY id DESC LIMIT 1`, [op.id]);
  const marcados: Record<string, boolean> = checklist ? JSON.parse(checklist.data) : {};
  const fotos = await attachmentsFor("operacao", op.id);
  const itensChecklist = checklistFor(op.kind);
  const danos = op.reservation_id
    ? await all<any>(
        `SELECT d.*, p.name AS product_name FROM damage_reports d LEFT JOIN products p ON p.id = d.product_id
          WHERE d.reservation_id = ? ORDER BY d.id DESC`,
        [op.reservation_id],
      )
    : [];
  const historico = (await logsFor("operacao", op.id)).slice(0, 10);

  const maps = mapsLink(op.address, op.district, op.city);
  const wa = waLink(
    op.whatsapp || op.phone,
    `Ola, ${(op.customer ?? "").split(" ")[0]}! Sobre a ${kind.label.toLowerCase()} de hoje as ${timeBR(op.scheduled_at)}.`,
  );
  const ehRetirada = op.kind === "retirada" || op.kind === "desmontagem";

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${kind.icon} ${kind.label}`}
        subtitle={`${dateBR(op.scheduled_at)} as ${timeBR(op.scheduled_at)} - ${op.customer ?? "sem cliente"}`}
        action={
          op.reservation_id ? <LinkButton href={`/reservas/${op.reservation_id}`}>Ver reserva</LinkButton> : undefined
        }
      />

      {erro && <Alerta tone="vermelho" title="Nao foi possivel concluir">{erro}</Alerta>}

      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge defs={OPERATION_STATUS} value={op.status} />
          {op.reservation_status && <StatusBadge defs={RESERVATION_STATUS} value={op.reservation_status} />}
          {op.reservation_number && <Badge tone="cinza">{op.reservation_number}</Badge>}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {["confirmada", "em_rota", "no_local", "concluida"].map((s) => (
            <form key={s} action={setOperationStatus}>
              <input type="hidden" name="id" value={op.id} />
              <input type="hidden" name="status" value={s} />
              <SubmitButton
                variant={s === "concluida" ? "sucesso" : op.status === s ? "escuro" : "secundario"}
                className="w-full px-2 text-xs sm:text-sm"
              >
                {OPERATION_STATUS.find((x) => x.value === s)!.label}
              </SubmitButton>
            </form>
          ))}
        </div>

        <div className="mt-2 flex flex-wrap gap-2">
          <form action={setOperationStatus}>
            <input type="hidden" name="id" value={op.id} />
            <input type="hidden" name="status" value="reagendada" />
            <SubmitButton variant="secundario" className="px-3 py-2 text-xs">
              Reagendar
            </SubmitButton>
          </form>
          {user.role === "admin" && (
            <form action={cancelOperation}>
              <input type="hidden" name="id" value={op.id} />
              <SubmitButton variant="perigo" confirm="Cancelar esta operacao?" className="px-3 py-2 text-xs">
                Cancelar operacao
              </SubmitButton>
            </form>
          )}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {maps && (
            <a
              href={maps}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-xl bg-carvao-900 px-4 py-2.5 text-sm font-semibold text-white"
            >
              <Icon name="operacao" className="h-4 w-4" /> Abrir rota
            </a>
          )}
          {wa && (
            <a
              href={wa}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white"
            >
              <Icon name="whatsapp" className="h-4 w-4" /> WhatsApp
            </a>
          )}
          {op.phone && (
            <a
              href={`tel:${op.phone}`}
              className="inline-flex items-center gap-2 rounded-xl border border-areia-300 bg-white px-4 py-2.5 text-sm font-semibold"
            >
              Ligar
            </a>
          )}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Dados da operacao">
          <Row label="Cliente" value={op.customer ?? "-"} />
          <Row label="Telefone" value={phoneBR(op.phone) || "-"} />
          <Row label="Endereco" value={[op.address, op.district, op.city].filter(Boolean).join(", ") || "-"} />
          <Row label="Agendada para" value={dateTimeBR(op.scheduled_at)} />
          <Row label="Responsavel" value={op.assignee || "-"} />
          <Row label="Veiculo" value={op.vehicle_name || "-"} />
          <Row label="Concluida em" value={op.completed_at ? dateTimeBR(op.completed_at) : "-"} />
          {op.notes && <Row label="Observacoes" value={op.notes} />}
          {op.reservation_notes && <Row label="Obs. da reserva" value={op.reservation_notes} />}

          <form action={updateOperation} className="mt-3 grid grid-cols-2 gap-2">
            <input type="hidden" name="id" value={op.id} />
            <label className="block">
              <span className="rotulo">Reagendar para</span>
              <input
                name="scheduled_at"
                type="datetime-local"
                defaultValue={op.scheduled_at.slice(0, 16)}
                className="campo"
              />
            </label>
            <label className="block">
              <span className="rotulo">Responsavel</span>
              <input name="assignee" defaultValue={op.assignee ?? ""} className="campo" />
            </label>
            <label className="block">
              <span className="rotulo">Veiculo</span>
              <select name="vehicle_id" defaultValue={op.vehicle_id ?? ""} className="campo">
                <option value="">Sem veiculo</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="rotulo">Observacoes</span>
              <input name="notes" defaultValue={op.notes ?? ""} className="campo" />
            </label>
            <div className="col-span-2">
              <SubmitButton variant="secundario" className="w-full">
                Salvar alteracoes
              </SubmitButton>
            </div>
          </form>
        </Section>

        <Section title={`Itens (${itens.length})`}>
          {itens.length === 0 ? (
            <Empty>Operacao sem itens vinculados.</Empty>
          ) : (
            <ul className="divide-y divide-areia-200">
              {itens.map((i) => (
                <li key={i.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="font-semibold text-carvao-900">
                    {i.qty} x {i.product_name}
                  </span>
                  <span className="text-stone-500">{money(i.subtotal_cents)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Section title={`Checklist de ${ehRetirada ? "retirada" : "entrega"}`}>
        <form action={saveChecklist} className="space-y-3">
          <input type="hidden" name="operation_id" value={op.id} />
          <div className="space-y-1.5">
            {itensChecklist.map((item) => (
              <label
                key={item}
                className="flex items-center gap-3 rounded-xl border border-areia-300 bg-white px-3 py-3 text-sm font-medium"
              >
                <input
                  type="checkbox"
                  name={`chk:${item}`}
                  defaultChecked={!!marcados[item]}
                  className="h-5 w-5 accent-[#A85C42]"
                />
                {item}
              </label>
            ))}
          </div>
          <label className="block">
            <span className="rotulo">Observacoes do checklist</span>
            <textarea name="notes" rows={3} defaultValue={checklist?.notes ?? ""} className="campo" />
          </label>
          <label className="block">
            <span className="rotulo">Anexar fotos</span>
            <ImageInput name="photos" multiple capture="environment" />
          </label>
          <SubmitButton className="w-full">Salvar checklist</SubmitButton>
        </form>

        {fotos.length > 0 && (
          <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {fotos.map((f) => (
              <div key={f.id} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.path} alt={f.caption ?? "Foto"} className="h-24 w-full rounded-xl object-cover" />
                <form action={deletePhoto} className="absolute right-1 top-1">
                  <input type="hidden" name="attachment_id" value={f.id} />
                  <input type="hidden" name="operation_id" value={op.id} />
                  <SubmitButton variant="perigo" confirm="Remover esta foto?" className="px-2 py-0.5 text-[0.65rem]">
                    x
                  </SubmitButton>
                </form>
              </div>
            ))}
          </div>
        )}
      </Section>

      {ehRetirada && op.reservation_id && (
        <Section title="Registrar dano">
          <Alerta tone="ambar">
            Danos com valor cobrado sao descontados automaticamente da caucao da reserva.
          </Alerta>
          <form action={reportDamage} className="mt-3 grid grid-cols-2 gap-2">
            <input type="hidden" name="operation_id" value={op.id} />
            <input type="hidden" name="reservation_id" value={op.reservation_id} />
            <label className="col-span-2 block">
              <span className="rotulo">Equipamento</span>
              <select name="product_id" className="campo">
                <option value="">Selecione...</option>
                {itens.map((i) => (
                  <option key={i.product_id} value={i.product_id}>
                    {i.product_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="rotulo">Quantidade</span>
              <input name="qty" type="number" min={1} defaultValue={1} className="campo" />
            </label>
            <label className="block">
              <span className="rotulo">Tipo de dano</span>
              <input name="damage_type" className="campo" placeholder="Quebra, mancha, falta..." />
            </label>
            <label className="block">
              <span className="rotulo">Valor estimado (R$)</span>
              <input name="estimated" inputMode="decimal" className="campo" />
            </label>
            <label className="block">
              <span className="rotulo">Descontar da caucao (R$)</span>
              <input name="charged" inputMode="decimal" className="campo" />
            </label>
            <label className="col-span-2 block">
              <span className="rotulo">Descricao</span>
              <textarea name="description" rows={2} className="campo" />
            </label>
            <label className="col-span-2 block">
              <span className="rotulo">Foto do dano</span>
              <ImageInput name="photo" capture="environment" />
            </label>
            <div className="col-span-2">
              <SubmitButton variant="perigo" className="w-full">
                Registrar dano
              </SubmitButton>
            </div>
          </form>

          {danos.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {danos.map((d) => (
                <li key={d.id} className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">
                  {d.qty}x {d.product_name} - {d.damage_type || "dano"} - estimado {money(d.estimated_cents)}
                  {d.charged_cents > 0 ? `, descontado ${money(d.charged_cents)}` : ""}
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {historico.length > 0 && (
        <Section title="Historico">
          <ul className="space-y-1.5 text-sm">
            {historico.map((h: any) => (
              <li key={h.id} className="flex gap-2 text-stone-600">
                <span className="shrink-0 text-xs text-stone-400">{h.created_at}</span>
                <span>{h.summary}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <p className="text-center">
        <Link href="/operacao" className="text-sm font-semibold text-terra-600">
          Voltar para operacao
        </Link>
      </p>
    </div>
  );
}
