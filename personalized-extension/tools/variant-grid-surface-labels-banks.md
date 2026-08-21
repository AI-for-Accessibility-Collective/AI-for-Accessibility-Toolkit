# the v8 variant grid - surface-labels-banks

36 cells over v6's design knobs, every cell the same equation with one
combination of the open design answers. MAPPING/LABELS INHERIT THEIR OWN
STATUS (see the labels file). 985 rows, 242 missed the label join; care-rate joined for 943 rows.

Reading rule, fixed before the grid ran: a cell becomes a candidate only by
winning on BOTH the gold set and the behavioral labels. A win on authored
labels alone is the circularity trap and promotes nothing.

| cell | F1 sighted | F1 screen reader | acc S | acc SR |
|---|---|---|---|---|
| sev:on approve:0.3 select:0.3 care:off **best** | 0.969 | 0.960 | 96.3% | 95.8% |
| sev:on approve:0.3 select:0.5 care:off | 0.969 | 0.960 | 96.3% | 95.8% |
| sev:on approve:0.3 select:0.7 care:off | 0.969 | 0.960 | 96.3% | 95.8% |
| sev:on approve:0.6 select:0.3 care:off | 0.969 | 0.960 | 96.3% | 95.8% |
| sev:on approve:0.6 select:0.5 care:off (shipped v6) | 0.969 | 0.960 | 96.3% | 95.8% |
| sev:on approve:0.6 select:0.7 care:off | 0.969 | 0.960 | 96.3% | 95.8% |
| sev:on approve:0.8 select:0.3 care:off | 0.969 | 0.960 | 96.3% | 95.8% |
| sev:on approve:0.8 select:0.5 care:off | 0.969 | 0.960 | 96.3% | 95.8% |
| sev:on approve:0.8 select:0.7 care:off | 0.969 | 0.960 | 96.3% | 95.8% |
| sev:off approve:0.3 select:0.3 care:off | 0.969 | 0.960 | 96.3% | 95.8% |
| sev:off approve:0.3 select:0.3 care:pe | 0.969 | 0.960 | 96.3% | 95.8% |
| sev:off approve:0.3 select:0.5 care:off | 0.969 | 0.960 | 96.3% | 95.8% |
| sev:off approve:0.3 select:0.5 care:pe | 0.969 | 0.960 | 96.3% | 95.8% |
| sev:off approve:0.3 select:0.7 care:off | 0.969 | 0.960 | 96.3% | 95.8% |
| sev:off approve:0.6 select:0.3 care:off | 0.969 | 0.960 | 96.3% | 95.8% |
| sev:off approve:0.6 select:0.3 care:pe | 0.969 | 0.960 | 96.3% | 95.8% |
| sev:off approve:0.6 select:0.5 care:off | 0.969 | 0.960 | 96.3% | 95.8% |
| sev:off approve:0.6 select:0.5 care:pe | 0.969 | 0.960 | 96.3% | 95.8% |
| sev:off approve:0.6 select:0.7 care:off | 0.969 | 0.960 | 96.3% | 95.8% |
| sev:off approve:0.8 select:0.3 care:off | 0.969 | 0.960 | 96.3% | 95.8% |
| sev:off approve:0.8 select:0.5 care:off | 0.969 | 0.960 | 96.3% | 95.8% |
| sev:off approve:0.8 select:0.7 care:off | 0.969 | 0.960 | 96.3% | 95.8% |
| sev:on approve:0.3 select:0.3 care:pe | 0.967 | 0.959 | 96.1% | 95.6% |
| sev:on approve:0.3 select:0.5 care:pe | 0.967 | 0.959 | 96.1% | 95.6% |
| sev:on approve:0.3 select:0.7 care:pe | 0.967 | 0.959 | 96.1% | 95.6% |
| sev:on approve:0.6 select:0.3 care:pe | 0.967 | 0.959 | 96.1% | 95.6% |
| sev:on approve:0.6 select:0.5 care:pe | 0.967 | 0.959 | 96.1% | 95.6% |
| sev:on approve:0.6 select:0.7 care:pe | 0.967 | 0.959 | 96.1% | 95.6% |
| sev:off approve:0.3 select:0.7 care:pe | 0.967 | 0.959 | 96.1% | 95.6% |
| sev:off approve:0.6 select:0.7 care:pe | 0.967 | 0.959 | 96.1% | 95.6% |
| sev:off approve:0.8 select:0.3 care:pe | 0.964 | 0.955 | 95.7% | 95.2% |
| sev:off approve:0.8 select:0.5 care:pe | 0.964 | 0.955 | 95.7% | 95.2% |
| sev:on approve:0.8 select:0.3 care:pe | 0.962 | 0.954 | 95.5% | 95.0% |
| sev:on approve:0.8 select:0.5 care:pe | 0.962 | 0.954 | 95.5% | 95.0% |
| sev:on approve:0.8 select:0.7 care:pe | 0.962 | 0.954 | 95.5% | 95.0% |
| sev:off approve:0.8 select:0.7 care:pe | 0.962 | 0.954 | 95.5% | 95.0% |

best cell: sev:on approve:0.3 select:0.3 care:off (F1 0.969 / 0.960); shipped v6 cell: 0.969 / 0.960.
