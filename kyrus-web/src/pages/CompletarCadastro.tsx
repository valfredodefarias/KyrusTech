import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { 
  Lock, 
  Eye, 
  EyeOff, 
  Camera, 
  CheckCircle2, 
  AlertCircle, 
  Building2, 
  ArrowRight, 
  Loader2, 
  ShieldCheck,
  Sparkles
} from 'lucide-react';
import axios from 'axios';
import { useAuthStore } from '../store/authStore';

export default function CompletarCadastro() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const navigate = useNavigate();
  const setAuthenticated = useAuthStore((s) => s.setAuthenticated);
  const setUser = useAuthStore((s) => s.setUser);
  const setInitialized = useAuthStore((s) => s.setInitialized);

  // Estados de carregamento e validação inicial do convite
  const [loadingInvite, setLoadingInvite] = useState(true);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [userData, setUserData] = useState<{
    nome: string;
    email: string;
    foto_url?: string | null;
    empresas: Array<{ id: number; nome_fantasia: string; logo_url?: string | null }>;
  } | null>(null);

  // Estados do formulário de finalização
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Upload de Foto
  const [fotoPreview, setFotoPreview] = useState<string | null>(null);
  const [fotoUrl, setFotoUrl] = useState<string | null>(null);
  const [uploadingFoto, setUploadingFoto] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 1. Valida o token ao carregar a página
  useEffect(() => {
    async function validarToken() {
      if (!token) {
        setInviteError('Token de convite não encontrado na URL. Verifique o link recebido por e-mail.');
        setLoadingInvite(false);
        return;
      }

      try {
        const { data } = await axios.get(`/api/v1/usuarios/convite/validar?token=${encodeURIComponent(token)}`);
        if (data && data.valid) {
          setUserData({
            nome: data.usuario.nome || '',
            email: data.usuario.email || '',
            foto_url: data.usuario.foto_url,
            empresas: data.empresas || []
          });
          if (data.usuario.foto_url) {
            setFotoPreview(data.usuario.foto_url);
            setFotoUrl(data.usuario.foto_url);
          }
        } else {
          setInviteError('Convite inválido ou expirado.');
        }
      } catch (err: any) {
        const msg = err.response?.data?.detail || 'Convite expirado ou não encontrado. Solicite um novo ao administrador.';
        setInviteError(msg);
      } finally {
        setLoadingInvite(false);
      }
    }

    validarToken();
  }, [token]);

  // Manipulador de upload de foto
  async function handleFotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Preview local imediato
    const objectUrl = URL.createObjectURL(file);
    setFotoPreview(objectUrl);

    // Envio para o backend
    setUploadingFoto(true);
    setSubmitError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const { data } = await axios.post(
        `/api/v1/usuarios/convite/upload-foto?token=${encodeURIComponent(token)}`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      );

      if (data?.foto_url) {
        setFotoUrl(data.foto_url);
      }
    } catch (err: any) {
      setSubmitError(err.response?.data?.detail || 'Erro ao enviar foto de perfil.');
    } finally {
      setUploadingFoto(false);
    }
  }

  // Cálculo visual de força da senha
  const passwordStrength = (() => {
    if (!password) return { level: 0, text: '', color: 'bg-slate-700' };
    let score = 0;
    if (password.length >= 6) score += 1;
    if (password.length >= 8) score += 1;
    if (/[A-Z]/.test(password)) score += 1;
    if (/[0-9]/.test(password)) score += 1;
    if (/[^A-Za-z0-9]/.test(password)) score += 1;

    if (score <= 2) return { level: 1, text: 'Fraca', color: 'bg-rose-500' };
    if (score <= 3) return { level: 2, text: 'Média', color: 'bg-amber-500' };
    return { level: 3, text: 'Forte', color: 'bg-emerald-500' };
  })();

  // 2. Concluir cadastro e submeter senha
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    if (password.length < 6) {
      setSubmitError('A senha deve ter pelo menos 6 caracteres.');
      return;
    }

    if (password !== confirmPassword) {
      setSubmitError('As senhas não coincidem. Digite com atenção.');
      return;
    }

    setSubmitting(true);
    try {
      const { data } = await axios.post('/api/v1/usuarios/convite/completar', {
        token,
        password,
        foto_url: fotoUrl
      });

      if (data?.access_token) {
        setSuccess(true);
        // Salva autenticação no store
        setAuthenticated(true);
        setUser(data.user);
        setInitialized(true);

        // Redireciona para o ERP após breve feedback de sucesso
        setTimeout(() => {
          navigate('/');
        }, 1200);
      }
    } catch (err: any) {
      setSubmitError(err.response?.data?.detail || 'Ocorreu um erro ao concluir seu cadastro.');
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen w-full bg-[#090D16] text-slate-100 flex flex-col justify-center items-center p-4 sm:p-6 relative overflow-hidden font-sans">
      {/* Background Decorativo de Luzes Sutis */}
      <div className="absolute -top-40 -left-40 w-96 h-96 bg-blue-600/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Card Central */}
      <div className="w-full max-w-lg bg-slate-900/80 backdrop-blur-xl border border-slate-800/80 rounded-3xl p-6 sm:p-8 shadow-2xl shadow-black/50 relative z-10 transition-all duration-300">
        
        {/* Logo e Branding */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-semibold tracking-wide mb-3">
            <Sparkles className="w-3.5 h-3.5" />
            <span>KyrusTech &bull; Primeiro Acesso</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white flex items-center justify-center gap-1">
            Kyrus<span className="text-blue-500">TECH</span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Gestão Financeira Descomplicada
          </p>
        </div>

        {/* Estado: Carregando convite */}
        {loadingInvite && (
          <div className="py-12 flex flex-col items-center justify-center gap-3">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
            <p className="text-sm text-slate-400">Verificando autenticidade do convite...</p>
          </div>
        )}

        {/* Estado: Erro no convite */}
        {!loadingInvite && inviteError && (
          <div className="space-y-6 text-center py-4">
            <div className="w-16 h-16 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center mx-auto">
              <AlertCircle className="w-8 h-8" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white mb-2">Convite Indisponível</h2>
              <p className="text-sm text-slate-400 leading-relaxed max-w-sm mx-auto">
                {inviteError}
              </p>
            </div>
            <button
              onClick={() => navigate('/login')}
              className="w-full py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-semibold transition flex items-center justify-center gap-2"
            >
              Ir para o Login
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Estado: Sucesso concluído */}
        {!loadingInvite && success && (
          <div className="space-y-5 text-center py-6 animate-fade-in">
            <div className="w-16 h-16 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-9 h-9" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white mb-1">Conta Ativada com Sucesso!</h2>
              <p className="text-sm text-slate-400">
                Seja bem-vindo(a) ao KyrusERP. Estamos te conectando ao sistema...
              </p>
            </div>
            <div className="flex justify-center pt-2">
              <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
            </div>
          </div>
        )}

        {/* Estado: Formulário de Conclusão */}
        {!loadingInvite && !inviteError && !success && userData && (
          <form onSubmit={handleSubmit} className="space-y-6">
            
            {/* Mensagem de Boas-vindas e Dados */}
            <div className="bg-slate-800/40 border border-slate-800 rounded-2xl p-4 text-center">
              <p className="text-xs uppercase tracking-wider text-slate-400 font-bold mb-1">
                Convidado para o time
              </p>
              <h2 className="text-lg font-bold text-white">
                {userData.nome || 'Novo Colaborador'}
              </h2>
              <p className="text-xs text-blue-400 font-mono mt-0.5">
                {userData.email}
              </p>

              {/* Lista de Empresas Vinculadas */}
              {userData.empresas && userData.empresas.length > 0 && (
                <div className="mt-3 pt-3 border-t border-slate-800/80">
                  <span className="text-[11px] text-slate-400 font-semibold block mb-2">
                    Empresas com acesso liberado:
                  </span>
                  <div className="flex flex-wrap gap-1.5 justify-center">
                    {userData.empresas.map((emp) => (
                      <span 
                        key={emp.id}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700/60 text-xs font-medium text-slate-200"
                      >
                        <Building2 className="w-3 h-3 text-blue-400" />
                        {emp.nome_fantasia}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Upload de Foto de Perfil */}
            <div className="flex flex-col items-center gap-2">
              <div className="relative group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                <div className="w-20 h-20 rounded-full border-2 border-dashed border-slate-700 group-hover:border-blue-500 overflow-hidden bg-slate-800/70 flex items-center justify-center transition">
                  {fotoPreview ? (
                    <img src={fotoPreview} alt="Foto de perfil" className="w-full h-full object-cover" />
                  ) : (
                    <Camera className="w-7 h-7 text-slate-400 group-hover:text-blue-400 transition" />
                  )}
                  {uploadingFoto && (
                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                      <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
                    </div>
                  )}
                </div>
                <div className="absolute -bottom-1 -right-1 bg-blue-600 rounded-full p-1.5 text-white shadow-md">
                  <Camera className="w-3.5 h-3.5" />
                </div>
              </div>
              <span className="text-xs text-slate-400 font-medium">
                {uploadingFoto ? 'Enviando foto...' : 'Foto de perfil (opcional)'}
              </span>
              <input 
                ref={fileInputRef} 
                type="file" 
                accept="image/png,image/jpeg,image/webp,image/jpg" 
                className="hidden" 
                onChange={handleFotoChange}
              />
            </div>

            {/* Alerta de Erro no formulário */}
            {submitError && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{submitError}</span>
              </div>
            )}

            {/* Campos de Senha */}
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Crie sua Nova Senha
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                    required
                    className="w-full pl-10 pr-10 py-2.5 bg-slate-950/60 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-500 hover:text-slate-300"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                {/* Barra de Força da Senha */}
                {password && (
                  <div className="mt-2 space-y-1">
                    <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden flex gap-1">
                      <div className={`h-full flex-1 transition-all duration-300 ${passwordStrength.level >= 1 ? passwordStrength.color : 'bg-transparent'}`} />
                      <div className={`h-full flex-1 transition-all duration-300 ${passwordStrength.level >= 2 ? passwordStrength.color : 'bg-transparent'}`} />
                      <div className={`h-full flex-1 transition-all duration-300 ${passwordStrength.level >= 3 ? passwordStrength.color : 'bg-transparent'}`} />
                    </div>
                    <div className="flex justify-between items-center text-[10px] text-slate-400">
                      <span>Segurança da senha:</span>
                      <span className="font-semibold text-white">{passwordStrength.text}</span>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Confirme a Nova Senha
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repita a mesma senha"
                    required
                    className="w-full pl-10 pr-10 py-2.5 bg-slate-950/60 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-500 hover:text-slate-300"
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>

            {/* Botão de Conclusão */}
            <button
              type="submit"
              disabled={submitting || uploadingFoto}
              className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-sm shadow-lg shadow-blue-600/25 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Ativando sua conta...</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  <span>Definir Senha e Acessar o ERP</span>
                </>
              )}
            </button>

            <p className="text-[11px] text-center text-slate-500">
              Ao continuar, você concorda com as políticas de acesso e segurança da sua empresa no KyrusERP.
            </p>

          </form>
        )}

      </div>
    </div>
  );
}
