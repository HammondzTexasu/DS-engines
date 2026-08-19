# AGENTS.md — Art Engine (AI workflow)

> Pro Cursor, Claude a další AI agenty.  
> Produktová specifikace: [`README.md`](./README.md). API: [`src/DEV.md`](./src/DEV.md).  
> **Nesahej na `color-engine/` ani `typo-engine/`.** Art Engine s nimi nesdílí kód ani UI.

## Role agenta

Jsi **kurátor art-direction intentu**. Ze screenshotů, briefu a zpětné vazby upravuješ JSON config; headless engine pak deterministicky vytvoří guidance pro další designovou práci.

Nejsi autor komponentové knihovny ani spacing/radius token systému.

## Zdroj pravdy

```text
reference + owner intent
          │ externí multimodální AI
          ▼
config/engine-config.json
          │ importEngineConfig → generateSystem
          ▼
guidance / prompts / critique checklist
```

- Config = persistentní estetický intent.
- Guidance = generovaný textový výstup.
- Screenshoty = vstup pro externí AI, ne runtime dependency.
- Stejný config = stejný výstup.

## Kanonický workflow: reference → profil

1. Přečti aktuální `config/engine-config.json`.
2. Přečti `prompts/from-screenshots.md`.
3. Analyzuj všechny přiložené screenshoty jako jednu službu:
   - odděl stabilní styl od jednorázového řešení,
   - popiš opakující se preference,
   - označ nejistotu přes `confidence`,
   - nedělej z jednotlivé komponenty globální pravidlo bez opakovaného důkazu.
4. Aktualizuj **celý** config, ne jen osy:
   - `styleProfile`,
   - `axes`,
   - `rules`,
   - `antiRules`,
   - `heuristics`,
   - případně `notes`, `snippets`, `sourceReferences`.
5. Prožeň config přes `importEngineConfig` a `generateSystem`.
6. Persistuj `config` z návratové hodnoty.
7. Zkontroluj `llmGuidance` a `critiqueChecklist`.

## Kanonický workflow: ladění

Při zpětné vazbě typu „je to moc měkké / card-heavy / marketingové“:

1. Nejprve uprav nejkonkrétnější vrstvu:
   - konkrétní zákaz → `antiRules`,
   - rozhodovací preference → `heuristics`,
   - obecná zásada → `rules`,
   - kontinuální charakter → `axes`,
   - jednorázová výjimka → `notes` nebo `snippets`.
2. Neměň více os automaticky kvůli jedné větě.
3. Regeneruj guidance.
4. Ověř změnu na reálném návrhu přes `reviewPrompt`.

## Význam configu

### Osy

Hodnota je 0–100. Oba póly musí mít konkrétní význam. Osa není token:

- `roundedness: 80` neznamená „vše pill“,
- `spaciousness: 80` neznamená „všude obří padding“,
- `ornament: 10` neznamená „bez jakékoliv vizuální identity“.

Interakce os vysvětlují pravidla a heuristiky.

### Rules / antiRules / heuristics

- `rules`: principy, které platí napříč úkoly.
- `antiRules`: typické driftování, kterému se má AI vyhnout.
- `heuristics`: jak volit mezi více validními řešeními.

Piš pozorovatelně a akčně. „Elegantní“ je slabé; „preferuj povrchový kontrast a border před mlhavým shadow“ je silné.

### Snippets

Snippet je explicitní reference pro konkrétní situaci. Není důkazem, že má AI vytvářet komponentový systém nebo použít stejnou hodnotu všude.

## Hard boundaries

Bez výslovného požadavku:

- nevytvářej CSS tokeny, komponenty ani design-system primitives,
- nepřidávej API integraci, model SDK, API key nebo upload screenshotů,
- neměň `src/art-engine.js` ani `app/*` při běžném ladění profilu,
- neměň `color-engine/` nebo `typo-engine/`,
- nekopíruj jejich tokeny do art configu,
- nepersistuj screenshoty automaticky do configu; stačí stručné `sourceReferences`.

## Headless použití

```js
import {
  importEngineConfig,
  generateSystem,
} from './src/art-engine.js';

const state = importEngineConfig(configJson);
const result = generateSystem(state);

// Persistuj result.config.
// Použij result.generationPrompt při tvorbě.
// Použij result.reviewPrompt při kontrole.
```

## Checklist

- [ ] Config je validní JSON.
- [ ] Všechny osy jsou přítomné a 0–100.
- [ ] Pravidla jsou konkrétní a neodporují si.
- [ ] Anti-pravidla popisují skutečný drift, ne obecné fráze.
- [ ] Profil nevytváří paralelní color/typo/token systém.
- [ ] `generateSystem` proběhl a normalizovaný config je uložený.
- [ ] Guidance odpovídá záměru i po přečtení bez screenshotů.

## Freeze

Art Engine 1.0 je headless formatter a normalizátor. Běžná práce = edit configu + generate. Runtime kód měň jen na explicitní žádost uživatele.
