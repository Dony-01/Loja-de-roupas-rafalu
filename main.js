/* ==========================================================================
   RAFALU — main.js
   ==========================================================================
   Este arquivo concentra toda a configuração e os dados do site.
   As seções estão organizadas assim:

   1. CONFIGURAÇÃO GERAL (WhatsApp / Instagram)
   2. ACESSO AOS DADOS (Supabase: categorias e looks publicados)
   3. RENDERIZAÇÃO DA INTERFACE
   4. INTERAÇÕES (filtros, estados da vitrine, menu mobile, WhatsApp)
   ========================================================================== */


/* --------------------------------------------------------------------------
   1. CONFIGURAÇÃO GERAL
   -------------------------------------------------------------------------- */

// Altere aqui o número de WhatsApp da loja.
// Formato: código do país + DDD + número, apenas dígitos (sem espaços, "+", "-").
// Exemplo: 55 (Brasil) + 41 (DDD) + 999999999
const WHATSAPP_NUMBER = "5541999919591"; // TODO: substituir pelo número real da RAFALU

// Altere aqui o link do Instagram da loja.
const INSTAGRAM_URL = "https://www.instagram.com/rafalustore?utm_source=ig_web_button_share_sheet&stkn=ZDNlZDc0MzIxNw=="; // TODO: substituir pelo perfil real

// Mensagem padrão enviada quando o clique não vem de um look específico
// (ex.: botão "Fale conosco" ou seção final de contato).
const WHATSAPP_DEFAULT_MESSAGE = "Olá! Vi o site da RAFALU e gostaria de mais informações.";


/* --------------------------------------------------------------------------
   2. ACESSO AOS DADOS (Supabase)
   --------------------------------------------------------------------------
   Os looks e as categorias vêm do banco. A vitrine SÓ LÊ dados, usando a chave
   pública (publishable) definida em supabase-config.js. Essa chave é segura no
   navegador porque as regras do banco (RLS) permitem a visitantes ler apenas
   itens publicados. NUNCA coloque aqui a chave "secret" ou "service_role".

   Usamos fetch() direto na API REST (sem biblioteca extra) para a página ficar
   leve. As duas funções abaixo continuam devolvendo o MESMO formato de antes,
   por isso filtros, cards e botões não precisaram mudar.
   -------------------------------------------------------------------------- */

const REQUEST_TIMEOUT_MS = 10000; // depois disso a vitrine mostra a mensagem de erro
const MAX_LOOKS = 100;            // limite de segurança da consulta

class DataError extends Error {}

function supabaseSettings() {
  const cfg = window.RAFALU_CONFIG || {};
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_PUBLISHABLE_KEY) {
    throw new DataError("Configuração do Supabase ausente (supabase-config.js).");
  }
  return {
    url: String(cfg.SUPABASE_URL).replace(/\/+$/, ""),
    key: cfg.SUPABASE_PUBLISHABLE_KEY,
    bucket: cfg.STORAGE_BUCKET || "product-images",
  };
}

