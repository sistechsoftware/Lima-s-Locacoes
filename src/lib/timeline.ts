import "server-only";
import { all } from "./db";
import { timeWindow } from "./availability-time";
import { stockOptions, type StockOptions } from "./availability-settings";
import { loadHolds, availabilityTimeline, stamp, type Hold } from "./stock";
import { kitCapacity } from "./kits";

/**
 * Timeline de disponibilidade dos equipamentos.
 *
 * Uma leitura VISUAL de apoio a operacao, no estilo dos graficos de ocupacao
 * da hotelaria: para cada equipamento (ou kit comercial) mostra a faixa do
 * tempo com o estado de cada instante — reservado, em transporte, em uso,
 * aguardando devolucao, higienizacao/preparo e disponivel.
 *
 * NAO cria uma segunda logica de estoque: as ocupacoes vem exatamente do motor
 * (loadHolds) e os degraus de disponibilidade de availabilityTimeline. O
 * estado visual e DERIVADO do cruzamento das ocupacoes fisicas com as
 * operacoes (entrega/retirada) ja agendadas para a mesma reserva — quando a
 * operacao muda no sistema, a timeline acompanha sozinha, porque nao guarda
 * nada.
 */

/* ------------------------------------------------------------------ */
/* Estados da faixa                                                    */
/* ------------------------------------------------------------------ */

export type TimelinePhase = "reservado" | "transporte" | "em_uso" | "aguardando" | "preparo";

export const PHASE_DEFS: { phase: TimelinePhase; label: string; tone: string }[] = [
  { phase: "reservado", label: "Reservado", tone: "bg-amber-400" },
  { phase: "transporte", label: "Em transporte", tone: "bg-sky-500" },
  { phase: "em_uso", label: "Em utilização", tone: "bg-violet-500" },
  { phase: "aguardando", label: "Aguardando devolução", tone: "bg-rose-400" },
  { phase: "preparo", label: "Higienização/preparo", tone: "bg-stone-400" },
];

export const PHASE_LABEL: Record<TimelinePhase, string> = Object.fromEntries(
  PHASE_DEFS.map((d) => [d.phase, d.label]),
) as Record<TimelinePhase, string>;

/* ------------------------------------------------------------------ */
/* Estruturas de saida                                                 */
/* ------------------------------------------------------------------ */

/** Bloco de uma reserva dentro de uma pista. */
export type Block = {
  from: string;
  to: string;
  phase: TimelinePhase;
  /** Tooltip: numero da reserva, cliente e quantidade. */
  title: string;
  reservationId: number;
  qty: number;
};

/**
 * Pista vertical: uma faixa visual da linha e seus blocos.
 *
 * Cada pista e ocupada por um grupo comercial (uma reserva, ou uma linha
 * item da reserva quando ela tem varios itens no mesmo produto). Blocos de
 * grupos diferentes so dividem a mesma pista quando nao se sobrepoe no tempo.
 */
export type Lane = {
  index: number;
  blocks: Block[];
};

/** Trecho da faixa de capacidade (fundo da linha). */
export type Faixa = {
  from: string;
  to: string;
  /** Unidades livres naquele instante (fisicos) ou kits montaveis (kits). */
  available: number;
};

/** Uma linha da timeline: um equipamento vendavel (simples ou kit). */
export type TimelineRow = {
  product_id: number;
  code: string;
  name: string;
  kind: "simples" | "kit";
  category: string | null;
  /** Disponibilidade sem nenhuma reserva: total - manutencao (ou capacidade estatica do kit). */
  effective: number;
  /** Pico de ocupacao na janela (unidades ou kits). */
  peak_used: number;
  faixa: Faixa[];
  lanes: Lane[];
  /** Pistas paralelas reais (itens de reserva simultaneos). */
  lanesTotal: number;
};

/* ------------------------------------------------------------------ */
/* Fases por status da reserva                                         */
/* ------------------------------------------------------------------ */

/**
 * Fase de referencia de cada status que ocupa estoque. "confirmada" nao
 * significa "parado na base": o refinamento temporal com as operacoes
 * (entrega/retirada) separa transporte, uso e espera dentro da janela.
 */
const FASE_POR_STATUS: Record<string, TimelinePhase> = {
  pre_reserva: "reservado",
  confirmada: "reservado",
  entregue: "em_uso",
  em_uso: "em_uso",
  aguardando_retirada: "aguardando",
};

