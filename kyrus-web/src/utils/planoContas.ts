export interface PlanoContaOperacionalLike {
  id: number;
  conta_pai_id?: number | null;
  eh_operacional?: boolean | null;
}

export function buildOperationalCategoriaIds<T extends PlanoContaOperacionalLike>(categorias: T[]): Set<number> {
  const filhosPorPai = new Map<number, number[]>();
  const operacionais = new Set<number>();

  categorias.forEach((categoria) => {
    const categoriaId = Number(categoria.id);
    const parentId = Number(categoria.conta_pai_id);

    if (Number.isFinite(parentId) && parentId > 0) {
      const filhos = filhosPorPai.get(parentId) || [];
      filhos.push(categoriaId);
      filhosPorPai.set(parentId, filhos);
    }

    if (categoria.eh_operacional !== false) {
      operacionais.add(categoriaId);
    }
  });

  const fila = Array.from(operacionais);
  while (fila.length > 0) {
    const atual = fila.shift()!;
    const filhos = filhosPorPai.get(atual) || [];
    filhos.forEach((filhoId) => {
      if (!operacionais.has(filhoId)) {
        operacionais.add(filhoId);
        fila.push(filhoId);
      }
    });
  }

  return operacionais;
}