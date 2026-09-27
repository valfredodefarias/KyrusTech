# app/services/email_service.py
from datetime import datetime
from typing import Optional, Union, List
import requests
from loguru import logger
from app.core.config import settings


def renderizar_template_recuperacao_senha(codigo: str, nome: Optional[str] = None) -> str:
    """Gera um template HTML profissional e responsivo com a marca KyrusTech (branco e azul)."""
    saudacao = f"Olá, <strong>{nome}</strong>!" if nome else "Olá!"
    ano_atual = datetime.now().year
    
    return f"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Código de Recuperação de Senha - KyrusTech</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; color: #1e293b;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9; padding: 40px 15px;">
    <tr>
      <td align="center">
        <!-- Container Principal -->
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 540px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 20px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.08);">
          
          <!-- Topo da Marca: Clean White Corporativo -->
          <tr>
            <td align="center" style="padding: 36px 30px 24px 30px; background-color: #ffffff; border-bottom: 1px solid #f1f5f9;">
              <table border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center">
                    <span style="font-size: 28px; font-weight: 900; letter-spacing: -0.5px; color: #0f172a; display: block; line-height: 1;">
                      Kyrus<span style="color: #2563eb;">TECH</span>
                    </span>
                    <span style="display: inline-block; margin-top: 10px; padding: 4px 14px; background-color: #eff6ff; border: 1px solid #dbeafe; border-radius: 9999px; font-size: 11px; font-weight: 600; color: #1d4ed8; letter-spacing: 0.3px;">
                      🚀 Gestão Financeira Descomplicada
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Corpo do E-mail -->
          <tr>
            <td style="padding: 36px 36px 28px 36px;">
              <h1 style="margin: 0 0 16px 0; font-size: 21px; font-weight: 800; color: #0f172a; letter-spacing: -0.4px;">
                Recuperação de Acesso
              </h1>
              <p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.6; color: #475569;">
                {saudacao}
              </p>
              <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.6; color: #475569;">
                Uma solicitação para redefinir a senha da sua conta no <strong>KyrusERP</strong> foi iniciada. Copie o código de verificação abaixo para concluir o processo com segurança:
              </p>

              <!-- Caixa do Código de 6 Dígitos -->
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 26px 0;">
                <tr>
                  <td align="center" style="background: linear-gradient(180deg, #f8faff 0%, #eff6ff 100%); border: 2px dashed #2563eb; border-radius: 16px; padding: 26px 20px;">
                    <span style="display: block; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: #2563eb; margin-bottom: 8px;">
                      Seu Código de Segurança
                    </span>
                    <span style="font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace; font-size: 40px; font-weight: 900; letter-spacing: 10px; color: #1e3a8a; display: block; line-height: 1.1;">
                      {codigo}
                    </span>
                    <span style="display: inline-block; margin-top: 14px; font-size: 12px; font-weight: 600; color: #d97706; background-color: #fef3c7; border: 1px solid #fde68a; padding: 3px 12px; border-radius: 8px;">
                      ⏱️ Válido por 15 minutos
                    </span>
                  </td>
                </tr>
              </table>

              <!-- Aviso de Segurança -->
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; border-left: 4px solid #3b82f6; border-radius: 0 8px 8px 0; padding: 14px 16px; margin-bottom: 20px;">
                <tr>
                  <td>
                    <p style="margin: 0; font-size: 12.5px; line-height: 1.5; color: #64748b;">
                      <strong>Dica de Segurança:</strong> Nunca compartilhe este código com ninguém. Nossa equipe nunca entrará em contato solicitando este código.
                    </p>
                  </td>
                </tr>
              </table>

              <p style="margin: 0; font-size: 13px; line-height: 1.6; color: #94a3b8;">
                Caso não tenha solicitado esta alteração, desconsidere esta mensagem. Sua conta permanece protegida e sua senha atual inalterada.
              </p>
            </td>
          </tr>

          <!-- Rodapé Corporativo -->
          <tr>
            <td align="center" style="padding: 24px 30px; background-color: #f8fafc; border-top: 1px solid #e2e8f0;">
              <p style="margin: 0 0 6px 0; font-size: 12px; font-weight: 600; color: #475569;">
                KyrusTech Soluções em Gestão Empresarial
              </p>
              <p style="margin: 0 0 8px 0; font-size: 11px; color: #94a3b8;">
                Mensagem automática de segurança. Por favor, não responda a este e-mail.
              </p>
              <p style="margin: 0; font-size: 11px; color: #cbd5e1;">
                &copy; {ano_atual} KyrusTech &bull; Todos os direitos reservados.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""