function faseNoInstante(t: string, base: TimelinePhase, transicoes: { at: string; phase: TimelinePhase }[]): TimelinePhase {
  let fase = base;
  for (const tr of transicoes) {
    if (tr.at <= t) fase = tr.phase;
  }
  return fase;
}

type OpInfo = { status: string; scheduled_at: string };

/**
 * Fim REAL da ocupacao (pickup/evento).
 *
 * O hold_end do motor ja vem somado do tempo de preparo; a fase "ocupado"
 * termina antes disso. As datas de calendario viajam junto nos holds lidos
 * pelo motor; se ausentes (hold construido a mao), cai no proprio hold_end.
 */
function fimReal(h: Hold): string {
  const r = h as Hold & { pickup_at?: string | null; event_date?: string | null };
  if (r.pickup_at) return stamp(r.pickup_at, "23:59");
  if (r.event_date) return stamp(r.event_date, "23:59");
  return h.hold_end;
}

/**
 * Transicoes de fase de uma ocupacao, derivadas das operacoes da reserva.
 *
 *  - entrega concluida                -> em uso a partir da entrega
 *  - retirada marcada e nao concluida -> aguardando devolucao a partir da hora marcada
 *  - retirada concluida               -> higienizacao/preparo ate o fim da janela gravada
 *
 * A entrega em rota NAO entra aqui: ela muda a fase inicial (transporte),
 * aplicada em blocosDaOcupacao. O fim usado e o REAL (pickup/evento), porque o
 * hold_end do motor ja vem somado do preparo.
 */
function transicoesDaOcupacao(h: Hold, ops: Map<string, OpInfo> | undefined): { at: string; phase: TimelinePhase }[] {
  const tr: { at: string; phase: TimelinePhase }[] = [];
  const entrega = ops?.get("entrega");
  const retirada = ops?.get("retirada");
  const inicio = h.hold_start;
  const fim = fimReal(h);
  const dentro = (t: string) => t > inicio && t < fim;

  if (entrega?.status === "concluida" && dentro(entrega.scheduled_at)) {
    tr.push({ at: entrega.scheduled_at, phase: "em_uso" });
  }
  if (retirada && retirada.status !== "concluida" && retirada.status !== "cancelada" && dentro(retirada.scheduled_at)) {
    tr.push({ at: retirada.scheduled_at, phase: "aguardando" });
  }
  if (retirada?.status === "concluida" && dentro(retirada.scheduled_at)) {
    // ja coletado: o resto da janela gravada e preparo na base
    tr.push({ at: retirada.scheduled_at, phase: "preparo" });
  }
  return tr.sort((x, y) => (x.at < y.at ? -1 : 1));
}

function faseBase(h: Hold): TimelinePhase {
  return FASE_POR_STATUS[h.status] ?? "reservado";
}

/** Blocos de uma ocupacao dentro da janela da consulta, com fase por trecho. */
function blocosDaOcupacao(
  h: Hold,
  qty: number,
  ops: Map<string, OpInfo> | undefined,
  from: string,
  to: string,
  preparoMin: number,
): Block[] {
  const t0 = h.hold_start < from ? from : h.hold_start;
  // fim REAL da ocupacao (pickup/evento): o hold_end do motor ja inclui o
  // preparo, entao a fase ocupada termina antes dele
  const fimRealFim = fimReal(h);
  const t1 = fimRealFim > to ? to : fimRealFim;
  if (t1 <= t0) return [];

  const entrega = ops?.get("entrega");
  // carro a caminho / equipe no local antes da entrega: transporte
  const inicial: TimelinePhase =
    entrega && (entrega.status === "em_rota" || entrega.status === "no_local") ? "transporte" : faseBase(h);
  const tr = transicoesDaOcupacao(h, ops);
  const pontos = [...new Set([t0, ...tr.map((x) => x.at).filter((t) => t > t0 && t < t1), t1])].sort();
  const titulo = `${h.number} · ${h.customer} · ${qty} un`;

  const blocos: Block[] = [];
  for (let i = 0; i < pontos.length - 1; i++) {
    const ini = pontos[i];
    const fim = pontos[i + 1];
    if (fim <= ini) continue;
    blocos.push({ from: ini, to: fim, phase: faseNoInstante(ini, inicial, tr), title: titulo, reservationId: h.reservation_id, qty });
  }

  // higienizacao/preparo entre o fim real e o hold_end estendido do motor
  // (hold_end = fim real + preparo, calculado por loadHolds)
  if (h.hold_end > fimRealFim) {
    const ini = fimRealFim < from ? from : fimRealFim;
    const fim = h.hold_end > to ? to : h.hold_end;
    if (fim > ini) {
      blocos.push({ from: ini, to: fim, phase: "preparo", title: titulo, reservationId: h.reservation_id, qty });
    }
  }
  return blocos;
}

