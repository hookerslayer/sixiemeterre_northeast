// Deterministic rules shared by the military map, army planner and turn engine.
// Terrain and positions are supplied by the caller so this module does not
// assume geographic data that is not currently present in the database.
import { buildStaticModifiers, modifierValue } from './modifierSystem.js';

export const BASE_COMMAND_POINTS = 1000;
export const BASE_ACTION_POINTS = 100;
export const RIVER_CROSSING_ACTION_POINTS = 10;
export const MILITARY_TERRAIN = Object.freeze({
  plain: { direct: 10, diagonal: 14 },
  hill: { direct: 15, diagonal: 21 },
  forest: { direct: 15, diagonal: 21 },
  marsh: { direct: 20, diagonal: 28 },
  bridge: { direct: 10, diagonal: 14 },
  water: { direct: Infinity, diagonal: Infinity }
});

export const LAND_UNIT_PROFILES = Object.freeze({
  'Пешие ратники': { mobility: 1, strike: 3, defense: 3, role: 'infantry' },
  'Копейщики': { mobility: 1, strike: 3, defense: 4, role: 'infantry' },
  'Лучники': { mobility: 1, strike: 3, defense: 2, role: 'ranged' },
  'Арбалетчики': { mobility: 1, strike: 4, defense: 2, role: 'ranged' },
  'Конные копейщики': { mobility: 1.25, strike: 4, defense: 3, role: 'cavalry' },
  'Лёгкая конница': { mobility: 1.4, strike: 3, defense: 2, role: 'cavalry' },
  'Конные лучники': { mobility: 1.4, strike: 3, defense: 2, role: 'cavalry' },
  'Лыжники-разведчики': { mobility: 1, strike: 2, defense: 2, role: 'scout' }
});
// Special hostile unit from the summer infected-horde rules. Kept separate
// from the recruitable roster so players cannot hire or levy infected troops.
export const SPECIAL_LAND_UNIT_PROFILES = Object.freeze({
  'Заражённый': { mobility: 1, strike: 1.5, defense: 1.5, role: 'infected' }
});

export const LAND_COMBAT_PHASES = Object.freeze({
  first: {
    name: 'Первое столкновение', intensity: 0.04, lossCap: 0.12,
    factors: {
      'Пешие ратники': 1, 'Копейщики': 1,
      'Лыжники-разведчики': 1,
      'Лучники': { ranged: 1.25, melee: 0.5 },
      'Арбалетчики': { ranged: 1.5, melee: 0.5 },
      'Конные копейщики': { charge: 1.25, ordinary: 0.5 },
      'Лёгкая конница': { flank: 1, ordinary: 0.75 },
      'Конные лучники': { ranged: 1, melee: 0.5 },
      'Заражённый': 1
    }
  },
  break: {
    name: 'Перелом боя', intensity: 0.06, lossCap: 0.15,
    factors: {
      'Пешие ратники': 1, 'Копейщики': 1,
      'Лыжники-разведчики': 1,
      'Лучники': 0.5, 'Арбалетчики': 0.5,
      'Конные копейщики': 0.75, 'Лёгкая конница': { flank: 1, ordinary: 0.75 },
      'Конные лучники': { ranged: 0.75, melee: 0.5 },
      'Заражённый': 1
    }
  },
  pursuit: {
    name: 'Исход и преследование', intensity: 0, lossCap: 0,
    factors: {
      'Пешие ратники': 0.5, 'Копейщики': 0.5,
      'Лучники': 0.25, 'Арбалетчики': 0.25,
      'Конные копейщики': { pursuit: 1.25, ordinary: 0.5 },
      'Лёгкая конница': { pursuit: 1.5, ordinary: 0.5 },
      'Конные лучники': { pursuit: 1, ordinary: 0.5 },
      'Лыжники-разведчики': 0.5,
      'Заражённый': 0.5
    }
  }
});

export const LAND_TACTICS = Object.freeze({
  none: 'Без особой тактики',
  hold: 'Удержание позиции',
  archery: 'Стрелковое изматывание',
  cavalry_alarm: 'Конная тревога',
  focused_strike: 'Сосредоточенный удар',
  flank: 'Обход фланга',
  reserve: 'Резервный контрудар',
  ambush: 'Засада',
  tight_formation: 'Сомкнутый строй',
  feigned_retreat: 'Притворное отступление'
});

const LAND_TERRAIN_COMBAT = Object.freeze({
  plain: { defender: 1, attacker: 1 },
  hill: { defender: 1.15, attacker: 0.9, cavalry: 0.75 },
  forest: { defender: 1.1, attacker: 0.9, cavalry: 0.5 },
  marsh: { defender: 1.1, attacker: 0.75, cavalry: 0.5 },
  bridge: { defender: 1.15, attacker: 0.75, cavalry: 0.5 }
});

const SIEGE_LOAD = Object.freeze({
  'Малая пушка / пищаль': 10, 'Требюше': 20, 'Бомбарда': 20,
  'Таран': 30, 'Осадная башня': 30
});
export const SHIP_COMMAND_LOAD = Object.freeze({ Ушкуй: 100, Насад: 200, Ладья: 200, Когг: 300, Хольк: 400 });
export const NAVAL_SHIP_PROFILES = Object.freeze({
  'Ушкуй': { crew: 6, maneuver: 5, hull: 2, capacity: 18, hullUpkeep: 0.25 },
  'Насад': { crew: 12, maneuver: 2, hull: 4, capacity: 36, hullUpkeep: 0.5 },
  'Ладья': { crew: 20, maneuver: 3, hull: 3, capacity: 25, hullUpkeep: 0.75 },
  'Когг': { crew: 20, maneuver: 2, hull: 4, capacity: 50, hullUpkeep: 1.25 },
  'Хольк': { crew: 30, maneuver: 1, hull: 5, capacity: 70, hullUpkeep: 1.75 }
});
export const NAVAL_WEAPONS = Object.freeze({ none: 'Без вооружения', deck: 'Палубное метательное оружие', light_gun: 'Лёгкое корабельное орудие' });

export const SIEGE_WORK_THRESHOLDS = Object.freeze({
  0: { weaken: 20, breach: 40 },
  1: { weaken: 20, breach: 40 },
  2: { weaken: 35, breach: 70 },
  3: { weaken: 50, breach: 100 }
});

export function siegeFortificationState(level = 0, works = 0) {
  const thresholds = SIEGE_WORK_THRESHOLDS[Math.floor(clamp(level, 0, 3))] || SIEGE_WORK_THRESHOLDS[0];
  const progress = clamp(works, 0, 100);
  if (progress >= thresholds.breach) return 'breached';
  if (progress >= thresholds.weaken) return 'weakened';
  return 'intact';
}

export function siegeAssaultModifiers({ level = 0, works = 0, route = 'ladders' } = {}) {
  const state = siegeFortificationState(level, works);
  const attack = {
    ladders: 0.75,
    tower: 0.9,
    breach: state === 'breached' ? 1 : 0,
    ram: state === 'breached' ? 1 : 0.85
  }[route] || 0;
  if (!attack) throw new Error('Этот путь штурма неприменим к текущему состоянию укреплений.');
  const intactBonus = ({ 1: 0.2, 2: 0.3, 3: 0.4 })[Math.floor(clamp(level, 0, 3))] || 0;
  const defenseRetention = state === 'intact' ? 1 : state === 'weakened' ? 0.6 : 0.25;
  return { state, attackMultiplier: attack, defenseMultiplier: 1 + intactBonus * defenseRetention };
}

export function calculateSiegeWorkGain({ method = 'bombardment', siegeEquipment = {}, engineering = 0, infantry = 0, suitableGround = false, supplied = true, equipmentReady = true } = {}) {
  const rank = clamp(engineering, 0, 5);
  let base = 0;
  if (!supplied) return 0;
  if (method === 'bombardment' && equipmentReady) {
    const power = { 'Малая пушка / пищаль': 8, 'Требюше': 12, 'Бомбарда': 16 };
    base = Object.entries(siegeEquipment).reduce((sum, [name, count]) => sum + (power[name] || 0) * integer(count), 0);
  } else if (method === 'sapping' && suitableGround && integer(infantry) >= 20 && rank >= 2) base = 10;
  return Math.min(30, base * (1 + 0.1 * rank));
}

export function resolveSiegeSeason({ level = 0, works = 0, attackerAction = 'blockade', defenderAction = 'defend', workGain = 0, engineering = 0, repairMaterials = false } = {}) {
  let progress = clamp(works, 0, 100);
  if (attackerAction === 'works') progress = Math.min(100, progress + clamp(workGain, 0, 30));
  let repaired = false;
  if (defenderAction === 'repair' && repairMaterials && siegeFortificationState(level, progress) !== 'intact') {
    const previousState = siegeFortificationState(level, progress);
    progress = Math.max(0, progress - Math.min(30, 20 + 2 * clamp(engineering, 0, 5)));
    repaired = siegeFortificationState(level, progress) !== previousState;
  }
  return { works: progress, state: siegeFortificationState(level, progress), repaired, surrendered: defenderAction === 'surrender', assault: attackerAction === 'assault', sortie: defenderAction === 'sortie' };
}

// Recruitment and seasonal upkeep values from the player rules.
export const LEVY_RULES = Object.freeze({
  aristocracy: { label: 'Служилые землевладельцы', yardsPerFighter: 2, unitClass: 'cavalry' },
  burghers: { label: 'Горожане', yardsPerFighter: 10, unitClass: 'foot', settlementsOnly: true },
  peasants: { label: 'Крестьянство волостей', yardsPerFighter: 20, unitClass: 'foot', provincesOnly: true }
});
export const LEVY_COSTS = Object.freeze({
  foot: { treasury: 0.5, arms: 0.05, cloth: 0.025 },
  cavalry: { treasury: 1, arms: 0.1, cloth: 0.05 }
});
export const SEASONAL_UPKEEP = Object.freeze({
  treasury: 0.25, food: 0.25, cloth: 0.025, cavalryGrain: 0.25, winterFuel: 0.125
});
export const MILITARY_ROUTE_CAPACITY = Object.freeze({ land: 800, river: 2400, lake: 2400, sea: 4000 });

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
const integer = value => Math.max(0, Math.floor(Number(value) || 0));

export function commanderCapacity(skillLevel = 0) {
  return BASE_COMMAND_POINTS * (1 + clamp(skillLevel, 0, 5) * 0.1);
}

export function commandLoadEfficiency(load, capacity = BASE_COMMAND_POINTS) {
  return Math.min(1, Math.max(0, Number(capacity) || 0) / Math.max(1, Number(load) || 0));
}

export function calculateLandCommandLoad(unitGroups = [], siegeEquipment = {}) {
  const troops = unitGroups.reduce((sum, group) => sum + integer(group.count), 0);
  const equipment = Object.entries(siegeEquipment).reduce((sum, [name, count]) => sum + (SIEGE_LOAD[name] || 0) * integer(count), 0);
  return { troops, equipment, total: troops + equipment };
}

export function calculateFleetCommandLoad(ships = {}) {
  return Object.entries(ships).reduce((sum, [name, count]) => sum + (SHIP_COMMAND_LOAD[name] || 0) * integer(count), 0);
}

export function calculateArmySupplyPoints(unitGroups = [], season = '', overCapacityGarrison = false) {
  const people = unitGroups.reduce((sum, group) => sum + integer(group.count), 0);
  const cavalry = unitGroups.reduce((sum, group) => sum + (LAND_UNIT_PROFILES[group.type]?.role === 'cavalry' ? integer(group.count) : 0), 0);
  // The rule defines one point as a full infantry ration. Cavalry adds an
  // equal-sized grain ration; winter fuel is half an infantry ration by volume.
  const perSeason = people + cavalry + (season === 'Зима' ? people * 0.5 : 0);
  return perSeason * (overCapacityGarrison ? 3 : 1);
}

export function calculateSeasonalRouteCapacity(segments = [], season = '') {
  if (!segments.length) return 0;
  const factors = {
    land: { 'Зима': 0.75, 'Весна': 0.5, 'Лето': 1, 'Осень': 0.75 },
    water: { 'Зима': 0, 'Весна': 0.5, 'Лето': 1, 'Осень': 0.75 }
  };
  const limits = segments.map(segment => {
    if (segment.blocked || segment.permitted === false) return 0;
    if (segment.type === 'land') return MILITARY_ROUTE_CAPACITY.land * (factors.land[season] ?? 1);
    const base = MILITARY_ROUTE_CAPACITY[segment.type];
    return base === undefined ? 0 : base * (factors.water[season] ?? 1);
  });
  return Math.min(...limits);
}

export function allocateSupplyCapacity(armies = [], capacity = 0) {
  const demands = armies.map(army => Math.max(0, Number(army.supplyDemand) || 0));
  const totalDemand = demands.reduce((sum, demand) => sum + demand, 0);
  const available = Math.max(0, Number(capacity) || 0);
  return armies.map((army, index) => {
    const demand = demands[index];
    const delivered = Math.min(demand, totalDemand ? available * demand / totalDemand : 0);
    return { armyId: army.id, demand, delivered, coverage: demand ? delivered / demand : 1 };
  });
}

export function calculateLevyCapacity(yards, levyKind, extraordinary = false) {
  const rule = LEVY_RULES[levyKind];
  if (!rule) throw new Error('Неизвестный источник набора.');
  const divisor = rule.yardsPerFighter / (extraordinary ? 2 : 1);
  return Math.floor(Math.max(0, Number(yards) || 0) / divisor);
}

