# AGENTS.md — DS Engines (začni tady)

> **Pro AI agenty (Cursor, Claude, Codex, …).**  
> Tento soubor je **první zastávka**. Detaily workflow jsou v `AGENTS.md` každého enginu — **přečti jen ten, který právě potřebuješ**.  
> Lidské specifikace: `README.md` u každého enginu. API: `src/DEV.md`.

---

## Co je DS Engines

Tři headless enginy pro design systém. Každý má:

- `config/{color|typo|art}-config.json` — zdroj pravdy (intent)
- `src/*-engine.js` — deterministický engine (**neměň** bez výslovného requestu)
- `app/` — volitelný playground (vizuální kontrola)

| Potřebuješ… | Engine | AGENTS | Výstup |
| :--- | :--- | :--- | :--- |
| Barvy, palety, stavy | **Color Engine** | [`color-engine/AGENTS.md`](color-engine/AGENTS.md) | CSS tokeny (`--…`) |
| Typografie + ikony | **Typo Engine** | [`typo-engine/AGENTS.md`](typo-engine/AGENTS.md) | CSS tokeny (`--typo-*`) + font/icon URL |
| Art direction (vizuální záměr UI) | **Art Engine** | [`art-engine/AGENTS.md`](art-engine/AGENTS.md) | jeden art-direction prompt |

**Rozdělení:** Color = čísla barev. Typo = metriky textu a ikon. Art = estetický záměr (osy, pravidla) — **negeneruje** color/typo tokeny.

Playground v tomto repu: [`index.html`](index.html) → Color / Typo / Art Engine.

**Neodkazuj** na `art-engine-old/` — archiv.

---

## Když uživatel řekne „použij tyto enginy na projekt“

1. Najdi, **odkud se engine importuje** (git submodule, npm, relativní cesta k tomuto repu).
2. V projektu vytvoř / najdi **config + výstupy** (viz layout níže).
3. Pro každý engine: edituj **jen config** → `importEngineConfig` → `generateSystem()` → přepiš výstup.
4. Při UI práci použij **color + typo tokeny + art-direction prompt**. Nevymýšlej paralelní tokenové systémy.

Pokud cesta k enginu chybí, **zeptej se** — neforkuj logiku copy-pastem `src/`.

---

## Doporučený layout ve spotřebitelském projektu

```text
consumer-project/
├── design-tokens/
│   ├── color-config.json          → generuj colors.css
│   ├── typo-config.json           → generuj typo.css
│   └── (font/icon linky z typo generate)
├── design-intent/
│   ├── art-config.json            → generuj art-direction.md
│   └── art-direction.md
└── (DS Engines repo — submodule / dependency; NEkopíruj src/)
```

Konkrétní názvy souborů se mohou lišit; drž intent (config) a vygenerovaný výstup oddělené.

---

## Společná pravidla (všechny enginy)

1. **Config = intent.** Po změně vždy regenerate a zapiš normalizovaný config + výstup.
2. **Engine kód neměň** (default) — orchestruj config a výstupy.
3. **Neforkuj** engine do projektu copy-pastem `src/`.
4. Playground **nepersistuje** session na disk. Refresh znovu načte config svého enginu (`color-config.json`, `typo-config.json` nebo `art-config.json`).
5. Color, typo a art se **nesahají navzájem** „mimochodem“. Odděl práci.

---

## Kam dál

| Úkol | Kam jít |
| :--- | :--- |
| Kalibrace barev, brand, palety | [`color-engine/AGENTS.md`](color-engine/AGENTS.md) |
| Škála textu, font, ikony | [`typo-engine/AGENTS.md`](typo-engine/AGENTS.md) |
| Art direction ze screenshotů / tune profilu | [`art-engine/AGENTS.md`](art-engine/AGENTS.md) + [`art-engine/prompts/calibrate-config.md`](art-engine/prompts/calibrate-config.md) |
| Implementace / kontrola UI podle art direction | [`art-engine/prompts/apply-art.md`](art-engine/prompts/apply-art.md) |

---

## Rychlá karta (TL;DR)

```text
1. Colors  → color-engine/AGENTS.md  → config + CSS tokens
2. Type/icons → typo-engine/AGENTS.md → config + CSS tokens + font/icon URLs
3. Art direction → art-engine/AGENTS.md → config + one prompt
4. Edit config only → generateSystem → write outputs
5. Do not copy src/; do not mix color/typo/art engines
6. Ignore art-engine-old/
```

---

*DS Engines — AI orchestration router. Engine code is frozen unless the user explicitly requests engine changes.*
