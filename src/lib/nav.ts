/** Definicao unica do menu, usada pela barra lateral e pela barra inferior. */
export type NavItem = {
  href: string;
  label: string;
  icon: string;
  adminOnly?: boolean;
  /** Aparece na barra inferior do celular */
  mobile?: boolean;
};

export const NAV: NavItem[] = [
  /* Barra inferior (mobile): no maximo 4 itens aqui — o quinto espaco e sempre
     o botao "Mais". Ver MOBILE_NAV/EXTRA_NAV abaixo. Mensagens ficou de fora
     da barra de proposito: o chat tem tela propria de altura inteira, o sino
     do topo ja mostra o contador e o botao flutuante + ganhou o atalho
     "Mensagens" — a barra fica com a operacao do dia (Agenda, Reservas e
     Entregas/Retiradas) mais o Dashboard. */
  { href: "/dashboard", label: "Dashboard", icon: "dashboard", mobile: true },
  { href: "/chat", label: "Mensagens", icon: "chat" },
  { href: "/agenda", label: "Agenda", icon: "agenda", mobile: true },
  { href: "/reservas", label: "Reservas", icon: "reservas", mobile: true },
  { href: "/operacao", label: "Entregas e Retiradas", icon: "operacao", mobile: true },
  { href: "/orcamentos", label: "Orçamentos", icon: "orcamento" },
  { href: "/clientes", label: "Clientes", icon: "clientes" },
  { href: "/estoque", label: "Estoque", icon: "estoque" },
  { href: "/disponibilidade", label: "Disponibilidade", icon: "disponibilidade" },
  { href: "/promocoes", label: "Promoções", icon: "estoque" },
  { href: "/fidelidade", label: "Fidelidade", icon: "clientes" },
  { href: "/aniversarios", label: "Aniversariantes", icon: "agenda" },
  { href: "/financeiro", label: "Financeiro", icon: "financeiro" },
  { href: "/compras", label: "Compras", icon: "estoque" },
  { href: "/contratos", label: "Contratos", icon: "contratos" },
  { href: "/fretes", label: "Fretes", icon: "fretes" },
  { href: "/relatorios", label: "Relatórios", icon: "relatorios" },
  { href: "/historico", label: "Histórico", icon: "historico" },
  { href: "/erros", label: "Diário de erros", icon: "configuracoes", adminOnly: true },
  { href: "/configuracoes", label: "Configurações", icon: "configuracoes" },
];

/** Itens diretos da barra inferior. INVARIANTE: 4 itens + botao "Mais" = 5,
 *  exatamente uma linha em qualquer largura de celular (grid-cols-5 no Shell).
 *  Ordem pensada para o polegar: Dashboard, Agenda, Reservas, Entregas. */
export const MOBILE_NAV = NAV.filter((n) => n.mobile);

/** Menu "Mais" da barra inferior: tudo que nao cabe na barra, na ordem
 *  original do menu lateral (Mensagens primeiro) — sem duplicar entradas. */
export const EXTRA_NAV = NAV.filter((n) => !n.mobile);

/**
 * Itens visiveis para o papel de quem navega: `adminOnly` (hoje, o Diario de
 * erros) so aparece para admin. O filtro e unico e central — sidebar classica,
 * modo agrupado, barra inferior e os dois sheets "Mais" leem daqui, entao a
 * flag declarada no item nunca pode vazar em uma tela nova que reutilize NAV.
 * A tela /erros continua se protegendo sozinha na rota; aqui e so o item de menu.
 */
export function visiveis(itens: NavItem[], admin: boolean): NavItem[] {
  return admin ? itens : itens.filter((n) => !n.adminOnly);
}

/** Grupos do modo Agrupado ja filtrados; grupos que ficaram vazios saem. */
export function gruposVisiveis(grupos: NavGroup[], admin: boolean): NavGroup[] {
  return grupos
    .map((g) => ({ ...g, itens: visiveis(g.itens, admin) }))
    .filter((g) => g.itens.length > 0);
}

/* ==================== MODO AGRUPADO (opcional) ==================== */

/** Layout de navegacao escolhido pela empresa (Configuracoes > Navegacao).
 *  "classico" e o padrao: menu plano de sempre, byte a byte. "agrupado"
 *  organiza os mesmos destinos em grupos conceituais — nenhuma rota muda. */
export type NavLayout = "classico" | "agrupado";

