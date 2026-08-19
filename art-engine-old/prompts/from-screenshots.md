# Profile from screenshots

Use this workflow in an external multimodal AI tool (Cursor, Claude, etc.). Attach representative screenshots and provide the current `config/engine-config.json`.

## Prompt

Analyze the attached screenshots as one product/service and calibrate the supplied Art Engine config.

Return **only the complete valid JSON config**. Keep the existing schema.

Requirements:

1. Infer stable, repeated art-direction traits — not one-off component accidents.
2. Update all eight axes (`value` 0–100). Keep their IDs and explicit pole meanings.
3. Add `confidence: low|medium|high` where evidence is uncertain.
4. Rewrite `styleProfile.summary` so it remains useful without the screenshots.
5. Write concrete:
   - `rules` (cross-task principles),
   - `antiRules` (likely style drift),
   - `heuristics` (preferences between multiple valid solutions).
6. Use `notes` for owner-specific nuance and `snippets` only when a supplied implementation is genuinely canonical.
7. Add short `sourceReferences` labels/notes; do not embed images or base64.
8. Do **not** create spacing/radius scales, component APIs, CSS tokens, or a parallel color/typography system.
9. Preserve deliberate existing rules unless the references clearly contradict them.
10. If screenshots conflict, describe the stable shared character and lower confidence; do not average everything into generic UI.

After returning JSON, the local headless Art Engine will normalize it and compile deterministic guidance. Do not write the final guidance yourself.
