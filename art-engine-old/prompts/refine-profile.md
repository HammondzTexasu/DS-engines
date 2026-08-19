# Refine an existing profile

Attach:

- current `engine-config.json`,
- the design/output that felt wrong,
- owner feedback,
- optionally reference screenshots.

## Prompt

Calibrate the existing Art Engine config from the attached output and feedback.

Return **only the full valid JSON config** with the same schema.

- Translate concrete feedback to the narrowest correct layer:
  - continuous character → axis,
  - global principle → rule,
  - forbidden drift → antiRule,
  - choice between valid solutions → heuristic,
  - local exception → note/snippet.
- Do not move several axes because of one local issue.
- Preserve unrelated, deliberate intent.
- Make rules observable and actionable; avoid empty adjectives.
- Do not introduce components or token scales.
- Keep all known axes and values 0–100.
- Record uncertainty with confidence.

The Art Engine will generate guidance after import; do not replace the config with prose.
