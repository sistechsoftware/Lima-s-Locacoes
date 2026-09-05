import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { agendaEvents, dashboardStats, lateOperations, operationsOn } from "@/lib/queries";
import { listNotifications, rebuildNotifications } from "@/lib/notifications";
import { dateBR, money, moneyShort, today } from "@/lib/format";
import { Alerta, Card, LinkButton, PageHeader, Section, Stat } from "@/components/ui";
import { OperationCard } from "@/components/OperationCard";
import { Icon } from "@/components/Icons";

export const dynamic = "force-dynamic";

const ATALHOS = [
  { href: "/reservas/nova", label: "Reserva", icon: "reservas" },
  { href: "/orcamentos/novo", label: "Orcamento", icon: "orcamento" },
  { href: "/clientes/novo", label: "Cliente", icon: "clientes" },
  { href: "/operacao/nova", label: "Entrega", icon: "operacao" },
  { href: "/fretes/novo", label: "Frete", icon: "fretes" },
];

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const user = await requireUser();
  const { erro } = await searchParams;
  const d0 = today();

  // Uma leitura so traz as operacoes do dia; a separacao por tipo e feita aqui,
  // em vez de custar quatro idas ao banco. O resto vai em paralelo.
  const [, operacoesHoje, atrasadas, agenda] = await Promise.all([
    rebuildNotifications(),
    operationsOn(d0),
    lateOperations(),
    agendaEvents(d0, d0),
  ]);
  // os indicadores contam alertas, entao so podem ser lidos depois do recalculo
  const [s, todosAlertas] = await Promise.all([dashboardStats(), listNotifications(true)]);
  const doTipo = (kind: string) => operacoesHoje.filter((o: any) => o.kind === kind);
  const entregas = doTipo("entrega");
  const retiradas = doTipo("retirada");
  const montagens = doTipo("montagem");
  const desmontagens = doTipo("desmontagem");
  const alertas = todosAlertas.slice(0, 6);

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Ola, ${user.name.split(" ")[0]}`}
        subtitle={`Operacao de ${dateBR(d0)}`}
        action={<LinkButton href="/reservas/nova" variant="primario">+ Nova reserva</LinkButton>}
      />

      {erro === "permissao" && (
        <Alerta tone="vermelho" title="Acesso restrito">
          Esta area e exclusiva do administrador.
        </Alerta>
      )}

      {/* atalhos rapidos */}
      <div className="scroll-x -mx-3 flex gap-2 px-3 sm:mx-0 sm:px-0">
        {ATALHOS.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="flex shrink-0 items-center gap-2 rounded-xl border border-areia-300 bg-white px-3 py-2.5 text-sm font-semibold text-carvao-900"
          >
            <Icon name={a.icon} className="h-4 w-4 text-terra-500" />+ {a.label}
          </Link>
        ))}
      </div>

      {/* ------------------------- OPERACAO DE HOJE ------------------------- */}
      <section className="cartao overflow-hidden border-terra-200">
        <header className="flex items-center justify-between bg-terra-500 px-4 py-3 text-white">
          <h2 className="text-sm font-black uppercase tracking-wide">Operacao de hoje</h2>
          <Link href="/operacao" className="text-xs font-semibold underline underline-offset-2">
            ver tudo
          </Link>
        </header>

        <div className="space-y-4 p-3 sm:p-4">
          {atrasadas.length > 0 && (
            <Alerta tone="vermelho" title={`${atrasadas.length} operacao(oes) em atraso`}>
              <div className="mt-1.5 space-y-1">
                {atrasadas.slice(0, 4).map((o: any) => (
                  <Link key={o.id} href={`/operacao/${o.id}`} className="block underline underline-offset-2">
                    {dateBR(o.scheduled_at)} - {o.kind} - {o.customer} ({o.reservation_number})
                  </Link>
                ))}
              </div>
            </Alerta>
          )}

          <BlocoOperacao titulo="Entregas" icone="🚚" ops={entregas} />
          <BlocoOperacao titulo="Retiradas" icone="🔄" ops={retiradas} />
          <BlocoOperacao titulo="Montagens" icone="🛠️" ops={montagens} />
          <BlocoOperacao titulo="Desmontagens" icone="🧰" ops={desmontagens} />

          <div>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-carvao-900">
              <span>🚨</span> Alertas
            </h3>
            {alertas.length === 0 ? (
              <p className="rounded-xl bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700">
                Nenhum alerta em aberto. Tudo em dia.
              </p>
            ) : (
              <div className="space-y-1.5">
                {alertas.map((a: any) => (
                  <Link
                    key={a.id}
                    href={a.link ?? "/notificacoes"}
                    className={`block rounded-xl border px-3 py-2 text-sm ${
                      a.severity === "critico"
                        ? "border-red-200 bg-red-50 text-red-800"
                        : a.severity === "aviso"
                          ? "border-amber-200 bg-amber-50 text-amber-900"
                          : "border-areia-300 bg-areia-50 text-carvao-700"
                    }`}
                  >
                    <span className="font-semibold">{a.title}</span>
                    {a.body && <span className="block text-xs opacity-80">{a.body}</span>}
                  </Link>
                ))}
                <Link href="/notificacoes" className="block pt-1 text-xs font-semibold text-terra-600">
                  Ver todas as notificacoes
                </Link>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ---------------------------- AGENDA DE HOJE ---------------------------- */}
      <Section
        title="Agenda de hoje"
        action={
          <Link href="/agenda" className="text-xs font-semibold text-terra-600">
            abrir agenda
          </Link>
        }
      >
        {agenda.length === 0 ? (
          <p className="py-4 text-center text-sm text-stone-500">Nenhum compromisso para hoje.</p>
        ) : (
          <ul className="divide-y divide-areia-200">
            {agenda.map((e) => (
              <li key={e.id}>
                <Link href={e.href} className="flex items-center gap-3 py-2.5">
                  <span className="w-12 shrink-0 text-sm font-bold text-carvao-900">{e.time || "--:--"}</span>
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dotFor(e.kind)}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-carvao-900">
                      {e.label} - {e.title}
                    </span>
                    <span className="block truncate text-xs text-stone-500">{e.subtitle}</span>
                  </span>
                  <Icon name="seta" className="h-4 w-4 shrink-0 text-stone-300" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ------------------------------ INDICADORES ----------------------------- */}
      <div>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-stone-500">Reservas</h2>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Hoje" value={s.reservas.hoje} href="/reservas?periodo=hoje" />
          <Stat label="Nesta semana" value={s.reservas.semana} href="/reservas?periodo=semana" />
          <Stat label="Proximas" value={s.reservas.proximas} href="/reservas?periodo=futuras" />
          <Stat label="Confirmadas" value={s.reservas.confirmadas} href="/reservas?status=confirmada" />
          <Stat label="Orcamentos pendentes" value={s.reservas.orcamentosPendentes} href="/orcamentos" />
          <Stat
            label="Em conflito"
            value={s.reservas.conflitos}
            tone={s.reservas.conflitos ? "vermelho" : undefined}
            href="/notificacoes?tipo=conflito"
          />
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-stone-500">Operacao</h2>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Entregas hoje" value={s.operacao.entregas} icon="🚚" href="/operacao" />
          <Stat label="Retiradas hoje" value={s.operacao.retiradas} icon="🔄" href="/operacao?aba=retiradas" />
          <Stat label="Montagens hoje" value={s.operacao.montagens} icon="🛠️" href="/operacao?aba=montagens" />
          <Stat
            label="Desmontagens hoje"
            value={s.operacao.desmontagens}
            icon="🧰"
            href="/operacao?aba=desmontagens"
          />
          <Stat
            label="Entregas atrasadas"
            value={s.operacao.entregasAtrasadas}
            tone={s.operacao.entregasAtrasadas ? "vermelho" : undefined}
            href="/operacao?aba=atrasadas"
          />
          <Stat
            label="Retiradas atrasadas"
            value={s.operacao.retiradasAtrasadas}
            tone={s.operacao.retiradasAtrasadas ? "vermelho" : undefined}
            href="/operacao?aba=atrasadas"
          />
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-stone-500">Financeiro do mes</h2>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label="Faturamento" value={moneyShort(s.financeiro.faturamentoMes)} href="/financeiro" />
          <Stat label="Recebido" value={moneyShort(s.financeiro.recebidoMes)} tone="verde" href="/financeiro" />
          <Stat label="A receber" value={moneyShort(s.financeiro.aReceber)} tone="vermelho" href="/financeiro?aba=receber" />
          <Stat label="Despesas" value={moneyShort(s.financeiro.despesasMes)} href="/financeiro?aba=saidas" />
          <Stat
            label="Lucro estimado"
            value={moneyShort(s.financeiro.lucro)}
            tone={s.financeiro.lucro >= 0 ? "verde" : "vermelho"}
            href="/relatorios"
          />
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-stone-500">Estoque hoje</h2>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Stat label="Disponiveis" value={s.estoque.disponiveis} href="/disponibilidade" />
          <Stat label="Reservados" value={s.estoque.reservados} href="/disponibilidade" />
          <Stat label="Em manutencao" value={s.estoque.manutencao} href="/estoque" />
          <Stat
            label="Estoque baixo"
            value={s.estoque.baixos}
            tone={s.estoque.baixos ? "vermelho" : undefined}
            href="/estoque"
          />
        </div>
      </div>

      <Card className="text-xs text-stone-500">
        Faturamento considera reservas do mes com status ativo mais fretes concluidos. A receber soma o saldo em
        aberto de todas as reservas ativas. Valores em {money(0).slice(0, 2)}.
      </Card>
    </div>
  );
}

function BlocoOperacao({ titulo, icone, ops }: { titulo: string; icone: string; ops: any[] }) {
  return (
    <div>
      <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-carvao-900">
        <span>{icone}</span> {titulo}
        <span className="rounded-full bg-areia-200 px-2 py-0.5 text-xs font-bold text-stone-600">{ops.length}</span>
      </h3>
      {ops.length === 0 ? (
        <p className="rounded-xl bg-areia-50 px-3 py-2.5 text-sm text-stone-500">Nada agendado para hoje.</p>
      ) : (
        <div className="space-y-2">
          {ops.map((o) => (
            <OperationCard key={o.id} op={o} />
          ))}
        </div>
      )}
    </div>
  );
}

function dotFor(kind: string) {
  return (
    {
      entrega: "bg-emerald-500",
      retirada: "bg-sky-500",
      montagem: "bg-amber-500",
      desmontagem: "bg-violet-500",
      frete: "bg-fuchsia-500",
      evento: "bg-[#A85C42]",
    }[kind] ?? "bg-stone-400"
  );
}
