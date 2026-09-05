import { lateOperations, operationsBetween } from "@/lib/queries";
import { requireUser } from "@/lib/auth";
import { addDays, dateBR, today } from "@/lib/format";
import { Card, Empty, LinkButton, PageHeader } from "@/components/ui";
import { OperationCard } from "@/components/OperationCard";
import { Tabs } from "@/components/List";

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

  return (
    <div className="space-y-4">
      <PageHeader
        title="Entregas e retiradas"
        subtitle={dias === 0 ? dateBR(data) : `${dateBR(data)} ate ${dateBR(ate)}`}
        action={<LinkButton href="/operacao/nova" variant="primario">+ Nova operacao</LinkButton>}
      />

      <Card>
        <form className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="aba" value={aba} />
          <label className="min-w-[8rem] flex-1">
            <span className="rotulo">Data</span>
            <input type="date" name="data" defaultValue={data} className="campo" />
          </label>
          <label className="min-w-[8rem] flex-1">
            <span className="rotulo">Proximos dias</span>
            <select name="dias" defaultValue={String(dias)} className="campo">
              <option value="0">Somente este dia</option>
              <option value="1">+1 dia</option>
              <option value="3">+3 dias</option>
              <option value="7">+7 dias</option>
              <option value="30">+30 dias</option>
            </select>
          </label>
          <button className="rounded-xl bg-carvao-900 px-5 py-2.5 text-sm font-semibold text-white">Filtrar</button>
        </form>
      </Card>

      <Tabs
        items={ABAS.map((a) => ({ value: a.value, label: a.label, count: (contagem as any)[a.value] }))}
        current={aba}
        base={`/operacao?data=${data}&dias=${dias}`}
      />

      {ops.length === 0 ? (
        <Empty>Nenhuma operacao neste filtro.</Empty>
      ) : (
        <div className="space-y-2">
          {ops.map((o: any) => (
            <OperationCard key={o.id} op={o} showDate={dias > 0 || aba === "atrasadas"} />
          ))}
        </div>
      )}
    </div>
  );
}