export function calculateRecruitmentCost(count, unitClass, extraordinary = false) {
  const amount = integer(count);
  const rate = LEVY_COSTS[unitClass];
  if (!rate) throw new Error('Неизвестная категория войск.');
  return {
    treasury: amount * rate.treasury * (extraordinary ? 2 : 1),
    arms: amount * rate.arms,
    cloth: amount * rate.cloth
  };
}

export function calculateSeasonalUpkeep(unitGroups = [], season = '') {
  const totals = unitGroups.reduce((result, group) => {
    const count = integer(group.count);
    result.fighters += count;
    if (LAND_UNIT_PROFILES[group.type]?.role === 'cavalry') result.cavalry += count;
    const rate = group.serviceType === 'mercenary' ? 2 : group.serviceType === 'permanent' ? 1 : SEASONAL_UPKEEP.treasury;
    result.treasury += count * rate;
    return result;
  }, { fighters: 0, cavalry: 0, treasury: 0 });
  return {
    fighters: totals.fighters,
    cavalry: totals.cavalry,
    treasury: totals.treasury,
    food: totals.fighters * SEASONAL_UPKEEP.food,
    cloth: totals.fighters * SEASONAL_UPKEEP.cloth,
    grain: totals.cavalry * SEASONAL_UPKEEP.cavalryGrain,
    fuel: season === 'Зима' ? totals.fighters * SEASONAL_UPKEEP.winterFuel : 0
  };
}

export function resolveSeasonalArmyMaintenance({ army, available = {}, season = '', mayRest = false, overCapacityGarrison = false, upkeepModifierPct = 0, supplyModifierPct = 0, moraleChangeModifier = 0 } = {}) {
  if (!army) throw new Error('Армия не задана.');
  const costs = calculateSeasonalUpkeep(army.units || [], season);
  const upkeepFactor = Math.max(0, 1 + Number(upkeepModifierPct || 0) / 100);
  const supplyFactor = Math.max(0, 1 + Number(supplyModifierPct || 0) / 100);
  for (const key of ['treasury','food','cloth','grain','fuel']) costs[key] *= upkeepFactor * (key === 'treasury' ? 1 : supplyFactor);
  const multiplier = overCapacityGarrison ? 3 : 1;
  for (const key of Object.keys(costs)) if (key !== 'fighters' && key !== 'cavalry') costs[key] *= multiplier;
  const coverage = Object.entries(costs).filter(([key, required]) => !['fighters','cavalry'].includes(key) && required > 0)
    .reduce((minimum, [key, required]) => Math.min(minimum, Math.max(0, Number(available[key]) || 0) / required), 1);
  const shortfall = 1 - Math.min(1, coverage);
  const previousShortageTurns = Math.max(0, integer(army.underfundedTurns));
  const underfundedTurns = shortfall > 0 ? previousShortageTurns + 1 : 0;
  const deserterCarry = Math.max(0, Number(army.deserterCarry) || 0);
  const unitTotal = (army.units || []).reduce((sum, group) => sum + integer(group.count), 0);
  const exactDesertion = underfundedTurns >= 2 ? unitTotal * 0.05 * shortfall + deserterCarry : 0;
  let deserters = Math.floor(exactDesertion);
  let nextDeserterCarry = exactDesertion - deserters;
  const unitLosses = (army.units || []).map((group, index) => ({ index, type: group.type, count: integer(group.count), loss: 0, fraction: 0 }));
  if (deserters > 0 && unitTotal > 0) {
    unitLosses.forEach(group => {
      const exact = deserters * group.count / unitTotal;
      group.loss = Math.floor(exact);
      group.fraction = exact - group.loss;
    });
    let left = deserters - unitLosses.reduce((sum, group) => sum + group.loss, 0);
    unitLosses.sort((a, b) => b.fraction - a.fraction || a.index - b.index);
    for (const group of unitLosses) {
      if (left <= 0) break;
      if (group.loss < group.count) { group.loss++; left--; }
    }
    unitLosses.sort((a, b) => a.index - b.index);
  }
  const remaining = Math.max(0, unitTotal - deserters);
  if (remaining === 0) nextDeserterCarry = 0;
  const morale = clamp((Number(army.morale) || 0) + (shortfall > 0 ? -10 * shortfall : 5 + (mayRest ? 5 : 0)) + Number(moraleChangeModifier || 0), 0, 100);
  return {
    costs,
    coverage: Math.max(0, Math.min(1, coverage)),
    shortfall,
    underfundedTurns,
    deserters,
    unitLosses: unitLosses.map(({ index, type, loss }) => ({ index, type, loss })),
    deserterCarry: nextDeserterCarry,
    morale,
    moraleChange: morale - clamp(army.morale, 0, 100)
  };
}

export function calculateNonCombatLosses(count, location) {
  const rates = { settlement: 0.001, camp: 0.0025, field: 0.005 };
  const rate = rates[location];
  if (rate === undefined) throw new Error('Неизвестное место размещения войск.');
  // Return fractional expected losses; the persistent army record must carry
  // the fraction between seasons instead of rounding small forces to zero.
  return integer(count) * rate;
}

export function applyFractionalAttrition(count, carry = 0, location = 'field') {
  const expected = calculateNonCombatLosses(count, location) + Math.max(0, Math.min(0.999999, Number(carry) || 0));
  const losses = Math.min(integer(count), Math.floor(expected));
  return { losses, remaining: integer(count) - losses, carry: expected - losses };
}

const RATION_ITEMS = Object.freeze({
  food: [['resource', 'Зерно'], ['resource', 'Скот'], ['resource', 'Морепродукты'], ['resource', 'Мёд и Воск']],
  grain: [['resource', 'Зерно']],
  cloth: [['good', 'Сукно и Одежда']],
  fuel: [['good', 'Топливо'], ['resource', 'Древесина']]
});

function adjacencyHas(adjacency, a, b) {
  const neighbors = adjacency instanceof Map ? adjacency.get(Number(a)) : adjacency?.[a];
  return neighbors instanceof Set ? neighbors.has(Number(b)) || neighbors.has(String(b))
    : Array.isArray(neighbors) ? neighbors.some(value => Number(value) === Number(b)) : false;
}

function stateTerrain(force, terrainCells) {
  if (force.cell_x == null || force.cell_y == null) return 'plain';
  const cell = terrainCells instanceof Map ? terrainCells.get(`${force.cell_x},${force.cell_y}`)
    : Array.isArray(terrainCells) ? terrainCells.find(row => Number(row.cell_x) === Number(force.cell_x) && Number(row.cell_y) === Number(force.cell_y)) : null;
  return cell?.terrain || 'plain';
}

function buildMilitaryWaterLinks({ riverComponents, lakeComponents, seaComponents } = {}, markers = [], provincesById = new Map(), season = '') {
  const links = new Map();
  const seasonal = { 'Зима': 0, 'Весна': 0.5, 'Лето': 1, 'Осень': 0.75 }[season] ?? 1;
  for (const [mode, components, capacity] of [
    ['river', riverComponents, MILITARY_ROUTE_CAPACITY.river],
    ['lake', lakeComponents, MILITARY_ROUTE_CAPACITY.lake],
    ['sea', seaComponents, MILITARY_ROUTE_CAPACITY.sea]
  ]) {
    const provincesByComponent = new Map();
    for (const marker of markers) {
      const component = components?.get(Number(marker.id))?.component;
      const province = provincesById.get(Number(marker.province_id));
      if (!component || !province || marker.owner !== province.owner || province.occupied_by || marker.type === 'ruins') continue;
      if (!provincesByComponent.has(component)) provincesByComponent.set(component, new Set());
      provincesByComponent.get(component).add(Number(province.id));
    }
    const seasonalCapacity = mode === 'sea' ? capacity : capacity * seasonal;
    if (seasonalCapacity <= 0) continue;
    for (const [component, idsSet] of provincesByComponent) {
      const ids = [...idsSet];
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
        const low = Math.min(ids[i], ids[j]), high = Math.max(ids[i], ids[j]);
        const key = `water:${mode}:${component}:${low}:${high}`;
        const edge = { key, type: mode, capacity: seasonalCapacity };
        if (!links.has(low)) links.set(low, []);
        if (!links.has(high)) links.set(high, []);
        links.get(low).push({ ...edge, to: high });
        links.get(high).push({ ...edge, to: low });
      }
    }
  }
  return links;
}

function routeToMilitarySource(targetProvince, sourceProvince, owner, provincesById, adjacency, season, waterLinks = new Map()) {
  if (Number(targetProvince) === Number(sourceProvince)) return { capacity: Infinity, edges: [] };
  const factor = { 'Зима': 0.75, 'Весна': 0.5, 'Лето': 1, 'Осень': 0.75 }[season] ?? 1;
  const queue = [[Number(targetProvince), []]], visited = new Set([Number(targetProvince)]);
  while (queue.length) {
    const [current, edges] = queue.shift();
    const nextEdges = [];
    for (const next of provincesById.keys()) {
      const province = provincesById.get(next);
      if (visited.has(next) || province?.owner !== owner || province?.occupied_by || !adjacencyHas(adjacency, current, next)) continue;
      const low = Math.min(current, next), high = Math.max(current, next);
      nextEdges.push({ to: next, key: `land:${low}:${high}`, type: 'land', capacity: MILITARY_ROUTE_CAPACITY.land * factor });
    }
    nextEdges.push(...(waterLinks.get(current) || []).filter(edge => provincesById.get(edge.to)?.owner === owner && !provincesById.get(edge.to)?.occupied_by));
    nextEdges.sort((a, b) => b.capacity - a.capacity || a.to - b.to);
    for (const edge of nextEdges) {
      const path = [...edges, edge];
      if (edge.to === Number(sourceProvince)) return { capacity: Math.min(...path.map(item => item.capacity)), edges: path };
      visited.add(edge.to); queue.push([edge.to, path]);
    }
  }
  return null;
}

