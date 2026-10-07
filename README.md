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

## Run it

```bash
cd web
npm test          # engine tests (node:test, no dependencies)
npm run serve     # http://127.0.0.1:8090
```

No build step and no npm dependencies. d3 is loaded from cdnjs. Pushing to `main` runs the
tests and deploys `web/` to GitHub Pages.

## Honesty notes

Everything is simulated. Motorway volumes are illustrative, in the order of magnitude of the
federal counting stations but not copied from them. The Aachen network is schematic, with
real street names, approximate positions and rounded population and job figures. Sensor masts
and their sites are fictional.

## Inspiration and next steps

- Roadside sensor infrastructure and collective perception (RWTH ika: RITA, ACCorD, karl.):
  the junction level is a small, simulated version of that idea.
- Synthetic Street Scenes / StreetPrompt: rare street events. Next, a video classifier on the
  masts could raise the incidents that are now triggered by hand.
- BoundlessNYC: procedural 3D cities in the browser. Next, a three.js street view for
  levels 3 and 4.
- Real data: BASt permanent counts for level 1, OpenStreetMap and city traffic counts for
  level 2, real detector feeds for level 3.