/** Grupo de navegacao do modo Agrupado (desktop e mobile compartilham). */
export type NavGroup = { titulo: string; itens: NavItem[] };

/**
 * Mesmos destinos do NAV, agora em grupos. A pergunta que organiza: "onde eu
 * procuraria?" — operacao do dia em Operacao, quem contrata em Comercial, o
 * que alugamos em Estoque, dinheiro/controle em Gestao, ajustes e
 * comunicacao interna em Sistema. Notificacoes entra aqui como item de menu
 * (antes existia so o sino do topo); o item continua tambem no sino.
 */
export const NAV_GRUPOS: NavGroup[] = [
  { titulo: "Início", itens: [{ href: "/dashboard", label: "Dashboard", icon: "dashboard" }] },
  {
    titulo: "Operação",
    itens: [
      { href: "/agenda", label: "Agenda", icon: "agenda" },
      { href: "/orcamentos", label: "Orçamentos", icon: "orcamento" },
      { href: "/reservas", label: "Reservas", icon: "reservas" },
      { href: "/operacao", label: "Entregas e Retiradas", icon: "operacao" },
      { href: "/fretes", label: "Fretes", icon: "fretes" },
    ],
  },
  {
    titulo: "Comercial",
    itens: [
      { href: "/clientes", label: "Clientes", icon: "clientes" },
      { href: "/contratos", label: "Contratos", icon: "contratos" },
      { href: "/promocoes", label: "Promoções", icon: "estoque" },
      { href: "/fidelidade", label: "Fidelidade", icon: "clientes" },
      { href: "/aniversarios", label: "Aniversariantes", icon: "agenda" },
    ],
  },
  {
    titulo: "Estoque",
    itens: [
      { href: "/estoque", label: "Estoque", icon: "estoque" },
      { href: "/disponibilidade", label: "Disponibilidade", icon: "disponibilidade" },
      { href: "/compras", label: "Compras", icon: "estoque" },
    ],
  },
  {
    titulo: "Gestão",
    itens: [
      { href: "/financeiro", label: "Financeiro", icon: "financeiro" },
      { href: "/relatorios", label: "Relatórios", icon: "relatorios" },
      { href: "/historico", label: "Histórico", icon: "historico" },
    ],
  },
  {
    titulo: "Sistema",
    itens: [
      { href: "/configuracoes", label: "Configurações", icon: "configuracoes" },
      { href: "/notificacoes", label: "Notificações", icon: "sino" },
      { href: "/chat", label: "Mensagens", icon: "chat" },
      { href: "/erros", label: "Diário de erros", icon: "configuracoes", adminOnly: true },
    ],
  },
];

/** Acao rapida do botao flutuante +. */
export type AcaoRapida = { href: string; label: string; icon: string };

/** Botao + no modo Classico: as 8 acoes de sempre, na mesma ordem. */
export const ACOES_CLASSICO: AcaoRapida[] = [
  { href: "/chat", label: "Mensagens", icon: "chat" },
  { href: "/reservas/nova", label: "Nova Reserva", icon: "reservas" },
  { href: "/orcamentos/novo", label: "Novo Orçamento", icon: "orcamento" },
  { href: "/clientes/novo", label: "Novo Cliente", icon: "clientes" },
  { href: "/operacao/nova", label: "Nova Entrega", icon: "operacao" },
  { href: "/fretes/novo", label: "Novo Frete", icon: "fretes" },
  { href: "/compras/nova", label: "Nova Compra", icon: "estoque" },
  { href: "/fretes/calculadora", label: "Calcular Frete", icon: "financeiro" },
];

/** Botao + no modo Agrupado: sem "Mensagens" — conversa nao e criacao de
 *  registro. O chat segue acessivel pelo sino do topo e pelo menu. */
export const ACOES_AGRUPADO: AcaoRapida[] = ACOES_CLASSICO.filter((a) => a.href !== "/chat");

/** Acoes rapidas do topo do sheet "Mais" no modo Agrupado (mobile): as
 *  criacoes mais comuns do dia a dia, uma tela a menos de distancia. */
export const ACOES_SHEET_AGRUPADO: AcaoRapida[] = [
  { href: "/reservas/nova", label: "+ Reserva", icon: "reservas" },
  { href: "/orcamentos/novo", label: "+ Orçamento", icon: "orcamento" },
  { href: "/clientes/novo", label: "+ Cliente", icon: "clientes" },
];