/* ------------------------------------------------------------------ */
/* Distribuicao em pistas                                              */
/* ------------------------------------------------------------------ */

/** Um bloco ainda nao renderizado, com o grupo comercial ao qual pertence. */
type PistaItem = {
  inicio: string;
  fim: string;
  qty: number;
  fase: TimelinePhase;
  titulo: string;
  reservationId: number;
  /** Grupo: reserva + linha comercial. Blocos do mesmo grupo vao para a mesma pista. */
  grupo: string;
};

/** Os dois blocos dividem o mesmo instante? Intervalos sao [from, to). */
function sobrepoe(a: Block, b: Block): boolean {
  return a.from < b.to && b.from < a.to;
}

/**
 * Empacota os blocos em pistas verticais, como no grafico de ocupacao de
 * hotelaria: cada pista e uma faixa visual da linha e cada BLOCO e um item
 * comercial (uma reserva, ou uma linha da reserva).
 *
 * Empacotamento first-fit deterministico (ordenado por inicio), por GRUPO:
 * todos os blocos de um mesmo grupo (fases de uma mesma reserva) entram juntos
 * numa pista livre — pista so recebe o grupo se nenhum bloco ja la existente
 * se sobrepuser ao dele.
 *
 * POR QUE NAO E UM BLOCO POR UNIDADE: empacotar uma reserva de 40 cadeiras em
 * 40 pistas empurra a reserva seguinte para a pista 40 e ela nunca era
 * desenhada (o corte de exibicao mostra as primeiras pistas). Um bloco por
 * grupo garante que TODA reserva simultanea apareca; a quantidade de unidades
 * continua visivel no titulo do bloco, no resumo da linha e na faixa de
 * unidades livres do fundo.
 */
function distribuirEmPistas(itens: PistaItem[]): Lane[] {
  const porGrupo = new Map<string, PistaItem[]>();
  for (const it of itens) {
    if (it.fim <= it.inicio) continue;
    const lista = porGrupo.get(it.grupo) ?? [];
    lista.push(it);
    porGrupo.set(it.grupo, lista);
  }

  const grupos = [...porGrupo.entries()].map(([grupo, blocks]) => ({
    grupo,
    blocks: blocks.map((b) => ({
      from: b.inicio,
      to: b.fim,
      phase: b.fase,
      title: b.titulo,
      reservationId: b.reservationId,
      qty: b.qty,
    })),
    inicio: blocks.reduce((m, b) => (b.inicio < m ? b.inicio : m), blocks[0].inicio),
    fim: blocks.reduce((m, b) => (b.fim > m ? b.fim : m), blocks[0].fim),
  }));
  grupos.sort((a, b) =>
    a.inicio === b.inicio ? (a.fim === b.fim ? (a.grupo < b.grupo ? -1 : 1) : a.fim < b.fim ? -1 : 1) : a.inicio < b.inicio ? -1 : 1,
  );

  const pistas: Block[][] = [];
  for (const g of grupos) {
    let destino: Block[] | null = null;
    for (const pista of pistas) {
      if (g.blocks.every((b) => pista.every((existente) => !sobrepoe(b, existente)))) {
        destino = pista;
        break;
      }
    }
    if (!destino) {
      destino = [];
      pistas.push(destino);
    }
    destino.push(...g.blocks);
  }

  return pistas.map((p, i) => ({
    index: i,
    blocks: [...p].sort((a, b) => (a.from === b.from ? (a.to < b.to ? -1 : 1) : a.from < b.from ? -1 : 1)),
  }));
}

/* ------------------------------------------------------------------ */
/* Faixa de capacidade                                                 */
/* ------------------------------------------------------------------ */

/** Junta trechos vizinhos com a mesma disponibilidade. */
function juntar(faixa: Faixa[]): Faixa[] {
  const out: Faixa[] = [];
  for (const f of faixa) {
    const ult = out[out.length - 1];
    if (ult && ult.available === f.available) ult.to = f.to;
    else out.push({ ...f });
  }
  return out;
}

/** Faixa de unidades livres de um produto fisico. Reusa availabilityTimeline. */
function faixaFisica(holds: Hold[], effective: number, from: string, to: string): Faixa[] {
  return availabilityTimeline(holds, effective, from, to).map((t) => ({ from: t.from, to: t.to, available: t.available }));
}