/** Resolve seasonal army upkeep from reachable, state-owned settlement stores. */
export function simulateMilitaryMaintenance({ forces = [], fleets = [], ports = [], structures = [], provinces = [], markers = [], inventories = [], mechanics = [], modifiers = [], adjacency = new Map(), terrainCells = null, epidemicProvinceIds = [], waterNetworks = {}, calendar = {} } = {}) {
  const nextInventories = inventories.map(row => ({ ...row, quantity: Number(row.quantity) || 0 }));
  const provincesById = new Map(provinces.map(row => [Number(row.id), row]));
  const markerById = new Map(markers.map(row => [Number(row.id), row]));
  const epidemicProvinces = new Set(epidemicProvinceIds.map(Number));
  const waterLinks = buildMilitaryWaterLinks(waterNetworks, markers, provincesById, calendar.season);
  const modifierRowsByOwner = new Map();
  const modifiersFor = owner => {
    if (!modifierRowsByOwner.has(owner)) {
      const settings = mechanics.find(row => row.owner === owner)?.settings || {};
      const turn = Number(calendar.turn) || 1;
      const active = modifiers.filter(row => row.owner === owner && row.status === 'active'
        && Number(row.starts_turn || 1) <= turn && (row.ends_turn == null || Number(row.ends_turn) >= turn));
      modifierRowsByOwner.set(owner, [...buildStaticModifiers(owner, settings), ...active]);
    }
    return modifierRowsByOwner.get(owner);
  };
  const forceModifier = (force, key) => modifierValue(modifiersFor(force.owner), key, {
    army: String(force.id), territory_type: force.force_kind === 'fleet' || Array.isArray(force.ships) ? 'fleet' : 'army'
  });
  const militaryCostFactor = force => Math.max(0, 1 + forceModifier(force, 'military_upkeep_pct') / 100);
  const supplyUseFactor = force => Math.max(0, 1 + forceModifier(force, 'supply_consumption_pct') / 100);
  const supplyCapacityFactor = force => Math.max(0, 1 + forceModifier(force, 'supply_capacity_pct') / 100);
  const inventoryAt = (markerId, type, name) => nextInventories.find(row => Number(row.marker_id) === Number(markerId) && row.item_type === type && row.item_name === name);
  const forceUpdates = [], fleetUpdates = [], treasuryAdjustments = {}, reports = {};
  const active = forces.filter(force => force.status === 'active'
    && !['Лагерь наёмников', 'Лагерь разбойников', 'Буйствующие'].includes(force.owner)).map(force => {
    const units = Array.isArray(force.unit_groups) ? force.unit_groups : [];
    const garrisonCount = units.reduce((sum, group) => sum + integer(group.count), 0);
    const overCapacityGarrison = force.force_kind === 'garrison'
      && (Boolean(force.over_capacity) || (!force.marker_id && garrisonCount > 20));
    const costs = calculateSeasonalUpkeep(units, calendar.season);
    if (force.is_mercenary) costs.treasury += 2; // The hired commander is paid alongside the troop group.
    const upkeepFactor = militaryCostFactor(force), supplyFactor = supplyUseFactor(force);
    for (const key of ['treasury','food','cloth','grain','fuel']) costs[key] *= upkeepFactor * (key === 'treasury' ? 1 : supplyFactor);
    const multiplier = overCapacityGarrison ? 3 : 1;
    for (const key of ['treasury','food','cloth','grain','fuel']) costs[key] *= multiplier;
    const provinceId = force.force_kind === 'garrison' ? (force.province_id ?? markerById.get(Number(force.marker_id))?.province_id) : force.province_id;
    const candidates = markers.filter(marker => marker.owner === force.owner && marker.type !== 'ruins'
      && provincesById.get(Number(marker.province_id))?.owner === force.owner
      && !provincesById.get(Number(marker.province_id))?.occupied_by)
      .map(marker => ({ marker, route: routeToMilitarySource(provinceId, marker.province_id, force.owner, provincesById, adjacency, calendar.season, waterLinks) }))
      .filter(item => item.route && item.route.capacity > 0)
      .sort((a,b) => a.route.edges.length - b.route.edges.length || Number(a.marker.id) - Number(b.marker.id));
    return { force, provinceId, units, costs, source: candidates[0] || null, demand: calculateArmySupplyPoints(units, calendar.season, overCapacityGarrison) * supplyFactor };
  });
  const edgeGroups = new Map();
  for (const army of active) for (const edge of army.source?.route.edges || []) {
    if (!edgeGroups.has(edge.key)) edgeGroups.set(edge.key, []);
    edgeGroups.get(edge.key).push({ army, edge });
  }
  const edgeCoverage = new Map();
  for (const [edgeKey, users] of edgeGroups) {
    const capacity = Math.max(...users.map(({ edge }) => edge.capacity)) * supplyCapacityFactor(users[0].army.force);
    const allocated = allocateSupplyCapacity(users.map(({ army }) => ({ id: army.force.id, supplyDemand: army.demand })), capacity);
    allocated.forEach(row => edgeCoverage.set(`${edgeKey}|${row.armyId}`, row.coverage));
  }
  for (const army of active) {
    const { force, provinceId, costs, source } = army;
    const routeCoverage = source ? (source.route.capacity === Infinity ? 1 : source.route.edges.reduce((minimum, edge) => Math.min(minimum, edgeCoverage.get(`${edge.key}|${force.id}`) ?? 0), 1)) : 0;
    const localStock = {};
    const withdrawn = [];
    const takeBasket = (key, amount) => {
      let remaining = Math.max(0, amount * routeCoverage);
      for (const [type, name] of RATION_ITEMS[key]) {
        if (!remaining || !source) break;
        const row = inventoryAt(source.marker.id, type, name);
        const quantity = Math.max(0, Number(row?.quantity) || 0);
        const taken = Math.min(quantity, remaining);
        if (taken > 0) { row.quantity -= taken; remaining -= taken; withdrawn.push({ item_type:type, item_name:name, quantity:taken }); }
      }
      localStock[key] = amount ? (amount * routeCoverage - remaining) / amount : 1;
    };
    takeBasket('food', costs.food);
    takeBasket('grain', costs.grain);
    takeBasket('cloth', costs.cloth);
    takeBasket('fuel', costs.fuel);
    const treasuryRow = mechanics.find(row => row.owner === force.owner);
    const treasuryAvailable = Math.max(0, Number(treasuryRow?.settings?.economy?.treasury) || 0) + Number(treasuryAdjustments[force.owner] || 0);
    const treasuryCoverage = costs.treasury ? Math.min(1, treasuryAvailable / costs.treasury) : 1;
    const coverage = Math.min(treasuryCoverage, ...Object.values(localStock));
    const previousShortages = Number(force.underfunded_turns) || 0;
    const shortfall = 1 - Math.max(0, Math.min(1, coverage));
    const underfundedTurns = shortfall > 0 ? previousShortages + 1 : 0;
    const people = army.units.reduce((sum, group) => sum + integer(group.count), 0);
    const exactLosses = underfundedTurns >= 2 ? people * 0.05 * shortfall + (Number(force.deserter_carry) || 0) : 0;
    const deserters = Math.floor(exactLosses);
    const counts = army.units.map(group => integer(group.count));
    const losses = counts.map((count, index) => ({ index, count, loss:0, fraction:0 }));
    if (deserters > 0 && people > 0) {
      losses.forEach(item => { const exact = deserters * item.count / people; item.loss = Math.floor(exact); item.fraction = exact - item.loss; });
      let remainder = deserters - losses.reduce((sum,item) => sum + item.loss, 0);
      losses.sort((a,b) => b.fraction-a.fraction || a.index-b.index);
      for (const item of losses) { if (remainder <= 0) break; if (item.loss < item.count) { item.loss++; remainder--; } }
      losses.sort((a,b) => a.index-b.index);
    }
    let nextUnits = army.units.map((group,index) => ({ ...group, count:Math.max(0, integer(group.count) - losses[index].loss) }));
    const afterDesertion = nextUnits.reduce((sum, group) => sum + group.count, 0);
    const terrain = stateTerrain(force, terrainCells);
    const hasFieldCamp = force.force_kind === 'land_army' && structures.some(item => item.structure_type === 'camp' && item.status === 'active'
      && Number(item.available_from_turn) <= Number(calendar.turn) && Number(item.cell_x) === Number(force.cell_x) && Number(item.cell_y) === Number(force.cell_y));
    const mayRest = (force.force_kind === 'garrison' || hasFieldCamp) && Number(force.last_battle_experience_turn) !== Number(calendar.turn);
    const morale = clamp((Number(force.morale) || 0) + (shortfall > 0 ? -10 * shortfall : 5 + (mayRest ? 5 : 0)) + forceModifier(force, 'morale_change_pp'), 0, 100);
    const stationedProvinceId = Number(provinceId);
    const epidemic = epidemicProvinces.has(stationedProvinceId);
    const attritionRate = epidemic
      ? (force.force_kind === 'garrison' || hasFieldCamp ? 0.01 : 0.02)
      : Math.min(0.02,
        (force.force_kind === 'garrison' ? 0.001 : hasFieldCamp ? 0.0025 : 0.005)
        + (force.force_kind !== 'garrison' && calendar.season === 'Зима' ? 0.005 : 0)
        + (force.force_kind !== 'garrison' && terrain === 'marsh' ? 0.005 : 0)
        + (force.force_kind !== 'garrison' && underfundedTurns >= 2 ? 0.005 * (underfundedTurns - 1) : 0));
    let attritionLosses = 0;
    nextUnits = nextUnits.map(group => {
      const expected = group.count * attritionRate + Math.max(0, Number(group.noncombat_carry) || 0);
      const loss = Math.min(group.count, Math.floor(expected));
      attritionLosses += loss;
      return { ...group, count:group.count-loss, noncombat_carry:Math.max(0, expected-loss) };
    });
    treasuryAdjustments[force.owner] = Number(treasuryAdjustments[force.owner] || 0) - costs.treasury * treasuryCoverage;
    forceUpdates.push({ id:force.id, morale, unit_groups:nextUnits, underfunded_turns:underfundedTurns, deserter_carry:Math.max(0, exactLosses - deserters), noncombat_carry:0, maintenance_coverage:coverage, status:nextUnits.some(group => group.count > 0) ? force.status : 'disbanded' });
    if (!reports[force.owner]) reports[force.owner] = [];
    reports[force.owner].push({ force_id:force.id, force_name:force.name, supplied:coverage, shortfall, deserters, noncombat_losses:attritionLosses, morale_change:morale - Number(force.morale || 0), source_marker_id:source?.marker.id ?? null, route_modes:[...new Set(source?.route.edges.map(edge => edge.type) || [])], withdrawn });
  }
  const itemKey = (type, name) => `${type}:${name}`;
  const portByMarker = new Map(ports.map(port => [Number(port.marker_id), port]));
  const readCargo = ship => ship.cargo && typeof ship.cargo === 'object' && !Array.isArray(ship.cargo) ? ship.cargo : {};
  const drawFromFleet = (fleet, marker, type, name, amount) => {
    let remaining = amount;
    if (marker) {
      const row = inventoryAt(marker.id, type, name);
      const taken = Math.min(Math.max(0, Number(row?.quantity) || 0), remaining);
      if (taken > 0) { row.quantity -= taken; remaining -= taken; }
    }
    // Cargo remains a valid reserve in port if its warehouse cannot cover the
    // whole seasonal basket; at sea, only this onboard branch is available.
    for (const ship of fleet.ships || []) {
      const cargo = readCargo(ship), key = itemKey(type, name);
      const cargoName = Object.hasOwn(cargo, key) ? key : name;
      const quantity = Math.max(0, Number(cargo[cargoName]) || 0);
      const taken = Math.min(quantity, remaining);
      if (taken > 0) { cargo[cargoName] = quantity - taken; remaining -= taken; }
      if (remaining <= 0) break;
    }
    return amount - remaining;
  };
  const foodBasket = [['resource','Зерно'],['resource','Скот'],['resource','Морепродукты'],['resource','Мёд и Воск']];
  const activeFleets = fleets.filter(fleet => fleet.status === 'active' && (fleet.ships || []).length);
  for (const fleet of activeFleets) {
    const atSea = fleet.location_kind === 'water';
    const port = !atSea && fleet.location_kind === 'port' ? portByMarker.get(Number(fleet.port_marker_id)) : null;
    const marker = port && port.owner === fleet.owner ? markerById.get(Number(port.marker_id)) : null;
    const inServicePort = Boolean(marker && port?.status === 'active');
    const ships = structuredClone(fleet.ships || []);
    const crew = ships.reduce((sum, ship) => sum + integer(ship.crew), 0);
    const hullBase = ships.reduce((sum, ship) => sum + (NAVAL_SHIP_PROFILES[ship.type]?.hullUpkeep || 0), 0);
    const upkeepFactor=militaryCostFactor(fleet),supplyFactor=supplyUseFactor(fleet);
    const hullCost = hullBase * (atSea || !inServicePort ? 2 : 1) * upkeepFactor;
    const treasuryCost = (hullCost + crew * (0.25 + (atSea ? 0.25 : 0)) * upkeepFactor);
    const foodCost = crew * (0.25 + (atSea ? 0.25 : 0)) * upkeepFactor * supplyFactor;
    const clothCost = crew * 0.025 * upkeepFactor * supplyFactor;
    const fuelCost = calendar.season === 'Зима' ? crew * 0.125 * upkeepFactor * supplyFactor : 0;
    const treasuryRow = mechanics.find(row => row.owner === fleet.owner);
    const treasuryAvailable = Math.max(0, Number(treasuryRow?.settings?.economy?.treasury) || 0) + Number(treasuryAdjustments[fleet.owner] || 0);
    const treasuryCoverage = treasuryCost > 0 ? Math.min(1, treasuryAvailable / treasuryCost) : 1;
    const drawBasket = (names, amount) => {
      let remaining = amount;
      for (const [type, name] of names) {
        if (remaining <= 0) break;
        remaining -= drawFromFleet({ ...fleet, ships }, marker, type, name, remaining);
      }
      return amount > 0 ? (amount - remaining) / amount : 1;
    };
    const foodCoverage = drawBasket(foodBasket, foodCost);
    const clothCoverage = drawBasket([['good','Сукно и Одежда']], clothCost);
    const fuelCoverage = drawBasket([['good','Топливо'],['resource','Древесина']], fuelCost);
    const passengerUpdates = [];
    const passengerReports = [];
    const disbandedPassengers = new Set();
    treasuryAdjustments[fleet.owner] = Number(treasuryAdjustments[fleet.owner] || 0) - treasuryCost * treasuryCoverage;
    for (const ship of ships) for (const passenger of ship.passengers || []) {
      if (!passenger.force_id || passenger.captured_by) continue;
      const force = forces.find(item => item.id === passenger.force_id && item.status === 'embarked');
      if (!force) continue;
      const units = Array.isArray(force.unit_groups) ? force.unit_groups : (passenger.unit_groups || []);
      const upkeep = calculateSeasonalUpkeep(units, calendar.season);
      const upkeepModifierPct=forceModifier(force,'military_upkeep_pct'),supplyModifierPct=forceModifier(force,'supply_consumption_pct');
      const upkeepFactor=Math.max(0,1+upkeepModifierPct/100),supplyFactor=Math.max(0,1+supplyModifierPct/100);
      for(const key of ['treasury','food','cloth','grain','fuel'])upkeep[key]*=upkeepFactor*(key==='treasury'?1:supplyFactor);
      const passengerFood = drawBasket(foodBasket, upkeep.food);
      const passengerGrain = drawBasket([['resource','Зерно']], upkeep.grain);
      const passengerCloth = drawBasket([['good','Сукно и Одежда']], upkeep.cloth);
      const passengerFuel = drawBasket([['good','Топливо'],['resource','Древесина']], upkeep.fuel);
      const passengerTreasuryRow = mechanics.find(row => row.owner === force.owner);
      const passengerTreasury = Math.max(0, Number(passengerTreasuryRow?.settings?.economy?.treasury) || 0) + Number(treasuryAdjustments[force.owner] || 0);
      const treasuryCoverageForForce = upkeep.treasury ? Math.min(1, passengerTreasury / upkeep.treasury) : 1;
      const result = resolveSeasonalArmyMaintenance({
        army: { units, morale: force.morale, underfundedTurns: force.underfunded_turns, deserterCarry: force.deserter_carry },
        available: { treasury: upkeep.treasury * treasuryCoverageForForce, food: upkeep.food * passengerFood,
          grain: upkeep.grain * passengerGrain, cloth: upkeep.cloth * passengerCloth, fuel: upkeep.fuel * passengerFuel },
        season: calendar.season, upkeepModifierPct, supplyModifierPct,
        moraleChangeModifier:forceModifier(force,'morale_change_pp')
      });
      const counts = new Map(result.unitLosses.map(loss => [loss.index, loss.loss]));
      let nextGroups = units.map((group, index) => ({ ...group, count: Math.max(0, integer(group.count) - (counts.get(index) || 0)) }));
      const attritionRate = Math.min(0.02, (calendar.season === 'Зима' ? 0.005 : 0) + (result.underfundedTurns >= 2 ? 0.005 : 0));
      nextGroups = nextGroups.map(group => {
        const expected = integer(group.count) * attritionRate + Math.max(0, Number(group.noncombat_carry) || 0);
        const loss = Math.min(integer(group.count), Math.floor(expected));
        return { ...group, count: integer(group.count) - loss, noncombat_carry: Math.max(0, expected - loss) };
      });
      const nextPeople = nextGroups.reduce((sum, group) => sum + integer(group.count), 0);
      const coverage = result.coverage;
      treasuryAdjustments[force.owner] = Number(treasuryAdjustments[force.owner] || 0) - upkeep.treasury * treasuryCoverageForForce;
      passengerUpdates.push({ id: force.id, morale: result.morale, unit_groups: nextGroups,
        underfunded_turns: result.underfundedTurns, deserter_carry: result.deserterCarry,
        noncombat_carry: 0, maintenance_coverage: coverage, status: nextPeople > 0 ? 'embarked' : 'disbanded' });
      passengerReports.push({ force_id: force.id, force_name: force.name, supplied: coverage,
        deserters: result.deserters, source_marker_id: marker?.id ?? null });
      if (nextPeople > 0) {
        passenger.unit_groups = nextGroups;
        passenger.morale = result.morale;
      } else disbandedPassengers.add(force.id);
    }
    if (disbandedPassengers.size) for (const ship of ships) ship.passengers = (ship.passengers || []).filter(passenger => !disbandedPassengers.has(passenger.force_id));
    const coverage = Math.min(treasuryCoverage, foodCoverage, clothCoverage, fuelCoverage);
    const shortfall = 1 - coverage;
    const underfundedTurns = shortfall > 0 ? (Number(fleet.underfunded_turns) || 0) + 1 : 0;
    let crewTotal = crew, deserters = 0;
    if (underfundedTurns >= 2 && shortfall > 0 && crewTotal > 0) {
      let carry = 0;
      for (const ship of ships) {
        const exact = integer(ship.crew) * 0.05 * shortfall + Math.max(0, Number(ship.maintenance_loss_carry) || 0);
        const loss = Math.min(integer(ship.crew), Math.floor(exact));
        ship.crew = integer(ship.crew) - loss;
        ship.maintenance_loss_carry = ship.crew ? exact - loss : 0;
        deserters += loss;
        carry += ship.maintenance_loss_carry;
      }
    } else if (!shortfall) ships.forEach(ship => { ship.maintenance_loss_carry = 0; });
    crewTotal = ships.reduce((sum, ship) => sum + integer(ship.crew), 0);
    const morale = clamp((Number(fleet.morale) || 0) + (shortfall > 0 ? -10 * shortfall : 5) + forceModifier(fleet,'morale_change_pp'), 0, 100);
    fleetUpdates.push({ id:fleet.id, ships, morale, underfunded_turns:underfundedTurns, maintenance_coverage:coverage, last_maintenance_turn:calendar.turn, status:ships.some(ship => ship.crew > 0 && ship.hull > 0) ? 'active' : 'disbanded' });
    forceUpdates.push(...passengerUpdates);
    if (!reports[fleet.owner]) reports[fleet.owner] = [];
    reports[fleet.owner].push({ fleet_id:fleet.id, fleet_name:fleet.name, supplied:coverage, shortfall, crew:crewTotal, deserters, hull_upkeep:hullCost, treasury_upkeep:treasuryCost, source_marker_id:marker?.id ?? null, location:atSea ? 'water' : marker ? 'port' : 'blocked_port', passenger_reports:passengerReports });
  }
  return { inventoryUpdates:nextInventories.filter(row => Number(row.quantity) > 0), forceUpdates, fleetUpdates, treasuryAdjustments, reports };
}

