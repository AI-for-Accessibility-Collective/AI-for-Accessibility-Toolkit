# the v8 variant grid - surface-labels-golds

36 cells over v6's design knobs, every cell the same equation with one
combination of the open design answers. MAPPING/LABELS INHERIT THEIR OWN
STATUS (see the labels file). 242 rows, 985 missed the label join; care-rate joined for 156 rows.

Reading rule, fixed before the grid ran: a cell becomes a candidate only by
winning on BOTH the gold set and the behavioral labels. A win on authored
labels alone is the circularity trap and promotes nothing.

| cell | F1 sighted | F1 screen reader | acc S | acc SR |
|---|---|---|---|---|
| sev:on approve:0.3 select:0.3 care:off **best** | 1.000 | 0.964 | 100.0% | 96.7% |
| sev:on approve:0.3 select:0.3 care:pe | 1.000 | 0.973 | 100.0% | 97.5% |
| sev:on approve:0.3 select:0.5 care:off | 1.000 | 0.964 | 100.0% | 96.7% |
| sev:on approve:0.3 select:0.5 care:pe | 1.000 | 0.973 | 100.0% | 97.5% |
| sev:on approve:0.3 select:0.7 care:off | 1.000 | 0.964 | 100.0% | 96.7% |
| sev:on approve:0.3 select:0.7 care:pe | 1.000 | 0.973 | 100.0% | 97.5% |
| sev:on approve:0.6 select:0.3 care:off | 1.000 | 0.964 | 100.0% | 96.7% |
| sev:on approve:0.6 select:0.3 care:pe | 1.000 | 0.973 | 100.0% | 97.5% |
| sev:on approve:0.6 select:0.5 care:off (shipped v6) | 1.000 | 0.964 | 100.0% | 96.7% |
| sev:on approve:0.6 select:0.5 care:pe | 1.000 | 0.973 | 100.0% | 97.5% |
| sev:on approve:0.6 select:0.7 care:off | 1.000 | 0.964 | 100.0% | 96.7% |
| sev:on approve:0.6 select:0.7 care:pe | 1.000 | 0.973 | 100.0% | 97.5% |
| sev:on approve:0.8 select:0.3 care:off | 1.000 | 0.964 | 100.0% | 96.7% |
| sev:on approve:0.8 select:0.3 care:pe | 1.000 | 0.973 | 100.0% | 97.5% |
| sev:on approve:0.8 select:0.5 care:off | 1.000 | 0.964 | 100.0% | 96.7% |
| sev:on approve:0.8 select:0.5 care:pe | 1.000 | 0.973 | 100.0% | 97.5% |
| sev:on approve:0.8 select:0.7 care:off | 1.000 | 0.964 | 100.0% | 96.7% |
| sev:on approve:0.8 select:0.7 care:pe | 1.000 | 0.973 | 100.0% | 97.5% |
| sev:off approve:0.3 select:0.3 care:off | 1.000 | 0.964 | 100.0% | 96.7% |
| sev:off approve:0.3 select:0.3 care:pe | 1.000 | 0.973 | 100.0% | 97.5% |
| sev:off approve:0.3 select:0.5 care:off | 1.000 | 0.964 | 100.0% | 96.7% |
| sev:off approve:0.3 select:0.5 care:pe | 1.000 | 0.973 | 100.0% | 97.5% |
| sev:off approve:0.3 select:0.7 care:off | 1.000 | 0.964 | 100.0% | 96.7% |
| sev:off approve:0.3 select:0.7 care:pe | 1.000 | 0.973 | 100.0% | 97.5% |
| sev:off approve:0.6 select:0.3 care:off | 1.000 | 0.964 | 100.0% | 96.7% |
| sev:off approve:0.6 select:0.3 care:pe | 1.000 | 0.973 | 100.0% | 97.5% |
| sev:off approve:0.6 select:0.5 care:off | 1.000 | 0.964 | 100.0% | 96.7% |
| sev:off approve:0.6 select:0.5 care:pe | 1.000 | 0.973 | 100.0% | 97.5% |
| sev:off approve:0.6 select:0.7 care:off | 1.000 | 0.964 | 100.0% | 96.7% |
| sev:off approve:0.6 select:0.7 care:pe | 1.000 | 0.973 | 100.0% | 97.5% |
| sev:off approve:0.8 select:0.3 care:off | 1.000 | 0.964 | 100.0% | 96.7% |
| sev:off approve:0.8 select:0.3 care:pe | 1.000 | 0.973 | 100.0% | 97.5% |
| sev:off approve:0.8 select:0.5 care:off | 1.000 | 0.964 | 100.0% | 96.7% |
| sev:off approve:0.8 select:0.5 care:pe | 1.000 | 0.973 | 100.0% | 97.5% |
| sev:off approve:0.8 select:0.7 care:off | 1.000 | 0.964 | 100.0% | 96.7% |
| sev:off approve:0.8 select:0.7 care:pe | 1.000 | 0.973 | 100.0% | 97.5% |

best cell: sev:on approve:0.3 select:0.3 care:off (F1 1.000 / 0.964); shipped v6 cell: 1.000 / 0.964.
