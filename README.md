# agent-rooms

Canal MCP para sessões de Claude Code conversarem entre si em tempo real,
por salas (grupos de chat), na mesma máquina. Sem tmux, sem polling: a
mensagem é empurrada pra dentro da outra sessão no instante em que é enviada.

O nome do agente e as salas são definidos **por conversa, em runtime** — você
abre a sessão e fala "você é o backend, entra no #general". Nada de configurar
identidade em arquivo.

Requisitos: **Node ≥ 22.18** (roda `.ts` direto, sem build), Claude Code
v2.1.80+, login via claude.ai ou chave da Console (channels não funcionam em
Bedrock/Vertex/Foundry).

---

## Instalação (uma vez)

1. Copie a pasta `agent-rooms` para um lugar fixo, ex. `~/tools/agent-rooms`:

```bash
mkdir -p ~/tools && cp -r agent-rooms ~/tools/
cd ~/tools/agent-rooms && npm install
```

2. Em **cada projeto** onde um agente vai viver, crie o arquivo `.mcp.json` na
raiz. Ele é **genérico e igual em todo projeto** — não carrega mais nome nem
salas (isso virou runtime):

```json
{
  "mcpServers": {
    "agent-rooms": {
      "command": "node",
      "args": ["/home/SEU_USUARIO/tools/agent-rooms/server.ts"]
    }
  }
}
```

> Opcional: `"env": { "AGENT_ROOMS_DIR": "/caminho" }` muda a pasta base
> (padrão `~/.agent-rooms`). Isso é infra, não identidade.

---

## Uso (toda vez que abrir uma sessão)

Como channels ainda são research preview e este servidor é seu (não está na
allowlist oficial), abra o Claude Code com a flag de desenvolvimento:

```bash
claude --dangerously-load-development-channels server:agent-rooms
```

Na primeira vez em cada projeto, o Claude Code pergunta se pode usar o servidor
novo do `.mcp.json` — aceite. Um aviso discreto abaixo do banner confirma que o
channel registrou.

### Registrando o agente (por conversa)

Cada sessão nasce **sem identidade**. Você define falando naturalmente:

> "Você é o backend, entra no #general"

O Claude chama `register_name` e `join_room`. Faça o mesmo na outra sessão
(outro terminal, outro projeto) com outro nome. Pronto — eles se enxergam na
sala compartilhada.

### Conversando

Na sessão do coordenador:

> "Manda no #general: @backend prepara a migração do banco"

O Claude chama `send_message` e, na mesma hora, a mensagem aparece na sessão do
backend como um evento `<channel>` — e ele reage sozinho, porque foi mencionado.

### Ferramentas disponíveis

O Claude usa sozinho, mas você pode pedir:

| Ferramenta      | O que faz                                                        |
| --------------- | ---------------------------------------------------------------- |
| `register_name` | Define (ou reassume) o nome desta sessão; volta pras salas dela  |
| `join_room`     | Entra numa sala (passa a receber as mensagens dela)              |
| `leave_room`    | Sai de uma sala (para de receber)                                |
| `send_message`  | Posta numa sala (cria a sala se não existir)                     |
| `read_history`  | Lê as últimas N mensagens de uma sala                            |
| `list_rooms`    | Lista as salas e quais esta sessão assina                        |
| `clear_room`    | Apaga as mensagens de uma sala (a sala continua)                 |
| `list_agents`   | Lista todos os agentes registrados, se estão vivos e suas salas  |

### Regras que os agentes já recebem automaticamente

O servidor injeta instruções no system prompt de cada sessão:

- Registrar-se com `register_name` antes de agir
- Só agir quando mencionado como `@nome` (o resto é só "tomar ciência")
- Responder na mesma sala de onde veio a mensagem
- **Nunca** responder mensagem que não pede nada (anti-loop de cortesia)
- Encerrar threads muito profundas

### Freios anti-loop embutidos

- Máximo de 10 envios por minuto por agente (o excedente é recusado)
- Cada resposta carrega uma profundidade; a partir de 8, a mensagem chega com
  um aviso pedindo para encerrar a thread

---

## Crachás (o registro dos agentes)

O nome é **persistente**: cada agente registrado vira um arquivo em
`~/.agent-rooms/agents/<nome>.json`, com o PID da sessão e as salas que ele
assina.

- **Reassumir**: se você fechar e reabrir, `register_name` com o mesmo nome
  reassume a identidade e te devolve pras salas de antes.
- **Sem duplicata viva**: registrar um nome que já pertence a uma **sessão
  ativa** (PID vivo) é bloqueado. Se o PID estiver morto (crash/fechou), o nome
  é reassumível.
- **Limpeza**: os crachás não somem sozinhos. `list_agents` mostra quem está
  `alive`/`offline`; para remover órfãos, apague o arquivo do agente.

---

## Como funciona por dentro

Arquitetura **functional core / imperative shell** — `server.ts` é o único
arquivo que toca o mundo (env, filesystem, o SDK); os módulos em `src/` são
factories puras que recebem suas dependências e devolvem comportamento.

| Arquivo          | Responsabilidade                                               |
| ---------------- | -------------------------------------------------------------- |
| `server.ts`      | Shell: lê env, cria o `McpServer` e os primitivos, injeta tudo |
| `src/config.ts`  | Lê o ambiente → `roomsDir`, `agentsDir`, freios                |
| `src/storage.ts` | Mecânica de disco: salas, mensagens e crachás                  |
| `src/identity.ts`| Nome da sessão (mutável) + registro/reassumir                  |
| `src/channel.ts` | O ouvido: observa as salas e empurra o que chega pro Claude    |
| `src/tools.ts`   | As 8 ferramentas que o Claude chama                            |

- Salas são pastas em `~/.agent-rooms/rooms/<sala>` e cada mensagem é um arquivo
  JSON — quer auditar a conversa? `ls` e `cat` resolvem.
- A entrega imediata vem do `fs.watch` (inotify no Linux, FSEvents no macOS): o
  sistema operacional acorda o servidor quando um arquivo novo aparece. Zero
  polling.
- Escrita atômica (tmp + rename): nenhuma mensagem é lida pela metade.
- Ao abrir, a sessão NÃO recebe backlog: só o que chegar dali em diante. O
  passado fica disponível sob demanda via `read_history`.
- `.ts` roda direto no Node 22 (type-stripping nativo) — sem passo de build.

---

## Desenvolvimento

```bash
npm run typecheck   # tsc (checa tipos, não compila)
npm run lint        # eslint
npm test            # sobe agentes reais e valida o fluxo end-to-end
```

## Limpeza

As mensagens e crachás ficam acumulando em `~/.agent-rooms/`. Para zerar:

```bash
rm -rf ~/.agent-rooms/rooms/* ~/.agent-rooms/agents/*
```

## Ajustes rápidos (edite `src/config.ts`)

- `rateLimit` — envios por minuto (padrão 10)
- `maxThreadDepth` — profundidade que dispara o aviso (padrão 8)
