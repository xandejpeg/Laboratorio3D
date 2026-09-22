# Contrato `lab3d.character-import` v1

Este documento existe para que o gerador 2D possa enviar personagens ao
Laboratorio3D sem depender de acesso a este repositório. Ele descreve apenas o
que o laboratório realmente implementa hoje.

Identificador: `lab3d.character-import`
Versão: `1`
Implementado em: [lab3d/contract/types.ts](../contract/types.ts), [lab3d/contract/adapt.ts](../contract/adapt.ts)

---

## 1. Transporte

Uma única requisição `multipart/form-data`:

```
POST http://127.0.0.1:8770/api/lab/import
```

| Campo            | Tipo     | Obrigatório | Descrição |
|------------------|----------|-------------|-----------|
| `sheet`          | arquivo  | sim         | O JSON do personagem (uma das três formas aceitas abaixo). Máx. 2 MB. |
| `front`          | arquivo  | sim         | PNG/JPEG/WebP da vista frontal. Máx. 24 MB. |
| `profile-left`   | arquivo  | não         | Referência rotulada adicional. |
| `profile-right`  | arquivo  | não         | Referência rotulada adicional. |
| `back`           | arquivo  | não         | Referência rotulada adicional. |
| `three-quarter`  | arquivo  | não         | Referência rotulada adicional. |
| `detail`         | arquivo  | não         | Referência rotulada adicional. |
| `note:<ângulo>`  | texto    | não         | Observação livre sobre aquela referência. |
| `name`           | texto    | não         | Nome de exibição, se o JSON não trouxer um. |

**O nome do campo do arquivo É o rótulo do ângulo.** Ângulos aceitos:
`front`, `profile-left`, `profile-right`, `back`, `three-quarter`, `detail`.
Qualquer outro nome é recusado com a lista dos válidos.

### O que cada referência realmente faz

- `front` é a única com `influence: "pipeline"`. Ela é copiada para o diretório
  da execução e entregue ao gerador.
- Todas as demais recebem `influence: "stored"`. Elas são guardadas, digeridas e
  exibidas, **mas não chegam ao pipeline**: a CLI upstream aceita um único
  `--image` ([web/server/jobs.ts](../../web/server/jobs.ts)).

Elas não são inúteis: entram no cálculo da identidade do personagem e reduzem a
lista de "regiões sem referência visual" mostrada na interface. Quando o
pipeline passar a aceitar múltiplas vistas, o campo `influence` muda para
`"pipeline"` e o contrato continua o mesmo.

---

## 2. Formas de JSON aceitas

O adaptador detecta a forma sozinho ([`detectShape`](../contract/adapt.ts)).

### A. Pacote nativo (recomendado para o gerador 2D)

```json
{
  "contract": "lab3d.character-import",
  "contractVersion": 1,
  "name": "Serena — macacão cinza",
  "source": {
    "generator": "2dc",
    "generatorVersion": "2dc-r3",
    "wardrobeVersion": 1,
    "viewRevision": "r17.3-turnaround-v1",
    "exportedAt": "2026-09-22T10:00:00.000Z"
  },
  "recipe": { "...": "saída de canonicalRecipe()" },
  "characteristics": [ { "title": "Identidade e corpo", "rows": [ { "key": "body", "label": "Corpo", "value": "Equilibrada", "id": "female-body-3" } ] } ],
  "physicalHeightCm": 168,
  "front": { "width": 900, "height": 1280 },
  "readyFor3D": false,
  "missing": ["Vistas ortográficas validadas"]
}
```

### B. `2dc-ficha-<family>.json`

O export atual de `exportData()` é aceito sem alteração. `additionalViews` é
lido apenas para extrair `revision`; as imagens embutidas nele não substituem os
arquivos enviados no multipart.

### C. `2dc-receita.json`

O download de receita também é aceito. Como ele não carrega ficha nem altura,
o pacote resultante fica com `characteristics: []` e `physicalHeightCm: null`.
**O laboratório não inventa esses valores** — eles aparecem como ausentes na
interface.

