import { lateOperations, operationsBetween } from "@/lib/queries";
import { requireUser } from "@/lib/auth";
import { addDays, dateBR, today } from "@/lib/format";
import { Card, Empty, LinkButton, PageHeader } from "@/components/ui";
import { OperationCard } from "@/components/OperationCard";
import { NextRow, Tabs } from "@/components/List";

export const dynamic = "force-dynamic";

const ABAS = [
  { value: "entregas", label: "Entregas", kind: "entrega" },
  { value: "retiradas", label: "Retiradas", kind: "retirada" },
  { value: "montagens", label: "Montagens", kind: "montagem" },
  { value: "desmontagens", label: "Desmontagens", kind: "desmontagem" },
  { value: "todas", label: "Todas", kind: null },
  { value: "atrasadas", label: "Atrasadas", kind: null },
];

export default async function OperacaoPage({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string; data?: string; dias?: string }>;
}) {
  await requireUser();
  const sp = await searchParams;
  const aba = sp.aba ?? "entregas";
  const data = sp.data || today();
  const dias = Math.max(0, Math.min(30, Number(sp.dias ?? 0)));
  const ate = addDays(data, dias);

  // Uma leitura do periodo cobre a aba aberta e os numeros de todas as abas:
  // consultar cada tipo separadamente custava seis idas ao banco.
  const [atrasadas, doPeriodo] = await Promise.all([lateOperations(), operationsBetween(data, ate)]);
  const def = ABAS.find((a) => a.value === aba) ?? ABAS[0];
  const ops =
    aba === "atrasadas" ? atrasadas : def.kind ? doPeriodo.filter((o: any) => o.kind === def.kind) : doPeriodo;

  const contar = (kind: string) => doPeriodo.filter((o: any) => o.kind === kind).length;
  const contagem = {
    entregas: contar("entrega"),
    retiradas: contar("retirada"),
    montagens: contar("montagem"),
    desmontagens: contar("desmontagem"),
    todas: doPeriodo.length,
    atrasadas: atrasadas.length,
  };

  // Destaque visual da proxima operacao do dia: a primeira ainda pendente na
  // ordem cronologica (o SQL ja ordena por scheduled_at), so quando a lista e
  // de um unico dia. Apenas visual: nao altera operacao, reserva ou estoque.
  const mostrarData = dias > 0 || aba === "atrasadas";
  const proximasPorId = new Set<number>();
  if (!mostrarData) {
    for (const o of ops) {
      if (o.status !== "concluida" && o.status !== "cancelada") {
        proximasPorId.add(o.id);
        break;
      }
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Entregas e Retiradas"
        subtitle={dias === 0 ? dateBR(data) : `${dateBR(data)} até ${dateBR(ate)}`}
        action={<LinkButton href="/operacao/nova" variant="primario">+ Nova Operação</LinkButton>}
      />

      <Card>
        {/* Os campos dividem a largura em partes iguais e o rotulo fica inteiro
            em cima — antes, "Data" e "Proximos dias" colidiam no celular */}
        <form className="pilha-filtros">
          <input type="hidden" name="aba" value={aba} />
          <label className="min-w-0 flex-1 basis-40">
            <span className="rotulo">Data</span>
            <input type="date" name="data" defaultValue={data} className="campo data-hora" />
          </label>
          <label className="min-w-0 flex-1 basis-40">
            <span className="rotulo">Próximos dias</span>
            <select name="dias" defaultValue={String(dias)} className="campo">
              <option value="0">Somente este dia</option>
              <option value="1">+1 dia</option>
              <option value="3">+3 dias</option>
              <option value="7">+7 dias</option>
              <option value="30">+30 dias</option>
            </select>
          </label>
          <button className="w-full rounded-xl bg-marca-600 px-5 py-2.5 text-sm font-semibold text-white sm:w-auto">Filtrar</button>
        </form>
      </Card>

      <Tabs
        items={ABAS.map((a) => ({ value: a.value, label: a.label, count: (contagem as any)[a.value] }))}
        current={aba}
        base={`/operacao?data=${data}&dias=${dias}`}
      />

      {ops.length === 0 ? (
        <Empty>Nenhuma operação neste filtro.</Empty>
      ) : (
        <div className="space-y-2">
          {ops.map((o: any) => {
            const isNext = proximasPorId.has(o.id);
            return (
              <NextRow key={o.id} isNext={isNext}>
                <OperationCard op={o} showDate={mostrarData} isNext={isNext} />
              </NextRow>
            );
          })}
        </div>
      )}
    </div>
  );
}
