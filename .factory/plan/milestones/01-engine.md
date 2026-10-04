---
title: Rules engine
---

A pure TypeScript Salient engine in `games/salient/engine` that implements the rules in
`salient/docs/salient-rules-v0.md` exactly: seeded symmetric map generation, visibility,
order validation, turn resolution and scoring with supply. It is done when the five golden
logs in `salient/docs/golden/` replay through it cell by cell with matching scores and
results, the five combat rows from the rules and the invalid-order vectors in brief §8 pass
as unit tests, generated maps are identical under the half-turn rotation
`(q,r) -> (-q,-r)`, and the same seed plus orders produce byte-identical output. Nothing
else in the project is trustworthy before this is.
