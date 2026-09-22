# Instalação e execução no Windows

O instalador upstream (`scripts/install-deps.sh`) é um script bash escrito para
Linux: ele baixa AppImages, usa `apt` e grava em `$HOME/opt`. **Nada disso vale
aqui.** Este documento descreve o caminho que foi efetivamente verificado nesta
máquina.

Confira o estado real a qualquer momento:

```powershell
bun run lab3d/scripts/doctor.ts
```

---

## 1. Bun — necessário

Verificado: **Bun 1.3.8** em `C:\Users\xandao\.bun\bin\bun.exe`.

```powershell
irm bun.sh/install.ps1 | iex
```

Instale as dependências nos dois pacotes:

```powershell
cd C:\Users\xandao\Documents\GitHub\Laboratorio3D
bun install
cd lab3d
bun install
```

A instalação na raiz não é opcional: o gerenciador de execuções só dispara a CLI
quando `node_modules/` existe na raiz do repositório.

## 2. OpenSCAD — necessário para gerar geometria (AUSENTE nesta máquina)

Sem OpenSCAD o pipeline não compila nenhuma peça: não há malha, não há render,
não há recompilação de parâmetros. A interface informa isso e `/api/lab/generate`
responde `503` em vez de fingir progresso.

Exija uma build **com backend Manifold** (OpenSCAD 2025.x / nightly). Uma build
antiga com CGAL é ordens de magnitude mais lenta e o próprio upstream se recusa
a usá-la a menos que `PROCEDURA_ALLOW_CGAL_OPENSCAD=1` esteja definido.

1. Baixe o instalador ou o ZIP de <https://openscad.org/downloads.html>
   (seção *Development Snapshots*, Windows 64-bit).
2. Instale, ou extraia em um diretório estável.
3. Se não ficar em `C:\Program Files\OpenSCAD\openscad.exe`, aponte o caminho no
   `.env` da raiz:

   ```
   OPENSCAD_PATH=D:\ferramentas\openscad\openscad.exe
   ```

O laboratório procura, nesta ordem: `OPENSCAD_PATH`,
`%ProgramFiles%\OpenSCAD\openscad.exe`, `OpenSCAD (Nightly)`,
`%LOCALAPPDATA%\Programs\...` e por fim `where.exe openscad`. O caminho
encontrado é injetado no ambiente do processo filho, porque o upstream só
procura em `$HOME/opt`, `/usr/local/bin` e `/opt`.

Confirme o backend depois de instalar: o `doctor` imprime `manifold sim/NÃO`.

## 3. Blender — necessário para a crítica visual

Verificado: **Blender 5.2.1 LTS** em
`C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`. Ele **não está no
PATH**, e não precisa estar — o laboratório varre `Blender Foundation\*` e
escolhe a versão mais recente, repassando o caminho ao processo filho.

Para fixar outra instalação:

```
PROCEDURA_BLENDER_PATH=C:\Program Files\Blender Foundation\Blender 4.2\blender.exe
```

## 4. Modelo de linguagem — necessário para gerar (NÃO CONFIGURADO)

Planejamento, geração das peças e refino são chamadas a um modelo. Sem
credencial não há geração, e o laboratório diz isso em vez de simular.

Copie `.env.example` para `.env` na raiz e preencha:

```
OPENAI_API_KEY=...
OPENAI_BASE_URL=https://api.openai.com/v1
PROCEDURA_MODEL=gpt-5.2
```

Também há suporte a `GEMINI_API_KEY` / `GEMINI_BASE_URL` e a
`PROCEDURA_PROVIDER`. O `.env` está no `.gitignore`; nenhuma credencial entra no
repositório público.

**Isto gera custo por execução.** Confirme provedor, modelo e orçamento antes de
disparar um ensaio.

## 5. Python

Verificado: **Python 3.12.10**. Só é exigido pelas etapas de movimento
(Isaac/URDF), que não fazem parte deste marco.

---

## 6. Executar

```powershell
cd C:\Users\xandao\Documents\GitHub\Laboratorio3D
bun run lab3d/server.ts
```

Abra <http://127.0.0.1:8770>.

O servidor escuta **somente em 127.0.0.1**. Isto é uma diferença deliberada em
relação ao Studio upstream, que escuta em `0.0.0.0` sem autenticação: ele expõe
leitura e escrita de arquivos e execução de processos, e não deve ficar
acessível na rede.

Variáveis de ambiente do laboratório:

| Variável | Padrão | Função |
|----------|--------|--------|
| `LAB3D_PORT` | `8770` | Porta |
| `LAB3D_OUTPUTS_ROOT` | `<repo>/outputs` | Raiz das execuções e do registro |
| `LAB3D_MAX_CONCURRENT` | `1` | Execuções simultâneas |

## 7. Alternativa: WSL

O WSL está presente, mas a única distribuição instalada é `docker-desktop`
(parada), que não serve para rodar o instalador upstream. Seria necessário
instalar uma distribuição real (`wsl --install -d Ubuntu`) e então
`bash scripts/install-deps.sh`. O caminho nativo do Windows descrito acima foi o
verificado e é o recomendado.

## 8. O que falta hoje

| Etapa | Estado |
|-------|--------|
| Importar personagem do gerador 2D | funciona |
| Ficha, tradução dos IDs e briefing | funciona |
| Registro imutável e reaproveitamento | funciona |
| Visualizar malha de execução existente | funciona |
| Gerar modelo novo | **bloqueado**: falta OpenSCAD e credencial de LLM |
| Recompilar parâmetros | **bloqueado**: falta OpenSCAD |
