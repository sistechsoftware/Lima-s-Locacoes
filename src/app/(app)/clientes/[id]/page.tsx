import Link from "next/link";
import { notFound } from "next/navigation";
import { all } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getCustomer } from "@/lib/queries";
import { logsFor } from "@/lib/audit";
import { RESERVATION_STATUS, QUOTE_STATUS } from "@/lib/domain";
import { dateBR, docBR, mapsLink, money, phoneBR, utcParaLocal, waLink } from "@/lib/format";
import { Alerta, Badge, Card, Empty, LinkButton, PageHeader, Row, Section, StatusBadge, Stat } from "@/components/ui";
import { ListRow } from "@/components/List";
import { Icon } from "@/components/Icons";
import { deleteCustomer, toggleCustomer } from "../actions";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";

export default async function ClientePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ aviso?: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const { aviso } = await searchParams;
  const c = await getCustomer(Number(id));
  if (!c) notFound();

  const reservas = await all<any>(
    `SELECT r.*, (SELECT COALESCE(SUM(amount_cents),0) FROM payments p WHERE p.reservation_id = r.id) AS paid
       FROM reservations r WHERE r.customer_id = ? ORDER BY r.event_date DESC LIMIT 50`,
    [c.id],
  );
  const orcamentos = await all<any>(`SELECT * FROM quotes WHERE customer_id = ? ORDER BY id DESC LIMIT 20`, [c.id]);
  const pagamentos = await all<any>(
    `SELECT p.*, r.number FROM payments p LEFT JOIN reservations r ON r.id = p.reservation_id
      WHERE r.customer_id = ? ORDER BY p.paid_at DESC LIMIT 20`,
    [c.id],
  );
  const historico = (await logsFor("cliente", c.id)).slice(0, 10);

  const wa = waLink(c.whatsapp || c.phone, `Ola, ${c.name.split(" ")[0]}! Aqui e da Lima's Locacoes.`);
  const maps = mapsLink(c.address, c.district, c.city);

  return (
    <div className="space-y-4">
      <PageHeader
        title={c.name}
        subtitle={[docBR(c.doc), phoneBR(c.phone)].filter(Boolean).join(" - ") || "Cliente"}
        action={
          <>
            <LinkButton href={`/reservas/nova?cliente=${c.id}`} variant="primario">
              + Nova reserva
            </LinkButton>
            <LinkButton href={`/orcamentos/novo?cliente=${c.id}`}>+ Orcamento</LinkButton>
            <LinkButton href={`/clientes/${c.id}/editar`}>Editar</LinkButton>
          </>
        }
      />

      {aviso === "inativado" && (
        <Alerta tone="ambar" title="Cliente inativado">
          O cliente possui historico de locacoes, por isso foi inativado em vez de excluido.
        </Alerta>
      )}
      {!c.active && <Alerta tone="ambar">Este cliente esta inativo.</Alerta>}

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat label="Locacoes" value={c.locacoes} />
        <Stat label="Total gasto" value={money(c.total_cents)} />
        <Stat label="Saldo em aberto" value={money(c.saldo_cents)} tone={c.saldo_cents > 0 ? "vermelho" : "verde"} />
        <Stat label="Canceladas" value={c.canceladas} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Dados do cliente">
          <Row label="CPF / CNPJ" value={docBR(c.doc) || "-"} />
          <Row label="Telefone" value={phoneBR(c.phone) || "-"} />
          <Row label="WhatsApp" value={phoneBR(c.whatsapp) || "-"} />
          <Row label="E-mail" value={c.email || "-"} />
          <Row label="Endereco" value={c.address || "-"} />
          <Row label="Bairro" value={c.district || "-"} />
          <Row label="Cidade" value={c.city || "-"} />
          <Row label="CEP" value={c.zip || "-"} />
          <Row label="Ultima locacao" value={c.ultima ? dateBR(c.ultima) : "-"} />
          <Row label="Proxima locacao" value={c.proxima ? dateBR(c.proxima) : "-"} />
          {c.notes && <Row label="Observacoes" value={c.notes} />}

          <div className="mt-3 flex flex-wrap gap-2">
            {wa && (
              <a
                href={wa}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white"
              >
                <Icon name="whatsapp" className="h-4 w-4" /> Enviar WhatsApp
              </a>
            )}
            {maps && (
              <a
                href={maps}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-xl border border-nuvem-300 bg-white px-4 py-2.5 text-sm font-semibold"
              >
                <Icon name="operacao" className="h-4 w-4" /> Ver rota
              </a>
            )}
            {c.phone && (
              <a
                href={`tel:${c.phone}`}
                className="inline-flex items-center gap-2 rounded-xl border border-nuvem-300 bg-white px-4 py-2.5 text-sm font-semibold"
              >
                Ligar
              </a>
            )}
          </div>
        </Section>

        <Section title={`Reservas (${reservas.length})`}>
          {reservas.length === 0 ? (
            <Empty>Nenhuma reserva para este cliente.</Empty>
          ) : (
            <div className="space-y-2">
              {reservas.map((r) => (
                <ListRow
                  key={r.id}
                  href={`/reservas/${r.id}`}
                  badges={<StatusBadge defs={RESERVATION_STATUS} value={r.status} />}
                  title={`${r.number} - ${dateBR(r.event_date)}`}
                  subtitle={[r.address, r.district].filter(Boolean).join(", ")}
                  right={
                    <>
                      <p className="text-sm font-bold">{money(r.total_cents)}</p>
                      {r.total_cents - r.paid > 0 && r.status !== "cancelada" && (
                        <p className="text-xs text-red-600">saldo {money(r.total_cents - r.paid)}</p>
                      )}
                    </>
                  }
                />
              ))}
            </div>
          )}
        </Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={`Orcamentos (${orcamentos.length})`}>
          {orcamentos.length === 0 ? (
            <Empty>Nenhum orcamento.</Empty>
          ) : (
            <div className="space-y-2">
              {orcamentos.map((q) => (
                <ListRow
                  key={q.id}
                  href={`/orcamentos/${q.id}`}
                  badges={<StatusBadge defs={QUOTE_STATUS} value={q.status} />}
                  title={`${q.number} - ${dateBR(q.event_date)}`}
                  right={<p className="text-sm font-bold">{money(q.total_cents)}</p>}
                />
              ))}
            </div>
          )}
        </Section>

        <Section title="Pagamentos recentes">
          {pagamentos.length === 0 ? (
            <Empty>Nenhum pagamento registrado.</Empty>
          ) : (
            <ul className="divide-y divide-nuvem-200">
              {pagamentos.map((p) => (
                <li key={p.id} className="flex items-center justify-between py-2 text-sm">
                  <span>
                    <span className="font-semibold">{dateBR(p.paid_at)}</span>
                    <span className="ml-2 text-stone-500">{p.number}</span>
                  </span>
                  <span className="font-bold text-emerald-600">{money(p.amount_cents)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {historico.length > 0 && (
        <Section title="Historico de alteracoes">
          <ul className="space-y-1.5 text-sm">
            {historico.map((h: any) => (
              <li key={h.id} className="flex gap-2 text-stone-600">
                <span className="shrink-0 text-xs text-stone-400">{utcParaLocal(h.created_at)}</span>
                <span>{h.summary}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {user.role === "admin" && (
        <Card className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-tinta-900">Area do administrador</p>
            <p className="text-xs text-stone-500">
              Clientes com historico sao inativados em vez de excluidos, para preservar as reservas.
            </p>
          </div>
          <div className="flex gap-2">
            <form action={toggleCustomer}>
              <input type="hidden" name="id" value={c.id} />
              <SubmitButton variant="secundario">{c.active ? "Inativar" : "Reativar"}</SubmitButton>
            </form>
            <form action={deleteCustomer}>
              <input type="hidden" name="id" value={c.id} />
              <SubmitButton variant="perigo" confirm={`Excluir o cliente ${c.name}? Esta acao nao pode ser desfeita.`}>
                Excluir
              </SubmitButton>
            </form>
          </div>
        </Card>
      )}

      <p className="text-center">
        <Link href="/clientes" className="text-sm font-semibold text-marca-600">
          Voltar para clientes
        </Link>
      </p>
    </div>
  );
}