/** Capacidade estatica do kit sem nenhuma reserva. */
function capacidadeVazia(spec: { components: { product_id: number; quantity: number }[] }, fisico: Map<number, number>): number {
  return kitCapacity({ id: 0, name: "", kind: "kit", components: spec.components }, fisico);
}

/** Faixa de kits montaveis ao longo do tempo, a partir das ocupacoes dos componentes. */
function faixaKit(
  spec: { components: { product_id: number; quantity: number }[] },
  holdsPorProduto: Map<number, Hold[]>,
  fisico: Map<number, number>,
  from: string,
  to: string,
): { faixa: Faixa[]; effective: number; peak_used: number } {
  const effective = capacidadeVazia(spec, fisico);
  const marcos = new Set<string>([from, to]);
  for (const c of spec.components) {
    for (const h of holdsPorProduto.get(c.product_id) ?? []) {
      if (h.hold_start > from && h.hold_start < to) marcos.add(h.hold_start);
      if (h.hold_end > from && h.hold_end < to) marcos.add(h.hold_end);
    }
  }
  const pontos = [...marcos].sort();
  const faixa: Faixa[] = [];
  let peak = 0;
  for (let i = 0; i < pontos.length - 1; i++) {
    const ini = pontos[i];
    const fim = pontos[i + 1];
    if (fim <= ini) continue;
    const meio = ini < fim ? ini : fim; // ocupacao vigente: entre dois marcos ela nao muda
    const disponivel = new Map<number, number>();
    for (const c of spec.components) {
      const efetivo = fisico.get(c.product_id) ?? 0;
      const usado = (holdsPorProduto.get(c.product_id) ?? [])
        .filter((h) => h.hold_start <= meio && h.hold_end > meio)
        .reduce((s, h) => s + h.qty, 0);
      disponivel.set(c.product_id, efetivo - usado);
    }
    const cap = capacidadeVazia(spec, disponivel);
    peak = Math.max(peak, effective - cap);
    faixa.push({ from: ini, to: fim, available: cap });
  }
  if (faixa.length === 0) faixa.push({ from, to, available: effective });
  return { faixa: juntar(faixa), effective, peak_used: Math.max(0, peak) };
}

/* ------------------------------------------------------------------ */
/* Consulta principal                                                  */
/* ------------------------------------------------------------------ */

export type TimelineViewOptions = {
  /** Inclui apenas equipamentos com alguma ocupacao na janela. */
  apenasOcupados?: boolean;
  /** Limite de linhas na saida. */
  limite?: number;
};

/**
 * Monta a timeline por equipamento vendavel (produtos fisicos + kits)
 * dentro da janela.
 *
 * Linhas de produtos fisicos mostram todo o consumo fisico (direto ou via
 * kit). Linhas de kit mostram o uso comercial do kit (pistas = kits) e a
 * faixa de kits montaveis, sempre derivada dos componentes — a mesma regra do
 * motor (kitCapacity sobre a disponibilidade fisica).
 */
