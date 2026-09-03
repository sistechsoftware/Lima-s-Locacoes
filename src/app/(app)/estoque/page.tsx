import Link from "next/link";
import { all } from "@/lib/db";
import { availabilityAll } from "@/lib/stock";
import { money, today } from "@/lib/format";
import { Badge, Empty, LinkButton, PageHeader, Stat } from "@/components/ui";
import { Tabs } from "@/components/List";

export const dynamic = "force-dynamic";

export default async function EstoquePage({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const aba = sp.aba ?? "todos";
  const d0 = today();
  const disponibilidade = await availabilityAll(`${d0}T00:00`, `${d0}T23:59`);
  const produtos = await all<any>(
    `SELECT p.*, c.name AS category FROM products p LEFT JOIN categories c ON c.id = p.category_id
      ORDER BY p.active DESC, c.name, p.name`,
  );
  const info = new Map(disponibilidade.map((d) => [d.product_id, d]));

  const filtrados = produtos.filter((p) => {
    if (aba === "ativos") return p.active;
    if (aba === "inativos") return !p.active;
    if (aba === "baixo") return info.get(p.id)?.low;
    if (aba === "manutencao") return p.maintenance_qty > 0;
    return true;
  });

  const categorias = [...new Set(filtrados.map((p) => p.category ?? "Sem categoria"))];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Estoque"
        subtitle={`${produtos.length} produto(s) cadastrado(s)`}
        action={
          <>
            <LinkButton href="/disponibilidade">Consultar data</LinkButton>
            <LinkButton href="/estoque/novo" variant="primario">+ Novo produto</LinkButton>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat label="Disponiveis hoje" value={disponibilidade.reduce((s, d) => s + Math.max(0, d.available), 0)} />
        <Stat label="Reservados hoje" value={disponibilidade.reduce((s, d) => s + d.reserved, 0)} />
        <Stat label="Em manutencao" value={produtos.reduce((s, p) => s + p.maintenance_qty, 0)} />
        <Stat
          label="Abaixo do minimo"
          value={disponibilidade.filter((d) => d.low).length}
          tone={disponibilidade.some((d) => d.low) ? "vermelho" : undefined}
        />
      </div>

      <Tabs
        items={[
          { value: "todos", label: "Todos" },
          { value: "ativos", label: "Ativos" },
          { value: "baixo", label: "Estoque baixo" },
          { value: "manutencao", label: "Em manutencao" },
          { value: "inativos", label: "Inativos" },
        ]}
        current={aba}
        base="/estoque"
      />

      {filtrados.length === 0 ? (
        <Empty>Nenhum produto neste filtro.</Empty>
      ) : (
        categorias.map((cat) => (
          <section key={cat}>
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-stone-500">{cat}</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {filtrados
                .filter((p) => (p.category ?? "Sem categoria") === cat)
                .map((p) => {
                  const d = info.get(p.id);
                  return (
                    <Link key={p.id} href={`/estoque/${p.id}`} className="cartao flex items-center gap-3 p-3">
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex flex-wrap gap-1.5">
                          {!p.active && <Badge tone="cinza">Inativo</Badge>}
                          {d?.low && <Badge tone="vermelho">Estoque baixo</Badge>}
                          {p.maintenance_qty > 0 && <Badge tone="roxo">{p.maintenance_qty} em manutencao</Badge>}
                        </div>
                        <p className="truncate text-sm font-bold text-carvao-900">{p.name}</p>
                        <p className="text-xs text-stone-500">
                          {p.code} - locacao {money(p.rent_price_cents)}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-lg font-bold leading-none text-carvao-900">
                          {d ? Math.max(0, d.available) : p.total_qty}
                        </p>
                        <p className="text-[0.65rem] uppercase text-stone-400">de {p.total_qty} hoje</p>
                      </div>
                    </Link>
                  );
                })}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