def enviar_email(
    to: Union[str, List[str]],
    subject: str,
    html: str,
    from_email: Optional[str] = None
) -> bool:
    """
    Envia e-mail transacional via API oficial do Resend.
    Retorna True se o envio for aceito pelo Resend, False caso contrário.
    """
    api_key = settings.RESEND_API_KEY
    if not api_key:
        logger.warning("[EmailService] RESEND_API_KEY não configurada no arquivo .env. E-mail não enviado.")
        return False

    remetente = from_email or settings.EMAIL_FROM
    destinatarios = [to] if isinstance(to, str) else to

    payload = {
        "from": remetente,
        "to": destinatarios,
        "subject": subject,
        "html": html,
    }

    try:
        response = requests.post(
            "https://api.resend.com/emails",
            headers={
                "Authorization": f"Bearer {api_key.strip()}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=12,
        )

        if response.status_code in (200, 201):
            data = response.json()
            email_id = data.get("id")
            logger.info(f"[EmailService] E-mail despachado com sucesso! ID: {email_id} | Destinatários: {destinatarios}")
            return True
        else:
            logger.error(f"[EmailService] Falha no envio pelo Resend: HTTP {response.status_code} - {response.text}")
            return False

    except requests.RequestException as exc:
        logger.exception(f"[EmailService] Erro de rede ao conectar com a API do Resend: {exc}")
        return False


def enviar_codigo_recuperacao_senha(email: str, codigo: str, nome: Optional[str] = None) -> bool:
    """Dispara o e-mail de recuperação de senha com código de 6 dígitos."""
    assunto = f"{codigo} é seu código de recuperação de senha - KyrusTech"
    html_content = renderizar_template_recuperacao_senha(codigo=codigo, nome=nome)
    return enviar_email(to=email, subject=assunto, html=html_content)


def renderizar_template_convite_usuario(
    nome: Optional[str],
    email: str,
    link_acesso: str,
    empresas_nomes: List[str],
    is_existing_user: bool = False
) -> str:
    """Gera template de e-mail corporativo para convite de usuário ou liberação de novas empresas."""
    saudacao = f"Olá, <strong>{nome}</strong>!" if nome else "Olá!"
    ano_atual = datetime.now().year

    # Formatação da lista de empresas
    if empresas_nomes:
        empresas_html = "".join([
            f'<li style="margin-bottom: 6px; color: #1e293b; font-weight: 600;">🏢 {emp}</li>'
            for emp in empresas_nomes
        ])
        empresas_box = f"""
        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px 20px; margin: 20px 0;">
          <span style="display: block; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #64748b; margin-bottom: 8px;">
            Empresas com Acesso Liberado:
          </span>
          <ul style="margin: 0; padding-left: 20px; font-size: 14px; line-height: 1.6;">
            {empresas_html}
          </ul>
        </div>
        """
    else:
        empresas_box = ""

    if is_existing_user:
        titulo = "Novo Acesso Liberado"
        mensagem_principal = (
            "Sua conta no <strong>KyrusERP</strong> recebeu acesso a novas empresas. "
            "Você já pode entrar no sistema utilizando seu e-mail e senha habituais:"
        )
        texto_botao = "Acessar o KyrusERP"
        rodape_aviso = "Como você já possui cadastro ativo, sua senha permanece a mesma. Ao fazer login, você poderá alternar entre suas empresas no menu do topo."
        badge_status = "🎉 Acesso Atualizado"
    else:
        titulo = "Bem-vindo ao KyrusERP"
        mensagem_principal = (
            "Você foi cadastrado para acessar a plataforma de gestão <strong>KyrusERP</strong>. "
            "Para concluir sua ativação, clique no botão abaixo para definir sua senha pessoal e personalizar seu perfil:"
        )
        texto_botao = "Definir Minha Senha e Acessar"
        rodape_aviso = "Por segurança, este link de primeiro acesso expira em 48 horas. Se o link expirar, solicite um novo convite ao administrador da sua empresa."
        badge_status = "⏱️ Convite Válido por 48h"

    return f"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{titulo} - KyrusTech</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; color: #1e293b;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9; padding: 40px 15px;">
    <tr>
      <td align="center">
        <!-- Container Principal -->
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 540px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 20px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.08);">
          
          <!-- Topo da Marca: Clean White Corporativo -->
          <tr>
            <td align="center" style="padding: 36px 30px 24px 30px; background-color: #ffffff; border-bottom: 1px solid #f1f5f9;">
              <table border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center">
                    <span style="font-size: 28px; font-weight: 900; letter-spacing: -0.5px; color: #0f172a; display: block; line-height: 1;">
                      Kyrus<span style="color: #2563eb;">TECH</span>
                    </span>
                    <span style="display: inline-block; margin-top: 10px; padding: 4px 14px; background-color: #eff6ff; border: 1px solid #dbeafe; border-radius: 9999px; font-size: 11px; font-weight: 600; color: #1d4ed8; letter-spacing: 0.3px;">
                      🚀 Gestão Financeira Descomplicada
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Corpo do E-mail -->
          <tr>
            <td style="padding: 36px 36px 28px 36px;">
              <h1 style="margin: 0 0 16px 0; font-size: 21px; font-weight: 800; color: #0f172a; letter-spacing: -0.4px;">
                {titulo}
              </h1>
              <p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.6; color: #475569;">
                {saudacao}
              </p>
              <p style="margin: 0 0 20px 0; font-size: 14.5px; line-height: 1.6; color: #475569;">
                {mensagem_principal}
              </p>

              {empresas_box}

              <!-- Botão de Ação Chamativo -->
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 28px 0 18px 0;">
                <tr>
                  <td align="center">
                    <a href="{link_acesso}" target="_blank" style="display: inline-block; background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); color: #ffffff; text-decoration: none; font-size: 15px; font-weight: 700; padding: 15px 34px; border-radius: 12px; box-shadow: 0 4px 14px rgba(37, 99, 235, 0.35); text-align: center;">
                      {texto_botao} &rarr;
                    </a>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding-top: 14px;">
                    <span style="display: inline-block; font-size: 12px; font-weight: 600; color: #64748b; background-color: #f1f5f9; padding: 3px 12px; border-radius: 8px;">
                      {badge_status}
                    </span>
                  </td>
                </tr>
              </table>

              <!-- Aviso de Segurança / Instruções -->
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; border-left: 4px solid #3b82f6; border-radius: 0 8px 8px 0; padding: 14px 16px; margin-top: 24px;">
                <tr>
                  <td>
                    <p style="margin: 0; font-size: 12.5px; line-height: 1.5; color: #64748b;">
                      {rodape_aviso}
                    </p>
                  </td>
                </tr>
              </table>

              <p style="margin: 20px 0 0 0; font-size: 12px; line-height: 1.5; color: #94a3b8; word-break: break-all;">
                Se o botão acima não funcionar, copie e cole o link a seguir no seu navegador:<br>
                <a href="{link_acesso}" style="color: #2563eb; text-decoration: underline;">{link_acesso}</a>
              </p>
            </td>
          </tr>

          <!-- Rodapé Corporativo -->
          <tr>
            <td align="center" style="padding: 24px 30px; background-color: #f8fafc; border-top: 1px solid #e2e8f0;">
              <p style="margin: 0 0 6px 0; font-size: 12px; font-weight: 600; color: #475569;">
                KyrusTech Soluções em Gestão Empresarial
              </p>
              <p style="margin: 0 0 8px 0; font-size: 11px; color: #94a3b8;">
                Mensagem automática de segurança. Por favor, não responda a este e-mail.
              </p>
              <p style="margin: 0; font-size: 11px; color: #cbd5e1;">
                &copy; {ano_atual} KyrusTech &bull; Todos os direitos reservados.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""


