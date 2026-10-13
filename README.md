# MetaCity

A hierarchical traffic digital twin that runs entirely in the browser. It shows the same
traffic at four levels, each with the detail it can afford, and answers the questions of
the people who work at that level.

| Level | What it is | Data and model | Resolution | Who asks |
|---|---|---|---|---|
| 1 · Germany | Motorway network | Annual average daily traffic (AADT) per segment, spread over a typical weekday | Segment (40–300 km), hour | Federal transport planner |
| 2 · Aachen | City road network | Hourly macroscopic model: gravity demand from population and jobs, assigned with volume-delay functions | Street link (1–8 km), hour | Municipal traffic planner |
| 3 · Corridor | Jülicher Straße, campus corridor | Vehicle-by-vehicle simulation (Intelligent Driver Model, fixed-time signals, two lanes per direction) | Each vehicle, 0.5 s | Driver |
| 4 · Junction | One signal and its roadside sensor mast | What the mast detects (with sensor noise), queues, signal phase | Each vehicle, live | Driver, operator |

## How the levels talk to each other

- **Down:** the motorway volumes from Germany become the traffic entering Aachen at its
  gateways (A4, A44). Aachen's hourly link flows become the inflows and turning flows of the
  street simulations. A planner's scenario (closure, bus lane, 30 km/h zone, less demand)
  flows all the way down to the vehicles.
- **Up:** loop counters on the simulated corridors count vehicles. The city level compares
  them with its own model ("How well does the model match the street sensors?"). Where
  queues spill back, the sensors see less traffic than the model expects.
- **Across:** drivers' "should I leave now?" combines the street level (measured now) with
  the city level (how the day develops).

## Ask the twin

Every level has a question box. It offers suggested questions and also matches typed
questions. Answers are rule-based (no LLM) and computed from the models. Each one states
which level and data it comes from, and how precise it is.

- **Federal planner:** most congested corridors, freight, CO2, traffic growth, trucks to
  rail, speed limit, how Aachen connects.
- **Municipal planner:** bottlenecks by hour, road closures, bus lanes, a 30 km/h zone, less
  car traffic, commuters and through traffic, daily km and CO2, peak hour, model vs. sensors.
  What-if answers can be applied to the whole twin.
- **Driver:** travel time now, when the light turns green (with a speed advice, GLOSA),
  queue length, incidents ahead, leave now or later.

On the street you can also cause rare events: block a lane, or tamper with a sensor mast.
The twin then has to *perceive* them: each mast runs a prompt-defined event classifier and
connected vehicles send hazard warnings; together they raise alerts an operator confirms or
dismisses. Drivers' answers use only what the twin perceives.

**Ask Claude (optional).** Paste your own Anthropic API key and Claude answers in plain language,
combining levels. It gets the question catalogue of every level as tools, so every number still
comes from the twin; it cannot change the twin. The key stays in your browser.

**3D junction.** The junction level has a three.js view with three cameras: orbit, the sensor
mast's own view, and a driver following a connected vehicle with its green-light advice.

## Run it

```bash
cd web
npm test          # engine tests (node:test, no dependencies)
npm run data      # refresh real data from BASt and OpenStreetMap
npm run serve     # http://127.0.0.1:8090
```

No build step and no npm dependencies. d3 is loaded from cdnjs. Pushing to `main` runs the
tests and deploys `web/` to GitHub Pages.

## What is real and what is simulated

| Data | Status | Source |
|---|---|---|
| Motorway volumes, truck shares, lanes (Germany level) | **Measured** on 37 of 41 segments | BASt automatic counting stations, 2020–2024, aggregated per segment |
| Aachen motorway gateways | **Measured** where a station sits at the gateway | BASt (AC-Vetschau, AK Aachen (O), AC-Lichtenbusch) |
| Street lanes and speed limits (Aachen level) | **Real** for 28 of 31 street links | © OpenStreetMap contributors, ODbL |
| Population and jobs per district | Illustrative (rounded) | – |
| Hourly flows, vehicles, queues, sensor masts, detections | Simulated | – |

The Aachen question "How does the model compare with real motorway counts?" checks the city
model against the BASt stations around Aachen (currently about 12% off on average). Refresh the
real data with `npm run data`; see `web/src/data/real/SOURCES.md` for sources and terms.

## Inspiration and next steps

- Roadside sensor infrastructure and collective perception (RWTH ika: RITA, ACCorD, karl.):
  the junction level is a small, simulated version of that idea.
- Synthetic Street Scenes / StreetPrompt: rare street events and prompt-defined classifiers;
  the masts' event detection imitates that (simulated, no video).
- BoundlessNYC: procedural 3D cities in the browser; the 3D junction view borrows the idea.
- More real data: district population and jobs (Aachen statistics), city traffic counts for
  the arterials, and real detector feeds for the street level when they become available.
