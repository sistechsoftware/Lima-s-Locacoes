import Link from "next/link";
import { all, scalar } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { ACTIVE_STATUSES } from "@/lib/domain";
import { addDays, dateBR, endOfMonth, money, startOfMonth, startOfWeek, today } from "@/lib/format";
import { Card, Empty, PageHeader, Section, Stat } from "@/components/ui";
import { Tabs } from "@/components/List";

export const dynamic = "force-dynamic";
const ACTIVE = ACTIVE_STATUSES.map((s) => `'${s}'`).join(",");

function periodo(nome: string, de?: string, ate?: string) {
  const d0 = today();
  switch (nome) {
    case "hoje":
      return { de: d0, ate: d0, label: "Hoje" };
    case "semana":
      return { de: startOfWeek(d0), ate: addDays(startOfWeek(d0), 6), label: "Esta semana" };
    case "ano":
      return { de: `${d0.slice(0, 4)}-01-01`, ate: `${d0.slice(0, 4)}-12-31`, label: "Este ano" };
    case "personalizado":
      return { de: de || startOfMonth(d0), ate: ate || endOfMonth(d0), label: "Periodo personalizado" };
    default:
      return { de: startOfMonth(d0), ate: endOfMonth(d0), label: "Este mes" };
  }
}

export default async function RelatoriosPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; de?: string; ate?: string }>;
}) {
  await requireUser();
  const sp = await searchParams;
  const p = sp.p ?? "mes";
  const { de, ate, label } = periodo(p, sp.de, sp.ate);

  /* financeiro */
  const recebido = await scalar<number>(`SELECT COALESCE(SUM(amount_cents),0) FROM payments WHERE paid_at BETWEEN ? AND ?`, [de, ate]);
  const faturado = await scalar<number>(
    `SELECT COALESCE(SUM(total_cents),0) FROM reservations WHERE event_date BETWEEN ? AND ? AND status IN (${ACTIVE})`,
    [de, ate],
  );
  const fretes = await scalar<number>(
    `SELECT COALESCE(SUM(amount_cents),0) FROM freights WHERE date BETWEEN ? AND ? AND status = 'concluido'`,
    [de, ate],
  );
  const despesas = await scalar<number>(`SELECT COALESCE(SUM(amount_cents),0) FROM expenses WHERE date BETWEEN ? AND ?`, [de, ate]);
  const aReceber = await scalar<number>(
    `SELECT COALESCE(SUM(r.total_cents - COALESCE((SELECT SUM(pa.amount_cents) FROM payments pa WHERE pa.reservation_id = r.id),0)),0)
       FROM reservations r WHERE r.status IN (${ACTIVE}) AND r.event_date BETWEEN ? AND ?`,
    [de, ate],
  );

  /* operacional */
  const locacoes = await scalar<number>(
    `SELECT COUNT(*) FROM reservations WHERE event_date BETWEEN ? AND ? AND status <> 'cancelada'`,
    [de, ate],
  );
  const canceladas = await scalar<number>(
    `SELECT COUNT(*) FROM reservations WHERE event_date BETWEEN ? AND ? AND status = 'cancelada'`,
    [de, ate],
  );
  const opCount = async (kind: string) =>
    await scalar<number>(
      `SELECT COUNT(*) FROM operations WHERE kind = ? AND substr(scheduled_at,1,10) BETWEEN ? AND ? AND status <> 'cancelada'`,
      [kind, de, ate],
    );
  const fretesQtd = await scalar<number>(`SELECT COUNT(*) FROM freights WHERE date BETWEEN ? AND ? AND status <> 'cancelado'`, [de, ate]);

  /* produtos */
  const produtos = await all<any>(
    `SELECT p.id, p.name, COALESCE(SUM(i.qty),0) AS unidades, COUNT(DISTINCT r.id) AS reservas,
            COALESCE(SUM(i.subtotal_cents),0) AS receita
       FROM products p
       LEFT JOIN reservation_items i ON i.product_id = p.id
       LEFT JOIN reservations r ON r.id = i.reservation_id AND r.status <> 'cancelada'
                                AND r.event_date BETWEEN ? AND ?
      GROUP BY p.id ORDER BY unidades DESC`,
    [de, ate],
  );

  /* clientes */
  const melhores = await all<any>(
    `SELECT c.id, c.name, COUNT(r.id) AS locacoes, COALESCE(SUM(r.total_cents),0) AS total
       FROM customers c JOIN reservations r ON r.customer_id = c.id
      WHERE r.status IN (${ACTIVE}) AND r.event_date BETWEEN ? AND ?
      GROUP BY c.id ORDER BY total DESC LIMIT 10`,
    [de, ate],
  );
  const recorrentes = await all<any>(
    `SELECT c.id, c.name, COUNT(r.id) AS locacoes FROM customers c JOIN reservations r ON r.customer_id = c.id
      WHERE r.status <> 'cancelada' GROUP BY c.id HAVING COUNT(r.id) >= 2 ORDER BY locacoes DESC LIMIT 10`,
  );
  const inativos = await all<any>(
    `SELECT c.id, c.name, MAX(r.event_date) AS ultima FROM customers c JOIN reservations r ON r.customer_id = c.id
      WHERE r.status <> 'cancelada' GROUP BY c.id HAVING MAX(r.event_date) < ? ORDER BY ultima LIMIT 10`,
    [addDays(today(), -90)],
  );

  /* faturamento por mes (12 meses) */
  const meses = await all<any>(
    `SELECT substr(event_date,1,7) AS mes, COUNT(*) AS reservas, COALESCE(SUM(total_cents),0) AS total
       FROM reservations WHERE status IN (${ACTIVE}) GROUP BY mes ORDER BY mes DESC LIMIT 12`,
  );
  const maxMes = Math.max(1, ...meses.map((m) => m.total));

  return (
    <div className="space-y-4">
      <PageHeader title="Relatorios" subtitle={`${label}: ${dateBR(de)} ate ${dateBR(ate)}`} />

      <Tabs
        items={[
          { value: "hoje", label: "Hoje" },
          { value: "semana", label: "Semana" },
          { value: "mes", label: "Mes" },
          { value: "ano", label: "Ano" },
          { value: "personalizado", label: "Personalizado" },
        ]}
        current={p}
        base="/relatorios"
        param="p"
      />

      {p === "personalizado" && (
        <Card>
          <form className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="p" value="personalizado" />
            <label className="min-w-[8rem] flex-1">
              <span className="rotulo">De</span>
              <input type="date" name="de" defaultValue={de} className="campo" />
            </label>
            <label className="min-w-[8rem] flex-1">
              <span className="rotulo">Ate</span>
              <input type="date" name="ate" defaultValue={ate} className="campo" />
            </label>
            <button className="rounded-xl bg-carvao-900 px-5 py-2.5 text-sm font-semibold text-white">Aplicar</button>
          </form>
        </Card>
      )}

      <div>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-stone-500">Financeiro</h2>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Faturamento" value={money(faturado + fretes)} />
          <Stat label="Locacoes" value={money(faturado)} />
          <Stat label="Fretes" value={money(fretes)} />
          <Stat label="Recebido" value={money(recebido)} tone="verde" />
          <Stat label="Despesas" value={money(despesas)} tone="vermelho" />
          <Stat
            label="Lucro estimado"
            value={money(faturado + fretes - despesas)}
            tone={faturado + fretes - despesas >= 0 ? "verde" : "vermelho"}
          />
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-stone-500">Operacional</h2>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Locacoes" value={locacoes} />
          <Stat label="Canceladas" value={canceladas} />
          <Stat label="Entregas" value={await opCount("entrega")} />
          <Stat label="Retiradas" value={await opCount("retirada")} />
          <Stat label="Montagens" value={await opCount("montagem")} />
          <Stat label="Fretes" value={fretesQtd} />
        </div>
        <p className="mt-2 text-xs text-stone-500">A receber no periodo: {money(aReceber)}.</p>
      </div>

      <Section title="Faturamento por mes">
        {meses.length === 0 ? (
          <Empty>Sem dados suficientes.</Empty>
        ) : (
          <ul className="space-y-2">
            {meses.map((m) => (
              <li key={m.mes}>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold text-carvao-900">{m.mes}</span>
                  <span className="text-stone-500">
                    {m.reservas} reserva(s) - <b className="text-carvao-900">{money(m.total)}</b>
                  </span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-areia-200">
                  <div className="h-full bg-terra-500" style={{ width: `${(m.total / maxMes) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Produtos mais alugados no periodo">
          {produtos.filter((x) => x.unidades > 0).length === 0 ? (
            <Empty>Nenhuma locacao no periodo.</Empty>
          ) : (
            <ul className="divide-y divide-areia-200">
              {produtos
                .filter((x) => x.unidades > 0)
                .slice(0, 10)
                .map((x) => (
                  <li key={x.id} className="flex items-center justify-between py-2 text-sm">
                    <Link href={`/estoque/${x.id}`} className="min-w-0 truncate text-terra-600">
                      {x.name}
                    </Link>
                    <span className="shrink-0 text-right">
                      <b className="text-carvao-900">{x.unidades} un.</b>
                      <span className="block text-xs text-stone-500">{money(x.receita)}</span>
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </Section>

        <Section title="Produtos menos alugados">
          <ul className="divide-y divide-areia-200">
            {produtos
              .slice()
              .sort((a, b) => a.unidades - b.unidades)
              .slice(0, 10)
              .map((x) => (
                <li key={x.id} className="flex items-center justify-between py-2 text-sm">
                  <Link href={`/estoque/${x.id}`} className="min-w-0 truncate text-terra-600">
                    {x.name}
                  </Link>
                  <span className="shrink-0 text-stone-500">{x.unidades} un.</span>
                </li>
              ))}
          </ul>
        </Section>

        <Section title="Melhores clientes do periodo">
          {melhores.length === 0 ? (
            <Empty>Sem dados no periodo.</Empty>
          ) : (
            <ul className="divide-y divide-areia-200">
              {melhores.map((c) => (
                <li key={c.id} className="flex items-center justify-between py-2 text-sm">
                  <Link href={`/clientes/${c.id}`} className="min-w-0 truncate text-terra-600">
                    {c.name}
                  </Link>
                  <span className="shrink-0 text-right">
                    <b className="text-carvao-900">{money(c.total)}</b>
                    <span className="block text-xs text-stone-500">{c.locacoes} locacao(oes)</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Clientes recorrentes">
          {recorrentes.length === 0 ? (
            <Empty>Nenhum cliente com duas ou mais locacoes.</Empty>
          ) : (
            <ul className="divide-y divide-areia-200">
              {recorrentes.map((c) => (
                <li key={c.id} className="flex items-center justify-between py-2 text-sm">
                  <Link href={`/clientes/${c.id}`} className="min-w-0 truncate text-terra-600">
                    {c.name}
                  </Link>
                  <span className="shrink-0 text-stone-500">{c.locacoes} locacoes</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Clientes sem alugar ha mais de 90 dias">
          {inativos.length === 0 ? (
            <Empty>Nenhum cliente inativo.</Empty>
          ) : (
            <ul className="divide-y divide-areia-200">
              {inativos.map((c) => (
                <li key={c.id} className="flex items-center justify-between py-2 text-sm">
                  <Link href={`/clientes/${c.id}`} className="min-w-0 truncate text-terra-600">
                    {c.name}
                  </Link>
                  <span className="shrink-0 text-stone-500">ultima em {dateBR(c.ultima)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
