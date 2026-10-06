import { requireUser } from "@/lib/auth";
import { availabilityQuery, parametroLista, type AvailabilityParams } from "@/lib/availability-time";
import { stockOptions } from "@/lib/availability-settings";
import { equipmentTimeline } from "@/lib/timeline";
import { addDays, dateTimeBR, today } from "@/lib/format";
import { Stat } from "@/components/ui";
import AvailabilityFilter from "@/components/AvailabilityFilter";
import TimelineChart from "@/components/TimelineChart";
import { dateBR } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Timeline de disponibilidade (visao de hotelaria).
 *
 * Leitura visual de apoio a operacao: quando cada equipamento esta livre,
 * reservado, em transporte, em uso, aguardando devolucao ou em preparo. Nao
 * calcula estoque novo — reusa exatamente o motor da tela de disponibilidade
 * (mesma janela, mesmo preparo, mesmas ocupacoes).
 */
export default async function TimelinePage({
  searchParams,
}: {
  searchParams: Promise<AvailabilityParams & { modo?: string }>;
}) {
  await requireUser();
  const sp = await searchParams;
  const query = availabilityQuery(sp);
  const options = await stockOptions(query);
  const modo = sp.modo === "todos" ? "todos" : "ocupados";

  // Selecao de produtos na URL: ausente = todos (links antigos e favoritos
  // continuam valendo); com valores, apenas os ids validos informados.
  const produtos = new Set(
    parametroLista(sp.produtos)
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0),
  );

  // Busca SEM filtro e filtra depois: os indicadores (livres no inicio, pico,
  // equipamentos em uso) olham o escopo do usuario — selecao de produtos, se
  // houver — e ignoram o modo, que so escolhe entre linhas com/sen ocupacao.
  const todas = await equipmentTimeline(query.from, query.to, options);
  const escopo = produtos.size ? todas.filter((r) => produtos.has(r.product_id)) : todas;
  const rows = modo === "ocupados" ? escopo.filter((r) => r.lanesTotal > 0) : escopo;

  const ocupados = escopo.filter((r) => r.lanesTotal > 0);
  const totalPistas = ocupados.reduce((s, r) => s + r.lanesTotal, 0);
  const simultaneo = ocupados.reduce((s, r) => Math.max(s, r.peak_used), 0);
  const livreAgora = escopo.reduce((s, r) => {
    const trecho = r.faixa.find((f) => query.from >= f.from && query.from < f.to);
    return s + Math.max(0, trecho?.available ?? r.faixa[0]?.available ?? 0);
  }, 0);

  const qs = query.queryString;
  // O querystring base do availabilityQuery nao conhece produtos/modo: monta o
  // completo para TODOS os links da tela, de modo que a selecao sobreviva a
  // troca de janela, de modo e ao clique em espaco livre da propria timeline.
  const produtosQs = produtos.size ? [...produtos].sort((a, b) => a - b).join(",") : "";
  const qsCompleto = produtosQs ? `${qs}&produtos=${produtosQs}` : qs;
  const linkModo = (m: string) => `/disponibilidade/timeline?${qsCompleto}&modo=${m}`;
  // Reconstrui o querystring com set(): apenas concatenar &inicio=/&fim= criava
  // parametros DUPLICADOS e o Next repete os valores como array — o que derrubava
  // a pagina (value.trim is not a function) ao clicar em Hoje/Amanha/7 dias/30 dias.
  const linkPeriodo = (f: string, t: string) => {
    const p = new URLSearchParams(qsCompleto);
    p.set("inicio", f);
    p.set("fim", t);
    p.set("modo", modo);
    return `/disponibilidade/timeline?${p.toString()}`;
  };
  const linkTodosProdutos = () => {
    const p = new URLSearchParams(qsCompleto);
    p.delete("produtos");
    p.set("modo", modo);
    return `/disponibilidade/timeline?${p.toString()}`;
  };

  // Lista do seletor: estavel por categoria/nome (independente do pico da janela).
  const paraSelecao = [...todas].sort((a, b) =>
    (a.category ?? "").localeCompare(b.category ?? "", "pt-BR") || a.name.localeCompare(b.name, "pt-BR"),
  );

  const mensagemVazia = rows.length > 0
    ? undefined
    : produtos.size > 0
      ? "Nenhum produto da seleção corresponde a esta janela."
      : modo === "ocupados"
        ? "Nenhum equipamento com ocupação nesta janela."
        : undefined;

  return (
    <div className="timeline-larga space-y-4">
      <div>
        <h1 className="text-xl font-bold text-tinta-900 sm:text-2xl">Timeline de disponibilidade</h1>
        <p className="mt-0.5 text-sm text-stone-500">
          Ocupação no estilo pousada: quando cada equipamento sai, volta e libera
        </p>
      </div>

      <div className="scroll-x -mx-3 abas-barra px-3 sm:mx-0 sm:px-0">
        <a
          href={linkModo("ocupados")}
          className={`shrink-0 rounded-full border px-3 py-1.5 text-sm font-semibold ${
            modo === "ocupados" ? "border-marca-600 bg-marca-600 text-white" : "border-nuvem-300 bg-white"
          }`}
        >
          Com ocupação
        </a>
        <a
          href={linkModo("todos")}
          className={`shrink-0 rounded-full border px-3 py-1.5 text-sm font-semibold ${
            modo === "todos" ? "border-marca-600 bg-marca-600 text-white" : "border-nuvem-300 bg-white"
          }`}
        >
          Todos os equipamentos
        </a>
      </div>

      <AvailabilityFilter
        query={query}
        minutes={options.preparationMinutes}
        hidden={produtos.size ? { modo, produtos: produtosQs } : { modo }}
      />

      {/* Selecao de produtos: form GET puro (sem JavaScript), como o resto da
          tela. Marcado nada = todos; a URL aceita "produtos=1,2" ou o campo
          repetido do checkbox, e os links da pagina reconstroem sempre a forma
          compacta. */}
      <details className="cartao p-4" open={produtos.size > 0}>
        <summary className="cursor-pointer select-none text-sm font-bold uppercase tracking-wide text-stone-500">
          Produtos na timeline
          <span className="ml-2 font-normal normal-case text-stone-400">
            {produtos.size ? `${produtos.size} de ${todas.length} selecionados` : "todos"}
          </span>
        </summary>
        <form action="/disponibilidade/timeline" method="get" className="mt-3 space-y-3">
          <input type="hidden" name="consulta" value="1" />
          <input type="hidden" name="inicio" value={query.from} />
          {query.to !== query.from && <input type="hidden" name="fim" value={query.to} />}
          <input type="hidden" name="preparo" value={query.considerPreparation ? "1" : "0"} />
          <input type="hidden" name="modo" value={modo} />
          <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
            {paraSelecao.map((p) => (
              <label
                key={p.product_id}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-nuvem-50"
              >
                <input
                  type="checkbox"
                  name="produtos"
                  value={p.product_id}
                  defaultChecked={produtos.has(p.product_id)}
                  className="h-4 w-4"
                />
                <span className="truncate font-medium">{p.name}</span>
                <span className="ml-auto shrink-0 text-[0.65rem] uppercase tracking-wide text-stone-400">
                  {p.kind === "kit" ? "kit" : p.category ?? "item"}
                </span>
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className="rounded-xl bg-marca-600 px-4 py-2 text-sm font-semibold text-white">Aplicar</button>
            <a
              href={linkTodosProdutos()}
              className="rounded-xl border border-nuvem-300 bg-white px-4 py-2 text-sm font-semibold"
            >
              Mostrar todos
            </a>
            <span className="text-xs text-stone-500">Sem nenhuma marcação = todos os produtos.</span>
          </div>
        </form>
      </details>

      <div className="scroll-x -mx-3 abas-barra px-3 sm:mx-0 sm:px-0">
        <a href={linkPeriodo(today() + "T00:00", today() + "T23:59")} className="shrink-0 rounded-full border border-nuvem-300 bg-white px-3 py-1.5 text-sm font-semibold">
          Hoje
        </a>
        <a href={linkPeriodo(addDays(today(), 1) + "T00:00", addDays(today(), 1) + "T23:59")} className="shrink-0 rounded-full border border-nuvem-300 bg-white px-3 py-1.5 text-sm font-semibold">
          Amanhã
        </a>
        <a href={linkPeriodo(today() + "T00:00", addDays(today(), 6) + "T23:59")} className="shrink-0 rounded-full border border-nuvem-300 bg-white px-3 py-1.5 text-sm font-semibold">
          7 dias
        </a>
        <a href={linkPeriodo(today() + "T00:00", addDays(today(), 29) + "T23:59")} className="shrink-0 rounded-full border border-nuvem-300 bg-white px-3 py-1.5 text-sm font-semibold">
          30 dias
        </a>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat label="Janela" value={`${dateBR(query.from)} ${dateTimeBR(query.from).slice(-5)} → ${dateBR(query.to)} ${dateTimeBR(query.to).slice(-5)}`} />
        <Stat label="Equipamentos em uso na janela" value={ocupados.length} tone={ocupados.length > 0 ? "vermelho" : "verde"} />
        <Stat label="Maior uso simultâneo" value={simultaneo} />
        <Stat label="Unidades livres no início" value={livreAgora} tone="verde" />
      </div>

      <TimelineChart
        from={query.from}
        to={query.to}
        rows={rows}
        queryString={qs}
        returnTo={`/disponibilidade/timeline?${qsCompleto}&modo=${modo}`}
        mensagemVazia={mensagemVazia}
      />

      <p className="px-1 text-xs text-stone-500">
        Fuso de São Paulo{options.preparationMinutes > 0 ? ` · ${options.preparationMinutes} min de higienização/preparo considerados após cada devolução` : " · sem preparo adicional"}.
        A faixa verde clara mostra unidades livres; vermelho claro, esgotado. Clique num bloco para abrir a reserva;
        clique num espaço livre para criar uma nova reserva com data, hora e produto já preenchidos.
      </p>
    </div>
  );
}