def enviar_email_convite_usuario(
    email: str,
    link_acesso: str,
    nome: Optional[str] = None,
    empresas_nomes: Optional[List[str]] = None,
    is_existing_user: bool = False
) -> bool:
    """Dispara o e-mail de convite ou de liberação de novas empresas."""
    if is_existing_user:
        assunto = "Novo acesso liberado no KyrusERP - KyrusTech"
    else:
        assunto = "Convite para acessar o KyrusERP - KyrusTech"

    html_content = renderizar_template_convite_usuario(
        nome=nome,
        email=email,
        link_acesso=link_acesso,
        empresas_nomes=empresas_nomes or [],
        is_existing_user=is_existing_user,
    )
    return enviar_email(to=email, subject=assunto, html=html_content)


def renderizar_template_confirmacao_email(codigo: str, nome: Optional[str] = None) -> str:
    """Gera template de e-mail corporativo para verificação/confirmação de e-mail."""
    saudacao = f"Olá, <strong>{nome}</strong>!" if nome else "Olá!"
    ano_atual = datetime.now().year

    return f"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Confirmação de E-mail - KyrusERP</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; color: #1e293b;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9; padding: 40px 15px;">
    <tr>
      <td align="center">
        <!-- Container Principal -->
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 540px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 20px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.08);">
          
          <!-- Topo da Marca -->
          <tr>
            <td align="center" style="padding: 36px 30px 24px 30px; background-color: #ffffff; border-bottom: 1px solid #f1f5f9;">
              <table border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center">
                    <span style="font-size: 28px; font-weight: 900; letter-spacing: -0.5px; color: #0f172a; display: block; line-height: 1;">
                      Kyrus<span style="color: #2563eb;">TECH</span>
                    </span>
                    <span style="display: inline-block; margin-top: 10px; padding: 4px 14px; background-color: #eff6ff; border: 1px solid #dbeafe; border-radius: 9999px; font-size: 11px; font-weight: 600; color: #1d4ed8; letter-spacing: 0.3px;">
                      🛡️ Verificação de Identidade
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Corpo do E-mail -->
          <tr>
            <td style="padding: 36px 36px 28px 36px;">
              <h1 style="margin: 0 0 16px 0; font-size: 21px; font-weight: 800; color: #0f172a; letter-spacing: -0.4px;">
                Confirmação de E-mail
              </h1>
              <p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.6; color: #475569;">
                {saudacao}
              </p>
              <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.6; color: #475569;">
                Recebemos sua solicitação para confirmar este endereço de e-mail na sua conta <strong>KyrusERP</strong>. Utilize o código de 6 dígitos abaixo para concluir a verificação:
              </p>

              <!-- Caixa do Código -->
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 26px 0;">
                <tr>
                  <td align="center" style="background: linear-gradient(180deg, #f0fdf4 0%, #dcfce7 100%); border: 2px dashed #16a34a; border-radius: 16px; padding: 26px 20px;">
                    <span style="display: block; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: #15803d; margin-bottom: 8px;">
                      Código de Confirmação
                    </span>
                    <span style="font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace; font-size: 40px; font-weight: 900; letter-spacing: 10px; color: #14532d; display: block; line-height: 1.1;">
                      {codigo}
                    </span>
                    <span style="display: inline-block; margin-top: 14px; font-size: 12px; font-weight: 600; color: #166534; background-color: #bbf7d0; border: 1px solid #86efac; padding: 3px 12px; border-radius: 8px;">
                      ⏱️ Válido por 15 minutos
                    </span>
                  </td>
                </tr>
              </table>

              <!-- Aviso de Segurança -->
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; border-left: 4px solid #16a34a; border-radius: 0 8px 8px 0; padding: 14px 16px; margin-bottom: 20px;">
                <tr>
                  <td>
                    <p style="margin: 0; font-size: 12.5px; line-height: 1.5; color: #64748b;">
                      <strong>Proteção da Conta:</strong> A confirmação de e-mail garante a recuperação segura do seu acesso e notificações críticas de auditoria.
                    </p>
                  </td>
                </tr>
              </table>

              <p style="margin: 0; font-size: 13px; line-height: 1.6; color: #94a3b8;">
                Se você não solicitou esta confirmação, por favor ignore este e-mail. Nenhuma alteração foi realizada.
              </p>
            </td>
          </tr>

          <!-- Rodapé Corporativo -->
          <tr>
            <td align="center" style="padding: 24px 30px; background-color: #f8fafc; border-top: 1px solid #e2e8f0;">
              <p style="margin: 0 0 6px 0; font-size: 12px; font-weight: 600; color: #475569;">
                KyrusTech Soluções em Gestão Empresarial
              </p>
              <p style="margin: 0 0 8px 0; font-size: 11px; color: #94a3b8;">
                Mensagem automática do sistema. Por favor, não responda a este e-mail.
              </p>
              <p style="margin: 0; font-size: 11px; color: #cbd5e1;">
                &copy; {ano_atual} KyrusTech &bull; Todos os direitos reservados.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""


def enviar_codigo_confirmacao_email(email: str, codigo: str, nome: Optional[str] = None) -> bool:
    """Dispara o e-mail com código de confirmação de 6 dígitos."""
    assunto = f"{codigo} é seu código de confirmação de e-mail - KyrusERP"
    html_content = renderizar_template_confirmacao_email(codigo=codigo, nome=nome)
    enviado = enviar_email(to=email, subject=assunto, html=html_content)
    if not enviado:
        logger.warning(
            f"[EmailService] [DEV / TESTE] Resend não configurado ou indisponível. Código de confirmação para {email}: {codigo}"
        )
    return True
