/* ==========================================================================
   RAFALU — main.js
   ==========================================================================
   Este arquivo concentra toda a configuração e os dados do site.
   As seções estão organizadas assim:

   1. CONFIGURAÇÃO GERAL (WhatsApp / Instagram)
   2. CATEGORIAS
   3. DADOS DOS LOOKS
   4. FUNÇÕES DE ACESSO AOS DADOS (pensadas para futura migração para API)
   5. RENDERIZAÇÃO DA INTERFACE
   6. INTERAÇÕES (filtros, menu mobile, WhatsApp)
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
   2. CATEGORIAS
   -------------------------------------------------------------------------- */
// Os nomes das categorias podem ser alterados livremente aqui.
// "id" é usado internamente para filtrar; "label" é o texto exibido.
const CATEGORIES = [
  { id: "todos", label: "Todos" },
  { id: "casual", label: "Casual" },
  { id: "social", label: "Social" },
  { id: "elegante", label: "Elegante" },
  { id: "completo", label: "Looks completos" },
];


/* --------------------------------------------------------------------------
   3. DADOS DOS LOOKS
   -------------------------------------------------------------------------- */
// IMPORTANTE: nenhuma informação de preço, tamanho ou disponibilidade é
// cadastrada aqui de propósito — essas informações devem ser tratadas
// diretamente pelo WhatsApp. As imagens abaixo são placeholders (assets/looks)
// e devem ser substituídas por fotos reais dos looks.
const LOOKS = [
  {
    id: 1,
    name: "Look Elegance",
    category: "elegante",
    description: "Uma combinação elegante para diferentes ocasiões.",
    image: "look-1.jpg",
  },
  {
    id: 2,
    name: "Look Essencial",
    category: "casual",
    description: "Peças simples e versáteis para o dia a dia.",
    image: "look-2.jpg",
  },
  {
    id: 3,
    name: "Look Noite",
    category: "social",
    description: "Combinação pensada para eventos e encontros especiais.",
    image: "look-3.jpg",
  },
  {
    id: 4,
    name: "Look Leveza",
    category: "casual",
    description: "Conforto e estilo em uma composição descontraída.",
    image: "look-4.jpg",
  },
  {
    id: 5,
    name: "Look Presença",
    category: "completo",
    description: "Um conjunto completo para quem quer causar impacto.",
    image: "look-5.jpg",
  },
  {
    id: 6,
    name: "Look Refinado",
    category: "social",
    description: "Sofisticação discreta para compromissos importantes.",
    image: "look-6.jpg",
  },
];


/* --------------------------------------------------------------------------
   4. FUNÇÕES DE ACESSO AOS DADOS
   --------------------------------------------------------------------------
   Hoje estas funções apenas leem o array local LOOKS/CATEGORIES.
   No futuro, quando existir uma API REST, basta trocar o corpo destas
   funções por chamadas fetch() — o restante do código (renderização,
   filtros, etc.) não precisa mudar, pois ele sempre consome estas funções
   e não o array diretamente.

   Exemplo de evolução futura:

     async function getLooks() {
       const res = await fetch("/api/looks");
       return res.json();
     }

   -------------------------------------------------------------------------- */

async function getLooks() {
  // Hoje: retorna os dados locais.
  // Futuro: return fetch("/api/looks").then(r => r.json());
  return Promise.resolve(LOOKS);
}

async function getCategories() {
  // Hoje: retorna os dados locais.
  // Futuro: return fetch("/api/categories").then(r => r.json());
  return Promise.resolve(CATEGORIES);
}


/* --------------------------------------------------------------------------
   5. RENDERIZAÇÃO DA INTERFACE
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
  container.innerHTML = "";

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

function renderLooks(looks, categories) {
  const grid = document.getElementById("looksGrid");
  const emptyState = document.getElementById("looksEmpty");
  grid.innerHTML = "";

  if (looks.length === 0) {
    emptyState.hidden = false;
    return;
  }
  emptyState.hidden = true;

  looks.forEach((look) => {
    const card = document.createElement("article");
    card.className = "look-card";

    const message = `Olá! Tenho interesse no ${look.name}. Pode me passar mais informações?`;

    card.innerHTML = `
      <div class="look-media">
        <span class="look-category">${categoryLabel(categories, look.category)}</span>
        <img src="${look.image}" alt="${look.name}" loading="lazy" />
      </div>
      <h3 class="look-name">${look.name}</h3>
      <p class="look-description">${look.description}</p>
      <a class="btn btn-primary look-cta" target="_blank" rel="noopener" href="${buildWhatsappUrl(message)}">
        Tenho interesse
      </a>
    `;

    grid.appendChild(card);
  });
}


/* --------------------------------------------------------------------------
   6. INTERAÇÕES
   -------------------------------------------------------------------------- */

async function initLooksSection() {
  const [looks, categories] = await Promise.all([getLooks(), getCategories()]);

  let activeCategory = "todos";

  function applyFilter(categoryId) {
    activeCategory = categoryId;
    const filtered =
      categoryId === "todos" ? looks : looks.filter((l) => l.category === categoryId);

    renderFilters(categories, activeCategory, applyFilter);
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
