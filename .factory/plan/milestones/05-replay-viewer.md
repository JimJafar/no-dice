---
title: Replay viewer
---

A static Vite app at `games/salient/viewer` that loads a `salient-log/1` file by picker,
drag-and-drop or `?log=`, and replays it turn by turn: spectator view by default with a
fog-of-war toggle per seat, score bar and lead line, order arrows and fight outlines animating
in order, hatched cut-off hexes, side panels with intent, prediction, tool-call trace, troops,
Nodes held and actions used, marks for rejected submissions, passes and compactions, a
lead-by-turn chart and a one-line headline generated from the events. It reads only the log and
never imports the engine, which a module-graph test enforces from the first task.

Its first task converts the five golden logs, which are still in the prototype's shape, into
`salient-log/1` fixtures under `games/salient/viewer/fixtures/` by replaying them through the
engine; the viewer itself only ever reads the fixtures. Done when golden log 01 at turn 11
renders the spectator mock-up: scores 43 and 33, five cut-off hexes (F1, G1, H1, H2, G3, all
B's), the fight at F6, and B's fog view hiding the 27 playable hexes the fog frame shows.
