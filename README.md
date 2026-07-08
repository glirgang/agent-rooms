# agent-rooms

Canal MCP para sessões de Claude Code conversarem entre si em tempo real,
por salas (grupos de chat), na mesma máquina. Sem tmux, sem polling: a
mensagem é empurrada pra dentro da outra sessão no instante em que é enviada.

Requisitos: Node 18+, Claude Code v2.1.80+, login via claude.ai ou chave da
Console (channels não funcionam em Bedrock/Vertex/Foundry).

---

## Instalação (uma vez)

1. Copie a pasta `agent-rooms` para um lugar fixo, ex. `~/tools/agent-rooms`:

```bash
mkdir -p ~/tools && cp -r agent-rooms ~/tools/
cd ~/tools/agent-rooms && npm install
```

2. Em **cada projeto** onde um agente vai viver, crie (ou edite) o arquivo
`.mcp.json` na raiz do projeto. É aqui que você dá o **nome** do agente e as
**salas** que ele assina:

```json
{
  "mcpServers": {
    "agent-rooms": {
      "command": "node",
      "args": ["/home/SEU_USUARIO/tools/agent-rooms/server.mjs"],
      "env": {
        "AGENT_NAME": "backend",
        "AGENT_ROOMS": "general,projeto-x"
      }
    }
  }
}
```

No projeto do outro agente, mesmo arquivo, só mudando `AGENT_NAME`
(ex. `"coordenador"`) e, se quiser, as salas.

---

## Uso (toda vez que abrir uma sessão)

Como channels ainda são research preview e este servidor é seu (não está na
allowlist oficial), abra o Claude Code com a flag de desenvolvimento:

```bash
claude --dangerously-load-development-channels server:agent-rooms
```

Na primeira vez em cada projeto, o Claude Code pergunta se pode usar o
servidor novo do `.mcp.json` — aceite. Um aviso discreto abaixo do banner
confirma que o channel registrou.

Abra a outra sessão (outro terminal, outro projeto) do mesmo jeito. Pronto.

### Conversando

Na sessão do coordenador, fale naturalmente:

> "Manda no #general: @backend prepara a migração do banco"

O Claude chama `send_message` e, na mesma hora, a mensagem aparece na sessão
do backend como um evento `<channel>` — e ele reage sozinho, porque foi
mencionado.

Ferramentas disponíveis (o Claude usa sozinho, mas você pode pedir):

| Ferramenta     | O que faz                                          |
| -------------- | -------------------------------------------------- |
| `send_message` | Posta numa sala (cria a sala se não existir)       |
| `read_history` | Lê as últimas N mensagens de uma sala              |
| `list_rooms`   | Lista as salas existentes e quais este agente assina |

### Regras que os agentes já recebem automaticamente

O servidor injeta instruções no system prompt de cada sessão:

- Só agir quando mencionado como `@nome` (o resto é só "tomar ciência")
- Responder na mesma sala de onde veio a mensagem
- **Nunca** responder mensagem que não pede nada (anti-loop de cortesia)
- Encerrar threads muito profundas

### Freios anti-loop embutidos

- Máximo de 10 envios por minuto por agente (o excedente é recusado)
- Cada resposta carrega uma profundidade; a partir de 8, a mensagem chega
  com um aviso pedindo para encerrar a thread

---

## Como funciona por dentro

- Salas são pastas em `~/.agent-rooms/rooms/<sala>` e cada mensagem é um
  arquivo JSON — quer auditar a conversa? `ls` e `cat` resolvem.
- A entrega imediata vem do `fs.watch` (inotify do Linux/macOS): o sistema
  operacional acorda o servidor quando um arquivo novo aparece. Zero polling.
- Escrita atômica (tmp + rename): nenhuma mensagem é lida pela metade.
- Ao abrir, a sessão NÃO recebe backlog: só o que chegar dali em diante.
  O passado fica disponível sob demanda via `read_history`.

## Limpeza

As mensagens ficam acumulando em `~/.agent-rooms/rooms/`. Para zerar:

```bash
rm -rf ~/.agent-rooms/rooms/*
```

## Ajustes rápidos (edite o topo do server.mjs)

- `RATE_LIMIT` — envios por minuto (padrão 10)
- `MAX_THREAD_DEPTH` — profundidade que dispara o aviso (padrão 8)
