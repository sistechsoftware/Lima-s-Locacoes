"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "./Icons";
import { EXTRA_NAV, MOBILE_NAV, NAV } from "@/lib/nav";
import { initials } from "@/lib/format";

type User = { id: number; name: string; role: string };

const active = (pathname: string, href: string) =>
  pathname === href || (href !== "/dashboard" && pathname.startsWith(href));

/* --------------------------- barra lateral (desktop) --------------------------- */

export function Sidebar({ company, logo }: { company: string; logo?: string }) {
  const pathname = usePathname();
  return (
    <aside className="nao-imprimir hidden w-60 shrink-0 flex-col border-r border-nuvem-300 bg-white md:flex">
      <Link href="/dashboard" className="flex items-center gap-2.5 border-b border-nuvem-200 px-4 py-4">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="" className="h-9 w-9 rounded-lg object-contain" />
        ) : (
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-marca-600 text-lg font-black text-white">
            L
          </span>
        )}
        <span className="min-w-0">
          <span className="block truncate text-sm font-bold leading-tight text-tinta-900">{company}</span>
          <span className="block text-[0.68rem] uppercase tracking-wide text-stone-400">Gestao de locacoes</span>
        </span>
      </Link>
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
              active(pathname, n.href)
                ? "bg-marca-600 text-white"
                : "text-tinta-700 hover:bg-nuvem-100"
            }`}
          >
            <Icon name={n.icon} className="h-[18px] w-[18px] shrink-0" />
            <span className="truncate">{n.label}</span>
          </Link>
        ))}
      </nav>
    </aside>
  );
}

/* ------------------------------- barra superior ------------------------------- */

export function TopBar({
  user,
  unread,
  company,
  logo,
}: {
  user: User;
  unread: number;
  company: string;
  logo?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <header className="nao-imprimir sticky top-0 z-30 border-b border-nuvem-300 bg-white/95 backdrop-blur">
      <div className="flex items-center gap-2 px-3 py-2.5 sm:px-4">
        <Link href="/dashboard" className="flex items-center gap-2 md:hidden">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="" className="h-8 w-8 rounded-lg object-contain" />
          ) : (
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-marca-600 text-base font-black text-white">
              L
            </span>
          )}
          <span className="max-w-[7.5rem] truncate text-sm font-bold text-tinta-900">{company}</span>
        </Link>

        <GlobalSearch />

        <Link
          href="/notificacoes"
          aria-label="Notificacoes"
          className="relative shrink-0 rounded-xl p-2 text-tinta-700 hover:bg-nuvem-100"
        >
          <Icon name="sino" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[0.6rem] font-bold text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Link>

        <div className="relative shrink-0">
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-marca-600 text-xs font-bold text-white"
            aria-label="Menu do usuario"
          >
            {initials(user.name)}
          </button>
          {open && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
              <div className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-xl border border-nuvem-300 bg-white shadow-lg">
                <div className="border-b border-nuvem-200 px-3 py-2.5">
                  <p className="text-sm font-bold text-tinta-900">{user.name}</p>
                  <p className="text-xs capitalize text-stone-500">{user.role}</p>
                </div>
                <Link
                  href="/configuracoes"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-nuvem-50"
                >
                  <Icon name="configuracoes" className="h-4 w-4" /> Configuracoes
                </Link>
                <form action="/api/logout" method="post">
                  <button className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-red-600 hover:bg-red-50">
                    <Icon name="saida" className="h-4 w-4" /> Sair
                  </button>
                </form>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (q.trim()) router.push(`/busca?q=${encodeURIComponent(q.trim())}`);
      }}
      className="relative min-w-0 flex-1"
    >
      <Icon name="busca" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar cliente, LIMA-001, telefone..."
        className="w-full rounded-xl border border-nuvem-300 bg-nuvem-50 py-2 pl-9 pr-3 text-sm outline-none focus:border-marca-400 focus:bg-white"
      />
    </form>
  );
}

/* ------------------------------ barra inferior -------------------------------- */

export function BottomNav() {
  const pathname = usePathname();
  const [sheet, setSheet] = useState(false);

  useEffect(() => setSheet(false), [pathname]);

  return (
    <>
      {sheet && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={() => setSheet(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-white p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-nuvem-300" />
            <div className="grid grid-cols-3 gap-2">
              {EXTRA_NAV.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className="flex flex-col items-center gap-1.5 rounded-xl border border-nuvem-200 px-2 py-3 text-center text-[0.7rem] font-semibold text-tinta-700"
                >
                  <Icon name={n.icon} className="h-5 w-5 text-marca-600" />
                  <span className="leading-tight">{n.label}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      <nav className="nao-imprimir fixed inset-x-0 bottom-0 z-30 border-t border-nuvem-300 bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
        <div className="grid grid-cols-5">
          {MOBILE_NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`flex flex-col items-center gap-0.5 py-2 text-[0.63rem] font-semibold ${
                active(pathname, n.href) ? "text-marca-600" : "text-stone-500"
              }`}
            >
              <Icon name={n.icon} className="h-[22px] w-[22px]" />
              <span className="leading-none">{n.label.split(" ")[0]}</span>
            </Link>
          ))}
          <button
            onClick={() => setSheet(true)}
            className="flex flex-col items-center gap-0.5 py-2 text-[0.63rem] font-semibold text-stone-500"
          >
            <Icon name="menu" className="h-[22px] w-[22px]" />
            <span className="leading-none">Mais</span>
          </button>
        </div>
      </nav>
    </>
  );
}

/* ------------------------------ botao flutuante ------------------------------- */

const ACOES = [
  { href: "/reservas/nova", label: "Nova reserva", icon: "reservas" },
  { href: "/orcamentos/novo", label: "Novo orcamento", icon: "orcamento" },
  { href: "/clientes/novo", label: "Novo cliente", icon: "clientes" },
  { href: "/operacao/nova", label: "Nova entrega", icon: "operacao" },
  { href: "/fretes/novo", label: "Novo frete", icon: "fretes" },
  { href: "/compras/nova", label: "Nova compra", icon: "estoque" },
  { href: "/fretes/calculadora", label: "Calcular frete", icon: "financeiro" },
];

export function FloatingAction() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);

  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setOpen(false)} />}
      <div className="nao-imprimir fixed bottom-20 right-4 z-40 flex flex-col items-end gap-2 md:bottom-6">
        {open &&
          ACOES.map((a) => (
            <Link
              key={a.href}
              href={a.href}
              className="flex items-center gap-2 rounded-full bg-white py-2.5 pl-3 pr-4 text-sm font-semibold text-tinta-900 shadow-lg"
            >
              <Icon name={a.icon} className="h-4 w-4 text-marca-600" />
              {a.label}
            </Link>
          ))}
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label="Acoes rapidas"
          className="flex h-14 w-14 items-center justify-center rounded-full bg-marca-600 text-white shadow-xl transition active:scale-95"
        >
          <Icon name={open ? "fechar" : "mais"} className="h-7 w-7" />
        </button>
      </div>
    </>
  );
}