async function fetchRows(pathAndQuery) {
  const { url, key } = supabaseSettings();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    // Só o cabeçalho "apikey": visitante anônimo, sem token de login.
    const res = await fetch(`${url}/rest/v1/${pathAndQuery}`, {
      headers: { apikey: key, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) throw new DataError(`Resposta ${res.status} do servidor.`);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new DataError("Resposta inesperada do servidor.");
    return rows;
  } finally {
    clearTimeout(timer);
  }
}

function photoUrl(imagePath) {
  const { url, bucket } = supabaseSettings();
  return `${url}/storage/v1/object/public/${bucket}/${encodeURIComponent(imagePath)}`;
}

const isText = (v) => typeof v === "string" && v.trim() !== "";

// Looks publicados, do mais recente para o mais antigo.
// Campos do banco -> campos da vitrine: category_id -> category, image_path -> image.
async function getLooks() {
  const rows = await fetchRows(
    "products?select=id,name,description,category_id,image_path" +
      "&is_published=eq.true" +
      "&order=published_at.desc.nullslast,created_at.desc" +
      `&limit=${MAX_LOOKS}`
  );
  return rows
    .filter((r) => isText(r.name) && isText(r.category_id) && isText(r.image_path))
    .map((r) => ({
      id: r.id,
      name: r.name.trim(),
      category: r.category_id,
      description: isText(r.description) ? r.description.trim() : "",
      image: photoUrl(r.image_path),
    }));
}

// "Todos" é criado aqui; as demais categorias vêm do banco, na ordem definida em "position".
async function getCategories() {
  const rows = await fetchRows("categories?select=slug,label,position&order=position.asc");
  return [
    { id: "todos", label: "Todos" },
    ...rows.filter((r) => isText(r.slug) && isText(r.label)).map((r) => ({ id: r.slug, label: r.label })),
  ];
}


/* --------------------------------------------------------------------------
   3. RENDERIZAÇÃO DA INTERFACE
   -------------------------------------------------------------------------- */

function buildWhatsappUrl(message) {
  const text = encodeURIComponent(message || WHATSAPP_DEFAULT_MESSAGE);
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${text}`;
}

function categoryLabel(categories, id) {
  const found = categories.find((c) => c.id === id);
  return found ? found.label : id;
}

function renderFilters(categories, activeId, onSelect) {
  const container = document.getElementById("filters");
  container.replaceChildren();

  categories.forEach((cat) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "filter-btn";
    btn.textContent = cat.label;
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-pressed", String(cat.id === activeId));
    btn.addEventListener("click", () => onSelect(cat.id));
    container.appendChild(btn);
  });
}

// Os textos vêm do banco: por isso os cards são montados com createElement e
// textContent (nunca innerHTML), para que nenhum texto vire código na página.
function renderLooks(looks, categories) {
  const grid = document.getElementById("looksGrid");
  const emptyState = document.getElementById("looksEmpty");
  grid.replaceChildren();
  grid.removeAttribute("aria-busy");

  if (looks.length === 0) {
    emptyState.hidden = false;
    return;
  }
  emptyState.hidden = true;

  looks.forEach((look) => {
    const card = document.createElement("article");
    card.className = "look-card" + (look.description ? "" : " no-desc");

    const media = document.createElement("div");
    media.className = "look-media";

    const badge = document.createElement("span");
    badge.className = "look-category";
    badge.textContent = categoryLabel(categories, look.category);

    const img = document.createElement("img");
    img.src = look.image;
    img.alt = look.name;
    img.loading = "lazy";
    img.decoding = "async";
    img.addEventListener("error", () => {
      const fallback = document.createElement("span");
      fallback.className = "look-photo-missing";
      fallback.textContent = "Foto indisponível";
      img.replaceWith(fallback);
    });
    media.append(badge, img);

    const name = document.createElement("h3");
    name.className = "look-name";
    name.textContent = look.name;

    const cta = document.createElement("a");
    cta.className = "btn btn-primary look-cta";
    cta.target = "_blank";
    cta.rel = "noopener";
    cta.href = buildWhatsappUrl(`Olá! Tenho interesse no ${look.name}. Pode me passar mais informações?`);
    cta.textContent = "Tenho interesse";

    card.append(media, name);
    if (look.description) {
      const desc = document.createElement("p");
      desc.className = "look-description";
      desc.textContent = look.description;
      card.append(desc);
    }
    card.append(cta);
    grid.appendChild(card);
  });
}

// Blocos cinza com o mesmo formato dos cards, enquanto os dados carregam.
function renderSkeleton() {
  const grid = document.getElementById("looksGrid");
  grid.replaceChildren();
  grid.setAttribute("aria-busy", "true");
  for (let i = 0; i < 6; i++) {
    const box = document.createElement("div");
    box.className = "look-skeleton";
    box.setAttribute("aria-hidden", "true");
    grid.appendChild(box);
  }
}

// Mensagem no lugar da lista: vitrine vazia ou falha de conexão.
// kind: "empty" | "error". Nunca mostra looks de exemplo.
function showLooksState(kind, onRetry) {
  const box = document.getElementById("looksState");
  const text = document.getElementById("looksStateText");
  const retry = document.getElementById("looksRetry");
  document.getElementById("looksGrid").replaceChildren();
  document.getElementById("looksGrid").removeAttribute("aria-busy");
  document.getElementById("filters").replaceChildren();
  document.getElementById("looksEmpty").hidden = true;

  if (kind === "empty") {
    text.textContent = "Estamos preparando novos looks. Fale conosco pelo WhatsApp para saber as novidades.";
    retry.hidden = true;
  } else {
    text.textContent = "Não foi possível carregar os looks agora. Confira sua conexão e tente de novo, ou fale conosco pelo WhatsApp.";
    retry.hidden = false;
    retry.onclick = onRetry;
  }
  document.getElementById("looksStateWhatsapp").href = buildWhatsappUrl(WHATSAPP_DEFAULT_MESSAGE);
  box.hidden = false;
}

function hideLooksState() {
  document.getElementById("looksState").hidden = true;
}


/* --------------------------------------------------------------------------
   4. INTERAÇÕES
   -------------------------------------------------------------------------- */

async function initLooksSection() {
  hideLooksState();
  renderSkeleton();

  let looks, categories;
  try {
    [looks, categories] = await Promise.all([getLooks(), getCategories()]);
  } catch (err) {
    console.error("Falha ao carregar a vitrine:", err);
    showLooksState("error", initLooksSection);
    return;
  }

  if (looks.length === 0) {
    showLooksState("empty");
    return;
  }

  // Só aparecem os botões de categorias que têm pelo menos um look publicado.
  const used = new Set(looks.map((l) => l.category));
  const visibleCategories = categories.filter((c) => c.id === "todos" || used.has(c.id));

  let activeCategory = "todos";

  function applyFilter(categoryId) {
    activeCategory = categoryId;
    const filtered =
      categoryId === "todos" ? looks : looks.filter((l) => l.category === categoryId);

    renderFilters(visibleCategories, activeCategory, applyFilter);
    renderLooks(filtered, categories);
  }

  applyFilter(activeCategory);
}

function initMobileMenu() {
  const toggle = document.getElementById("menuToggle");
  const nav = document.getElementById("menuPrincipal");

  toggle.addEventListener("click", () => {
    const isOpen = nav.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", String(isOpen));
  });

  nav.querySelectorAll(".nav-link").forEach((link) => {
    link.addEventListener("click", () => {
      nav.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
    });
  });
}

function initStaticLinks() {
  document.getElementById("instagramLink").href = INSTAGRAM_URL;
  document.getElementById("footerInstagram").href = INSTAGRAM_URL;

  const whatsappUrl = buildWhatsappUrl(WHATSAPP_DEFAULT_MESSAGE);
  document.getElementById("whatsappLink").href = whatsappUrl;
  document.getElementById("footerWhatsapp").href = whatsappUrl;
}

function initFooterYear() {
  document.getElementById("anoAtual").textContent = new Date().getFullYear();
}

document.addEventListener("DOMContentLoaded", () => {
  initMobileMenu();
  initStaticLinks();
  initFooterYear();
  initLooksSection();
});
