import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  X, Camera, Shield, Building2, Mail, User, 
  LogOut, KeyRound, Loader2, CheckCircle2, AlertCircle,
  Phone, Send, RefreshCw, Check
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '../store/authStore';
import { useUsuarios } from '../pages/Configuracoes/hooks/useUsuarios';
import { useUsuariosWebSocket } from '../pages/Configuracoes/hooks/useConfiguracoesWebSocket';

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length === 0) return '';
  if (digits.length <= 2) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`;
}

export function UserProfileModal({ isOpen, onClose }: UserProfileModalProps) {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const storedUser = useAuthStore((state) => state.user);
  const empresa = useAuthStore((state) => state.empresa);
  const logout = useAuthStore((state) => state.logout);

  const {
    user,
    loading,
    saving,
    updatingProfile,
    sendingCode,
    verifyingCode,
    userPhotoFile,
    userPhotoPreview,
    handleUserPhotoChange,
    handleRemoveUserPhoto,
    handleSave,
    updateProfile,
    sendEmailVerificationCode,
    verifyEmailCode,
    loadUser,
  } = useUsuarios();

  useUsuariosWebSocket(loadUser);

  // Form states
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [telefone, setTelefone] = useState('');

  // Email verification flow state
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);

  // Sync form inputs when user or storedUser changes
  useEffect(() => {
    if (user) {
      setNome(user.nome || '');
      setEmail(user.email || '');
      setTelefone(user.telefone ? formatPhone(user.telefone) : '');
    } else if (storedUser) {
      setNome(storedUser.nome || '');
      setEmail(storedUser.email || '');
      setTelefone(storedUser.telefone ? formatPhone(storedUser.telefone) : '');
    }
  }, [user, storedUser, isOpen]);

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  // Fecha no ESC
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showVerifyModal) {
          setShowVerifyModal(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, showVerifyModal, onClose]);

  if (!isOpen) return null;

  const currentEmail = user?.email || storedUser?.email || '';
  const isEmailConfirmed = Boolean(user?.email_confirmado ?? storedUser?.email_confirmado);
  const displayName = user?.nome || storedUser?.nome || 'Usuário';
  const roleName = storedUser?.is_consultor 
    ? (storedUser.consultor_role === 'SUPER_CONSULTOR' ? 'Super Consultor' : 'Consultor')
    : (storedUser?.permissions?.includes('*') ? 'Administrador Geral' : 'Operador');

  const hasFormChanges = 
    nome.trim() !== (user?.nome || storedUser?.nome || '').trim() ||
    email.trim().toLowerCase() !== (user?.email || storedUser?.email || '').trim().toLowerCase() ||
    telefone.replace(/\D/g, '') !== (user?.telefone || storedUser?.telefone || '').replace(/\D/g, '');

  const getInitials = (name: string) => {
    const parts = name.trim().split(/\s+/);
    if (!parts[0]) return 'US';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  const handleLogout = () => {
    if (window.confirm('Deseja realmente sair da sua conta?')) {
      onClose();
      logout();
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      toast.error('O e-mail não pode ser vazio.');
      return;
    }

    const emailChanging = email.trim().toLowerCase() !== currentEmail.toLowerCase();

    try {
      await updateProfile({
        nome: nome.trim() || undefined,
        email: email.trim().toLowerCase(),
        telefone: telefone.trim() || undefined,
      });

      toast.success('Informações atualizadas com sucesso!');

      if (emailChanging) {
        toast.info('Como você alterou seu e-mail, enviamos um código para validação.');
        setShowVerifyModal(true);
        setResendCooldown(45);
      }
    } catch (err: any) {
      console.error(err);
      toast.error(err?.response?.data?.detail || 'Erro ao atualizar dados do perfil.');
    }
  };

  const handleRequestVerificationCode = async () => {
    try {
      await sendEmailVerificationCode();
      setShowVerifyModal(true);
      setResendCooldown(45);
      toast.success(`Código de verificação enviado para ${currentEmail}`);
    } catch (err: any) {
      console.error(err);
      toast.error(err?.response?.data?.detail || 'Erro ao enviar código de verificação.');
    }
  };

  const handleConfirmCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = verificationCode.replace(/\D/g, '').trim();
    if (cleanCode.length !== 6) {
      toast.error('Informe o código de 6 dígitos enviado por e-mail.');
      return;
    }

    try {
      await verifyEmailCode(cleanCode);
      toast.success('E-mail confirmado com sucesso!');
      setShowVerifyModal(false);
      setVerificationCode('');
    } catch (err: any) {
      console.error(err);
      toast.error(err?.response?.data?.detail || 'Código inválido ou expirado.');
    }
  };

  return (
    <div 
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div 
        className="relative w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl rounded-2xl overflow-hidden animate-in zoom-in-95 duration-200 max-h-[90vh] flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-profile-title"
      >
        {/* Cabeçalho do Modal (Clean & Sem barra azul) */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400">
              <User size={18} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Minha Conta Kyrus
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Gerenciamento do perfil e dados cadastrais
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
            title="Fechar (ESC)"
            aria-label="Fechar perfil"
          >
            <X size={18} />
          </button>
        </div>

        {/* Conteúdo com Scroll */}
        <div className="px-6 py-4 overflow-y-auto flex-1">
          {/* Avatar e Informações Principais do Usuário */}
          <div className="flex items-center gap-4 mb-5">
            <div className="relative group shrink-0">
              <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden flex items-center justify-center">
                {userPhotoPreview ? (
                  <img 
                    src={userPhotoPreview} 
                    alt={displayName} 
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="text-slate-600 dark:text-slate-200 font-bold text-xl">
                    {getInitials(displayName)}
                  </div>
                )}
              </div>

              {/* Botão de Trocar Foto (Câmera) */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="absolute -bottom-1 -right-1 p-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white shadow-md transition-transform hover:scale-105 border-2 border-white dark:border-slate-900 cursor-pointer"
                title="Alterar foto de exibição"
              >
                <Camera size={13} />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleUserPhotoChange}
              />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 id="user-profile-title" className="text-base font-bold text-slate-900 dark:text-white truncate">
                  {displayName}
                </h2>
                <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800 rounded-md">
                  {roleName}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                {currentEmail}
              </p>

              {/* Ações da Foto */}
              <div className="flex items-center gap-2 mt-2">
                {userPhotoFile && (
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold transition flex items-center gap-1 shadow-sm disabled:opacity-50 cursor-pointer"
                  >
                    {saving ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
                    <span>{saving ? 'Salvando...' : 'Salvar Foto'}</span>
                  </button>
                )}

                {userPhotoPreview && !userPhotoFile && (
                  <button
                    type="button"
                    onClick={handleRemoveUserPhoto}
                    className="text-[11px] text-slate-400 hover:text-rose-600 transition font-medium cursor-pointer"
                  >
                    Remover Foto
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Cards Rápidos de Empresa e Conexão */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-5">
            <div className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 flex items-start gap-2.5">
              <Building2 className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <span className="block text-[10px] font-bold uppercase text-slate-400">Empresa Vinculada</span>
                <span className="block text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                  {empresa?.nome_fantasia || empresa?.razao_social || 'Kyrus'}
                </span>
                {empresa?.cnpj && (
                  <span className="block text-[10px] text-slate-400 font-mono truncate">{empresa.cnpj}</span>
                )}
              </div>
            </div>

            <div className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 flex items-start gap-2.5">
              <Shield className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <span className="block text-[10px] font-bold uppercase text-slate-400">Sessão e Segurança</span>
                <span className="block text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  Conexão Criptografada
                </span>
                <span className="block text-[10px] text-slate-400">Autenticação Ativa</span>
              </div>
            </div>
          </div>

          {/* FORMULÁRIO DE DADOS DE CONTATO E CONFERÊNCIA */}
          <form onSubmit={handleSaveProfile} className="space-y-4 pt-1 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-center justify-between mt-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <User size={13} className="text-blue-500" />
                Dados Cadastrais & Contato
              </span>

              {hasFormChanges && (
                <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded border border-amber-200 dark:border-amber-800 animate-pulse">
                  Alterações não salvas
                </span>
              )}
            </div>

            {/* Campo Nome */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Nome Completo
              </label>
              <div className="relative">
                <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder="Seu nome completo"
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
                />
              </div>
            </div>

            {/* Campo E-mail com Badge de Confirmação */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  E-mail Corporativo
                </label>

                {/* Status da Confirmação de E-mail */}
                {isEmailConfirmed ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800">
                    <CheckCircle2 size={11} className="text-emerald-500" />
                    Confirmado
                  </span>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded-full border border-amber-200 dark:border-amber-800">
                      <AlertCircle size={11} className="text-amber-500" />
                      Não verificado
                    </span>
                    <button
                      type="button"
                      onClick={handleRequestVerificationCode}
                      disabled={sendingCode}
                      className="text-[10px] font-bold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer flex items-center gap-1 disabled:opacity-50"
                    >
                      {sendingCode ? <Loader2 size={10} className="animate-spin" /> : <Send size={10} />}
                      <span>Confirmar agora</span>
                    </button>
                  </div>
                )}
              </div>

              <div className="relative">
                <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="seu.email@empresa.com.br"
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
                  required
                />
              </div>
              <span className="block text-[10px] text-slate-400 mt-1">
                Ao alterar seu e-mail, um código de confirmação de 6 dígitos será despachado.
              </span>
            </div>

            {/* Campo Número de Contato / WhatsApp */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Número de Contato (WhatsApp / Telefone)
              </label>
              <div className="relative">
                <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="tel"
                  value={telefone}
                  onChange={(e) => setTelefone(formatPhone(e.target.value))}
                  placeholder="(DDD) 99999-9999"
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition font-mono"
                />
              </div>
              <span className="block text-[10px] text-slate-400 mt-1">
                Utilizado para notificações e recuperação da conta.
              </span>
            </div>

            {/* Botão de Salvar Alterações Cadastrais */}
            {hasFormChanges && (
              <div className="pt-2 flex justify-end">
                <button
                  type="submit"
                  disabled={updatingProfile}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition flex items-center gap-1.5 shadow-md shadow-blue-500/20 disabled:opacity-50 cursor-pointer"
                >
                  {updatingProfile ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Check size={13} />
                  )}
                  <span>{updatingProfile ? 'Salvando dados...' : 'Salvar Alterações'}</span>
                </button>
              </div>
            )}
          </form>

          {/* Atalho de Segurança */}
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={() => {
                onClose();
                navigate('/config?tab=SEGURANCA');
              }}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-600 dark:text-slate-300 text-xs font-bold flex items-center justify-between transition cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <KeyRound size={14} className="text-slate-400" />
                <span>Segurança & Sessões Ativas</span>
              </div>
              <span className="text-[10px] font-semibold text-slate-400">Ver dispositivos &rsaquo;</span>
            </button>
          </div>
        </div>

        {/* Rodapé com Logout */}
        <div className="flex items-center justify-between p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 shrink-0">
          <button
            type="button"
            onClick={handleLogout}
            className="px-3 py-1.5 rounded-lg text-xs font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/20 transition flex items-center gap-1.5 cursor-pointer"
          >
            <LogOut size={14} />
            <span>Sair do Sistema</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold transition cursor-pointer"
          >
            Concluído
          </button>
        </div>

        {/* MODAL / SUBFLUXO DE CONFIRMAÇÃO DE E-MAIL */}
        {showVerifyModal && (
          <div className="absolute inset-0 z-50 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md p-6 flex flex-col justify-center animate-in fade-in zoom-in-95 duration-200">
            <div className="text-center max-w-sm mx-auto w-full">
              <div className="w-12 h-12 rounded-2xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center mx-auto mb-3 border border-blue-200 dark:border-blue-800">
                <Mail size={24} />
              </div>

              <h3 className="text-base font-bold text-slate-900 dark:text-white mb-1">
                Confirmar E-mail
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-5">
                Digite o código de 6 dígitos enviado para{' '}
                <strong className="text-slate-700 dark:text-slate-200 font-mono">
                  {currentEmail}
                </strong>
              </p>

              <form onSubmit={handleConfirmCode} className="space-y-4">
                <div>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    autoFocus
                    value={verificationCode}
                    onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    className="w-48 mx-auto text-center font-mono text-2xl tracking-[8px] font-black py-2.5 px-3 rounded-xl border-2 border-blue-500 bg-blue-50/30 dark:bg-blue-950/30 text-slate-900 dark:text-white focus:outline-none focus:ring-4 focus:ring-blue-500/20 transition block"
                  />
                  <span className="block text-[10px] text-slate-400 mt-2">
                    ⏱️ O código é válido por 15 minutos
                  </span>
                </div>

                <div className="flex flex-col gap-2 pt-2">
                  <button
                    type="submit"
                    disabled={verifyingCode || verificationCode.length !== 6}
                    className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-md shadow-blue-500/25 disabled:opacity-50 cursor-pointer"
                  >
                    {verifyingCode ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <CheckCircle2 size={14} />
                    )}
                    <span>{verifyingCode ? 'Validando...' : 'Confirmar E-mail'}</span>
                  </button>

                  <div className="flex items-center justify-between text-xs pt-1">
                    <button
                      type="button"
                      onClick={() => setShowVerifyModal(false)}
                      className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition text-[11px] cursor-pointer"
                    >
                      Cancelar
                    </button>

                    <button
                      type="button"
                      onClick={handleRequestVerificationCode}
                      disabled={sendingCode || resendCooldown > 0}
                      className="text-blue-600 dark:text-blue-400 hover:underline transition text-[11px] font-semibold cursor-pointer disabled:opacity-50 disabled:no-underline flex items-center gap-1"
                    >
                      <RefreshCw size={10} className={sendingCode ? 'animate-spin' : ''} />
                      <span>
                        {resendCooldown > 0
                          ? `Reenviar código em ${resendCooldown}s`
                          : 'Reenviar código'}
                      </span>
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
