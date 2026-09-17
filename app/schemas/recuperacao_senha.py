# app/schemas/recuperacao_senha.py
from pydantic import BaseModel, Field


class ForgotPasswordRequest(BaseModel):
    email: str = Field(description="E-mail do usuário cadastrado no sistema")


class VerifyResetCodeRequest(BaseModel):
    email: str = Field(description="E-mail do usuário")
    code: str = Field(min_length=6, max_length=6, description="Código de 6 dígitos numéricos")


class ResetPasswordRequest(BaseModel):
    email: str = Field(description="E-mail do usuário")
    code: str = Field(min_length=6, max_length=6, description="Código de 6 dígitos numéricos")
    new_password: str = Field(min_length=6, max_length=128, description="Nova senha de acesso")


class PasswordResetMessageResponse(BaseModel):
    ok: bool = True
    message: str
