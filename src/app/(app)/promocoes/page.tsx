import { requireUser } from "@/lib/auth";
import { listarPromocoes } from "@/lib/promocoes-db";
import { rotuloFaixa, vigente } from "@/lib/promocoes";
import { dateBR, money, today } from "@/lib/format";
import { Badge, Empty, LinkButton, PageHeader, StatusBadge } from "@/components/ui";
import { ListRow, SearchForm, Tabs } from "@/components/List";

export const dynamic = "force-dynamic";

const SITUACOES = [
  { value: "todas", label: "Todas" },
  { value: "ativas", label: "Ativas" },
  { value: "inativas", label: "Inativas" },
];

export default async function PromocoesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; situacao?: string }>;
}) {
  await requireUser();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const situacao = sp.situacao ?? "todas";
  const promocoes = await listarPromocoes({ busca: q, situacao });
  const d0 = today();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Promocoes por quantidade"
        subtitle={`${promocoes.length} promocao(oes)`}
        action={<LinkButton href="/promocoes/nova" variant="primario">+ Nova promocao</LinkButton>}
      />

      <SearchForm action="/promocoes" placeholder="Produto ou nome da promocao..." defaultValue={q} />
      <Tabs items={SITUACOES} current={situacao} base="/promocoes" param="situacao" />

      {promocoes.length === 0 ? (
        <Empty>
          Nenhuma promocao cadastrada. Enquanto nao houver, todo produto usa o preco normal do cadastro.
        </Empty>
      ) : (
        <div className="space-y-2">
          {promocoes.map((p) => {
            const valendo = vigente(p, d0);
            const periodo =
              p.starts_on || p.ends_on
                ? `${p.starts_on ? dateBR(p.starts_on) : "sempre"} ate ${p.ends_on ? dateBR(p.ends_on) : "sem fim"}`
                : "sem periodo definido";
            return (
              <ListRow
                key={p.id}
                href={`/promocoes/${p.id}`}
                badges={
                  <>
                    {p.active ? <Badge tone="verde">Ativa</Badge> : <Badge tone="cinza">Inativa</Badge>}
                    {p.active && !valendo && <Badge tone="ambar">Fora do periodo</Badge>}
                  </>
                }
                title={p.name || p.product_name}
                subtitle={`${p.product_name} - normal ${money(p.rent_price_cents)} - ${periodo}`}
                body={
                  <ul className="space-y-0.5 text-xs">
                    {p.tiers.map((f, i) => (
                      <li key={i} className="flex justify-between gap-3">
                        <span className="text-stone-500">{rotuloFaixa(f)}</span>
                        <span className="font-semibold text-tinta-900">{money(f.unit_price_cents)} cada</span>
                      </li>
                    ))}
                  </ul>
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
