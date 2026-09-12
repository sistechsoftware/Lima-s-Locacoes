import { all, scalar } from "@/lib/db";
import { RESERVATION_SELECT, itemsForReservations } from "@/lib/reservations";
import {
  PERIODOS_RESERVA,
  STATUS_PADRAO,
  dataEfetiva,
  indiceProximaReserva,
  janelaDeUmDia,
  periodoValido,
  reservasFiltro,
} from "@/lib/reservas-lista";
import { RESERVATION_STATUS } from "@/lib/domain";
import { dateBR, money, today } from "@/lib/format";
import { Badge, Empty, LinkButton, PageHeader, StatusBadge } from "@/components/ui";
import { ListRow, Pagination, SearchForm, Tabs } from "@/components/List";
import { ReservationItems } from "@/components/ReservationItems";

export const dynamic = "force-dynamic";
const PER_PAGE = 20;

export default async function ReservasPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; periodo?: string; data?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const status = sp.status ?? "";
  const periodo = periodoValido(sp.periodo);
  const hoje = today();
  const data = dataEfetiva(periodo, sp.data, hoje);
  const page = Math.max(1, Number(sp.page ?? 1));
  const diaUnico = janelaDeUmDia(periodo);

  // Filtro padrao da tela (hoje + confirmadas) e qualquer combinacao escolhida
  // pelo usuario saem daqui: apenas WHERE/ORDER BY da consulta ja existente.
  const { where, params, orderBy } = reservasFiltro({ q, status, periodo, data, hoje });

  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = await scalar<number>(
    `SELECT COUNT(*) FROM reservations r JOIN customers c ON c.id = r.customer_id ${clause}`,
    params,
  );
  const rows = await all<any>(
    `${RESERVATION_SELECT} ${clause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    [...params, PER_PAGE, (page - 1) * PER_PAGE],
  );

  // itens de todas as reservas da pagina em duas consultas, nao uma por cartao
  const itensPorReserva = await itemsForReservations(rows.map((r) => r.id));

  // Destaque visual da proxima confirmada a ser utilizada (nao altera dados).
  const idxProxima = indiceProximaReserva(rows, { porHorario: diaUnico, statusFiltrado: status });

  const base = `/reservas?${new URLSearchParams({
    ...(q ? { q } : {}),
    ...(status ? { status } : {}),
    periodo,
    ...(diaUnico && periodo === "dia" && sp.data && /^\d{4}-\d{2}-\d{2}$/.test(sp.data) ? { data: sp.data } : {}),
  }).toString()}`;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Reservas"
        subtitle={`${total} reserva(s)`}
        action={<LinkButton href="/reservas/nova" variant="primario">+ Nova Reserva</LinkButton>}
      />

      <SearchForm action="/reservas" placeholder="LIMA-001, cliente, endereço…" defaultValue={q} hidden={{ periodo, ...(periodo === "dia" ? { data } : {}) }}>
        {/* min-w-0: dentro do flex do SearchForm, deixa o select encolher no
            celular sem empurrar o campo de busca para fora da tela */}
        <select name="status" defaultValue={status} className="campo min-w-[9rem] basis-36 sm:w-auto">
          <option value="">Todos os status</option>
          {RESERVATION_STATUS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </SearchForm>

      <Tabs items={PERIODOS_RESERVA} current={periodo} base={base} param="periodo" />

      {periodo === "dia" && (
        <form action="/reservas" className="pilha-filtros">
          <input type="hidden" name="periodo" value="dia" />
          {status && <input type="hidden" name="status" value={status} />}
          <label className="min-w-0 flex-1 basis-40">
            <span className="rotulo">Data do evento</span>
            <input type="date" name="data" defaultValue={data} className="campo data-hora" />
          </label>
          <button className="w-full rounded-xl bg-marca-600 px-4 py-2.5 text-sm font-semibold text-white sm:w-auto">
            Ver data
          </button>
        </form>
      )}

      {rows.length === 0 ? (
        <Empty>Nenhuma reserva encontrada.</Empty>
      ) : (
        <div className="space-y-2">
          {rows.map((r, i) => {
            const saldo = r.total_cents - r.paid_cents;
            const proxima = i === idxProxima;
            return (
              <ListRow
                key={r.id}
                href={`/reservas/${r.id}`}
                badges={
                  <>
                    {proxima && (
                      <Badge tone="terracota" className="nao-imprimir">
                        ⏱ PRÓXIMA RESERVA
                      </Badge>
                    )}
                    <StatusBadge defs={RESERVATION_STATUS} value={r.status} />
                    {saldo > 0 && r.status !== "cancelada" && <Badge tone="vermelho">Saldo {money(saldo)}</Badge>}
                    {saldo <= 0 && r.total_cents > 0 && <Badge tone="verde">Pago</Badge>}
                  </>
                }
                title={`${r.number} - ${r.customer_name}`}
                subtitle={`${dateBR(r.event_date)}${r.event_time ? ` às ${r.event_time}` : ""}`}
                meta={[r.address, r.district].filter(Boolean).join(", ")}
                right={<p className="text-sm font-bold">{money(r.total_cents)}</p>}
                body={<ReservationItems items={itensPorReserva.get(r.id) ?? []} />}
              />
            );
          })}
        </div>
      )}

      <Pagination
        page={page}
        total={total}
        perPage={PER_PAGE}
        build={(p) =>
          `/reservas?${new URLSearchParams({
            ...(q ? { q } : {}),
            ...(status ? { status } : {}),
            periodo,
            ...(periodo === "dia" ? { data } : {}),
            page: String(p),
          }).toString()}`
        }
      />
    </div>
  );
}
