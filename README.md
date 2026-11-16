# Jungle Challenge — Distributed Wagering Processor

Serviço de processamento financeiro de apostas com **NestJS**, **TypeScript**, **Bun**, **PostgreSQL**, **MikroORM** e **AWS SQS** (em ambiente local, via **LocalStack**). Implementa saldo materializado por wallet, ledger auditável, idempotência persistente e padrões **Transactional Inbox/Outbox**.

> **Status:** implementação de desafio técnico, não sistema de produção. Este documento descreve a versão pública consultada em 16/11/2026. Veja [ARCHITECTURE.md](ARCHITECTURE.md) para garantias, decisões, trade-offs e limitações. Não confunda a aprovação de testes com comprovação automática de todos os cenários distribuídos do enunciado.

## 1. Requisitos

- Docker Engine e Docker Compose v2;
- Bun 1.x para execução fora dos containers (opcional);
- `curl` para exemplos HTTP; `jq` para formatar os resultados (opcional);
- token do LocalStack, exigido pelo `docker-compose.localstack.yml` atualmente versionado.

## 2. Ambiente local

```bash
git clone https://github.com/tccsantos/Jungle_challenge.git
cd Jungle_challenge
```

**Verificação prévia importante:** na revisão do repositório, o arquivo de build estava nomeado `dockerfile` (minúsculo), enquanto o Compose apontava para `Dockerfile`. Em sistemas Linux, ajuste o nome antes de executar:

```bash
mv dockerfile Dockerfile
```

Se esse ajuste já estiver presente no seu checkout, não é necessário repeti-lo. O comando `mv` é uma correção local sugerida, não uma mudança já aplicada no repositório.

Para executar **somente API e PostgreSQL**:

```bash
sudo docker compose up -d --build
sudo docker compose ps
```

A API expõe por padrão `http://localhost:3000`; o banco usa o serviço `db` na rede do Compose. **Atenção:** sem filas SQS configuradas, `/health/ready` deve retornar indisponibilidade e os workers registrarão falhas de mensageria.

Para executar também o SQS local:

```bash
# Forneça o token através do seu ambiente; nunca o comite no Git.
export LOCALSTACK_AUTH_TOKEN='<seu-token>'

sudo docker compose \
  -f docker-compose.yml \
  -f docker-compose.localstack.yml \
  config

sudo docker compose \
  -f docker-compose.yml \
  -f docker-compose.localstack.yml \
  up -d --build --scale worker=3
```

> **Provisionamento das filas:** o Compose configura URLs esperadas para `wager-transactions.fifo` e `wager-events.fifo`, mas não comprova sozinho sua criação. Provisione as filas e a DLQ conforme as regras de FIFO, redrive policy e visibility timeout antes de testar o consumidor. A fila `wager-transactions-dlq.fifo` é exigida pelo desafio. Verifique a criação e as políticas no seu ambiente LocalStack.

Verificações:

```bash
curl -i http://localhost:3000/health/live
curl -i http://localhost:3000/health/ready
curl -i http://localhost:3000/internal/health

sudo docker compose \
  -f docker-compose.yml \
  -f docker-compose.localstack.yml \
  ps
```

**Não exponha** as portas/configurações de desenvolvimento e as credenciais de exemplo em produção.

### Banco e migrations

As migrations são versionadas em `migrations/`. Para inspecionar os comandos da versão instalada do MikroORM:

```bash
sudo docker compose exec api bunx mikro-orm migration:up --help
```

Depois de confirmar o banco de destino e a configuração utilizada:

```bash
sudo docker compose exec api bunx mikro-orm migration:up
```

Para rollback, revise primeiro a reversibilidade da migration e, em ambiente descartável, execute `bunx mikro-orm migration:down`. **Não faça rollback de migrations com dados financeiros sem procedimento de recuperação e backup.**

## 3. API HTTP

Todas as quantias monetárias são strings decimais; **nunca** envie números JSON para campos de dinheiro.

| Método | Rota | Função |
|---|---|---|
| `POST` | `/wallets` | Criar wallet (e lançamento interno `OPENING` quando há saldo inicial) |
| `GET` | `/wallets/:id` | Consultar saldo e versão |
| `GET` | `/wallets/:id/ledger?limit=20&cursor=...` | Paginar histórico do ledger por cursor opaco |
| `POST` | `/wallets/:id/reconciliation` | Conferir saldo materializado x ledger |
| `GET` | `/wallets/reconciliation` | Diagnóstico de reconciliação das wallets |
| `POST` | `/wagering/transactions` | Processar operação com `Idempotency-Key` |
| `GET` | `/health/live` | Liveness |
| `GET` | `/health/ready` | Readiness com PostgreSQL e SQS |
| `GET` | `/internal/health` | Diagnóstico operacional agregado |

Os endpoints de consulta de transações também estão ligados ao módulo de wagering; consulte `src/wagering/wager-transaction-query.controller.ts` para a definição exata de parâmetros e respostas.

### Criar wallet

```bash
curl -sS -X POST http://localhost:3000/wallets \
  -H 'Content-Type: application/json' \
  -d '{
    "playerId": "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
    "initialBalance": {"amount": "100.00", "currency": "BRL"}
  }'
```

Guarde o `id` retornado como `WALLET_ID` e utilize **novos identificadores** ao repetir o exemplo. Uma wallet já existente para o mesmo par jogador/moeda gera conflito.

