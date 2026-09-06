import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { availabilityByCategory, disponivelAPartirDe, timelinesByProduct } from "@/lib/stock";
import { timeBR } from "@/lib/format";
import { dateBR, today, waLink } from "@/lib/format";
import { Alerta, Card, PageHeader, Stat } from "@/components/ui";
import { Icon } from "@/components/Icons";

export const dynamic = "force-dynamic";

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
  const totalDisponivel = grupos.reduce((s, g) => s + g.available, 0);
  const totalReservado = grupos.reduce((s, g) => s + g.reserved, 0);

  const resumoTexto =
    `Disponibilidade para ${dateBR(data)}${ate !== data ? ` ate ${dateBR(ate)}` : ""}:\n` +
    grupos
      .flatMap((g) =>
        g.products.map((p) =>
          p.kind === "kit"
            ? `${p.name}: ${Math.max(0, p.available)} kit(s) disponiveis`
            : `${p.name}: ${Math.max(0, p.available)} de ${p.total}`,
        ),
      )
      .join("\n");

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
        <Stat label="Disponiveis" value={totalDisponivel} tone="verde" />
        <Stat label="Reservados" value={totalReservado} />
        <Stat label="Periodo" value={dateBR(data) === dateBR(ate) ? dateBR(data) : `${dateBR(data)} - ${dateBR(ate)}`} />
      </div>

      {grupos.length === 0 && <Alerta tone="ambar">Nenhum produto ativo cadastrado.</Alerta>}

      {grupos.map((g) => (
        <section key={g.category} className="cartao overflow-hidden">
          <header className="flex items-center justify-between border-b border-nuvem-200 bg-nuvem-50 px-4 py-2.5">
            <h2 className="text-sm font-bold uppercase tracking-wide text-stone-600">{g.category}</h2>
            <span className="text-xs text-stone-500">
              {g.available} disponivel de {g.total}
            </span>
          </header>
          <div className="divide-y divide-nuvem-200">
            {g.products.map((p) => {
              const livre = Math.max(0, p.available);
              const pct = p.effective > 0 ? Math.round((p.reserved / p.effective) * 100) : 0;
              return (
                <Link key={p.product_id} href={`/estoque/${p.product_id}`} className="block px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 truncate text-sm font-bold text-tinta-900">
                        {p.kind === "kit" && (
                          <span className="shrink-0 rounded bg-destaque-100 px-1.5 py-0.5 text-[0.6rem] font-bold uppercase text-destaque-700">
                            kit
                          </span>
                        )}
                        <span className="truncate">{p.name}</span>
                      </p>
                      <p className="text-xs text-stone-500">
                        {p.kind === "kit"
                          ? "Kit: disponibilidade calculada pelos componentes"
                          : `Total ${p.total} - reservados ${p.reserved}${
                              p.maintenance > 0 ? ` - manutencao ${p.maintenance}` : ""
                            }`}
                      </p>
                      {(() => {
                        // o numero grande e o pior momento do periodo. quando a
                        // disponibilidade muda no meio (uma devolucao, uma saida),
                        // mostra os degraus, senao a tela esconde o que libera
                        if (p.kind === "kit") return null;
                        const trechos = linhas.get(p.product_id) ?? [];
                        if (trechos.length < 2) return null;
                        return (
                          <p className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xs">
                            {trechos.map((t) => (
                              <span
                                key={t.from}
                                className={t.available > 0 ? "text-emerald-700" : "text-red-600"}
                              >
                                <b>{Math.max(0, t.available)}</b> das {timeBR(t.from)} as {timeBR(t.to)}
                              </span>
                            ))}
                          </p>
                        );
                      })()}
                    </div>
                    <div className="shrink-0 text-right">
                      <p
                        className={`text-xl font-bold leading-none ${
                          livre <= 0 ? "text-red-600" : p.low ? "text-amber-600" : "text-emerald-600"
                        }`}
                      >
                        {livre}
                      </p>
                      <p className="text-[0.65rem] uppercase text-stone-400">
                        {livre <= 0 ? "indisponivel" : p.kind === "kit" ? "kits montaveis" : "disponiveis"}
                      </p>
                    </div>
                  </div>
                  <div className={`mt-2 h-1.5 overflow-hidden rounded-full bg-nuvem-200 ${p.kind === "kit" ? "hidden" : ""}`}>
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
