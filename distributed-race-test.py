
import json
import os
import subprocess
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

wallet_id = os.environ["WALLET_ID"]
player_id = os.environ["PLAYER_ID"]
run_id = os.environ["RUN_ID"]

barrier = Barrier(2)


def place_bet(index: int, container: str):
    payload = {
        "providerId": "distributed-test",
        "externalTransactionId": f"bet-{run_id}-{index}",
        "walletId": wallet_id,
        "playerId": player_id,
        "roundId": f"round-{run_id}",
        "gameId": "distributed-game",
        "kind": "BET",
        "money": {
            "amount": "80.00",
            "currency": "BRL",
        },
    }

    barrier.wait()

    result = subprocess.run(
        [
            "sudo",
            "docker",
            "exec",
            "-i",
            container,
            "bun",
            "-e",
            """
const payload = JSON.parse(process.argv[1]);
const key = process.argv[2];

const response = await fetch(
  'http://127.0.0.1:3000/wagering/transactions',
  {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': key,
    },
    body: JSON.stringify(payload),
  },
);

console.log(JSON.stringify({
  httpStatus: response.status,
  body: await response.json(),
}));
""",
            json.dumps(payload),
            f"distributed-key-{run_id}-{index}",
        ],
        capture_output=True,
        text=True,
        timeout=30,
    )

    if result.returncode != 0:
        raise RuntimeError(result.stderr)

    return container, json.loads(result.stdout)


with ThreadPoolExecutor(max_workers=2) as executor:
    futures = [
        executor.submit(place_bet, 1, "jungle_worker_2"),
        executor.submit(place_bet, 2, "jungle_worker_3"),
    ]

    for future in futures:
        container, result = future.result()
        print(json.dumps({
            "container": container,
            **result,
        }, indent=2))
