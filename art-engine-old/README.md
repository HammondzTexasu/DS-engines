# Art Engine

Headless **art-direction intent** pro AI nástroje. Config nepopisuje komponenty ani spacing/radius tokeny; zachycuje estetické preference, rozhodovací pravidla a hranice stylu. Engine z něj deterministicky skládá guidance a review prompty pro LLM.

Playground: [`app/`](./app/). AI workflow: [`AGENTS.md`](./AGENTS.md). API: [`src/DEV.md`](./src/DEV.md).

**Nesdílí kód ani CSS s `color-engine` nebo `typo-engine`.** Ty jsou deterministické zdroje barev a typografie; Art Engine jejich tokeny pouze doporučuje používat.

## Mentální model

```text
screenshoty + brief
       │
       │ analyzuje externí AI (Cursor / Claude / …)
       ▼
engine-config.json  ← persistentní paměť vkusu
       │
       │ importEngineConfig → generateSystem (offline, bez AI/API)
       ▼
llmGuidance + generationPrompt + reviewPrompt + checklist
```

Art Engine **nevolá model**. Screenshoty čte externí AI nástroj a upraví config podle [`prompts/from-screenshots.md`](./prompts/from-screenshots.md). Stejný config vždy dává stejný guidance výstup.

## Config

- `styleProfile`: jméno a krátká formulace charakteru.
- `axes`: osm os 0–100; význam obou pólů je vždy explicitní.
- `rules`: co má AI preferovat.
- `antiRules`: kam návrh nesmí sklouznout.
- `heuristics`: preference při konkrétních designových rozhodnutích.
- `notes`: osobní nebo projektové poznámky.
- `snippets`: referenční kód; příklad, ne univerzální komponenta.
- `sourceReferences`: stručná stopa, z jakých referencí profil vznikl.

Výchozí osy: `roundedness`, `spaciousness`, `ornament`, `contrast`, `softness`, `strictness`, `playfulness`, `calmness`.

Číslo samo o sobě není dostatečný stylový popis. Proto každá osa obsahuje `meaningLow` a `meaningHigh` a bohatší nuance jsou v pravidlech, anti-pravidlech a heuristikách.

## Headless

```js
import { importEngineConfig, generateSystem } from './src/art-engine.js';

const state = importEngineConfig(json);
const {
  config,
  llmGuidance,
  critiqueChecklist,
  generationPrompt,
  reviewPrompt,
  refineConfigPrompt,
} = generateSystem(state);
```

`generateSystem` normalizuje state na místě. Persistuj `config` z návratové hodnoty.

## Co Art Engine záměrně nedělá

- negeneruje CSS tokeny ani komponenty,
- nedefinuje spacing, radius nebo shadow scales,
- neobsahuje API key ani integraci s konkrétním modelem,
- neanalyzuje screenshoty v playgroundu,
- nepřepisuje color/typo config.

Je to **stylový operační systém pro úsudek LLM**, ne třetí klasický design-token engine.
