# Condition-Based Waiting for MCbotv1

## Principle

Wait for the state/event/postcondition that matters, not an arbitrary delay guess.

## Use when

- a test is flaky;
- GUI/inventory/crafting state arrives asynchronously;
- reconnect state settles asynchronously;
- a renderer snapshot arrives after a state transition;
- a server event may lag the originating action.

## Preferred pattern

```text
trigger condition
→ poll/await authoritative condition
→ bounded timeout
→ verify condition
```

Use existing waiters, event contracts, operation timeouts and verification services before inventing new polling.

## Rules

- always have a bounded timeout;
- refresh the observed state inside the wait condition;
- do not cache stale state before the wait;
- do not increase sleep duration as a substitute for discovering the real condition;
- preserve botId and connectionGeneration where applicable;
- distinguish “event received” from “postcondition established”.

## Legitimate fixed delays

A fixed delay is acceptable only when timing itself is the contract, such as testing a documented cooldown or tick interval. Document why the delay is contract-based.