### Enviar uma BET

```bash
export WALLET_ID='<id-da-wallet-criada>'

curl -sS -X POST http://localhost:3000/wagering/transactions \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: provider-a:bet-001' \
  -d "{
    \"providerId\": \"provider-a\",
    \"externalTransactionId\": \"bet-001\",
    \"playerId\": \"0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1\",
    \"walletId\": \"$WALLET_ID\",
    \"roundId\": \"round-001\",
    \"gameId\": \"fortune-chimp\",
    \"kind\": \"BET\",
    \"money\": {\"amount\": \"25.00\", \"currency\": \"BRL\"}
  }"
```

Resposta contém `transactionId`, `status`, `balance` e `idempotentReplay`, e pode incluir `failureCode`. O replay idêntico mantém o resultado original e define `idempotentReplay: true`; reutilizar a key com outro payload produz conflito. Para `REFUND`/`ROLLBACK`, inclua `referenceExternalTransactionId` com o ID externo referenciado.

### Consultar e reconciliar

```bash
curl -sS "http://localhost:3000/wallets/$WALLET_ID"
curl -sS "http://localhost:3000/wallets/$WALLET_ID/ledger?limit=20"
curl -sS -X POST "http://localhost:3000/wallets/$WALLET_ID/reconciliation"
```

A reconciliação deve apontar `consistent: true` e diferença `0.00` no cenário íntegro. Qualquer divergência exige investigação, **não** ajuste silencioso do saldo.

## 4. Comandos de testes

As suítes são executadas com Vitest através do Bun:

```bash
sudo docker compose exec api bun run test
sudo docker compose exec api sh -lc \
  'DATABASE_URL="${DATABASE_URL%/*}/jungle_processor_test" bun run test:integration'
sudo docker compose exec api sh -lc \
  'DATABASE_URL="${DATABASE_URL%/*}/jungle_processor_test" bun run test:e2e'
```

**Pré-condição:** o banco `jungle_processor_test` deve existir, ter as migrations necessárias e ser descartável. Não aponte esses testes ao banco de produção.

Evidência compartilhada em 16/11/2026, executada pelo mantenedor em Docker:

| Suíte | Arquivos | Testes aprovados |
|---|---:|---:|
| Unitários | 11 | 119 |
| Integração | 5 | 43 |
| HTTP E2E | 2 | 22 |
| **Total** | **18** | **184** |

O teste de integração reportado inclui **50 BETs idênticas em paralelo**, com um único processamento esperado. Isso não substitui experimentos de queda de processos e SQS real com três instâncias.

Outros comandos:

```bash
sudo docker compose exec api bun run lint
sudo docker compose exec api bun run build
sudo docker compose exec api bun run test:cov
```

### Verificações distribuídas a completar

1. Três instâncias processando operações que disputam a mesma wallet; para duas BETs de `80.00` sobre `100.00`, somente uma pode ser aplicada.
2. Uma mesma mensagem entregue repetidas vezes por SQS com Inbox persistente.
3. Dois publishers concorrentes sobre a Outbox e publicação após reinício.
4. Morte do consumidor **após o commit e antes do ACK**, seguida de redelivery sem movimentação duplicada.
5. `REFUND` e `ROLLBACK` antes da referência; tentativa esgotada e rejeição auditável.
6. Conferência final: saldo da wallet = saldo reconstruído do ledger.

Há scripts auxiliares na raiz (`distributed-race-test.py`, `sqs-distributed-test.ts`, `crash-sqs-publisher.ts`), porém seus requisitos e envelopes de mensagem devem ser revisados antes de considerá-los testes de aceitação reproduzíveis.

## 5. Estrutura do projeto

```text
src/
  shared/domain/               # Value objects, incluindo Money
  wallet/domain/               # Wallet e WalletLedgerEntry
  wallet/application/          # Abertura de wallet e reconciliação
  wallet/repositories/         # Persistência e paginação do ledger
  wagering/domain/             # WagerTransaction e regras de status
  wagering/application/        # Processamento, hash, retry de referências
  wagering/workers/            # Consumidor SQS e referências pendentes
  messaging/domain/            # Inbox, Outbox, eventos de integração
  messaging/repositories/      # Persistência e claim de eventos
  messaging/workers/           # Publisher periódico da Outbox
  observability/               # Health endpoints
migrations/                    # Evolução versionada do banco
test/                          # Testes E2E
```

## 6. Limitações e próximos passos

- O código consultado não apresenta integração com um Identity Provider. A decisão de não implementar autenticação deve ser explicitada na apresentação e o ponto de extensão desenhado (ver arquitetura).
- O worker SQS registra falhas e deixa mensagens para redelivery, mas a classificação completa de falhas de negócio, transitórias, permanentes e DLQ exige validação/implementação adicional.
- Existem diagnósticos de health/outbox; um conjunto completo de métricas de observabilidade e logs JSON correlacionados ainda precisa ser demonstrado.
- O projeto não pode ser apresentado como comprovadamente correto sob todas as falhas distribuídas sem os testes de aceitação correspondentes.
- O Compose de desenvolvimento replica a aplicação completa nos serviços `api` e `worker`; não há separação explícita dos papéis por entrypoint nesta versão.

Consulte [ARCHITECTURE.md](ARCHITECTURE.md) para decisões de projeto, limites das garantias e a relação com os critérios de avaliação do desafio.
