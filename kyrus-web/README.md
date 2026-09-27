# 🌐 KyrusERP - Frontend SPA (`kyrus-web`)

**Padrão Nível Google / Enterprise**  
**Última Atualização**: 26 de Setembro de 2026  
**Stack**: React 18, TypeScript Estrito, Vite 5, Tailwind CSS, Zustand, Vitest

---

## 🏛️ 1. Arquitetura da Aplicação

O frontend do KyrusERP é uma Single Page Application (SPA) de alta performance otimizada para tempo de resposta sub-segundo, renderizações sem re-render loops e sincronização em tempo real:

- **Roteamento**: React Router v6 com lazy-loading por rota.
- **Gerenciamento de Estado**: Zustand (`src/stores/`), com stores desacopladas e listeners funcionais evitando referências circulares.
- **Cliente HTTP**: Axios centralizado em `src/services/api.ts`, injetando automaticamente o token JWT Bearer e o header multi-tenant `X-Company-ID`.
- **Comunicação em Tempo Real**: WebSocket client ouvindo canais isolados por tenant no Redis para atualização instantânea de dashboards, transações e vendas PDV.

---

## 🗄️ 2. Gerenciamento de Estado (Zustand Stores)

| Store | Arquivo | Responsabilidade |
| :--- | :--- | :--- |
| `useAuthStore` | `src/stores/authStore.ts` | Autenticação, token JWT, dados do usuário logado e permissões RBAC. |
| `useEmpresa` | `src/hooks/useEmpresa.ts` | Contexto da empresa selecionada, multitenancy e disparo de troca de tenant. |
| `useLookupStore`| `src/stores/lookupStore.ts` | Cache de entidades leves (clientes, fornecedores, categorias) para selects rápidos. |
| `useTransactionStore`| `src/stores/transactionStore.ts`| Cache reativo e operações de lançamentos financeiros e conciliações. |

> [!IMPORTANT]
> **Prevenção de Dependências Circulares**:
> Nunca faça imports cruzados no topo de arquivos entre stores (ex: `lookupStore` importando `transactionStore` e vice-versa). Utilize callbacks dinâmicos e listeners funcionais (ex: `registerTransactionRefresh`).

---

## 🧪 3. Testes Automatizados (Vitest)

A suíte de testes de unidade e componentes roda sobre **Vitest + React Testing Library**:

```bash
# Executar todos os testes
npm test

# Executar testes em modo watch
npm run test:watch

# Checagem de tipagem estrita
npx tsc --noEmit
```

### Regra de Ouro para Mocks no Vitest:
Ao mockar seletores Zustand (`useEmpresa`, `useAuthStore`), **nunca** instancie novos objetos literais dentro do callback:
```typescript
// ❌ ERRADO: Cria nova referência a cada chamada, gerando loop infinito de renderização e OOM
vi.mock('@/hooks/useEmpresa', () => ({
  useEmpresa: vi.fn((selector) => selector({ empresa: { id: 1 } }))
}));

// ✅ CORRETO: Referência estável fora do callback
const mockState = { empresa: { id: 1, razao_social: 'Kyrus Test' }, empresaId: 1 };
vi.mock('@/hooks/useEmpresa', () => ({
  useEmpresa: vi.fn((selector) => selector ? selector(mockState) : mockState)
}));
```

---

## 🚀 4. Build e Deploy em Produção

```bash
# Compilação e bundle de produção
npm run build
```

- **Output**: Diretório `dist/` contendo bundles compactados com cache busting hash.
- **Nginx Alpine**: Em produção, servido sob Nginx com gzip level 6, headers de segurança OWASP e fallback para `index.html`.

