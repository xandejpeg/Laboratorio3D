# Instalação e execução no Windows

O caminho validado neste marco é **Windows nativo**, com Bun, OpenSCAD Manifold e Blender chamado em segundo plano pelos scripts Python do Procedura. Isaac Sim não foi instalado nem usado. O instalador `scripts/install-deps.sh` foi escrito para Linux e não é o instalador Windows.

## Ambiente observado em 22/09/2026

| Dependência | Resultado local |
| --- | --- |
| Bun | 1.3.8; satisfaz `engines.bun >=1.3`; manifest upstream registra `packageManager bun@1.3.14` |
| OpenSCAD | 2026.09.18, backend Manifold presente; `%LOCALAPPDATA%\Programs\OpenSCAD-2026.09.18-x86-64\openscad.exe` |
| Blender | 5.2.1 LTS; `%ProgramFiles%\Blender Foundation\Blender 5.2\blender.exe` |
| Python externo | 3.12.10 disponível; o render usa o Python embutido no Blender |
| WSL | somente `docker-desktop`, parado; não há distribuição Linux de desenvolvimento validada |
| Provedor de modelo | sem credencial para o transporte OpenAI selecionado pelo modelo default |

Esses binários já estavam instalados. A presença de WSL não significa que Ubuntu ou o instalador upstream tenham sido testados. Não foi necessário instalar outra distribuição ou mudar o PATH.

## Preparar o repositório

Abra PowerShell na pasta do clone:

```powershell
bun install --frozen-lockfile
bun install --cwd lab3d --frozen-lockfile
bun run lab3d/scripts/doctor.ts
```

O `doctor` verifica se os executáveis realmente respondem, mostra versões e distingue renderização local de avaliação visual por modelo. Nunca faz uma chamada ao provedor. O estado `configurado` indica presença da credencial do transporte selecionado, sem validar disponibilidade comercial do modelo, acesso ou orçamento.

A descoberta é compartilhada com o núcleo do Procedura. No Windows procura instalações `OpenSCAD*` e `Blender Foundation\Blender*` em `%ProgramFiles%`, `%ProgramFiles(x86)%` e `%LOCALAPPDATA%\Programs`, além do PATH. Um override de Blender tem precedência; OpenSCAD preserva a preferência upstream por uma instalação com Manifold.

Para uma instalação portátil em outro local, defina na sessão ou no `.env` da raiz:

```dotenv
OPENSCAD_PATH=D:\ferramentas\OpenSCAD\openscad.exe
PROCEDURA_BLENDER_PATH=D:\ferramentas\Blender\blender.exe
```

O OpenSCAD precisa anunciar `--backend` no `--help`. A alternativa explícita `PROCEDURA_ALLOW_CGAL_OPENSCAD=1` permite o backend antigo, com risco de compilações muito mais demoradas; CGAL não foi usado neste marco. Não execute o instalador Bash upstream no Windows nativo.

### Seleção de CPU para render

O trabalho paralelo integrado de `origin/main` registrou um render OPTIX sem amostras por mais de quatro minutos nesta máquina; CPU concluiu o controle. A causa de driver/dispositivo não foi isolada. Para a execução local validada, selecione CPU no `.env` da raiz ou na sessão PowerShell:

```powershell
$env:PROCEDURA_RENDER_GPU = '0'
```

Sem essa variável, o padrão upstream continua sendo GPU. O `doctor` informa quando CPU foi selecionada; isso não garante a conclusão de qualquer cena. O smoke abaixo solicita CPU explicitamente.

## Validar sem chamadas pagas

```powershell
bun run typecheck
bun run --cwd lab3d typecheck
bun test lab3d/tests
bun run lab3d/scripts/smoke-runtime.ts
```

O smoke usa somente `lab3d/tests/fixtures/mechanical-bracket.scad`, uma peça sintética. Compila STL/OBJ por OpenSCAD, renderiza quatro vistas por Blender/Cycles em CPU, recompila parâmetros, verifica invalidação do cache após mudança da fonte e rejeita SCAD inválido. Não importa o orquestrador LLM nem gera referência por API.

Os arquivos são gravados em `outputs/runtime-smoke/<data>/`, ignorados pelo Git. Pode passar uma pasta explícita como único argumento; caminhos com espaços foram testados. O relatório JSON registra versão, configuração, duração, geometria e ausência de chamadas a modelos. Resultados e uploads particulares continuam fora do Git.

O teste valida a cadeia de execução geométrica. Planejamento, autoria e correções pelo modelo continuam pendentes de configuração autorizada. Veja [MECANICO_OFFLINE.md](MECANICO_OFFLINE.md) para os resultados medidos.

## Iniciar o laboratório

```powershell
bun run lab3d/server.ts
```

Abra [http://127.0.0.1:8770](http://127.0.0.1:8770). O serviço fica restrito a `127.0.0.1`; a instância upstream do Studio não deve ser exposta à rede nesta etapa.

| Variável | Padrão | Função |
| --- | --- | --- |
| `LAB3D_PORT` | `8770` | Porta; escolha outra se já houver uma instância |
| `LAB3D_OUTPUTS_ROOT` | `<repo>/outputs` | Execuções, uploads e registro local |
| `LAB3D_MAX_CONCURRENT` | `1` | Execuções simultâneas |

Para usar outra porta nesta sessão:

```powershell
$env:LAB3D_PORT = '8771'
bun run lab3d/server.ts
```

## Habilitar um ensaio com modelo

Para conectar a prévia do gerador 2D ao laboratório sem baixar arquivos manualmente, veja [Envio direto do 2D](BRIDGE_2D.md). Essa conexão funciona sem configurar um modelo.

Planejamento das peças, autoria OpenSCAD e crítica/refino visual precisam de um endpoint multimodal compatível com a rota selecionada. A PNG importada evita gerar uma nova referência por API. As strings do catálogo upstream são configurações do código; sua disponibilidade atual não foi verificada.

Após definir provedor, modelo e orçamento autorizado, copie `.env.example` para `.env` **somente se `.env` ainda não existir** e configure no backend a chave correspondente. Não sobrescreva configuração existente, não coloque chaves no navegador e não envie `.env` ao Git.

A seleção respeita `provider:model`, depois o catálogo de `src/config/models.ts`, e finalmente `PROCEDURA_PROVIDER` para um nome desconhecido. Ter somente `GEMINI_API_KEY` não configura o modelo OpenAI padrão. O `doctor` mostra o transporte efetivamente selecionado e remove credenciais/query/fragmento do endpoint exibido.

Importação, briefing, consulta de resultados, renderização local e recompilação da geometria existente não dependem dessa autorização de gasto. A fidelidade da personagem humana e a comparação com um objeto gerado pelo modelo ainda precisam do ensaio completo.

## Adaptações realizadas

- Scripts Blender e arquivos de prompts resolvidos com `fileURLToPath`, incluindo drive Windows e nomes com espaços.
- Descoberta de binários comum ao laboratório e núcleo, com probe de execução e timeout.
- Blender recebe `--python-exit-code 1`; exceções Python tornam a renderização uma falha real.
- Cancelamento/timeout encerram a árvore dos workers por `taskkill /T /F` no Windows.
- Compilação drena stdout/stderr em paralelo, rejeita falha/timeout e remove artefatos antigos antes de executar.
- Cache de parâmetros usa SHA-256 da fonte, caminho, binário, defines e modo preview; arquivos externos em `include/use/import/surface` desabilitam reaproveitamento. STL só entra no cache após conclusão válida.
