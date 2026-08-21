# the v8 variant grid - dgold-labels

36 cells over v6's design knobs, every cell the same equation with one
combination of the open design answers. MAPPING/LABELS INHERIT THEIR OWN
STATUS (see the labels file). 265 rows, 962 missed the label join; care-rate joined for 238 rows.

Reading rule, fixed before the grid ran: a cell becomes a candidate only by
winning on BOTH the gold set and the behavioral labels. A win on authored
labels alone is the circularity trap and promotes nothing.

| cell | F1 sighted | F1 screen reader | acc S | acc SR |
|---|---|---|---|---|
| sev:on approve:0.8 select:0.3 care:pe **best** | 0.500 | 0.473 | 53.6% | 50.2% |
| sev:on approve:0.8 select:0.5 care:pe | 0.500 | 0.473 | 53.6% | 50.2% |
| sev:on approve:0.8 select:0.7 care:pe | 0.500 | 0.473 | 53.6% | 50.2% |
| sev:off approve:0.8 select:0.3 care:pe | 0.500 | 0.473 | 53.6% | 50.2% |
| sev:off approve:0.8 select:0.5 care:pe | 0.500 | 0.473 | 53.6% | 50.2% |
| sev:off approve:0.8 select:0.7 care:pe | 0.500 | 0.473 | 53.6% | 50.2% |
| sev:on approve:0.3 select:0.3 care:off | 0.491 | 0.461 | 53.2% | 49.4% |
| sev:on approve:0.3 select:0.3 care:pe | 0.491 | 0.464 | 53.2% | 49.8% |
| sev:on approve:0.3 select:0.5 care:off | 0.491 | 0.461 | 53.2% | 49.4% |
| sev:on approve:0.3 select:0.5 care:pe | 0.491 | 0.464 | 53.2% | 49.8% |
| sev:on approve:0.3 select:0.7 care:off | 0.491 | 0.461 | 53.2% | 49.4% |
| sev:on approve:0.3 select:0.7 care:pe | 0.491 | 0.464 | 53.2% | 49.8% |
| sev:on approve:0.6 select:0.3 care:off | 0.491 | 0.461 | 53.2% | 49.4% |
| sev:on approve:0.6 select:0.3 care:pe | 0.491 | 0.464 | 53.2% | 49.8% |
| sev:on approve:0.6 select:0.5 care:off (shipped v6) | 0.491 | 0.461 | 53.2% | 49.4% |
| sev:on approve:0.6 select:0.5 care:pe | 0.491 | 0.464 | 53.2% | 49.8% |
| sev:on approve:0.6 select:0.7 care:off | 0.491 | 0.461 | 53.2% | 49.4% |
| sev:on approve:0.6 select:0.7 care:pe | 0.491 | 0.464 | 53.2% | 49.8% |
| sev:on approve:0.8 select:0.3 care:off | 0.491 | 0.461 | 53.2% | 49.4% |
| sev:on approve:0.8 select:0.5 care:off | 0.491 | 0.461 | 53.2% | 49.4% |
| sev:on approve:0.8 select:0.7 care:off | 0.491 | 0.461 | 53.2% | 49.4% |
| sev:off approve:0.3 select:0.3 care:off | 0.491 | 0.461 | 53.2% | 49.4% |
| sev:off approve:0.3 select:0.3 care:pe | 0.491 | 0.464 | 53.2% | 49.8% |
| sev:off approve:0.3 select:0.5 care:off | 0.491 | 0.461 | 53.2% | 49.4% |
| sev:off approve:0.3 select:0.5 care:pe | 0.491 | 0.464 | 53.2% | 49.8% |
| sev:off approve:0.3 select:0.7 care:off | 0.491 | 0.461 | 53.2% | 49.4% |
| sev:off approve:0.3 select:0.7 care:pe | 0.491 | 0.464 | 53.2% | 49.8% |
| sev:off approve:0.6 select:0.3 care:off | 0.491 | 0.461 | 53.2% | 49.4% |
| sev:off approve:0.6 select:0.3 care:pe | 0.491 | 0.464 | 53.2% | 49.8% |
| sev:off approve:0.6 select:0.5 care:off | 0.491 | 0.461 | 53.2% | 49.4% |
| sev:off approve:0.6 select:0.5 care:pe | 0.491 | 0.464 | 53.2% | 49.8% |
| sev:off approve:0.6 select:0.7 care:off | 0.491 | 0.461 | 53.2% | 49.4% |
| sev:off approve:0.6 select:0.7 care:pe | 0.491 | 0.464 | 53.2% | 49.8% |
| sev:off approve:0.8 select:0.3 care:off | 0.491 | 0.461 | 53.2% | 49.4% |
| sev:off approve:0.8 select:0.5 care:off | 0.491 | 0.461 | 53.2% | 49.4% |
| sev:off approve:0.8 select:0.7 care:off | 0.491 | 0.461 | 53.2% | 49.4% |

best cell: sev:on approve:0.8 select:0.3 care:pe (F1 0.500 / 0.473); shipped v6 cell: 0.491 / 0.461.
