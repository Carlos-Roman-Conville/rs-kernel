# Event inventory ? research draft, 2026-11-01

Unit 3011, for the registry keeper. This is evidence for a future registry, not an approved event contract. Only this document and `events-inventory.json` are deliverables. No code or registry files were changed.

## Scope and interpretation

Searched the available `src/`, `examples/`, `bench/` and `kernel.json` in cognition, economy, government, history, knowledge, life, realism, settlement, society and catalogue, plus Pirate web source. Searches covered emit calls, returned/reducer event literals, queue readers, type/kind comparisons and declarations; excluded node_modules and generated/vendor web bundles. Pirate had 91 non-generated JS/TS/JSX/TSX files and no emit/since/recordsSince calls. Life currently contains design material only: no src, examples, bench or kernel.json. Kernel's harness was also inspected because it supplies the actual Economy/Settlement publication bridge.

There are 50 unique names. Three rows are direct Cognition/fixture Kernel emissions. Thirty-three names are Economy/Settlement reducer variants publishable through `kernel/harness/adapters.ts:30`; configuration events already present when the adapter is created are skipped. Nine additional names are Society local host kinds (its tenth, `refused`, collides with Economy). Four Government rows are returned candidates requested for investigation, with **no emit path found**. `crisis` is a local Reality helper emission into trace records, **not a Kernel bus event**. These distinctions are in each JSON row; do not register the whole file blindly.

`producer` names the best supported registry mechanism, not the scheduler process. All non-null mechanism and quantity references were checked against the current registry and aliases were reviewed. A null producer denotes an unregistered fixture or a multi-producer ambiguity, explained in notes. `consumer_code` includes unregistered hosts/helpers; `consumers` contains only mapped mechanism IDs. History's generic observer is listed for bus-publishable events: it reads every record and hashes unmapped payloads (`history/src/observer.ts:42`). This is an available generic reader, not proof that every host attaches it. An empty consumer list does not assert that future hosts cannot subscribe.

For Kernel emissions, `cause` describes the **envelope**, not a similarly named payload field. Economy's reducer propagates optional command causes (`economy/src/reduce.ts:18`), but the harness publishes only `(type, event)` and drops the causal edge. Settlement's `shared.action.outcome` therefore has a required cause inside its payload yet an optional/missing Kernel cause. For local Society/Reality records, required cause means their local explanatory string, not an event-id edge. Government candidates have no cause field.

Payload keys describe the emitted payload: whole reducer object for Economy/Settlement, inner payload for Cognition/Society, whole returned record for Government/Reality. Strings remain strings where TS says string; branded/semantic handles use id. TS numbers remain number, even for days and counts. Nullable required fields remain required; their non-null kind is shown and nullability is documented in notes. The requested vocabulary cannot represent objects, records, unions or list-of-object elements. Such fields are explicitly listed as omitted in notes; list-of-object uses list without of. Society's open payload fields are variant-optional; this draft is not a closed validator. Field counts below count only represented keys.

Quantity/unit annotations are conservative: exact shortage fraction, price, output units, post wage and learning quantities have registry references. Omitted quantity/unit means no unambiguous scalar mapping established, not dimensionless. Government units are supplied by the host. Society transfers likewise need owner-confirmed monetary mappings.

## Inventory

