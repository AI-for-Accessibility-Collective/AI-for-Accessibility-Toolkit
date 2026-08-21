# the v8 variant grid - surface-labels

36 cells over v6's design knobs, every cell the same equation with one
combination of the open design answers. MAPPING/LABELS INHERIT THEIR OWN
STATUS (see the labels file). 1227 rows; care-rate joined for 1099 rows.

Reading rule, fixed before the grid ran: a cell becomes a candidate only by
winning on BOTH the gold set and the behavioral labels. A win on authored
labels alone is the circularity trap and promotes nothing.

| cell | F1 sighted | F1 screen reader | acc S | acc SR |
|---|---|---|---|---|
| sev:on approve:0.3 select:0.3 care:off **best** | 0.975 | 0.960 | 97.1% | 96.0% |
| sev:on approve:0.3 select:0.5 care:off | 0.975 | 0.960 | 97.1% | 96.0% |
| sev:on approve:0.3 select:0.7 care:off | 0.975 | 0.960 | 97.1% | 96.0% |
| sev:on approve:0.6 select:0.3 care:off | 0.975 | 0.960 | 97.1% | 96.0% |
| sev:on approve:0.6 select:0.5 care:off (shipped v6) | 0.975 | 0.960 | 97.1% | 96.0% |
| sev:on approve:0.6 select:0.7 care:off | 0.975 | 0.960 | 97.1% | 96.0% |
| sev:on approve:0.8 select:0.3 care:off | 0.975 | 0.960 | 97.1% | 96.0% |
| sev:on approve:0.8 select:0.5 care:off | 0.975 | 0.960 | 97.1% | 96.0% |
| sev:on approve:0.8 select:0.7 care:off | 0.975 | 0.960 | 97.1% | 96.0% |
| sev:off approve:0.3 select:0.3 care:off | 0.975 | 0.960 | 97.1% | 96.0% |
| sev:off approve:0.3 select:0.3 care:pe | 0.975 | 0.962 | 97.1% | 96.2% |
| sev:off approve:0.3 select:0.5 care:off | 0.975 | 0.960 | 97.1% | 96.0% |
| sev:off approve:0.3 select:0.5 care:pe | 0.975 | 0.962 | 97.1% | 96.2% |
| sev:off approve:0.3 select:0.7 care:off | 0.975 | 0.960 | 97.1% | 96.0% |
| sev:off approve:0.6 select:0.3 care:off | 0.975 | 0.960 | 97.1% | 96.0% |
| sev:off approve:0.6 select:0.3 care:pe | 0.975 | 0.962 | 97.1% | 96.2% |
| sev:off approve:0.6 select:0.5 care:off | 0.975 | 0.960 | 97.1% | 96.0% |
| sev:off approve:0.6 select:0.5 care:pe | 0.975 | 0.962 | 97.1% | 96.2% |
| sev:off approve:0.6 select:0.7 care:off | 0.975 | 0.960 | 97.1% | 96.0% |
| sev:off approve:0.8 select:0.3 care:off | 0.975 | 0.960 | 97.1% | 96.0% |
| sev:off approve:0.8 select:0.5 care:off | 0.975 | 0.960 | 97.1% | 96.0% |
| sev:off approve:0.8 select:0.7 care:off | 0.975 | 0.960 | 97.1% | 96.0% |
| sev:on approve:0.3 select:0.3 care:pe | 0.974 | 0.961 | 96.9% | 96.0% |
| sev:on approve:0.3 select:0.5 care:pe | 0.974 | 0.961 | 96.9% | 96.0% |
| sev:on approve:0.3 select:0.7 care:pe | 0.974 | 0.961 | 96.9% | 96.0% |
| sev:on approve:0.6 select:0.3 care:pe | 0.974 | 0.961 | 96.9% | 96.0% |
| sev:on approve:0.6 select:0.5 care:pe | 0.974 | 0.961 | 96.9% | 96.0% |
| sev:on approve:0.6 select:0.7 care:pe | 0.974 | 0.961 | 96.9% | 96.0% |
| sev:off approve:0.3 select:0.7 care:pe | 0.974 | 0.961 | 96.9% | 96.0% |
| sev:off approve:0.6 select:0.7 care:pe | 0.974 | 0.961 | 96.9% | 96.0% |
| sev:off approve:0.8 select:0.3 care:pe | 0.971 | 0.958 | 96.6% | 95.7% |
| sev:off approve:0.8 select:0.5 care:pe | 0.971 | 0.958 | 96.6% | 95.7% |
| sev:on approve:0.8 select:0.3 care:pe | 0.969 | 0.956 | 96.4% | 95.5% |
| sev:on approve:0.8 select:0.5 care:pe | 0.969 | 0.956 | 96.4% | 95.5% |
| sev:on approve:0.8 select:0.7 care:pe | 0.969 | 0.956 | 96.4% | 95.5% |
| sev:off approve:0.8 select:0.7 care:pe | 0.969 | 0.956 | 96.4% | 95.5% |

best cell: sev:on approve:0.3 select:0.3 care:off (F1 0.975 / 0.960); shipped v6 cell: 0.975 / 0.960.