export function calculateArmyMobility(unitGroups = [], siegeEquipment = {}, { snow = false } = {}) {
  const { troops, equipment, total } = calculateLandCommandLoad(unitGroups, siegeEquipment);
  if (total <= 0) return 1;
  let weighted = 0;
  for (const group of unitGroups) {
    const count = integer(group.count);
    let factor = LAND_UNIT_PROFILES[group.type]?.mobility ?? 1;
    if (group.type === 'Лыжники-разведчики' && snow) factor = 1.2;
    weighted += count * factor;
  }
  // Siege gear is slow cargo: half its conditional weight at mobility 0.5.
  weighted += equipment * 0.5;
  const composition = weighted / total;
  const sizePenalty = Math.max(0.7, 1 - 0.05 * Math.floor(Math.max(0, total - 500) / 500));
  return clamp(composition * sizePenalty, 0.5, 1.4);
}

export function movementStepCost(terrain, diagonal, mobility = 1, riverCrossings = 0) {
  const costs = MILITARY_TERRAIN[terrain] || MILITARY_TERRAIN.plain;
  const base = diagonal ? costs.diagonal : costs.direct;
  if (!Number.isFinite(base)) return Infinity;
  const terrainCost = Math.max(1, Math.ceil(base / Math.max(0.01, Number(mobility) || 1)));
  const crossings = Math.max(0, Math.floor(Number(riverCrossings) || 0));
  return terrainCost + crossings * RIVER_CROSSING_ACTION_POINTS;
}

const cellKey = ({ x, y }) => `${Math.floor(x)},${Math.floor(y)}`;
const parseCellKey = key => key.split(',').map(Number);

// Dijkstra path planner for an 8-direction square grid. getTerrain receives
// integer cell coordinates; canEnter can enforce ownership, occupancy, bridges,
// and season-specific passability without duplicating movement arithmetic.
export function findMilitaryPath(start, goal, {
  getTerrain = () => 'plain', mobility = 1, remainingActionPoints = BASE_ACTION_POINTS,
  canEnter = (_x, _y, terrain) => terrain !== 'water',
  // Return the number of river crossings on the edge from (x, y) to (nextX, nextY).
  // A bridge-aware callback returns zero for a crossing covered by a usable bridge.
  getRiverCrossings = () => 0, maxVisited = 100000
} = {}) {
  const origin = { x: Math.floor(start.x), y: Math.floor(start.y) };
  const target = { x: Math.floor(goal.x), y: Math.floor(goal.y) };
  const originKey = cellKey(origin), targetKey = cellKey(target);
  if (originKey === targetKey) return { path: [origin], cost: 0, remaining: remainingActionPoints };
  const distances = new Map([[originKey, 0]]), previous = new Map(), open = new Set([originKey]);
  const directions = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  let visited = 0;
  while (open.size && visited++ < maxVisited) {
    let currentKey, currentCost = Infinity;
    for (const key of open) if (distances.get(key) < currentCost) { currentKey = key; currentCost = distances.get(key); }
    open.delete(currentKey);
    if (currentKey === targetKey) break;
    const [x, y] = parseCellKey(currentKey);
    for (const [dx, dy] of directions) {
      const next = { x: x + dx, y: y + dy }, nextKey = cellKey(next), diagonal = dx !== 0 && dy !== 0;
      const terrain = getTerrain(next.x, next.y);
      if (!canEnter(next.x, next.y, terrain)) continue;
      if (diagonal && !canEnter(x + dx, y, getTerrain(x + dx, y)) && !canEnter(x, y + dy, getTerrain(x, y + dy))) continue;
      const crossings = getRiverCrossings(x, y, next.x, next.y);
      const step = movementStepCost(terrain, diagonal, mobility, crossings), candidate = currentCost + step;
      if (candidate > remainingActionPoints || candidate >= (distances.get(nextKey) ?? Infinity)) continue;
      distances.set(nextKey, candidate); previous.set(nextKey, currentKey); open.add(nextKey);
    }
  }
  if (!distances.has(targetKey)) return { path: [], cost: Infinity, remaining: remainingActionPoints, reachable: false };
  const path = [];
  for (let cursor = targetKey; cursor !== undefined; cursor = previous.get(cursor)) {
    const [x, y] = parseCellKey(cursor); path.push({ x, y });
  }
  path.reverse();
  const cost = distances.get(targetKey);
  return { path, cost, remaining: Math.max(0, remainingActionPoints - cost), reachable: true };
}

export function navalShipCanUseWater(shipType, waterTypes, season = '') {
  const mask = Math.max(0, Math.floor(Number(waterTypes) || 0));
  const navigable = season === 'Зима' ? mask & 4 : mask & 7;
  const allowed = {
    'Ушкуй': 3,
    'Насад': 3,
    'Ладья': 7,
    'Когг': 4,
    'Хольк': 4
  }[shipType] || 0;
  return !!(navigable & allowed);
}

export function findNavalPath(start, goal, {
  getWaterTypes = () => 0,
  getFlowDirection = () => null,
  shipTypes = [],
  season = '',
  canEnter = () => true,
  remainingActionPoints = BASE_ACTION_POINTS,
  undercrewed = false,
  slowestManeuver = null,
  maxVisited = 100000
} = {}) {
  const origin = { x: Math.floor(start.x), y: Math.floor(start.y) };
  const target = { x: Math.floor(goal.x), y: Math.floor(goal.y) };
  const originKey = cellKey(origin), targetKey = cellKey(target);
  if (!shipTypes.length || !shipTypes.every(type => navalShipCanUseWater(type, getWaterTypes(origin.x, origin.y), season))) {
    return { reachable: false, path: [], cost: Infinity };
  }
  const distances = new Map([[originKey, 0]]), previous = new Map(), open = new Set([originKey]);
  const directions = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  let visited = 0;
  while (open.size && visited++ < maxVisited) {
    let currentKey, currentCost = Infinity;
    for (const key of open) if (distances.get(key) < currentCost) { currentKey = key; currentCost = distances.get(key); }
    open.delete(currentKey);
    if (currentKey === targetKey) break;
    const [x, y] = parseCellKey(currentKey);
    for (const [dx, dy] of directions) {
      const next = { x: x + dx, y: y + dy };
      const nextKey = cellKey(next), waterTypes = getWaterTypes(next.x, next.y);
      const navigable = (cx, cy) => {
        const mask = getWaterTypes(cx, cy);
        return !!mask && shipTypes.every(type => navalShipCanUseWater(type, mask, season)) && canEnter(cx, cy, mask);
      };
      if (!navigable(next.x, next.y)) continue;
      if (dx && dy && !navigable(x + dx, y) && !navigable(x, y + dy)) continue;
      const diagonal = dx !== 0 && dy !== 0;
      let base = diagonal ? 14 : 10;
      const fromWater = getWaterTypes(x, y), toWater = getWaterTypes(next.x, next.y);
      if ((fromWater & 1) && (toWater & 1)) {
        const flow = getFlowDirection(next.x, next.y) || getFlowDirection(x, y);
        if (flow && Number.isFinite(Number(flow.dx)) && Number.isFinite(Number(flow.dy))) {
          if (Number(flow.dx) === dx && Number(flow.dy) === dy) base = diagonal ? 12 : 8;
          else if (Number(flow.dx) === -dx && Number(flow.dy) === -dy) base = diagonal ? 16 : 12;
        }
      }
      const maneuverAdjustment = slowestManeuver == null
        ? 0
        : 3 - Math.max(1, Math.min(5, Number(slowestManeuver) || 3));
      const stepCost = Math.max(1, base + maneuverAdjustment + (undercrewed ? 1 : 0));
      const candidate = currentCost + stepCost;
      if (candidate > remainingActionPoints || candidate >= (distances.get(nextKey) ?? Infinity)) continue;
      distances.set(nextKey, candidate);
      previous.set(nextKey, currentKey);
      open.add(nextKey);
    }
  }
  if (!distances.has(targetKey)) return { reachable: false, path: [], cost: Infinity };
  const path = [];
  for (let key = targetKey; key; key = previous.get(key)) {
    path.push(Object.fromEntries(['x','y'].map((name, index) => [name, parseCellKey(key)[index]])));
    if (key === originKey) break;
  }
  path.reverse();
  return { reachable: path.length > 1, path, cost: distances.get(targetKey) };
}

export function commanderSkillEffects(skills = {}, commandEfficiency = 1) {
  const level = name => clamp(skills[name], 0, 5);
  const leadership = level('leadership'), management = level('management'), planning = level('planning');
  return {
    capacity: commanderCapacity(management),
    command_efficiency: clamp(commandEfficiency, 0, 1),
    moraleLossMultiplier: 1 - leadership * 0.05 * clamp(commandEfficiency, 0, 1),
    moraleRecoveryBonus: leadership >= 4 ? 2 : leadership >= 2 ? 1 : 0,
    organizedRetreatBonus: planning * 3 * clamp(commandEfficiency, 0, 1),
    tacticEffectMultiplier: (0.5 + level('tactics') * 0.1) * clamp(commandEfficiency, 0, 1),
    engineeringEffectiveLevel: level('engineering') * clamp(commandEfficiency, 0, 1)
  };
}

