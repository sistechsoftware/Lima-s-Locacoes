import { all } from "@/lib/db";
import Link from "next/link";
import FreightSettings from "./FreightSettings";
import { requireUser } from "@/lib/auth";
import { listUsers } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { Alerta, Badge, Card, Empty, Field, Grid, PageHeader, Section } from "@/components/ui";
import { Tabs } from "@/components/List";
import { SubmitButton } from "@/components/SubmitButton";
import ImageInput from "@/components/ImageInput";
import { addCategory, removeCategory, resetPassword, saveCompanySettings, saveFreightSettings, saveTemplates, toggleUser } from "./actions";
import { saveVehicle, deleteVehicle } from "../operacao/actions";
import { createAccount, createSupplier } from "../compras/actions";
import { money } from "@/lib/format";
import UserForm from "./UserForm";
import PasswordForm from "./PasswordForm";

export const dynamic = "force-dynamic";

export default async function ConfiguracoesPage({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string; erro?: string }>;
}) {
  const user = await requireUser();
  const { aba = "empresa", erro } = await searchParams;
  const s = await getSettings();
  const categorias = await all<any>(
    `SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS produtos FROM categories c ORDER BY c.name`,
  );
  const vehicles = await all<any>(`SELECT * FROM vehicles ORDER BY active DESC, name`);
  const fornecedores = await all<any>(
    `SELECT s.*, (SELECT COUNT(*) FROM purchases p WHERE p.supplier_id = s.id) AS compras
       FROM suppliers s ORDER BY s.active DESC, s.name`,
  );
  // o saldo de cada conta e sempre recalculado a partir das movimentacoes,
  // nunca um numero guardado que pode divergir do extrato
  const contas =
    user.role === "admin"
      ? await all<any>(
          `SELECT a.*,
                  COALESCE((SELECT SUM(p.amount_cents) FROM payments p WHERE p.account_id = a.id),0) AS entradas,
                  COALESCE((SELECT SUM(e.amount_cents) FROM expenses e WHERE e.account_id = a.id),0) AS saidas
             FROM financial_accounts a ORDER BY a.active DESC, a.name`,
        )
      : [];
  const users = user.role === "admin" ? await listUsers() : [];

  const ABAS = [
    { value: "empresa", label: "Empresa" },
    { value: "modelos", label: "Modelos" },
    { value: "categorias", label: "Categorias" },
    { value: "veiculos", label: "Veiculos" },
    { value: "fornecedores", label: "Fornecedores" },
    ...(user.role === "admin" ? [{ value: "contas", label: "Contas" }] : []),
    { value: "frete", label: "Frete" },
    ...(user.role === "admin" ? [{ value: "usuarios", label: "Usuarios" }] : []),
    { value: "conta", label: "Minha conta" },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="Configuracoes" subtitle="Dados da empresa, modelos, usuarios e permissoes" />
      <Link href="/notificacoes/preferencias" className="inline-block text-sm text-marca-600 underline">Notificacoes: dispositivos, funcoes operacionais e antecedentes</Link>
      {erro && <Alerta tone="vermelho">{erro}</Alerta>}
      {user.role !== "admin" && aba !== "conta" && (
        <Alerta tone="ambar">
          Algumas configuracoes sao restritas ao administrador. Voce pode visualizar, mas nao salvar alteracoes
          criticas.
        </Alerta>
      )}

      <Tabs items={ABAS} current={aba} base="/configuracoes" />

      {aba === "empresa" && (
        <Section title="Dados da empresa">
          <form action={saveCompanySettings} className="space-y-3">
            <Grid>
              <Field label="Nome da empresa">
                <input name="company_name" defaultValue={s.company_name} className="campo" disabled={user.role !== "admin"} />
              </Field>
              <Field label="Subtitulo">
                <input name="company_tagline" defaultValue={s.company_tagline} className="campo" disabled={user.role !== "admin"} />
              </Field>
              <Field label="CNPJ / CPF">
                <input name="company_doc" defaultValue={s.company_doc} className="campo" disabled={user.role !== "admin"} />
              </Field>
              <Field label="Telefone">
                <input name="company_phone" defaultValue={s.company_phone} className="campo" disabled={user.role !== "admin"} />
              </Field>
              <Field label="WhatsApp">
                <input name="company_whatsapp" defaultValue={s.company_whatsapp} className="campo" disabled={user.role !== "admin"} />
              </Field>
              <Field label="E-mail">
                <input name="company_email" defaultValue={s.company_email} className="campo" disabled={user.role !== "admin"} />
              </Field>
              <Field label="Endereco">
                <input name="company_address" defaultValue={s.company_address} className="campo" disabled={user.role !== "admin"} />
              </Field>
              <Field label="Cidade">
                <input name="company_city" defaultValue={s.company_city} className="campo" disabled={user.role !== "admin"} />
              </Field>
              <Field label="Chave Pix">
                <input name="pix_key" defaultValue={s.pix_key} className="campo" disabled={user.role !== "admin"} />
              </Field>
              <Field label="Caucao padrao (R$)">
                <input
                  name="default_deposit"
                  defaultValue={(Number(s.default_deposit_cents || 0) / 100).toFixed(2)}
                  inputMode="decimal"
                  className="campo"
                  disabled={user.role !== "admin"}
                />
              </Field>
            </Grid>
            <Field label="Dados bancarios">
              <textarea name="bank_info" defaultValue={s.bank_info} rows={2} className="campo" disabled={user.role !== "admin"} />
            </Field>
            <Field label="Logo da empresa">
              <div className="flex items-center gap-3">
                {s.company_logo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.company_logo} alt="Logo" className="h-14 w-14 rounded-xl border border-nuvem-300 object-contain" />
                )}
                <ImageInput name="logo_file" disabled={user.role !== "admin"} />
              </div>
            </Field>
            {user.role === "admin" && <SubmitButton>Salvar dados da empresa</SubmitButton>}
          </form>
        </Section>
      )}

      {aba === "modelos" && (
        <Section title="Modelos de contrato e WhatsApp">
          <form action={saveTemplates} className="space-y-4">
            <Field label="Modelo do contrato / termo de responsabilidade" hint="Use {{campo}} para inserir dados automaticamente.">
              <textarea
                name="contract_template"
                defaultValue={s.contract_template}
                rows={16}
                className="campo font-mono text-xs"
                disabled={user.role !== "admin"}
              />
            </Field>
            <p className="text-xs text-stone-500">
              Campos do contrato: {"{{cliente}}"}, {"{{cliente_doc}}"} (CPF/CNPJ), {"{{cliente_telefone}}"},{" "}
              {"{{cliente_email}}"}, {"{{cliente_endereco}}"}, {"{{cliente_bairro}}"}, {"{{cliente_cidade}}"},{" "}
              {"{{empresa}}"}, {"{{cnpj}}"}, {"{{endereco_empresa}}"}, {"{{telefone_empresa}}"},{" "}
              {"{{cidade_empresa}}"}, {"{{contrato}}"}, {"{{reserva}}"}, {"{{data_evento}}"},{" "}
              {"{{endereco_evento}}"}, {"{{itens}}"}, {"{{data_entrega}}"}, {"{{data_retirada}}"},{" "}
              {"{{valor_itens}}"}, {"{{valor_frete}}"}, {"{{valor_montagem}}"}, {"{{valor_desmontagem}}"},{" "}
              {"{{valor_outros}}"}, {"{{valor_desconto}}"}, {"{{valor_total}}"}, {"{{valor_caucao}}"},{" "}
              {"{{data_hoje}}"}. Um campo sem cadastro vira uma linha para preencher a mao no impresso.
            </p>
            <Grid>
              <Field label="Mensagem de confirmacao">
                <textarea name="wa_confirm" defaultValue={s.wa_confirm} rows={3} className="campo" disabled={user.role !== "admin"} />
              </Field>
              <Field label="Lembrete de entrega">
                <textarea name="wa_delivery" defaultValue={s.wa_delivery} rows={3} className="campo" disabled={user.role !== "admin"} />
              </Field>
              <Field label="Lembrete de retirada">
                <textarea name="wa_pickup" defaultValue={s.wa_pickup} rows={3} className="campo" disabled={user.role !== "admin"} />
              </Field>
              <Field label="Cobranca de pagamento">
                <textarea name="wa_payment" defaultValue={s.wa_payment} rows={3} className="campo" disabled={user.role !== "admin"} />
              </Field>
              <Field label="Envio de orcamento" className="sm:col-span-2">
                <textarea name="wa_quote" defaultValue={s.wa_quote} rows={3} className="campo" disabled={user.role !== "admin"} />
              </Field>
            </Grid>
            <p className="text-xs text-stone-500">
              Campos das mensagens de WhatsApp: {"{{cliente}}"}, {"{{empresa}}"}, {"{{reserva}}"},{" "}
              {"{{orcamento}}"}, {"{{data_evento}}"}, {"{{hora_entrega}}"}, {"{{hora_retirada}}"},{" "}
              {"{{endereco_evento}}"}, {"{{itens}}"}, {"{{valor_total}}"}, {"{{saldo}}"}, {"{{pix}}"}.
            </p>
            {user.role === "admin" && <SubmitButton>Salvar modelos</SubmitButton>}
          </form>
        </Section>
      )}

      {aba === "categorias" && (
        <Section title="Categorias de produtos">
          <form action={addCategory} className="mb-3 flex gap-2">
            <input name="name" placeholder="Nova categoria" className="campo flex-1" required />
            <SubmitButton variant="secundario">Adicionar</SubmitButton>
          </form>
          {categorias.length === 0 ? (
            <Empty>Nenhuma categoria cadastrada.</Empty>
          ) : (
            <ul className="space-y-1.5">
              {categorias.map((c) => (
                <li key={c.id} className="flex items-center justify-between rounded-xl border border-nuvem-300 bg-white px-3 py-2.5">
                  <span className="text-sm font-medium">
                    {c.name} <span className="text-xs text-stone-400">({c.produtos} produto(s))</span>
                  </span>
                  {user.role === "admin" && (
                    <form action={removeCategory}>
                      <input type="hidden" name="id" value={c.id} />
                      <SubmitButton variant="perigo" className="px-2 py-1 text-xs" confirm={`Remover a categoria ${c.name}?`}>
                        Remover
                      </SubmitButton>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {aba === "veiculos" && (
        <Section title="Veiculos">
          <form action={saveVehicle} className="mb-4 grid grid-cols-2 gap-2">
            <input name="name" placeholder="Nome (ex.: Carro + carretinha) *" className="campo col-span-2" required />
            <input name="plate" placeholder="Placa" className="campo" />
            <input name="model" placeholder="Modelo" className="campo" />
            <input name="capacity" placeholder="Capacidade" className="campo" />
            <input name="notes" placeholder="Observacoes" className="campo" />
            <div className="col-span-2">
              <SubmitButton variant="secundario" className="w-full">
                Adicionar veiculo
              </SubmitButton>
            </div>
          </form>
          {vehicles.length === 0 ? (
            <Empty>Nenhum veiculo cadastrado.</Empty>
          ) : (
            <ul className="space-y-1.5">
              {vehicles.map((v) => (
                <li key={v.id} className="flex items-center justify-between rounded-xl border border-nuvem-300 bg-white px-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">
                      {v.name} {!v.active && <Badge tone="cinza">Inativo</Badge>}
                    </span>
                    <span className="block text-xs text-stone-500">
                      {[v.plate, v.model, v.capacity].filter(Boolean).join(" - ")}
                    </span>
                  </span>
                  {user.role === "admin" && (
                    <form action={deleteVehicle}>
                      <input type="hidden" name="id" value={v.id} />
                      <SubmitButton variant="perigo" className="px-2 py-1 text-xs" confirm={`Remover ${v.name}?`}>
                        Remover
                      </SubmitButton>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {aba === "frete" && <FreightSettings settings={s} admin={user.role === "admin"} />}

      {aba === "fornecedores" && (
        <Section title="Fornecedores">
          <form action={createSupplier} className="mb-4 grid grid-cols-2 gap-2">
            <input name="name" placeholder="Nome do fornecedor *" className="campo col-span-2" required />
            <input name="doc" placeholder="CNPJ / CPF" className="campo" />
            <input name="phone" placeholder="Telefone" className="campo" />
            <input name="email" placeholder="E-mail" className="campo" />
            <input name="notes" placeholder="Observacoes" className="campo" />
            <div className="col-span-2">
              <SubmitButton variant="secundario" className="w-full">
                Adicionar fornecedor
              </SubmitButton>
            </div>
          </form>
          {fornecedores.length === 0 ? (
            <Empty>Nenhum fornecedor cadastrado. Eles aparecem no seletor da compra.</Empty>
          ) : (
            <ul className="space-y-1.5">
              {fornecedores.map((f: any) => (
                <li
                  key={f.id}
                  className="flex items-center justify-between rounded-xl border border-nuvem-300 bg-white px-3 py-2.5"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-tinta-900">
                      {f.name} {!f.active && <Badge tone="cinza">Inativo</Badge>}
                    </span>
                    <span className="block text-xs text-stone-500">
                      {[f.doc, f.phone, f.email].filter(Boolean).join(" - ") || "sem contato"}
                      {f.compras > 0 ? ` - ${f.compras} compra(s)` : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {aba === "contas" && user.role === "admin" && (
        <Section title="Contas financeiras">
          <form action={createAccount} className="mb-4 grid grid-cols-2 gap-2">
            <input name="name" placeholder="Nome da conta *" className="campo col-span-2" required />
            <select name="kind" defaultValue="banco" className="campo">
              <option value="banco">Conta corrente</option>
              <option value="dinheiro">Dinheiro</option>
              <option value="digital">Conta digital</option>
              <option value="poupanca">Poupanca</option>
              <option value="outro">Outra</option>
            </select>
            <input name="bank" placeholder="Banco" className="campo" />
            <input name="initial_balance" placeholder="Saldo inicial (R$)" inputMode="decimal" className="campo" />
            <input name="notes" placeholder="Observacoes" className="campo" />
            <div className="col-span-2">
              <SubmitButton variant="secundario" className="w-full">
                Adicionar conta
              </SubmitButton>
            </div>
          </form>
          {contas.length === 0 ? (
            <Empty>
              Nenhuma conta cadastrada. Cadastre ao menos uma para saber de qual conta cada pagamento saiu.
            </Empty>
          ) : (
            <ul className="space-y-1.5">
              {contas.map((c: any) => {
                const saldo = c.initial_balance_cents + c.entradas - c.saidas;
                return (
                  <li key={c.id} className="rounded-xl border border-nuvem-300 bg-white px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-tinta-900">
                          {c.name} {!c.active && <Badge tone="cinza">Inativa</Badge>}
                        </span>
                        <span className="block text-xs text-stone-500">
                          {c.kind}
                          {c.bank ? ` - ${c.bank}` : ""} - inicial {money(c.initial_balance_cents)}
                        </span>
                      </span>
                      <span className={`shrink-0 text-sm font-bold ${saldo < 0 ? "text-red-600" : "text-tinta-900"}`}>
                        {money(saldo)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-stone-500">
                      entradas {money(c.entradas)} - saidas {money(c.saidas)}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-2 text-xs text-stone-500">
            O saldo e recalculado a partir das movimentacoes, nunca guardado, para nao divergir do extrato.
          </p>
        </Section>
      )}

      {aba === "usuarios" && user.role === "admin" && (
        <div className="space-y-4">
          <Section title="Novo usuario">
            <UserForm />
          </Section>
          <Section title="Usuarios do sistema">
            <ul className="space-y-1.5">
              {users.map((u: any) => (
                <li key={u.id} className="rounded-xl border border-nuvem-300 bg-white p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <span className="text-sm font-bold text-tinta-900">{u.name}</span>
                      <span className="ml-2 text-xs text-stone-500">@{u.username}</span>
                      <Badge tone={u.role === "admin" ? "terracota" : "cinza"} className="ml-2">
                        {u.role}
                      </Badge>
                      {!u.active && <Badge tone="vermelho" className="ml-1">Inativo</Badge>}
                    </span>
                    {u.id !== user.id && (
                      <form action={toggleUser}>
                        <input type="hidden" name="id" value={u.id} />
                        <SubmitButton variant="secundario" className="px-2.5 py-1 text-xs">
                          {u.active ? "Inativar" : "Reativar"}
                        </SubmitButton>
                      </form>
                    )}
                  </div>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs font-semibold text-marca-600">Redefinir senha</summary>
                    <form action={resetPassword} className="mt-2 flex gap-2">
                      <input type="hidden" name="id" value={u.id} />
                      <input name="password" type="password" placeholder="Nova senha" minLength={6} className="campo" required />
                      <SubmitButton variant="secundario" className="shrink-0">
                        Salvar
                      </SubmitButton>
                    </form>
                  </details>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-stone-500">
              Operadores acessam reservas, clientes, estoque, agenda e financeiro do dia a dia, mas nao podem excluir
              registros nem alterar configuracoes criticas da empresa.
            </p>
          </Section>
        </div>
      )}

      {aba === "conta" && (
        <Section title="Minha conta">
          <p className="mb-3 text-sm text-stone-600">
            {user.name} - perfil <b className="capitalize">{user.role}</b>
          </p>
          <PasswordForm />
        </Section>
      )}
    </div>
  );
}
