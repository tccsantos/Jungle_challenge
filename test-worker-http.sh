
#!/usr/bin/env bash
set -euo pipefail

API_URL="${API_URL:-http://pineapple.local:3000}"
DB_NAME="jungle_processor"

for command in curl jq docker; do
  command -v "$command" >/dev/null || {
    echo "Dependência ausente: $command"
    exit 1
  }
done

RUN_ID="$(date +%s)-${RANDOM}"
PLAYER_ID="worker-test-${RUN_ID}"
PROVIDER_ID="provider-worker-test"

ROUND_ID="round-${RUN_ID}"
GAME_ID="game-${RUN_ID}"

BET_ID="bet-${RUN_ID}"
REFUND_ID="refund-${RUN_ID}"

echo "=== 1. Criando carteira ==="

# Ajuste somente este payload caso o contrato
# de POST /wallets utilize outro formato.
WALLET_PAYLOAD="$(jq -n \
  --arg playerId "$PLAYER_ID" \
  '{
    playerId: $playerId,
    initialBalance: {
      "amount": "100.00",
      "currency": "BRL"
    }
  }')"

WALLET_RESPONSE="$(curl -fsS \
  -X POST "${API_URL}/wallets" \
  -H "Content-Type: application/json" \
  -d "$WALLET_PAYLOAD")"

echo "$WALLET_RESPONSE" | jq .

WALLET_ID="$(echo "$WALLET_RESPONSE" | jq -r '.id // .walletId // empty')"

if [[ -z "$WALLET_ID" ]]; then
  echo "ERRO: resposta não contém ID da carteira."
  exit 1
fi

echo "=== 2. Enviando REFUND antes da BET ==="

REFUND_PAYLOAD="$(jq -n \
  --arg providerId "$PROVIDER_ID" \
  --arg externalTransactionId "$REFUND_ID" \
  --arg walletId "$WALLET_ID" \
  --arg playerId "$PLAYER_ID" \
  --arg roundId "$ROUND_ID" \
  --arg gameId "$GAME_ID" \
  --arg reference "$BET_ID" \
  '{
    providerId: $providerId,
    externalTransactionId: $externalTransactionId,
    walletId: $walletId,
    playerId: $playerId,
    roundId: $roundId,
    gameId: $gameId,
    kind: "REFUND",
    money: {
      amount: "40.00",
      currency: "BRL"
    },
    referenceExternalTransactionId: $reference
  }')"

REFUND_RESPONSE="$(curl -fsS \
  -X POST "${API_URL}/wagering/transactions" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: ${REFUND_ID}" \
  -d "$REFUND_PAYLOAD")"

echo "$REFUND_RESPONSE" | jq .

[[ "$(echo "$REFUND_RESPONSE" | jq -r '.status')" == "PENDING_REFERENCE" ]] || {
  echo "FALHOU: REFUND deveria estar pendente."
  exit 1
}

TRANSACTION_ID="$(echo "$REFUND_RESPONSE" | jq -r '.transactionId')"

echo "=== 3. Enviando BET correspondente ==="

BET_PAYLOAD="$(jq -n \
  --arg providerId "$PROVIDER_ID" \
  --arg externalTransactionId "$BET_ID" \
  --arg walletId "$WALLET_ID" \
  --arg playerId "$PLAYER_ID" \
  --arg roundId "$ROUND_ID" \
  --arg gameId "$GAME_ID" \
  '{
    providerId: $providerId,
    externalTransactionId: $externalTransactionId,
    walletId: $walletId,
    playerId: $playerId,
    roundId: $roundId,
    gameId: $gameId,
    kind: "BET",
    money: {
      amount: "40.00",
      currency: "BRL"
    }
  }')"

BET_RESPONSE="$(curl -fsS \
  -X POST "${API_URL}/wagering/transactions" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: ${BET_ID}" \
  -d "$BET_PAYLOAD")"

echo "$BET_RESPONSE" | jq .

[[ "$(echo "$BET_RESPONSE" | jq -r '.status')" == "PROCESSED" ]] || exit 1
[[ "$(echo "$BET_RESPONSE" | jq -r '.balance.amount')" == "60.00" ]] || exit 1

echo "=== 4. Aguardando o scheduler processar o REFUND ==="

PROCESSED=false

for attempt in $(seq 1 15); do
  sleep 1

  STATUS="$(sudo docker compose exec -T db \
    psql -U jungle -d "$DB_NAME" -At \
    -c "SELECT status FROM wager_transactions WHERE id = '${TRANSACTION_ID}';" \
    | tr -d '[:space:]')"

  echo "Consulta ${attempt}: ${STATUS}"

  if [[ "$STATUS" == "PROCESSED" ]]; then
    PROCESSED=true
    break
  fi

  if [[ "$STATUS" == "REJECTED" || "$STATUS" == "FAILED" ]]; then
    echo "FALHOU: transação terminou com status ${STATUS}"
    exit 1
  fi
done

[[ "$PROCESSED" == true ]] || {
  echo "FALHOU: REFUND não foi processado pelo scheduler."
  exit 1
}

echo "=== 5. Verificando saldo e ledger ==="

sudo docker compose exec -T db psql \
  -U jungle -d "$DB_NAME" -c "
SELECT id, balance, version
FROM wallets
WHERE id = '${WALLET_ID}';

SELECT transaction_id, direction, amount
FROM wallet_ledger_entries
WHERE transaction_id = '${TRANSACTION_ID}';
"

BALANCE="$(sudo docker compose exec -T db \
  psql -U jungle -d "$DB_NAME" -At \
  -c "SELECT balance FROM wallets WHERE id = '${WALLET_ID}';" \
  | tr -d '[:space:]')"

LEDGER_COUNT="$(sudo docker compose exec -T db \
  psql -U jungle -d "$DB_NAME" -At \
  -c "SELECT COUNT(*) FROM wallet_ledger_entries WHERE transaction_id = '${TRANSACTION_ID}' AND direction = 'CREDIT';" \
  | tr -d '[:space:]')"

[[ "$BALANCE" == "100.00" ]] || {
  echo "FALHOU: saldo final ${BALANCE}, esperado 100.00."
  exit 1
}

[[ "$LEDGER_COUNT" == "1" ]] || {
  echo "FALHOU: encontrado(s) ${LEDGER_COUNT} créditos do REFUND."
  exit 1
}

echo "=== 6. Verificando replay idempotente ==="

REPLAY="$(curl -fsS \
  -X POST "${API_URL}/wagering/transactions" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: ${REFUND_ID}" \
  -d "$REFUND_PAYLOAD")"

echo "$REPLAY" | jq .

[[ "$(echo "$REPLAY" | jq -r '.idempotentReplay')" == "true" ]] || exit 1
[[ "$(echo "$REPLAY" | jq -r '.status')" == "PROCESSED" ]] || exit 1
[[ "$(echo "$REPLAY" | jq -r '.transactionId')" == "$TRANSACTION_ID" ]] || exit 1
[[ "$(echo "$REPLAY" | jq -r '.balance.amount')" == "100.00" ]] || exit 1

echo
echo "SUCESSO: Worker automático validado!"
echo "Carteira: ${WALLET_ID}"
echo "REFUND: ${TRANSACTION_ID}"
echo "Saldo final: ${BALANCE} BRL"
echo "Lançamentos de crédito do REFUND: ${LEDGER_COUNT}"
