import { useState, useRef } from 'react';
import { User, X, Loader2, Save } from 'lucide-react';
import { api } from '../../../services/api';
import { InputDark } from './InputDark';
import type { QuickEntityFormState } from '../types';
import {
  formatPhone,
  formatCep,
  formatCpfCnpj,
  onlyDigits,
  fetchCepAddress,
  nullableValue,
} from '../utils';

interface QuickEntityDrawerProps {
  showEntityDrawer: boolean;
  onClose: () => void;
  onSuccess: (newEntity: any) => void;
  pushToast: (type: 'success' | 'error' | 'info', message: string) => void;
}

const initialQuickEntityData: QuickEntityFormState = {
  nome: '',
  tipo: 'AMBOS',
  tipo_pessoa: 'PF',
  nome_fantasia: '',
  cpf_cnpj: '',
  email: '',
  telefone: '',
  celular: '',
  contato_nome: '',
  cep: '',
  logradouro: '',
  numero: '',
  complemento: '',
  bairro: '',
  cidade: '',
  uf: '',
  observacoes: '',
};

export const QuickEntityDrawer = ({
  showEntityDrawer,
  onClose,
  onSuccess,
  pushToast,
}: QuickEntityDrawerProps) => {
  const [newEntityData, setNewEntityData] = useState<QuickEntityFormState>(initialQuickEntityData);
  const [entityCepLoading, setEntityCepLoading] = useState(false);
  const [entityCepFeedback, setEntityCepFeedback] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  
  const lastEntityCepLookupRef = useRef('');

  const closeEntityDrawer = () => {
    onClose();
    setNewEntityData(initialQuickEntityData);
    setEntityCepLoading(false);
    setEntityCepFeedback(null);
    lastEntityCepLookupRef.current = '';
  };

  const handleQuickEntityDocumentoChange = (value: string) => {
    const formatted = formatCpfCnpj(value);
    const digits = onlyDigits(formatted);
    setNewEntityData((prev) => ({
      ...prev,
      cpf_cnpj: formatted,
      tipo_pessoa:
        digits.length > 11
          ? 'PJ'
          : prev.tipo_pessoa === 'PJ' && digits.length > 0 && digits.length <= 11
            ? 'PF'
            : prev.tipo_pessoa,
    }));
  };

  const handleQuickEntityCepChange = async (value: string) => {
    const formatted = formatCep(value);
    const digits = onlyDigits(formatted);

    setNewEntityData((prev) => ({ ...prev, cep: formatted }));

    if (digits.length < 8) {
      lastEntityCepLookupRef.current = '';
      setEntityCepFeedback(null);
      setEntityCepLoading(false);
      return;
    }

    if (digits === lastEntityCepLookupRef.current) {
      return;
    }

    setEntityCepLoading(true);
    setEntityCepFeedback(null);
    try {
      const address = await fetchCepAddress(digits);
      lastEntityCepLookupRef.current = digits;
      setNewEntityData((prev) => ({
        ...prev,
        cep: formatCep(address.cep),
        logradouro: address.logradouro,
        bairro: address.bairro,
        cidade: address.cidade,
        uf: address.uf,
      }));
      setEntityCepFeedback('Endereço preenchido automaticamente pelo CEP.');
    } catch (error: any) {
      lastEntityCepLookupRef.current = '';
      setEntityCepFeedback(error?.message || 'Não foi possível consultar o CEP.');
    } finally {
      setEntityCepLoading(false);
    }
  };

  const handleCreateEntity = async () => {
    if (!newEntityData.nome) {
      pushToast('info', 'Digite o nome do interessado.');
      return;
    }
    setSaving(true);
    try {
      const res = await api.post('/entidades/', {
        nome: newEntityData.nome.trim(),
        tipo: newEntityData.tipo,
        tipo_pessoa: newEntityData.tipo_pessoa,
        nome_fantasia: nullableValue(newEntityData.nome_fantasia),
        cpf_cnpj: nullableValue(onlyDigits(newEntityData.cpf_cnpj)),
        email: nullableValue(newEntityData.email),
        telefone: nullableValue(onlyDigits(newEntityData.telefone)),
        celular: nullableValue(onlyDigits(newEntityData.celular)),
        contato_nome: nullableValue(newEntityData.contato_nome),
        cep: nullableValue(onlyDigits(newEntityData.cep)),
        logradouro: nullableValue(newEntityData.logradouro),
        numero: nullableValue(newEntityData.numero),
        complemento: nullableValue(newEntityData.complemento),
        bairro: nullableValue(newEntityData.bairro),
        cidade: nullableValue(newEntityData.cidade),
        uf: nullableValue(newEntityData.uf.toUpperCase().slice(0, 2)),
        observacoes: nullableValue(newEntityData.observacoes),
        status: 'ATIVO',
      });
      onSuccess(res.data);
      closeEntityDrawer();
      pushToast('success', 'Interessado criado com sucesso.');
    } catch {
      pushToast('error', 'Erro ao criar interessado.');
    } finally {
      setSaving(false);
    }
  };

  const documentoInteressadoLabel = newEntityData.tipo_pessoa === 'PF' ? 'CPF' : 'CNPJ';
  const nomeInteressadoLabel = newEntityData.tipo_pessoa === 'PF' ? 'Nome completo' : 'Razão social';

  return (
    <div
      className={`fixed inset-y-0 right-0 w-full max-w-3xl bg-white dark:bg-slate-800 shadow-2xl z-60 transform transition-transform duration-300 border-l border-slate-200 dark:border-slate-700 ${
        showEntityDrawer ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center bg-white dark:bg-slate-800">
        <h3 className="font-bold text-slate-800 dark:text-white flex items-center gap-2">
          <User className="w-4 h-4 text-blue-500" /> Novo Interessado
        </h3>
        <button onClick={closeEntityDrawer}>
          <X className="w-5 h-5 text-slate-400 hover:text-slate-700 dark:hover:text-white" />
        </button>
      </div>
      <div className="h-[calc(100%-65px)] overflow-y-auto p-6 custom-scrollbar">
        <div className="space-y-5">
          <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-5 rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-900/60">
              <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-950">
                <button
                  type="button"
                  onClick={() => setNewEntityData((prev) => ({ ...prev, tipo_pessoa: 'PF' }))}
                  className={`rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-[0.18em] transition ${
                    newEntityData.tipo_pessoa === 'PF'
                      ? 'bg-violet-600 text-white'
                      : 'text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  Pessoa Física
                </button>
                <button
                  type="button"
                  onClick={() => setNewEntityData((prev) => ({ ...prev, tipo_pessoa: 'PJ' }))}
                  className={`rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-[0.18em] transition ${
                    newEntityData.tipo_pessoa === 'PJ'
                      ? 'bg-sky-600 text-white'
                      : 'text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  Pessoa Jurídica
                </button>
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <InputDark
                  label={nomeInteressadoLabel}
                  autoFocus
                  placeholder={newEntityData.tipo_pessoa === 'PF' ? 'Ex: Maria Souza' : 'Ex: Fornecedor ABC Ltda'}
                  value={newEntityData.nome}
                  onChange={(e: any) => setNewEntityData((prev) => ({ ...prev, nome: e.target.value }))}
                />
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-1">
                    {documentoInteressadoLabel}
                  </label>
                  <input
                    type="text"
                    className="w-full p-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition font-mono text-sm placeholder:text-slate-400"
                    value={newEntityData.cpf_cnpj}
                    onChange={(e: any) => handleQuickEntityDocumentoChange(e.target.value)}
                    placeholder={newEntityData.tipo_pessoa === 'PF' ? '000.000.000-00' : '00.000.000/0000-00'}
                  />
                </div>
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <InputDark
                  label="Nome fantasia / apelido"
                  placeholder={newEntityData.tipo_pessoa === 'PF' ? 'Como você identifica essa pessoa' : 'Nome comercial'}
                  value={newEntityData.nome_fantasia}
                  onChange={(e: any) => setNewEntityData((prev) => ({ ...prev, nome_fantasia: e.target.value }))}
                />
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Classificação</label>
                  <select
                    className="w-full p-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                    value={newEntityData.tipo}
                    onChange={(e: any) => setNewEntityData((prev) => ({ ...prev, tipo: e.target.value as any }))}
                  >
                    <option value="CLIENTE">Cliente</option>
                    <option value="FORNECEDOR">Fornecedor</option>
                    <option value="AMBOS">Ambos</option>
                  </select>
                </div>
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <InputDark
                  label="Contato responsável"
                  placeholder="Ex: Financeiro / João Silva"
                  value={newEntityData.contato_nome}
                  onChange={(e: any) => setNewEntityData((prev) => ({ ...prev, contato_nome: e.target.value }))}
                />
                <InputDark
                  label="E-mail"
                  type="email"
                  placeholder="contato@empresa.com.br"
                  value={newEntityData.email}
                  onChange={(e: any) => setNewEntityData((prev) => ({ ...prev, email: e.target.value }))}
                />
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <InputDark
                  label="Telefone"
                  placeholder="(11) 3333-4444"
                  value={newEntityData.telefone}
                  onChange={(e: any) => setNewEntityData((prev) => ({ ...prev, telefone: formatPhone(e.target.value) }))}
                />
                <InputDark
                  label="Celular / WhatsApp"
                  placeholder="(11) 98888-7777"
                  value={newEntityData.celular}
                  onChange={(e: any) => setNewEntityData((prev) => ({ ...prev, celular: formatPhone(e.target.value) }))}
                />
              </div>
            </div>

            <div className="space-y-5 rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-900/60">
              <div className="grid gap-5 sm:grid-cols-3">
                <div>
                  <InputDark
                    label="CEP"
                    placeholder="00000-000"
                    value={newEntityData.cep}
                    onChange={(e: any) => void handleQuickEntityCepChange(e.target.value)}
                  />
                  <p className="mt-1 text-[10px] text-slate-400">
                    {entityCepLoading
                      ? 'Consultando CEP...'
                      : entityCepFeedback || 'Digite o CEP para preencher logradouro, bairro, cidade e UF.'}
                  </p>
                </div>
                <div className="sm:col-span-2">
                  <InputDark
                    label="Logradouro"
                    placeholder="Rua, avenida, praça"
                    value={newEntityData.logradouro}
                    onChange={(e: any) => setNewEntityData((prev) => ({ ...prev, logradouro: e.target.value }))}
                  />
                </div>
              </div>

              <div className="grid gap-5 sm:grid-cols-3">
                <InputDark
                  label="Número"
                  placeholder="123"
                  value={newEntityData.numero}
                  onChange={(e: any) => setNewEntityData((prev) => ({ ...prev, numero: e.target.value }))}
                />
                <div className="sm:col-span-2">
                  <InputDark
                    label="Complemento"
                    placeholder="Sala, bloco, referência"
                    value={newEntityData.complemento}
                    onChange={(e: any) => setNewEntityData((prev) => ({ ...prev, complemento: e.target.value }))}
                  />
                </div>
              </div>

              <div className="grid gap-5 sm:grid-cols-3">
                <InputDark
                  label="Bairro"
                  value={newEntityData.bairro}
                  onChange={(e: any) => setNewEntityData((prev) => ({ ...prev, bairro: e.target.value }))}
                />
                <InputDark
                  label="Cidade"
                  value={newEntityData.cidade}
                  onChange={(e: any) => setNewEntityData((prev) => ({ ...prev, cidade: e.target.value }))}
                />
                <InputDark
                  label="UF"
                  maxLength={2}
                  placeholder="SP"
                  value={newEntityData.uf}
                  onChange={(e: any) => setNewEntityData((prev) => ({ ...prev, uf: e.target.value.toUpperCase() }))}
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-1">Observações</label>
                <textarea
                  className="min-h-32 w-full resize-y rounded-lg border border-slate-300 bg-white p-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                  value={newEntityData.observacoes}
                  onChange={(e: any) => setNewEntityData((prev) => ({ ...prev, observacoes: e.target.value }))}
                  placeholder="Condições comerciais, restrições, detalhes operacionais."
                />
              </div>
            </div>
          </div>

          <div className="flex gap-3 border-t border-slate-200 pt-5 dark:border-slate-700">
            <button
              onClick={closeEntityDrawer}
              className="flex-1 py-3 text-slate-500 dark:text-slate-400 font-bold hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition"
            >
              Cancelar
            </button>
            <button
              onClick={handleCreateEntity}
              disabled={saving}
              className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg shadow-lg flex justify-center gap-2 items-center transition disabled:opacity-50"
            >
              {saving ? <Loader2 className="animate-spin w-4 h-4" /> : <Save className="w-4 h-4" />} Salvar Interessado
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
