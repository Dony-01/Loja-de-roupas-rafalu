# RAFALU — Vitrine Digital (V1)

Site estático (HTML + CSS + JavaScript puro) para apresentar os looks da RAFALU e direcionar o cliente para o WhatsApp. Sem backend, sem banco de dados — pronto para publicar no GitHub Pages.

## Estrutura de arquivos

```
/
├── index.html
├── style.css
├── main.js
├── assets/
│   ├── logo.png
│   └── looks/
│       ├── look-1.jpg ... look-6.jpg
└── README.md
```

## Como alterar os looks

Todos os looks ficam no arquivo `main.js`, no array `LOOKS`. Cada item segue este formato:

```js
{
  id: 7,
  name: "Look Novo",
  category: "casual",       // precisa ser um id existente em CATEGORIES
  description: "Descrição curta do look.",
  image: "assets/looks/minha-foto.jpg",
}
```

Para adicionar um look: copie um dos objetos existentes, ajuste os campos e adicione uma imagem correspondente em `assets/looks/`.

Para remover um look: apague o objeto correspondente do array.

**Categorias:** ficam no array `CATEGORIES`, logo acima de `LOOKS`. Para renomear, editar ou criar uma categoria, basta alterar `id` (usado internamente) e `label` (texto exibido no filtro).

## Onde alterar o número do WhatsApp

No topo do arquivo `main.js`:

```js
const WHATSAPP_NUMBER = "5541999999999";
```

Use o formato: código do país + DDD + número, só dígitos (sem `+`, espaços ou traços).

A mensagem padrão enviada quando o cliente clica em "Fale conosco" também pode ser ajustada logo abaixo, em `WHATSAPP_DEFAULT_MESSAGE`.

## Onde alterar o Instagram

Também no topo do `main.js`:

```js
const INSTAGRAM_URL = "https://instagram.com/rafalu";
```

## Como substituir a logo

1. Substitua o arquivo `assets/logo.png` pela logo oficial da RAFALU (mesmo nome de arquivo, ou ajuste as referências em `index.html`).
2. A logo usada nesta V1 é um **placeholder** (monograma simples em fundo escuro) — deve ser trocada pela arte oficial fornecida pela loja assim que possível.
3. Recomenda-se um arquivo quadrado (ex.: 480x480px), fundo escuro, símbolo em branco, para manter o contraste no header e no rodapé.

## Como adicionar novas imagens de looks

1. Coloque a imagem dentro de `assets/looks/` (formato JPG ou PNG, recomenda-se proporção 3:4, ex.: 900x1200px).
2. No `main.js`, aponte o campo `image` do look correspondente para o caminho do novo arquivo.

As imagens atuais em `assets/looks/` são **placeholders gerados automaticamente** (blocos com o texto "IMAGEM PLACEHOLDER") — substitua por fotos reais dos looks assim que disponíveis.

## Como migrar futuramente de LOOKS locais para uma API REST

O arquivo `main.js` já separa os dados (`LOOKS`, `CATEGORIES`) das funções que os disponibilizam para a interface (`getLooks()`, `getCategories()`). O restante do código (renderização, filtros, cliques) sempre consome essas funções — nunca os arrays diretamente. Isso significa que, no futuro, a migração é só trocar o corpo das funções:

```js
// Hoje
async function getLooks() {
  return Promise.resolve(LOOKS);
}

// Futuro, com API REST
async function getLooks() {
  const res = await fetch("/api/looks");
  return res.json();
}
```

Nenhuma outra parte do frontend (HTML, CSS, filtros, botões "Tenho interesse") precisa ser alterada nessa transição. O caminho de evolução planejado é:

```
LOOKS no JavaScript → fetch() → API REST → banco de dados
```

E, depois disso, a próxima etapa prevista é uma área `/admin` com login, para gerenciar (adicionar, editar, excluir, publicar/despublicar) looks e categorias diretamente pela interface, sem editar o código.

## Publicando no GitHub Pages

1. Suba os arquivos deste projeto para um repositório no GitHub.
2. Vá em **Settings → Pages**.
3. Em "Source", selecione a branch principal (ex.: `main`) e a pasta raiz (`/`).
4. Salve — o GitHub Pages vai gerar uma URL pública para o site em alguns minutos.

## O que NÃO foi implementado nesta V1 (por decisão de escopo)

- Pagamento online / carrinho de compras
- Backend, banco de dados ou autenticação
- Painel administrativo (`/admin`)
- Integração direta com a API do Instagram
- Preços, tamanhos ou disponibilidade das peças (tudo isso é tratado via WhatsApp)
