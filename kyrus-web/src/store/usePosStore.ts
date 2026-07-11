import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { StateStorage } from 'zustand/middleware';
import { api } from '../services/api';
import { useAuthStore } from './authStore';

// Custom IndexedDB Storage Driver
const dbName = 'kyrus-pdv-db';
const storeName = 'zustand-pos-store';

const getDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const indexedDBStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.get(name);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  },
  setItem: async (name: string, value: string): Promise<void> => {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.put(value, name);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  },
  removeItem: async (name: string): Promise<void> => {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.delete(name);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  },
};

export interface SaleItem {
  produto_id: number;
  quantidade: number;
  desconto: number;
  preco_unitario: number | null;
}

export interface SalePayment {
  tipo_pagamento: string;
  valor: number;
  numero_parcelas: number;
  valor_parcela: number | null;
  data_pagamento: string | null;
  bandeira: string;
}

export interface Sale {
  idempotency_key: string;
  entidade_id: number;
  centro_custo_id: number;
  vendedor_id: number;
  desconto: number;
  status: string;
  itens: SaleItem[];
  pagamentos: SalePayment[];
  rv: string | null;
  data_pagamento: string | null;
  observacao: string | null;
  comprovante_urls?: string[];
  comprovanteFiles?: { name: string; type: string; data: string }[]; // Base64 files

  // Auxiliary fields for local display
  clienteNome?: string;
  vendedorNome?: string;
  centroCustoNome?: string;
  itensNomes?: string;
  dataHoraLocal?: string; // ISO String
  empresa_id?: number;
}

interface PosState {
  pendingSales: Sale[];
  isOnline: boolean;
  isSyncing: boolean;
  addSale: (sale: Omit<Sale, 'idempotency_key'>) => void;
  syncPendingSales: () => Promise<void>;
  setOnline: (status: boolean) => void;
}

export const usePosStore = create<PosState>()(
  persist(
    (set, get) => ({
      pendingSales: [],
      isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
      isSyncing: false,

      addSale: (saleData) => {
        const idempotency_key = crypto.randomUUID
          ? crypto.randomUUID()
          : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
              const r = (Math.random() * 16) | 0;
              const v = c === 'x' ? r : (r & 0x3) | 0x8;
              return v.toString(16);
            });

        const authState = useAuthStore.getState();
        const companyId = authState.empresa?.id ?? authState.user?.empresa_id;

        const newSale: Sale = {
          ...saleData,
          idempotency_key,
          dataHoraLocal: new Date().toISOString(),
          empresa_id: companyId ? Number(companyId) : undefined
        };

        set((state) => ({
          pendingSales: [...state.pendingSales, newSale],
        }));

        // Trigger synchronization in background if online
        if (get().isOnline) {
          void get().syncPendingSales();
        }
      },

      syncPendingSales: async () => {
        const { pendingSales, isSyncing, isOnline } = get();
        if (isSyncing || !isOnline || pendingSales.length === 0) return;

        set({ isSyncing: true });

        const queue = [...pendingSales];
        const failed: Sale[] = [];

        for (const sale of queue) {
          try {
            const syncHeaders: Record<string, string> = {
              'X-Idempotency-Key': sale.idempotency_key,
            };
            if (sale.empresa_id) {
              syncHeaders['X-Company-ID'] = String(sale.empresa_id);
            }

            // Envia a venda ao backend
            const response = await api.post('/pdv/vendas', {
              entidade_id: sale.entidade_id,
              centro_custo_id: sale.centro_custo_id,
              vendedor_id: sale.vendedor_id,
              desconto: sale.desconto,
              status: sale.status,
              itens: sale.itens,
              pagamentos: sale.pagamentos,
              rv: sale.rv,
              data_pagamento: sale.data_pagamento,
              observacao: sale.observacao,
              comprovante_urls: sale.comprovante_urls || []
            }, {
              headers: syncHeaders,
            });

            const createdSale = response.data;
            const targetUuid = createdSale?.venda_id_uuid;

            // Se houver arquivos comprovantes anexados localmente, reconstrói e envia
            if (sale.comprovanteFiles && sale.comprovanteFiles.length > 0 && targetUuid) {
              const formDataUpload = new FormData();
              for (const fileData of sale.comprovanteFiles) {
                const byteCharacters = atob(fileData.data);
                const byteNumbers = new Array(byteCharacters.length);
                for (let i = 0; i < byteCharacters.length; i++) {
                  byteNumbers[i] = byteCharacters.charCodeAt(i);
                }
                const byteArray = new Uint8Array(byteNumbers);
                const blob = new Blob([byteArray], { type: fileData.type });
                formDataUpload.append('files', blob, fileData.name);
              }

              const uploadHeaders: Record<string, string> = {
                'Content-Type': 'multipart/form-data',
              };
              if (sale.empresa_id) {
                uploadHeaders['X-Company-ID'] = String(sale.empresa_id);
              }

              await api.post(`/pdv/vendas/${targetUuid}/comprovante`, formDataUpload, {
                headers: uploadHeaders,
              });
            }
          } catch (error: any) {
            console.error('Erro na sincronização de venda do PDV:', error);
            const status = error?.response?.status;
            // Se for duplicado (409) ou já inserido anteriormente com sucesso (200/201), remove da fila
            if (status === 409 || status === 200 || status === 201) {
              continue;
            }
            // Outros erros (ex: 500, falha de rede temporária), mantém na fila de retransmissão
            failed.push(sale);
          }
        }

        set({ pendingSales: failed, isSyncing: false });
      },

      setOnline: (isOnline) => set({ isOnline }),
    }),
    {
      name: 'pos-sales-queue-v1',
      storage: createJSONStorage(() => indexedDBStorage),
    }
  )
);

// Global Window Listeners
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    usePosStore.getState().setOnline(true);
    void usePosStore.getState().syncPendingSales();
  });
  window.addEventListener('offline', () => {
    usePosStore.getState().setOnline(false);
  });
}
