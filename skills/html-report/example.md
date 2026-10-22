---
title: Inventory Sync — Phase 1 Findings
kicker: TICKET-123 · Backend · Sprint 12
subtitle: Read-only review of the warehouse-stock ingestion path before the redesign plan.
date: 2026-09-01
owner: Jane Doe (BE plan)
scope: AC-1 … AC-3
status: "!warn STOPPED — awaiting PO answers"
lang: en
footer: "Generated from the local workspace on 2026-09-01."
pair: "example_pl.html=Wersja polska"
---

## 0. Key findings

```cards
### Ingestion already exists
`src/api/ingestion.py:58-96` handles the SAP warehouse CSV. It is a full-snapshot UPSERT — local stock movements are overwritten on every run.

### No scheduler anywhere
Ingestion is triggered manually over REST. There is no cron, no queue, no worker.

### Two BOM sources disagree
`component_part_map.bom_qty` and `pm_definition_part` both describe parts per PM and are not reconciled.
```

## 1. Source paths per area

| Area | State | Where |
|---|---|---|
| Ingestion endpoint | [[ok:exists]] | `src/api/ingestion.py:58-96` |
| Scheduler | [[bad:none]] | searched compose, k8s manifests, code — nothing |
| Reorder threshold | [[part:partial]] | column exists on 5,225 rows, never read by code |

## 2. Proposals (for PO acceptance)

```items
- **A1** **Keep local movements across syncs.** Apply the snapshot as a delta against a `last_synced_at` watermark instead of a blind UPSERT.
- **A2** **Read `reorder_threshold` from SAP.** Replace the safety-stock heuristic when the SAP value is present.
```

## 3. Blocking questions

```items
- **B1** **Who owns the SAP interface?** Today the feed is a CSV uploaded by hand. [[info:PO]] [[info:Architect]]
- **B2** **Expected sync frequency?** Daily vs hourly changes the delta design. [[info:PO]]
```

> [!STOP]
> No design work starts until B1 and B2 are answered.