export function calculateOrganizedWithdrawalChance({ army, opposingArmies = [], route = {} } = {}) {
  const units = army?.units || [];
  const strength = groups => groups.reduce((sum, group) => {
    const profile = LAND_UNIT_PROFILES[group.type];
    return sum + integer(group.count) * ((profile?.strike || 0) + (profile?.defense || 0)) / 2;
  }, 0);
  const ownStrength = strength(units);
  const enemyStrength = opposingArmies.reduce((sum, opponent) => sum + strength(opponent.units || []), 0);
  const ratio = ownStrength / Math.max(1, enemyStrength);
  const forceBonus = ratio < 0.5 ? -12 : ratio < 0.75 ? -6 : ratio < 1.25 ? 0 : ratio < 2 ? 6 : 12;
  const ownMobility = calculateArmyMobility(units, army?.siegeEquipment || {});
  const enemyMobility = Math.max(0, ...opposingArmies.map(opponent => calculateArmyMobility(opponent.units || [], opponent.siegeEquipment || {})));
  const mobilityBonus = clamp(Math.trunc(ownMobility - enemyMobility), -3, 3) * 2;
  const moraleBonus = clamp((Number(army?.morale ?? 100) - 50) * 0.2, -10, 10);
  const command = calculateLandCommandLoad(units, army?.siegeEquipment || {});
  const planningBonus = commanderSkillEffects(army?.skills || {}, commandLoadEfficiency(command.total, commanderCapacity(army?.skills?.management || 0))).organizedRetreatBonus;
  const routeSteps = Math.max(1, integer(route.steps ?? ((route.path?.length || 0) - 1)));
  const routeLengthPenalty = -Math.min(12, Math.max(0, routeSteps - 1) * 4);
  const difficultTerrainPenalty = -Math.min(9, integer(route.difficultCells) * 3);
  const safeDestinationBonus = route.friendlyDestination ? 5 : 0;
  const canBeIntercepted = opposingArmies.some(opponent => (opponent.units || []).some(group => integer(group.count) > 0 && LAND_UNIT_PROFILES[group.type]?.role === 'cavalry'));
  const pursuitPenalty = canBeIntercepted ? -5 : 0;
  const factors = { base: 50, force: forceBonus, mobility: mobilityBonus, morale: moraleBonus, planning: planningBonus, routeLength: routeLengthPenalty, difficultTerrain: difficultTerrainPenalty, safeDestination: safeDestinationBonus, enemyPursuit: pursuitPenalty };
  return { chance: clamp(Object.values(factors).reduce((sum, value) => sum + value, 0), 10, 80), factors, strengthRatio: ratio, canBeIntercepted, routeSteps };
}

export function annualCharacterDeathChance(age) {
  if (Number(age) < 50) return 0;
  const yearsOverFifty = Number(age) - 50;
  return Math.min(1, 0.005 * 2 ** (yearsOverFifty / 5));
}

function stableRoll(seed, scope) {
  const text = `${seed}:${scope}`;
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  let value = hash >>> 0;
  value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
  return (value >>> 0) / 0x100000000;
}

const navalHullFactor = ship => {
  const profile = NAVAL_SHIP_PROFILES[ship.type] || NAVAL_SHIP_PROFILES['Ладья'];
  const lost = profile.hull - Math.max(0, Number(ship.hull) || 0);
  if (lost < profile.hull * 0.5) return 1;
  if (lost < profile.hull * 0.75) return 0.75;
  return 0.5;
};
const navalPassengerLoad = ship => (ship.passengers || []).reduce((sum, passenger) => {
  const troopPlaces = (passenger.unit_groups || []).reduce((subtotal, group) => subtotal
    + integer(group.count) * (LAND_UNIT_PROFILES[group.type]?.role === 'cavalry' ? 2 : 1), 0);
  const equipment = Object.entries(passenger.siege_equipment || {}).reduce((subtotal, [name, count]) => subtotal
    + (SIEGE_LOAD[name] || 0) * integer(count), 0);
  return sum + troopPlaces + equipment;
}, 0);
function chooseNavalTarget(targets, seed, key, mode = 'ranged') {
  if (!targets.length) return null;
  const profile = ship => NAVAL_SHIP_PROFILES[ship.type] || NAVAL_SHIP_PROFILES['Ладья'];
  const score = ship => {
    const hullRatio = Math.max(0, Number(ship.hull) || 0) / Math.max(1, profile(ship).hull);
    const crewRatio = Math.max(0, Number(ship.crew) || 0) / Math.max(1, profile(ship).crew);
    const speed = navalManeuver(ship);
    return mode === 'boarding'
      ? [ship.disabled ? 0 : 1, hullRatio, Number(ship.morale) || 0, speed, crewRatio]
      : [ship.weapon && ship.weapon !== 'none' ? 0 : 1, hullRatio, crewRatio, Number(ship.morale) || 0];
  };
  const compare = (left, right) => {
    const a = score(left), b = score(right);
    for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return a[index] - b[index];
    return stableRoll(seed, `${key}:${left.id}`) - stableRoll(seed, `${key}:${right.id}`);
  };
  return [...targets].sort(compare)[0];
}

function navalShipStrength(ship, morale = 100, combatFactor = 1) {
  const crew = integer(ship.crew);
  const boardingMen = integer(ship.boardingMen);
  return (crew + boardingMen) * (0.75 + clamp(morale, 0, 100) / 200) * navalHullFactor(ship) * combatFactor;
}
function navalManeuver(ship) {
  const profile = NAVAL_SHIP_PROFILES[ship.type] || NAVAL_SHIP_PROFILES['Ладья'];
  return Math.max(1, profile.maneuver - (Number(ship.hull) <= profile.hull / 2 ? 1 : 0));
}

