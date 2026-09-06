import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { availabilityByCategory, timelinesByProduct, type Availability } from "@/lib/stock";
import { timeBR } from "@/lib/format";
import { dateBR, today, waLink } from "@/lib/format";
import { Alerta, Card, PageHeader, Stat } from "@/components/ui";
import { Icon } from "@/components/Icons";

export const dynamic = "force-dynamic";

/**
 * Calendario de disponibilidade.
 *
 * Duas leituras diferentes convivem aqui e nao podem ser somadas: o kit e uma
 * capacidade de montagem, o avulso e estoque fisico. "20 mesas + 80 cadeiras +
 * 50 forros = 150 itens disponiveis" nao significa nada para quem atende o
 * cliente, e pior, sugere uma capacidade que nao existe. Por isso a tela conta
 * produtos, nunca pecas de produtos diferentes.
 *
 * Kits tambem nao se somam entre si: 20 kits de 1+4 e 13 kits de 1+6 saem do
 * mesmo estoque de mesas e cadeiras, entao cada numero e o maximo daquele kit
 * sozinho, nao um total simultaneo.
 */
export default async function DisponibilidadePage({
  searchParams,
}: {
  searchParams: Promise<{ data?: string; ate?: string }>;
}) {
  await requireUser();
  const sp = await searchParams;
  const data = sp.data || today();
  const ate = sp.ate || data;

  const [grupos, linhas] = await Promise.all([
    availabilityByCategory(`${data}T00:00`, `${ate}T23:59`),
    timelinesByProduct(`${data}T00:00`, `${ate}T23:59`),
  ]);

  const todos = grupos.flatMap((g) => g.products);
  const kits = todos.filter((p) => p.kind === "kit");
  const avulsos = grupos
    .map((g) => ({ ...g, products: g.products.filter((p) => p.kind !== "kit") }))
    .filter((g) => g.products.length > 0);

  // conta produtos, nunca soma pecas de produtos diferentes
  const comEstoque = todos.filter((p) => p.available > 0).length;
  const esgotados = todos.filter((p) => p.available <= 0).length;

  const resumoTexto =
    `Disponibilidade para ${dateBR(data)}${ate !== data ? ` ate ${dateBR(ate)}` : ""}:\n` +
    [
      ...(kits.length > 0
        ? [
            "KITS:",
            ...kits.map((k) => `- ${k.name}: ate ${Math.max(0, k.available)} kit(s)`),
          ]
        : []),
      ...(avulsos.length > 0
        ? [
            kits.length > 0 ? "\nITENS AVULSOS:" : "ITENS AVULSOS:",
            ...avulsos.flatMap((g) =>
              g.products.map((p) => `- ${p.name}: ${Math.max(0, p.available)} de ${p.total}`),
            ),
          ]
        : []),
    ].join("\n");

  return (
    <div className="space-y-4">
      <PageHeader
        title="Calendario de disponibilidade"
        subtitle="Consulte antes de responder o cliente no WhatsApp"
      />

      <Card>
        <form className="flex flex-wrap items-end gap-2">
          <label className="min-w-[9rem] flex-1">
            <span className="rotulo">Data inicial</span>
            <input type="date" name="data" defaultValue={data} className="campo" />
          </label>
          <label className="min-w-[9rem] flex-1">
            <span className="rotulo">Data final</span>
            <input type="date" name="ate" defaultValue={ate} className="campo" />
          </label>
          <button className="rounded-xl bg-marca-600 px-5 py-2.5 text-sm font-semibold text-white">Consultar</button>
        </form>
        <p className="mt-2 text-xs text-stone-500">
          O calculo considera o pico de uso simultaneo entre a entrega e a retirada de cada reserva.
        </p>
      </Card>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <Stat label="Produtos disponiveis" value={comEstoque} tone="verde" />
        <Stat label="Sem disponibilidade" value={esgotados} tone={esgotados > 0 ? "vermelho" : "verde"} />
        <Stat label="Periodo" value={dateBR(data) === dateBR(ate) ? dateBR(data) : `${dateBR(data)} - ${dateBR(ate)}`} />
      </div>

      {todos.length === 0 && <Alerta tone="ambar">Nenhum produto ativo cadastrado.</Alerta>}

      {kits.length > 0 && (
        <section className="cartao overflow-hidden">
          <header className="flex items-center justify-between border-b border-nuvem-200 bg-destaque-50 px-4 py-2.5">
            <h2 className="text-sm font-bold uppercase tracking-wide text-destaque-700">Kits disponiveis</h2>
            <span className="text-xs text-stone-500">{kits.length} kit(s) cadastrados</span>
          </header>
          <div className="divide-y divide-nuvem-200">
            {kits.map((k) => (
              <Link key={k.product_id} href={`/estoque/${k.product_id}`} className="block px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-tinta-900">{k.name}</p>
                    <p className="text-xs text-stone-500">
                      {k.components && k.components.length > 0
                        ? k.components.map((c) => `${c.quantity}x ${c.name}`).join(" + ")
                        : "Kit sem composicao cadastrada"}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={`text-xl font-bold leading-none ${tom(k)}`}>{Math.max(0, k.available)}</p>
                    <p className="text-[0.65rem] uppercase text-stone-400">
                      {k.available <= 0 ? "indisponivel" : "kits montaveis"}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
          <p className="border-t border-nuvem-200 bg-nuvem-50 px-4 py-2 text-xs text-stone-500">
            Cada kit mostra o maximo montavel sozinho. Kits que dividem os mesmos componentes nao podem ser somados.
          </p>
        </section>
      )}

      {avulsos.length > 0 && (
        <div className="space-y-4">
          <h2 className="px-1 text-sm font-bold uppercase tracking-wide text-stone-600">Itens avulsos</h2>
          {avulsos.map((g) => (
            <section key={g.category} className="cartao overflow-hidden">
              <header className="flex items-center justify-between border-b border-nuvem-200 bg-nuvem-50 px-4 py-2.5">
                <h3 className="text-sm font-bold uppercase tracking-wide text-stone-600">{g.category}</h3>
                <span className="text-xs text-stone-500">{g.products.length} produto(s)</span>
              </header>
              <div className="divide-y divide-nuvem-200">
                {g.products.map((p) => {
                  const livre = Math.max(0, p.available);
                  const pct = p.effective > 0 ? Math.round((p.reserved / p.effective) * 100) : 0;
                  const trechos = linhas.get(p.product_id) ?? [];
                  return (
                    <Link key={p.product_id} href={`/estoque/${p.product_id}`} className="block px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-tinta-900">{p.name}</p>
                          <p className="text-xs text-stone-500">
                            Total {p.total} - reservados {p.reserved}
                            {p.maintenance > 0 ? ` - manutencao ${p.maintenance}` : ""}
                          </p>
                          {/* o numero grande e o pior momento do periodo. quando a
                              disponibilidade muda no meio (uma devolucao, uma saida),
                              mostra os degraus, senao a tela esconde o que libera */}
                          {trechos.length >= 2 && (
                            <p className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xs">
                              {trechos.map((t) => (
                                <span key={t.from} className={t.available > 0 ? "text-emerald-700" : "text-red-600"}>
                                  <b>{Math.max(0, t.available)}</b> das {timeBR(t.from)} as {timeBR(t.to)}
                                </span>
                              ))}
                            </p>
                          )}
                        </div>
                        <div className="shrink-0 text-right">
                          <p className={`text-xl font-bold leading-none ${tom(p)}`}>{livre}</p>
                          <p className="text-[0.65rem] uppercase text-stone-400">
                            {livre <= 0 ? "indisponivel" : "disponiveis"}
                          </p>
                        </div>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-nuvem-200">
                        <div
                          className={`h-full ${pct >= 100 ? "bg-red-500" : pct > 70 ? "bg-amber-500" : "bg-emerald-500"}`}
                          style={{ width: `${Math.min(100, pct)}%` }}
                        />
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      <a
        href={waLink("", resumoTexto) ?? "#"}
        target="_blank"
        rel="noreferrer"
        className="hidden"
        aria-hidden="true"
      />
      <Card>
        <h3 className="mb-2 text-sm font-bold text-tinta-900">Resumo para copiar</h3>
        <pre className="scroll-x whitespace-pre-wrap rounded-xl bg-nuvem-100 p-3 text-xs text-tinta-800">
          {resumoTexto}
        </pre>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-stone-500">
          <Icon name="whatsapp" className="h-4 w-4" /> Copie e cole na conversa com o cliente.
        </p>
      </Card>
    </div>
  );
}

function tom(p: Availability): string {
  if (p.available <= 0) return "text-red-600";
  return p.low ? "text-amber-600" : "text-emerald-600";
}
