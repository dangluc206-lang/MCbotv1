# Design: <change-name>

## Current relevant architecture

<Only the slice being changed.>

## Target architecture

<Desired ownership/dependency flow.>

## Ownership changes

| Responsibility | Current owner | Target owner | Migration step |
|---|---|---|---|
| <responsibility> | <path> | <path> | <step> |

## Data / control flow

```text
<flow>
```

## Contracts and invariants

- <contract>

## Configuration

- <config path> — <change>

## Lifecycle / cleanup / concurrency

- <rule>

## Migration sequence

1. <step>

## Deletion / compatibility

<What becomes removable and the proof required before removal.>

## Verification strategy

- <test>
- <architecture/config gate>
- <runtime/replay evidence>
