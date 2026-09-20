# MCbotv1 Server Rules

## Purpose

These rules apply when working on server-specific behavior.

Current primary server profile:

```text
host: mc.minerua.com
port: 25565
Minecraft: 1.21.4
auth: offline
```

Do not assume these facts are generic Minecraft behavior.

## Source of server facts

Before changing a server-specific feature, read:

```text
.cline/server-profile.json
```

Treat each fact according to its recorded status:

- `CONFIRMED`
- `OBSERVED`
- `INFERRED`
- `UNKNOWN`
- `DEPRECATED`

Never turn `UNKNOWN` or `INFERRED` into a hard-coded rule without new evidence.

## Server-specific capabilities

Known current areas include:

```text
/is
/sky
/kho
/kho sell
/pv 2
/ks
/nung
/afk
/d
```

GUI identity, item identity, click semantics, storage behavior, recipes, timing and recovery policy are server-profile data.

## GUI server behavior

Do not identify a stateful server GUI by:

- command alone;
- first matching regex;
- fixed slot alone;
- title alone.

Use the existing GUI identity/knowledge/session system.

When the server changes layout or title, re-observe before changing bootstrap knowledge.

## Custom items

Server custom items may use MMOItems-style identity.

Strong custom identity must remain distinct from:

- vanilla material;
- display name;
- GUI slot.

Do not replace a strong configured identity with a weaker representation.

## Storage

`/kho` is the authoritative full storage observation for current storage flows.

`/kho sell` is a sell interaction surface, not a full storage database.

Do not infer complete storage state from the Sell GUI.

## Server policy vs bot policy

Keep these separate.

Server facts describe what the server does.

Bot policy describes what MCbot chooses to do.

For example:

- GUI right-click meaning is server behavior;
- whether MCbot is allowed to use that action for a particular workflow is bot policy.

Never document a bot strategy as a universal server rule.

## Unknown behavior

For unknown mechanics:

1. keep behavior fail-closed;
2. capture/re-observe the runtime state;
3. add verified knowledge to the appropriate profile/config;
4. add a regression test where practical.

Do not guess slot, click, recipe, cooldown or chat semantics.

## Timing

Do not replace event/state evidence with arbitrary sleeps.

A delay is valid only when it is already part of a documented server or application contract.

## Server isolation

Server-specific knowledge belongs at the server-feature/profile boundary.

Do not move MinerUA commands, GUI assumptions or item identities into generic:

- core;
- bot;
- operations;
- generic GUI;
- generic inventory;
- generic movement.

## Rule when profile changes

When working against another server:

```text
server profile
→ server capability mapping
→ workflow
```

Do not modify generic core merely to encode one server's behavior.
