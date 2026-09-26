import { all } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";
import ProductForm from "../ProductForm";
import { createProduct } from "../actions";
import { gerarCodigoProduto } from "@/lib/products";

export const dynamic = "force-dynamic";

export default async function NovoProdutoPage() {
  await requireUser();
  const categories = await all<any>(`SELECT id, name FROM categories WHERE active = 1 ORDER BY name`);
  const simpleProducts = await all<any>(
    `SELECT id, name, code, total_qty, rent_price_cents FROM products
      WHERE active = 1 AND kind <> 'kit' ORDER BY name`,
  );
  /*
   * Sugestao de codigo para exibir no formulario. Se falhar, o formulario
   * abre sem codigo: quem gera de verdade e a acao de criar, no INSERT.
   */
  let sugestaoCodigo: string | undefined;
  try {
    sugestaoCodigo = await gerarCodigoProduto();
  } catch (e) {
    console.error("Novo Produto: falha ao sugerir codigo", e);
  }
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title="Novo Produto" subtitle="Produto simples ou kit composto" />
      {sugestaoCodigo === undefined && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          Não foi possível sugerir um código agora. O código será gerado no momento do cadastro.
        </div>
      )}
      <Card>
        <ProductForm
          action={createProduct}
          categories={categories}
          simpleProducts={simpleProducts}
          sugestaoCodigo={sugestaoCodigo}
        />
      </Card>
    </div>
  );
}
