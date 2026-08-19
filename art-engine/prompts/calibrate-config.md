# Calibrate Art Engine config

Use this workflow in any multimodal AI. Attach representative screenshots, an optional written brief, and the current `config/art-config.json`.

## Task

Calibrate the supplied Art Engine config so it captures the stable art direction visible in the references and the owner's stated intent.

Return **only one complete valid JSON object** using this shape:

```json
{
  "styleProfile": {
    "name": "short-kebab-case-name",
    "summary": "A concise, standalone description of the intended visual character."
  },
  "axes": [
    {
      "name": "Human-readable dimension",
      "value": 0,
      "meaningLow": "Concrete meaning of the low pole",
      "meaningHigh": "Concrete meaning of the high pole",
      "confidence": "low",
      "snippets": [
        {
          "language": "css",
          "code": "Canonical implementation reference",
          "note": "Optional scope or usage constraint"
        }
      ]
    }
  ],
  "rules": ["Observable cross-task preference."],
  "antiRules": ["Concrete style drift to avoid."],
  "heuristics": ["Decision rule for choosing between valid solutions."]
}
```

`confidence` is optional and may only be `low`, `medium`, or `high`. `snippets` is optional, belongs to one axis, and may contain up to 8 overrides. Each override requires non-empty `code`; `language` defaults to `text` and `note` is optional.

## Calibration rules

1. Treat all screenshots as evidence from one product unless the user says otherwise.
2. Written owner intent wins when it deliberately asks to move away from the references. Otherwise, screenshots are the visual evidence.
3. Infer repeated, stable traits; do not turn one local component accident into a global rule.
4. Preserve useful existing config intent unless the new evidence clearly contradicts it.
5. Axes are free-form. Keep, rename, add, reorder, or remove them when that creates a clearer and less redundant description.
6. Every axis must describe one meaningful continuum, have explicit low/high poles, and use a value from 0 to 100.
7. Prefer a small set of independent axes over many overlapping dimensions. Do not add an axis when a rule or heuristic is clearer.
8. Use `axes[].snippets` only as concrete reference overrides for that dimension, such as canonical elevation or radius implementations for different scopes. Each `note` must state important scope or exceptions.
9. Preserve supplied canonical snippets. Do not infer implementation code from screenshots or invent snippets, components, token scales, or a parallel color/typography system unless the owner explicitly requests that code.
10. Use rules for broad preferences, antiRules for likely drift, and heuristics for choices between multiple valid solutions.
11. Make every sentence useful without access to the screenshots. Avoid empty adjectives such as “modern”, “clean”, or “premium” without observable meaning.
12. Do not embed screenshots, URLs, base64, analysis prose, or Markdown fences in the result.
13. Return the full config, not a patch and not an explanation.