---

## 3. Regras de validação

Erros voltam como `422` com a lista completa de problemas, não apenas o
primeiro:

```json
{ "error": "import rejected", "details": ["recipe.hair must be a non-empty string (send canonicalRecipe())"] }
```

| Regra | Comportamento |
|-------|---------------|
| `recipe.family` ∈ {`female`, `male`} | obrigatório |
| Categorias `outfit, body, face, hair, eyes, nose, mouth, brows, ears, skin, marks, upper, lower` | strings não vazias |
| Cores `eyeColor, hairColor, naikeColor, suitColor` | strings não vazias |
| Chaves desconhecidas na receita | **preservadas**, nunca descartadas |
| IDs fora do vocabulário do laboratório | aceitos e **reportados** como desconhecidos; nunca adivinhados |
| `physicalHeightCm` | número em 50–260, ou `null`/ausente. Fora disso é recusado, não ajustado |
| `contractVersion` ≠ 1 (forma A) | recusado |
| Tamanho do PNG frontal ≠ `front.width`×`front.height` | recusado: a imagem e a ficha não pertencem ao mesmo personagem |
| Ângulo duplicado | recusado |

Envie sempre `canonicalRecipe()`, não a receita bruta da interface: o
laboratório valida a forma canônica.

---

## 4. Identidade e imutabilidade

A chave do personagem é um SHA-256 sobre um JSON canônico (chaves ordenadas)
contendo: identificador e versão do contrato, gerador e versão do gerador, a
receita completa, os digests SHA-256 de **todas** as referências e a altura
declarada ([lab3d/contract/identity.ts](../contract/identity.ts)).

Consequências, todas verificadas em teste:

- Reenviar exatamente a mesma combinação devolve `200` com `reused: true` e o
  registro original intacto — inclusive o `importedAt`.
- Trocar qualquer item da receita, qualquer pixel da imagem frontal, ou anexar
  uma referência adicional produz **outra** chave e outro registro.
- Uma chave já ocupada por conteúdo diferente é recusada com `409`; um
  personagem nunca exibe o resultado de outro.

O registro é gravado em `outputs/lab3d/characters/<key>/`:
`record.json`, `bundle.json`, `source.json` (o payload cru recebido), as imagens
e `runs.jsonl` (somente-anexar). `outputs/` está no `.gitignore`, então nada
disso entra no Git.

---

## 5. Respostas

`201` na primeira importação, `200` quando reaproveitada:

```json
{
  "record": { "key": "...", "shortKey": "...", "importedAt": "...", "bundle": { "...": "..." }, "contentDigest": "..." },
  "reused": false,
  "brief": {
    "text": "o texto que o pipeline recebe",
    "attributes": [ { "category": "outfit", "id": "female-outfit-0", "label": "Macacão cinza", "visual": "...", "known": true, "referenceOnly": false } ],
    "unknownIds": [],
    "referenceOnly": [ { "id": "female-face-12" } ],
    "inferredRegions": [ { "region": "...", "reason": "..." } ],
    "headsTall": 6.7,
    "physicalHeightCm": 168
  },
  "runs": []
}
```

`brief.text` é exatamente o que vai para `--prompt-file`. Cada ID do 2D aparece
acompanhado de uma descrição visual; IDs sem entrada no vocabulário aparecem em
`unknownIds` em vez de serem traduzidos por adivinhação.

## 6. Demais rotas

| Rota | Método | Função |
|------|--------|--------|
| `/api/lab/runtime` | GET | O que a máquina consegue fazer agora (OpenSCAD, Blender, LLM, capacidades) |
| `/api/lab/characters` | GET | Lista de personagens importados |
| `/api/lab/character?key=` | GET | Registro + briefing + execuções |
| `/api/lab/asset?key=&file=` | GET | Uma referência do registro |
| `/api/lab/generate` | POST | Enfileira uma execução real do pipeline |
| `/api/lab/run-character?runId=` | GET | Qual personagem originou uma execução |

O serviço escuta somente em `127.0.0.1`.
