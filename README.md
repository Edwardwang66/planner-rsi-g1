# Project page

Static page for the planner-RSI project: https://edwardwang66.github.io/planner-rsi-g1/ . No build step.

- `index.html`: the page.
- `demos.js`, `demos.css`: the four interactive demos in the "Try it" section.
- `assets/`: figures copied from the project outputs, and the final report PDF.
- `data/replays/`: logged physics attempts, one file per world (5 Hz pose tracks, selections, outcomes).
- `data/options.json`: the 15 options with their nominal paths and up to eight measured executions each, at friction 1.2 and 0.3.
- `data/regimes.json`: pass rates of 40 random 9-option libraries under each tested condition.

The data files are exported from the experiment logs by two scripts kept with the experiments
(`site_export_replays.py` and `site_export_demo_data.py`).

The planner in demo 2 is a simplified one written for the page. It is not the controller or the evaluator
behind the reported numbers.

Preview locally:

```
python -m http.server 8765 --directory site
```