| Type / local kind | Producer | Consumers | Fields | Open questions |
| --- | --- | --- | ---: | --- |
| `act` | `society.organisation.actors` | `society.institution.formation_dissolution`, `society.organisation.collective_choice` | 13 | local kind; open payload; schema cannot express full payload |
| `arrived` | `economy.trade.shipment` | `history.record.backend` | 6 | no mapped domain consumer |
| `bought` | `economy.trade.trade` | `history.record.backend` | 9 | no mapped domain consumer |
| `businessStatusChanged` | `settlement.business.staffing` | `history.record.backend` | 4 | no mapped domain consumer |
| `cognition.attribution` | `cognition.learning.attribution` | `history.record.backend` | 13 | no mapped domain consumer |
| `cognition.intention` | `cognition.decision.select` | `cognition.decision.select`, `history.record.backend` | 6 | schema cannot express full payload |
| `consumed` | `economy.consumption.demand` | `history.record.backend` | 6 | no mapped domain consumer |
| `crisis` | null | ? | 13 | local trace; multiple producers; schema cannot express full payload; no mapped domain consumer |
| `dayEnded` | `economy.infra.tick_scheduler` | `history.record.backend` | 3 | no mapped domain consumer |
| `dissolved` | `society.institution.formation_dissolution` | ? | 0 | local kind; open payload; no mapped domain consumer |
| `expelled` | `society.organisation.actors` | ? | 1 | local kind; open payload; no mapped domain consumer |
| `fixture.outcome` | null | `cognition.learning.outcome`, `cognition.learning.attribution`, `history.record.backend` | 9 | bench-only host; schema cannot express full payload |
| `fixtureChanged` | `settlement.project.layout_versions` | `history.record.backend` | 3 | no mapped domain consumer |
| `founded` | `society.institution.formation_dissolution` | `society.institution.formation_dissolution` | 4 | local kind; open payload |
| `goodDefined` | `economy.recipe.definition` | `history.record.backend` | 3 | no mapped domain consumer |
| `government.appropriation` | `government.fiscal.spending` | ? | 8 | returned only; host bridge?; no mapped domain consumer |
| `government.succession_event` | `government.succession.institutional` | ? | 4 | returned only; host bridge?; schema cannot express full payload; no mapped domain consumer |
| `government.tax_assessment` | `government.fiscal.taxation` | `government.fiscal.taxation` | 11 | returned only; host bridge?; schema cannot express full payload |
| `inventoryOpened` | `economy.inventory.holdings` | `history.record.backend` | 5 | no mapped domain consumer |
| `joined` | `society.organisation.actors` | `society.institution.formation_dissolution` | 2 | local kind; open payload |
| `leaseChanged` | `settlement.property.lease` | `history.record.backend` | 5 | no mapped domain consumer |
| `left` | `society.organisation.actors` | ? | 1 | local kind; open payload; no mapped domain consumer |
| `managerChanged` | `settlement.business.open` | `history.record.backend` | 4 | no mapped domain consumer |
| `marketGoodSet` | `economy.market.five_numbers` | `history.record.backend` | 4 | no mapped domain consumer |
| `marketOpened` | `economy.market.five_numbers` | `history.record.backend` | 5 | no mapped domain consumer |
| `merged` | `society.institution.formation_dissolution` | ? | 2 | local kind; open payload; no mapped domain consumer |
| `officeChanged` | `settlement.authority.office_powers` | `history.record.backend` | 3 | no mapped domain consumer |
| `office_changed` | `society.organisation.actors` | ? | 2 | local kind; open payload; no mapped domain consumer |
| `operatorChanged` | `settlement.business.open` | `history.record.backend` | 4 | no mapped domain consumer |
| `organisationOpened` | `economy.org.organisation` | `history.record.backend` | 4 | no mapped domain consumer |
| `parcelMerged` | `settlement.land.parcel_split_merge` | `history.record.backend` | 3 | no mapped domain consumer |
| `parcelSplit` | `settlement.land.parcel_split_merge` | `history.record.backend` | 3 | no mapped domain consumer |
| `permissionChanged` | `settlement.authority.office_powers` | `history.record.backend` | 3 | no mapped domain consumer |
| `postFilled` | `settlement.assign.workforce` | `history.record.backend` | 5 | no mapped domain consumer |
| `priceSet` | `economy.price.rule` | `history.record.backend` | 6 | no mapped domain consumer |
| `produced` | `economy.material.produce` | `history.record.backend` | 7 | no mapped domain consumer |
| `projectCompleted` | `settlement.project.construction` | `history.record.backend` | 5 | no mapped domain consumer |
| `recipeDefined` | `economy.recipe.definition` | `history.record.backend` | 3 | no mapped domain consumer |
| `refused` | null | `history.record.backend`, `society.institution.formation_dissolution` | 6 | Economy/Society collision |
| `rentPaid` | `settlement.property.lease` | `history.record.backend` | 4 | no mapped domain consumer |
| `settlement.vacate` | `government.succession.institutional` | ? | 2 | returned only; host bridge?; no mapped domain consumer |
| `shared.action.outcome` | `settlement.assign.workforce` | `history.record.backend` | 4 | schema cannot express full payload; no mapped domain consumer |
| `shipped` | `economy.trade.shipment` | `history.record.backend` | 9 | no mapped domain consumer |
| `shortage` | `economy.shortage.event` | `history.record.backend` | 7 | no mapped domain consumer |
| `sold` | `economy.trade.trade` | `history.record.backend` | 9 | no mapped domain consumer |
| `split` | `society.institution.formation_dissolution` | ? | 2 | local kind; open payload; schema cannot express full payload; no mapped domain consumer |
| `spoiled` | `economy.spoilage` | `history.record.backend` | 5 | no mapped domain consumer |
| `stockChanged` | `economy.inventory.holdings` | `history.record.backend` | 6 | no mapped domain consumer |
| `titleChanged` | `settlement.property.title_transfer` | `history.record.backend` | 6 | no mapped domain consumer |
| `wagePaid` | `settlement.wage.pay` | `history.record.backend` | 4 | no mapped domain consumer |