export async function equipmentTimeline(
  from: string,
  to: string,
  options: StockOptions = {},
  view: TimelineViewOptions = {},
): Promise<TimelineRow[]> {
  ({ from, to } = timeWindow(from, to, true));
  const config = await stockOptions(options);

  const [produtos, compRows, holds] = await Promise.all([
    all<any>(
      `SELECT p.id, p.code, p.name, p.kind, p.total_qty, p.maintenance_qty, c.name AS category
         FROM products p LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.active = 1
        ORDER BY c.name, p.name`,
    ),
    all<any>(`SELECT parent_product_id, component_product_id, quantity FROM product_components`),
    loadHolds(from, to, config),
  ]);

  const fisico = new Map<number, number>();
  const categorias = new Map<number, string | null>();
  const specs = new Map<number, { components: { product_id: number; quantity: number }[] }>();
  for (const p of produtos) {
    fisico.set(p.id, Math.max(0, p.total_qty - p.maintenance_qty));
    categorias.set(p.id, p.category ?? null);
    specs.set(p.id, { components: [] });
  }
  for (const c of compRows) {
    specs.get(c.parent_product_id)?.components.push({ product_id: c.component_product_id, quantity: c.quantity });
  }

  // ocupacoes por produto fisico (inclui componentes de kits)
  const holdsPorProduto = new Map<number, Hold[]>();
  for (const h of holds) {
    const list = holdsPorProduto.get(h.product_id) ?? [];
    list.push(h);
    holdsPorProduto.set(h.product_id, list);
  }

  // uso comercial de kits: dedupe por item da reserva (cada item do kit gera
  // uma linha de componente por produto fisico). via_item_id/via_qty vem da
  // linha comercial gravada na reserva.
  const kitUso = new Map<number, { key: string; hold: Hold; qty: number }[]>();
  const vistos = new Set<string>();
  for (const h of holds) {
    if (h.via_product_id == null || h.via_item_id == null) continue;
    if (!specs.has(h.via_product_id)) continue;
    const comp = specs.get(h.via_product_id)!.components;
    if (comp.length === 0) continue; // produto simples: linha 1:1, sem uso comercial de kit
    const key = `${h.reservation_id}:${h.via_item_id}`;
    if (vistos.has(key)) continue;
    vistos.add(key);
    const list = kitUso.get(h.via_product_id) ?? [];
    list.push({ key, hold: h, qty: Math.max(1, h.via_qty ?? 1) });
    kitUso.set(h.via_product_id, list);
  }

  // operacoes de entrega/retirada das reservas visiveis, para refinar as fases
  const reservasIds = [...new Set(holds.map((h) => h.reservation_id))];
  const operacoes = new Map<number, Map<string, OpInfo>>();
  if (reservasIds.length) {
    const marcas = reservasIds.map(() => "?").join(",");
    const rows = await all<any>(
      `SELECT reservation_id, kind, status, scheduled_at FROM operations
        WHERE reservation_id IN (${marcas}) AND kind IN ('entrega','retirada')
        ORDER BY scheduled_at`,
      reservasIds,
    );
    for (const r of rows) {
      const mapa = operacoes.get(r.reservation_id) ?? new Map<string, OpInfo>();
      mapa.set(r.kind, { status: r.status, scheduled_at: r.scheduled_at });
      operacoes.set(r.reservation_id, mapa);
    }
  }

  const saida: TimelineRow[] = [];
  for (const p of produtos) {
    const opsDe = (h: Hold) => operacoes.get(h.reservation_id);
    let row: TimelineRow;

    if (p.kind === "kit") {
      const spec = specs.get(p.id)!;
      if (spec.components.length === 0) continue; // kit sem composicao: nada a desenhar
      const { faixa, effective, peak_used } = faixaKit(spec, holdsPorProduto, fisico, from, to);
      const itens: Parameters<typeof distribuirEmPistas>[0] = [];
      for (const uso of kitUso.get(p.id) ?? []) {
        for (const b of blocosDaOcupacao(uso.hold, uso.qty, opsDe(uso.hold), from, to, config.preparationMinutes)) {
          itens.push({ inicio: b.from, fim: b.to, qty: uso.qty, fase: b.phase, titulo: b.title, reservationId: b.reservationId, grupo: uso.key });
        }
      }
      const lanes = distribuirEmPistas(itens);
      row = {
        product_id: p.id, code: p.code, name: p.name, kind: "kit", category: categorias.get(p.id) ?? null,
        effective, peak_used, faixa, lanes, lanesTotal: lanes.length,
      };
    } else {
      const effective = fisico.get(p.id) ?? 0;
      const holdsProduto = holdsPorProduto.get(p.id) ?? [];
      const faixa = faixaFisica(holdsProduto, effective, from, to);
      const peak_used = faixa.reduce((s, f) => Math.max(s, effective - f.available), 0);
      const itens: Parameters<typeof distribuirEmPistas>[0] = [];
      let ordemItem = 0;
      for (const h of holdsProduto) {
        const grupo = `${h.reservation_id}:${h.via_item_id ?? `h${ordemItem}`}`;
        ordemItem++;
        for (const b of blocosDaOcupacao(h, h.qty, opsDe(h), from, to, config.preparationMinutes)) {
          itens.push({ inicio: b.from, fim: b.to, qty: b.qty, fase: b.phase, titulo: b.title, reservationId: b.reservationId, grupo });
        }
      }
      const lanes = distribuirEmPistas(itens);
      row = {
        product_id: p.id, code: p.code, name: p.name, kind: "simples", category: categorias.get(p.id) ?? null,
        effective, peak_used, faixa, lanes, lanesTotal: lanes.length,
      };
    }

    if (view.apenasOcupados && row.lanesTotal === 0) continue;
    saida.push(row);
  }

  // ocupados primeiro (maior pico), depois os livres; categoria mantida pela ordem SQL
  saida.sort((a, b) => (a.lanesTotal > 0 ? 0 : 1) - (b.lanesTotal > 0 ? 0 : 1) || b.peak_used - a.peak_used);
  return view.limite ? saida.slice(0, view.limite) : saida;
}