/** Resolve the fixed three-cycle naval rules with deterministic random rolls. */
export function simulateNavalBattle({ battleId = 'naval-preview', attacker, defender, randomSeed = battleId, poorVisibility = false, weather = null, safeRetreat = { attacker: false, defender: false }, adverseConditions = { attacker: false, defender: false }, requestWithdrawal = { attacker: false, defender: false }, pursue = { attacker: false, defender: false } } = {}) {
  const createFleet = (input, side) => {
    const source = Array.isArray(input) ? { ships: input } : (input || {});
    const ships = (source.ships || []).map((raw, index) => {
      const profile = NAVAL_SHIP_PROFILES[raw.type] || NAVAL_SHIP_PROFILES['Ладья'];
      const maxCrew = profile.crew;
      return { ...structuredClone(raw), id: String(raw.id ?? `${side}-${index + 1}`), type: NAVAL_SHIP_PROFILES[raw.type] ? raw.type : 'Ладья', maxCrew,
        crew: clamp(raw.crew ?? maxCrew, 0, maxCrew), hull: clamp(raw.hull ?? profile.hull, 0, profile.hull),
        morale: clamp(raw.morale ?? source.morale ?? 100, 0, 100), weapon: Object.hasOwn(NAVAL_WEAPONS, raw.weapon) ? raw.weapon : 'none', capturedBy: null,
        cargoPlaces: integer(raw.cargoPlaces), boardingMen: integer(raw.boardingMen), capacity: profile.capacity,
        passengers: Array.isArray(raw.passengers) ? structuredClone(raw.passengers) : [],
        volleys: clamp(raw.volleys ?? 0, 0, 3), fire: Boolean(raw.fire), captured: false, sunk: false, disabled: false, lossCarry: 0 };
    });
    if (!ships.length) throw new Error(`Добавьте хотя бы одно судно для стороны «${side === 'attacker' ? 'Атакующие' : 'Защитники'}».`);
    const combatFactor = Math.max(0, 1 + modifierValue(source.modifiers || [], 'battle_strength_pct', {
      army: source.modifierScopeId ?? source.id ?? side, territory_type: 'fleet'
    }) / 100);
    return { id: source.id || side, morale: clamp(source.morale ?? 100, 0, 100), commanderSkills: source.commanderSkills || {}, combatFactor, ships, withdrawn: false };
  };
  const fleets = { attacker: createFleet(attacker, 'attacker'), defender: createFleet(defender, 'defender') };
  const cycles = [];
  const withdrawals = [];
  const activeWithdrawalSides = new Set();
  const sunkSurvivors = [];
  const afloat = side => fleets[side].ships.filter(ship => !ship.sunk && !ship.captured && ship.crew > 0);
  const averageManeuver = side => { const ships = afloat(side); return ships.length ? ships.reduce((sum, ship) => sum + navalManeuver(ship), 0) / ships.length : 0; };
  const withdrawalCheck = (side, cycle) => {
    const enemy = side === 'attacker' ? 'defender' : 'attacker';
    const ownShips = afloat(side), enemyShips = afloat(enemy);
    if (!ownShips.some(ship => ship.crew >= ship.maxCrew * 0.75 && !ship.disabled)) return { side, cycle, chance: 0, roll: 1, success: false, unavailable: true };
    const advantage = Math.round(averageManeuver(side) - averageManeuver(enemy));
    const damaged = ownShips.reduce((sum, ship) => sum + ship.hull / NAVAL_SHIP_PROFILES[ship.type].hull, 0) / ownShips.length < 0.5;
    const skills = fleets[side].commanderSkills || {};
    const commandLoad = ownShips.reduce((sum, ship) => sum + (SHIP_COMMAND_LOAD[ship.type] || 0), 0);
    const management = clamp(skills.management, 0, 5);
    const commandEfficiency = commandLoadEfficiency(commandLoad, commanderCapacity(management));
    const planningBonus = clamp(skills.planning, 0, 5) * 3 * commandEfficiency;
    const chance = clamp(40 + 5 * advantage + (poorVisibility ? 10 : 0) + (safeRetreat[side] ? 10 : 0) - (adverseConditions[side] ? 10 : 0) - (damaged ? 10 : 0) + planningBonus, 10, 80);
    const roll = stableRoll(randomSeed, `naval-withdraw:${side}:${cycle}`);
    return { side, cycle, chance, planningBonus, commandEfficiency, roll, success: roll < chance / 100 };
  };
  for (const side of ['attacker', 'defender']) if (requestWithdrawal[side]) {
    const check = withdrawalCheck(side, 0);
    if (check) withdrawals.push(check);
    if (check?.success) fleets[side].withdrawn = true;
  }
  for (let cycle = 1; cycle <= 3; cycle++) {
    if (!afloat('attacker').length || !afloat('defender').length || fleets.attacker.withdrawn || fleets.defender.withdrawn) break;
    const start = { attacker: afloat('attacker'), defender: afloat('defender') };
    const cycleMorale = { attacker: fleets.attacker.morale, defender: fleets.defender.morale };
    const cycleStart = new Map([...start.attacker, ...start.defender].map(ship => [ship, { crew: ship.crew, hull: ship.hull, morale: ship.morale }]));
    const rangedCrewLosses = new Map([...cycleStart.keys()].map(ship => [ship, 0]));
    const ranged = [];
    for (const side of ['attacker', 'defender']) {
      const enemy = side === 'attacker' ? 'defender' : 'attacker';
      start[side].forEach((ship, index) => {
        if (ship.weapon === 'none' || ship.volleys >= 3 || ship.disabled || ship.crew < ship.maxCrew * 0.75) return;
        const targets = start[enemy];
        if (!targets.length) return;
        const target = chooseNavalTarget(targets, randomSeed, `naval-target:${side}:${ship.id}:${cycle}`, 'ranged');
        ship.volleys += 1;
        const ownManeuver = navalManeuver(ship);
        const targetManeuver = navalManeuver(target);
        const seaPenalty = weather?.sea_condition === 'storm' ? 10 : weather?.sea_condition === 'rough' ? 5 : 0;
        const chance = clamp(30 + 5 * (ownManeuver - targetManeuver) - (poorVisibility ? 10 : 0) - seaPenalty + (target.type === 'Хольк' ? 5 : 0), 10, 60);
        const hit = stableRoll(randomSeed, `naval-hit:${side}:${ship.id}:${cycle}`) < chance / 100;
        ranged.push({ side, attacker: ship.id, target: target.id, weapon: ship.weapon, chance, hit, damage: hit && ship.weapon === 'light_gun' ? 1 : 0,
          crewLoss: hit && ship.weapon === 'deck' ? Math.max(1, Math.ceil(target.crew * 0.05)) : 0,
          fire: hit && ship.weapon === 'light_gun' && stableRoll(randomSeed, `naval-fire:${side}:${ship.id}:${cycle}`) < 0.2 });
      });
    }
    const targetById = new Map([...start.attacker, ...start.defender].map(ship => [ship.id, ship]));
    for (const attack of ranged) {
      if (!attack.hit) continue;
      const target = targetById.get(attack.target);
      target.crew = Math.max(0, target.crew - attack.crewLoss);
      rangedCrewLosses.set(target, (rangedCrewLosses.get(target) || 0) + attack.crewLoss);
      target.hull = Math.max(0, target.hull - attack.damage);
      target.fire ||= attack.fire;
    }
    const boarding = [];
    const boardingLosses = new Map([...start.attacker, ...start.defender].map(ship => [ship, 0]));
    for (const side of ['attacker', 'defender']) {
      const enemy = side === 'attacker' ? 'defender' : 'attacker';
      const targets = start[enemy].filter(ship => !ship.captured && !ship.sunk);
      if (!targets.length) continue;
      const counts = new Map();
      for (const ship of start[side]) {
        if (ship.disabled || ship.crew < ship.maxCrew * 0.75 || ship.morale <= 0) continue;
        const target = chooseNavalTarget(targets, randomSeed, `naval-board-target:${side}:${ship.id}:${cycle}`, 'boarding');
        counts.set(target, (counts.get(target) || 0) + 1);
        boarding.push({ side, ship, target });
      }
      for (const [target, supportCount] of counts) {
        const attackers = boarding.filter(row => row.side === side && row.target === target);
        const startState = ship => ({ ...ship, crew: cycleStart.get(ship).crew, hull: cycleStart.get(ship).hull });
        const ownStrength = attackers.reduce((sum, row) => sum + navalShipStrength(startState(row.ship), cycleMorale[side], fleets[side].combatFactor), 0) * (supportCount > 1 ? 1.25 : 1);
        const targetStrength = navalShipStrength(startState(target), cycleMorale[enemy], fleets[enemy].combatFactor);
        const strengthSum = Math.max(1, ownStrength + targetStrength);
        const targetLossRaw = cycleStart.get(target).crew * Math.min(0.1, 0.1 * ownStrength / strengthSum) + target.lossCarry;
        const ownLossRaw = attackers.reduce((sum, row) => sum + cycleStart.get(row.ship).crew * Math.min(0.1, 0.1 * targetStrength / strengthSum), 0);
        const targetLoss = targetLossRaw > 0 ? Math.max(1, Math.min(target.crew, Math.floor(targetLossRaw))) : 0;
        if (targetLossRaw > 0) target.lossCarry = Math.max(0, targetLossRaw - Math.max(1, Math.floor(targetLossRaw)));
        boardingLosses.set(target, (boardingLosses.get(target) || 0) + targetLoss);
        let remainingLoss = ownLossRaw;
        for (const row of attackers) {
          const exactLoss = cycleStart.get(row.ship).crew * Math.min(0.1, 0.1 * targetStrength / strengthSum);
          const loss = exactLoss > 0 ? Math.max(1, Math.min(row.ship.crew, Math.floor(exactLoss + row.ship.lossCarry))) : 0;
          row.ship.lossCarry = exactLoss > 0 ? Math.max(0, exactLoss + row.ship.lossCarry - Math.max(1, Math.floor(exactLoss + row.ship.lossCarry))) : 0;
          boardingLosses.set(row.ship, (boardingLosses.get(row.ship) || 0) + loss);
          remainingLoss -= loss;
        }
        boarding.push({ side, target: target.id, attackerShips: attackers.map(row => row.ship.id), attackerStrength: ownStrength, defenderStrength: targetStrength, targetLoss, attackerLoss: Math.max(0, Math.round(ownLossRaw - remainingLoss)) });
      }
    }
    const casualties = { attacker: [], defender: [] };
    for (const side of ['attacker', 'defender']) {
      const lossBySide = { attacker: 0, defender: 0 };
      for (const ship of start[side]) {
        const crewBefore = cycleStart.get(ship).crew;
        const boardLoss = Math.min(crewBefore, boardingLosses.get(ship) || 0);
        ship.crew = Math.max(0, ship.crew - boardLoss);
        const rangedLoss = rangedCrewLosses.get(ship) || 0;
        const lost = crewBefore - ship.crew;
        lossBySide[side] += lost;
        const leadership = clamp(fleets[side].commanderSkills?.leadership, 0, 5);
        const commandLoad = start[side].reduce((sum, vessel) => sum + (SHIP_COMMAND_LOAD[vessel.type] || 0), 0);
        const management = clamp(fleets[side].commanderSkills?.management, 0, 5);
        const commandEfficiency = commandLoadEfficiency(commandLoad, commanderCapacity(management));
        const moraleLossFactor = 1 - leadership * 0.05 * commandEfficiency;
        if (crewBefore > 0 && lost / crewBefore >= 0.1) ship.morale = clamp(ship.morale - 5 * moraleLossFactor, 0, 100);
        if (ship.crew <= 0 || ship.morale <= 0) { ship.captured = true; ship.capturedBy = side === 'attacker' ? 'defender' : 'attacker'; }
        else if (ship.morale <= 20) {
          const enemySide = side === 'attacker' ? 'defender' : 'attacker';
          if (navalShipStrength(ship, ship.morale, fleets[side].combatFactor) <= start[enemySide].reduce((sum, enemy) => sum + navalShipStrength(enemy, cycleMorale[enemySide], fleets[enemySide].combatFactor), 0)) { ship.captured = true; ship.capturedBy = enemySide; }
        }
        if (ship.captured) ship.fire = false;
        if (ship.fire && !ship.captured && ship.hull > 0) {
          ship.hull = Math.max(0, ship.hull - 1);
          const extinguishChance = Math.min(0.8, 0.5 + Math.floor(ship.crew / 10) * 0.05);
          if (stableRoll(randomSeed, `naval-extinguish:${ship.id}:${cycle}`) < extinguishChance) ship.fire = false;
        }
        const profile = NAVAL_SHIP_PROFILES[ship.type];
        ship.disabled = profile.hull - ship.hull >= profile.hull * 0.75;
        let crewKilledOnSinking = 0, crewSurvivors = 0;
        if (ship.hull <= 0) {
          ship.sunk = true; ship.captured = false; ship.capturedBy = null; ship.fire = false;
          crewKilledOnSinking = Math.floor(ship.crew / 2);
          crewSurvivors = ship.crew - crewKilledOnSinking;
          sunkSurvivors.push({ side, ship, survivors: crewSurvivors, passengers: structuredClone(ship.passengers || []) });
          ship.passengers = [];
          ship.crew = 0;
          lossBySide[side] += crewKilledOnSinking;
        }
        const passengerPrisoners = ship.captured ? (ship.passengers || []).reduce((sum, passenger) => sum
          + (passenger.unit_groups || []).reduce((count, group) => count + integer(group.count), 0), 0) : 0;
        casualties[side].push({ shipId: ship.id, crewBefore, crewLost: lost + crewKilledOnSinking, crewSurvivors, crewRescued: 0, crewPrisoners: 0, crewMissing: crewSurvivors, passengerDeaths: 0, passengerRescued: 0, passengerPrisoners, passengerMissing: 0, boardingLoss: boardLoss, rangedLoss, hull: ship.hull, fire: ship.fire, morale: ship.morale, captured: ship.captured, sunk: ship.sunk, disabled: ship.disabled });
      }
      const capturedShips = start[side].filter(ship => ship.captured).length;
      const leadership = clamp(fleets[side].commanderSkills?.leadership, 0, 5);
      const commandLoad = start[side].reduce((sum, ship) => sum + (SHIP_COMMAND_LOAD[ship.type] || 0), 0);
      const management = clamp(fleets[side].commanderSkills?.management, 0, 5);
      const commandEfficiency = commandLoadEfficiency(commandLoad, commanderCapacity(management));
      const moraleLossFactor = 1 - leadership * 0.05 * commandEfficiency;
      fleets[side].morale = clamp(fleets[side].morale - (Math.min(15, lossBySide[side] / Math.max(1, start[side].reduce((sum, ship) => sum + cycleStart.get(ship).crew, 0)) * 50) + 10 * capturedShips) * moraleLossFactor, 0, 100);
    }
    for (const wreck of sunkSurvivors.splice(0)) {
      let remaining = wreck.survivors;
      const casualty = casualties[wreck.side].find(row => row.shipId === wreck.ship.id);
      const friendlySide = wreck.side, enemySide = friendlySide === 'attacker' ? 'defender' : 'attacker';
      for (const rescueSide of [friendlySide, enemySide]) {
        for (const rescuer of fleets[rescueSide].ships) {
          if (rescuer === wreck.ship || rescuer.sunk || rescuer.captured || rescuer.crew <= 0 || remaining <= 0) continue;
          const free = Math.max(0, rescuer.capacity - rescuer.cargoPlaces - rescuer.boardingMen - navalPassengerLoad(rescuer));
          const saved = Math.min(remaining, free);
          if (!saved) continue;
          rescuer.cargoPlaces += saved;
          remaining -= saved;
          if (rescueSide === friendlySide) casualty.crewRescued += saved;
          else casualty.crewPrisoners += saved;
        }
      }
      casualty.crewMissing = remaining;
      let wreckPassengerDeaths = 0;
      let wreckPassengerSurvivors = 0;
      let passengerRescued = 0;
      let passengerPrisoners = 0;
      let passengerMissing = 0;
      const survivingPassengers = wreck.passengers.map(passenger => {
        const groups = (passenger.unit_groups || []).map(group => {
          const count = integer(group.count);
          const deaths = Math.floor(count / 2);
          wreckPassengerDeaths += deaths;
          const survivors = count - deaths;
          wreckPassengerSurvivors += survivors;
          return { ...group, count: survivors };
        }).filter(group => group.count > 0);
        return { ...passenger, unit_groups: groups };
      }).filter(passenger => passenger.unit_groups.length);
      const passengerRemainders = survivingPassengers.map(passenger => ({ passenger, groups: passenger.unit_groups.map(group => ({ ...group })), equipmentRemaining: true }));
      for (const rescueSide of [friendlySide, enemySide]) {
        for (const rescuer of fleets[rescueSide].ships) {
          if (rescuer === wreck.ship || rescuer.sunk || rescuer.captured || rescuer.crew <= 0) continue;
          let free = Math.max(0, rescuer.capacity - rescuer.cargoPlaces - rescuer.boardingMen - navalPassengerLoad(rescuer));
          for (const rem of passengerRemainders) {
            if (free <= 0) break;
            const savedGroups = [];
            for (const group of rem.groups) {
              const placesPerPerson = LAND_UNIT_PROFILES[group.type]?.role === 'cavalry' ? 2 : 1;
              const savedCount = Math.min(integer(group.count), Math.floor(free / placesPerPerson));
              if (savedCount <= 0) continue;
              savedGroups.push({ ...group, count: savedCount });
              group.count -= savedCount;
              free -= savedCount * placesPerPerson;
            }
            if (!savedGroups.length) continue;
            const equipmentLoad = rem.equipmentRemaining
              ? Object.entries(rem.passenger.siege_equipment || {}).reduce((sum, [name, count]) => sum
                + (SIEGE_LOAD[name] || 0) * integer(count), 0)
              : 0;
            const equipmentSaved = rem.equipmentRemaining && equipmentLoad > 0 && free >= equipmentLoad;
            if (equipmentSaved) free -= equipmentLoad;
            const saved = { ...rem.passenger, unit_groups: savedGroups, siege_equipment: equipmentSaved ? rem.passenger.siege_equipment : {} };
            if (rescueSide !== friendlySide) saved.captured_by = rescueSide;
            rescuer.passengers.push(saved);
            if (equipmentSaved) rem.equipmentRemaining = false;
            const savedCount = savedGroups.reduce((sum, group) => sum + integer(group.count), 0);
            if (rescueSide === friendlySide) passengerRescued += savedCount;
            else passengerPrisoners += savedCount;
          }
        }
      }
      passengerMissing = Math.max(0, wreckPassengerSurvivors - passengerRescued - passengerPrisoners);
      casualty.passengerDeaths = wreckPassengerDeaths;
      casualty.passengerRescued = passengerRescued;
      casualty.passengerPrisoners = passengerPrisoners;
      casualty.passengerMissing = passengerMissing;
    }
    cycles.push({ cycle, ranged, boarding: boarding.filter(row => row.target && typeof row.target === 'string'), casualties });
    for (const side of ['attacker', 'defender']) if (fleets[side].morale <= 30) {
      const check = withdrawalCheck(side, cycle);
      if (check) withdrawals.push(check);
      if (check?.success) {
        fleets[side].withdrawn = true;
        activeWithdrawalSides.add(side);
      }
    }
    if (!afloat('attacker').length || !afloat('defender').length) break;
  }
  const active = { attacker: afloat('attacker'), defender: afloat('defender') };
  const attackerOut = fleets.attacker.withdrawn || !active.attacker.length;
  const defenderOut = fleets.defender.withdrawn || !active.defender.length;
  const outcome = attackerOut && defenderOut ? 'draw' : attackerOut ? 'defender' : defenderOut ? 'attacker' : 'draw';
  let pursuitResult = null;
  const retreatingSide = fleets.attacker.withdrawn ? 'attacker' : fleets.defender.withdrawn ? 'defender' : (attackerOut ? 'attacker' : defenderOut ? 'defender' : null);
  const pursuerSide = retreatingSide === 'attacker' ? 'defender' : retreatingSide === 'defender' ? 'attacker' : null;
  if (retreatingSide && pursuerSide && activeWithdrawalSides.has(retreatingSide) && pursue[pursuerSide] && outcome === pursuerSide) {
    const pursuers = afloat(pursuerSide).filter(ship => !ship.disabled && ship.crew >= ship.maxCrew * 0.75);
    const targets = fleets[retreatingSide].ships.filter(ship => !ship.sunk && !ship.captured);
    const maneuverAdvantage = Math.round(averageManeuver(pursuerSide) - averageManeuver(retreatingSide));
    const adverse = Boolean(poorVisibility || adverseConditions[pursuerSide]);
    const chance = clamp(40 + 5 * maneuverAdvantage - (adverse ? 10 : 0), 10, 70);
    const roll = stableRoll(randomSeed, 'naval-pursuit');
    const success = pursuers.length > 0 && targets.length > 0 && roll < chance / 100;
    if (success) {
      const target = [...targets].sort((a, b) => Number(b.disabled) - Number(a.disabled)
        || (a.hull / NAVAL_SHIP_PROFILES[a.type].hull) - (b.hull / NAVAL_SHIP_PROFILES[b.type].hull)
        || navalManeuver(a) - navalManeuver(b)
        || String(a.id).localeCompare(String(b.id)))[0];
      if (target.disabled) {
        target.captured = true;
        target.capturedBy = pursuerSide;
        pursuitResult = { pursuerSide, retreatingSide, chance, roll, success, targetShipId: target.id, hullDamage: 0, crewLoss: 0, captured: true };
      } else {
        target.hull = Math.max(1, target.hull - 1);
        target.disabled = NAVAL_SHIP_PROFILES[target.type].hull - target.hull >= NAVAL_SHIP_PROFILES[target.type].hull * 0.75;
        const crewLoss = Math.min(target.crew, Math.ceil(target.crew * 0.10));
        target.crew -= crewLoss;
        pursuitResult = { pursuerSide, retreatingSide, chance, roll, success, targetShipId: target.id, hullDamage: 1, crewLoss, captured: false };
      }
    } else {
      pursuitResult = { pursuerSide, retreatingSide, chance: pursuers.length ? chance : 0, roll, success: false, reason: pursuers.length ? 'неудачный перехват' : 'нет управляемых судов для преследования' };
    }
  }
  return { battleId, outcome, cycles, withdrawals, pursuit: pursuitResult, fleets, randomSeed, drawsRemaining: Object.fromEntries(['attacker', 'defender'].map(side => [side, Object.fromEntries(fleets[side].ships.map(ship => [ship.id, Math.max(0, 3 - ship.volleys)]))])) };
}

