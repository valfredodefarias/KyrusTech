import { useEffect, useState, useRef } from 'react';
import { Plus } from 'lucide-react';
import { toPublicAssetUrl } from '../services/api';

const decodeHtmlSimple = (html: string) => {
  if (!html) return '';
  const txt = document.createElement("textarea");
  txt.innerHTML = html;
  return txt.value;
};

export function SearchableProductSelect({
  products,
  selectedValue,
  onChange,
  onCreateClick,
  placeholder = 'Selecione um produto'
}: {
  products: any[];
  selectedValue: string;
  onChange: (productId: string) => void;
  onCreateClick?: () => void;
  placeholder?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);

  const selectedProduct = products.find((p) => String(p.id) === String(selectedValue));

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filtered = products.filter((p) =>
    decodeHtmlSimple(p.nome).toLowerCase().includes(search.toLowerCase())
  );

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
  };

  return (
    <div ref={wrapperRef} className="relative w-full">
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full cursor-pointer items-center justify-between rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus-within:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white min-w-0"
      >
        <div className="flex-1 min-w-0 mr-2">
          {selectedProduct ? (
            <div className="flex items-center gap-2 min-w-0">
              {selectedProduct.imagem_url && (
                <img
                  src={toPublicAssetUrl(selectedProduct.imagem_url) ?? undefined}
                  alt={decodeHtmlSimple(selectedProduct.nome)}
                  className="w-5 h-5 rounded object-cover border border-slate-200 dark:border-slate-800 shrink-0 bg-white"
                />
              )}
              <span className={`inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.05em] shrink-0 ${
                selectedProduct.tipo === 'SERVICO'
                  ? 'bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300'
                  : 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
              }`}>
                {selectedProduct.tipo === 'SERVICO' ? 'Serviço' : 'Produto'}
              </span>
              {selectedProduct.revisao_pendente && (
                <span className="inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.05em] shrink-0 bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                  Revisar
                </span>
              )}
              <span className="truncate text-slate-900 dark:text-white font-medium">{decodeHtmlSimple(selectedProduct.nome)} - {formatCurrency(Number(selectedProduct.preco_unitario))}</span>
            </div>
          ) : (
            <span className="text-slate-400">{placeholder}</span>
          )}
        </div>
        <span className="text-slate-400 text-xs shrink-0">▼</span>
      </div>

      {isOpen && (
        <div className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-800 dark:bg-slate-950">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Pesquisar..."
            className="mb-2 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-700 outline-none focus:border-blue-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
            onClick={(e) => e.stopPropagation()}
          />
          {onCreateClick && (
            <div
              onClick={(e) => {
                e.stopPropagation();
                onCreateClick();
                setIsOpen(false);
                setSearch('');
              }}
              className="cursor-pointer rounded-lg px-3 py-2 text-xs transition bg-blue-50 hover:bg-blue-100 text-blue-600 font-bold dark:bg-blue-950/40 dark:hover:bg-blue-900/60 dark:text-blue-400 mb-2 flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              + Cadastrar Novo Item
            </div>
          )}
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-slate-400">Nenhum item encontrado</div>
          ) : (
            filtered.map((prod) => (
              <div
                key={prod.id}
                onClick={() => {
                  onChange(String(prod.id));
                  setIsOpen(false);
                  setSearch('');
                }}
                className={`cursor-pointer rounded-xl p-2.5 text-xs transition hover:bg-slate-100 dark:hover:bg-slate-900 border-b border-slate-100/50 dark:border-slate-900/50 last:border-b-0 ${
                  String(prod.id) === String(selectedValue)
                    ? 'bg-blue-50/50 text-blue-600 dark:bg-blue-950/20 dark:text-blue-400 font-semibold'
                    : 'text-slate-700 dark:text-slate-300'
                }`}
              >
                <div className="flex gap-2.5 items-start min-w-0 w-full">
                  {prod.imagem_url ? (
                    <img
                      src={toPublicAssetUrl(prod.imagem_url) ?? undefined}
                      alt={decodeHtmlSimple(prod.nome)}
                      className="w-10 h-10 rounded-lg object-cover border border-slate-200 dark:border-slate-800 shrink-0 bg-white"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-lg border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 flex items-center justify-center text-[8px] font-bold text-slate-400 shrink-0">
                      N/A
                    </div>
                  )}

                  <div className="flex-1 min-w-0 flex flex-col gap-1">
                    <div className="font-bold text-slate-900 dark:text-white truncate">
                      {decodeHtmlSimple(prod.nome)}
                    </div>

                    <div className="flex flex-wrap items-center gap-1 text-[9px]">
                      <span className={`inline-flex rounded px-1.5 py-0.5 font-bold uppercase shrink-0 ${
                        prod.tipo === 'SERVICO'
                          ? 'bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300'
                          : 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
                      }`}>
                        {prod.tipo === 'SERVICO' ? 'Serviço' : 'Produto'}
                      </span>

                      {prod.revisao_pendente && (
                        <span className="inline-flex rounded px-1.5 py-0.5 font-bold uppercase shrink-0 bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                          Revisar
                        </span>
                      )}

                      {prod.tipo === 'PRODUTO' && (
                        <span className={`inline-flex rounded px-1.5 py-0.5 font-bold uppercase shrink-0 ${
                          Number(prod.quantidade_estoque || 0) > 0
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300'
                            : 'bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300'
                        }`}>
                          Estoque: {prod.quantidade_estoque ?? 0}
                        </span>
                      )}

                      <span className="font-bold text-slate-500 dark:text-slate-400 ml-auto text-[10px]">
                        {formatCurrency(Number(prod.preco_unitario))}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
