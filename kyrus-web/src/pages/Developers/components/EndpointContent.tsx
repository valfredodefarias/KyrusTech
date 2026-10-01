// kyrus-web/src/pages/Developers/components/EndpointContent.tsx
import React, { useState } from 'react';
import {
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  Shield,
  Layers,
  FileText,
  AlertCircle,
} from 'lucide-react';
import type { ParsedEndpoint, OpenApiSpec } from '../types';
import { resolveSchema } from '../parser';

interface EndpointContentProps {
  endpoint: ParsedEndpoint;
  spec: OpenApiSpec;
  baseUrl: string;
}

export const EndpointContent: React.FC<EndpointContentProps> = ({
  endpoint,
  spec,
  baseUrl,
}) => {
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [openResponseStatus, setOpenResponseStatus] = useState<string>('200');

  const fullUrl = `${baseUrl.replace(/\/$/, '')}${endpoint.path}`;

  const handleCopyUrl = () => {
    if (navigator?.clipboard?.writeText) {
      void navigator.clipboard.writeText(fullUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    }
  };

  const getMethodBadgeClass = (method: string) => {
    switch (method.toUpperCase()) {
      case 'GET':
        return 'bg-emerald-500 text-white';
      case 'POST':
        return 'bg-blue-600 text-white';
      case 'PUT':
      case 'PATCH':
        return 'bg-purple-600 text-white';
      case 'DELETE':
        return 'bg-rose-600 text-white';
      default:
        return 'bg-slate-600 text-white';
    }
  };

  const pathParams = endpoint.parameters.filter((p) => p.in === 'path');
  const queryParams = endpoint.parameters.filter((p) => p.in === 'query');

  // Extrai propriedades do corpo (se houver)
  let requestBodySchema: any = null;
  if (endpoint.requestBody?.content) {
    const jsonContent = endpoint.requestBody.content['application/json'];
    if (jsonContent?.schema) {
      requestBodySchema = resolveSchema(jsonContent.schema, spec);
    }
  }

  const bodyProperties =
    requestBodySchema?.type === 'object' && requestBodySchema?.properties
      ? Object.entries<any>(requestBodySchema.properties)
      : [];

  const requiredBodyFields = Array.isArray(requestBodySchema?.required)
    ? requestBodySchema.required
    : [];

  const toggleResponse = (status: string) => {
    setOpenResponseStatus((prev) => (prev === status ? '' : status));
  };

  return (
    <div className="space-y-8">
      {/* Cabeçalho do Endpoint */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
          <Layers className="w-3.5 h-3.5 text-blue-500" />
          <span>{endpoint.tag}</span>
        </div>

        <h1 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white tracking-tight">
          {endpoint.summary}
        </h1>

        {endpoint.description ? (
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            {endpoint.description}
          </p>
        ) : null}

        {/* Badge do Método + URL com Botão Copiar */}
        <div className="flex items-center gap-2 mt-4 p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 overflow-hidden">
          <span
            className={`px-2.5 py-1 rounded text-xs font-black uppercase tracking-wider shadow-2xs shrink-0 ${getMethodBadgeClass(
              endpoint.method
            )}`}
          >
            {endpoint.method}
          </span>
          <code className="text-xs font-mono text-slate-800 dark:text-slate-200 truncate flex-1 select-all">
            {fullUrl}
          </code>
          <button
            type="button"
            onClick={handleCopyUrl}
            title="Copiar URL completa"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition shrink-0"
          >
            {copiedUrl ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Autenticação & Requisitos de Cabeçalho */}
      <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-4 dark:border-blue-900/40 dark:bg-blue-950/20 text-xs text-blue-900 dark:text-blue-200 flex items-start gap-3">
        <Shield className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-bold">Autenticação por Chave de API</p>
          <p className="text-blue-700 dark:text-blue-300">
            Requer o envio do cabeçalho <code className="font-mono font-bold">X-Api-Key: kyr_live_...</code> ou{' '}
            <code className="font-mono font-bold">Authorization: Bearer kyr_live_...</code>.
          </p>
        </div>
      </div>

      {/* TABELA: PATH PARAMETERS */}
      {pathParams.length > 0 ? (
        <div className="space-y-3">
          <h2 className="text-sm font-black uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center gap-2">
            <span>Path Parameters</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500">
              {pathParams.length}
            </span>
          </h2>

          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-50 dark:bg-slate-900/60 text-[11px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-2.5">Parâmetro</th>
                  <th className="px-4 py-2.5">Tipo</th>
                  <th className="px-4 py-2.5">Obrigatório</th>
                  <th className="px-4 py-2.5">Descrição</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {pathParams.map((p) => (
                  <tr key={p.name} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                    <td className="px-4 py-3 font-mono font-bold text-slate-800 dark:text-slate-200">
                      {p.name}
                    </td>
                    <td className="px-4 py-3 text-slate-500 font-mono text-[11px]">
                      {p.schema?.type || 'string'}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-rose-600 dark:text-rose-400 font-bold text-[10px] uppercase">
                        Sim
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                      {p.description || `Identificador do recurso (${p.name})`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* TABELA: QUERY PARAMETERS */}
      {queryParams.length > 0 ? (
        <div className="space-y-3">
          <h2 className="text-sm font-black uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center gap-2">
            <span>Query Parameters</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500">
              {queryParams.length}
            </span>
          </h2>

          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-50 dark:bg-slate-900/60 text-[11px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-2.5">Parâmetro</th>
                  <th className="px-4 py-2.5">Tipo</th>
                  <th className="px-4 py-2.5">Obrigatório</th>
                  <th className="px-4 py-2.5">Descrição</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {queryParams.map((p) => (
                  <tr key={p.name} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                    <td className="px-4 py-3 font-mono font-bold text-slate-800 dark:text-slate-200">
                      {p.name}
                    </td>
                    <td className="px-4 py-3 text-slate-500 font-mono text-[11px]">
                      {p.schema?.type || 'string'}
                    </td>
                    <td className="px-4 py-3">
                      {p.required ? (
                        <span className="text-rose-600 dark:text-rose-400 font-bold text-[10px] uppercase">
                          Sim
                        </span>
                      ) : (
                        <span className="text-slate-400 text-[10px]">Opcional</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                      {p.description || (p.schema?.default ? `Padrão: ${p.schema.default}` : '-')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* TABELA: BODY PARAMETERS */}
      {bodyProperties.length > 0 ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-black uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center gap-2">
              <span>Body Parameters</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500">
                application/json
              </span>
            </h2>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-50 dark:bg-slate-900/60 text-[11px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-2.5">Campo</th>
                  <th className="px-4 py-2.5">Tipo</th>
                  <th className="px-4 py-2.5">Obrigatório</th>
                  <th className="px-4 py-2.5">Descrição</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {bodyProperties.map(([name, prop]) => {
                  const isRequired = requiredBodyFields.includes(name);
                  return (
                    <tr key={name} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                      <td className="px-4 py-3 font-mono font-bold text-slate-800 dark:text-slate-200">
                        {name}
                      </td>
                      <td className="px-4 py-3 text-slate-500 font-mono text-[11px]">
                        {prop.type || (prop.anyOf ? 'múltiplos' : 'object')}
                      </td>
                      <td className="px-4 py-3">
                        {isRequired ? (
                          <span className="text-rose-600 dark:text-rose-400 font-bold text-[10px] uppercase">
                            Sim
                          </span>
                        ) : (
                          <span className="text-slate-400 text-[10px]">Opcional</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                        {prop.description || prop.title || '-'}
                        {prop.example ? (
                          <span className="block font-mono text-[10px] text-slate-400 mt-0.5">
                            Ex: {JSON.stringify(prop.example)}
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* SEÇÃO DE RESPONSES EM ACORDEÃO NO PADRÃO ASAAS */}
      <div className="space-y-3">
        <h2 className="text-sm font-black uppercase tracking-wider text-slate-800 dark:text-slate-200">
          Respostas (Responses)
        </h2>

        <div className="space-y-2">
          {Object.entries(endpoint.responses).map(([statusCode, resp]) => {
            const isOpen = openResponseStatus === statusCode;
            const isSuccess = statusCode.startsWith('2');

            // Resolve schema da resposta
            let respSchema: any = null;
            let respExample: any = null;
            if (resp.content?.['application/json']) {
              const c = resp.content['application/json'];
              if (c.schema) {
                respSchema = resolveSchema(c.schema, spec);
              }
              respExample = c.example || (c.examples ? Object.values(c.examples)[0] : null);
            }

            return (
              <div
                key={statusCode}
                className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => toggleResponse(statusCode)}
                  className="w-full flex items-center justify-between p-3.5 bg-slate-50/60 dark:bg-slate-900/40 hover:bg-slate-100/60 dark:hover:bg-slate-800/40 transition text-left select-none"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-mono font-black ${
                        isSuccess
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                          : 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                      }`}
                    >
                      {statusCode}
                    </span>
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      {resp.description || (isSuccess ? 'Sucesso' : 'Erro')}
                    </span>
                  </div>
                  {isOpen ? (
                    <ChevronDown className="w-4 h-4 text-slate-400" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-slate-400" />
                  )}
                </button>

                {isOpen ? (
                  <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-xs space-y-3">
                    {respExample ? (
                      <div className="space-y-1">
                        <span className="text-[11px] font-bold uppercase text-slate-400">
                          Exemplo de Resposta:
                        </span>
                        <pre className="p-3 rounded-lg bg-slate-900 text-slate-100 font-mono text-[11px] overflow-x-auto border border-slate-800">
                          {JSON.stringify(respExample, null, 2)}
                        </pre>
                      </div>
                    ) : respSchema ? (
                      <div className="space-y-1">
                        <span className="text-[11px] font-bold uppercase text-slate-400">
                          Estrutura do Schema ({respSchema.title || 'Response'}):
                        </span>
                        <pre className="p-3 rounded-lg bg-slate-900 text-slate-100 font-mono text-[11px] overflow-x-auto border border-slate-800">
                          {JSON.stringify(respSchema, null, 2)}
                        </pre>
                      </div>
                    ) : (
                      <p className="text-slate-500 italic">Nenhum payload de resposta documentado.</p>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
