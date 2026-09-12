import { addDays, startOfWeek } from "./format";

/**
 * Filtros da listagem de Reservas.
 *
 * Este modulo e puro: monta as condicoes SQL e decide a ordenacao/destaque,
 * sem tocar no banco. A tela continua consultando com os mesmos helpers de
 * sempre (all/scalar + RESERVATION_SELECT); aqui so se organiza o WHERE e o
 * ORDER BY para que o padrao operacional "hoje + confirmadas" seja um filtro
 * comum, nunca uma alteracao de dados.
 */

export const PERIODOS_RESERVA = [
  { value: "hoje", label: "Hoje" },
  { value: "dia", label: "Dia" },
  { value: "ontem", label: "Ontem" },
  { value: "semana", label: "Semana" },
  { value: "todas", label: "Todas" },
  { value: "futuras", label: "Futuras" },
  { value: "passadas", label: "Passadas" },
] as const;

export type PeriodoReserva = (typeof PERIODOS_RESERVA)[number]["value"];

/** Padrao operacional da tela: ao abrir, mostra hoje + confirmadas. */
export const PERIODO_PADRAO: PeriodoReserva = "hoje";
export const STATUS_PADRAO = "confirmada";

export function periodoValido(valor: string | undefined | null): PeriodoReserva {
  return PERIODOS_RESERVA.find((p) => p.value === valor)?.value ?? PERIODO_PADRAO;
}

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Data efetiva do filtro de dia unico.
 *
 * "hoje" e "ontem" derivam do relogio do negocio (format.ts, fuso de Brasilia);
 * "dia" usa a data escolhida pelo usuario, caindo para hoje quando invalida.
 */
export function dataEfetiva(periodo: PeriodoReserva, dia: string | undefined, hoje: string): string {
  if (periodo === "hoje") return hoje;
  if (periodo === "ontem") return addDays(hoje, -1);
  if (periodo === "dia") return dia && DATA_ISO.test(dia) ? dia : hoje;
  return hoje;
}

/** Periodos que olham um unico dia: a listagem vira uma agenda do dia. */
export function janelaDeUmDia(periodo: PeriodoReserva): boolean {
  return periodo === "hoje" || periodo === "dia" || periodo === "ontem";
}

export type FiltroReservas = {
  q: string;
  /** Vazio = todos os status existentes; nenhum status novo e criado aqui. */
  status: string;
  periodo: PeriodoReserva;
  /** Data escolhida (so usada pelo periodo "dia"). */
  data: string;
  /** Data de hoje no fuso do negocio (format.today()). */
  hoje: string;
};

/**
 * WHERE + ORDER BY da listagem.
 *
 * Mesma estrutura de filtros que a tela ja tinha (busca, status e periodo),
 * com o periodo "dia" somado e a ordenacao por horario dentro de um mesmo
 * evento de data: reservas sem horario ficam no fim do dia. Entre dias
 * distintos, o mais recente continua primeiro, como antes.
 */
export function reservasFiltro(f: FiltroReservas): { where: string[]; params: string[]; orderBy: string } {
  const where: string[] = [];
  const params: string[] = [];

  if (f.q) {
    where.push("(r.number LIKE ? OR c.name LIKE ? OR r.address LIKE ? OR r.district LIKE ? OR c.phone LIKE ?)");
    const like = `%${f.q}%`;
    params.push(like, like, like, like, like);
  }
  if (f.status) {
    where.push("r.status = ?");
    params.push(f.status);
  }
  switch (f.periodo) {
    case "hoje":
      where.push("r.event_date = ?");
      params.push(f.hoje);
      break;
    case "ontem":
      where.push("r.event_date = ?");
      params.push(addDays(f.hoje, -1));
      break;
    case "dia":
      where.push("r.event_date = ?");
      params.push(f.data);
      break;
    case "semana": {
      const ini = startOfWeek(f.hoje);
      where.push("r.event_date BETWEEN ? AND ?");
      params.push(ini, addDays(ini, 6));
      break;
    }
    case "futuras":
      where.push("r.event_date >= ?");
      params.push(f.hoje);
      break;
    case "passadas":
      where.push("r.event_date < ?");
      params.push(f.hoje);
      break;
  }

  // Reservas de horarios mais proximos primeiro dentro do mesmo dia; sem
  // horario gravado, vai para o fim do dia (NULLIF trata texto vazio).
  const ordemDia = "COALESCE(NULLIF(r.event_time, ''), '23:59:59') ASC, r.id ASC";
  const orderBy = janelaDeUmDia(f.periodo) ? ordemDia : `r.event_date DESC, ${ordemDia}`;
  return { where, params, orderBy };
}

/**
 * Indice, na listagem ja ordenada, da proxima reserva confirmada a acontecer.
 *
 * "Proxima" segue o status informado pela operacao, nao o relogio: enquanto a
 * reserva anterior estiver confirmada, ela continua sendo a proxima a ser
 * utilizada. Reservas canceladas nunca destacam e, quando o usuario pediu um
 * status especifico que nao e "confirmada", nao ha destaque — a excecao e o
 * filtro "Todos os status", onde a primeira confirmada do dia e a proxima.
 * Visual apenas: nao altera registro nenhum.
 */
export function indiceProximaReserva(
  rows: { status: string }[],
  opcoes: { porHorario: boolean; statusFiltrado?: string },
): number {
  if (!opcoes.porHorario) return -1;
  if (opcoes.statusFiltrado && opcoes.statusFiltrado !== "confirmada") return -1;
  return rows.findIndex((r) => r.status === "confirmada");
}