## Naming and unresolved consumers

- `cognition.intention` is emitted; `mind.intention` is a quantity written/read in kernel declarations, not a second emitted spelling. Do not synthesize a second contract from it.
- `shortage` is emitted (`economy/src/tick/index.ts:79`). `economy.shortage.event` is the producing mechanism, not an event name. The payload's shortage corresponds to `economy.shortage_fraction`.
- `body.crisis` is a Reality kernel quantity declaration (for example `realism/kernel.json:637`). The local helper appends `kind: "crisis"` (`realism/src/medicine.ts:209`); `realism/src/crisis.ts:53` reads trace records. No bus publication under `body.crisis` was found.
- No `body.conception` or `contact_event` producer/consumer was found in the searched source. Life has no implementation directories here. These names need evidence before registration.
- Government tax/spending/succession functions return records; succession comments propose host mappings to Settlement commands (`government/src/succession/succession.ts:103`). A comment is not an implemented subscriber. `settlement.vacate` is Government's returned resolution, while Settlement's vacate command emits `officeChanged` (`settlement/src/commands.ts:624`).
- Society uses `kind`, never a Kernel `type`, in its local organisation event log (`society/src/organisation.ts:114`). No bus namespace/adapter is established. Its literal `refused` collides with Economy's incompatible payload; one JSON row preserves uniqueness and describes both producers. `act` also has collective-choice and organisation-execution variants. Registry keeper must choose a namespaced/versioned representation before enforcing schemas.
- Society `split`, `dissolved`, `left`, `merged` are confirmed local host emissions (`society/src/formation.ts:229`, `:188`, `:214`, `:261`). Resource claims in split are data only, not evidence that Economy or Settlement consumes that event. Direct lifecycle callbacks in formation are not event subscribers.
- Society's institution classifier consumes act/founded/joined (`society/src/institution.ts:14`); formation inspects founded/joined results (`society/src/formation.ts:133`, `:219`). Local non-bus consumers are retained in the rows, not conflated with Kernel subscriptions.
- Society declarations read `life.death`, `life.departure`, `life.illness_onset` and `mind.intention`; these are declarations, with no emitted type under those spellings found here. `removePerson(person, cause)` at `society/src/organisation.ts:444` is a direct host API, not a subscription.
- Cognition dynamically accepts caller-supplied `outcomeTypes` (`cognition/src/process.ts:28`, `:74`); the hungry-pair fixture supplies only `fixture.outcome` (`cognition/bench/hungry-pair/world.ts:180`). Other strings cannot be enumerated from this API. The generic harness forwards `event.type`; its currently typed reducer unions are enumerated here.
- History's classification key is dynamically `${source}/${type}` (`history/src/classes.ts:11`). X1 acceptance accepts host-supplied departure/death/consumption/labour/intention types (`history/src/x1/acceptance.ts:68`, `:141`). These are parameterized consumers, not evidence of concrete additional emissions. No fabricated rows were added for them.
- Knowledge and Catalogue had no Kernel/host emit path in the searched directories. Their returned data/state changes are not automatically events. Kernel test-only labels (changed/tick/draw/etc.) are outside the engine/host inventory.

## No observed domain consumer

The following rows have only History's generic recording consumer or no mapped mechanism consumer. Some have fixture reporting/helper readers in `consumer_code`; ?no mapped? does not mean no read at all:

`arrived`, `bought`, `businessStatusChanged`, `cognition.attribution`, `consumed`, `crisis`, `dayEnded`, `dissolved`, `expelled`, `fixtureChanged`, `goodDefined`, `government.appropriation`, `government.succession_event`, `inventoryOpened`, `leaseChanged`, `left`, `managerChanged`, `marketGoodSet`, `marketOpened`, `merged`, `officeChanged`, `office_changed`, `operatorChanged`, `organisationOpened`, `parcelMerged`, `parcelSplit`, `permissionChanged`, `postFilled`, `priceSet`, `produced`, `projectCompleted`, `recipeDefined`, `rentPaid`, `settlement.vacate`, `shared.action.outcome`, `shipped`, `shortage`, `sold`, `split`, `spoiled`, `stockChanged`, `titleChanged`, `wagePaid`.


## Handoff

Resolve the `refused` collision, choose whether local kinds/returned candidates belong in the bus registry, add an object/nullable/union schema representation, and confirm owner mappings before copying rows into registry/events.json. In particular, do not treat schema omissions as evidence that those fields are absent. No code changes, causal-edge fixes, adapters or registry edits are part of this research unit.
