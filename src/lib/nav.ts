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
  { href: "/dashboard", label: "Dashboard", icon: "dashboard", mobile: true },
  { href: "/agenda", label: "Agenda", icon: "agenda", mobile: true },
  { href: "/reservas", label: "Reservas", icon: "reservas", mobile: true },
  { href: "/operacao", label: "Entregas e Retiradas", icon: "operacao", mobile: true },
  { href: "/orcamentos", label: "Orcamentos", icon: "orcamento" },
  { href: "/clientes", label: "Clientes", icon: "clientes" },
  { href: "/estoque", label: "Estoque", icon: "estoque" },
  { href: "/disponibilidade", label: "Disponibilidade", icon: "disponibilidade" },
  { href: "/financeiro", label: "Financeiro", icon: "financeiro" },
  { href: "/contratos", label: "Contratos", icon: "contratos" },
  { href: "/fretes", label: "Fretes", icon: "fretes" },
  { href: "/relatorios", label: "Relatorios", icon: "relatorios" },
  { href: "/historico", label: "Historico", icon: "historico" },
  { href: "/configuracoes", label: "Configuracoes", icon: "configuracoes" },
];

export const MOBILE_NAV = NAV.filter((n) => n.mobile);
export const EXTRA_NAV = NAV.filter((n) => !n.mobile);
