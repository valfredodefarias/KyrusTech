import { useState, useEffect } from 'react';
import { api, toPublicAssetUrl } from '../../../services/api';
import { useAuthStore } from '../../../store/authStore';
import { toast } from 'sonner';

export interface UserInfo {
  id: number;
  email: string;
  nome?: string | null;
  foto_url?: string | null;
  telefone?: string | null;
  email_confirmado?: boolean;
  is_consultor?: boolean;
  consultor_role?: string;
  permissions?: string[] | null;
}

export function useUsuarios() {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updatingProfile, setUpdatingProfile] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [userPhotoFile, setUserPhotoFile] = useState<File | null>(null);
  const [userPhotoPreview, setUserPhotoPreview] = useState<string | null>(null);

  useEffect(() => {
    void loadUser();
  }, []);

  useEffect(() => {
    if (!userPhotoFile) return;
    const url = URL.createObjectURL(userPhotoFile);
    setUserPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [userPhotoFile]);

  async function loadUser() {
    try {
      const { data } = await api.get<UserInfo>('/usuarios/me');
      setUser(data);
      if (data?.foto_url) {
        setUserPhotoPreview(toPublicAssetUrl(data.foto_url));
      }
      const authUser = useAuthStore.getState().user;
      if (authUser) {
        useAuthStore.getState().setUser({
          ...authUser,
          nome: data.nome ?? authUser.nome,
          email: data.email ?? authUser.email,
          telefone: data.telefone ?? authUser.telefone,
          email_confirmado: data.email_confirmado ?? authUser.email_confirmado,
          foto_url: data.foto_url ?? authUser.foto_url,
        });
      }
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }

  const handleUserPhotoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      setUserPhotoFile(event.target.files[0]);
    }
  };

  async function handleRemoveUserPhoto() {
    try {
      await api.delete('/usuarios/me/foto');
      setUserPhotoFile(null);
      setUserPhotoPreview(null);
      setUser((prev) => (prev ? { ...prev, foto_url: null } : prev));
      const authUser = useAuthStore.getState().user;
      if (authUser) {
        useAuthStore.getState().setUser({
          ...authUser,
          foto_url: null,
        });
      }
      toast.success('Foto removida com sucesso!');
    } catch (error) {
      console.error(error);
      toast.error('Erro ao remover foto do usuário.');
    }
  }

  async function handleSave() {
    if (!userPhotoFile) return;
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('file', userPhotoFile);
      const { data } = await api.post<UserInfo>('/usuarios/me/foto', fd);
      setUser(data);
      setUserPhotoFile(null);
      if (data?.foto_url) {
        setUserPhotoPreview(toPublicAssetUrl(data.foto_url));
      }
      const authUser = useAuthStore.getState().user;
      if (authUser) {
        useAuthStore.getState().setUser({
          ...authUser,
          foto_url: data.foto_url,
        });
      }
      toast.success('Foto do perfil atualizada com sucesso!');
    } catch (error) {
      console.error(error);
      toast.error('Erro ao salvar foto do usuário.');
    } finally {
      setSaving(false);
    }
  }

  async function updateProfile(data: { nome?: string; email?: string; telefone?: string }) {
    setUpdatingProfile(true);
    try {
      const response = await api.put<UserInfo>('/usuarios/me', data);
      setUser(response.data);
      const authUser = useAuthStore.getState().user;
      if (authUser) {
        useAuthStore.getState().setUser({
          ...authUser,
          nome: response.data.nome ?? authUser.nome,
          email: response.data.email ?? authUser.email,
          telefone: response.data.telefone ?? authUser.telefone,
          email_confirmado: response.data.email_confirmado ?? false,
        });
      }
      return response.data;
    } finally {
      setUpdatingProfile(false);
    }
  }

  async function sendEmailVerificationCode() {
    setSendingCode(true);
    try {
      const response = await api.post<{ ok: boolean; message: string }>('/usuarios/me/enviar-confirmacao-email');
      return response.data;
    } finally {
      setSendingCode(false);
    }
  }

  async function verifyEmailCode(codigo: string) {
    setVerifyingCode(true);
    try {
      const response = await api.post<UserInfo>('/usuarios/me/validar-confirmacao-email', { codigo });
      setUser(response.data);
      const authUser = useAuthStore.getState().user;
      if (authUser) {
        useAuthStore.getState().setUser({
          ...authUser,
          email_confirmado: true,
        });
      }
      return response.data;
    } finally {
      setVerifyingCode(false);
    }
  }

  return {
    loadUser,
    user, loading, saving, userPhotoFile, userPhotoPreview,
    updatingProfile, sendingCode, verifyingCode,
    handleUserPhotoChange, handleRemoveUserPhoto, handleSave,
    updateProfile, sendEmailVerificationCode, verifyEmailCode,
  };
}
