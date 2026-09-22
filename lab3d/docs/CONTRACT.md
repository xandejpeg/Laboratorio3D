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

Essas referências entram no cálculo da identidade do personagem e ficam
disponíveis para inspeção. **Não reduzem as regiões inferidas pelo gerador**,
porque ele não recebe essas imagens. O campo só poderá mudar para `"pipeline"`
quando houver um caminho de execução que realmente entregue a vista adicional.

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
  "recipe": {
    "family": "female",
    "outfit": "female-outfit-0",
    "body": "female-body-3",
    "face": "female-face-12",
    "hair": "female-hair-0",
    "eyes": "female-eyes-natural",
    "nose": "female-nose-natural",
    "mouth": "female-mouth-natural",
    "brows": "female-brows-natural",
    "ears": "female-ears-natural",
    "skin": "female-skin-0",
    "marks": "female-marks-0",
    "upper": "female-upper-0",
    "lower": "female-lower-0",
    "eyeColor": "castanho",
    "hairColor": "castanho-claro",
    "naikeColor": "cinza",
    "suitColor": "preto"
  },
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
interface. Como a receita também não declara `front`, suas dimensões são lidas
do arquivo frontal enviado, sem assumir 900 × 1280.

---

## 3. Regras de validação

Erros de contrato voltam como `422`. Problemas com os arquivos enviados e
chaves obrigatórias da receita são agrupados em `details`; as demais
validações interrompem na primeira estrutura inválida:

```json
{ "error": "import rejected", "details": ["recipe.hair must be a non-empty string (send canonicalRecipe())"] }
```

| Regra | Comportamento |
|-------|---------------|
| `recipe.family` ∈ {`female`, `male`} | obrigatório |
| Categorias `outfit, body, face, hair, eyes, nose, mouth, brows, ears, skin, marks, upper, lower` | strings não vazias |
| Cores `eyeColor, hairColor, naikeColor, suitColor` | strings não vazias |
| Chaves desconhecidas na receita | **preservadas**, nunca descartadas |
| Linhas da ficha | `title`, `key`, `label` e `value` mantêm seu texto; campos futuros e `color: null` da pele natural são preservados. Tipos inválidos são recusados, sem conversão para texto |
| IDs fora do vocabulário do laboratório | aceitos e **reportados** como desconhecidos; nunca adivinhados |
| `physicalHeightCm` | número em 50–260, ou `null`/ausente. Fora disso é recusado, não ajustado |
| `contractVersion` ≠ 1 (forma A) | recusado |
| `contract` explícito diferente de `lab3d.character-import` | recusado, sem reinterpretar como ficha antiga |
| `front.width` e `front.height` | inteiros positivos; quando ausentes, vêm das dimensões reais do upload |
| Tamanho da imagem frontal ≠ `front.width`×`front.height` | recusado por incompatibilidade de dimensões. Dimensões iguais não comprovam, sozinhas, correspondência visual com a receita |
| Ângulo duplicado | recusado |

PNG, JPEG e WebP precisam ter cabeçalhos e dimensões legíveis. O importador
inspeciona a estrutura dos arquivos; essa inspeção não equivale a decodificar
todos os pixels nem a validar visualmente o personagem. O limite de 24 MB vale
para cada referência.

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
- A ordem dos campos de referência no multipart e uma mudança apenas em
  `source.exportedAt` não criam conflitos. O conteúdo e timestamp do primeiro
  registro continuam preservados. O digest de conteúdo exclui esse timestamp
  e ordena as referências por ângulo; digests v1 anteriores ainda são
  verificados e lidos sem reescrever o registro.
- Trocar qualquer item da receita, qualquer pixel da imagem frontal, ou anexar
  uma referência adicional produz **outra** chave e outro registro.
- Uma chave já ocupada por conteúdo diferente é recusada com `409`; um
  personagem nunca exibe o resultado de outro.
- Campos como nome, ficha, notas de referências e revisões de origem fazem
  parte do digest de conteúdo. Se mudarem sem alterar a chave de identidade,
  a importação retorna `409` e mantém a versão original para revisão explícita.
- Antes de reutilizar ou servir uma referência, o laboratório verifica a chave,
  o digest do registro e os bytes de cada imagem. Registros corrompidos ou
  incompletos não são sobrescritos por uma nova importação.

O registro é gravado em `outputs/lab3d/characters/<key>/`:
`record.json`, `bundle.json`, `source.json` (o payload cru recebido), as imagens
e `runs.jsonl` (somente-anexar). `outputs/` está no `.gitignore`, então nada
disso entra no Git.

A gravação prepara todos os arquivos em um diretório temporário e só publica
o diretório final quando está completo. `run-index/<runId>.json` reserva a
proveniência de cada execução: o mesmo `runId` não pode ser reassociado a outro
personagem nem ter opções ou briefing alterados. Reenviar o vínculo idêntico
é idempotente.

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
