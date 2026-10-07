# MetaCity – hierarchical traffic digital twin (static web MVP)

A browser-only traffic twin at four levels: Germany (motorway statistics) > Aachen (hourly
macroscopic model) > corridor (vehicle simulation) > junction (sensor-mast view). Each level
answers rule-based questions for its user (federal planner, municipal planner, driver).
There is no backend and no LLM. Sibling of ../MetaHospital and ../MetaAgri, same conventions.

## Repo layout
- web/                 the whole MVP (static site, no build step)
  - index.html         page shell; loads d3 from cdnjs, then src/main.js
  - src/main.js        router (hash tokens), top bar, shared clock, render loop
  - src/engine/        the twin; twin.js is the facade and owns the hand-overs between levels
    - country.js       level 1: AADT statistics -> hourly load, CO2, what-ifs
    - city.js          level 2: gravity demand + MSA/BPR assignment per hour, scenarios
    - corridor.js      levels 3-4: IDM vehicles, signals, sensor masts, loop counters
    - ask.js           question catalogue per level, answers, free-text matching
  - src/ui/            views: country.js, city.js, corridor.js (canvas), ask.js (panel), dom.js
  - src/data/          germany-roads.js, aachen.js (schematic network), germany.js (states)
  - styles/            base.css (tokens + shared components), views.css
  - test/              node:test suite for the engine
  - tools/             serve.mjs (port 8090), make-artifact.mjs

## Rules
- Vanilla ES modules only, no bundler, no npm runtime dependencies; d3 is the only library.
- The engine never touches the DOM, Math.random or Date. Randomness goes through the Twin's
  seeded rng; read-only queries (questions, sensor views) must not advance it (use hashFloat).
- Views read through Twin methods and change it only via tick(), setTime(), setScenario(),
  resetScenario(), addIncident(), clearIncidents(), setMastHealth() and reset().
- Every answer states its level, data basis, resolution and confidence.
- Build markup with the `html` tagged template from dom.js; colours only through base.css tokens.
- Routes are plain hash tokens (`#germany`, `#aachen`, `#julicher`, `#julicher.j2`).
- All numbers are simulated or illustrative; sensor masts are fictional. Say so in the UI.

## Commands (from web/)
- `npm test`, `npm run serve`, `npm run artifact`

## Working style
- Small steps, ask before large refactors. Prefer simple code over clever code.