function phaseFactor(phase, type, conditions = {}) {
  const factor = LAND_COMBAT_PHASES[phase]?.factors?.[type];
  if (typeof factor === 'number') return factor;
  if (!factor) return 0;
  if (phase === 'first') {
    if (type === 'Конные копейщики') return conditions.charge ? factor.charge : factor.ordinary;
    if (type === 'Лёгкая конница') return conditions.flank ? factor.flank : factor.ordinary;
    if (['Лучники', 'Арбалетчики', 'Конные лучники'].includes(type)) return conditions.ranged ? factor.ranged : factor.melee;
  }
  if (phase === 'break') {
    if (type === 'Лёгкая конница') return conditions.flank ? factor.flank : factor.ordinary;
    if (type === 'Конные лучники') return conditions.ranged ? factor.ranged : factor.melee;
  }
  if (phase === 'pursuit') return conditions.pursuing ? factor.pursuit : factor.ordinary;
  return 0;
}

function landUnitProfile(type) {
  return LAND_UNIT_PROFILES[type] || SPECIAL_LAND_UNIT_PROFILES[type] || null;
}

function isInfectedArmy(army) {
  return army?.specialType === 'infected' || army?.special_type === 'infected'
    || army?.owner === 'Буйствующие' || army?.conditions?.infected === true;
}

function orderFactors(order, commandEfficiency = 1) {
  const efficiency = clamp(commandEfficiency, 0, 1);
  if (order === 'решительный' || order === 'decisive') return { strike: 1 + 0.1 * efficiency, defense: 1 - 0.05 * efficiency };
  if (order === 'осторожный' || order === 'cautious') return { strike: 1 - 0.1 * efficiency, defense: 1 + 0.05 * efficiency };
  return { strike: 1, defense: 1 };
}

function armyCommandState(army) {
  const load = calculateLandCommandLoad(army.units || [], army.siegeEquipment || {});
  const capacity = commanderCapacity(army.skills?.management || 0);
  return { load, capacity, efficiency: commandLoadEfficiency(load.total, capacity) };
}

function calcArmyContributions(army, phase, side, terrain, conditions = {}) {
  const command = armyCommandState(army);
  const skills = commanderSkillEffects(army.skills || {}, command.efficiency);
  const orders = orderFactors(army.order, command.efficiency);
  const terrainFactors = LAND_TERRAIN_COMBAT[terrain] || LAND_TERRAIN_COMBAT.plain;
  const moral = clamp(army.morale ?? 100, 0, 100);
  const moraleFactor = 0.75 + moral / 200;
  const combatFactor = Math.max(0, 1 + modifierValue(army.modifiers || [], 'battle_strength_pct', {
    army: army.modifierScopeId ?? army.id, territory_type: 'army'
  }) / 100);
  const groupRows = (army.units || []).map((group, index) => {
    const count = integer(group.count), profile = landUnitProfile(group.type);
    if (!count || !profile) return null;
    let situational = 1;
    if (side === 'attacker') {
      situational *= terrainFactors.attacker;
      if (profile.role === 'cavalry' && terrainFactors.cavalry && (terrain !== 'hill' || conditions.charge)) situational *= terrainFactors.cavalry;
    } else {
      situational *= terrainFactors.defender;
      if (conditions.fieldCamp) situational *= 1.1;
    }
    if (side === 'attacker' && profile.role === 'cavalry' && ['mud', 'snow'].includes(conditions.weather)) situational *= 0.9;
    if (profile.role === 'ranged' && conditions.weather === 'rain') situational *= 0.9;
    if (conditions.weather === 'heat') situational *= 0.95;
    situational = clamp(situational * orders.strike, 0.5, 1.5);
    const factor = phaseFactor(phase, group.type, conditions);
    const tacticPower = (0.5 + clamp(army.skills?.tactics, 0, 5) * 0.1) * command.efficiency;
    let tacticStrike = 1;
    if (army.tactic === 'archery' && phase === 'first' && profile.role === 'ranged' && conditions.ranged) tacticStrike *= 1 + 0.15 * tacticPower;
    if (army.tactic === 'reserve') tacticStrike *= phase === 'first' ? 0.8 : phase === 'break' ? 1 + 0.03 * tacticPower : 1;
    if (army.tactic === 'ambush' && phase === 'first' && terrain === 'forest' && conditions.surprise) tacticStrike *= 1 + 0.2 * tacticPower;
    const strike = count * profile.strike * factor * situational * tacticStrike * moraleFactor * combatFactor;
    let tacticDefense = 1;
    if (side === 'defender' && army.tactic === 'hold' && terrainFactors.defender > 1) tacticDefense *= 1 + 0.1 * tacticPower;
    if (side === 'defender' && army.tactic === 'tight_formation' && profile.role === 'infantry' && !conditions.flanked) tacticDefense *= 1 + 0.1 * tacticPower;
    const defenseMultiplier = clamp((side === 'defender' ? terrainFactors.defender * (conditions.fieldCamp ? 1.1 : 1) : 1) * orders.defense * tacticDefense, 0.5, 1.5);
    const defense = count * profile.defense * defenseMultiplier * moraleFactor * combatFactor;
    let vulnerability = conditions.melee === false && profile.role === 'ranged' ? 0.75 : profile.role === 'ranged' ? 1.25 : 1;
    if (profile.role === 'scout' && terrain === 'forest' && conditions.snow && conditions.maneuver) vulnerability *= 0.85;
    if (army.tactic === 'focused_strike' || army.tactic === 'flank') vulnerability *= 1 + 0.1 * tacticPower;
    if (army.tactic === 'tight_formation' && profile.role === 'infantry' && conditions.flanked) vulnerability *= 1 + 0.2 * tacticPower;
    if (conditions.focusedByOpponent === group.index) vulnerability *= 1 + 0.15 * clamp(conditions.opponentTacticPower ?? tacticPower, 0, 1);
    if (conditions.flankedByOpponent) vulnerability *= 1 + 0.25 * clamp(conditions.flankTacticPower ?? tacticPower, 0, 1);
    return { index, type: group.type, count, strike, defense, vulnerability, skillEffects: skills };
  }).filter(Boolean);
  return { army, command, skills, groups: groupRows, strike: groupRows.reduce((sum, group) => sum + group.strike, 0), defense: groupRows.reduce((sum, group) => sum + group.defense, 0), count: groupRows.reduce((sum, group) => sum + group.count, 0) };
}

function assignLosses(groups, lossBudget, fractionalCarry = []) {
  const pending = groups.map((group, index) => group.count > 0 ? Math.max(0, Number(fractionalCarry[index]) || 0) : 0);
  const pendingTotal = pending.reduce((sum, amount) => sum + amount, 0);
  const budget = Math.min(groups.reduce((sum, group) => sum + group.count, 0), Math.max(0, lossBudget + pendingTotal));
  const wholeLosses = Math.floor(budget + 1e-9);
  if (!groups.length) return { losses: [], carry: [] };
  const weights = groups.map(group => group.count * group.vulnerability / Math.max(1, landUnitProfile(group.type)?.defense || 1));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  const exact = groups.map((group, index) => Math.min(group.count, pending[index] + lossBudget * weights[index] / totalWeight));
  const losses = exact.map(amount => Math.floor(amount + 1e-9));
  let remainder = Math.min(wholeLosses - losses.reduce((sum, loss) => sum + loss, 0), groups.reduce((sum, group, index) => sum + group.count - losses[index], 0));
  const order = exact.map((amount, index) => ({ index, fraction: amount - Math.floor(amount) })).sort((a,b) => b.fraction - a.fraction || a.index - b.index);
  while (remainder > 0) {
    let changed = false;
    for (const candidate of order) {
      if (remainder <= 0) break;
      if (losses[candidate.index] >= groups[candidate.index].count) continue;
      losses[candidate.index]++; remainder--; changed = true;
    }
    if (!changed) break;
  }
  // Preserve sub-unit loss by unit group; never move a remainder between armies.
  const carry = groups.map((group, index) => Math.max(0, exact[index] - losses[index]));
  return { losses, carry };
}

function chooseLandTactic(army, side, phase, terrain, randomSeed) {
  const groups = (army.units || []).filter(group => integer(group.count) > 0);
  const roles = new Set(groups.map(group => LAND_UNIT_PROFILES[group.type]?.role).filter(Boolean));
  const hasCavalry = roles.has('cavalry');
  const hasRanged = roles.has('ranged');
  const hasInfantry = roles.has('infantry');
  const candidates = [{ tactic: 'none', score: 0.25 }];
  if (phase === 'first' && hasRanged && army.conditions.ranged !== false) candidates.push({ tactic: 'archery', score: 0.5 + groups.filter(group => LAND_UNIT_PROFILES[group.type]?.role === 'ranged').reduce((sum, group) => sum + integer(group.count), 0) / Math.max(1, groups.reduce((sum, group) => sum + integer(group.count), 0)) });
  if (phase === 'first' && hasCavalry && ['plain', 'hill'].includes(terrain)) candidates.push({ tactic: 'cavalry_alarm', score: 0.7 });
  if (['plain', 'hill', 'forest'].includes(terrain) && army.conditions.flank && side === 'attacker') candidates.push({ tactic: 'flank', score: phase === 'first' ? 0.95 : 0.8 });
  if (phase === 'first' && terrain === 'forest' && army.conditions.surprise && side === 'attacker') candidates.push({ tactic: 'ambush', score: 1 });
  if (side === 'defender' && (LAND_TERRAIN_COMBAT[terrain]?.defender || 1) > 1) candidates.push({ tactic: 'hold', score: 0.7 });
  if (side === 'defender' && hasInfantry && !army.conditions.flanked) candidates.push({ tactic: 'tight_formation', score: 0.6 });
  if (phase === 'break' && (hasInfantry || hasCavalry)) candidates.push({ tactic: 'reserve', score: 0.65 });
  if (side === 'attacker') candidates.push({ tactic: 'focused_strike', score: 0.55 });

  // These first-pass weights make tactics respond to phase, terrain, force composition,
  // the commander's preferred approach, order and current morale. They are balance values.
  const preference = army.preferredTactic || 'none';
  const preferenceBonus = 0.18 + clamp(army.skills?.tactics, 0, 5) * 0.035;
  for (const candidate of candidates) {
    if (army.order === 'осторожный' && ['hold', 'tight_formation', 'archery'].includes(candidate.tactic)) candidate.score += 0.12;
    if (army.order === 'осторожный' && ['flank', 'ambush', 'focused_strike'].includes(candidate.tactic)) candidate.score -= 0.08;
    if (army.order === 'решительный' && ['flank', 'ambush', 'focused_strike', 'cavalry_alarm'].includes(candidate.tactic)) candidate.score += 0.1;
    if (army.morale < 40 && ['hold', 'tight_formation', 'reserve'].includes(candidate.tactic)) candidate.score += 0.08;
    if (army.morale < 40 && ['flank', 'ambush', 'focused_strike'].includes(candidate.tactic)) candidate.score -= 0.1;
    candidate.score += candidate.tactic === preference ? preferenceBonus : 0;
    candidate.score += stableRoll(randomSeed, `${army.id}:tactic:${phase}:${candidate.tactic}`) * 0.025;
  }
  candidates.sort((a, b) => b.score - a.score || a.tactic.localeCompare(b.tactic));
  return candidates[0].tactic;
}

/**
 * Resolve a deterministic first-pass land battle using the fixed unit, phase,
 * terrain, order, morale, loss-budget and formation-break rules in the rules file.
 * Tactics whose rules still have qualitative or explicitly unbalanced effects
 * are left out until their numerical effects are finalized.
 */
