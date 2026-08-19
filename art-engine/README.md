# Art Engine

Headless **art-direction intent engine** pro libovolné AI. Config zachycuje estetický záměr a engine z něj deterministicky vytvoří jeden prompt použitelný při návrhu, implementaci i hodnocení UI.

Playground: [`app/`](./app/). AI workflow: [`AGENTS.md`](./AGENTS.md). API: [`src/DEV.md`](./src/DEV.md).

Art Engine nevolá model ani neanalyzuje obrázky. Kalibraci screenshotů a popisu provádí externí multimodální AI podle [`prompts/calibrate-config.md`](./prompts/calibrate-config.md).

## Mentální model

```text
screenshoty + popis
        │ externí multimodální AI
        ▼
engine-config.json       ← zdroj pravdy
        │ importEngineConfig → generatePrompt
        ▼
jeden art-direction prompt
        │ prompts/apply-art.md
        ▼
návrh / implementace / kontrola UI
```

## Config

- `styleProfile`: krátký název a shrnutí charakteru.
- `axes`: libovolné stylové dimenze 0–100; každá má vlastní název, význam obou pólů a volitelné `snippets` jako reference override.
- `rules`: co má AI preferovat.
- `antiRules`: kam návrh nesmí sklouznout.
- `heuristics`: jak rozhodovat mezi více validními řešeními.

Osy nejsou povinný fixní slovník. Playground umožňuje osy přidávat, přejmenovat a mazat. Výchozí osy v `engine-config.json` jsou pouze editovatelný start. Snippety patří ke konkrétní dimenzi (např. elevation nebo radius), nefungují jako globální komponenta ani nový tokenový systém.

## Headless API

```js
import { importEngineConfig, generateSystem } from './src/art-engine.js';

const state = importEngineConfig(configJson);
const { config, prompt } = generateSystem(state);
```

Po změně intentu persistuj normalizovaný `config` a regeneruj `prompt`.

## Playground

- jeden vycentrovaný sloupec: profil, samostatné stylové dimenze s volitelným reference override a pravidla,
- dole collapsed **Engine config** a **Art direction prompt** (náhled, Import/Download/Copy podle panelu).

Playground ukládá pouze do paměti prohlížeče. Download je explicitní export na disk. Refresh stránky znovu načte `config/engine-config.json`.

## Co Art Engine nedělá

- negeneruje CSS tokeny ani komponenty,
- nedefinuje spacing, radius nebo shadow scale,
- neobsahuje API key ani integraci s konkrétním modelem,
- nepřepisuje Color Engine ani Typo Engine,
- nevytváří zvláštní generation/review prompty — jeden prompt slouží pro oba účely.
