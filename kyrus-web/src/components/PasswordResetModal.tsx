import { useState, useEffect } from 'react';
import { api } from '../services/api';
import {
  X,
  Mail,
  KeyRound,
  Lock,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Eye,
  EyeOff,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';

interface PasswordResetModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialEmail?: string;
  onSuccessReset?: (email: string) => void;
}

type Step = 'REQUEST_CODE' | 'VERIFY_CODE' | 'SUBMIT_NEW_PASSWORD' | 'SUCCESS';

export function PasswordResetModal({
  isOpen,
  onClose,
  initialEmail = '',
  onSuccessReset,
}: PasswordResetModalProps) {
  const [step, setStep] = useState<Step>('REQUEST_CODE');
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [feedbackMessage, setFeedbackMessage] = useState('');

  // Cooldown de reenvio de código
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (initialEmail) {
      setEmail(initialEmail);
    }
  }, [initialEmail]);

  useEffect(() => {
    let timer: any;
    if (cooldown > 0) {
      timer = setInterval(() => setCooldown((prev) => prev - 1), 1000);
    }
    return () => clearInterval(timer);
  }, [cooldown]);

  if (!isOpen) return null;

  const handleClose = () => {
    setStep('REQUEST_CODE');
    setCode('');
    setNewPassword('');
    setConfirmPassword('');
    setErrorMessage('');
    setFeedbackMessage('');
    onClose();
  };

  // 1. SOLICITAR ENVIO DO CÓDIGO
  const handleRequestCode = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setErrorMessage('Por favor, informe seu e-mail.');
      return;
    }

    setLoading(true);
    setErrorMessage('');
    setFeedbackMessage('');

    try {
      const { data } = await api.post('/auth/recuperar-senha/solicitar', { email: cleanEmail });
      setFeedbackMessage(data.message || 'Código enviado com sucesso!');
      setCooldown(45);
      setStep('VERIFY_CODE');
    } catch (err: any) {
      console.error(err);
      const detail = err.response?.data?.detail;
      if (typeof detail === 'string') {
        setErrorMessage(detail);
      } else if (!err.response) {
        setErrorMessage('Não foi possível conectar ao servidor backend (porta 8000 offline).');
      } else {
        setErrorMessage('Falha ao solicitar código de recuperação.');
      }
    } finally {
      setLoading(false);
    }
  };

  // 2. CONFIRMAR/VALIDAR O CÓDIGO DE 6 DÍGITOS
  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setFeedbackMessage('');

    const cleanCode = code.trim().replace(/\D/g, '');
    if (cleanCode.length !== 6) {
      setErrorMessage('O código de verificação deve conter exatamente 6 números.');
      return;
    }

    setLoading(true);
    try {
      const { data } = await api.post('/auth/recuperar-senha/validar-codigo', {
        email: email.trim().toLowerCase(),
        code: cleanCode,
      });

      setFeedbackMessage(data.message || 'Código validado com sucesso!');
      setStep('SUBMIT_NEW_PASSWORD');
    } catch (err: any) {
      console.error(err);
      const detail = err.response?.data?.detail;
      if (typeof detail === 'string') {
        setErrorMessage(detail);
      } else if (!err.response) {
        setErrorMessage('Não foi possível conectar ao servidor backend (porta 8000 offline).');
      } else {
        setErrorMessage('Código de verificação inválido ou expirado.');
      }
    } finally {
      setLoading(false);
    }
  };

  // 3. SALVAR NOVA SENHA
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    const cleanCode = code.trim().replace(/\D/g, '');
    if (cleanCode.length !== 6) {
      setErrorMessage('Código inválido. Por favor, volte e confirme o código.');
      return;
    }

    if (newPassword.length < 6) {
      setErrorMessage('A nova senha deve ter pelo menos 6 caracteres.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrorMessage('A confirmação de senha não coincide com a nova senha.');
      return;
    }

    setLoading(true);
    try {
      const { data } = await api.post('/auth/recuperar-senha/redefinir', {
        email: email.trim().toLowerCase(),
        code: cleanCode,
        new_password: newPassword,
      });

      setFeedbackMessage(data.message || 'Senha redefinida com sucesso!');
      setStep('SUCCESS');
      if (onSuccessReset) {
        onSuccessReset(email.trim().toLowerCase());
      }
    } catch (err: any) {
      console.error(err);
      const detail = err.response?.data?.detail;
      if (typeof detail === 'string') {
        setErrorMessage(detail);
      } else if (!err.response) {
        setErrorMessage('Não foi possível conectar ao servidor backend (porta 8000 offline).');
      } else {
        setErrorMessage('Falha ao redefinir a senha.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
        
        {/* Cabeçalho do Modal */}
        <div className="px-6 pt-6 pb-4 flex items-center justify-between border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-800 dark:text-white">
                Recuperar Senha
              </h3>
              <p className="text-xs text-slate-400">
                Acesso seguro KyrusTech
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Conteúdo do Modal */}
        <div className="p-6">
          {errorMessage && (
            <div className="mb-4 p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 text-rose-700 dark:text-rose-300 text-xs flex items-start gap-2.5 animate-in slide-in-from-top-1">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex-1 font-medium">{errorMessage}</div>
            </div>
          )}

          {feedbackMessage && step !== 'SUCCESS' && (
            <div className="mb-4 p-3.5 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/50 text-blue-700 dark:text-blue-300 text-xs flex items-start gap-2.5 animate-in slide-in-from-top-1">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-blue-500" />
              <div className="flex-1 font-medium">{feedbackMessage}</div>
            </div>
          )}

          {/* ETAPA 1: SOLICITAR CÓDIGO */}
          {step === 'REQUEST_CODE' && (
            <form onSubmit={handleRequestCode} className="space-y-4">
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Digite o e-mail cadastrado na sua conta. Nós enviaremos um código de verificação de 6 dígitos via e-mail para validar sua identidade.
              </p>

              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                  E-mail corporativo
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="seu.email@empresa.com"
                    className="w-full pl-10 pr-3 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 outline-none transition"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full mt-2 py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-xl shadow-lg transition flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Enviando código...
                  </>
                ) : (
                  <>
                    <ArrowRight className="w-4 h-4" /> Enviar código de verificação
                  </>
                )}
              </button>
            </form>
          )}

          {/* ETAPA 2: DIGITAR E CONFIRMAR O CÓDIGO (ANTES DA SENHA) */}
          {step === 'VERIFY_CODE' && (
            <form onSubmit={handleVerifyCode} className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                    Código de 6 dígitos
                  </label>
                  <button
                    type="button"
                    disabled={cooldown > 0 || loading}
                    onClick={() => handleRequestCode()}
                    className="text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400 font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                  >
                    <RotateCcw className="w-3 h-3" />
                    {cooldown > 0 ? `Reenviar em ${cooldown}s` : 'Reenviar código'}
                  </button>
                </div>
                <input
                  type="text"
                  maxLength={6}
                  required
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="000000"
                  className="w-full text-center font-mono text-2xl tracking-[0.5em] py-3 rounded-xl border border-blue-500/40 bg-blue-50/20 dark:bg-blue-950/20 text-slate-800 dark:text-white font-black focus:ring-2 focus:ring-blue-500 outline-none transition"
                />
                <p className="text-[11px] text-slate-400 mt-1.5">
                  Insira o código recebido no e-mail <strong>{email}</strong> para validar o acesso.
                </p>
              </div>

              <div className="pt-2 flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep('REQUEST_CODE')}
                  className="w-1/3 py-2.5 px-3 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold text-xs rounded-xl transition"
                >
                  Voltar
                </button>
                <button
                  type="submit"
                  disabled={loading || code.trim().length !== 6}
                  className="flex-1 py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-xl shadow-lg transition flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Verificando...
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-4 h-4" /> Confirmar Código
                    </>
                  )}
                </button>
              </div>
            </form>
          )}

          {/* ETAPA 3: DEFINIR NOVA SENHA (APENAS APÓS CÓDIGO CONFIRMADO) */}
          {step === 'SUBMIT_NEW_PASSWORD' && (
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500" />
                <span>Identidade validada! Agora crie sua nova senha de acesso:</span>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                  Nova Senha
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    autoFocus
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                    className="w-full pl-10 pr-11 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 outline-none transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-white"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                  Confirmar Nova Senha
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repita a nova senha"
                    className="w-full pl-10 pr-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 outline-none transition"
                  />
                </div>
              </div>

              <div className="pt-2 flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep('VERIFY_CODE')}
                  className="w-1/3 py-2.5 px-3 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold text-xs rounded-xl transition"
                >
                  Voltar
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm rounded-xl shadow-lg transition flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Atualizando...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" /> Salvar Nova Senha
                    </>
                  )}
                </button>
              </div>
            </form>
          )}

          {/* ETAPA 4: SUCESSO */}
          {step === 'SUCCESS' && (
            <div className="text-center py-4 space-y-4 animate-in zoom-in-95 duration-200">
              <div className="w-14 h-14 mx-auto rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-500 flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <div>
                <h4 className="text-lg font-bold text-slate-800 dark:text-white">
                  Senha Redefinida com Sucesso!
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-xs mx-auto leading-relaxed">
                  Sua senha foi atualizada. Você já pode acessar o sistema com suas novas credenciais.
                </p>
              </div>
              <button
                type="button"
                onClick={handleClose}
                className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-xl shadow-lg transition"
              >
                Ir para o Login
              </button>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
