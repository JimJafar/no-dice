---
title: Replay viewer
---

A static Vite app that loads a `salient-log/1` file by picker, drag-and-drop or `?log=`,
and replays it turn by turn: spectator view by default with a fog-of-war toggle per seat,
score bar and lead line, order arrows and fight outlines animating in order, hatched
cut-off hexes, side panels with intent, prediction, tool-call trace, troops, Nodes held and
actions used, marks for rejected submissions, passes and compactions, a lead-by-turn chart
and a one-line headline generated from the events. It reads only the log and never imports
the engine. Done when golden log 01 at turn 11 renders the spectator mock-up: scores 43 and
33, five cut-off hexes, the fight at F6. Tasks are written once milestone 02 is reviewed.
