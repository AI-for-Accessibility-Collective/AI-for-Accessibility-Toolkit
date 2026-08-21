# the v8 variant grid - behavioral-eval-labels

36 cells over v6's design knobs, every cell the same equation with one
combination of the open design answers. MAPPING/LABELS INHERIT THEIR OWN
STATUS (see the labels file). 285 rows, 942 missed the label join; care-rate joined for 285 rows.

Reading rule, fixed before the grid ran: a cell becomes a candidate only by
winning on BOTH the gold set and the behavioral labels. A win on authored
labels alone is the circularity trap and promotes nothing.

| cell | F1 sighted | F1 screen reader | acc S | acc SR |
|---|---|---|---|---|
| sev:on approve:0.3 select:0.3 care:off **best** | 0.457 | 0.447 | 53.7% | 52.6% |
| sev:on approve:0.3 select:0.5 care:off | 0.457 | 0.447 | 53.7% | 52.6% |
| sev:on approve:0.3 select:0.7 care:off | 0.457 | 0.447 | 53.7% | 52.6% |
| sev:on approve:0.6 select:0.3 care:off | 0.457 | 0.447 | 53.7% | 52.6% |
| sev:on approve:0.6 select:0.5 care:off (shipped v6) | 0.457 | 0.447 | 53.7% | 52.6% |
| sev:on approve:0.6 select:0.7 care:off | 0.457 | 0.447 | 53.7% | 52.6% |
| sev:on approve:0.8 select:0.3 care:off | 0.457 | 0.447 | 53.7% | 52.6% |
| sev:on approve:0.8 select:0.5 care:off | 0.457 | 0.447 | 53.7% | 52.6% |
| sev:on approve:0.8 select:0.7 care:off | 0.457 | 0.447 | 53.7% | 52.6% |
| sev:off approve:0.3 select:0.3 care:off | 0.457 | 0.447 | 53.7% | 52.6% |
| sev:off approve:0.3 select:0.3 care:pe | 0.457 | 0.448 | 53.7% | 52.6% |
| sev:off approve:0.3 select:0.5 care:off | 0.457 | 0.447 | 53.7% | 52.6% |
| sev:off approve:0.3 select:0.5 care:pe | 0.457 | 0.448 | 53.7% | 52.6% |
| sev:off approve:0.3 select:0.7 care:off | 0.457 | 0.447 | 53.7% | 52.6% |
| sev:off approve:0.6 select:0.3 care:off | 0.457 | 0.447 | 53.7% | 52.6% |
| sev:off approve:0.6 select:0.3 care:pe | 0.457 | 0.448 | 53.7% | 52.6% |
| sev:off approve:0.6 select:0.5 care:off | 0.457 | 0.447 | 53.7% | 52.6% |
| sev:off approve:0.6 select:0.5 care:pe | 0.457 | 0.448 | 53.7% | 52.6% |
| sev:off approve:0.6 select:0.7 care:off | 0.457 | 0.447 | 53.7% | 52.6% |
| sev:off approve:0.8 select:0.3 care:off | 0.457 | 0.447 | 53.7% | 52.6% |
| sev:off approve:0.8 select:0.5 care:off | 0.457 | 0.447 | 53.7% | 52.6% |
| sev:off approve:0.8 select:0.7 care:off | 0.457 | 0.447 | 53.7% | 52.6% |
| sev:on approve:0.3 select:0.3 care:pe | 0.453 | 0.443 | 53.0% | 51.9% |
| sev:on approve:0.3 select:0.5 care:pe | 0.453 | 0.443 | 53.0% | 51.9% |
| sev:on approve:0.3 select:0.7 care:pe | 0.453 | 0.443 | 53.0% | 51.9% |
| sev:on approve:0.6 select:0.3 care:pe | 0.453 | 0.443 | 53.0% | 51.9% |
| sev:on approve:0.6 select:0.5 care:pe | 0.453 | 0.443 | 53.0% | 51.9% |
| sev:on approve:0.6 select:0.7 care:pe | 0.453 | 0.443 | 53.0% | 51.9% |
| sev:off approve:0.3 select:0.7 care:pe | 0.453 | 0.443 | 53.0% | 51.9% |
| sev:off approve:0.6 select:0.7 care:pe | 0.453 | 0.443 | 53.0% | 51.9% |
| sev:off approve:0.8 select:0.3 care:pe | 0.450 | 0.441 | 52.6% | 51.6% |
| sev:off approve:0.8 select:0.5 care:pe | 0.450 | 0.441 | 52.6% | 51.6% |
| sev:on approve:0.8 select:0.3 care:pe | 0.446 | 0.436 | 51.9% | 50.9% |
| sev:on approve:0.8 select:0.5 care:pe | 0.446 | 0.436 | 51.9% | 50.9% |
| sev:on approve:0.8 select:0.7 care:pe | 0.446 | 0.436 | 51.9% | 50.9% |
| sev:off approve:0.8 select:0.7 care:pe | 0.446 | 0.436 | 51.9% | 50.9% |

best cell: sev:on approve:0.3 select:0.3 care:off (F1 0.457 / 0.447); shipped v6 cell: 0.457 / 0.447.
