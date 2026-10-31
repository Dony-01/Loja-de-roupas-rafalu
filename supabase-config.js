/* ==========================================================================
   RAFALU — supabase-config.js
   ==========================================================================
   Configuração PÚBLICA de conexão com o Supabase.

   O que pode ficar aqui (é público por desenho; a segurança está nas regras
   RLS do banco, não em esconder estes valores):
     - SUPABASE_URL              endereço do projeto
     - SUPABASE_PUBLISHABLE_KEY  chave "publishable" (começa com sb_publishable_)

   O que NUNCA pode ficar aqui, nem em nenhum arquivo do site:
     - chave "secret" (começa com sb_secret_) ou "service_role"
     - senha do banco de dados
     - senha de login de qualquer pessoa
   ========================================================================== */
window.RAFALU_CONFIG = Object.freeze({
  SUPABASE_URL: "https://njbxdottmxwizfsyteiv.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_6QyqaQ_fKcDc1TuOQU1DNg_dnWjhWsC",
  STORAGE_BUCKET: "product-images",
});
