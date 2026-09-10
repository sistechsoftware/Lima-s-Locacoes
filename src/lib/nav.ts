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
     o botao "Mais". Ver MOBILE_NAV/EXTRA_NAV abaixo. A Agenda fica no "Mais":
     a operacao do dia continua visivel no dashboard, e a ferramenta de campo
     (Entregas e Retiradas) fica a um toque na barra principal. */
  { href: "/dashboard", label: "Dashboard", icon: "dashboard", mobile: true },
  { href: "/chat", label: "Mensagens", icon: "chat", mobile: true },
  { href: "/agenda", label: "Agenda", icon: "agenda" },
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
  { href: "/configuracoes", label: "Configurações", icon: "configuracoes" },
];

/** Itens diretos da barra inferior. INVARIANTE: 4 itens + botao "Mais" = 5,
 *  exatamente uma linha em qualquer largura de celular (grid-cols-5 no Shell). */
export const MOBILE_NAV = NAV.filter((n) => n.mobile);

/** Menu "Mais" da barra inferior: a Agenda vem primeiro (uso diario) e depois
 *  todo o restante, na ordem original do menu lateral — sem duplicar entradas. */
export const EXTRA_NAV = [
  ...NAV.filter((n) => n.href === "/agenda"),
  ...NAV.filter((n) => !n.mobile && n.href !== "/agenda"),
];
