import { notFound } from "next/navigation";
import { all, one } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";
import ProductForm from "../../ProductForm";
import { updateProduct } from "../../actions";

export default async function EditarProdutoPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const product = await one<any>(`SELECT * FROM products WHERE id = ?`, [Number(id)]);
  if (!product) notFound();
  const categories = await all<any>(`SELECT id, name FROM categories WHERE active = 1 ORDER BY name`);
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title="Editar produto" subtitle={product.name} />
      <Card>
        <ProductForm action={updateProduct} product={product} categories={categories} submitLabel="Salvar alteracoes" />
      </Card>
    </div>
  );
}
