import Link from "next/link";
import { all, scalar } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { ACTIVE_STATUSES, EXPENSE_CATEGORIES, PAYMENT_METHODS, PAYMENT_METHOD_LABEL } from "@/lib/domain";
import { dateBR, endOfMonth, money, startOfMonth, today } from "@/lib/format";
import { Badge, Card, Empty, PageHeader, Section, Stat } from "@/components/ui";
import { Tabs } from "@/components/List";
import { listarEntries, totaisEntries } from "@/lib/receber";
import { situacaoParcela } from "@/lib/financeiro";
import { receberParcela } from "./receber-actions";
import { payEntry } from "../compras/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { addExpense, deleteExpense } from "./actions";

export const dynamic = "force-dynamic";

const ACTIVE = ACTIVE_STATUSES.map((s) => `'${s}'`).join(",");

export default async function FinanceiroPage({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string; de?: string; ate?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const aba = sp.aba ?? "resumo";
  const de = sp.de || startOfMonth(today());
  const ate = sp.ate || endOfMonth(today());

  /* leituras independentes: uma latencia so em vez de cinco */
  const [entradas, saidas, aReceber, caucaoRetida, reservas] = await Promise.all([
    all<any>(
    `SELECT p.*, r.number AS reservation_number, c.name AS customer_name, f.number AS freight_number
       FROM payments p
       LEFT JOIN reservations r ON r.id = p.reservation_id
       LEFT JOIN customers c ON c.id = r.customer_id
       LEFT JOIN freights f ON f.id = p.freight_id
      WHERE p.paid_at BETWEEN ? AND ? ORDER BY p.paid_at DESC, p.id DESC`,
      [de, ate],
    ),
    all<any>(
    `SELECT e.*, r.number AS reservation_number FROM expenses e
       LEFT JOIN reservations r ON r.id = e.reservation_id
      WHERE e.date BETWEEN ? AND ? ORDER BY e.date DESC, e.id DESC`,
      [de, ate],
    ),
    all<any>(
    `SELECT r.id, r.number, r.event_date, r.total_cents, c.name AS customer_name,
            COALESCE((SELECT SUM(p.amount_cents) FROM payments p WHERE p.reservation_id = r.id),0) AS paid
       FROM reservations r JOIN customers c ON c.id = r.customer_id
      WHERE r.status IN (${ACTIVE})
        AND r.total_cents > COALESCE((SELECT SUM(p.amount_cents) FROM payments p WHERE p.reservation_id = r.id),0)
        ORDER BY r.event_date`,
    ),
    scalar<number>(
      `SELECT COALESCE(SUM(retained_cents),0) FROM deposits WHERE status IN ('retida_parcial','retida_integral')`,
    ),
    all<any>(
      `SELECT r.id, r.number, c.name AS customer_name FROM reservations r JOIN customers c ON c.id = r.customer_id
        WHERE r.status <> 'cancelada' ORDER BY r.id DESC LIMIT 100`,
    ),
  ]);

  const [parcelasReceber, parcelasPagar, totReceber, totPagar, contasAtivas] = await Promise.all([
    listarEntries({ direction: "receber", situacao: "todas" }),
    listarEntries({ direction: "pagar", situacao: "todas" }),
    totaisEntries("receber"),
    totaisEntries("pagar"),
    all<any>(`SELECT id, name FROM financial_accounts WHERE active = 1 ORDER BY name`),
  ]);

  const totalEntradas = entradas.reduce((s, e) => s + e.amount_cents, 0);
  const totalSaidas = saidas.reduce((s, e) => s + e.amount_cents, 0);
  const totalReceber = aReceber.reduce((s, r) => s + (r.total_cents - r.paid), 0);

  const porMetodo = PAYMENT_METHODS.map((m) => ({
    method: m,
    total: entradas.filter((e) => e.method === m).reduce((s, e) => s + e.amount_cents, 0),
  })).filter((x) => x.total > 0);

  const porCategoria = EXPENSE_CATEGORIES.map((c) => ({
    category: c,
    total: saidas.filter((e) => e.category === c).reduce((s, e) => s + e.amount_cents, 0),
  })).filter((x) => x.total > 0);

  return (
    <div className="space-y-4">
      <PageHeader title="Financeiro" subtitle={`${dateBR(de)} ate ${dateBR(ate)}`} />

      <Card>
        <form className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="aba" value={aba} />
          <label className="min-w-[8rem] flex-1">
            <span className="rotulo">De</span>
            <input type="date" name="de" defaultValue={de} className="campo" />
          </label>
          <label className="min-w-[8rem] flex-1">
            <span className="rotulo">Ate</span>
            <input type="date" name="ate" defaultValue={ate} className="campo" />
          </label>
          <button className="rounded-xl bg-marca-600 px-5 py-2.5 text-sm font-semibold text-white">Filtrar</button>
        </form>
      </Card>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat label="Entradas" value={money(totalEntradas)} tone="verde" />
        <Stat label="Saidas" value={money(totalSaidas)} tone="vermelho" />
        <Stat label="Resultado" value={money(totalEntradas - totalSaidas)} tone={totalEntradas - totalSaidas >= 0 ? "verde" : "vermelho"} />
        <Stat label="A receber (total)" value={money(totalReceber)} tone={totalReceber > 0 ? "vermelho" : "verde"} />
      </div>

      <Tabs
        items={[
          { value: "resumo", label: "Resumo" },
          { value: "entradas", label: "Entradas", count: entradas.length },
          { value: "saidas", label: "Saidas", count: saidas.length },
          { value: "receber", label: "A receber", count: parcelasReceber.filter((p) => p.situacao !== "quitada").length },
          { value: "pagar", label: "A pagar", count: parcelasPagar.filter((p) => p.situacao !== "quitada").length },
        ]}
        current={aba}
        base={`/financeiro?de=${de}&ate=${ate}`}
      />

      {aba === "resumo" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Section title="Entradas por forma de pagamento">
            {porMetodo.length === 0 ? (
              <Empty>Nenhuma entrada no periodo.</Empty>
            ) : (
              <ul className="divide-y divide-nuvem-200">
                {porMetodo.map((m) => (
                  <li key={m.method} className="flex items-center justify-between py-2 text-sm">
                    <span>{PAYMENT_METHOD_LABEL[m.method]}</span>
                    <span className="font-bold text-emerald-600">{money(m.total)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="Saidas por categoria">
            {porCategoria.length === 0 ? (
              <Empty>Nenhuma saida no periodo.</Empty>
            ) : (
              <ul className="divide-y divide-nuvem-200">
                {porCategoria.map((c) => (
                  <li key={c.category} className="flex items-center justify-between py-2 text-sm">
                    <span>{c.category}</span>
                    <span className="font-bold text-red-600">{money(c.total)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="Caucoes">
            <p className="text-sm text-stone-600">
              Total retido por danos ate hoje: <b className="text-tinta-900">{money(caucaoRetida)}</b>
            </p>
            <p className="mt-1 text-xs text-stone-500">
              A caucao nao entra no faturamento: e devolvida ao cliente, exceto na parte retida.
            </p>
          </Section>
        </div>
      )}

      {aba === "entradas" && (
        <Section title={`Entradas (${entradas.length})`}>
          {entradas.length === 0 ? (
            <Empty>Nenhuma entrada no periodo.</Empty>
          ) : (
            <ul className="divide-y divide-nuvem-200">
              {entradas.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-tinta-900">
                      {e.customer_name ?? e.notes ?? "Entrada"}
                    </p>
                    <p className="text-xs text-stone-500">
                      {dateBR(e.paid_at)} - {PAYMENT_METHOD_LABEL[e.method] ?? e.method}
                      {e.reservation_number ? ` - ` : ""}
                      {e.reservation_number && (
                        <Link href={`/reservas/${e.reservation_id}`} className="text-marca-600">
                          {e.reservation_number}
                        </Link>
                      )}
                      {e.freight_number ? ` - ${e.freight_number}` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 font-bold text-emerald-600">{money(e.amount_cents)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {aba === "saidas" && (
        <div className="space-y-4">
          <Section title="Lancar saida">
            <form action={addExpense} className="grid grid-cols-2 gap-2">
              <input name="date" type="date" defaultValue={today()} className="campo" />
              <select name="category" className="campo">
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <input name="description" placeholder="Descricao" className="campo col-span-2" />
              <input name="amount" placeholder="Valor (R$)" inputMode="decimal" className="campo" required />
              <select name="method" className="campo">
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHOD_LABEL[m]}
                  </option>
                ))}
              </select>
              <select name="reservation_id" className="campo col-span-2">
                <option value="">Sem reserva vinculada</option>
                {reservas.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.number} - {r.customer_name}
                  </option>
                ))}
              </select>
              <div className="col-span-2">
                <SubmitButton className="w-full">Lancar saida</SubmitButton>
              </div>
            </form>
          </Section>

          <Section title={`Saidas (${saidas.length})`}>
            {saidas.length === 0 ? (
              <Empty>Nenhuma saida no periodo.</Empty>
            ) : (
              <ul className="divide-y divide-nuvem-200">
                {saidas.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-tinta-900">
                        {e.category}
                        {e.description ? ` - ${e.description}` : ""}
                      </p>
                      <p className="text-xs text-stone-500">
                        {dateBR(e.date)} - {PAYMENT_METHOD_LABEL[e.method] ?? e.method}
                        {e.reservation_number ? ` - ${e.reservation_number}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="font-bold text-red-600">{money(e.amount_cents)}</span>
                      {user.role === "admin" && (
                        <form action={deleteExpense}>
                          <input type="hidden" name="id" value={e.id} />
                          <SubmitButton variant="perigo" confirm="Remover esta saida?" className="px-2 py-1 text-xs">
                            x
                          </SubmitButton>
                        </form>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}

      {(aba === "receber" || aba === "pagar") && (
        <ListaParcelas
          direcao={aba}
          parcelas={aba === "receber" ? parcelasReceber : parcelasPagar}
          totais={aba === "receber" ? totReceber : totPagar}
          contas={contasAtivas}
        />
      )}

    </div>
  );
}

const TOM: Record<string, "verde" | "ambar" | "vermelho" | "cinza"> = {
  quitada: "verde",
  parcial: "ambar",
  vencida: "vermelho",
  aberta: "cinza",
  cancelada: "cinza",
};

/**
 * Parcelas previstas de uma direcao.
 *
 * Previsto e realizado ficam lado a lado de proposito: o total contratado nao
 * e dinheiro em caixa, e a tela precisa deixar isso obvio.
 */
function ListaParcelas({
  direcao,
  parcelas,
  totais,
  contas,
}: {
  direcao: "receber" | "pagar";
  parcelas: any[];
  totais: { previsto: number; liquidado: number; saldo: number; atrasado: number };
  contas: { id: number; name: string }[];
}) {
  const receber = direcao === "receber";
  const abertas = parcelas.filter((p) => p.situacao !== "quitada" && p.situacao !== "cancelada");
  const acao = receber ? receberParcela : payEntry;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat label={receber ? "Contratado" : "Previsto"} value={money(totais.previsto)} />
        <Stat label={receber ? "Recebido" : "Pago"} value={money(totais.liquidado)} tone="verde" />
        <Stat
          label={receber ? "A receber" : "A pagar"}
          value={money(totais.saldo)}
          tone={totais.saldo > 0 ? "vermelho" : "verde"}
        />
        <Stat label="Vencido" value={money(totais.atrasado)} tone={totais.atrasado > 0 ? "vermelho" : undefined} />
      </div>

      <Section title={`${receber ? "Contas a receber" : "Contas a pagar"} (${abertas.length} em aberto)`}>
        {abertas.length === 0 ? (
          <Empty>
            {receber
              ? "Nenhuma parcela a receber. Gere o parcelamento na tela da reserva ou do frete."
              : "Nenhuma parcela a pagar. As parcelas aparecem aqui quando voce registra uma compra."}
          </Empty>
        ) : (
          <ul className="space-y-2">
            {abertas.map((p) => (
              <li key={p.id} className="rounded-xl border border-nuvem-300 bg-white p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold text-tinta-900">{p.description}</span>
                    <span className="block text-xs text-stone-500">
                      {p.number} - vence {dateBR(p.due_date)}
                      {p.installments_total > 1 ? ` - ${p.installment}/${p.installments_total}` : ""}
                      {p.customer_name ? ` - ${p.customer_name}` : ""}
                      {p.supplier_name ? ` - ${p.supplier_name}` : ""}
                    </span>
                    {p.liquidado_cents > 0 && (
                      <span className="block text-xs text-stone-500">
                        {receber ? "Recebido" : "Pago"} {money(p.liquidado_cents)}, faltam {money(p.saldo_cents)}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-sm font-bold">{money(p.amount_cents)}</span>
                    <Badge tone={TOM[p.situacao]}>{p.situacao}</Badge>
                  </span>
                </div>

                <form action={acao} className="mt-2 grid grid-cols-2 gap-2">
                  <input type="hidden" name="entry_id" value={p.id} />
                  <input
                    name="amount"
                    defaultValue={(p.saldo_cents / 100).toFixed(2)}
                    inputMode="decimal"
                    className="campo"
                    aria-label="Valor"
                  />
                  <input name="paid_at" type="date" defaultValue={today()} className="campo" />
                  <select name="method" className="campo">
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {PAYMENT_METHOD_LABEL[m]}
                      </option>
                    ))}
                  </select>
                  <select name="account_id" defaultValue={p.account_id ?? ""} className="campo">
                    <option value="">Conta...</option>
                    {contas.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <div className="col-span-2">
                    <SubmitButton className="w-full">
                      {receber ? "Registrar recebimento" : "Registrar pagamento"}
                    </SubmitButton>
                  </div>
                </form>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-stone-500">
          O caixa registra apenas o valor efetivamente movimentado, nunca o total contratado de uma vez.
        </p>
      </Section>
    </div>
  );
}