export function simulateLandBattle({ battleId = 'preview', attacker, defender, attackerArmies, defenderArmies, terrain = 'plain', attackerConditions = {}, defenderConditions = {}, siege = null, weather = null, randomSeed = battleId } = {}) {
  const attackingConditions = terrain === 'bridge' ? { ...attackerConditions, charge: false } : attackerConditions;
  const defendingConditions = terrain === 'bridge' ? { ...defenderConditions, charge: false } : defenderConditions;
  const inputArmies = (plural, singular) => Array.isArray(plural) ? plural : singular ? [singular] : [];
  const sides = {
    attacker: inputArmies(attackerArmies, attacker).map((army, index) => {
      const id = army.id ?? `attacker-${index}`;
      const conditions = { ...attackingConditions, ...(army.conditions || {}), weather: weather?.land_condition || (army.conditions || {}).weather, snow: weather?.land_condition === 'snow' || Boolean((army.conditions || {}).snow) };
      const infected = isInfectedArmy({ ...army, conditions });
      if (infected) conditions.infected = true;
      if (terrain === 'bridge') conditions.charge = false;
      return { ...structuredClone(army), id, conditions, preferredTactic: infected ? 'focused_strike' : (army.preferredTactic || army.tactic || 'none'), tactic: infected ? 'focused_strike' : 'none', order: infected ? 'решительный' : army.order, decision: infected ? 'fight' : army.decision, withdrawal: infected ? null : army.withdrawal, withdrawalRoute: infected ? null : army.withdrawalRoute, morale: infected ? 100 : clamp(army.morale ?? 100, 0, 100), active: true, lossCarry: [], breakRoll: stableRoll(randomSeed, `${id}:break`) };
    }),
    defender: inputArmies(defenderArmies, defender).map((army, index) => {
      const id = army.id ?? `defender-${index}`;
      const conditions = { ...defendingConditions, ...(army.conditions || {}), weather: weather?.land_condition || (army.conditions || {}).weather, snow: weather?.land_condition === 'snow' || Boolean((army.conditions || {}).snow) };
      const infected = isInfectedArmy({ ...army, conditions });
      if (infected) conditions.infected = true;
      if (terrain === 'bridge') conditions.charge = false;
      return { ...structuredClone(army), id, conditions, preferredTactic: infected ? 'focused_strike' : (army.preferredTactic || army.tactic || 'none'), tactic: infected ? 'focused_strike' : 'none', order: infected ? 'решительный' : army.order, decision: infected ? 'fight' : army.decision, withdrawal: infected ? null : army.withdrawal, withdrawalRoute: infected ? null : army.withdrawalRoute, morale: infected ? 100 : clamp(army.morale ?? 100, 0, 100), active: true, lossCarry: [], breakRoll: stableRoll(randomSeed, `${id}:break`) };
    })
  };
  if (!sides.attacker.length || !sides.defender.length) throw new Error('Для расчёта нужны армии обеих сторон.');
  const withdrawals = [];
  for (const army of sides.defender) {
    if (army.conditions.infected || (army.decision !== 'withdraw' && !army.withdrawal?.requested)) continue;
    const route = army.withdrawalRoute || army.withdrawal?.route || {};
    if (route.legal === false || (!Array.isArray(route.path) && !Number.isFinite(Number(route.steps))) || integer(route.steps ?? route.path?.length - 1) < 1) {
      throw new Error(`Для армии «${army.name || army.id}» нужен допустимый маршрут отхода длиной не менее одного шага.`);
    }
    if (Number.isFinite(Number(route.actionPointCost)) && Number.isFinite(Number(route.remainingActionPoints)) && Number(route.actionPointCost) > Number(route.remainingActionPoints)) {
      throw new Error(`Армии «${army.name || army.id}» не хватает ОД для выбранного маршрута отхода.`);
    }
    const check = calculateOrganizedWithdrawalChance({ army, opposingArmies: sides.attacker, route });
    const roll = stableRoll(randomSeed, `withdrawal:${army.id}`);
    const success = roll < check.chance / 100;
    if (success) army.active = false;
    withdrawals.push({ armyId: army.id, route, ...check, roll, success, actionPointsSpent: Number(route.actionPointCost) || 0 });
  }
  const withdrawalDisrupted = withdrawals.some(check => !check.success);
  if (!sides.defender.some(army => army.active)) {
    return {
      battleId, terrain, phases: [], residual: { attacker: { strike: 0, defense: 0, score: 0, activeArmies: sides.attacker.length }, defender: { strike: 0, defense: 0, score: 0, activeArmies: 0 } },
      outcome: 'attacker', pursuit: null, withdrawals, withdrawalDisrupted, noBattle: true, armies: sides
    };
  }
  const report = [];
  const applyPhase = (phase, cycle = 0) => {
    const phaseDef = LAND_COMBAT_PHASES[phase];
    for (const side of ['attacker', 'defender']) {
      for (const army of sides[side].filter(item => item.active)) {
        army.tactic = army.conditions.infected ? 'focused_strike' : chooseLandTactic(army, side, phase, terrain, `${randomSeed}:${cycle}`);
      }
    }
    if (phase === 'first') {
      for (const side of ['attacker', 'defender']) {
        const source = sides[side].find(army => army.active && army.tactic === 'cavalry_alarm');
        if (source && ['plain', 'hill'].includes(terrain)) {
          const penalty = 2 * (0.5 + clamp(source.skills?.tactics, 0, 5) * 0.1) * armyCommandState(source).efficiency;
          sides[side === 'attacker' ? 'defender' : 'attacker'].forEach(army => { if (!army.conditions.infected) army.morale = clamp(army.morale - penalty, 0, 100); });
        }
      }
      const flankSource = sides.attacker.find(army => army.active && army.tactic === 'flank');
      if (flankSource) {
        const penalty = 2 * (0.5 + clamp(flankSource.skills?.tactics, 0, 5) * 0.1) * armyCommandState(flankSource).efficiency;
        sides.defender.forEach(army => { if (!army.conditions.infected) army.morale = clamp(army.morale - penalty, 0, 100); });
      }
    }
    const startSnapshot = {};
    for (const side of ['attacker','defender']) {
      startSnapshot[side] = sides[side].filter(army => army.active).map(army => {
        let conditions = { ...army.conditions };
        if (side === 'defender') {
          const flankSource = sides.attacker.find(army => army.active && army.conditions.flank && army.tactic === 'flank');
          const focusedSource = sides.attacker.find(army => army.active && army.tactic === 'focused_strike');
          if (flankSource) {
            conditions.flankedByOpponent = true;
            conditions.flankTacticPower = (0.5 + clamp(flankSource.skills?.tactics, 0, 5) * 0.1) * armyCommandState(flankSource).efficiency;
          }
          if (focusedSource) {
            const targetGroup = (army.units || []).map((group, index) => ({ index, defense: LAND_UNIT_PROFILES[group.type]?.defense ?? Infinity, count: integer(group.count) })).filter(group => group.count).sort((a,b) => a.defense - b.defense || a.index - b.index)[0];
            if (targetGroup) { conditions.focusedByOpponent = targetGroup.index; conditions.opponentTacticPower = (0.5 + clamp(focusedSource.skills?.tactics, 0, 5) * 0.1) * armyCommandState(focusedSource).efficiency; }
          }
        }
        return { army, ...calcArmyContributions(army, phase, side, terrain, conditions) };
      });
    }
    const totals = Object.fromEntries(['attacker','defender'].map(side => [side, {
      strike: startSnapshot[side].reduce((sum, row) => sum + row.strike, 0),
      defense: startSnapshot[side].reduce((sum, row) => sum + row.defense, 0),
      count: startSnapshot[side].reduce((sum, row) => sum + row.count, 0)
    }]));
    const siegeModifiers = siege ? siegeAssaultModifiers(siege) : null;
    if (siegeModifiers) {
      totals.attacker.strike *= siegeModifiers.attackMultiplier;
      totals.defender.defense *= siegeModifiers.defenseMultiplier;
    }
    const random = Object.fromEntries(['attacker','defender'].map(side => [side, 0.95 + stableRoll(randomSeed, `${phase}:${cycle}:${side}`) * 0.1]));
    const adjustedStrike = Object.fromEntries(['attacker','defender'].map(side => [side, totals[side].strike * random[side] * (side === 'attacker' && phase === 'first' && withdrawalDisrupted ? 1.1 : 1)]));
    const incoming = {
      attacker: phaseDef.intensity * adjustedStrike.defender / Math.max(1e-9, totals.attacker.defense),
      defender: phaseDef.intensity * adjustedStrike.attacker / Math.max(1e-9, totals.defender.defense)
    };
    const casualties = {};
    for (const side of ['attacker','defender']) {
      casualties[side] = [];
      let totalSideLosses = 0;
      const sideBudget = totals[side].count * Math.min(phaseDef.lossCap, incoming[side]);
      const slots = startSnapshot[side].flatMap(row => row.groups.map((group, groupPosition) => ({ row, group, groupPosition })));
      const distributed = assignLosses(
        slots.map(slot => slot.group),
        sideBudget,
        slots.map(slot => slot.row.army.lossCarry[slot.groupPosition] || 0)
      );
      const lossesByArmy = new Map(startSnapshot[side].map(row => [row.army, 0]));
      const lossesByArmyType = new Map(startSnapshot[side].map(row => [row.army, {}]));
      const carriesByArmy = new Map(startSnapshot[side].map(row => [row.army, [...row.army.lossCarry]]));
      slots.forEach((slot, index) => {
        const lost = distributed.losses[index];
        const target = slot.row.army.units[slot.group.index];
        target.count = Math.max(0, integer(target.count) - lost);
        lossesByArmy.set(slot.row.army, lossesByArmy.get(slot.row.army) + lost);
        const typeLosses = lossesByArmyType.get(slot.row.army);
        typeLosses[slot.group.type] = (typeLosses[slot.group.type] || 0) + lost;
        carriesByArmy.get(slot.row.army)[slot.groupPosition] = integer(target.count) > 0 ? distributed.carry[index] : 0;
        totalSideLosses += lost;
      });
      for (const row of startSnapshot[side]) {
        row.army.lossCarry = carriesByArmy.get(row.army);
        const armyLosses = lossesByArmy.get(row.army) || 0;
        if (!(row.army.units || []).some(group => integer(group.count) > 0)) row.army.active = false;
        const lossRatio = row.count ? armyLosses / row.count : 0;
        const infected = row.army.conditions.infected === true;
        const moraleLoss = infected ? 0 : Math.min(15, lossRatio * (50 + cycle * 10) + 0.5 + cycle * 0.35) * row.skills.moraleLossMultiplier;
        row.army.morale = infected ? 100 : clamp(row.army.morale - moraleLoss, 0, 100);
        let broke = false;
        if (!infected && row.army.morale <= 0) broke = true;
        else if (!infected && row.army.morale <= 30) broke = row.army.breakRoll < (30 - row.army.morale) * 0.025;
        if (broke) row.army.active = false;
        casualties[side].push({ armyId: row.army.id, losses: armyLosses, lossesByType: lossesByArmyType.get(row.army), moraleLoss, morale: row.army.morale, broke });
      }
      casualties[side].total = totalSideLosses;
    }
    const tactics = Object.fromEntries(['attacker', 'defender'].map(side => [side, startSnapshot[side].map(row => ({ armyId: row.army.id, name: row.army.name || row.army.id, tactic: row.army.tactic }))]));
    report.push({ phase, cycle, totals, adjustedStrike, random, tactics, casualties, withdrawalInterception: phase === 'first' && withdrawalDisrupted, ...(siegeModifiers ? { siege: siegeModifiers } : {}) });
  };
  applyPhase('first');
  for (let cycle = 1; cycle <= 7; cycle++) {
    if (!sides.attacker.some(army => army.active) || !sides.defender.some(army => army.active)) break;
    applyPhase('break', cycle);
  }
  const residual = Object.fromEntries(['attacker','defender'].map(side => {
    const active = sides[side].filter(army => army.active);
      const stats = active.map(army => calcArmyContributions(army, 'break', side, terrain, army.conditions));
    const strike = stats.reduce((sum, row) => sum + row.strike, 0), defense = stats.reduce((sum, row) => sum + row.defense, 0);
    return [side, { strike, defense, score: (strike + defense) / 2, activeArmies: active.length }];
  }));
  let outcome = 'draw';
  if (!residual.defender.activeArmies && residual.attacker.activeArmies) outcome = 'attacker';
  else if (!residual.attacker.activeArmies && residual.defender.activeArmies) outcome = 'defender';
  else if (residual.attacker.score >= residual.defender.score * 1.1) outcome = 'attacker';
  else if (residual.defender.score >= residual.attacker.score * 1.1) outcome = 'defender';
  let pursuit = null;
  if (outcome !== 'draw') {
    const pursuerSide = outcome;
    const retreatingSide = outcome === 'attacker' ? 'defender' : 'attacker';
    const pursuers = sides[pursuerSide].filter(army => army.conditions.pursue === true && army.units.some(group => integer(group.count) > 0 && LAND_UNIT_PROFILES[group.type]?.role === 'cavalry'));
    if (pursuers.length) {
      const pursuitRows = pursuers.map(army => calcArmyContributions({ ...army, units: army.units.filter(group => LAND_UNIT_PROFILES[group.type]?.role === 'cavalry') }, 'pursuit', pursuerSide, terrain, { ...army.conditions, pursuing: true }));
      const retreatingArmies = sides[retreatingSide].filter(army => army.units.some(group => integer(group.count) > 0));
      const retreatingRows = retreatingArmies.map(army => calcArmyContributions(army, 'break', retreatingSide, terrain, army.conditions));
      const pursuitStrike = pursuitRows.reduce((sum, row) => sum + row.strike, 0);
      const retreatDefense = retreatingRows.reduce((sum, row) => sum + row.defense, 0);
      const lossRatio = Math.min(0.25, 0.10 * pursuitStrike / Math.max(1, retreatDefense));
      const targetGroups = retreatingRows.flatMap(row => row.groups.map(group => ({ ...group, army: row.army, groupIndex: group.index })));
      const totalTargetCount = targetGroups.reduce((sum, group) => sum + group.count, 0);
      const distribution = assignLosses(targetGroups, totalTargetCount * lossRatio);
      const lossesByArmy = new Map(retreatingArmies.map(army => [army, 0]));
      const lossesByType = new Map(retreatingArmies.map(army => [army, {}]));
      targetGroups.forEach((group, index) => {
        const loss = distribution.losses[index];
        const target = group.army.units[group.groupIndex];
        target.count = Math.max(0, integer(target.count) - loss);
        group.army.lossCarry[group.groupIndex] = target.count > 0 ? distribution.carry[index] : 0;
        lossesByArmy.set(group.army, lossesByArmy.get(group.army) + loss);
        const byType = lossesByType.get(group.army);
        byType[group.type] = (byType[group.type] || 0) + loss;
      });
      pursuit = {
        pursuerSide,
        retreatingSide,
        pursuitStrike,
        retreatDefense,
        lossRatio,
        casualties: retreatingArmies.map(army => ({ armyId: army.id, losses: lossesByArmy.get(army), lossesByType: lossesByType.get(army) }))
      };
    }
  }
  return { battleId, terrain, phases: report, residual, outcome, pursuit, withdrawals, withdrawalDisrupted, armies: sides };
}
