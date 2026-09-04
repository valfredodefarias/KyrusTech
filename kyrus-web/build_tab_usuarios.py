import re

file_path = 'c:/Users/Ciro/Documents/ERP/KyrusERP/kyrus-web/dump_DadosUsuario.ts'
with open(file_path, 'r', encoding='utf-8') as f:
    text = f.read()

return_match = re.search(r'  return \(', text)
ui_text = text[return_match.start():text.find('// --- SUB-COMPONENTE')] if return_match else ''

hook = """import { useState, useEffect } from 'react';
import { api, toPublicAssetUrl } from '../../../services/api';

export interface UserInfo {
  id: number;
  email: string;
  nome?: string | null;
  foto_url?: string | null;
  is_consultor?: boolean;
  consultor_role?: string;
  permissions?: string[] | null;
}

export function useUsuarios() {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
    } catch (error) {
      console.error(error);
      alert('Erro ao remover foto do usuário.');
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
      alert('Dados do usuário salvos com sucesso!');
    } catch (error) {
      console.error(error);
      alert('Erro ao salvar dados do usuário.');
    } finally {
      setSaving(false);
    }
  }

  return {
    user, loading, saving, userPhotoFile, userPhotoPreview,
    handleUserPhotoChange, handleRemoveUserPhoto, handleSave
  };
}
"""

component = """import React from 'react';
import { Camera, Loader2 } from 'lucide-react';
import { useUsuarios } from '../hooks/useUsuarios';

export const TabUsuarios = () => {
  const {
    user, loading, saving, userPhotoFile, userPhotoPreview,
    handleUserPhotoChange, handleRemoveUserPhoto, handleSave
  } = useUsuarios();

  if (loading) return <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-blue-500 w-8 h-8" /></div>;
  if (!user) return <div className="p-10 text-center text-slate-500">Usuário não encontrado.</div>;

""" + ui_text + "\n"

with open('c:/Users/Ciro/Documents/ERP/KyrusERP/kyrus-web/src/pages/Configuracoes/hooks/useUsuarios.ts', 'w', encoding='utf-8') as f:
    f.write(hook)
    
with open('c:/Users/Ciro/Documents/ERP/KyrusERP/kyrus-web/src/pages/Configuracoes/components/TabUsuarios.tsx', 'w', encoding='utf-8') as f:
    f.write(component)

print('Wrote TabUsuarios.tsx and useUsuarios.ts')
