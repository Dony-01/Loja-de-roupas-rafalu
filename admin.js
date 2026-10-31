/* ==========================================================================
   RAFALU — admin.js (painel administrativo)
   ==========================================================================
   Organização do arquivo:
     1. Configuração e estado
     2. Utilidades (criar elementos, avisos, mensagens de erro)
     3. Fotos: validação e compressão (tudo no navegador, antes do envio)
     4. Acesso ao Supabase (login, produtos, Storage)
     5. Telas e interações
     6. Inicialização

   Regras de segurança que este arquivo segue:
     - usa SOMENTE a chave pública (publishable); nunca a secret/service_role;
     - nada que vem do banco é inserido como HTML (sempre textContent);
     - as permissões reais ficam no banco (RLS); este painel só as respeita.
   ========================================================================== */
(() => {
  "use strict";

  /* ------------------------------------------------------------------------
     1. CONFIGURAÇÃO E ESTADO
     ------------------------------------------------------------------------ */
  const CFG = window.RAFALU_CONFIG || {};
  const BUCKET = CFG.STORAGE_BUCKET || "product-images";

  const IMG = {
    MAX_W: 1200,                 // largura máxima depois de reduzir
    MAX_H: 1600,                 // altura máxima (proporção 3:4 da vitrine)
    MIN_LONG_SIDE: 300,          // abaixo disso a foto é pequena demais
    MAX_INPUT_BYTES: 25 * 1024 * 1024, // foto original acima disso é recusada
    TARGET_BYTES: 600 * 1024,    // tamanho que buscamos (economiza tráfego)
    HARD_BYTES: 1000 * 1000,     // limite duro: o bucket aceita até 1 MiB
    QUALITIES: [0.85, 0.78, 0.7, 0.6, 0.5],
    SCALES: [1, 0.85, 0.7, 0.55],
  };

  const state = {
    sb: null,
    user: null,
    categories: [],
    products: [],
    filter: "todos",
    editing: null,     // produto em edição (null = novo)
    pending: null,     // foto nova já comprimida, ainda não enviada
    busy: false,
    loadingList: false,
  };

  const $ = (id) => document.getElementById(id);

  class UserError extends Error {} // mensagem já escrita para a pessoa usuária

  /* ------------------------------------------------------------------------
     2. UTILIDADES
     ------------------------------------------------------------------------ */
  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? "" : String(value));
    }
    for (const child of children.flat()) if (child != null) node.append(child);
    return node;
  }

  function show(node, visible) { node.hidden = !visible; }

  const VIEWS = ["Loading", "Error", "Login", "Denied", "App"];
  function showView(name) {
    for (const v of VIEWS) show($("view" + v), v === name);
  }

  function toast(message, kind = "info") {
    const box = el("div", { class: "toast" + (kind === "error" ? " error" : ""), role: kind === "error" ? "alert" : "status" });
    box.append(el("span", { text: message }));
    const close = el("button", { type: "button", "aria-label": "Fechar aviso", text: "×", onclick: () => box.remove() });
    box.append(close);
    $("toasts").append(box);
    setTimeout(() => box.remove(), kind === "error" ? 12000 : 6000);
  }

  function kb(bytes) {
    return bytes >= 1024 * 1024
      ? (bytes / 1024 / 1024).toFixed(1).replace(".", ",") + " MB"
      : Math.round(bytes / 1024) + " KB";
  }

  function formatDate(iso) {
    const d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleDateString("pt-BR");
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  function isSessionError(err) {
    const msg = String(err?.message || err || "").toLowerCase();
    return err?.code === "PGRST301" || /jwt|exp claim|refresh token|auth session missing|not authenticated/.test(msg);
  }

  // Traduz erros técnicos para mensagens que a Cris consiga entender.
  function explain(err) {
    if (err instanceof UserError) return err.message;
    const msg = String(err?.message || err || "");
    const low = msg.toLowerCase();
    const code = String(err?.code || err?.statusCode || err?.status || "");
    if (/failed to fetch|networkerror|load failed|network request failed/.test(low)) {
      return "Sem conexão com a internet, ou o serviço está indisponível. Confira a conexão e tente de novo.";
    }
    if (isSessionError(err)) return "Sua sessão expirou. Entre de novo.";
    if (code === "23514") return "Não é possível publicar um item sem foto. Edite o item e adicione uma foto.";
    if (/maximum allowed size|payload too large|too large/.test(low) || code === "413") {
      return "A foto passou de 1 MB. Tente outra foto.";
    }
    if (/mime type|invalid_mime|not supported/.test(low)) return "Formato de foto não aceito. Use JPEG ou WebP.";
    if (code === "42501" || code === "401" || code === "403" || /row-level security|unauthorized|forbidden|not allowed/.test(low)) {
      return "Esta conta não tem permissão para essa ação.";
    }
    console.error(err);
    return "Algo deu errado. Tente de novo; se continuar, avise quem cuida do site." + (msg ? ` (Detalhe técnico: ${msg})` : "");
  }

  function fail(err) {
    if (isSessionError(err)) {
      forceLogin("Sua sessão expirou. Entre de novo.");
    } else {
      toast(explain(err), "error");
    }
  }

  /* ------------------------------------------------------------------------
     3. FOTOS: VALIDAÇÃO E COMPRESSÃO
     ------------------------------------------------------------------------ */

  // Confere o conteúdo real do arquivo (não só o nome/extensão).
  async function sniffType(file) {
    const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
    const ascii = String.fromCharCode(...head);
    if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") return "image/webp";
    return null;
  }

  async function decodeImage(file) {
    // createImageBitmap aplica a rotação da câmera (EXIF) com 'from-image'.
    if (window.createImageBitmap) {
      try {
        const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
        return { source: bmp, width: bmp.width, height: bmp.height, done: () => bmp.close && bmp.close() };
      } catch (_) { /* tenta o caminho alternativo abaixo */ }
    }
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return { source: img, width: img.naturalWidth, height: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
    } catch (e) {
      URL.revokeObjectURL(url);
      throw e;
    }
  }

  const toBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

  // Valida e reduz a foto. Devolve { blob, mime, ext, width, height, originalSize }.
  async function prepareImage(file) {
    const sniffed = await sniffType(file);
    if (!sniffed) {
      throw new UserError("Formato não aceito. Use uma foto JPEG ou WebP.");
    }
    if (file.size > IMG.MAX_INPUT_BYTES) {
      throw new UserError(`Esta foto é muito grande (${kb(file.size)}). O máximo para escolher é ${kb(IMG.MAX_INPUT_BYTES)}.`);
    }

    let decoded;
    try {
      decoded = await decodeImage(file);
    } catch (_) {
      throw new UserError("Não consegui abrir esta foto. Ela pode estar corrompida; tente outra.");
    }

    try {
      const { source, width, height } = decoded;
      if (Math.max(width, height) < IMG.MIN_LONG_SIDE) {
        throw new UserError("Esta foto é muito pequena e ficaria sem qualidade na vitrine. Escolha uma maior.");
      }
      const baseScale = Math.min(1, IMG.MAX_W / width, IMG.MAX_H / height);

      let best = null;
      for (const extra of IMG.SCALES) {
        const w = Math.max(1, Math.round(width * baseScale * extra));
        const h = Math.max(1, Math.round(height * baseScale * extra));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff"; // fundo branco (evita preto em fotos com transparência)
        ctx.fillRect(0, 0, w, h);
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(source, 0, 0, w, h);

        // Prefere WebP (menor); se o navegador não gera WebP, usa JPEG.
        let mime = "image/webp";
        for (const q of IMG.QUALITIES) {
          let blob = await toBlob(canvas, mime, q);
          if (blob && blob.type !== mime) {
            mime = "image/jpeg";
            blob = await toBlob(canvas, mime, q);
          }
          if (!blob) throw new UserError("Não consegui preparar esta foto. Tente outra.");
          if (!best || blob.size < best.blob.size) {
            best = { blob, mime, width: w, height: h };
          }
          if (blob.size <= IMG.TARGET_BYTES) {
            return finish(best, file.size);
          }
        }
      }
      if (best && best.blob.size <= IMG.HARD_BYTES) return finish(best, file.size);
      throw new UserError("Não consegui reduzir esta foto para menos de 1 MB. Tente outra foto.");
    } finally {
      decoded.done();
    }
  }

  function finish(best, originalSize) {
    return { ...best, ext: best.mime === "image/webp" ? "webp" : "jpg", originalSize };
  }

  /* ------------------------------------------------------------------------
     4. ACESSO AO SUPABASE
     ------------------------------------------------------------------------ */
  function publicUrl(path) {
    return state.sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }

  async function checkIsAdmin() {
    const { data, error } = await state.sb.rpc("is_admin");
    if (error) throw error;
    return data === true;
  }

  async function loadCategories() {
    const { data, error } = await state.sb.from("categories").select("slug,label,position").order("position", { ascending: true });
    if (error) throw error;
    state.categories = data || [];
  }

  async function loadProducts() {
    const { data, error } = await state.sb
      .from("products")
      .select("id,type,name,description,category_id,image_path,is_published,published_at,created_at,updated_at")
      .order("updated_at", { ascending: false });
    if (error) throw error;
    state.products = data || [];
  }

  async function uploadImage(img) {
    const path = `${uuid()}.${img.ext}`;
    const { error } = await state.sb.storage.from(BUCKET).upload(path, img.blob, {
      contentType: img.mime,
      cacheControl: "31536000", // nome único => pode ficar em cache por 1 ano
      upsert: false,
    });
    if (error) throw error;
    return path;
  }

  // Remove arquivos. A API do Storage pode "não remover nada" sem dar erro
  // (quando as regras bloqueiam); por isso conferimos quantos saíram de fato.
  async function removeImages(paths) {
    const { data, error } = await state.sb.storage.from(BUCKET).remove(paths);
    if (error) throw error;
    return Array.isArray(data) ? data.length : 0;
  }

  // Limpeza "melhor esforço": nunca lança erro (usada para desfazer um envio).
  async function tryRemoveImage(path) {
    try { return (await removeImages([path])) > 0; } catch (_) { return false; }
  }

  // Cria um item. Se o cadastro falhar depois do envio da foto, apaga a foto enviada.
  async function createProduct(fields, img, publish) {
    let uploaded = null;
    try {
      uploaded = await uploadImage(img);
      const row = { ...fields, image_path: uploaded, is_published: publish };
      const { data, error } = await state.sb.from("products").insert(row).select("id");
      if (error) throw error;
      if (!data || data.length !== 1) throw new UserError("Esta conta não tem permissão para cadastrar itens.");
    } catch (err) {
      if (uploaded) await tryRemoveImage(uploaded);
      throw err;
    }
  }

  // Edita um item. A foto antiga só é removida DEPOIS de a alteração ser salva.
  // Retorna { oldPhotoKept: true } se a foto antiga não pôde ser removida.
  async function updateProduct(product, fields, img, publish) {
    const changes = { ...fields };
    if (publish) changes.is_published = true;

    let uploaded = null;
    try {
      if (img) {
        uploaded = await uploadImage(img);
        changes.image_path = uploaded;
      }
      const { data, error } = await state.sb.from("products").update(changes).eq("id", product.id).select("id");
      if (error) throw error;
      if (!data || data.length !== 1) throw new UserError("Não foi possível salvar: o item não existe mais ou a conta não tem permissão.");
    } catch (err) {
      if (uploaded) await tryRemoveImage(uploaded); // desfaz: a foto atual continua intacta
      throw err;
    }

    let oldPhotoKept = false;
    if (img && product.image_path && product.image_path !== uploaded) {
      oldPhotoKept = !(await tryRemoveImage(product.image_path));
    }
    return { oldPhotoKept };
  }

  async function setPublished(product, publish) {
    const { data, error } = await state.sb.from("products").update({ is_published: publish }).eq("id", product.id).select("id");
    if (error) throw error;
    if (!data || data.length !== 1) throw new UserError("Não foi possível alterar: o item não existe mais ou a conta não tem permissão.");
  }

  // Exclusão definitiva: apaga o registro e depois a foto.
  async function deleteProduct(product) {
    const { data, error } = await state.sb.from("products").delete().eq("id", product.id).select("id");
    if (error) throw error;
    if (!data || data.length !== 1) throw new UserError("Não foi possível excluir: o item não existe mais ou a conta não tem permissão.");
    let photoKept = false;
    if (product.image_path) photoKept = !(await tryRemoveImage(product.image_path));
    return { photoKept };
  }

  /* ------------------------------------------------------------------------
     5. TELAS E INTERAÇÕES
     ------------------------------------------------------------------------ */

  // ----- login / sessão -----
  function forceLogin(message) {
    resetSession();
    showView("Login");
    if (message) showLoginError(message);
  }

  function resetSession() {
    state.user = null;
    state.products = [];
    state.categories = [];
    closeDialogs();
  }

  function closeDialogs() {
    for (const id of ["formDialog", "deleteDialog"]) {
      const d = $(id);
      if (d.open) d.close();
    }
  }

  function showLoginError(text) {
    const box = $("loginError");
    box.textContent = text || "";
    show(box, !!text);
  }

  async function handleLogin(event) {
    event.preventDefault();
    const email = $("loginEmail").value.trim();
    const password = $("loginPassword").value;
    showLoginError("");
    if (!email || !password) {
      showLoginError("Preencha o e-mail e a senha.");
      return;
    }
    const btn = $("btnLogin");
    btn.disabled = true;
    btn.textContent = "Entrando…";
    try {
      const { data, error } = await state.sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      $("loginPassword").value = "";
      await enterApp(data.user);
    } catch (err) {
      const low = String(err?.message || "").toLowerCase();
      if (/invalid login credentials|invalid_credentials/.test(low)) {
        showLoginError("E-mail ou senha incorretos.");
      } else if (/rate limit|too many/.test(low) || err?.status === 429) {
        showLoginError("Muitas tentativas. Aguarde alguns minutos e tente de novo.");
      } else {
        showLoginError(explain(err));
      }
    } finally {
      btn.disabled = false;
      btn.textContent = "Entrar";
    }
  }

  async function logout() {
    try {
      await state.sb.auth.signOut();
    } catch (_) {
      try { await state.sb.auth.signOut({ scope: "local" }); } catch (__) { /* sem rede: a tela de login aparece mesmo assim */ }
    }
    forceLogin();
  }

  async function enterApp(user) {
    state.user = user;
    showView("Loading");
    let admin;
    try {
      admin = await checkIsAdmin();
    } catch (err) {
      if (isSessionError(err)) { forceLogin("Sua sessão expirou. Entre de novo."); return; }
      showErrorView(explain(err), true);
      return;
    }
    if (!admin) {
      $("deniedEmail").textContent = user?.email || "";
      showView("Denied");
      return;
    }
    $("userEmail").textContent = user?.email || "";
    showView("App");
    await refreshAll();
  }

  function showErrorView(text, withLogout) {
    $("errorText").textContent = text;
    show($("btnErrorLogout"), !!withLogout);
    showView("Error");
  }

  // ----- lista -----
  function setListMessage(text, retry) {
    const box = $("listStatus");
    box.textContent = text || "";
    if (retry) {
      box.append(" ", el("button", { type: "button", class: "btn btn-ghost btn-small", text: "Tentar de novo", onclick: retry }));
    }
  }

  async function refreshAll() {
    state.loadingList = true;
    setListMessage("Carregando…");
    try {
      await Promise.all([loadCategories(), loadProducts()]);
      setListMessage("");
      renderList();
    } catch (err) {
      if (isSessionError(err)) { forceLogin("Sua sessão expirou. Entre de novo."); return; }
      $("grid").replaceChildren();
      setListMessage("Não foi possível carregar a lista. " + explain(err), refreshAll);
    } finally {
      state.loadingList = false;
    }
  }

  function categoryLabel(slug) {
    const c = state.categories.find((x) => x.slug === slug);
    return c ? c.label : slug;
  }

  function renderList() {
    const all = state.products;
    const on = all.filter((p) => p.is_published);
    $("countTodos").textContent = all.length;
    $("countVitrine").textContent = on.length;
    $("countFora").textContent = all.length - on.length;

    for (const tab of document.querySelectorAll(".tab")) {
      tab.setAttribute("aria-pressed", String(tab.dataset.filter === state.filter));
    }

    const items = state.filter === "vitrine" ? on
      : state.filter === "fora" ? all.filter((p) => !p.is_published)
      : all;

    const grid = $("grid");
    grid.replaceChildren(...items.map(renderCard));

    if (all.length === 0) setListMessage("Nenhum item cadastrado ainda. Toque em “Novo item” para começar.");
    else if (items.length === 0) setListMessage(state.filter === "vitrine" ? "Nenhum item na vitrine no momento." : "Nenhum item fora da vitrine.");
    else setListMessage("");
  }

  function renderCard(p) {
    const media = el("div", { class: "item-media" });
    if (p.image_path) {
      const img = el("img", { src: publicUrl(p.image_path), alt: p.name, loading: "lazy", decoding: "async" });
      img.addEventListener("error", () => {
        img.remove();
        media.append(el("span", { class: "item-noimg", text: "Foto indisponível" }));
      });
      media.append(img);
    } else {
      media.append(el("span", { class: "item-noimg", text: "Sem foto" }));
    }
    media.append(el("span", { class: "pill" + (p.is_published ? " on" : ""), text: p.is_published ? "Na vitrine" : "Fora da vitrine" }));

    const typeLabel = p.type === "piece" ? "Peça individual" : "Look completo";
    const body = el("div", { class: "item-body" },
      el("h3", { class: "item-name", text: p.name }),
      el("p", { class: "item-meta", text: `${typeLabel} · ${categoryLabel(p.category_id)}` }),
      el("p", { class: "item-meta", text: `Atualizado em ${formatDate(p.updated_at)}` }),
    );

    const toggle = el("button", {
      type: "button",
      class: "btn " + (p.is_published ? "btn-ghost" : "btn-primary"),
      text: p.is_published ? "Retirar da vitrine" : "Publicar na vitrine",
      onclick: (e) => togglePublished(p, e.currentTarget),
    });
    const edit = el("button", { type: "button", class: "btn btn-ghost", text: "Editar", onclick: () => openForm(p) });

    return el("article", { class: "item" + (p.is_published ? "" : " is-out") }, media, body, el("div", { class: "item-actions" }, toggle, edit));
  }

  async function togglePublished(product, button) {
    const publish = !product.is_published;
    button.disabled = true;
    const label = button.textContent;
    button.textContent = "Aguarde…";
    try {
      await setPublished(product, publish);
      toast(publish ? "Publicado na vitrine." : "Retirado da vitrine. O item continua salvo; você pode publicar de novo quando quiser.");
      await refreshAll();
    } catch (err) {
      fail(err);
      button.disabled = false;
      button.textContent = label;
    }
  }

  // ----- formulário -----
  function setFormError(text) {
    const box = $("formError");
    box.textContent = text || "";
    show(box, !!text);
  }

  function setPhotoError(text) {
    const box = $("photoError");
    box.textContent = text || "";
    show(box, !!text);
  }

  function clearPending() {
    if (state.pending) URL.revokeObjectURL(state.pending.url);
    state.pending = null;
  }

  function showPhotoPreview(url) {
    const img = $("photoImg");
    if (url) {
      img.src = url;
      show(img, true);
      show($("photoEmpty"), false);
    } else {
      img.removeAttribute("src");
      show(img, false);
      show($("photoEmpty"), true);
    }
  }

  function setBusy(on, activeButton, busyText) {
    state.busy = on;
    const form = $("formDialog");
    for (const node of form.querySelectorAll("input, textarea, select, button")) {
      if (on) { node.dataset.wasDisabled = node.disabled ? "1" : ""; node.disabled = true; }
      else { node.disabled = node.dataset.wasDisabled === "1"; delete node.dataset.wasDisabled; }
    }
    if (activeButton) {
      if (on) { activeButton.dataset.label = activeButton.textContent; activeButton.textContent = busyText; }
      else if (activeButton.dataset.label) { activeButton.textContent = activeButton.dataset.label; delete activeButton.dataset.label; }
    }
  }

  function openForm(product) {
    state.editing = product || null;
    clearPending();
    setFormError("");
    setPhotoError("");
    $("itemForm").reset();
    $("fPhoto").value = "";
    $("photoHint").textContent = "Formatos aceitos: JPEG ou WebP. A foto é reduzida automaticamente antes do envio.";

    const select = $("fCategory");
    select.replaceChildren(
      el("option", { value: "", text: "Escolha uma categoria", disabled: true }),
      ...state.categories.map((c) => el("option", { value: c.slug, text: c.label })),
    );

    const draftBtn = $("btnSaveDraft");
    const mainBtn = $("btnSave");

    if (product) {
      $("formTitle").textContent = "Editar item";
      $("fName").value = product.name;
      $("fDescription").value = product.description || "";
      select.value = product.category_id;
      document.querySelector(`input[name="type"][value="${product.type === "piece" ? "piece" : "look"}"]`).checked = true;
      showPhotoPreview(product.image_path ? publicUrl(product.image_path) : null);
      $("photoHint").textContent = "Para trocar a foto, escolha uma nova. Deixe em branco para manter a atual. A troca só vale depois de salvar.";
      show($("btnDelete"), true);
      if (product.is_published) {
        show(draftBtn, false);
        mainBtn.textContent = "Salvar alterações";
        mainBtn.dataset.mode = "keep";
      } else {
        show(draftBtn, true);
        draftBtn.textContent = "Salvar alterações";
        draftBtn.dataset.mode = "keep";
        mainBtn.textContent = "Salvar e publicar";
        mainBtn.dataset.mode = "publish";
      }
    } else {
      $("formTitle").textContent = "Novo item";
      select.value = "";
      showPhotoPreview(null);
      show($("btnDelete"), false);
      show(draftBtn, true);
      draftBtn.textContent = "Salvar sem publicar";
      draftBtn.dataset.mode = "keep";
      mainBtn.textContent = "Publicar na vitrine";
      mainBtn.dataset.mode = "publish";
    }
    $("descCount").textContent = $("fDescription").value.length;
    $("formDialog").showModal();
    $("fName").focus();
  }

  function closeForm() {
    clearPending();
    const d = $("formDialog");
    if (d.open) d.close();
  }

  async function handlePhotoChosen(event) {
    const input = event.target;
    const file = input.files && input.files[0];
    setPhotoError("");
    if (!file) return;

    // Enquanto a foto é preparada, os botões de salvar ficam bloqueados.
    $("btnSave").disabled = true;
    $("btnSaveDraft").disabled = true;
    $("photoHint").textContent = "Preparando a foto…";
    try {
      const result = await prepareImage(file);
      clearPending();
      result.url = URL.createObjectURL(result.blob);
      state.pending = result;
      showPhotoPreview(result.url);
      $("photoHint").textContent = `Foto pronta: ${kb(result.originalSize)} → ${kb(result.blob.size)} (${result.width}×${result.height}).`;
    } catch (err) {
      input.value = "";
      setPhotoError(explain(err));
      const current = state.editing && state.editing.image_path ? publicUrl(state.editing.image_path) : null;
      showPhotoPreview(state.pending ? state.pending.url : current);
      $("photoHint").textContent = state.pending
        ? "Foto anterior mantida."
        : "Formatos aceitos: JPEG ou WebP. A foto é reduzida automaticamente antes do envio.";
    } finally {
      $("btnSave").disabled = false;
      $("btnSaveDraft").disabled = false;
    }
  }

  function readForm() {
    const type = document.querySelector('input[name="type"]:checked').value;
    const name = $("fName").value.trim();
    const description = $("fDescription").value.trim();
    const category = $("fCategory").value;
    return { type, name, description: description || null, category_id: category };
  }

  async function handleSave(event) {
    const button = event.currentTarget;
    const wantsPublish = button.dataset.mode === "publish";
    const editing = state.editing;
    const fields = readForm();
    setFormError("");

    if (!fields.name) { setFormError("Digite o nome do item."); $("fName").focus(); return; }
    if (!fields.category_id) { setFormError("Escolha uma categoria."); $("fCategory").focus(); return; }
    const hasPhoto = !!state.pending || !!(editing && editing.image_path);
    if (!hasPhoto) { setFormError("Escolha uma foto para o item."); return; }

    setBusy(true, button, "Salvando…");
    try {
      let message;
      if (editing) {
        const { oldPhotoKept } = await updateProduct(editing, fields, state.pending, wantsPublish);
        message = wantsPublish ? "Alterações salvas e item publicado na vitrine." : "Alterações salvas.";
        if (oldPhotoKept) message += " A foto antiga não pôde ser removida do armazenamento (não afeta a vitrine).";
      } else {
        await createProduct(fields, state.pending, wantsPublish);
        message = wantsPublish ? "Item cadastrado e publicado na vitrine." : "Item cadastrado. Ele ainda não aparece na vitrine.";
      }
      setBusy(false, button);
      closeForm();
      toast(message);
      await refreshAll();
    } catch (err) {
      setBusy(false, button);
      if (isSessionError(err)) { forceLogin("Sua sessão expirou. Entre de novo."); return; }
      setFormError(explain(err));
    }
  }

  // ----- exclusão definitiva -----
  function askDelete() {
    const product = state.editing;
    if (!product) return;
    $("deleteText").textContent =
      `Isto apaga o cadastro de “${product.name}” e a foto dele. Não é possível desfazer.`;
    $("deleteDialog").showModal();
  }

  async function confirmDelete() {
    const product = state.editing;
    const btn = $("btnDeleteConfirm");
    btn.disabled = true;
    $("btnDeleteCancel").disabled = true;
    btn.textContent = "Excluindo…";
    try {
      const { photoKept } = await deleteProduct(product);
      $("deleteDialog").close();
      closeForm();
      toast(photoKept
        ? "Item excluído. A foto não pôde ser removida do armazenamento."
        : "Item e foto excluídos definitivamente.");
      await refreshAll();
    } catch (err) {
      $("deleteDialog").close();
      fail(err);
    } finally {
      btn.disabled = false;
      $("btnDeleteCancel").disabled = false;
      btn.textContent = "Excluir definitivamente";
    }
  }

  /* ------------------------------------------------------------------------
     6. INICIALIZAÇÃO
     ------------------------------------------------------------------------ */
  function wire() {
    $("loginForm").addEventListener("submit", handleLogin);
    $("btnLogout").addEventListener("click", logout);
    $("btnDeniedLogout").addEventListener("click", logout);
    $("btnErrorLogout").addEventListener("click", logout);
    $("btnRetry").addEventListener("click", () => {
      if (state.user) enterApp(state.user);
      else location.reload();
    });

    $("btnNew").addEventListener("click", () => openForm(null));
    $("tabs").addEventListener("click", (e) => {
      const tab = e.target.closest(".tab");
      if (!tab) return;
      state.filter = tab.dataset.filter;
      renderList();
    });

    $("fPhoto").addEventListener("change", handlePhotoChosen);
    $("fDescription").addEventListener("input", () => { $("descCount").textContent = $("fDescription").value.length; });
    $("itemForm").addEventListener("submit", (e) => e.preventDefault()); // Enter não envia nada sozinho
    $("btnSave").addEventListener("click", handleSave);
    $("btnSaveDraft").addEventListener("click", handleSave);
    $("btnCancel").addEventListener("click", closeForm);
    $("btnFormClose").addEventListener("click", closeForm);
    $("btnDelete").addEventListener("click", askDelete);
    $("btnDeleteCancel").addEventListener("click", () => $("deleteDialog").close());
    $("btnDeleteConfirm").addEventListener("click", confirmDelete);

    // Enquanto salva, a tecla Esc não pode fechar o formulário.
    $("formDialog").addEventListener("cancel", (e) => { if (state.busy) e.preventDefault(); else clearPending(); });
    $("deleteDialog").addEventListener("cancel", (e) => { if ($("btnDeleteConfirm").disabled) e.preventDefault(); });
  }

  async function init() {
    wire();

    if (!window.supabase || !window.supabase.createClient) {
      showErrorView("Não foi possível carregar a biblioteca do painel. Confira a conexão com a internet e recarregue a página.", false);
      return;
    }
    if (!CFG.SUPABASE_URL || !CFG.SUPABASE_PUBLISHABLE_KEY) {
      showErrorView("A configuração do Supabase (supabase-config.js) está incompleta.", false);
      return;
    }
    // Trava de segurança: uma chave privilegiada (secret ou service_role) jamais
    // deve ser usada no navegador. Se alguém colar uma por engano, o painel recusa.
    const key = CFG.SUPABASE_PUBLISHABLE_KEY;
    const parts = key.split(".");
    const isSecretKey = /^sb_secret_/.test(key);
    const isServiceRoleJwt = parts.length === 3 && /"role"\s*:\s*"service_role"/.test(atobSafe(parts[1]));
    if (isSecretKey || isServiceRoleJwt) {
      showErrorView("A chave configurada é uma chave PRIVADA e não pode ser usada no site. Troque pela chave publishable em supabase-config.js.", false);
      return;
    }

    state.sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });

    state.sb.auth.onAuthStateChange((event) => {
      // Não chamar o Supabase aqui dentro (evita travar a biblioteca); só reagir à saída.
      if (event === "SIGNED_OUT") setTimeout(() => { if (state.user) forceLogin(); }, 0);
    });

    try {
      const { data, error } = await state.sb.auth.getSession();
      if (error) throw error;
      if (data.session) await enterApp(data.session.user);
      else showView("Login");
    } catch (err) {
      showErrorView(explain(err), false);
    }
  }

  function atobSafe(part) {
    try { return atob(part.replace(/-/g, "+").replace(/_/g, "/")); } catch (_) { return ""; }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
