import { all } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";
import ProductForm from "../ProductForm";
import { createProduct } from "../actions";

export default async function NovoProdutoPage() {
  await requireUser();
  const categories = all<any>(`SELECT id, name FROM categories WHERE active = 1 ORDER BY name`);
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title="Novo produto" subtitle="Cadastro de equipamento para locacao" />
      <Card>
        <ProductForm action={createProduct} categories={categories} />
      </Card>
    </div>
  );
}
