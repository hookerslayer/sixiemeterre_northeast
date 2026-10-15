import { state, elements, markerImages, MARKER_TYPES, MILITARY_GRID_CELL_SIZE } from './config.js?v=loading-optimization-20261015';
import { renderActiveLayer, renderMarkers, renderTradeRoutes, highlightProvince, renderIDs, renderMilitaryGrid } from './render.js?v=loading-optimization-20261015';
import { signUpUser, signInUser, signOutUser, updateProvinceData, renameOwnedProvince, createMarkerData, updateMarkerData, deleteMarkerData, fetchStateProfiles, fetchStateMechanics, saveStateMechanics, fetchEconomySnapshot, applyEconomyTurn, saveTerritoryRebellions, saveProductionDirective, saveMarkerTransportRoute, saveStateTradeContract, saveStateTradeContractRoute, saveStateTradeTransitPolicy, uploadStateSymbol, deleteStateSymbol, loadSupabaseData, fetchMilitaryBattles, fetchMilitaryBattleDetails, createMilitaryBattle, saveMilitaryBattleDecision, confirmMilitaryBattle, saveMilitaryTerrainCell, setMilitaryWaterCurrent, fetchMilitaryForces, fetchMilitaryCommanders, hireMilitaryCommander, assignMilitaryCommander, saveMilitaryForce, saveMilitaryFleets, fetchMilitaryFleets, fetchMilitaryPrisoners, fetchMilitaryPorts, buildMilitaryPort, startMilitaryShipBuild, fetchMilitaryShipBuildOrders, dockMilitaryFleet, launchMilitaryFleet, moveMilitaryFleet, transferMilitaryFleetCargo, embarkMilitaryForce, disembarkMilitaryForce, serviceMilitaryShip, trainMilitaryCommander, trainMilitaryFleetCommander, fetchMilitaryMercenaryOffers, hireMilitaryMercenary, hireMilitaryMercenaryCamp, renewMilitaryMercenaryContract, fetchMilitaryLevyOrders, placeMilitaryLevyOrder, mobilizeMilitaryGarrison, extendMilitaryMilitiaService, moveMilitaryForce, transferMilitaryTroops, splitMilitaryForce, fetchMilitaryConditionalOrders, setMilitaryConditionalOrder, cancelMilitaryConditionalOrder, startMilitaryBattle, startMilitaryNavalBattle, fetchMilitaryStructures, adminBuildMilitaryStructure, destroyMilitaryStructure, fetchMilitarySieges, startMilitarySiege, setMilitarySiegeOrder, setMarkerFortification, fetchMilitaryRaids, startMilitaryRaid, fetchMilitaryColonizationMissions, fetchMilitaryColonizationMap, startMilitaryColonization, startMilitarySeaColonization, cancelMilitaryColonization, setMilitaryEpidemicEvent, fetchMilitaryEpidemicEvents, fetchMilitarySpyRecords, hireMilitarySpy, assignMilitarySpyNetwork, setMilitarySpyCounterintelligence, queueMilitarySpyOperation, dismissMilitarySpy, fetchDiplomacyData, createDiplomacyProposal, decideDiplomacyProposal, setStateRulerHeir, proposeStateRuler, resolveStateRulerProposal, submitStateModifierProposal, adminCreateStateModifier, adminDecideStateModifier } from './api.js?v=loading-optimization-20261015';
import { calculateArmyMobility, calculateLandCommandLoad, movementStepCost, findMilitaryPath, findNavalPath, navalShipCanUseWater, LAND_UNIT_PROFILES, LAND_TACTICS, simulateLandBattle, simulateNavalBattle, NAVAL_SHIP_PROFILES, NAVAL_WEAPONS, calculateLevyCapacity, calculateRecruitmentCost, calculateSeasonalUpkeep, calculateArmySupplyPoints, simulateMilitaryMaintenance } from './militaryEngine.js?v=military-ruler-succession-20261013b';
import { GOODS, RESOURCES, annualPopulationGrowthRate, processTurnSimulation } from './economyEngine.js?v=military-ruler-succession-20261013b';
import { MODIFIER_EFFECTS, MODIFIER_SCOPE_VALUES, MODIFIER_SCOPES, getOwnerModifiers, modifierLabel, modifierItemOptions, modifierValue } from './modifierSystem.js';

let toastTimeout = null;
let activePageOwner = '';
const markerTypeLabels = { large_city: 'Крупный город', city: 'Город', monastery: 'Монастырь', fortress: 'Острог', ruins: 'Руины' };
const markerTypeDevelopment = { large_city: 200, city: 50, monastery: 20, fortress: 10, ruins: 0 };
const governmentForms = ['Феодальная монархия', 'Вечевая республика', 'Теократия', 'Вождество'];

export function showToast(message, duration = 3000) {
    if (!elements.toastNotification) return;
    elements.toastNotification.textContent = message;
    elements.toastNotification.classList.add('active');
    if (toastTimeout) clearTimeout(toastTimeout);
    if (duration > 0) {
        toastTimeout = setTimeout(() => {
            elements.toastNotification.classList.remove('active');
        }, duration);
    }
}

export function hideToast() {
    if (!elements.toastNotification) return;
    elements.toastNotification.classList.remove('active');
    if (toastTimeout) clearTimeout(toastTimeout);
}

function syncMilitaryMovePanel() {
    const panel = document.getElementById('military-order-panel');
    if (!panel) return;
    const force = state.militaryForces.find(item => item.id === state.militarySelectedForceId);
    const fleet = state.militaryFleets.find(item => item.id === state.militarySelectedFleetId);
    const fleetDraft = state.militaryFleetMoveDraft;
    const draft = state.militaryMoveDraft || fleetDraft;
    const active = force || fleet;
    const visible = state.showMilitaryGrid && !elements.pageView?.classList.contains('active') && !!active;
    panel.hidden = !visible;
    if (!visible) return;
    const cost = draft?.cost;
    const troopCount = (force?.unit_groups || []).reduce((sum, group) => sum + (Number(group.count) || 0), 0);
    panel.querySelector('[data-order-summary]').textContent = force
        ? `${force.name} · Воевода ${force.commander_name || '—'} · ${formatNumber(troopCount)} бойцов · мораль ${formatNumber(force.morale)}% · ${formatNumber(force.action_points)} ОД${draft ? ` · путь ${draft.path.length - 1} кл. / ${formatNumber(cost)} ОД` : '. Выберите подсвеченную клетку для движения.'}`
        : draft
            ? `${active.name}: ${draft.path.length - 1} кл. · ${formatNumber(cost)} из ${formatNumber(active.action_points)} ОД · маршрут флота`
            : `${active.name} выбрана · ${formatNumber(active.action_points)} ОД. Щёлкни по доступной водной клетке для прокладки пути.`;
    panel.querySelector('[data-order-confirm]').disabled = !draft;
    const attackTarget = panel.querySelector('[data-attack-target]');
    const attackButton = panel.querySelector('[data-order-attack]');
    if (attackTarget && attackButton) {
        const enemies = force && state.userProfile?.role === 'player'
            ? state.militaryForces.filter(enemy => enemy.force_kind === 'land_army' && enemy.status === 'active'
                && enemy.owner !== force.owner && !enemy.in_pending_battle
                && Math.max(Math.abs(Number(enemy.cell_x) - Number(force.cell_x)), Math.abs(Number(enemy.cell_y) - Number(force.cell_y))) === 1
                && state.militaryVisibleCells.has(`${Number(enemy.cell_x)},${Number(enemy.cell_y)}`))
            : [];
        const previousTarget = attackTarget.value;
        attackTarget.innerHTML = enemies.length
            ? enemies.map(enemy => `<option value="${escapeHtml(enemy.id)}">${escapeHtml(enemy.name)} · ${escapeHtml(enemy.owner)}</option>`).join('')
            : '<option value="">Нет видимой вражеской армии рядом</option>';
        if (enemies.some(enemy => String(enemy.id) === previousTarget)) attackTarget.value = previousTarget;
        attackTarget.hidden = !enemies.length;
        attackButton.hidden = !enemies.length;
        attackButton.disabled = Number(force?.action_points) < 10;
        attackButton.title = attackButton.disabled ? 'Для приказа атаковать нужно не менее 10 ОД.' : '';
    }
    const targetSelect = panel.querySelector('[data-siege-target]');
    if (targetSelect && force) {
        const current = targetSelect.value;
        const choices = (state.dbMarkers || []).filter(marker => marker.owner && marker.owner !== force.owner && marker.type !== 'ruins'
            && (marker.type === 'fortress' || Number(marker.fortification_level) > 0)
            && (state.userProfile?.role !== 'player' || state.militaryVisibleCells.has(`${Math.floor(Number(marker.coord_1)/MILITARY_GRID_CELL_SIZE)},${Math.floor(Number(marker.coord_2)/MILITARY_GRID_CELL_SIZE)}`)));
        targetSelect.innerHTML = `<option value="">Поселение для осады</option>${choices.map(marker => `<option value="${Number(marker.id)}">${escapeHtml(marker.name || `Поселение #${marker.id}`)} · ${escapeHtml(marker.owner)}</option>`).join('')}`;
        if (choices.some(marker => String(marker.id) === current)) targetSelect.value = current;
    }
    const raidButton = panel.querySelector('[data-order-raid]');
    if (raidButton) raidButton.hidden = !force;
    const siegeButton = panel.querySelector('[data-order-siege]');
    if (siegeButton) siegeButton.hidden = !force;
}

function getReachableMilitaryCells(force) {
    const cellAt = (x, y) => {
        const key = `${x},${y}`;
        const geometry = state.militaryGridCells.get(key);
        const override = state.militaryTerrainCells.get(key);
        const bridge = !!override?.bridge || state.militaryStructures.some(item => item.structure_type === 'bridge'
            && item.status === 'active' && Number(item.available_from_turn) <= Number(state.gameCalendar?.turn)
            && Number(item.cell_x) === x && Number(item.cell_y) === y);
        return geometry ? { ...geometry, ...override, terrain: override?.terrain || geometry.base_terrain, bridge } : null;
    };
    const directions = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
    const directionBits = new Map([['1,0',1],['1,1',2],['0,1',4],['-1,1',8],['-1,0',16],['-1,-1',32],['0,-1',64],['1,-1',128]]);
    const oppositeBit = {1:16,2:32,4:64,8:128,16:1,32:2,64:4,128:8};
    const mobility = calculateArmyMobility(force.unit_groups || [], force.siege_equipment || {});
    const budget = Number(force.action_points) || 0;
    const origin = `${force.cell_x},${force.cell_y}`;
    const costs = new Map([[origin, 0]]);
    const open = new Set([origin]);
    while (open.size) {
        let current, best = Infinity;
        for (const key of open) if (costs.get(key) < best) { current = key; best = costs.get(key); }
        open.delete(current);
        const [x, y] = current.split(',').map(Number);
        const from = cellAt(x, y);
        for (const [dx, dy] of directions) {
            const nx = x + dx, ny = y + dy, key = `${nx},${ny}`, to = cellAt(nx, ny);
            if (!to?.province_id || (to.terrain === 'water' && !to.bridge)) continue;
            if (state.userProfile?.role === 'player' && !state.militaryVisibleCells.has(key)) continue;
            if (state.militaryForces.some(other => other.id !== force.id && other.force_kind === 'land_army' && other.status === 'active'
                && Number(other.cell_x) === nx && Number(other.cell_y) === ny && other.owner !== force.owner)) continue;
            if (state.militaryStructures.some(item => item.structure_type === 'palisade' && item.status === 'active'
                && Number(item.available_from_turn) <= Number(state.gameCalendar?.turn) && Number(item.cell_x) === nx && Number(item.cell_y) === ny)) continue;
            const diagonal = dx !== 0 && dy !== 0;
            if (diagonal) {
                const a = cellAt(x + dx, y), b = cellAt(x, y + dy);
                if ((!a || a.terrain === 'water' && !a.bridge) && (!b || b.terrain === 'water' && !b.bridge)) continue;
            }
            const bit = directionBits.get(`${dx},${dy}`);
            const crossing = !from?.bridge && !to.bridge && (((Number(from?.river_edges) || 0) & bit)
                || ((Number(to.river_edges) || 0) & oppositeBit[bit])) ? 1 : 0;
            const candidate = best + movementStepCost(to.terrain, diagonal, mobility, crossing);
            if (candidate > budget || candidate >= (costs.get(key) ?? Infinity)) continue;
            costs.set(key, candidate);
            open.add(key);
        }
    }
    costs.delete(origin);
    return new Set(costs.keys());
}

function planMilitaryMove(force, cellX, cellY) {
    const cellAt = (x, y) => {
        const key = `${x},${y}`;
        const geometry = state.militaryGridCells.get(key);
        const override = state.militaryTerrainCells.get(key);
        const structure = state.militaryStructures.find(item => Number(item.cell_x) === x && Number(item.cell_y) === y
            && item.structure_type === 'bridge' && item.status === 'active' && Number(item.available_from_turn) <= Number(state.gameCalendar?.turn));
        if (!geometry) return null;
        return { ...geometry, ...override, terrain: override?.terrain || geometry.base_terrain, bridge: !!override?.bridge || !!structure };
    };
    const directionBits = new Map([[`1,0`,1],[`1,1`,2],[`0,1`,4],[`-1,1`,8],[`-1,0`,16],[`-1,-1`,32],[`0,-1`,64],[`1,-1`,128]]);
    const oppositeBit = bit => ({1:16,2:32,4:64,8:128,16:1,32:2,64:4,128:8})[bit];
    const mobility = calculateArmyMobility(force.unit_groups || [], force.siege_equipment || {});
    if (state.militaryForces.some(other => other.force_kind === 'land_army' && other.status === 'active'
        && other.id !== force.id && Number(other.cell_x) === cellX && Number(other.cell_y) === cellY)) return null;
    const result = findMilitaryPath({ x: Number(force.cell_x), y: Number(force.cell_y) }, { x: cellX, y: cellY }, {
        mobility,
        remainingActionPoints: Number(force.action_points) || 0,
        getTerrain: (x, y) => cellAt(x, y)?.terrain || 'water',
        canEnter: (x, y, terrain) => {
            const cell = cellAt(x, y);
            if (!cell || !cell.province_id) return false;
            if (terrain === 'water' && !cell.bridge) return false;
            if (state.militaryStructures.some(item => item.structure_type === 'palisade' && item.status === 'active'
                && Number(item.available_from_turn) <= Number(state.gameCalendar?.turn) && Number(item.cell_x) === x && Number(item.cell_y) === y)) return false;
            return !state.militaryForces.some(other => other.force_kind === 'land_army' && other.status === 'active'
                && other.id !== force.id && other.owner !== force.owner && Number(other.cell_x) === x && Number(other.cell_y) === y);
        },
        getRiverCrossings: (x, y, nextX, nextY) => {
            const dx = nextX - x, dy = nextY - y;
            const bit = directionBits.get(`${dx},${dy}`);
            const from = cellAt(x, y), to = cellAt(nextX, nextY);
            if (!bit || from?.bridge || to?.bridge) return 0;
            return ((Number(from?.river_edges) & bit) || (Number(to?.river_edges) & oppositeBit(bit))) ? 1 : 0;
        }
    });
    if (!result.reachable) return null;
    return { forceId: force.id, path: result.path, cost: result.cost, mobility };
}

function planMilitaryTransferPath(force, selectedUnits, target) {
    const cellAt = (x, y) => {
        const key = `${x},${y}`;
        const geometry = state.militaryGridCells.get(key);
        const override = state.militaryTerrainCells.get(key);
        const bridge = state.militaryStructures.some(item => item.structure_type === 'bridge' && item.status === 'active'
            && Number(item.available_from_turn) <= Number(state.gameCalendar?.turn)
            && Number(item.cell_x) === x && Number(item.cell_y) === y);
        return geometry ? { ...geometry, ...override, terrain: override?.terrain || geometry.base_terrain,
            bridge: !!override?.bridge || bridge } : null;
    };
    const directionBits = new Map([[`1,0`,1],[`1,1`,2],[`0,1`,4],[`-1,1`,8],[`-1,0`,16],[`-1,-1`,32],[`0,-1`,64],[`1,-1`,128]]);
    const oppositeBit = bit => ({1:16,2:32,4:64,8:128,16:1,32:2,64:4,128:8})[bit];
    const mobility = calculateArmyMobility(selectedUnits, {});
    return findMilitaryPath({ x:Number(force.cell_x), y:Number(force.cell_y) }, { x:Number(target.cell_x), y:Number(target.cell_y) }, {
        mobility, remainingActionPoints:Number(force.action_points) || 0,
        getTerrain:(x,y) => cellAt(x,y)?.terrain || 'water',
        canEnter:(x,y,terrain) => {
            const cell = cellAt(x,y);
            if (!cell || !cell.province_id || (terrain === 'water' && !cell.bridge)) return false;
            if (state.militaryStructures.some(item => item.structure_type === 'palisade' && item.status === 'active'
                && Number(item.available_from_turn) <= Number(state.gameCalendar?.turn)
                && Number(item.cell_x) === x && Number(item.cell_y) === y)) return false;
            return !state.militaryForces.some(other => other.id !== force.id && other.id !== target.id
                && other.force_kind === 'land_army' && other.status === 'active'
                && Number(other.cell_x) === x && Number(other.cell_y) === y && other.owner !== force.owner);
        },
        getRiverCrossings:(x,y,nextX,nextY) => {
            const dx=nextX-x,dy=nextY-y,bit=directionBits.get(`${dx},${dy}`),from=cellAt(x,y),to=cellAt(nextX,nextY);
            if (!bit || from?.bridge || to?.bridge) return 0;
            return ((Number(from?.river_edges)&bit)||(Number(to?.river_edges)&oppositeBit(bit)))?1:0;
        }
    });
}

function planMilitaryFleetMove(fleet, cellX, cellY) {
    if (!fleet || fleet.location_kind !== 'water' || fleet.status !== 'active') return null;
    if (state.militaryFleets.some(other => other.id !== fleet.id && other.status === 'active' && other.location_kind === 'water'
        && Number(other.cell_x) === cellX && Number(other.cell_y) === cellY)) return null;
    const cellAt = (x,y) => state.militaryGridCells.get(`${x},${y}`);
    const shipTypes = (fleet.ships || []).map(ship => ship.type);
    const undercrewed = (fleet.ships || []).some(ship => Number(ship.crew) < (NAVAL_SHIP_PROFILES[ship.type]?.crew || 0));
    const slowestManeuver = Math.min(...shipTypes.map(type => Number(NAVAL_SHIP_PROFILES[type]?.maneuver) || 3));
    const result = findNavalPath({ x:Number(fleet.cell_x), y:Number(fleet.cell_y) }, { x:cellX, y:cellY }, {
        shipTypes,
        season:state.gameCalendar?.season || '',
        remainingActionPoints:Number(fleet.action_points) || 0,
        undercrewed,
        slowestManeuver,
        getWaterTypes:(x,y) => Number(cellAt(x,y)?.water_types) || 0,
        getFlowDirection:(x,y) => { const cell = cellAt(x,y); return cell && cell.flow_dx != null ? { dx:Number(cell.flow_dx), dy:Number(cell.flow_dy) } : null; },
        canEnter:(x,y) => !state.militaryFleets.some(other => other.id !== fleet.id && other.status === 'active'
            && other.location_kind === 'water' && Number(other.cell_x) === x && Number(other.cell_y) === y
            && (x === cellX && y === cellY || other.owner !== fleet.owner))
    });
    if (!result.reachable) return null;
    return { fleetId:fleet.id, path:result.path, cost:result.cost, undercrewed };
}

export function updateTransform() {
    elements.mapWrapper.style.transform = `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`;
    elements.mapWrapper.classList.toggle('pixelated', state.scale >= 1.0);
    updatePopupPosition();
}

export function updatePopupPosition() {
    if (state.selectedImgX === null || state.selectedImgY === null || elements.popup.style.display === 'none') return;
    const screenX = state.selectedImgX * state.scale + state.tx;
    const screenY = state.selectedImgY * state.scale + state.ty;
    const width = elements.popup.offsetWidth || 320;
    const height = elements.popup.offsetHeight || 240;
    const left = Math.max(12, Math.min(screenX, window.innerWidth - width - 12));
    const top = Math.max(12, Math.min(screenY, window.innerHeight - height - 12));
    elements.popup.style.left = `${left}px`;
    elements.popup.style.top = `${top}px`;
}

export function showTrackerPopup() {
    state.activePopupType = 'tracker';
    state.selectedImgX = state.trackerPos.x;
    state.selectedImgY = state.trackerPos.y;
    elements.popupContent.innerHTML = `
        <strong>Отслеживание координат</strong><br>
        coord_1 (X): ${state.trackerPos.x}<br>
        coord_2 (Y): ${state.trackerPos.y}
    `;
    elements.popup.style.display = 'block';
    updatePopupPosition();
}

function calculateEstatesBreakdown(yards, ratio) {
    if (!ratio || !yards) return { aristocracy: 0, clergy: 0, burghers: 0, peasants: 0 };
    return {
        aristocracy: Math.round(yards * (ratio.aristocracy || 0)),
        clergy: Math.round(yards * (ratio.clergy || 0)),
        burghers: Math.round(yards * (ratio.burghers || 0)),
        peasants: Math.round(yards * (ratio.peasants || 0))
    };
}

export function renderGameCalendar() {
    if (!elements.gameTurnLabel || !state.gameCalendar) return;
    const { turn, season, year } = state.gameCalendar;
    elements.gameTurnLabel.textContent = `Ход ${formatNumber(turn)} · ${season} · ${year}`;
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[character]);
}

function assimilationTurns(record, kind, name, settings) {
    if (!name || name === '—' || !settings?.[`titular_${kind}`] || name === settings[`titular_${kind}`]) return null;
    const stored = Number(record?.[`${kind}_assimilation_turns`]);
    if (stored > 0) return stored;
    return statusDefaultTurns[getStatus(settings, kind, name)] || 30;
}

function assimilationLine(record, kind, name, settings) {
    const turns = assimilationTurns(record, kind, name, settings);
    if (turns === null) return '';
    const status = statusLabels[getStatus(settings, kind, name)] || statusLabels.noninterference;
    return `<br>Ассимиляция ${kind === 'culture' ? 'культуры' : 'религии'} (${status}): ${formatNumber(turns)} ходов`;
}

function provinceProductionSummary(province) {
    const lastReport = state.economySnapshot?.reports?.find(row => row.owner === province.owner)?.report;
    const rebellion = (state.economySnapshot?.rebellions || []).find(row => row.territory_type === 'province' && Number(row.territory_id) === Number(province.id));
    const revoltText = Number(rebellion?.rebellion_turn) === Number(state.economySnapshot?.calendar?.turn) ? '<br><strong>Бунт: территория временно не приносит доходов и не производит ресурсы.</strong>' : '';
    const production = lastReport?.provinceReports?.[province.id];
    const target = state.dbMarkers.find(marker => Number(marker.id) === Number(province.target_marker_id));
    const deliveryText = production?.deliveries?.map(item => {
        const marker = state.dbMarkers.find(row => Number(row.id) === Number(item.marker_id));
        return `${item.item_name ? `${escapeHtml(item.item_name)} → ` : ''}${escapeHtml(marker?.name || 'Поселение')}: ${formatNumber(item.quantity, 2)}`;
    }).join(', ');
    const foodText = production?.food_resource ? `<br>${production.food_resource === production.resource ? 'В том числе продовольствие крестьянства' : 'Базовое продовольствие крестьянства'}: ${escapeHtml(production.food_resource)} · ${formatNumber(production.food_production, 2)} за ход` : '';
    const amountText = production ? `Последнее производство ресурса (${escapeHtml(production.resource || province.resource || '—')}): ${formatNumber(production.production, 2)} за ход${foodText}` : 'Производство появится в отчёте после расчёта хода';
    const targetText = target ? `Основной склад: ${target.name || 'Поселение'}` : 'Основной склад не назначен';
    return `<div class="popup-economy-info"><strong>Производство и продовольствие</strong>${revoltText}<br>${amountText}<br>${targetText}${deliveryText ? `<br>Поставки: ${deliveryText}` : ''}<br>Остаток в провинции: ${formatNumber(province.stored_resource_qty, 2)}</div>`;
}

function markerEconomySummary(marker) {
    const snapshot = state.economySnapshot;
    const rebellion = (snapshot?.rebellions || []).find(row => row.territory_type === 'marker' && Number(row.territory_id) === Number(marker.id));
    const provinceRebellion = (snapshot?.rebellions || []).find(row => row.territory_type === 'province' && Number(row.territory_id) === Number(marker.province_id));
    const revoltText = Number(rebellion?.rebellion_turn) === Number(snapshot?.calendar?.turn) || Number(provinceRebellion?.rebellion_turn) === Number(snapshot?.calendar?.turn) ? '<br><strong>Бунт: поселение временно не производит товары, не собирает налоги и не потребляет запасы.</strong>' : '';
    const items = snapshot?.inventories?.filter(item => Number(item.marker_id) === Number(marker.id) && Number(item.quantity) > 0) || [];
    const report = snapshot?.reports?.find(row => row.owner === marker.owner)?.report?.markerReports?.[marker.id];
    const goods = Object.entries(report?.goods_produced || {}).map(([name, quantity]) => `${escapeHtml(name)}: ${formatNumber(quantity, 2)}`).join('<br>') || 'Нет данных за последний ход';
    const stocks = items.map(item => `${escapeHtml(item.item_name)}: ${formatNumber(item.quantity, 2)} ${item.item_type === 'good' ? 'тов.' : 'рес.'}`).join('<br>') || 'Склад пуст';
    const coverage = (report?.coverage || []).filter(row => Number(row.demand) > 0).map(row => `${escapeHtml(row.need)} — ${formatNumber(Number(row.ratio) * 100, 0)}%`).join('<br>') || 'Нет данных о потреблении';
    return `<div class="popup-economy-info"><strong>Экономика поселения</strong>${revoltText}<br>Товары за последний ход:<br>${goods}<details><summary>Склад (${items.length} поз.)</summary>${stocks}</details><details><summary>Покрытие потребностей</summary>${coverage}</details></div>`;
}

export function showProvincePopup(imgX, imgY, info) {
    state.activePopupType = 'province';
    state.selectedImgX = imgX;
    state.selectedImgY = imgY;

    const dbRow = state.dbProvinces[info.id] || {};
    const name = dbRow.province_name || '—';
    const region = dbRow.region || '—';
    const owner = dbRow.owner || '—';
    const culture = dbRow.main_culture || '—';
    const religion = dbRow.main_religion || '—';
    const resource = dbRow.resource || '—';
    const provYards = Number(dbRow.yards) || 0;
    const development = Number(dbRow.development ?? 20);

    const settlements = state.dbMarkers.filter(m => Number(m.province_id) === Number(info.id));
    const settlementsYards = settlements.reduce((acc, m) => acc + (Number(m.yards) || 0), 0);
    const totalYards = provYards + settlementsYards;
    const totalPop = totalYards * 4;

    const provRatio = state.dbEstateRatios['province'];
    const estates = calculateEstatesBreakdown(provYards, provRatio);

    const isAdmin = state.userProfile?.role === 'admin';
    const mechanics = state.stateMechanics[dbRow.owner] || {};
    const cultureTurns = assimilationTurns(dbRow, 'culture', culture, mechanics);
    const religionTurns = assimilationTurns(dbRow, 'religion', religion, mechanics);
    const assimilationInputs = `${cultureTurns === null ? '' : `<label>Ассимиляция культуры, ходов:<input type="number" min="1" id="admin-prov-culture-turns" value="${cultureTurns}"></label>`}${religionTurns === null ? '' : `<label>Ассимиляция религии, ходов:<input type="number" min="1" id="admin-prov-religion-turns" value="${religionTurns}"></label>`}`;
    const playerOwner = state.userProfile?.role === 'player' ? state.userProfile.owner : null;
    const provinceSettlements = state.dbMarkers.filter(marker => Number(marker.province_id) === Number(info.id));
    const hasUncapturedSettlement = provinceSettlements.some(marker => marker.type !== 'ruins' && marker.owner !== playerOwner);
    const colonySources = state.dbMarkers.filter(marker => marker.owner === playerOwner && marker.type !== 'ruins' && Number(marker.yards) >= 50);
    const colonyEscorts = state.militaryForces.filter(force => force.owner === playerOwner && force.force_kind === 'land_army' && force.status === 'active' && !force.colonization_mission_id);
    const provincePeasantCap = dbRow.owner === playerOwner ? calculateLevyCapacity((Number(dbRow.yards)||0)*(Number(state.dbEstateRatios.province?.peasants)||0.95),'peasants') : 0;
    const provincePeasantRaised = state.militaryForces.filter(force=>force.owner===playerOwner&&force.is_militia&&force.status==='active'&&force.levy_source_kind==='peasants'&&Number(force.levy_source_id)===Number(info.id))
        .reduce((sum,force)=>sum+(force.unit_groups||[]).reduce((inner,group)=>inner+(Number(group.count)||0),0),0);
    const provincePeasantRemaining = Math.max(0,provincePeasantCap-provincePeasantRaised);
    const playerMapActions = playerOwner ? `<details class="map-operation-menu"><summary>Действия на карте</summary>
        ${!dbRow.owner ? `<details class="province-action-sub"><summary>Колонизация</summary><p>${hasUncapturedSettlement ? 'Колонизация недоступна: сначала захватите поселение в этой провинции.' : colonySources.length ? 'Колонизация возможна при наличии соседней контролируемой провинции, 50 дворов поселенцев и достаточной казны.' : 'Нет поселения с 50 дворами для отправки колонистов.'}</p>${!hasUncapturedSettlement && colonySources.length ? `<form id="map-colonization-form" class="admin-form"><label>Поселение-источник<select name="source_marker_id">${colonySources.map(marker => `<option value="${Number(marker.id)}">${escapeHtml(marker.name || `Поселение #${marker.id}`)} · ${formatNumber(marker.yards)} дворов</option>`).join('')}</select></label><label>Сопровождение<select name="force_id"><option value="">Без армии</option>${colonyEscorts.map(force => `<option value="${force.id}">${escapeHtml(force.name)}</option>`).join('')}</select></label><label>Дополнительное вложение<select name="extra"><option value="0">Нет</option><option value="1000">1 000 z · +5%</option><option value="2000">2 000 z · +10%</option></select></label><button class="admin-btn" type="submit">Начать колонизацию</button></form>` : ''}</details>` : ''}
        ${dbRow.owner === playerOwner && provinceSettlements.some(marker => marker.owner === playerOwner && marker.type !== 'ruins') ? `<details class="province-action-sub"><summary>Сбор крестьянского ополчения · доступно ${formatNumber(provincePeasantRemaining)}</summary><form id="map-province-levy-form" class="admin-form"><label>Куда направить<select name="destination">${provinceSettlements.filter(marker => marker.owner === playerOwner && marker.type !== 'ruins').map(marker => `<option value="${Number(marker.id)}">${escapeHtml(marker.name || `Поселение #${marker.id}`)}</option>`).join('')}</select></label><label>Тип войск<select name="unit">${Object.keys(LAND_UNIT_PROFILES).filter(type => LAND_UNIT_PROFILES[type].role !== 'scout').map(type => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`).join('')}</select></label><label>Численность<input name="count" type="number" min="1" max="${provincePeasantRemaining}" value="${Math.min(50,provincePeasantRemaining)}" ${provincePeasantRemaining < 1 ? 'disabled' : ''}></label><button class="admin-btn" type="submit" ${provincePeasantRemaining < 1 ? 'disabled' : ''}>Начать сбор</button><small>Доступно по текущему расчёту: ${formatNumber(provincePeasantRemaining)} бойцов из ${formatNumber(provincePeasantCap)}.</small></form></details>` : ''}
    </details>` : '';

    if (isAdmin) {
        elements.popupContent.innerHTML = `
            <strong>Редактирование провинции #${info.id}</strong>
            <form id="admin-province-form" class="admin-form">
                <label>Название:
                    <input type="text" id="admin-prov-name" value="${name === '—' ? '' : name}">
                </label>
                <label>Владелец:
                    <input type="text" id="admin-prov-owner" value="${owner === '—' ? '' : owner}">
                </label>
                <label>Культура:
                    <input type="text" id="admin-prov-culture" value="${culture === '—' ? '' : culture}">
                </label>
                <label>Религия:
                    <input type="text" id="admin-prov-religion" value="${religion === '—' ? '' : religion}">
                </label>
                <label>Ресурс:
                    <input type="text" id="admin-prov-resource" value="${resource === '—' ? '' : resource}">
                </label>
                ${provinceProductionSummary(dbRow)}
                <label>Дворы провинции:
                    <input type="number" id="admin-prov-yards" value="${provYards}">
                </label>
                <label>Развитие:
                    <input type="number" min="0" id="admin-prov-development" value="${development}">
                </label>
                ${assimilationInputs}
                <div class="admin-actions">
                    <button type="submit" class="admin-btn">Сохранить</button>
                </div>
            </form>
        `;


        document.getElementById('admin-province-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const updatedFields = {
                province_name: document.getElementById('admin-prov-name').value.trim(),
                owner: document.getElementById('admin-prov-owner').value.trim(),
                main_culture: document.getElementById('admin-prov-culture').value.trim(),
                main_religion: document.getElementById('admin-prov-religion').value.trim(),
                resource: document.getElementById('admin-prov-resource').value.trim(),
                yards: parseInt(document.getElementById('admin-prov-yards').value, 10) || 0,
                development: Math.max(0, parseInt(document.getElementById('admin-prov-development').value, 10) || 0)
            };
            const cultureTurnsInput = document.getElementById('admin-prov-culture-turns');
            const religionTurnsInput = document.getElementById('admin-prov-religion-turns');
            if (cultureTurnsInput) updatedFields.culture_assimilation_turns = Math.max(1, parseInt(cultureTurnsInput.value, 10) || cultureTurns);
            if (religionTurnsInput) updatedFields.religion_assimilation_turns = Math.max(1, parseInt(religionTurnsInput.value, 10) || religionTurns);

            try {
                await updateProvinceData(info.id, updatedFields);
                state.dbProvinces[info.id] = { ...state.dbProvinces[info.id], ...updatedFields };
                renderActiveLayer();
                showProvincePopup(imgX, imgY, info);
                showToast('Данные провинции сохранены');
            } catch (err) {
                showToast('Ошибка при сохранении провинции: ' + err.message);
            }
        });
    } else {
        elements.popupContent.innerHTML = `
            <div class="province-popup-layout">
                <header class="province-popup-heading"><strong>Провинция #${info.id} · ${escapeHtml(name)}</strong><span>${escapeHtml(region)} · ${escapeHtml(owner)}</span></header>
                <div class="province-popup-facts"><span><small>Культура</small><b>${escapeHtml(culture)}</b></span><span><small>Религия</small><b>${escapeHtml(religion)}</b></span><span><small>Развитие</small><b>${formatNumber(development)}</b></span><span><small>Ресурс</small><b>${escapeHtml(resource)}</b></span></div>
                ${provinceProductionSummary(dbRow)}
                <details class="province-popup-section province-demography"><summary>Демография · ${formatNumber(totalYards)} дворов · ${formatNumber(totalPop)} чел.</summary><div class="province-popup-facts"><span><small>В сельской провинции</small><b>${formatNumber(provYards)} дворов</b></span><span><small>В поселениях</small><b>${formatNumber(settlementsYards)} дворов</b></span></div></details>
                <details class="province-popup-section"><summary>Сословия · сельские дворы</summary><div class="province-estates"><span>Аристократия <b>${formatNumber(estates.aristocracy)}</b></span><span>Духовенство <b>${formatNumber(estates.clergy)}</b></span><span>Горожане <b>${formatNumber(estates.burghers)}</b></span><span>Крестьянство <b>${formatNumber(estates.peasants)}</b></span></div></details>
                ${playerMapActions}
            </div>
        `;


        document.getElementById('map-colonization-form')?.addEventListener('submit', async event => {
            event.preventDefault(); const form=event.currentTarget, button=form.querySelector('button[type="submit"]'); button.disabled=true;
            try { await startMilitaryColonization(Number(form.elements.source_marker_id.value),Number(info.id),Number(form.elements.extra.value),form.elements.force_id.value||null); state.militaryColonizationMap=await fetchMilitaryColonizationMap(); renderActiveLayer(); showToast('Колонизационная миссия начата.'); clearSelection(); }
            catch(error) { showToast(`Невозможно начать колонизацию: ${error.message}`,7000); button.disabled=false; }
        });
        document.getElementById('map-province-levy-form')?.addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('button[type="submit"]');button.disabled=true;try{const result=await placeMilitaryLevyOrder({levyKind:'peasants',destinationMarkerId:Number(form.elements.destination.value),unitType:form.elements.unit.value,unitCount:Number(form.elements.count.value),emergency:false});showToast(`Крестьянское ополчение собирается: ${formatNumber(result.unit_count)} бойцов, прибытие с хода ${formatNumber(result.due_turn)}.`);clearSelection();}catch(error){showToast(`Не удалось начать сбор ополчения: ${error.message}`,7000);button.disabled=false;}});
    }

    elements.popup.style.display = 'block';
    updatePopupPosition();
}

export function showMarkerPopup(marker) {
    state.activePopupType = 'marker';
    elements.highlightCtx.clearRect(0, 0, elements.highlightCanvas.width, elements.highlightCanvas.height);
    state.selectedImgX = marker.coord_1;
    state.selectedImgY = marker.coord_2;

    const yards = Number(marker.yards) || 0;
    const development = Number(marker.development ?? markerTypeDevelopment[marker.type] ?? 0);
    const pop = yards * 4;
    const ratio = state.dbEstateRatios[marker.type];
    const estates = calculateEstatesBreakdown(yards, ratio);

    const isAdmin = state.userProfile?.role === 'admin';
    const owningProvince = state.dbProvinces[Number(marker.province_id)] || {};
    const markerMechanics = state.stateMechanics[marker.owner] || {};
    const markerCultureTurns = assimilationTurns(marker, 'culture', marker.culture, markerMechanics);
    const markerReligionTurns = assimilationTurns(marker, 'religion', marker.religion, markerMechanics);
    const markerAssimilationInputs = marker.type === 'ruins' ? '' : `${markerCultureTurns === null ? '' : `<label>До смены культуры, ходов:<input type="number" min="1" id="admin-marker-culture-turns" value="${markerCultureTurns}"></label>`}${markerReligionTurns === null ? '' : `<label>До смены религии, ходов:<input type="number" min="1" id="admin-marker-religion-turns" value="${markerReligionTurns}"></label>`}`;
    const playerOwner = state.userProfile?.role === 'player' ? state.userProfile.owner : null;
    const levyUnits = Object.keys(LAND_UNIT_PROFILES).filter(name => LAND_UNIT_PROFILES[name].role !== 'scout');
    const portSources = state.dbMarkers.filter(row => row.owner === playerOwner && row.type !== 'ruins');
    const mapPortActions = marker.owner === playerOwner && marker.type !== 'ruins' ? `<section class="map-operation-menu"><strong>Порт</strong><form id="map-port-form" class="admin-form"><label>Тип порта<select name="port_type"><option value="river_port">Речной порт</option><option value="port">Морской порт</option></select></label><label>Склад материалов<select name="source_marker_id">${portSources.map(row => `<option value="${Number(row.id)}">${escapeHtml(row.name || `Поселение #${row.id}`)}</option>`).join('')}</select></label><button type="submit" class="admin-btn">Начать строительство порта</button></form><small>Речной порт: 2 000 z, 150 Древесины и 30 Инструментов. Морской: 4 000 z, 300 Древесины и 60 Инструментов.</small></section>` : '';
    const markerLevyActions = marker.owner === playerOwner && marker.type !== 'ruins' ? `<section class="map-operation-menu"><strong>Сбор ополчения</strong><p>Доступность зависит от дворов источника, культуры, уже собранных войск и снабжения.</p><form id="map-levy-form" class="admin-form"><label>Сословие источника<select name="kind"><option value="peasants">Крестьянство провинции</option><option value="burghers">Горожане</option><option value="aristocracy">Аристократия</option><option value="clergy">Духовенство</option></select></label><label>Тип отряда<select name="unit">${levyUnits.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')}</select></label><label>Численность<input name="count" type="number" min="1" max="10000" value="50"></label><label>Чрезвычайный набор<select name="emergency"><option value="false">Нет</option><option value="true">Да</option></select></label><small data-levy-limit></small><button class="admin-btn" type="submit">Начать сбор</button></form></section>` : '';
    if (isAdmin) {
        const optionsHtml = MARKER_TYPES.map(t => `<option value="${t}" ${t === marker.type ? 'selected' : ''}>${markerTypeLabels[t]}</option>`).join('');
        elements.popupContent.innerHTML = `
            <strong>Редактирование поселения</strong>
            <form id="admin-marker-form" class="admin-form">
                <label>Название:
                    <input type="text" id="admin-marker-name" value="${marker.name || ''}">
                </label>
                <label>Владелец:
                    <input type="text" id="admin-marker-owner" value="${marker.owner || ''}">
                </label>
                <label>Тип:
                    <select id="admin-marker-type">${optionsHtml}</select>
                </label>
                <label>ID Провинции:
                    <input type="number" id="admin-marker-prov-id" value="${marker.province_id || ''}">
                </label>
                <label>Культура поселения:
                    <input type="text" id="admin-marker-culture" value="${marker.culture || ''}" ${marker.type === 'ruins' ? 'disabled' : ''}>
                </label>
                <label>Религия поселения:
                    <input type="text" id="admin-marker-religion" value="${marker.religion || ''}" ${marker.type === 'ruins' ? 'disabled' : ''}>
                </label>
                ${markerAssimilationInputs}
                <label>Количество дворов:
                    <input type="number" id="admin-marker-yards" value="${yards}">
                </label>
                <label>Развитие:
                    <input type="number" min="0" id="admin-marker-development" value="${development}">
                </label>
                <label>Описание:
                    <textarea id="admin-marker-desc">${marker.description || ''}</textarea>
                </label>
                <div class="coords-row">
                    <label>Coord 1 (X):
                        <input type="number" id="admin-marker-x" value="${marker.coord_1}">
                    </label>
                    <label>Coord 2 (Y):
                        <input type="number" id="admin-marker-y" value="${marker.coord_2}">
                    </label>
                </div>
                <div class="admin-actions">
                    <button type="submit" class="admin-btn">Сохранить</button>
                    <button type="button" id="admin-marker-move-btn" class="admin-btn">Переместить</button>
                    <button type="button" id="admin-marker-delete-btn" class="admin-btn danger">Удалить</button>
                </div>
            </form>
            ${markerEconomySummary(marker)}
        `;

        const markerTypeInput = document.getElementById('admin-marker-type');
        const markerProvinceInput = document.getElementById('admin-marker-prov-id');
        const markerDevelopmentInput = document.getElementById('admin-marker-development');
        const markerCultureInput = document.getElementById('admin-marker-culture');
        const markerReligionInput = document.getElementById('admin-marker-religion');
        markerTypeInput.addEventListener('change', () => {
            markerDevelopmentInput.value = markerTypeDevelopment[markerTypeInput.value] ?? 0;
            const isRuins = markerTypeInput.value === 'ruins';
            markerCultureInput.disabled = isRuins;
            markerReligionInput.disabled = isRuins;
            if (isRuins) {
                markerCultureInput.value = '';
                markerReligionInput.value = '';
            } else {
                const province = state.dbProvinces[Number(markerProvinceInput.value)];
                if (!markerCultureInput.value.trim()) markerCultureInput.value = province?.main_culture || '';
                if (!markerReligionInput.value.trim()) markerReligionInput.value = province?.main_religion || '';
            }
        });

        document.getElementById('admin-marker-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const provIdVal = document.getElementById('admin-marker-prov-id').value;
            const markerType = markerTypeInput.value;
            const updatedFields = {
                name: document.getElementById('admin-marker-name').value.trim(),
                owner: document.getElementById('admin-marker-owner').value.trim(),
                type: markerType,
                province_id: provIdVal ? parseInt(provIdVal, 10) : null,
                culture: markerType === 'ruins' ? null : markerCultureInput.value.trim() || null,
                religion: markerType === 'ruins' ? null : markerReligionInput.value.trim() || null,
                yards: parseInt(document.getElementById('admin-marker-yards').value, 10) || 0,
                development: Math.max(0, parseInt(markerDevelopmentInput.value, 10) || 0),
                description: document.getElementById('admin-marker-desc').value.trim(),
                coord_1: parseInt(document.getElementById('admin-marker-x').value, 10),
                coord_2: parseInt(document.getElementById('admin-marker-y').value, 10)
            };
            const cultureTurnsInput = document.getElementById('admin-marker-culture-turns');
            const religionTurnsInput = document.getElementById('admin-marker-religion-turns');
            if (markerType === 'ruins' || (updatedFields.culture && updatedFields.culture === markerMechanics.titular_culture)) updatedFields.culture_assimilation_turns = null;
            else if (cultureTurnsInput) updatedFields.culture_assimilation_turns = Math.max(1, parseInt(cultureTurnsInput.value, 10) || markerCultureTurns);
            if (markerType === 'ruins' || (updatedFields.religion && updatedFields.religion === markerMechanics.titular_religion)) updatedFields.religion_assimilation_turns = null;
            else if (religionTurnsInput) updatedFields.religion_assimilation_turns = Math.max(1, parseInt(religionTurnsInput.value, 10) || markerReligionTurns);
            try {
                await updateMarkerData(marker.id, updatedFields);
                const idx = state.dbMarkers.findIndex(m => m.id === marker.id);
                if (idx !== -1) state.dbMarkers[idx] = { ...state.dbMarkers[idx], ...updatedFields };
                renderMarkers();
                renderActiveLayer();
                showMarkerPopup(state.dbMarkers[idx]);
                showToast('Поселение сохранено');
            } catch (err) {
                showToast('Ошибка изменения поселения: ' + err.message);
            }
        });

        document.getElementById('admin-marker-move-btn').addEventListener('click', () => {
            state.movingMarkerId = marker.id;
            clearSelection();
            showToast('Зажмите маркер мышью и перетащите в нужное место', 0);
        });

        document.getElementById('admin-marker-delete-btn').addEventListener('click', async () => {
            try {
                await deleteMarkerData(marker.id);
                state.dbMarkers = state.dbMarkers.filter(m => m.id !== marker.id);
                clearSelection();
                renderMarkers();
                renderActiveLayer();
                showToast('Поселение удалено');
            } catch (err) {
                showToast('Ошибка удаления поселения: ' + err.message);
            }
        });
    } else {
        elements.popupContent.innerHTML = `
            <strong>${marker.name || 'Поселение'}</strong><br>
            Тип: ${markerTypeLabels[marker.type] || marker.type}<br>
            Владелец: ${marker.owner || '—'}<br>
            Развитие: ${development}<br>
            Культура: ${marker.culture || '—'}<br>
            Религия: ${marker.religion || '—'}<br>
            ${marker.description || 'Описание отсутствует'}<br>
            <hr>
            <div class="marker-demography-grid"><section><strong>Демография</strong><span>Дворов <b>${formatNumber(yards)}</b></span><span>Население <b>${formatNumber(pop)} чел.</b></span></section><section><strong>Сословия</strong><span>Аристократия <b>${formatNumber(estates.aristocracy)}</b></span><span>Духовенство <b>${formatNumber(estates.clergy)}</b></span><span>Горожане <b>${formatNumber(estates.burghers)}</b></span><span>Крестьянство <b>${formatNumber(estates.peasants)}</b></span></section></div>
            ${markerEconomySummary(marker)}
            ${markerLevyActions}
            ${mapPortActions}
        `;
        const levyForm = document.getElementById('map-levy-form');
        if (levyForm) {
            const refreshLimit = () => {
                const kind=levyForm.elements.kind.value, province=state.dbProvinces[Number(marker.province_id)] || {};
                const estate=kind==='peasants'?'peasants':kind;
                const baseYards=kind==='peasants'?(Number(province.yards)||0):(Number(marker.yards)||0);
                const share=kind==='peasants'?(Number(state.dbEstateRatios.province?.peasants)||.95):(Number(state.dbEstateRatios[marker.type]?.[estate])||0);
                const max=calculateLevyCapacity(baseYards*share,kind,false);
                levyForm.querySelector('[data-levy-limit]').textContent=`Расчётная базовая квота источника: до ${formatNumber(max)} бойцов; сервер проверит остаток, культуру, казну и снаряжение.`;
                const culture=(kind==='peasants'?(province.main_culture||marker.culture):(marker.culture||province.main_culture)||'').toLocaleLowerCase('ru');
                [...levyForm.elements.unit.options].forEach(option=>{option.hidden=(option.value==='Арбалетчики'&&!(/свей|эст/.test(culture)))||(option.value==='Конные лучники'&&!culture.includes('казан'))||(kind==='aristocracy'&&LAND_UNIT_PROFILES[option.value]?.role!=='cavalry')||(kind!=='aristocracy'&&kind!=='peasants'&&LAND_UNIT_PROFILES[option.value]?.role==='cavalry');});
            };
            levyForm.elements.kind.addEventListener('change',refreshLimit); refreshLimit();
            levyForm.addEventListener('submit',async event=>{event.preventDefault();const button=levyForm.querySelector('button[type="submit"]');button.disabled=true;try{const result=await placeMilitaryLevyOrder({levyKind:levyForm.elements.kind.value,destinationMarkerId:Number(marker.id),unitType:levyForm.elements.unit.value,unitCount:Number(levyForm.elements.count.value),emergency:levyForm.elements.emergency.value==='true'});showToast(`Сбор ополчения начат: ${formatNumber(result.unit_count)} бойцов, прибытие с хода ${formatNumber(result.due_turn)}.`);clearSelection();}catch(error){showToast(`Не удалось начать сбор ополчения: ${error.message}`,7000);button.disabled=false;}});
        }
        document.getElementById('map-port-form')?.addEventListener('submit', async event => {
            event.preventDefault(); const form=event.currentTarget,button=form.querySelector('button[type="submit"]'); button.disabled=true;
            try { await buildMilitaryPort(Number(marker.id),form.elements.port_type.value,Number(form.elements.source_marker_id.value)); showToast('Строительство порта начато; оно займёт сезон.'); clearSelection(); }
            catch(error) { showToast(`Не удалось начать строительство порта: ${error.message}`,7000); button.disabled=false; }
        });
    }

    elements.popup.style.display = 'block';
    updatePopupPosition();
}

export function showNewMarkerPopup(imgX, imgY) {
    state.activePopupType = 'new_marker';
    state.selectedImgX = imgX;
    state.selectedImgY = imgY;

    const optionsHtml = MARKER_TYPES.map(t => `<option value="${t}">${markerTypeLabels[t]}</option>`).join('');
    elements.popupContent.innerHTML = `
        <strong>Создание поселения</strong>
        <form id="admin-new-marker-form" class="admin-form">
            <label>Название:
                <input type="text" id="new-marker-name" required>
            </label>
            <label>Тип:
                <select id="new-marker-type">${optionsHtml}</select>
            </label>
            <label>ID Провинции:
                <input type="number" id="new-marker-prov-id">
            </label>
            <label>Культура поселения:
                <input type="text" id="new-marker-culture">
            </label>
            <label>Религия поселения:
                <input type="text" id="new-marker-religion">
            </label>
            <label>Количество дворов:
                <input type="number" id="new-marker-yards" value="0">
            </label>
            <label>Развитие:
                <input type="number" min="0" id="new-marker-development" value="200">
            </label>
            <label>Описание:
                <textarea id="new-marker-desc"></textarea>
            </label>
            <div class="coords-row">
                <label>Coord 1 (X):
                    <input type="number" id="new-marker-x" value="${imgX}" readonly>
                </label>
                <label>Coord 2 (Y):
                    <input type="number" id="new-marker-y" value="${imgY}" readonly>
                </label>
            </div>
            <div class="admin-actions">
                <button type="submit" class="admin-btn">Создать</button>
            </div>
        </form>
    `;

    const newMarkerTypeInput = document.getElementById('new-marker-type');
    const newMarkerProvinceInput = document.getElementById('new-marker-prov-id');
    const newMarkerCultureInput = document.getElementById('new-marker-culture');
    const newMarkerReligionInput = document.getElementById('new-marker-religion');
    const newMarkerDevelopmentInput = document.getElementById('new-marker-development');
    const syncNewMarkerCultureReligion = () => {
        const isRuins = newMarkerTypeInput.value === 'ruins';
        newMarkerCultureInput.disabled = isRuins;
        newMarkerReligionInput.disabled = isRuins;
        if (isRuins) {
            newMarkerCultureInput.value = '';
            newMarkerReligionInput.value = '';
            return;
        }

        const province = state.dbProvinces[Number(newMarkerProvinceInput.value)];
        newMarkerCultureInput.value = province?.main_culture || '';
        newMarkerReligionInput.value = province?.main_religion || '';
    };
    newMarkerTypeInput.addEventListener('change', syncNewMarkerCultureReligion);
    newMarkerTypeInput.addEventListener('change', () => { newMarkerDevelopmentInput.value = markerTypeDevelopment[newMarkerTypeInput.value] ?? 0; });
    newMarkerProvinceInput.addEventListener('input', syncNewMarkerCultureReligion);
    syncNewMarkerCultureReligion();

    document.getElementById('admin-new-marker-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const provIdVal = document.getElementById('new-marker-prov-id').value;
        const markerType = newMarkerTypeInput.value;
        const markerData = {
            name: document.getElementById('new-marker-name').value.trim(),
            type: markerType,
            province_id: provIdVal ? parseInt(provIdVal, 10) : null,
            culture: markerType === 'ruins' ? null : newMarkerCultureInput.value.trim() || null,
            religion: markerType === 'ruins' ? null : newMarkerReligionInput.value.trim() || null,
            yards: parseInt(document.getElementById('new-marker-yards').value, 10) || 0,
            development: Math.max(0, parseInt(newMarkerDevelopmentInput.value, 10) || 0),
            description: document.getElementById('new-marker-desc').value.trim(),
            coord_1: imgX,
            coord_2: imgY
        };

        try {
            const created = await createMarkerData(markerData);
            if (created && created[0]) state.dbMarkers.push(created[0]);
            state.isAddingMarkerMode = false;
            elements.addMarkerModeBtn.classList.remove('active');
            renderMarkers();
            renderActiveLayer();
            clearSelection();
            showToast('Поселение успешно создано');
        } catch (err) {
            showToast('Ошибка создания поселения: ' + err.message);
        }
    });

    elements.popup.style.display = 'block';
    updatePopupPosition();
}

export function clearSelection() {
    state.activePopupType = null;
    state.selectedImgX = null;
    state.selectedImgY = null;
    elements.highlightCtx.clearRect(0, 0, elements.highlightCanvas.width, elements.highlightCanvas.height);
    elements.popup.style.display = 'none';
}

export function goToProvince(provinceId) {
    const hex = state.idToHexMap[provinceId];
    if (!hex) {
        showToast('Провинция с таким ID не найдена');
        return;
    }

    const info = state.provincesMeta[hex];
    const [centerX, centerY] = info.center;

    state.tx = window.innerWidth / 2 - centerX * state.scale;
    state.ty = window.innerHeight / 2 - centerY * state.scale;

    updateTransform();
    highlightProvince(hex);
    showProvincePopup(Math.floor(centerX), Math.floor(centerY), info);
}

function showPageView(title, content, options = {}) {
    if (!elements.pageView) return;

    state.isDragging = false;
    state.isDraggingMarker = false;
    state.isDraggingTracker = false;
    elements.popup.style.display = 'none';
    const navItems = getNavigationItems();
    elements.pageView.innerHTML = `
        <nav class="page-nav" aria-label="Разделы государства">
            <div class="page-nav-brand">SIXIÈME TERRE</div>
            ${navItems.map(item => `<button class="page-nav-item ${item.id === options.navId ? 'active' : ''}" data-page-nav="${item.id}" ${item.externalUrl ? `data-url="${item.externalUrl}"` : ''}>${escapeHtml(item.label)}</button>`).join('')}
        </nav>
        <div class="page-shell">
            <header class="page-header">
                <div>
                    <div class="page-eyebrow">SIXIÈME TERRE <span>/</span> ${escapeHtml(options.section || title)}</div>
                    <h1>${escapeHtml(title)}</h1>
                    ${options.subtitle ? `<p class="page-subtitle">${escapeHtml(options.subtitle)}</p>` : ''}
                </div>
                <div class="page-header-actions">
                    ${options.onBack ? `<button id="page-back-btn" class="page-back-btn">${escapeHtml(options.backLabel || 'Назад')}</button>` : ''}
                    <button id="page-map-btn" class="page-map-btn">← На карту</button>
                </div>
            </header>
            <main class="page-content">${content}</main>
        </div>
    `;
    elements.pageView.classList.add('active');
    elements.pageView.scrollTop = 0;
    syncMilitaryMovePanel();
    document.getElementById('page-map-btn')?.addEventListener('click', closePageView);
    document.getElementById('page-back-btn')?.addEventListener('click', options.onBack);
    elements.pageView.querySelectorAll('[data-page-nav]').forEach(button => button.addEventListener('click', () => activateNavigationItem(button.dataset.pageNav, button.dataset.url)));
}

function closePageView() {
    elements.pageView?.classList.remove('active');
    if (elements.pageView) elements.pageView.innerHTML = '';
    syncMilitaryMovePanel();
}

function getOwnerStatistics(owner) {
    const provinces = Object.values(state.dbProvinces).filter(province => province.owner === owner || province.occupied_by === owner);
    const provinceIds = new Set(provinces.filter(province => province.owner === owner).map(province => Number(province.id)));
    const settlements = state.dbMarkers.filter(marker => marker.owner === owner || marker.military_controlled_by === owner || provinceIds.has(Number(marker.province_id)));
    const sum = (rows, key) => rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
    const provinceYards = sum(provinces, 'yards');
    const settlementYards = sum(settlements, 'yards');
    const estateYards = { aristocracy: 0, clergy: 0, burghers: 0, peasants: 0 };

    const addEstates = (yards, type) => {
        const result = calculateEstatesBreakdown(yards, state.dbEstateRatios[type]);
        for (const estate of Object.keys(estateYards)) estateYards[estate] += result[estate];
    };
    provinces.forEach(province => addEstates(Number(province.yards) || 0, 'province'));
    settlements.forEach(marker => addEstates(Number(marker.yards) || 0, marker.type));

    const cultureGroups = new Map();
    const religionGroups = new Map();
    const addPopulation = (map, label, yards) => {
        const key = String(label || '').trim();
        if (key) {
            const group = map.get(key) || { yards: 0, population: 0 };
            group.yards += yards;
            group.population += yards * 4;
            map.set(key, group);
        }
    };
    provinces.forEach(province => {
        const yards = Number(province.yards) || 0;
        addPopulation(cultureGroups, province.main_culture, yards);
        addPopulation(religionGroups, province.main_religion, yards);
    });
    settlements.forEach(marker => {
        const yards = Number(marker.yards) || 0;
        addPopulation(cultureGroups, marker.culture, yards);
        addPopulation(religionGroups, marker.religion, yards);
    });
    const totalYards = provinceYards + settlementYards;
    return {
        provinces,
        settlements,
        provinceYards,
        settlementYards,
        totalYards,
        population: totalYards * 4,
        estateYards,
        cultureGroups,
        religionGroups
    };
}

function formatNumber(value, digits = 0) {
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(value);
}

function renderPieChart(title, entries) {
    const values = [...entries].filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]);
    const total = values.reduce((sum, [, value]) => sum + value, 0);
    if (!total) return `<section class="page-panel distribution-panel"><h2>${escapeHtml(title)}</h2><p class="page-empty">Нет данных для распределения.</p></section>`;
    const palette = ['#c9a96e','#7e9a78','#8799b8','#b77d65','#9c83ad','#d4c18a','#5eaaa0','#c87891','#8c9870','#a78561'];
    let cursor = 0;
    const slices = values.map(([, value], index) => {
        const start = cursor;
        cursor += value / total * 100;
        return `${palette[index % palette.length]} ${start}% ${cursor}%`;
    });
    const legend = values.map(([label, value], index) => `<li><i style="--slice-color:${palette[index % palette.length]}"></i><span>${escapeHtml(label)}</span><strong>${formatNumber(value)} чел.</strong><small>${formatNumber(value / total * 100, 1)}%</small></li>`).join('');
    return `<section class="page-panel distribution-panel"><div class="page-panel-heading"><div><h2>${escapeHtml(title)}</h2><p>Расчёт по численности населения в доступных данных.</p></div></div><div class="pie-layout"><div class="pie-chart" role="img" aria-label="${escapeHtml(title)}" style="--pie:${slices.join(',')}"><span>${formatNumber(total)}<small>чел.</small></span></div><ul class="pie-legend">${legend}</ul></div></section>`;
}

const statusLabels = { recognition: 'Признание', noninterference: 'Невмешательство', expulsion: 'Изгнание' };
const statusOptions = Object.entries(statusLabels);
const statusDefaultTurns = { recognition: 60, noninterference: 30, expulsion: 10 };
const estateNames = [['aristocracy','Аристократия'],['clergy','Духовенство'],['burghers','Горожане'],['peasants','Крестьянство']];

function defaultCultureReligionStatus(kind, name, settings = {}) {
    return kind === 'religion' && name.toLocaleLowerCase('ru') === 'язычество' && settings.titular_religion === 'Ислам' ? 'expulsion' : 'noninterference';
}

function getStatus(settings, kind, name) {
    return settings?.[`${kind}_status`]?.[name]?.status || defaultCultureReligionStatus(kind, name, settings);
}

function demographicRows(groups, kind, settings, titularName, modifiers=[]) {
    return [...groups.entries()].sort((a, b) => b[1].population - a[1].population).map(([name, values]) => {
        const isTitular = name === titularName;
        const forcedExpulsion = kind === 'religion' && name.toLocaleLowerCase('ru') === 'язычество' && settings.titular_religion === 'Ислам';
        const status = isTitular ? 'Титульная' : (statusLabels[getStatus(settings, kind, name)] || statusLabels.noninterference);
        const loyaltyBase = Number(settings?.[`${kind}_loyalty`]?.[name] ?? 50);
        const loyaltyEffect = modifierValue(modifiers, `${kind}_loyalty_pp`, { [kind]: name });
        const loyalty = Math.max(0,Math.min(100,loyaltyBase+loyaltyEffect));
        const isAdmin = state.userProfile?.role === 'admin';
        const control = isTitular || forcedExpulsion || !isAdmin ? status : `<select data-status-kind="${kind}" data-status-name="${escapeHtml(name)}">${statusOptions.map(([value, label]) => `<option value="${value}" ${value === getStatus(settings, kind, name) ? 'selected' : ''}>${label}</option>`).join('')}</select>`;
        const loyaltyInput = isAdmin ? `<input class="stat-loyalty-input" type="number" min="0" max="100" step="1" data-loyalty-kind="${kind}" data-loyalty-name="${escapeHtml(name)}" data-loyalty-offset="${loyaltyEffect}" value="${loyalty}"> %` : `${loyalty}%`;
        return `<tr><td>${escapeHtml(name)}</td><td>${control}</td><td>${formatNumber(values.yards)} дв.</td><td>${formatNumber(values.population)} чел.</td><td>${loyaltyInput}</td></tr>`;
    }).join('');
}

async function renderStateStatistics(owner, playerName = '', options = {}) {
    activePageOwner = owner;
    const stats = getOwnerStatistics(owner);
    showPageView('Статистика', '<div class="page-loading">Загружаю статистику государства…</div>', {
        section: 'Статистика государства', navId: 'nav-stats', subtitle: `${owner}${playerName ? ` · игрок ${playerName}` : ''}`
    });
    try {
        const settings = state.stateMechanics[owner] ?? await fetchStateMechanics(owner) ?? {};
        state.stateMechanics[owner] = settings;
        const modifierSnapshot = state.economySnapshot || await fetchEconomySnapshot();
        state.economySnapshot = modifierSnapshot;
        const stateModifiers = getOwnerModifiers(owner, modifierSnapshot, modifierSnapshot.calendar?.turn || 1);
        const titularCulture = settings.titular_culture || '';
        const titularReligion = settings.titular_religion || '';
        const isAdmin = state.userProfile?.role === 'admin';
        const gameYear = Number(state.gameCalendar?.year) || 1450;
        const estateTaxLocked = !isAdmin && Number(settings.tax_rates_last_changed_year) === gameYear;
        const estateRows = estateNames.map(([key, label]) => {
            const yards = stats.estateYards[key];
            const loyaltyBase = Number(settings.estate_loyalty?.[key] ?? 50);
            const loyaltyEffect = modifierValue(stateModifiers,'estate_loyalty_pp',{estate:key});
            const loyalty = Math.max(0,Math.min(100,loyaltyBase+loyaltyEffect));
            const rate = Number(settings.tax_rates?.[key] ?? { aristocracy: 10, clergy: 1, burghers: 2, peasants: 1 }[key]);
            const loyaltyCell = isAdmin ? `<input class="stat-loyalty-input" type="number" min="0" max="100" step="1" data-loyalty-kind="estate" data-loyalty-name="${key}" data-loyalty-offset="${loyaltyEffect}" value="${loyalty}"> %` : `${loyalty}%`;
            return `<tr><td>${label}</td><td><input class="stat-tax-input" name="tax_${key}" type="number" min="0" step="0.1" value="${rate}" ${estateTaxLocked ? 'readonly title="Ставки уже менялись в этом игровом году"' : ''}> z/двор</td><td>${formatNumber(yards)} дв.</td><td>${formatNumber(yards * 4)} чел.</td><td>${loyaltyCell}</td></tr>`;
        }).join('');
        const culturePie = new Map([...stats.cultureGroups].map(([name, group]) => [name, group.population]));
        const religionPie = new Map([...stats.religionGroups].map(([name, group]) => [name, group.population]));
        const titleOptions = (groups, selected) => `<option value="">— не выбрана —</option>${[...groups.keys()].sort((a,b) => a.localeCompare(b, 'ru')).map(name => `<option value="${escapeHtml(name)}" ${name === selected ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}`;
        const adminTitles = isAdmin ? `<div class="stat-titular-settings"><label>Титульная культура<select name="titular_culture">${titleOptions(stats.cultureGroups, titularCulture)}</select></label><label>Титульная религия<select name="titular_religion">${titleOptions(stats.religionGroups, titularReligion)}</select></label></div>` : '';
        const governmentForm = settings.government_form || '';
        const governmentField = isAdmin ? `<label class="government-form-field"><span>Форма правления</span><select name="government_form"><option value="">— не выбрана —</option>${governmentForms.map(form => `<option value="${escapeHtml(form)}" ${form === governmentForm ? 'selected' : ''}>${escapeHtml(form)}</option>`).join('')}</select></label>` : `<span class="government-form-readonly"><span>Форма правления</span><strong>${escapeHtml(governmentForm || 'не указана')}</strong></span>`;
        const stateIdentity = `<section class="page-panel state-identity-panel"><div class="state-identity-symbol"><div class="symbol-frame">${settings.state_symbol_url ? `<img class="state-symbol-preview" src="${escapeHtml(settings.state_symbol_url)}" alt="Символика государства">` : '<div class="state-symbol-empty">Изображение не загружено</div>'}<button class="symbol-edit-btn" type="button" aria-label="Редактировать символику" title="Редактировать символику">✎</button></div><dialog id="state-symbol-dialog" class="state-symbol-dialog"><div class="symbol-dialog-heading"><h2>Символика государства</h2><button type="button" class="symbol-dialog-close" aria-label="Закрыть">×</button></div><p>Загрузите флаг или герб в формате PNG, JPEG или WebP. Максимальный размер — 2 МБ.</p><label class="symbol-upload-label">Выбрать изображение<input id="state-symbol-file" type="file" accept="image/png,image/jpeg,image/webp"></label>${settings.state_symbol_path ? '<button id="state-symbol-remove" class="page-back-btn" type="button">Удалить изображение</button>' : ''}<span id="state-symbol-status" aria-live="polite"></span></dialog></div><div class="state-identity-details"><h2>${escapeHtml(owner)}</h2><div class="state-identity-titles"><span><span>Титульная культура</span><strong>${escapeHtml(titularCulture || 'не указана')}</strong></span><span><span>Титульная религия</span><strong>${escapeHtml(titularReligion || 'не указана')}</strong></span>${governmentField}</div></div></section>`;
        const ruler = settings.ruler || {};
        const rulerVacant = ruler.status === 'vacant';
        const vacancyDeadline = Number.isFinite(Number(ruler.vacant_since_turn)) ? Number(ruler.vacant_since_turn) + 4 : null;
        const vacancyTurnNote = rulerVacant && vacancyDeadline !== null ? (Number(state.gameCalendar?.turn) > vacancyDeadline ? ` · срок назначения преемника пропущен (до хода ${vacancyDeadline})` : ` · преемника нужно утвердить до хода ${vacancyDeadline}`) : '';
        const rulerStatus = rulerVacant ? `Вакантно${ruler.deceased_name ? ` · последний правитель: ${escapeHtml(ruler.deceased_name)}` : ''}${vacancyTurnNote}` : 'Действующий правитель';
        const rulerNomination = !isAdmin && governmentForm === 'Феодальная монархия' && !rulerVacant
            ? `<div class="ruler-action-fields"><label>Наследник<input id="ruler-heir-name" maxlength="80" value="${escapeHtml(ruler.heir_name || '')}"></label><label>Возраст наследника<input id="ruler-heir-age" type="number" min="16" max="100" value="${Number(ruler.heir_age) || 16}"></label><button class="compact-add-btn" id="ruler-heir-save" type="button">Сохранить наследника</button></div>`
            : '';
        const rulerProposal = rulerVacant && !isAdmin
            ? `<div class="ruler-action-fields"><label>Кандидат<input id="ruler-candidate-name" maxlength="80"></label><label>Титул<input id="ruler-candidate-title" maxlength="80"></label><label>Возраст<input id="ruler-candidate-age" type="number" min="16" max="100" value="30"></label><button class="compact-add-btn" id="ruler-propose" type="button">Предложить преемника</button></div>`
            : '';
        const rulerApproval = isAdmin && rulerVacant && ruler.proposal_name
            ? `<div class="ruler-pending-proposal"><span>Кандидат: <strong>${escapeHtml(ruler.proposal_name)}</strong>, ${Number(ruler.proposal_age) || '—'} лет${ruler.proposal_title ? ` · ${escapeHtml(ruler.proposal_title)}` : ''}</span><button class="compact-add-btn" type="button" data-ruler-decision="approve">Утвердить</button><button class="page-back-btn" type="button" data-ruler-decision="reject">Отклонить</button></div>`
            : '';
        const rulerFields = `<section class="page-panel ruler-panel"><div class="page-panel-heading"><div><h2>Правитель</h2><p>${rulerStatus}. Возраст автоматически увеличивается раз в игровой год; начиная с 50 лет проводится проверка риска смерти от старости.</p></div></div><div class="ruler-fields"><label>Имя<input name="ruler_name" maxlength="80" value="${escapeHtml(ruler.name || '')}" ${isAdmin || rulerVacant ? 'readonly' : ''}></label><label>Титул<input name="ruler_title" maxlength="80" value="${escapeHtml(ruler.title || '')}" ${isAdmin || rulerVacant ? 'readonly' : ''}></label><label>Возраст<input type="number" value="${Number(ruler.age) || 0}" readonly></label>${governmentForm === 'Вечевая республика' && ruler.term_end_year ? `<label>Окончание срока<input value="${Number(ruler.term_end_year)} г." readonly></label>` : ''}</div>${rulerNomination}${rulerProposal}${rulerApproval}<span id="ruler-action-status" class="page-note" aria-live="polite"></span></section>`;
        const crime = Math.max(0,Math.min(100,Number(settings.crime_rate ?? 20)+modifierValue(stateModifiers,'crime_rate_pp')));
        const corruption = Math.max(0,Math.min(100,Number(settings.corruption_rate ?? 20)+modifierValue(stateModifiers,'corruption_rate_pp')));
        const socialSection = (title, rows, key) => `<div class="statistic-pair"><section class="page-panel"><div class="page-panel-heading"><div><h2>${title}</h2>${key === 'estate' ? `<p>${estateTaxLocked ? 'Ставки уже менялись в этом игровом году.' : 'Игрок может менять ставки раз в игровой год; смена каждой ставки стоит 3 ОП.'}${isAdmin ? ' Администратор может менять их без ограничений и расходов.' : ''}</p>` : ''}</div></div><div class="page-table-wrap"><table class="page-table"><thead><tr><th>${key === 'estate' ? 'Сословие' : key === 'culture' ? 'Культура' : 'Религия'}</th>${key === 'estate' ? '<th>Налоговая ставка</th>' : '<th>Статус</th>'}<th>Дворы</th><th>Население</th><th>Лояльность</th></tr></thead><tbody>${rows || `<tr><td colspan="5">Нет данных.</td></tr>`}</tbody></table></div></section>${renderPieChart(`Население по ${key === 'estate' ? 'сословиям' : key === 'culture' ? 'культурам' : 'религиям'}`, key === 'estate' ? Object.entries(stats.estateYards).map(([estate, yards]) => [estateNames.find(([id]) => id === estate)[1], yards * 4]) : key === 'culture' ? culturePie : religionPie)}</div>`;
        const content = `${stats.provinces.length === 0 ? '<div class="page-empty">В базе пока нет провинций, закреплённых за этим государством.</div>' : ''}
            <form id="state-statistics-form">
            ${stateIdentity}
            <section class="stat-overview" aria-label="Краткая статистика">
                <div><span>Население</span><strong>${formatNumber(stats.population)}</strong><small>${formatNumber(stats.totalYards)} дворов</small></div>
                <div><span>Провинции</span><strong>${formatNumber(stats.provinces.length)}</strong><small>под контролем</small></div>
                <div><span>Поселения</span><strong>${formatNumber(stats.settlements.length)}</strong><small>${formatNumber(stats.settlementYards)} дворов</small></div>
                <div><span>Преступность</span><strong>${formatNumber(crime)}%</strong><small>текущий показатель</small></div>
                <div><span>Коррупция</span><strong>${formatNumber(corruption)}%</strong><small>текущий показатель</small></div>
            </section>
                ${adminTitles}
                ${rulerFields}
                ${socialSection('Сословия', estateRows, 'estate')}
                ${socialSection('Культуры', demographicRows(stats.cultureGroups, 'culture', settings, titularCulture, stateModifiers), 'culture')}
                ${socialSection('Религии', demographicRows(stats.religionGroups, 'religion', settings, titularReligion, stateModifiers), 'religion')}
                <div class="mechanics-save-row"><button class="page-map-btn" type="submit">Сохранить данные статистики</button><span id="statistics-save-status" aria-live="polite"></span></div>
            </form>
            `;
        showPageView('Статистика', content, {
            section: 'Статистика государства', navId: 'nav-stats',
            subtitle: `${owner}${playerName ? ` · игрок ${playerName}` : ''}`,
            onBack: options.onBack, backLabel: options.backLabel
        });
        elements.pageView.querySelector('#state-statistics-form').addEventListener('submit', async event => {
            event.preventDefault();
            const form = event.currentTarget;
            const status = form.querySelector('#statistics-save-status');
            const next = { ...settings, tax_rates: { ...(settings.tax_rates || {}) }, estate_loyalty: { ...(settings.estate_loyalty || {}) }, culture_status: { ...(settings.culture_status || {}) }, religion_status: { ...(settings.religion_status || {}) }, culture_loyalty: { ...(settings.culture_loyalty || {}) }, religion_loyalty: { ...(settings.religion_loyalty || {}) } };
            const defaultTaxRates = { aristocracy: 10, clergy: 1, burghers: 2, peasants: 1 };
            const proposedTaxRates = Object.fromEntries(estateNames.map(([key]) => [key, Math.max(0, Number(form.elements[`tax_${key}`]?.value ?? settings.tax_rates?.[key] ?? defaultTaxRates[key]) || 0)]));
            const changedTaxRates = estateNames.filter(([key]) => proposedTaxRates[key] !== Number(settings.tax_rates?.[key] ?? defaultTaxRates[key]));
            const taxChanged = changedTaxRates.length > 0;
            if (taxChanged && !isAdmin && Number(settings.tax_rates_last_changed_year) === gameYear) {
                status.textContent = 'Налоговые ставки можно менять один раз за игровой год.';
                return;
            }
            const estateTaxCost = isAdmin ? 0 : changedTaxRates.length * 3;
            const availablePrestige = Math.max(0, Number(settings.economy?.prestige) || 0);
            if (availablePrestige < estateTaxCost) {
                status.textContent = `Недостаточно престижа: нужно ${estateTaxCost} ОП, доступно ${availablePrestige} ОП.`;
                return;
            }
            Object.assign(next.tax_rates, proposedTaxRates);
            if (taxChanged && !isAdmin) next.tax_rates_last_changed_year = gameYear;
            if (estateTaxCost > 0) next.economy = { ...(settings.economy || {}), prestige: availablePrestige - estateTaxCost };
            form.querySelectorAll('[data-status-kind]').forEach(select => {
                const key = select.dataset.statusName;
                next[`${select.dataset.statusKind}_status`][key] = { ...(next[`${select.dataset.statusKind}_status`][key] || {}), status: select.value };
            });
            if (isAdmin) form.querySelectorAll('[data-loyalty-kind]').forEach(input => {
                const kind = input.dataset.loyaltyKind;
                const name = input.dataset.loyaltyName;
                next[`${kind}_loyalty`][name] = Math.max(0, Math.min(100, (Number(input.value) || 0) - (Number(input.dataset.loyaltyOffset) || 0)));
            });
            if (isAdmin) {
                next.titular_culture = form.elements.titular_culture.value;
                next.titular_religion = form.elements.titular_religion.value;
                next.government_form = form.elements.government_form.value;
            } else {
                next.ruler = { ...(settings.ruler || {}), name: form.elements.ruler_name.value.trim(), title: form.elements.ruler_title.value.trim() };
            }
            try {
                state.stateMechanics[owner] = await saveStateMechanics(owner, next);
                await renderStateStatistics(owner, playerName, options);
            } catch (error) {
                status.textContent = `Ошибка сохранения: ${error.message}`;
            }
        });
        elements.pageView.querySelector('#ruler-heir-save')?.addEventListener('click', async event => {
            const button = event.currentTarget, status = elements.pageView.querySelector('#ruler-action-status'); button.disabled = true;
            try { await setStateRulerHeir(elements.pageView.querySelector('#ruler-heir-name').value.trim(), Number(elements.pageView.querySelector('#ruler-heir-age').value)); state.stateMechanics[owner] = await fetchStateMechanics(owner); showToast('Наследник сохранён'); await renderStateStatistics(owner, playerName, options); }
            catch (error) { status.textContent = `Не удалось назначить наследника: ${error.message}`; button.disabled = false; }
        });
        elements.pageView.querySelector('#ruler-propose')?.addEventListener('click', async event => {
            const button = event.currentTarget, status = elements.pageView.querySelector('#ruler-action-status'); button.disabled = true;
            try { await proposeStateRuler(elements.pageView.querySelector('#ruler-candidate-name').value.trim(), elements.pageView.querySelector('#ruler-candidate-title').value.trim(), Number(elements.pageView.querySelector('#ruler-candidate-age').value)); showToast('Кандидат направлен администратору на утверждение'); await renderStateStatistics(owner, playerName, options); }
            catch (error) { status.textContent = `Не удалось предложить преемника: ${error.message}`; button.disabled = false; }
        });
        elements.pageView.querySelectorAll('[data-ruler-decision]').forEach(button => button.addEventListener('click', async event => {
            const control = event.currentTarget; control.disabled = true;
            try { await resolveStateRulerProposal(owner, control.dataset.rulerDecision === 'approve'); showToast(control.dataset.rulerDecision === 'approve' ? 'Преемник утверждён' : 'Предложение отклонено'); await renderStateStatistics(owner, playerName, options); }
            catch (error) { showToast(`Не удалось обработать предложение: ${error.message}`); control.disabled = false; }
        }));
        const symbolDialog = elements.pageView.querySelector('#state-symbol-dialog');
        elements.pageView.querySelector('.symbol-edit-btn')?.addEventListener('click', () => symbolDialog?.showModal());
        elements.pageView.querySelector('.symbol-dialog-close')?.addEventListener('click', () => symbolDialog?.close());
        symbolDialog?.addEventListener('click', event => { if (event.target === symbolDialog) symbolDialog.close(); });
        const symbolInput = elements.pageView.querySelector('#state-symbol-file');
        symbolInput?.addEventListener('change', async () => {
            const file = symbolInput.files?.[0];
            if (!file) return;
            const symbolStatus = elements.pageView.querySelector('#state-symbol-status');
            if (file.size > 2 * 1024 * 1024) { symbolStatus.textContent = 'Изображение больше 2 МБ.'; symbolInput.value = ''; return; }
            if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { symbolStatus.textContent = 'Выберите PNG, JPEG или WebP.'; symbolInput.value = ''; return; }
            symbolInput.disabled = true;
            symbolStatus.textContent = 'Загрузка…';
            try {
                const uploaded = await uploadStateSymbol(owner, file);
                const next = { ...settings, state_symbol_path: uploaded.path, state_symbol_url: uploaded.url };
                state.stateMechanics[owner] = await saveStateMechanics(owner, next);
                await renderStateStatistics(owner, playerName, options);
                showToast('Символика государства сохранена');
            } catch (error) {
                symbolStatus.textContent = `Не удалось загрузить: ${error.message}`;
                symbolInput.disabled = false;
            }
        });
        elements.pageView.querySelector('#state-symbol-remove')?.addEventListener('click', async event => {
            const button = event.currentTarget;
            button.disabled = true;
            const symbolStatus = elements.pageView.querySelector('#state-symbol-status');
            try {
                const next = { ...settings, state_symbol_path: null, state_symbol_url: null };
                state.stateMechanics[owner] = await saveStateMechanics(owner, next);
                if (settings.state_symbol_path) await deleteStateSymbol(settings.state_symbol_path);
                await renderStateStatistics(owner, playerName, options);
            } catch (error) {
                symbolStatus.textContent = `Не удалось удалить символику: ${error.message}`;
                button.disabled = false;
            }
        });
    } catch (error) {
        showPageView('Статистика', `<div class="page-error">Не удалось загрузить настройки государства: ${escapeHtml(error.message)}</div>`, { navId: 'nav-stats', subtitle: owner });
    }
}

async function renderAdminStateList() {
    activePageOwner = '';
    showPageView('Статистика игроков', '<div class="page-loading">Загружаю список игроков…</div>', { navId: 'nav-stats' });
    try {
        const profiles = (await fetchStateProfiles()).filter(profile => String(profile.owner || '').trim());
        if (!profiles.length) {
            showPageView('Статистика игроков', '<div class="page-empty">Пока нет игроков с назначенными государствами.</div>', { navId: 'nav-stats' });
            return;
        }

        const cards = profiles.map((profile, index) => {
            const stats = getOwnerStatistics(profile.owner);
            return `<button class="player-state-card" data-player-index="${index}">
                <span class="player-state-name">${escapeHtml(profile.nickname || 'Игрок')}</span>
                <strong>${escapeHtml(profile.owner)}</strong>
                <span class="player-state-summary">${formatNumber(stats.provinces.length)} пров. · ${formatNumber(stats.population)} чел.</span>
                <span class="player-state-open">Открыть статистику →</span>
            </button>`;
        }).join('');
        showPageView('Статистика игроков', `<p class="page-intro">Выберите государство, чтобы открыть его показатели отдельно.</p><div class="player-state-grid">${cards}</div>`, { navId: 'nav-stats' });
        elements.pageView.querySelectorAll('[data-player-index]').forEach(button => {
            button.addEventListener('click', () => {
                const profile = profiles[Number(button.dataset.playerIndex)];
                renderStateStatistics(profile.owner, profile.nickname || 'Игрок', {
                    onBack: renderAdminStateList,
                    backLabel: '← К игрокам'
                });
            });
        });
    } catch (error) {
        showPageView('Статистика игроков', `<div class="page-error">Не удалось загрузить список игроков: ${escapeHtml(error.message)}</div>`, { navId: 'nav-stats' });
    }
}

async function renderOwnerProvinces(owner) {
    let provinceReports = {};
    let growthRate = 0;
    let activeColonies = [];
    try {
        const snapshot = state.economySnapshot || await fetchEconomySnapshot();
        state.economySnapshot = snapshot;
        provinceReports = simulateEconomySnapshot(snapshot).ownerReports[owner]?.provinceReports || {};
        const settings = state.stateMechanics[owner] || snapshot.mechanics.find(row => row.owner === owner)?.settings || {};
        const ownerModifiers = getOwnerModifiers(owner,snapshot,snapshot.calendar?.turn||1);
        growthRate = annualPopulationGrowthRate(snapshot.reports.filter(row => row.owner === owner), settings, ownerModifiers);
    } catch (error) {
        console.warn('Не удалось рассчитать производство провинций', error);
    }
    try { activeColonies = (await fetchMilitaryColonizationMissions()).filter(mission => mission.owner === owner && mission.status === 'active'); }
    catch (error) { console.warn('Не удалось загрузить колонизационные миссии', error); }
    const provinces = Object.values(state.dbProvinces)
        .filter(province => province.owner === owner || province.occupied_by === owner)
        .sort((a, b) => Number(a.id) - Number(b.id));
    const canRenameProvinces = state.userProfile?.role === 'player' && state.userProfile.owner === owner;
    const rows = provinces.map(province => `
        <tr><td><button class="table-link" data-province-id="${Number(province.id)}">#${formatNumber(Number(province.id))}</button></td>
        <td>${canRenameProvinces ? `<input class="province-name-edit" data-province-name="${Number(province.id)}" maxlength="80" value="${escapeHtml(province.province_name || '')}" aria-label="Название провинции" required>` : escapeHtml(province.province_name || '—')}</td><td>${escapeHtml(province.region || '—')}</td><td>${province.occupied_by ? `Оккупирована: ${escapeHtml(province.occupied_by)}` : 'Под контролем владельца'}</td>
        <td>${formatNumber(Number(province.yards) || 0)}</td><td>+${formatNumber(Math.round((Number(province.yards) || 0) * growthRate))}</td><td>${formatNumber(Number(province.development ?? 20))}</td><td>${escapeHtml(province.main_culture || '—')}</td>
        <td>${escapeHtml(province.main_religion || '—')}</td><td>${formatTurns(assimilationTurns(province, 'culture', province.main_culture, state.stateMechanics[owner] || {}))}</td><td>${formatTurns(assimilationTurns(province, 'religion', province.main_religion, state.stateMechanics[owner] || {}))}</td><td>${escapeHtml(province.resource || '—')}</td><td>${(() => { const report = provinceReports[province.id] || {}; const main = `${formatNumber(Number(report.production) || 0, 2)} ${escapeHtml(report.resource || province.resource || '')}`; return report.food_resource && report.food_resource !== (report.resource || province.resource) ? `${main}<br>${formatNumber(Number(report.food_production) || 0, 2)} ${escapeHtml(report.food_resource)}` : main; })()}</td><td>${formatNumber(Number(provinceReports[province.id]?.tax_income) || 0, 2)} z</td></tr>
    `).join('');
    const colonyRows = activeColonies.map(mission => `<tr><td>${escapeHtml(state.dbProvinces[Number(mission.target_province_id)]?.province_name || `Провинция ${mission.target_province_id}`)}</td><td>${mission.mission_type === 'sea' ? 'Морская' : 'Сухопутная'}</td><td>Ход ${formatNumber(mission.started_turn)} · успех ${formatNumber(mission.success_chance)}%</td></tr>`).join('');
    const content = `${provinces.length ? `<section class="page-panel dense-table"><div class="page-table-wrap"><table class="page-table"><thead><tr><th>ID</th><th>Провинция</th><th>Регион</th><th>Контроль</th><th>Дворы</th><th>Ожидаемый прирост/год</th><th>Развитие</th><th>Культура</th><th>Религия</th><th>Смена культуры</th><th>Смена религии</th><th>Ресурс</th><th>Производство/ход</th><th>Налоги/ход</th></tr></thead><tbody>${rows}</tbody></table></div>${canRenameProvinces ? '<div class="province-rename-actions"><button class="admin-btn" type="button" data-save-province-names>Сохранить названия провинций</button></div>' : ''}</section>` : '<div class="page-empty">За государством пока нет провинций под его законом или оккупацией.</div>'}<section class="page-panel"><header class="page-panel-heading"><div><h2>Активная колонизация</h2><p>Незавершённые миссии не считаются провинциями под контролем государства.</p></div></header><div class="page-table-wrap"><table class="page-table"><thead><tr><th>Цель</th><th>Миссия</th><th>Состояние</th></tr></thead><tbody>${colonyRows || '<tr><td colspan="3">Активных колонизационных миссий нет.</td></tr>'}</tbody></table></div></section>`;
    activePageOwner = owner;
    showPageView('Провинции', content, { subtitle: owner, navId: 'nav-provinces' });
    elements.pageView.querySelectorAll('[data-province-id]').forEach(button => button.addEventListener('click', () => {
        closePageView();
        goToProvince(Number(button.dataset.provinceId));
    }));
    elements.pageView.querySelector('[data-save-province-names]')?.addEventListener('click', async event => {
        const button = event.currentTarget;
        const nameInputs = [...elements.pageView.querySelectorAll('[data-province-name]')];
        if (nameInputs.some(input => !input.value.trim())) { showToast('Название провинции не может быть пустым.'); return; }
        const changed = nameInputs.map(input => ({ id: Number(input.dataset.provinceName), name: input.value.trim() })).filter(item => item.name !== (state.dbProvinces[item.id]?.province_name || ''));
        if (!changed.length) { showToast('Изменённых названий нет.'); return; }
        button.disabled = true;
        try {
            for (const item of changed) { await renameOwnedProvince(item.id, item.name); state.dbProvinces[item.id].province_name = item.name; }
            showToast(`Сохранено названий провинций: ${changed.length}.`); await renderOwnerProvinces(owner);
        } catch (error) { showToast(`Не удалось сохранить все названия: ${error.message}`); button.disabled = false; }
    });
}

async function renderOwnerSettlements(owner) {
    let markerReports = {};
    let growthRate = 0;
    try {
        const snapshot = state.economySnapshot || await fetchEconomySnapshot();
        state.economySnapshot = snapshot;
        markerReports = simulateEconomySnapshot(snapshot).ownerReports[owner]?.markerReports || {};
        const settings = state.stateMechanics[owner] || snapshot.mechanics.find(row => row.owner === owner)?.settings || {};
        const ownerModifiers = getOwnerModifiers(owner,snapshot,snapshot.calendar?.turn||1);
        growthRate = annualPopulationGrowthRate(snapshot.reports.filter(row => row.owner === owner), settings, ownerModifiers);
    } catch (error) {
        console.warn('Не удалось рассчитать прогноз поселений', error);
    }
    const provinces = Object.values(state.dbProvinces).filter(province => province.owner === owner);
    const provinceIds = new Set(provinces.map(province => Number(province.id)));
    const settlements = state.dbMarkers.filter(marker => provinceIds.has(Number(marker.province_id)));
    const rows = settlements.map(marker => `
        <tr><td><button class="table-link" data-marker-id="${Number(marker.id)}">${escapeHtml(marker.name || 'Поселение')}</button></td>
        <td>${escapeHtml(markerTypeLabels[marker.type] || marker.type || '—')}</td><td>#${formatNumber(Number(marker.province_id) || 0)}</td><td>${marker.military_controlled_by ? `Военный контроль: ${escapeHtml(marker.military_controlled_by)}` : 'Под контролем владельца'}</td>
        <td>${formatNumber(Number(marker.yards) || 0)}</td><td>+${formatNumber(Math.round((Number(marker.yards) || 0) * growthRate))}</td><td>${formatNumber(Number(marker.development ?? markerTypeDevelopment[marker.type] ?? 0))}</td><td>${escapeHtml(marker.culture || '—')}</td>
        <td>${escapeHtml(marker.religion || '—')}</td><td>${formatTurns(assimilationTurns(marker, 'culture', marker.culture, state.stateMechanics[owner] || {}))}</td><td>${formatTurns(assimilationTurns(marker, 'religion', marker.religion, state.stateMechanics[owner] || {}))}</td><td>${formatNumber(Number(markerReports[marker.id]?.tax_income) || 0, 2)} z</td></tr>
    `).join('');
    const content = settlements.length ? `<section class="page-panel dense-table"><div class="page-table-wrap"><table class="page-table"><thead><tr><th>Поселение</th><th>Тип</th><th>Провинция</th><th>Контроль</th><th>Дворы</th><th>Ожидаемый прирост/год</th><th>Развитие</th><th>Культура</th><th>Религия</th><th>Смена культуры</th><th>Смена религии</th><th>Налоги/ход</th></tr></thead><tbody>${rows}</table></div></section>` : '<div class="page-empty">В провинциях государства пока нет поселений.</div>';
    activePageOwner = owner;
    showPageView('Города и поселения', content, { subtitle: owner, navId: 'nav-cities' });
    elements.pageView.querySelectorAll('[data-marker-id]').forEach(button => button.addEventListener('click', () => {
        const marker = settlements.find(item => Number(item.id) === Number(button.dataset.markerId));
        if (!marker) return;
        closePageView();
        state.tx = window.innerWidth / 2 - Number(marker.coord_1) * state.scale;
        state.ty = window.innerHeight / 2 - Number(marker.coord_2) * state.scale;
        updateTransform();
        showMarkerPopup(marker);
    }));
}

function formatTurns(turns) { return turns === null ? '—' : `${formatNumber(turns)} ходов`; }

function simulateEconomySnapshot(snapshot) {
    const provinces = JSON.parse(JSON.stringify(snapshot.provinces));
    const markers = JSON.parse(JSON.stringify(snapshot.markers));
    const mechanics = Object.fromEntries(snapshot.mechanics.map(row => [row.owner, JSON.parse(JSON.stringify(row.settings || {}))]));
    const estateRatios = Object.fromEntries(snapshot.estateRatios.map(row => [row.settlement_type, row]));
    const result = processTurnSimulation({
        calendar: snapshot.calendar,
        provinces,
        markers,
        mechanics,
        modifiers: snapshot.modifiers || [],
        inventories: snapshot.inventories,
        consumptionRates: snapshot.consumptionRates,
        estateRatios,
        adjacency: state.provinceAdjacency,
        provinceCentroids: state.provinceCentroids,
        riverComponents: state.riverComponents,
        lakeComponents: state.lakeComponents,
        seaComponents: state.seaComponents,
        transportRoutes: snapshot.transportRoutes,
        tradeContracts: snapshot.tradeContracts || [],
        tradeTransitRules: snapshot.tradeTransitRules || [],
        spySabotageEffects: snapshot.militarySpySabotageEffects || [],
        rebellions: snapshot.rebellions || []
    });
    const military = simulateMilitaryMaintenance({
        forces: snapshot.militaryForces || [], fleets: snapshot.militaryFleets || [], ports: snapshot.militaryPorts || [],
        structures: snapshot.militaryStructures || [],
        provinces, markers,
        epidemicProvinceIds: (snapshot.militaryEpidemicEvents || []).filter(event => Number(event.active_turn) === Number(snapshot.calendar.turn)).map(event => Number(event.province_id)),
        inventories: result.inventoryUpdates || snapshot.inventories, mechanics: snapshot.mechanics,
        modifiers: snapshot.modifiers || [],
        fleets: snapshot.militaryFleets || [], ports: snapshot.militaryPorts || [],
        adjacency: state.provinceAdjacency, terrainCells: state.militaryTerrainCells,
        waterNetworks: { riverComponents: state.riverComponents, lakeComponents: state.lakeComponents, seaComponents: state.seaComponents },
        structures: snapshot.militaryStructures || [], calendar: snapshot.calendar
    });
    for (const [owner, adjustment] of Object.entries(military.treasuryAdjustments)) {
        result.treasuryAdjustments[owner] = Number(result.treasuryAdjustments[owner] || 0) + adjustment;
    }
    for (const [owner, rows] of Object.entries(military.reports)) {
        result.ownerReports[owner] ||= {};
        result.ownerReports[owner].military = {
            maintenance: rows,
            force_updates: military.forceUpdates.filter(update => (snapshot.militaryForces || []).find(force => force.id === update.id)?.owner === owner),
            fleet_updates: military.fleetUpdates.filter(update => (snapshot.militaryFleets || []).find(fleet => fleet.id === update.id)?.owner === owner)
        };
    }
    const ownerReports = Object.fromEntries(Object.entries(result.ownerReports).map(([owner, report]) => [owner, {
        processed_calendar: report.processed_calendar,
        next_calendar: report.next_calendar,
        production: report.production,
        consumption: report.consumption,
        shortages: report.shortages,
        transport: report.transport,
        external_trade: report.external_trade,
        free_surplus: report.free_surplus,
        needs_coverage: report.needs_coverage,
        military: report.military,
        rebellions: report.rebellions,
        state_effects: report.state_effects,
        markerReports: report.markerReports,
        provinceReports: report.provinceReports
    }]));
    return {
        ...result,
        inventoryUpdates: military.inventoryUpdates,
        militaryUpdates: military.forceUpdates,
        militaryFleetUpdates: military.fleetUpdates,
        territoryLoyaltyUpdates: [],
        stateLoyaltyUpdates: result.stateLoyaltyUpdates,
        treasuryAdjustments: result.treasuryAdjustments,
        ownerReports
    };
}

export function refreshTradeRouteOverlay() {
    const snapshot = state.economySnapshot;
    if (!state.showTradeRoutes && !state.tradeRouteDraft) { state.tradeRouteOverlay = []; renderTradeRoutes([]); return; }
    if (!snapshot || !state.provinceAdjacency.size) { state.tradeRouteOverlay = []; renderTradeRoutes([]); return; }
    try {
        state.tradeRouteOverlay = processTurnSimulation({
        calendar: snapshot.calendar,
        provinces: JSON.parse(JSON.stringify(snapshot.provinces)),
        markers: JSON.parse(JSON.stringify(snapshot.markers)),
        mechanics: Object.fromEntries(snapshot.mechanics.map(row => [row.owner, JSON.parse(JSON.stringify(row.settings || {}))])),
        modifiers: snapshot.modifiers || [],
        inventories: snapshot.inventories,
        consumptionRates: snapshot.consumptionRates,
        estateRatios: Object.fromEntries(snapshot.estateRatios.map(row => [row.settlement_type, row])),
        adjacency: state.provinceAdjacency,
        provinceCentroids: state.provinceCentroids,
        riverComponents: state.riverComponents,
        lakeComponents: state.lakeComponents,
        seaComponents: state.seaComponents,
        transportRoutes: snapshot.transportRoutes,
        tradeContracts: snapshot.tradeContracts || [],
        tradeTransitRules: snapshot.tradeTransitRules || [],
        rebellions: snapshot.rebellions || []
        }).externalTradeReports;
        renderTradeRoutes(state.tradeRouteOverlay);
    }
    catch (error) { console.warn('Не удалось построить торговые маршруты на карте', error); state.tradeRouteOverlay = []; renderTradeRoutes([]); }
}

function syncTradeRouteEditor() {
    const draft = state.tradeRouteDraft;
    if (!draft || !elements.tradeRouteEditor) return;
    const names = draft.path.map(id => state.dbProvinces[id]?.province_name || `Провинция #${id}`);
    const complete = draft.path.at(-1) === draft.destinationProvinceId;
    const destinationName = state.dbProvinces[draft.destinationProvinceId]?.province_name || `Провинция #${draft.destinationProvinceId}`;
    elements.tradeRouteEditorStatus.textContent = complete
        ? `Маршрут готов: ${names.join(' → ')}. Проверь его на карте и сохрани.`
        : `Выбери соседнюю провинцию. Путь: ${names.join(' → ')} → ${destinationName}.`;
    elements.tradeRouteUndoBtn.disabled = draft.path.length <= 1;
    elements.tradeRouteSaveBtn.disabled = !complete;
    renderTradeRoutes(state.tradeRouteOverlay || []);
}

function startTradeRouteSelection(contract, owner, playerName) {
    const source = state.dbMarkers.find(marker => Number(marker.id) === Number(contract.source_marker_id));
    const destination = state.dbMarkers.find(marker => Number(marker.id) === Number(contract.destination_marker_id));
    if (!source || !destination) { showToast('Не удалось определить поселения договора'); return; }
    const sourceProvinceId = Number(source.province_id), destinationProvinceId = Number(destination.province_id);
    state.tradeRouteDraft = {
        contractId: Number(contract.id), owner, playerName, sourceProvinceId, destinationProvinceId,
        path: [sourceProvinceId],
        source_name: source.name || `Поселение #${source.id}`,
        destination_name: destination.name || `Поселение #${destination.id}`,
        sourcePoint: { x: Number(source.coord_1), y: Number(source.coord_2) },
        destinationPoint: { x: Number(destination.coord_1), y: Number(destination.coord_2) }
    };
    state.showTradeRoutes = true;
    elements.tradeRoutesToggleBtn?.classList.add('active');
    if (elements.tradeRoutesToggleBtn) elements.tradeRoutesToggleBtn.textContent = 'Торговые маршруты: показаны';
    closePageView();
    elements.tradeRouteEditor.hidden = false;
    syncTradeRouteEditor();
    showToast('Прокладывай путь по соседним провинциям от города продавца до города покупателя', 5000);
}

function addTradeRouteProvince(provinceId) {
    const draft = state.tradeRouteDraft;
    if (!draft) return;
    const previous = draft.path.at(-1);
    if (provinceId === previous) return;
    if (draft.path.at(-1) === draft.destinationProvinceId) { showToast('Маршрут уже доведён до города-получателя'); return; }
    if (draft.path.includes(provinceId)) { showToast('Нельзя повторно включить провинцию в маршрут'); return; }
    if (!(state.provinceAdjacency.get(previous) || new Set()).has(provinceId)) {
        showToast('Следующая провинция должна граничить с предыдущей');
        return;
    }
    if (draft.path.length >= 200) { showToast('Маршрут достиг ограничения в 200 провинций'); return; }
    draft.path.push(provinceId);
    syncTradeRouteEditor();
}

function cancelTradeRouteSelection() {
    state.tradeRouteDraft = null;
    if (elements.tradeRouteEditor) elements.tradeRouteEditor.hidden = true;
    refreshTradeRouteOverlay();
}

function productionReportTable(title, columns, rows, emptyText, panelClass = '') {
    const body = rows.length
        ? rows.map(row => `<tr>${row.map(value => `<td>${value}</td>`).join('')}</tr>`).join('')
        : `<tr><td colspan="${columns.length}" class="table-empty">${escapeHtml(emptyText)}</td></tr>`;
    return `<section class="page-panel dense-table ${panelClass}"><div class="page-panel-heading"><h2>${escapeHtml(title)}</h2></div><div class="page-table-wrap"><table class="page-table"><thead><tr>${columns.map(column => `<th>${escapeHtml(column)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div></section>`;
}

async function renderProductionConsumption(owner, tab = 'production', playerName = '') {
    activePageOwner = owner;
    const pageTitle = tab === 'trade' ? 'Торговля' : 'Производство и потребление';
    const pageNavId = tab === 'trade' ? 'nav-trade' : 'nav-production';
    showPageView(pageTitle, '<div class="page-loading">Загружаю торговые и производственные данные государства…</div>', { navId: pageNavId });
    try {
        const snapshot = await fetchEconomySnapshot();
        state.economySnapshot = snapshot;
        refreshTradeRouteOverlay();
        const actualRow = snapshot.reports.find(row => row.owner === owner);
        const preview = actualRow && tab === 'consumption'
            ? { ownerReports: { [owner]: actualRow.report }, transportReports: [] }
            : simulateEconomySnapshot(snapshot);
        const report = actualRow?.report || preview.ownerReports[owner] || { production: {}, consumption: {}, shortages: {}, markerReports: {}, provinceReports: {} };
        const isPreview = !actualRow;
        const markersById = new Map(snapshot.markers.map(row => [Number(row.id), row]));
        const ownerProvinces = snapshot.provinces.filter(row => row.owner === owner);
        const ownerMarkers = snapshot.markers.filter(row => row.owner === owner && row.type !== 'ruins');
        const inventoryByMarker = new Map();
        for (const item of snapshot.inventories) {
            const key = Number(item.marker_id);
            if (!inventoryByMarker.has(key)) inventoryByMarker.set(key, []);
            inventoryByMarker.get(key).push(item);
        }
        const number = value => formatNumber(Number(value) || 0, 2);
        const safe = escapeHtml;
        const stateSettings = state.stateMechanics[owner] || snapshot.mechanics.find(row => row.owner === owner)?.settings || {};
        state.stateMechanics[owner] = stateSettings;
        const reportSeason = actualRow ? `${actualRow.year} · ${actualRow.season} · ход ${actualRow.turn}` : `Прогноз на ${snapshot.calendar.year} · ${snapshot.calendar.season} · ход ${snapshot.calendar.turn}`;
        const top = `<p class="page-intro">${isPreview ? 'Показывается расчёт по текущим данным перед сменой хода.' : 'Показаны результаты последнего рассчитанного хода.'} <strong>${safe(reportSeason)}</strong></p>${tab === 'trade' ? '' : `<div class="production-tabs" role="tablist"><button type="button" data-economy-tab="production" class="${tab === 'production' ? 'active' : ''}">Производство</button><button type="button" data-economy-tab="consumption" class="${tab === 'consumption' ? 'active' : ''}">Потребление</button></div>`}`;
        let content = top;
        if (tab === 'production' || tab === 'trade') {
            const provinceReports = report.provinceReports || {};
            const provinceRows = ownerProvinces.map(province => {
                const result = provinceReports[province.id] || {};
                const deliveries = (result.deliveries || []).map(delivery => {
                    const marker = markersById.get(Number(delivery.marker_id));
                    return `${safe(delivery.item_name || result.resource || 'Продовольствие')}: ${safe(marker?.name || `Поселение #${delivery.marker_id}`)} — ${number(delivery.quantity)}`;
                }).join('<br>') || '—';
                const resourceName = result.resource || province.resource || '—';
                const hasSeparateFood = result.food_resource && result.food_resource !== resourceName;
                const outputs = [`${safe(resourceName)}`, `${number(result.production)}`];
                if (hasSeparateFood) { outputs[0] += `<br>${safe(result.food_resource)}`; outputs[1] += `<br>${number(result.food_production)}`; }
                return [safe(province.province_name || `Провинция #${province.id}`), outputs[0], outputs[1], deliveries];
            });
            const markerReports = report.markerReports || {};
            const freeSurplus = preview.ownerReports[owner]?.free_surplus || [];
            const canEdit = state.userProfile?.role === 'admin' || state.userProfile?.owner === owner;
            const directiveOptions = { civilian: 'Гражданское', military: 'Военное', market: 'Рынок' };
            const goodOptions = GOODS.map(good => `<option value="${safe(good)}">${safe(good)}</option>`).join('');
            const settlementRows = ownerMarkers.map(marker => {
                const detail = markerReports[marker.id] || {};
                const goods = Object.entries(detail.goods_produced || {}).map(([name, quantity]) => `${safe(name)} — ${number(quantity)}`).join('<br>') || '—';
                const directive = marker.production_directive || 'civilian';
                const config = canEdit && ['city', 'large_city'].includes(marker.type)
                    ? `<form class="production-directive-form" data-production-marker="${marker.id}"><select name="directive" aria-label="Направление производства">${Object.entries(directiveOptions).map(([value, label]) => `<option value="${value}" ${value === directive ? 'selected' : ''}>${label}</option>`).join('')}</select><select name="good" aria-label="Товар госзаказа"><option value="">Без госзаказа</option>${goodOptions}</select><input name="quantity" type="number" min="0" step="0.1" value="${Number(marker.state_order_qty) || 0}" aria-label="Количество госзаказа"><button type="submit" class="compact-add-btn" aria-label="Сохранить директиву">✓</button></form>`
                    : safe(directiveOptions[directive] || directive);
                const selectedGood = marker.state_order_good;
                return [safe(marker.name || `Поселение #${marker.id}`), safe(markerTypeLabels[marker.type] || marker.type), goods, config + (canEdit && ['city', 'large_city'].includes(marker.type) && selectedGood ? `<span class="production-order-current">Заказ: ${safe(selectedGood)}</span>` : '')];
            });
            if (tab === 'production') {
              // Select a saved state-order item without relying on user-facing names as attributes.
              content += productionReportTable('Производство ресурсов в провинциях', ['Провинция', 'Ресурс', 'Прогноз за ход', 'Поставка на склады'], provinceRows, 'Нет производственных данных.');
              content += productionReportTable('Производство товаров в поселениях', ['Поселение', 'Тип', 'Товары за ход', 'Директива и госзаказ'], settlementRows, 'В государстве пока нет поселений.');
            const surplusRows = freeSurplus.map(item => [safe(item.marker_name), `${safe(item.item_name)} (${item.item_type === 'good' ? 'товар' : 'ресурс'})`, number(item.quantity)]);
            content += '<p class="page-intro">Свободные остатки показаны по поселениям после местных потребностей и заданных перевозок. Это прогноз следующего расчётного хода.</p>';
            content += productionReportTable('Свободный избыток', ['Поселение', 'Груз', 'Свободно'], surplusRows, 'После покрытия местных потребностей свободных запасов не прогнозируется.');
            }
            if (tab === 'trade') {
            const routeMarkers = ownerMarkers.filter(marker => snapshot.provinces.some(province => Number(province.id) === Number(marker.province_id) && province.owner === owner));
            const routeMarkerOptions = routeMarkers.map(marker => `<option value="${Number(marker.id)}">${safe(marker.name || `Поселение #${marker.id}`)}</option>`).join('');
            const routeDestinationOptions = routeMarkers.map((marker, index) => `<option value="${Number(marker.id)}" ${index === 1 ? 'selected' : ''}>${safe(marker.name || `Поселение #${marker.id}`)}</option>`).join('');
            const routeItemOptions = (type, selected = '') => (type === 'good' ? GOODS : RESOURCES).map(item => `<option value="${safe(item)}" ${item === selected ? 'selected' : ''}>${safe(item)}</option>`).join('');
            const stateRoutes = (snapshot.transportRoutes || []).filter(route => {
                const source = markersById.get(Number(route.source_marker_id));
                return source?.owner === owner;
            });
            const previewRoutes = new Map((preview.transportReports || []).map(result => [Number(result.route_id), result]));
            const routeRows = stateRoutes.map(route => {
                const source = markersById.get(Number(route.source_marker_id));
                const destination = markersById.get(Number(route.destination_marker_id));
                const result = previewRoutes.get(Number(route.id));
                const amount = `<form class="transport-route-edit" data-route-id="${Number(route.id)}"><input name="quantity" type="number" min="0.1" max="10000" step="0.1" value="${Number(route.quantity_per_turn) || 0}" aria-label="Количество за ход"><button type="submit" class="compact-add-btn" aria-label="Сохранить маршрут">✓</button><button type="button" class="one-off-remove" data-route-delete aria-label="Удалить маршрут">×</button></form>`;
                const routeModeLabel = { river: 'река', lake: 'озеро', sea: 'море', land: 'суша' }[result?.mode] || 'суша';
                const delivery = result ? `${number(result.delivered)} / ${number(result.requested)} · ${routeModeLabel}${result.reason ? `<br><small>${safe(result.reason)}</small>` : ''}` : 'Будет рассчитан перед сменой хода';
                return [safe(source?.name || `#${route.source_marker_id}`), safe(destination?.name || `#${route.destination_marker_id}`), `${safe(route.item_name)} (${route.item_type === 'good' ? 'товар' : 'ресурс'})`, amount, delivery];
            });
            const routeForm = `<section class="page-panel transport-routes-panel"><div class="page-panel-heading"><h2>Перевозки между поселениями</h2><p>Задай объём груза за ход. Перевозка использует свободные запасы после местных потребностей. Реки и озёра повышают пропускную способность, а морские пути доступны между близкими поселениями у одной акватории.</p></div>
              ${canEdit ? `<form id="transport-route-form" class="transport-route-form"><label>Откуда<select name="source" required>${routeMarkerOptions}</select></label><label>Куда<select name="destination" required>${routeDestinationOptions}</select></label><label>Тип груза<select id="transport-route-type" name="item_type" data-route-type><option value="resource">Ресурс</option><option value="good">Товар</option></select></label><label>Груз<select id="transport-route-cargo" name="item_name">${routeItemOptions('resource')}</select></label><label>Количество за ход<input name="quantity" type="number" min="0.1" max="10000" step="0.1" value="10" required></label><button class="page-map-btn" type="submit" ${routeMarkers.length < 2 ? 'disabled' : ''}>Добавить маршрут</button></form>` : ''}
              ${productionReportTable('Заданные маршруты', ['Откуда', 'Куда', 'Груз', 'Количество за ход', 'Прогноз перевозки'], routeRows, 'Маршруты пока не заданы.')}</section>`;
            content += routeForm;
            const tradeContracts = snapshot.tradeContracts || [];
            const tradeMarkers = snapshot.markers.filter(marker => marker.owner && marker.type !== 'ruins');
            const tradeMarkerLabel = marker => `${safe(marker.name || `Поселение #${marker.id}`)} · ${safe(marker.owner)}`;
            const sellerOptions = tradeMarkers.filter(marker => marker.owner === owner).map(marker => `<option value="${Number(marker.id)}">${tradeMarkerLabel(marker)}</option>`).join('');
            const buyerOptions = tradeMarkers.filter(marker => marker.owner !== owner).map(marker => `<option value="${Number(marker.id)}">${tradeMarkerLabel(marker)}</option>`).join('');
            const tradeRows = tradeContracts.filter(contract => contract.seller_owner === owner || contract.buyer_owner === owner || preview.ownerReports[owner]?.external_trade?.some(row => Number(row.contract_id) === Number(contract.id) && row.side === 'transit')).map(contract => {
                const source = markersById.get(Number(contract.source_marker_id)), destination = markersById.get(Number(contract.destination_marker_id));
                const result = (preview.ownerReports[owner]?.external_trade || []).find(row => Number(row.contract_id) === Number(contract.id));
                const statusLabel = { pending: 'Ожидает ответа', active: 'Действует', rejected: 'Отклонён', cancelled: 'Отменён' }[contract.status] || contract.status;
                const isTransitObserver = preview.ownerReports[owner]?.external_trade?.some(row => Number(row.contract_id) === Number(contract.id) && row.side === 'transit');
                const canManageRoute = canEdit && (state.userProfile?.role === 'admin' || contract.seller_owner === owner || contract.buyer_owner === owner);
                const routeControls = canManageRoute && ['pending', 'active'].includes(contract.status)
                    ? `<div class="trade-contract-route-controls"><span>${Array.isArray(contract.route_province_ids) ? 'Ручной путь' : 'Автопуть'}</span><button type="button" class="page-map-btn" data-edit-trade-route="${Number(contract.id)}">${Array.isArray(contract.route_province_ids) ? 'Изменить на карте' : 'Выбрать на карте'}</button>${Array.isArray(contract.route_province_ids) ? `<button type="button" class="page-map-btn" data-clear-trade-route="${Number(contract.id)}">Автоматически</button>` : ''}</div>`
                    : '';
                const controls = contract.status === 'pending' && contract.buyer_owner === owner
                    ? `<div class="trade-contract-actions"><button type="button" class="trade-action-btn" data-trade-action="accept" data-trade-id="${Number(contract.id)}">Принять</button><button type="button" class="trade-action-btn" data-trade-action="reject" data-trade-id="${Number(contract.id)}">Отклонить</button></div>`
                    : contract.status === 'active' && contract.seller_owner === owner ? `<div class="trade-contract-actions"><button type="button" class="trade-action-btn" data-trade-action="cancel" data-trade-id="${Number(contract.id)}">Расторгнуть</button></div>` : '';
                const shipment = result ? `Отправлено ${number(result.shipped)} · доставлено ${number(result.delivered)}${result.route_loss > 0 ? ` · потеря ${number(result.route_loss)}` : ''}${result.neutral_province_count ? ` · нейтральных провинций ${result.neutral_province_count}` : ''}<br><small>Продавцу ${number(result.paid)} z · пошлины ${number(result.toll_paid)} z · всего покупатель платит ${number(result.buyer_total_paid)} z${result.transit_tolls?.length ? ` (${result.transit_tolls.map(toll => `${safe(toll.owner)} ${number(toll.rate)}%`).join(', ')})` : ''}${result.reason ? `<br>${safe(result.reason)}` : ''}</small>` : '—';
                return [tradeMarkerLabel(source || { id: contract.source_marker_id, name: `#${contract.source_marker_id}`, owner: contract.seller_owner }), tradeMarkerLabel(destination || { id: contract.destination_marker_id, name: `#${contract.destination_marker_id}`, owner: contract.buyer_owner }), `${safe(contract.item_name)} (${contract.item_type === 'good' ? 'товар' : 'ресурс'})`, `${number(contract.quantity_per_turn)} за ход`, `${number(contract.unit_price)} z/ед.`, `${isTransitObserver ? 'Транзит · ' : ''}${safe(statusLabel)} · ${Array.isArray(contract.route_province_ids) ? 'ручной путь' : 'автопуть'}${controls || routeControls ? `<br>${controls}${routeControls}` : ''}`, shipment];
            });
            const contractPanel = `<section class="page-panel transport-routes-panel"><div class="page-panel-heading"><h2>Межгосударственная торговля</h2><p>Договор повторяется каждый ход. Автопуть использует доступную водную связь (река, озеро или море), иначе ищет короткий сухопутный маршрут. Сухопутный путь можно вручную провести по провинциям, чтобы выбрать, где принять потери или пошлины. Нейтральная провинция удерживает 5% груза, транзитное государство взимает пошлину один раз за маршрут.</p></div>
              ${canEdit && sellerOptions && buyerOptions ? `<form id="state-trade-contract-form" class="transport-route-form state-trade-contract-form"><label>Откуда<select name="source" required>${sellerOptions}</select></label><label>Куда<select name="destination" required>${buyerOptions}</select></label><label>Тип груза<select name="item_type" data-trade-type><option value="resource">Ресурс</option><option value="good">Товар</option></select></label><label>Груз<select name="item_name" data-trade-cargo>${RESOURCES.map(item => `<option value="${safe(item)}">${safe(item)}</option>`).join('')}</select></label><label>Количество за ход<input name="quantity" type="number" min="0.1" max="10000" step="0.1" value="10" required></label><label>Цена за единицу, z<input name="price" type="number" min="0" max="1000000" step="0.1" value="1" required></label><button class="page-map-btn" type="submit">Предложить договор</button></form>` : '<p class="page-note">Для предложения договора нужны поселение вашего государства и поселение другого государства.</p>'}
              ${productionReportTable('Договоры и поставки', ['Откуда', 'Куда', 'Груз', 'Объём', 'Цена', 'Статус', 'Поставка за ход'], tradeRows, 'Договоров пока нет.', 'trade-contract-table')}</section>`;
            content += contractPanel;
            const marketEffects = preview.ownerReports[owner]?.state_effects || report.state_effects || {};
            const marketRows = (marketEffects.market_demand || []).map(row => [safe(row.item), `${number(row.base_price)} z`, `${number(row.price)} z`, number(row.demand), number(row.supply), number(row.consumed), number(row.imported), number(row.exported), `${number(row.turnover)} z`]);
            const settings = stateSettings;
            const storedTradeRate = Number(settings.internal_trade_tax_rate);
            const internalTradeRate = Math.max(0, Math.min(15, Number.isFinite(storedTradeRate) ? storedTradeRate : 15));
            const taxChangeLocked = state.userProfile?.role !== 'admin' && Number(settings.internal_trade_tax_last_changed_year) === Number(snapshot.calendar.year);
            const internalTradeTaxForm = `<section class="page-panel trade-tax-panel"><div class="page-panel-heading"><div><h2>Сбор с внутренней торговли</h2><p>Удерживается с внутреннего товарооборота и влияет на лояльность горожан.</p></div><strong>${number(marketEffects.trade_income)} z · прогноз</strong></div><form id="internal-trade-tax-form" class="trade-tax-form"><label>Ставка сбора, %<input name="internal_trade_tax_rate" type="number" min="0" max="15" step="0.5" value="${internalTradeRate}" ${canEdit && !taxChangeLocked ? '' : 'readonly'}></label><button class="page-map-btn" type="submit" ${canEdit && !taxChangeLocked ? '' : 'disabled'}>Сохранить ставку</button><span id="trade-tax-status" aria-live="polite"></span></form><small class="page-note">Игрок меняет ставку раз в игровой год за 5 ОП; администратор — без ограничений и расходов.${taxChangeLocked ? ' Ставка уже менялась в этом игровом году.' : ''}</small></section>`;
            content += internalTradeTaxForm;
            content += `<section class="page-panel state-shortage-summary"><div><span>Внутренний товарооборот · прогноз на ход</span><strong>${number(marketEffects.market_turnover)} z</strong></div><p>Спрос распределяется между заменяемыми товарами внутри потребностей населения. Импорт и экспорт учитывают межгосударственные договоры. Запасы сверх спроса сами по себе не продаются.</p></section>`;
            content += productionReportTable('Внутренний рынок и динамические цены', ['Ресурс или товар', 'Базовая цена', 'Цена государства', 'Спрос', 'Доступно', 'Покрыто', 'Импорт за ход', 'Экспорт за ход', 'Оборот'], marketRows, 'Рыночные данные пока не рассчитаны.');
            const currentYear = Number(snapshot.calendar.year) || 1450;
            const transitRules = (snapshot.tradeTransitRules || []).filter(rule => rule.transit_owner === owner && (tradeContracts.some(contract => Number(contract.id) === Number(rule.contract_id) && contract.status === 'active')));
            const contractById = new Map(tradeContracts.map(contract => [Number(contract.id), contract]));
            const policyRows = transitRules.map(rule => {
                const contract = contractById.get(Number(rule.contract_id));
                const source = markersById.get(Number(contract?.source_marker_id)), destination = markersById.get(Number(contract?.destination_marker_id));
                const routeNow = (preview.ownerReports[owner]?.external_trade || []).find(entry => Number(entry.contract_id) === Number(rule.contract_id) && entry.side === 'transit');
                const tollLocked = state.userProfile?.role !== 'admin' && Number(rule.toll_last_changed_year) === currentYear;
                const editable = canEdit && rule.transit_owner === owner;
                const endpointText = `${safe(source?.name || `#${contract?.source_marker_id}`)} → ${safe(destination?.name || `#${contract?.destination_marker_id}`)}`;
                const cargoText = contract ? `${safe(contract.item_name)} · ${number(contract.quantity_per_turn)}/ход` : 'Договор';
                const rateControl = editable ? `<form class="transit-policy-form" data-transit-policy data-contract-id="${Number(rule.contract_id)}" data-transit-owner="${safe(owner)}"><label><span>Пошлина, %</span><input name="toll_rate" type="number" min="0" max="50" step="0.5" value="${Number(rule.toll_rate) || 0}" ${tollLocked ? 'readonly' : ''}></label><button type="submit" class="compact-add-btn" ${tollLocked ? 'disabled' : ''}>Сохранить · 2 ОП</button><label class="transit-block-control"><input type="checkbox" name="blocked" ${rule.blocked ? 'checked' : ''}> Запретить проход</label><small>${tollLocked ? 'Пошлина уже менялась в этом игровом году.' : 'Менять пошлину можно раз в год.'}</small></form>` : `${number(rule.toll_rate)}%`;
                const routeState = routeNow ? 'Проходит сейчас' : rule.blocked ? 'Проход запрещён; поиск обхода' : 'Сейчас не проходит по территории';
                return [endpointText, cargoText, rateControl, `${safe(routeState)}${editable && rule.blocked ? ' · запрет включён' : ''}`];
            });
            content += productionReportTable('Чужие маршруты через государство', ['Маршрут', 'Груз', 'Условия транзита', 'Состояние'], policyRows, 'Пока нет действующих договоров, маршруты которых проходят через ваши земли.');
            }
            if (tab === 'production') {
            const stockRows = ownerMarkers.map(marker => {
                const items = inventoryByMarker.get(Number(marker.id)) || [];
                const stock = items.filter(item => Number(item.quantity) > 0).map(item => `${safe(item.item_name)} — ${number(item.quantity)} ${item.item_type === 'good' ? 'тов.' : 'рес.'}`).join('<br>') || 'Пусто';
                return [safe(marker.name || `Поселение #${marker.id}`), stock];
            });
            content += productionReportTable('Текущие запасы на складах', ['Поселение', 'Остатки ресурсов и товаров'], stockRows, 'Склады пока пусты.');
            }
        } else {
            const consumptionRows = Object.entries(report.consumption || {}).sort(([a], [b]) => a.localeCompare(b, 'ru')).map(([item, amount]) => [safe(item), number(amount)]);
            const shortageRows = Object.entries(report.shortages || {}).sort(([a], [b]) => a.localeCompare(b, 'ru')).map(([need, amount]) => [safe(need), number(amount)]);
            const coverageRows = ownerMarkers.flatMap(marker => (report.markerReports?.[marker.id]?.coverage || []).map(need => [safe(marker.name || `Поселение #${marker.id}`), safe(need.need), number(need.demand), number(need.covered), `${number((Number(need.ratio) || 0) * 100)}%`]));
            const foodEffect = report.state_effects || {};
            const foodCoverage = Number(foodEffect.food_coverage);
            if (Number.isFinite(foodCoverage)) content += `<section class="page-panel state-shortage-summary"><div><span>Обеспеченность государства продовольствием</span><strong>${number(foodCoverage * 100)}%</strong></div><p>Потеря дворов за этот ход: ${number(foodEffect.yards_lost)} из ${number(foodEffect.yards_before)} · изменение общей лояльности крестьянства: ${number(foodEffect.peasants_loyalty_change)} п.п.${foodEffect.winter_fuel_coverage === null || foodEffect.winter_fuel_coverage === undefined ? '' : ` · зимнее покрытие топливом: ${number(Number(foodEffect.winter_fuel_coverage) * 100)}%`}</p></section>`;
            content += productionReportTable('Потребление ресурсов и товаров за ход', ['Ресурс или товар', 'Количество'], consumptionRows, 'Потребление пока не рассчитано.');
            content += productionReportTable('Непокрытые потребности', ['Потребность', 'Дефицит'], shortageRows, 'По последнему расчёту дефицита нет.');
            content += productionReportTable('Покрытие потребностей по поселениям', ['Поселение', 'Потребность', 'Требуется', 'Покрыто', 'Покрытие'], coverageRows, 'Нет данных по покрытию потребностей.');
        }
        showPageView(pageTitle, content, { navId: pageNavId, subtitle: `${owner}${playerName ? ` · игрок ${playerName}` : ''}` });
        elements.pageView.querySelectorAll('[data-economy-tab]').forEach(button => button.addEventListener('click', () => renderProductionConsumption(owner, button.dataset.economyTab, playerName)));
        elements.pageView.querySelectorAll('[data-production-marker]').forEach(form => {
            const marker = markersById.get(Number(form.dataset.productionMarker));
            const goodSelect = form.elements.good;
            if (marker?.state_order_good) goodSelect.value = marker.state_order_good;
            form.addEventListener('submit', async event => {
                event.preventDefault();
                const submit = form.querySelector('button[type="submit"]');
                submit.disabled = true;
                try {
                    const saved = await saveProductionDirective(Number(form.dataset.productionMarker), form.elements.directive.value, form.elements.good.value, Number(form.elements.quantity.value) || 0);
                    const local = state.dbMarkers.find(row => Number(row.id) === Number(form.dataset.productionMarker));
                    if (local) Object.assign(local, saved);
                    showToast('Производственная директива сохранена');
                    await renderProductionConsumption(owner, tab, playerName);
                } catch (error) {
                    showToast(`Не удалось сохранить директиву: ${error.message}`);
                    submit.disabled = false;
                }
            });
        });
        const routeForm = elements.pageView.querySelector('#transport-route-form');
        if (routeForm) {
            const typeSelect = routeForm.querySelector('#transport-route-type');
            const cargoSelect = routeForm.querySelector('#transport-route-cargo');
            const keepEndpointsDifferent = changed => {
                const source = routeForm.elements.source;
                const destination = routeForm.elements.destination;
                if (source.value !== destination.value) return;
                const other = [...(changed === 'source' ? destination.options : source.options)].find(option => option.value !== (changed === 'source' ? source.value : destination.value));
                if (other) (changed === 'source' ? destination : source).value = other.value;
            };
            routeForm.elements.source.addEventListener('change', () => keepEndpointsDifferent('source'));
            routeForm.elements.destination.addEventListener('change', () => keepEndpointsDifferent('destination'));
            const refreshRouteCargoOptions = () => {
                const items = typeSelect.value === 'good' ? GOODS : RESOURCES;
                cargoSelect.replaceChildren(...items.map(item => {
                    const option = document.createElement('option');
                    option.value = item;
                    option.textContent = item;
                    return option;
                }));
                cargoSelect.selectedIndex = 0;
            };
            typeSelect.addEventListener('change', refreshRouteCargoOptions);
            refreshRouteCargoOptions();
            routeForm.addEventListener('submit', async event => {
                event.preventDefault();
                const submit = routeForm.querySelector('button[type="submit"]');
                if (Number(routeForm.elements.source.value) === Number(routeForm.elements.destination.value)) {
                    showToast('Выбери два разных поселения');
                    return;
                }
                submit.disabled = true;
                try {
                    await saveMarkerTransportRoute(Number(routeForm.elements.source.value), Number(routeForm.elements.destination.value), typeSelect.value, routeForm.elements.item_name.value, Number(routeForm.elements.quantity.value));
                    showToast('Маршрут перевозки сохранён');
                    await renderProductionConsumption(owner, 'trade', playerName);
                } catch (error) {
                    showToast(`Не удалось сохранить маршрут: ${error.message}`);
                    submit.disabled = false;
                }
            });
        }
        const tradeForm = elements.pageView.querySelector('#state-trade-contract-form');
        if (tradeForm) {
            const typeSelect = tradeForm.querySelector('[data-trade-type]'), cargoSelect = tradeForm.querySelector('[data-trade-cargo]');
            const refreshTradeCargo = () => {
                const items = typeSelect.value === 'good' ? GOODS : RESOURCES;
                cargoSelect.replaceChildren(...items.map(item => { const option = document.createElement('option'); option.value = item; option.textContent = item; return option; }));
            };
            typeSelect.addEventListener('change', refreshTradeCargo);
            tradeForm.addEventListener('submit', async event => {
                event.preventDefault(); const submit = tradeForm.querySelector('button[type="submit"]'); submit.disabled = true;
                try {
                    await saveStateTradeContract('offer', { sourceMarkerId: Number(tradeForm.elements.source.value), destinationMarkerId: Number(tradeForm.elements.destination.value), itemType: typeSelect.value, itemName: cargoSelect.value, quantityPerTurn: Number(tradeForm.elements.quantity.value), unitPrice: Number(tradeForm.elements.price.value) });
                    showToast('Торговое предложение отправлено'); await renderProductionConsumption(owner, 'trade', playerName);
                } catch (error) { showToast(`Не удалось отправить предложение: ${error.message}`); submit.disabled = false; }
            });
        }
        elements.pageView.querySelectorAll('[data-trade-action]').forEach(button => button.addEventListener('click', async () => {
            button.disabled = true;
            try { await saveStateTradeContract(button.dataset.tradeAction, { contractId: Number(button.dataset.tradeId) }); showToast('Статус договора обновлён'); await renderProductionConsumption(owner, 'trade', playerName); }
            catch (error) { showToast(`Не удалось обновить договор: ${error.message}`); button.disabled = false; }
        }));
        elements.pageView.querySelectorAll('[data-edit-trade-route]').forEach(button => button.addEventListener('click', () => {
            const contract = (state.economySnapshot?.tradeContracts || []).find(row => Number(row.id) === Number(button.dataset.editTradeRoute));
            if (contract) startTradeRouteSelection(contract, owner, playerName);
        }));
        elements.pageView.querySelectorAll('[data-clear-trade-route]').forEach(button => button.addEventListener('click', async () => {
            button.disabled = true;
            try {
                await saveStateTradeContractRoute(Number(button.dataset.clearTradeRoute), null);
                state.economySnapshot = await fetchEconomySnapshot();
                refreshTradeRouteOverlay();
                showToast('Договор снова использует автоматический маршрут');
                await renderProductionConsumption(owner, 'trade', playerName);
            } catch (error) { showToast(`Не удалось включить автопуть: ${error.message}`); button.disabled = false; }
        }));
        elements.pageView.querySelectorAll('[data-route-id]').forEach(form => {
            const route = (snapshot.transportRoutes || []).find(row => Number(row.id) === Number(form.dataset.routeId));
            if (!route) return;
            const save = async quantity => {
                await saveMarkerTransportRoute(Number(route.source_marker_id), Number(route.destination_marker_id), route.item_type, route.item_name, quantity);
                showToast(quantity === 0 ? 'Маршрут удалён' : 'Маршрут обновлён');
                await renderProductionConsumption(owner, 'trade', playerName);
            };
            form.addEventListener('submit', async event => {
                event.preventDefault();
                const submit = form.querySelector('button[type="submit"]');
                submit.disabled = true;
                try { await save(Number(form.elements.quantity.value)); }
                catch (error) { showToast(`Не удалось обновить маршрут: ${error.message}`); submit.disabled = false; }
            });
            form.querySelector('[data-route-delete]').addEventListener('click', async event => {
                const button = event.currentTarget;
                button.disabled = true;
                try { await save(0); }
                catch (error) { showToast(`Не удалось удалить маршрут: ${error.message}`); button.disabled = false; }
            });
        });
        const taxForm = elements.pageView.querySelector('#internal-trade-tax-form');
        taxForm?.addEventListener('submit', async event => {
            event.preventDefault();
            const status = taxForm.querySelector('#trade-tax-status');
            const nextRate = Number(taxForm.elements.internal_trade_tax_rate.value);
            const oldRate = Number(stateSettings.internal_trade_tax_rate ?? 15);
            if (!Number.isFinite(nextRate) || nextRate < 0 || nextRate > 15) { status.textContent = 'Ставка должна быть от 0 до 15%.'; return; }
            if (nextRate !== oldRate && state.userProfile?.role !== 'admin') {
                if (Number(stateSettings.internal_trade_tax_last_changed_year) === Number(snapshot.calendar.year)) { status.textContent = 'Сбор можно менять один раз за игровой год.'; return; }
                if (Number(stateSettings.economy?.prestige) < 5) { status.textContent = 'Для изменения ставки нужно 5 ОП.'; return; }
            }
            try { state.stateMechanics[owner] = await saveStateMechanics(owner, { ...stateSettings, internal_trade_tax_rate: nextRate }); await renderProductionConsumption(owner, 'trade', playerName); }
            catch (error) { status.textContent = `Не удалось сохранить сбор: ${error.message}`; }
        });
        elements.pageView.querySelectorAll('[data-transit-policy]').forEach(form => {
            const values = () => ({ contractId: Number(form.dataset.contractId), transitOwner: form.dataset.transitOwner });
            form.addEventListener('submit', async event => {
                event.preventDefault();
                const button = form.querySelector('button[type="submit"]'); button.disabled = true;
                try { await saveStateTradeTransitPolicy('set_toll', { ...values(), tollRate: Number(form.elements.toll_rate.value) }); state.economySnapshot = await fetchEconomySnapshot(); refreshTradeRouteOverlay(); showToast('Транзитная пошлина сохранена'); await renderProductionConsumption(owner, 'trade', playerName); }
                catch (error) { showToast(`Не удалось изменить пошлину: ${error.message}`); button.disabled = false; }
            });
            form.elements.blocked?.addEventListener('change', async event => {
                const checkbox = event.currentTarget; checkbox.disabled = true;
                try { await saveStateTradeTransitPolicy('set_blocked', { ...values(), blocked: checkbox.checked }); state.economySnapshot = await fetchEconomySnapshot(); refreshTradeRouteOverlay(); showToast(checkbox.checked ? 'Проход караванов запрещён' : 'Запрет прохода снят'); await renderProductionConsumption(owner, 'trade', playerName); }
                catch (error) { showToast(`Не удалось изменить запрет: ${error.message}`); checkbox.disabled = false; checkbox.checked = !checkbox.checked; }
            });
        });
    } catch (error) {
        showPageView(pageTitle, `<div class="page-error">Не удалось загрузить торговые или производственные данные: ${escapeHtml(error.message)}</div>`, { navId: pageNavId, subtitle: owner });
    }
}

async function advanceEconomyTurn() {
    const snapshot = await fetchEconomySnapshot();
    const simulation = simulateEconomySnapshot(snapshot);
    const payload = {
        processed_calendar: snapshot.calendar,
        inventoryUpdates: simulation.inventoryUpdates,
        provinceUpdates: simulation.provinceUpdates,
        markerUpdates: simulation.markerUpdates,
        territoryLoyaltyUpdates: [],
        stateLoyaltyUpdates: simulation.stateLoyaltyUpdates,
        treasuryAdjustments: simulation.treasuryAdjustments,
        ownerReports: simulation.ownerReports,
        militaryUpdates: simulation.militaryUpdates,
        militaryFleetUpdates: simulation.militaryFleetUpdates
    };
    const calendar = await applyEconomyTurn(payload);
    await saveTerritoryRebellions(simulation.rebellionUpdates || []);
    state.gameCalendar = calendar;
    renderGameCalendar();
    await loadSupabaseData();
    state.economySnapshot = await fetchEconomySnapshot();
    state.stateMechanics = Object.fromEntries(state.economySnapshot.mechanics.map(row => [row.owner, row.settings || {}]));
    [state.militaryForces, state.militaryStructures] = await Promise.all([fetchMilitaryForces(), fetchMilitaryStructures()]);
    renderMilitaryGrid();
    refreshTradeRouteOverlay();
    return calendar;
}

async function renderEconomy(owner, playerName = '') {
    activePageOwner = owner;
    showPageView('Экономика', '<div class="page-loading">Загружаю экономику государства…</div>', { navId: 'nav-economy' });
    try {
        const settings = state.stateMechanics[owner] ?? await fetchStateMechanics(owner) ?? {};
        state.stateMechanics[owner] = settings;
        let financePreview = {};
        try {
            const sourceSnapshot = state.economySnapshot || await fetchEconomySnapshot();
            const mechanics = sourceSnapshot.mechanics.filter(row => row.owner !== owner).concat([{ owner, settings }]);
            financePreview = simulateEconomySnapshot({ ...sourceSnapshot, mechanics }).ownerReports[owner]?.state_effects || {};
        } catch (error) {
            console.warn('Не удалось рассчитать финансовый прогноз', error);
        }
        const economy = settings.economy || {};
        const income = { taxes: 0, trade: 0, other_recurring: 0, other_one_off: 0, ...(economy.income || {}) };
        const forecastTaxIncome = Number.isFinite(Number(financePreview.tax_income)) ? Number(financePreview.tax_income) : Number(income.taxes) || 0;
        const forecastTradeIncome = Number.isFinite(Number(financePreview.trade_income)) ? Number(financePreview.trade_income) : Number(income.trade) || 0;
        const expenses = { army: 0, trade: 0, other_recurring: 0, other_one_off: 0, ...(economy.expenses || {}) };
        const treasury = Number(economy.treasury) || 0;
        const prestige = Number(economy.prestige) || 0;
        const itemsFor = (stored, legacyAmount, legacyReason) => Array.isArray(stored) ? stored : (Number(legacyAmount) > 0 ? [{ reason: legacyReason, amount: Number(legacyAmount) }] : []);
        const treasuryIncomeItems = itemsFor(economy.one_off_income_treasury, income.other_one_off, 'Прочие разовые доходы');
        const treasuryItems = itemsFor(economy.one_off_expenses_treasury, expenses.other_one_off, 'Прочие разовые расходы');
        const prestigeIncomeItems = itemsFor(economy.one_off_income_prestige, 0, '');
        const prestigeItems = itemsFor(economy.one_off_expenses_prestige, economy.prestige_one_off_expenses, 'Ранее внесённые разовые расходы');
        const totalOf = items => items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
        const treasuryIncome = forecastTaxIncome + forecastTradeIncome + Number(income.other_recurring || 0) + totalOf(treasuryIncomeItems);
        const treasuryFixedExpenses = Number(expenses.army || 0) + Number(expenses.trade || 0) + Number(expenses.other_recurring || 0);
        const oneOffTreasuryTotal = totalOf(treasuryItems);
        const oneOffPrestigeTotal = totalOf(prestigeItems);
        const treasuryNext = Number.isFinite(Number(financePreview.treasury_balance)) ? Number(financePreview.treasury_balance) : Math.max(0, treasury + treasuryIncome - treasuryFixedExpenses - oneOffTreasuryTotal);
        const prestigeFixed = Number(economy.prestige_recurring_expenses) || 0;
        const prestigeIncome = Number(economy.prestige_recurring_income) || 0;
        const totalPrestigeIncome = prestigeIncome + totalOf(prestigeIncomeItems);
        const prestigeNext = Number.isFinite(Number(financePreview.prestige_balance)) ? Number(financePreview.prestige_balance) : Math.max(0, prestige + totalPrestigeIncome - prestigeFixed - oneOffPrestigeTotal);
        const edit = state.userProfile?.role === 'admin' || state.userProfile?.owner === owner;
        const isAdmin = state.userProfile?.role === 'admin';
        const field = (label, value, unit = '') => `<div class="economy-value"><span>${label}</span><strong>${formatNumber(Number(value) || 0, 1)} ${unit}</strong></div>`;
        const balance = (label, current, next, unit) => `<section class="economy-balance"><span>${label}</span><strong>${formatNumber(current, 1)} ${unit}</strong><small>На след. ход: <b>${formatNumber(next, 1)} ${unit}</b></small></section>`;
        const transactionEntries = [
            ...treasuryIncomeItems.map(item => ({ ...item, type: 'treasury_income' })),
            ...treasuryItems.map(item => ({ ...item, type: 'treasury_expense' })),
            ...prestigeIncomeItems.map(item => ({ ...item, type: 'prestige_income' })),
            ...prestigeItems.map(item => ({ ...item, type: 'prestige_expense' }))
        ];
        const transactionTypeOptions = [['treasury_income','Доход казны','z'],['treasury_expense','Расход казны','z'],['prestige_income','Доход престижа','ОП'],['prestige_expense','Расход престижа','ОП']];
        const transactionRows = transactionEntries.map(item => `<tr data-one-off-row><td><select name="transaction_type" ${edit ? '' : 'disabled'}>${transactionTypeOptions.map(([value,label]) => `<option value="${value}" ${item.type === value ? 'selected' : ''}>${label}</option>`).join('')}</select></td><td><input name="transaction_reason" type="text" maxlength="120" placeholder="Причина или источник" value="${escapeHtml(item.reason || '')}" ${edit ? '' : 'readonly'}></td><td><input name="transaction_amount" type="number" min="0" step="0.1" value="${Number(item.amount) || 0}" ${edit ? '' : 'readonly'}> <span data-transaction-unit>${item.type.startsWith('treasury') ? 'z' : 'ОП'}</span></td><td>${edit ? '<button type="button" class="one-off-remove" aria-label="Удалить операцию" data-remove-one-off>×</button>' : ''}</td></tr>`).join('');
        const content = `<form id="economy-form"><div class="economy-ledgers economy-ledgers-clean">
          <section class="economy-ledger"><div class="economy-ledger-heading">${balance('Казна', treasury, treasuryNext, 'z')}</div><section class="economy-list page-panel"><h2>Доходы казны</h2>${field('Налоги · прогноз', forecastTaxIncome, 'z')}${field('Внутренняя торговля · прогноз', forecastTradeIncome, 'z')}${field('Прочие постоянные доходы', income.other_recurring, 'z')}</section><section class="economy-list page-panel"><h2>Расходы казны</h2>${field('Армия', expenses.army, 'z')}${field('Торговые расходы', expenses.trade, 'z')}${field('Прочие постоянные расходы', expenses.other_recurring, 'z')}</section></section>
          <section class="economy-ledger"><div class="economy-ledger-heading">${balance('Престиж', prestige, prestigeNext, 'ОП')}</div><section class="economy-list page-panel"><h2>Доходы престижа</h2>${field('Прочие постоянные доходы', prestigeIncome, 'ОП')}</section><section class="economy-list page-panel"><h2>Расходы престижа</h2>${field('Прочие постоянные расходы', prestigeFixed, 'ОП')}</section></section>
          </div><section class="economy-list page-panel economy-transactions"><header><h2>Разовые операции</h2>${edit ? '<button type="button" class="compact-add-btn" data-add-transaction aria-label="Добавить операцию">+</button>' : ''}</header><div class="page-table-wrap"><table class="page-table"><thead><tr><th>Тип</th><th>Источник или причина</th><th>Сумма</th><th></th></tr></thead><tbody data-transaction-list>${transactionRows || `<tr class="transaction-empty"><td colspan="4">Разовых операций пока нет.</td></tr>`}</tbody></table></div></section><div class="mechanics-save-row"><button class="page-map-btn" type="submit" ${edit ? '' : 'disabled'}>Сохранить разовые операции</button><span id="economy-save-status" aria-live="polite"></span></div><p class="page-note">Налоги и торговые доходы рассчитываются автоматически. Постоянные расходы применяются при смене хода; разовые операции после расчёта списываются из списка.</p>${Number(financePreview.treasury_unpaid) > 0 || Number(financePreview.prestige_unpaid) > 0 ? `<p class="page-note">В прогнозе не хватает средств на расходы: ${Number(financePreview.treasury_unpaid) > 0 ? `${formatNumber(financePreview.treasury_unpaid, 1)} z казны` : ''}${Number(financePreview.treasury_unpaid) > 0 && Number(financePreview.prestige_unpaid) > 0 ? ', ' : ''}${Number(financePreview.prestige_unpaid) > 0 ? `${formatNumber(financePreview.prestige_unpaid, 1)} ОП` : ''}.</p>` : ''}</form>`;
        showPageView('Экономика', content, { navId: 'nav-economy', subtitle: `${owner}${playerName ? ` · игрок ${playerName}` : ''}` });
        const form = elements.pageView.querySelector('#economy-form');
        const transactionList = form.querySelector('[data-transaction-list]');
        const transactionUnit = type => type.startsWith('treasury') ? 'z' : 'ОП';
        const bindTransactionRow = row => {
            row.querySelector('[name="transaction_type"]')?.addEventListener('change', event => { row.querySelector('[data-transaction-unit]').textContent = transactionUnit(event.currentTarget.value); });
            row.querySelector('[data-remove-one-off]')?.addEventListener('click', () => { row.remove(); if (!transactionList.querySelector('[data-one-off-row]')) transactionList.innerHTML = '<tr class="transaction-empty"><td colspan="4">Разовых операций пока нет.</td></tr>'; });
        };
        form.querySelector('[data-add-transaction]')?.addEventListener('click', () => {
            transactionList.querySelector('.transaction-empty')?.remove();
            const row = document.createElement('tr'); row.dataset.oneOffRow = '';
            row.innerHTML = `<td><select name="transaction_type">${transactionTypeOptions.map(([value,label]) => `<option value="${value}">${label}</option>`).join('')}</select></td><td><input name="transaction_reason" type="text" maxlength="120" placeholder="Причина или источник"></td><td><input name="transaction_amount" type="number" min="0" step="0.1" value="0"> <span data-transaction-unit>z</span></td><td><button type="button" class="one-off-remove" aria-label="Удалить операцию" data-remove-one-off>×</button></td>`;
            transactionList.append(row); bindTransactionRow(row);
        });
        form.querySelectorAll('[data-one-off-row]').forEach(bindTransactionRow);
        form.addEventListener('submit', async event => {
            event.preventDefault();
            const status = form.querySelector('#economy-save-status');
            const invalidOneOff = [...form.querySelectorAll('[data-one-off-row]')].some(row => Number(row.querySelector('input[type="number"]').value) > 0 && !row.querySelector('input[type="text"]').value.trim());
            if (invalidOneOff) { status.textContent = 'Укажите источник или причину каждой разовой операции.'; return; }
            const collectOneOff = kind => [...form.querySelectorAll('[data-one-off-row]')].filter(row => row.querySelector('[name="transaction_type"]').value === kind).map(row => ({ reason: row.querySelector('[name="transaction_reason"]').value.trim(), amount: Math.max(0, Number(row.querySelector('[name="transaction_amount"]').value) || 0) })).filter(item => item.reason || item.amount > 0);
            const next = { ...settings, economy: { ...economy, income: { ...income, other_one_off: 0 }, expenses: { ...expenses, other_one_off: 0 }, one_off_income_treasury: collectOneOff('treasury_income'), one_off_expenses_treasury: collectOneOff('treasury_expense'), one_off_income_prestige: collectOneOff('prestige_income'), one_off_expenses_prestige: collectOneOff('prestige_expense') } };
            try { state.stateMechanics[owner] = await saveStateMechanics(owner, next); await renderEconomy(owner, playerName); }
            catch (error) { status.textContent = `Ошибка сохранения: ${error.message}`; }
        });
    } catch (error) { showPageView('Экономика', `<div class="page-error">Не удалось загрузить экономику: ${escapeHtml(error.message)}</div>`, { navId: 'nav-economy', subtitle: owner }); }
}

function renderUnavailableSection(title, description, navId) {
    showPageView(title, `<section class="page-empty-state"><div class="page-empty-icon">✦</div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></section>`, { navId });
}

const modifierStatusLabels = { pending:'Ожидает решения', active:'Активен', rejected:'Отклонён', expired:'Истёк', revoked:'Прекращён' };
const modifierScopeLabels = Object.fromEntries(MODIFIER_SCOPES);

async function renderModifierPage(preferredOwner = '') {
    const isAdmin = state.userProfile?.role === 'admin';
    const playerOwner = state.userProfile?.owner || '';
    showPageView('Модификаторы', '<div class="page-loading">Загружаю модификаторы…</div>', { navId: 'nav-modifiers' });
    try {
        const [snapshot, profiles] = await Promise.all([fetchEconomySnapshot(), isAdmin ? fetchStateProfiles() : Promise.resolve([])]);
        state.economySnapshot = snapshot;
        state.stateMechanics = Object.fromEntries(snapshot.mechanics.map(row => [row.owner, row.settings || {}]));
        const owners = isAdmin ? [...new Set(profiles.map(profile => profile.owner).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru')) : (playerOwner ? [playerOwner] : []);
        const owner = owners.includes(preferredOwner) ? preferredOwner : (owners.includes(activePageOwner) ? activePageOwner : owners[0] || '');
        activePageOwner = owner;
        const currentTurn = Number(snapshot.calendar?.turn) || 1;
        const settings = snapshot.mechanics.find(row => row.owner === owner)?.settings || {};
        const staticRows = getOwnerModifiers(owner, snapshot, currentTurn).filter(row => row.source_type === 'static');
        const manualRows = (snapshot.modifiers || []).filter(row => isAdmin || row.owner === owner);
        const activeManualRows = manualRows.filter(row => row.owner === owner);
        const pendingRows = isAdmin ? manualRows.filter(row => row.status === 'pending') : activeManualRows.filter(row => row.status === 'pending');
        const optionList = entries => entries.map(([value,label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join('');
        const selectedOwnerOptions = owners.map(name => `<option value="${escapeHtml(name)}" ${name===owner?'selected':''}>${escapeHtml(name)}</option>`).join('');
        const itemOptions = modifierItemOptions();
        const effectOptions = MODIFIER_EFFECTS.map(effect => `<option value="${escapeHtml(effect.key)}" data-unit="${escapeHtml(effect.unit)}" data-scopes="${escapeHtml(effect.scopes.join(','))}">${escapeHtml(effect.label)} (${escapeHtml(effect.unit)})</option>`).join('');
        const scopeOptions = MODIFIER_SCOPES.map(([value,label]) => `<option value="${value}">${label}</option>`).join('');
        const targetTypeLabels = {province:'Провинции',marker:'Все поселения',city:'Города и крупные города',large_city:'Только крупные города',monastery:'Монастыри',fortress:'Остроги',army:'Армии',fleet:'Флотилии'};
        const scopeChoiceData = {
            state: [['','Всё государство']],
            estate: MODIFIER_SCOPE_VALUES.estate,
            need: MODIFIER_SCOPE_VALUES.need,
            resource: itemOptions.filter(([value])=>RESOURCES.includes(value)),
            good: itemOptions.filter(([value])=>GOODS.includes(value)),
            culture: [...new Set([...snapshot.provinces.map(row=>row.main_culture),...snapshot.markers.map(row=>row.culture)].filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru')).map(value=>[value,value]),
            religion: [...new Set([...snapshot.provinces.map(row=>row.main_religion),...snapshot.markers.map(row=>row.religion)].filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru')).map(value=>[value,value]),
            province: snapshot.provinces.filter(row=>row.owner===owner).map(row=>[String(row.id),`#${row.id} · ${row.province_name||row.region||'Провинция'}`]),
            marker: snapshot.markers.filter(row=>row.owner===owner).map(row=>[String(row.id),`${row.name||`Поселение #${row.id}`} · #${row.province_id}`]),
            army: [...(snapshot.militaryForces||[]),...(snapshot.militaryFleets||[])].filter(row=>row.owner===owner).map(row=>[String(row.id),row.name||`Отряд #${row.id}`])
        };
        const scopeDataJson = JSON.stringify(scopeChoiceData).replace(/</g,'\\u003c');
        const showItemSelector = effect => ['resource_production_pct','good_production_pct','spoilage_pct'].includes(effect.key);
        const valueText = value => `${Number(value)>0?'+':''}${formatNumber(Number(value)||0,2)}`;
        const showScope = row => {
            const scope = row.scope_type || 'state';
            const value = scope === 'state' ? '' : (row.scope_value || '—');
            const names = {aristocracy:'Аристократия',clergy:'Духовенство',burghers:'Горожане',peasants:'Крестьянство'};
            const resolved = scope === 'province' ? `Провинция #${value}` : scope === 'marker' ? `Поселение #${value}` : names[value] || value;
            const suffix = row.target_type ? ` · ${row.target_type}` : '';
            const item = row.item_name ? ` · ${row.item_name}` : '';
            return `${modifierScopeLabels[scope] || scope}${resolved ? `: ${resolved}` : ''}${suffix}${item}`;
        };
        const getDisplayStatus = row => row.status === 'active' && row.ends_turn != null && Number(row.ends_turn) < currentTurn ? 'expired' : row.status;
        const tableRows = (rows, allowActions=false, showOwner=false) => rows.length ? rows.map(row => {
            const effect=MODIFIER_EFFECTS.find(item=>item.key===row.effect_key);
            const unit=row.unit || effect?.unit || '';
            const status=getDisplayStatus(row);
            const action=allowActions && isAdmin ? (row.status==='pending'
                ? `<div class="modifier-actions"><button class="compact-add-btn" data-modifier-decision="approve" data-modifier-id="${Number(row.id)}">Утвердить</button><button class="page-back-btn" data-modifier-decision="reject" data-modifier-id="${Number(row.id)}">Отклонить</button></div>`
                : row.status==='active' ? `<button class="page-back-btn" data-modifier-decision="revoke" data-modifier-id="${Number(row.id)}">Прекратить</button>` : '—') : '—';
            return `<tr>${showOwner?`<td>${escapeHtml(row.owner)}</td>`:''}<td>${escapeHtml(effect?.label || row.effect_key)}</td><td>${escapeHtml(valueText(row.value))} ${escapeHtml(unit)}</td><td>${escapeHtml(showScope(row))}</td><td>${escapeHtml(row.source || '—')}</td><td>${formatNumber(Number(row.issued_turn)||1)}</td><td>${formatNumber(Number(row.starts_turn)||1)}</td><td>${row.ends_turn==null?'Бессрочно':formatNumber(Number(row.ends_turn))}</td><td><span class="modifier-status modifier-status-${escapeHtml(status)}">${modifierStatusLabels[status]||status}</span></td>${allowActions?`<td>${action}</td>`:''}</tr>`;
        }).join('') : `<tr><td colspan="${(showOwner?1:0)+8+(allowActions?1:0)}">Пока нет записей.</td></tr>`;
        const pendingTable = `<section class="page-panel modifier-panel"><header class="page-panel-heading"><div><h2>${isAdmin?'Предложения игроков':'Мои предложения'}</h2><p>${isAdmin?'Утверждённый эффект начнёт действовать с указанного хода; если ход уже прошёл, начало переносится на текущий.':'Предложение не влияет на расчёты, пока его не утвердит администратор.'}</p></div></header><div class="page-table-wrap"><table class="page-table"><thead><tr>${isAdmin?'<th>Государство</th>':''}<th>Показатель</th><th>Значение</th><th>Область действия</th><th>Источник</th><th>Ход выдачи</th><th>Начало</th><th>Окончание</th><th>Статус</th><th>Решение</th></tr></thead><tbody>${tableRows(pendingRows,true,isAdmin)}</tbody></table></div></section>`;
        const form = owner ? `<section class="page-panel modifier-panel"><header class="page-panel-heading"><div><h2>${isAdmin?'Назначить модификатор':'Предложить модификатор'}</h2><p>${isAdmin?'Назначение администратора начинает действовать без дополнительного подтверждения.':'Предложение сначала проверяет администратор.'} Текущий ход: ${formatNumber(currentTurn)}.</p></div></header><form id="modifier-form" class="modifier-form" data-scope-options="${escapeHtml(scopeDataJson)}">
            ${isAdmin?`<label>Государство<select name="owner" id="modifier-owner">${selectedOwnerOptions}</select></label>`:''}
            <label>Показатель<select name="effect_key" id="modifier-effect">${effectOptions}</select></label>
            <label>Значение<input name="value" type="number" step="0.1" required></label>
            <label>Область<select name="scope_type" id="modifier-scope">${scopeOptions}</select></label>
            <label id="modifier-scope-value-wrap">Цель<select name="scope_value" id="modifier-scope-value"></select></label>
            <label id="modifier-item-wrap" hidden>Ресурс или товар<select name="item_name" id="modifier-item"><option value="">Все подходящие</option>${optionList(itemOptions)}</select></label>
            <label id="modifier-target-wrap" hidden>Уточнение территории<select name="target_type" id="modifier-target-type"><option value="">Все подходящие территории</option></select></label>
            <label>Ход начала<input name="starts_turn" type="number" min="${currentTurn}" value="${currentTurn}" required></label>
            <label>Ход окончания<input name="ends_turn" type="number" min="${currentTurn}" placeholder="Бессрочно"></label>
            <label class="modifier-source-field">Источник / основание<input name="source" maxlength="500" required placeholder="Вердикт, реформа, событие…"></label>
            <button class="page-map-btn" type="submit">${isAdmin?'Назначить':'Отправить на утверждение'}</button><span id="modifier-form-status" aria-live="polite"></span>
        </form></section>` : '<div class="page-empty">Для предложений модификаторов войдите в государство как игрок или администратор.</div>';
        const staticPanel = `<section class="page-panel modifier-panel"><header class="page-panel-heading"><div><h2>Постоянные модификаторы</h2><p>Автоматически следуют из формы правления, титульной культуры и религии, а также правил культур и религий государства.</p></div></header><div class="page-table-wrap"><table class="page-table"><thead><tr><th>Показатель</th><th>Значение</th><th>Область действия</th><th>Источник</th><th>Статус</th></tr></thead><tbody>${staticRows.length?staticRows.map(row=>`<tr><td>${escapeHtml(modifierLabel(row.effect_key))}</td><td>${escapeHtml(valueText(row.value))} ${escapeHtml(row.unit)}</td><td>${escapeHtml(showScope(row))}</td><td>${escapeHtml(row.source)}</td><td>Постоянный</td></tr>`).join(''):'<tr><td colspan="5">Форма правления, культура и религия пока не задают постоянных эффектов.</td></tr>'}</tbody></table></div></section>`;
        const historyRows = activeManualRows.filter(row=>row.status!=='pending');
        const historyPanel = `<section class="page-panel modifier-panel"><header class="page-panel-heading"><div><h2>Назначенные модификаторы</h2><p>Истёкшие эффекты остаются в истории и не влияют на текущие расчёты.</p></div></header><div class="page-table-wrap"><table class="page-table"><thead><tr><th>Показатель</th><th>Значение</th><th>Область действия</th><th>Источник</th><th>Ход выдачи</th><th>Начало</th><th>Окончание</th><th>Статус</th>${isAdmin?'<th>Действие</th>':''}</tr></thead><tbody>${tableRows(historyRows,isAdmin,false)}</tbody></table></div></section>`;
        const content = `${isAdmin&&owners.length>1?`<p class="modifier-owner-note">Выбранное государство: <strong>${escapeHtml(owner||'—')}</strong></p>`:''}${form}${pendingTable}${staticPanel}${historyPanel}`;
        showPageView('Модификаторы', content, { navId: 'nav-modifiers', subtitle: owner || 'Государства' });

        const formNode=elements.pageView.querySelector('#modifier-form');
        const scopeNode=formNode?.querySelector('#modifier-scope'),scopeValueNode=formNode?.querySelector('#modifier-scope-value');
        const refreshScopeChoices=()=>{
            if(!formNode||!scopeNode||!scopeValueNode)return;
            const options=JSON.parse(formNode.dataset.scopeOptions||'{}');
            const selectedScope=scopeNode.value;
            const choices=options[selectedScope]||[];
            scopeValueNode.innerHTML=optionList(choices);
            formNode.querySelector('#modifier-scope-value-wrap').hidden=selectedScope==='state';
            const effect=MODIFIER_EFFECTS.find(row=>row.key===formNode.querySelector('#modifier-effect').value);
            scopeNode.innerHTML=MODIFIER_SCOPES.filter(([value])=>effect?.scopes.includes(value)).map(([value,label])=>`<option value="${value}">${label}</option>`).join('');
            if(!effect?.scopes.includes(selectedScope))scopeNode.value=effect?.scopes[0]||'state';
            const hasItem=showItemSelector(effect||{});
            formNode.querySelector('#modifier-item-wrap').hidden=!hasItem;
            const itemSelect=formNode.querySelector('#modifier-item');
            [...itemSelect.options].forEach(option=>{option.hidden=!!option.value&&((effect?.key==='resource_production_pct'&&!RESOURCES.includes(option.value))||(effect?.key==='good_production_pct'&&!GOODS.includes(option.value))||(effect?.key==='spoilage_pct'&&!itemOptions.some(([value])=>value===option.value)));});
            const scopeOptions=options[scopeNode.value]||[];
            scopeValueNode.innerHTML=optionList(scopeOptions);
            formNode.querySelector('#modifier-scope-value-wrap').hidden=scopeNode.value==='state';
            const targetNode=formNode.querySelector('#modifier-target-type');
            const targets=effect?.targets||[];
            targetNode.innerHTML=`<option value="">Все подходящие территории</option>${targets.map(value=>`<option value="${value}">${targetTypeLabels[value]||value}</option>`).join('')}`;
            formNode.querySelector('#modifier-target-wrap').hidden=!targets.length;
        };
        formNode?.querySelector('#modifier-effect')?.addEventListener('change',refreshScopeChoices);
        scopeNode?.addEventListener('change',refreshScopeChoices);
        refreshScopeChoices();
        elements.pageView.querySelector('#modifier-owner')?.addEventListener('change',event=>renderModifierPage(event.currentTarget.value));
        formNode?.addEventListener('submit',async event=>{
            event.preventDefault();
            const submit=formNode.querySelector('button[type="submit"]'),status=formNode.querySelector('#modifier-form-status');
            submit.disabled=true;status.textContent='Сохраняю…';
            const values={owner:isAdmin?formNode.elements.owner.value:owner,effectKey:formNode.elements.effect_key.value,value:Number(formNode.elements.value.value),scopeType:formNode.elements.scope_type.value,scopeValue:formNode.elements.scope_value.value,targetType:formNode.elements.target_type.value,itemName:formNode.elements.item_name.value,source:formNode.elements.source.value.trim(),startsTurn:Number(formNode.elements.starts_turn.value),endsTurn:formNode.elements.ends_turn.value?Number(formNode.elements.ends_turn.value):null};
            try { if(isAdmin)await adminCreateStateModifier(values);else await submitStateModifierProposal(values);showToast(isAdmin?'Модификатор назначен':'Предложение отправлено администратору');await renderModifierPage(values.owner); }
            catch(error){status.textContent=`Не удалось сохранить модификатор: ${error.message}`;submit.disabled=false;}
        });
        elements.pageView.querySelectorAll('[data-modifier-decision]').forEach(button=>button.addEventListener('click',async event=>{
            const control=event.currentTarget;control.disabled=true;
            try{await adminDecideStateModifier(Number(control.dataset.modifierId),control.dataset.modifierDecision);state.economySnapshot=await fetchEconomySnapshot();showToast('Решение по модификатору сохранено');await renderModifierPage(owner);}
            catch(error){showToast(`Не удалось обработать модификатор: ${error.message}`);control.disabled=false;}
        }));
    } catch(error) {
        showPageView('Модификаторы', `<div class="page-error">Не удалось загрузить модификаторы: ${escapeHtml(error.message)}</div>`, { navId:'nav-modifiers' });
    }
}

async function renderMilitaryPlanner(spyOnly = false) {
    const isAdmin = state.userProfile?.role === 'admin';
    let militaryMercenaryOffers = [];
    let mercenaryMarketError = '';
    let battleHeaders = [], militaryProfiles = [], militaryFleets = [], militaryPrisoners = [], militaryPorts = [], shipBuildOrders = [], militaryLevyOrders = [], militarySieges = [], militaryRaids = [], colonizationMissions = [], epidemicEvents = [], conditionalOrders = [], spyRecords = { spies:[], networks:[], orders:[], intel:[], alerts:[] }, spyDataError = '', levySnapshot = null, militaryDataError = '', forceDataError = '', fleetDataError = '', prisonerDataError = '', portDataError = '', shipBuildDataError = '', levyDataError = '', structureDataError = '', siegeDataError = '', raidDataError = '', colonizationDataError = '';
    let militaryCommanders = [], commanderDataError = '';
    const canUseSpySystem = state.userProfile?.role === 'player' || isAdmin;
    const loadResult = async loader => {
        try { return { data: await loader() }; }
        catch (error) { return { error }; }
    };
    if (spyOnly) {
        const [profilesResult, spyResult] = await Promise.all([
            isAdmin ? loadResult(fetchStateProfiles) : Promise.resolve({ data: [] }),
            canUseSpySystem ? loadResult(fetchMilitarySpyRecords) : Promise.resolve({ data: spyRecords })
        ]);
        militaryProfiles = profilesResult.data?.filter(profile => profile.owner) || [];
        if (profilesResult.error) forceDataError = profilesResult.error.message || 'Не удалось загрузить список государств.';
        spyRecords = spyResult.data || spyRecords;
        if (spyResult.error) spyDataError = spyResult.error.message || 'Не удалось загрузить шпионскую систему.';
    } else {
        const loaders = [
            ['battles', fetchMilitaryBattles], ['profiles', isAdmin ? fetchStateProfiles : null],
            ['forces', fetchMilitaryForces], ['commanders', fetchMilitaryCommanders],
            ['conditional', canUseSpySystem ? fetchMilitaryConditionalOrders : null],
            ['spies', canUseSpySystem ? fetchMilitarySpyRecords : null], ['epidemics', fetchMilitaryEpidemicEvents],
            ['fleets', fetchMilitaryFleets], ['prisoners', fetchMilitaryPrisoners], ['ports', fetchMilitaryPorts],
            ['shipOrders', fetchMilitaryShipBuildOrders], ['structures', fetchMilitaryStructures],
            ['sieges', fetchMilitarySieges], ['raids', fetchMilitaryRaids], ['colonization', fetchMilitaryColonizationMissions],
            ['mercenaries', fetchMilitaryMercenaryOffers],
            ['levy', state.userProfile?.role === 'player' && state.userProfile.owner ? () => Promise.all([fetchEconomySnapshot(), fetchMilitaryLevyOrders()]) : null]
        ];
        const results = Object.fromEntries(await Promise.all(loaders.map(async ([key, loader]) => [key, loader ? await loadResult(loader) : { data: null }])));
        const read = key => results[key]?.data;
        const error = key => results[key]?.error;
        battleHeaders = read('battles') || [];
        militaryProfiles = (read('profiles') || []).filter(profile => profile.owner);
        state.militaryForces = read('forces') || [];
        militaryCommanders = read('commanders') || [];
        if (militaryCommanders.length || !error('commanders')) state.militaryCommanders = militaryCommanders;
        conditionalOrders = read('conditional') || [];
        spyRecords = read('spies') || spyRecords;
        epidemicEvents = read('epidemics') || [];
        militaryFleets = read('fleets') || []; state.militaryFleets = militaryFleets;
        militaryPrisoners = read('prisoners') || [];
        militaryPorts = read('ports') || []; state.militaryPorts = militaryPorts;
        shipBuildOrders = read('shipOrders') || [];
        state.militaryStructures = read('structures') || [];
        militarySieges = read('sieges') || [];
        militaryRaids = read('raids') || [];
        colonizationMissions = read('colonization') || [];
        militaryMercenaryOffers = read('mercenaries') || [];
        if (read('levy')) [levySnapshot, militaryLevyOrders] = read('levy');
        if (error('battles')) militaryDataError = error('battles').message || 'Таблицы военных событий ещё не созданы.';
        if (error('profiles')) forceDataError = error('profiles').message || 'Не удалось загрузить список государств.';
        if (error('forces')) forceDataError = error('forces').message || 'Реестр войск ещё не создан.';
        if (error('commanders')) commanderDataError = error('commanders').message || 'Реестр воевод ещё не создан.';
        if (error('conditional')) forceDataError ||= error('conditional').message || 'Не удалось загрузить условные приказы.';
        if (error('spies')) spyDataError = error('spies').message || 'Не удалось загрузить шпионскую систему.';
        if (error('epidemics') && isAdmin) forceDataError ||= error('epidemics').message || 'Таблица эпидемических событий ещё не создана.';
        if (error('fleets')) fleetDataError = error('fleets').message || 'Реестр флотов ещё не создан.';
        if (error('prisoners')) prisonerDataError = error('prisoners').message || 'Реестр пленных ещё не создан.';
        if (error('ports')) portDataError = error('ports').message || 'Реестр портов ещё не создан.';
        if (error('shipOrders')) shipBuildDataError = error('shipOrders').message || 'Реестр строительства судов ещё не создан.';
        if (error('structures')) structureDataError = error('structures').message || 'Реестр полевых сооружений ещё не создан.';
        if (error('sieges')) siegeDataError = error('sieges').message || 'Реестр осад ещё не создан.';
        if (error('raids')) raidDataError = error('raids').message || 'Реестр набегов ещё не создан.';
        if (error('colonization')) colonizationDataError = error('colonization').message || 'Реестр колонизационных миссий ещё не создан.';
        if (error('mercenaries')) mercenaryMarketError = error('mercenaries').message || 'Рынок наёмников ещё не создан.';
        if (error('levy')) levyDataError = error('levy').message || 'Не удалось загрузить данные для сбора ополчения.';
        renderMilitaryGrid();
    }
    const unitNames = Object.keys(LAND_UNIT_PROFILES);
    const footUnits = unitNames.filter(name => !['cavalry','scout'].includes(LAND_UNIT_PROFILES[name].role));
    const cavalryUnits = unitNames.filter(name => LAND_UNIT_PROFILES[name].role === 'cavalry');
    const playerOwner = state.userProfile?.owner || '';
    const spyStates = [...new Set([
        ...Object.values(state.dbProvinces || {}).map(province => province.owner).filter(Boolean),
        ...militaryProfiles.map(profile => profile.owner).filter(Boolean)
    ])].sort((a,b) => a.localeCompare(b,'ru'));
    const spyTargetOptions = spyStates.filter(owner => owner !== playerOwner).map(owner => `<option value="${escapeHtml(owner)}">${escapeHtml(owner)}</option>`).join('');
    const ownSpyMarkers = (state.dbMarkers || []).filter(marker => marker.owner && marker.owner !== playerOwner && marker.type !== 'ruins');
    const spyCargoOptions = [...new Set([...RESOURCES,...GOODS])].map(item => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
    const visibleSpies = spyRecords.spies.filter(spy => isAdmin || spy.owner === playerOwner);
    const networkBySpy = new Map(spyRecords.networks.map(network => [network.spy_id, network]));
    const spyStatusLabels = { active:'Действует', dead:'Погиб', dismissed:'Распущен' };
    const spyRows = visibleSpies.map(spy => {
        const network = networkBySpy.get(spy.id);
        const action = spy.counterintelligence ? 'Контршпионаж' : network ? `Сеть против ${escapeHtml(network.target_owner)} · сила ${formatNumber(network.strength)}/100` : 'Без сети';
        const xp = `${formatNumber(spy.experience)} опыта · уровень ${formatNumber(spy.level)}`;
        const controls = !isAdmin && spy.owner === playerOwner && spy.status === 'active'
            ? `<div class="military-spy-controls"><form class="military-spy-network" data-spy-id="${escapeHtml(spy.id)}"><select name="target_owner" aria-label="Цель сети"><option value="">Выбрать государство</option>${spyTargetOptions}</select><button class="compact-add-btn" type="submit">Создать / сменить сеть · 2 ОП</button></form><form class="military-spy-counter" data-spy-id="${escapeHtml(spy.id)}"><label class="military-check"><input type="checkbox" name="enabled" ${spy.counterintelligence ? 'checked' : ''}> Назначить на контршпионаж</label><button class="compact-add-btn" type="submit">Сохранить</button></form>${network ? `<form class="military-spy-operation" data-spy-id="${escapeHtml(spy.id)}"><label>Операция<select name="operation"><option value="garrison_intel">Разведать гарнизон · 10 сети</option><option value="province_recon">Разведать провинцию · 20 сети</option><option value="network_detection">Найти чужие сети · 25 сети</option><option value="sabotage">Саботаж производства · 30 сети</option></select></label><label data-spy-field="marker">Поселение<select name="marker_id"><option value="">Выбрать поселение</option>${ownSpyMarkers.filter(marker => marker.owner === network.target_owner).map(marker => `<option value="${Number(marker.id)}">${escapeHtml(marker.name || `Поселение #${marker.id}`)}</option>`).join('')}</select></label><label data-spy-field="province">Провинция<select name="province_id"><option value="">Выбрать провинцию</option>${Object.values(state.dbProvinces || {}).filter(province => province.owner === network.target_owner).map(province => `<option value="${Number(province.id)}">${escapeHtml(province.province_name || `Провинция ${province.id}`)}</option>`).join('')}</select></label><label data-spy-field="item">Ресурс / товар для саботажа<select name="item_name"><option value="">Выбрать груз</option>${spyCargoOptions}</select></label><button class="compact-add-btn" type="submit">Провести операцию</button></form>` : ''}<button class="page-back-btn" type="button" data-dismiss-spy="${escapeHtml(spy.id)}">Распустить шпиона</button></div>` : '';
        return `<tr><td>${escapeHtml(spy.name)} · ${escapeHtml(spy.owner)}<small>${formatNumber(spy.age)} лет</small></td><td>${xp}</td><td>${escapeHtml(spyStatusLabels[spy.status] || spy.status)} · ${action}</td><td>${controls}</td></tr>`;
    }).join('');
    const spyIntelRows = spyRecords.intel.filter(item => isAdmin || item.owner === playerOwner).map(item => `<article class="military-event-card"><div><strong>${escapeHtml(item.intel_type === 'garrison' ? 'Разведка гарнизона' : item.intel_type === 'province' ? 'Разведка провинции' : 'Обнаружение сетей')} · ${escapeHtml(item.target_label)}</strong><span>${escapeHtml(item.source_owner)} · действует до хода ${formatNumber(item.expires_turn)}</span><small>${escapeHtml(JSON.stringify(item.payload))}</small></div></article>`).join('');
    const spyAlertRows = spyRecords.alerts.filter(item => isAdmin || item.owner === playerOwner).slice(0,12).map(item => `<article class="military-event-card"><div><strong>${escapeHtml(item.message)}</strong><span>Ход ${formatNumber(item.created_turn)}</span></div></article>`).join('');
    const spyPanel = state.userProfile?.role === 'player' || isAdmin ? `<section class="page-panel military-spy-panel"><header class="page-panel-heading"><div><h2>Шпионаж</h2><p>Сеть растёт на 5 пунктов за сезон и на 2 дополнительных за каждый уровень агента выше первого. Операция разрешается при смене хода; шанс успеха и риск раскрытия учитывают силу сети и контршпионаж.</p></div></header>${spyDataError ? `<p class="page-error">Не удалось загрузить шпионскую систему: ${escapeHtml(spyDataError)}</p>` : ''}${state.userProfile?.role === 'player' ? `<form id="military-spy-hire" class="military-form-grid military-character-hire"><label>Имя шпиона<input name="name" maxlength="80" autocomplete="off" required></label><button class="admin-btn" type="submit">Нанять · 10 ОП</button><small>Возраст шпиона определяется случайно: от 30 до 60 лет. Лимит: 1 шпион + 1 за каждый Крупный город; до 3 сверх лимита с содержанием 2 ОП/ход.</small></form>` : ''}<div class="page-table-wrap"><table class="page-table"><thead><tr><th>Агент</th><th>Опыт</th><th>Назначение</th><th>Приказы</th></tr></thead><tbody>${spyRows || '<tr><td colspan="4">Шпионов пока нет.</td></tr>'}</tbody></table></div><h3>Сведения разведки</h3><div class="military-event-list">${spyIntelRows || '<p class="page-note">Действующей разведывательной информации нет.</p>'}</div><h3>Уведомления службы</h3><div class="military-event-list">${spyAlertRows || '<p class="page-note">Новых уведомлений нет.</p>'}</div></section>` : '';
    const ownedLevyMarkers = (levySnapshot?.markers || []).filter(marker => marker.owner === playerOwner && marker.type !== 'ruins' && (levySnapshot?.provinces || []).some(province => Number(province.id) === Number(marker.province_id) && province.owner === playerOwner));
    const levyMarkerOptions = ownedLevyMarkers.map(marker => {
        const province = levySnapshot.provinces.find(item => Number(item.id) === Number(marker.province_id));
        return `<option value="${Number(marker.id)}" data-culture="${escapeHtml(marker.culture || province?.main_culture || '')}">${escapeHtml(marker.name || `Поселение #${marker.id}`)} · ${escapeHtml(markerTypeLabels[marker.type] || marker.type)} · провинция ${escapeHtml(province?.province_name || marker.province_id)}</option>`;
    }).join('');
    const markerName = Object.fromEntries((levySnapshot?.markers || []).map(marker => [Number(marker.id), marker.name || `Поселение #${marker.id}`]));
    const roadProvinceName = id => state.provincesMeta[state.idToHexMap[Number(id)]]?.name || state.dbProvinces[Number(id)]?.province_name || `Провинция ${id}`;
    const ownedRoadProvinces = (levySnapshot?.provinces || []).filter(province => province.owner === playerOwner && !province.occupied_by);
    const roadProvinceOptions = ownedRoadProvinces.map(province => `<option value="${Number(province.id)}">${escapeHtml(roadProvinceName(province.id))}</option>`).join('');
    const roadSourceOptions = ownedLevyMarkers.map(marker => `<option value="${Number(marker.id)}">${escapeHtml(marker.name || `Поселение #${marker.id}`)}</option>`).join('');
    const siegeMarkerOptions = (levySnapshot?.markers || []).filter(marker => marker.owner && marker.owner !== playerOwner && marker.type !== 'ruins' && (marker.type === 'fortress' || Number(marker.fortification_level) > 0)).map(marker => `<option value="${Number(marker.id)}">${escapeHtml(marker.name || `Поселение #${marker.id}`)} · ${escapeHtml(marker.owner)} · укрепления ${marker.type === 'fortress' ? 'I' : formatNumber(marker.fortification_level)}</option>`).join('');
    const activeSiegeRows = militarySieges.map(siege => {
        const mineAttacker = isAdmin || siege.attacker_owner === playerOwner, mineDefender = isAdmin || siege.defender_owner === playerOwner;
        const participating = (siege.attacker_force_ids || []).map(id => state.militaryForces.find(force => force.id === id)).filter(force => force?.status === 'active' && force.force_kind === 'land_army');
        const forceOptions = participating.map(force => `<option value="${force.id}">${escapeHtml(force.name)} · ${formatNumber(force.action_points)} ОД</option>`).join('');
        const actionForm = (side) => {
            const attacker = side === 'attacker', allowed = attacker ? mineAttacker : mineDefender;
            if (!allowed || siege.status !== 'active') return `<small>${attacker ? `Осаждают: ${escapeHtml(siege.attacker_owner)}` : `Защитник: ${escapeHtml(siege.defender_owner)}`}${attacker ? '' : ' · приказ осаждающих скрыт'}</small>`;
            const options = attacker ? [['blockade','Продолжить блокаду'],['works','Осадные работы'],['assault','Штурм'],['lift','Снять осаду']] : [['defend','Обороняться'],['repair','Восстановить укрепления'],['sortie','Вылазка'],['surrender','Сдаться']];
            const currentOrder = attacker ? siege.attacker_order : siege.defender_order;
            const submittedTurn = Number(attacker ? siege.attacker_orders_turn : siege.defender_orders_turn);
            const alreadySent = submittedTurn === Number(state.gameCalendar?.turn) && currentOrder;
            return alreadySent ? `<small>Ваш приказ: ${escapeHtml(currentOrder)} · ожидает сезонного разрешения.</small>` : `<form class="military-siege-order" data-siege-id="${siege.id}" data-siege-side="${side}"><label>Приказ<select name="action">${options.map(([value,label]) => `<option value="${value}">${label}</option>`).join('')}</select></label>${attacker ? `<label>Воевода<select name="force_id"><option value="">Выбрать армию при необходимости</option>${forceOptions}</select></label><label>Работы<select name="method"><option value="bombardment">Обстрел</option><option value="sapping">Подкоп</option></select></label><label>Путь штурма<select name="route"><option value="ladders">Лестницы</option><option value="tower">Башня</option><option value="breach">Пролом</option><option value="ram">Таран / ворота</option></select></label>` : ''}<button type="submit" class="compact-add-btn">Подать приказ</button></form>`;
        };
        const stateLabel = siege.status === 'battle_pending' ? `Идёт сражение · ${String(siege.battle_id || '').slice(0,8)}` : siege.status === 'captured' ? 'Поселение под военным контролем осаждающего' : siege.status === 'lifted' ? 'Осада снята' : 'Блокада';
        return `<article class="military-siege-row"><header><strong>${escapeHtml(siege.marker_name || `Поселение #${siege.marker_id}`)}</strong><span>${stateLabel} · работы ${formatNumber(siege.works)}/100</span></header><div class="military-siege-orders">${actionForm('attacker')}${actionForm('defender')}</div></article>`;
    }).join('');
    const siegeForceOptions = state.militaryForces.filter(force => force.force_kind === 'land_army' && force.status === 'active' && (isAdmin || force.owner === playerOwner)).map(force => `<option value="${force.id}">${escapeHtml(force.name)} · ${escapeHtml(force.owner)} · ${formatNumber(force.action_points)} ОД</option>`).join('');
    const fortificationOptions = (state.dbMarkers || []).filter(marker => marker.type !== 'ruins').map(marker => `<option value="${Number(marker.id)}">${escapeHtml(marker.name || `Поселение #${marker.id}`)} · ${escapeHtml(marker.owner || 'нейтральное')} · ур. ${formatNumber(marker.type === 'fortress' ? Math.max(1, Number(marker.fortification_level) || 0) : Number(marker.fortification_level) || 0)}</option>`).join('');
    const siegePanel = state.userProfile?.role === 'player' || isAdmin ? `<section class="page-panel military-siege-panel"><header class="page-panel-heading"><div><h2>Осады</h2><p>Начать осаду можно армией на соседней клетке укреплённого поселения. Работа и штурм расходуют ОД; приказы сторон скрыты и разрешаются в конце сезона.</p></div></header>${siegeDataError ? `<p class="page-error military-db-warning">Не удалось загрузить осады: ${escapeHtml(siegeDataError)}</p>` : ''}${state.userProfile?.role === 'player' ? `<form id="military-siege-start" class="military-form-grid"><label>Укреплённое поселение<select name="marker_id" required>${siegeMarkerOptions}</select></label><label>Армия<select name="force_id" required>${siegeForceOptions}</select></label><button class="admin-btn" type="submit">Начать / присоединиться · 20 ОД</button></form>` : ''}${isAdmin ? `<form id="military-fortification-level" class="military-form-grid"><label>Поселение<select name="marker_id" required>${fortificationOptions}</select></label><label>Уровень<select name="level"><option value="0">Без укреплений</option><option value="1">I</option><option value="2">II</option><option value="3">III</option></select></label><button class="admin-btn" type="submit">Сохранить уровень</button></form>` : ''}${activeSiegeRows || '<p class="page-note">Активных осад нет.</p>'}</section>` : '';
    const raidForceOptions = state.militaryForces.filter(force => force.force_kind === 'land_army' && force.status === 'active' && force.owner === playerOwner).map(force => `<option value="${force.id}">${escapeHtml(force.name)} · ${formatNumber((force.unit_groups || []).reduce((sum, group) => sum + (Number(group.count) || 0), 0))} бойцов</option>`).join('');
    const raidRows = militaryRaids.filter(raid => raid.attacker_owner === playerOwner || raid.target_owner === playerOwner || isAdmin).map(raid => {
        const province = (levySnapshot?.provinces || []).find(item => Number(item.id) === Number(raid.province_id)) || state.dbProvinces?.[Number(raid.province_id)];
        const place = province?.province_name || roadProvinceName(raid.province_id);
        const stateLabel = raid.status === 'active' ? 'Набег идёт до конца хода' : raid.status === 'completed' ? 'Завершён' : 'Сорван';
        const loot = (raid.military_raid_loot || []).map(item => `${escapeHtml(item.item_name)} × ${formatNumber(item.quantity, 2)}`).join(', ');
        const result = raid.result || {};
        return `<article class="military-event-card"><div><strong>${escapeHtml(place)} · ${escapeHtml(raid.attacker_owner)} → ${escapeHtml(raid.target_owner)}</strong><span>${stateLabel} · ${formatNumber(Number(raid.success_scale) * 100, 0)}% силы</span><small>${raid.status === 'completed' ? `Потеряно: ${formatNumber(result.development_lost || 0)} развития и ${formatNumber(result.yards_lost || 0)} дворов · ${formatNumber(result.treasury_loot || 0)} z · ${loot || 'ресурсы не добыты'}` : raid.status === 'failed' ? 'Армия покинула провинцию или выбыла до завершения.' : 'Армия может защищаться, но не может отдавать другие приказы.'}</small></div></article>`;
    }).join('');
    const raidPanel = state.userProfile?.role === 'player' || isAdmin ? `<section class="page-panel military-siege-panel"><header class="page-panel-heading"><div><h2>Набеги</h2><p>Операция занимает один ход. Минимум 100 бойцов; полный эффект — от 500. Повторный набег на провинцию возможен не раньше чем через 5 ходов.</p></div></header>${raidDataError ? `<p class="page-error military-db-warning">Не удалось загрузить набеги: ${escapeHtml(raidDataError)}</p>` : ''}${state.userProfile?.role === 'player' ? `<form id="military-raid-start" class="military-form-grid"><label>Армия в чужой провинции<select name="force_id" required>${raidForceOptions}</select></label><button class="admin-btn" type="submit">Начать набег</button></form>` : ''}<div class="military-event-list">${raidRows || '<p class="page-note">Набегов пока нет.</p>'}</div></section>` : '';
    const neutralColonies = (levySnapshot?.provinces || []).filter(province => !province.owner
        && !(state.dbMarkers || []).some(marker => Number(marker.province_id) === Number(province.id) && marker.type !== 'ruins' && marker.owner !== playerOwner));
    const colonySourceOptions = ownedLevyMarkers.map(marker => `<option value="${Number(marker.id)}">${escapeHtml(marker.name || `Поселение #${marker.id}`)} · ${formatNumber(marker.yards)} дворов</option>`).join('');
    const colonyTargetOptions = neutralColonies.map(province => `<option value="${Number(province.id)}">${escapeHtml(roadProvinceName(province.id))}</option>`).join('');
    const seaColonizationFleetOptions = militaryFleets.filter(fleet => fleet.owner === playerOwner && fleet.status === 'active' && fleet.location_kind === 'port' && !fleet.colonization_mission_id)
        .map(fleet => `<option value="${fleet.id}">${escapeHtml(fleet.name)} · порт #${formatNumber(fleet.port_marker_id)}</option>`).join('');
    const colonyEscortForceOptions = state.militaryForces.filter(force => force.owner === playerOwner && force.force_kind === 'land_army' && force.status === 'active' && !force.colonization_mission_id)
        .map(force => `<option value="${force.id}">${escapeHtml(force.name)} · ${(force.unit_groups || []).reduce((sum,group) => sum+(Number(group.count)||0),0)} бойцов</option>`).join('');
    const seaColonizationForm = state.userProfile?.role === 'player' ? `<form id="military-sea-colonization-start" class="military-form-grid"><label>Поселение-источник с портом<select name="source_marker_id" required>${colonySourceOptions}</select></label><label>Нейтральная провинция<select name="target_province_id" required>${colonyTargetOptions}</select></label><label>Флот в порту<select name="fleet_id" required><option value="">Выберите флот</option>${seaColonizationFleetOptions}</select></label><label>Сопровождающая армия<select name="force_id"><option value="">Без войск</option>${colonyEscortForceOptions}</select></label><label>Дополнительное вложение<select name="extra_investment"><option value="0">Нет</option><option value="1000">1 000 z · +5%</option><option value="2000">2 000 z · +10%</option></select></label><button class="admin-btn" type="submit" ${!colonySourceOptions || !colonyTargetOptions || !seaColonizationFleetOptions ? 'disabled' : ''}>Начать морскую миссию</button></form>` : '';
    const colonyRows = colonizationMissions.filter(mission => mission.owner === playerOwner || isAdmin).map(mission => {
        const stage = mission.status === 'active' ? `Миссия ${Math.min(4, Math.max(1, Number(state.gameCalendar?.turn) - Number(mission.started_turn) + 1))}/4 · успех ${formatNumber(mission.success_chance)}%` : mission.status === 'succeeded' ? `Успешно · результат броска ${formatNumber(mission.result?.roll)}` : mission.status === 'cancelled' ? 'Отменена' : `Неудача · ${mission.result?.reason === 'payment_failed' ? 'не внесён сезонный платёж' : `результат броска ${formatNumber(mission.result?.roll)}`}`;
        const cancel = mission.status === 'active' && (isAdmin || mission.owner === playerOwner) ? `<button class="compact-add-btn" type="button" data-cancel-colonization="${mission.id}">Отменить · вернуть 25 дворов</button>` : '';
        return `<article class="military-event-card"><div><strong>${escapeHtml(roadProvinceName(mission.target_province_id))} · ${escapeHtml(mission.owner)}</strong><span>${mission.mission_type === 'sea' ? 'Морская · ' : 'Сухопутная · '}${stage}</span><small>Поселение-источник #${formatNumber(mission.source_marker_id)} · вложено ${formatNumber(mission.investment)} z${mission.fleet_id ? ' · флот заблокирован до исхода' : ''}</small></div>${cancel}</article>`;
    }).join('');
    const colonizationPanel = state.userProfile?.role === 'player' || isAdmin ? `<section class="page-panel military-siege-panel"><header class="page-panel-heading"><div><h2>Колонизация нейтральных земель</h2><p>Сухопутная миссия длится 4 хода: 1 000 z при старте и ещё по 500 z в начале следующих трёх ходов. Поселенцы — 50 дворов; дополнительные 1 000 z повышают шанс на 5 п.п. (до +10 п.п.).</p></div></header>${colonizationDataError ? `<p class="page-error military-db-warning">Не удалось загрузить миссии: ${escapeHtml(colonizationDataError)}</p>` : ''}${state.userProfile?.role === 'player' ? `<form id="military-colonization-start" class="military-form-grid"><label>Поселение-источник<select name="source_marker_id" required>${colonySourceOptions}</select></label><label>Нейтральная соседняя провинция<select name="target_province_id" required>${colonyTargetOptions}</select></label><label>Сопровождающая армия<select name="force_id"><option value="">Без войск</option>${colonyEscortForceOptions}</select></label><label>Дополнительное вложение<select name="extra_investment"><option value="0">Нет</option><option value="1000">1 000 z · +5%</option><option value="2000">2 000 z · +10%</option></select></label><button class="admin-btn" type="submit" ${!colonySourceOptions || !colonyTargetOptions ? 'disabled' : ''}>Начать миссию</button></form>` : ''}${seaColonizationForm}<div class="military-event-list">${colonyRows || '<p class="page-note">Колонизационных миссий пока нет.</p>'}</div></section>` : '';
    const structureLabels = { bridge:'Мост', camp:'Полевой лагерь', watchtower:'Сторожевая башня', palisade:'Засека', ferry:'Волок' };
    const visibleStructures = state.militaryStructures.filter(item => item.owner === playerOwner || item.structure_type === 'bridge'
        || state.militaryVisibleCells.has(`${item.cell_x},${item.cell_y}`));
    const structureRows = visibleStructures.map(item => `<tr><td>${structureLabels[item.structure_type] || escapeHtml(item.structure_type)}</td><td>${escapeHtml(item.owner)}</td><td>${Number(item.cell_x)+1}:${Number(item.cell_y)+1}</td><td>${item.status === 'active' ? 'Действует' : item.status === 'broken' ? 'Сломан' : item.status === 'destroyed' ? 'Разрушен' : `Строится · с хода ${formatNumber(item.available_from_turn)}`}</td></tr>`).join('');
    const structureTypeOptions = Object.entries(structureLabels).map(([value,label]) => `<option value="${value}">${label}</option>`).join('');
    const levyStatusLabels = { training: 'Сбор и оснащение', raised: 'В гарнизоне', cancelled: 'Отменён' };
    const levyOrderRows = militaryLevyOrders.slice(0, 10).map(order => `<tr><td>${escapeHtml(order.unit_type)} · ${formatNumber(order.unit_count)}</td><td>${escapeHtml(markerName[Number(order.destination_marker_id)] || `Поселение #${order.destination_marker_id}`)}</td><td>${levyStatusLabels[order.status] || escapeHtml(order.status)}${order.status === 'training' ? ` · появится с хода ${formatNumber(order.due_turn)}` : ''}</td><td>${formatNumber(order.treasury_paid, 2)} z</td></tr>`).join('');
    const levyPotential = (() => {
        if (!levySnapshot || !playerOwner) return null;
        const provinces = (levySnapshot.provinces || []).filter(row => row.owner === playerOwner && !row.occupied_by);
        const markers = (levySnapshot.markers || []).filter(row => row.owner === playerOwner && row.type !== 'ruins');
        const provinceRatio = levySnapshot.estateRatios?.find(row => row.settlement_type === 'province') || {};
        const yards = {
            peasants: provinces.reduce((sum,row) => sum + (Number(row.yards)||0) * (Number(provinceRatio.peasants)||0.95),0),
            aristocracy: markers.reduce((sum,row) => sum + (Number(row.yards)||0) * (Number(levySnapshot.estateRatios?.find(r=>r.settlement_type===row.type)?.aristocracy)||0),0),
            burghers: markers.reduce((sum,row) => sum + (Number(row.yards)||0) * (Number(levySnapshot.estateRatios?.find(r=>r.settlement_type===row.type)?.burghers)||0),0)
        };
        const caps = Object.fromEntries(Object.entries(yards).map(([kind,value]) => [kind,calculateLevyCapacity(value,kind,false)]));
        const provincePotentialRows = provinces.map(province => {
            const cap=calculateLevyCapacity((Number(province.yards)||0)*(Number(provinceRatio.peasants)||0.95),'peasants');
            const used=state.militaryForces.filter(force=>force.owner===playerOwner&&force.is_militia&&force.status==='active'&&force.levy_source_kind==='peasants'&&Number(force.levy_source_id)===Number(province.id))
                .reduce((sum,force)=>sum+(force.unit_groups||[]).reduce((inner,group)=>inner+(Number(group.count)||0),0),0)
                +militaryLevyOrders.filter(order=>order.status==='training'&&order.levy_kind==='peasants'&&Number(order.source_id)===Number(province.id)).reduce((sum,order)=>sum+(Number(order.unit_count)||0),0);
            const provinceName=state.provincesMeta[state.idToHexMap[Number(province.id)]]?.name||province.province_name||`Провинция ${province.id}`;
            return `<tr><td>${escapeHtml(provinceName)}</td><td>${formatNumber(cap)}</td><td>${formatNumber(used)}</td><td>${formatNumber(Math.max(0,cap-used))}</td></tr>`;
        }).join('');
        const raised = state.militaryForces.filter(force=>force.owner===playerOwner&&force.is_militia&&force.status==='active')
            .reduce((sum,force)=>sum+(force.unit_groups||[]).reduce((inner,group)=>inner+(Number(group.count)||0),0),0);
        const underContract = state.militaryForces.filter(force=>force.owner===playerOwner&&force.is_mercenary&&force.status==='active').length;
        const garrisons = state.militaryForces.filter(force=>force.owner===playerOwner&&force.force_kind==='garrison'&&force.status==='active');
        const totalPotential = Object.values(caps).reduce((sum,value)=>sum+value,0);
        return `<section class="military-capacity-summary"><div><span>Военный потенциал ополчения</span><strong>${formatNumber(totalPotential)} бойцов</strong><small>Крестьяне ${formatNumber(caps.peasants)} · горожане ${formatNumber(caps.burghers)} · служилые ${formatNumber(caps.aristocracy)}</small></div><div><span>Уже собрано</span><strong>${formatNumber(raised)} ополченцев</strong></div><div><span>Контракты наёмников</span><strong>${formatNumber(underContract)} отрядов</strong></div><div><span>Гарнизоны поселений</span><strong>${formatNumber(garrisons.filter(force=>force.marker_id).length)}</strong><small>${formatNumber(garrisons.filter(force=>force.province_id).length)} провинциальных гарнизонов</small></div><details class="military-province-levy-potential"><summary>Потенциал крестьянского ополчения по провинциям</summary><div class="page-table-wrap"><table class="page-table"><thead><tr><th>Провинция</th><th>Максимум</th><th>Собрано</th><th>Доступно</th></tr></thead><tbody>${provincePotentialRows || '<tr><td colspan="4">Нет провинций под контролем.</td></tr>'}</tbody></table></div></details></section>`;
    })();
    const recruitmentPanel = `
        <section class="page-panel military-recruitment-panel">
            <header class="page-panel-heading"><div><h2>Сбор и содержание войск</h2><p>Квоты рассчитываются по сословным Дворам выбранного источника. После оплаты отряд появляется в Гарнизоне через один сезон и служит два сезона.</p></div></header>
            ${levyPotential || ''}<div class="military-recruitment-controls">
                <label>Источник сбора<select id="levy-kind"><option value="aristocracy">Служилые землевладельцы · конница</option><option value="burghers">Горожане · пешее войско и стрелки</option><option value="peasants">Крестьянство волостей · пешее войско</option></select></label>
                <label>Поселение сбора<select id="levy-marker"><option value="">— выберите поселение —</option>${levyMarkerOptions}</select></label>
                <label>Культура места сбора<input id="levy-culture" type="text" readonly value=""></label>
                <label>Дворы сословия источника<input id="levy-yards" type="number" min="0" step="1" value="0" readonly></label>
                <label>Режим сбора<select id="levy-emergency"><option value="false">Обычный</option><option value="true">Чрезвычайный</option></select></label>
                <label>Тип отряда<select id="levy-unit"></select></label>
                <label>Численность<input id="levy-count" type="number" min="0" step="1" value="0"></label>
            </div>
            <div id="levy-estimate" class="military-recruitment-estimate" aria-live="polite"></div>
            ${state.userProfile?.role === 'player' ? `<button class="admin-btn" id="place-military-levy-order" type="button" ${!levyMarkerOptions ? 'disabled' : ''}>Заказать сбор</button><span id="levy-order-status" aria-live="polite"></span>` : '<p class="page-note">Приказ на сбор войск доступен игроку за государство.</p>'}
            ${levyDataError ? `<p class="page-error">${escapeHtml(levyDataError)}</p>` : ''}
            <p class="page-note">При подаче приказа казна и товары списываются со склада выбранного поселения сразу. При нехватке денег или снаряжения заказ не создаётся. Квота и культурная доступность повторно проверяются на сервере.</p>
            <div class="page-table-wrap"><table class="page-table"><thead><tr><th>Отряд</th><th>Место сбора</th><th>Состояние</th><th>Оплачено</th></tr></thead><tbody>${levyOrderRows || '<tr><td colspan="4">Заказов на сбор пока нет.</td></tr>'}</tbody></table></div>
        </section>`;
    const mercenaryMarketRows = militaryMercenaryOffers.filter(offer => isAdmin || state.dbMarkers?.find(marker => Number(marker.id) === Number(offer.marker_id))?.owner === playerOwner).map(offer => {
        const marker = state.dbMarkers?.find(item => Number(item.id) === Number(offer.marker_id));
        const roster = (offer.unit_groups || []).map(group => `${escapeHtml(group.type)} ${formatNumber(group.count)}`).join(', ');
        const canHire = state.userProfile?.role === 'player' && offer.available && marker?.owner === playerOwner;
        return `<tr><td>${escapeHtml(marker?.name || `Поселение #${offer.marker_id}`)} · место ${formatNumber(offer.slot)}</td><td>${escapeHtml(offer.culture || 'Местный профиль')}</td><td>${escapeHtml(offer.commander_name)}, ${formatNumber(offer.commander_age)} лет</td><td>${roster}</td><td>${offer.available ? `2 z за человека · контракт 2 хода` : `Следующее предложение с хода ${formatNumber(offer.refresh_turn)}`}</td><td>${canHire ? `<button type="button" class="compact-add-btn" data-hire-mercenary="${offer.id}">Нанять группу</button>` : ''}</td></tr>`;
    }).join('');
    const mercenaryPanel = `<section class="page-panel military-recruitment-panel"><header class="page-panel-heading"><div><h2>Наёмники городского рынка</h2><p>В Городах есть одно предложение, в Крупных городах — два. Группа нанимается целиком, появляется в Гарнизоне и служит два хода. Первый сезон оплачен при найме; далее содержание — 2 z за каждого бойца и Воеводу, а также обычное снабжение. Предложение обновляется через два хода после найма.</p></div></header>${mercenaryMarketError ? `<p class="page-error">Не удалось загрузить рынок: ${escapeHtml(mercenaryMarketError)}</p>` : ''}<div class="page-table-wrap"><table class="page-table"><thead><tr><th>Город</th><th>Культура</th><th>Воевода</th><th>Отряд</th><th>Контракт</th><th></th></tr></thead><tbody>${mercenaryMarketRows || '<tr><td colspan="6">Доступных предложений наёмников пока нет.</td></tr>'}</tbody></table></div></section>`;
    const rows = unitNames.map(name => `<tr><td>${escapeHtml(name)}</td><td><input class="military-unit-count" type="number" min="0" max="100000" step="1" value="${name === 'Пешие ратники' ? 500 : 0}" data-unit="${escapeHtml(name)}" aria-label="Численность: ${escapeHtml(name)}"></td><td>${LAND_UNIT_PROFILES[name].mobility.toLocaleString('ru-RU')}</td></tr>`).join('');
    const movementRows = [['Равнина','plain',10,14],['Возвышенность','hill',15,21],['Лес','forest',15,21],['Болото','marsh',20,28]].map(([label,terrain,direct,diagonal]) => `<tr><td>${label}</td><td data-terrain="${terrain}" data-diagonal="false">${direct} ОД</td><td data-terrain="${terrain}" data-diagonal="true">${diagonal} ОД</td></tr>`).join('');
    const battleTactics = Object.entries(LAND_TACTICS).filter(([value]) => value !== 'feigned_retreat').map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join('');
    const battleOwnerOptions = militaryProfiles.map(profile => `<option value="${escapeHtml(profile.owner)}">${escapeHtml(profile.owner)} · ${escapeHtml(profile.nickname || 'игрок')}</option>`).join('');
    const portName = id => state.dbMarkers?.find(marker => Number(marker.id) === Number(id))?.name || `Поселение #${id}`;
    const activeOwnedPorts = militaryPorts.filter(port => port.owner === playerOwner && port.status === 'active');
    const portOptions = activeOwnedPorts.map(port => `<option value="${Number(port.marker_id)}">${escapeHtml(portName(port.marker_id))} · ${port.port_type === 'river_port' ? 'Речной порт' : 'Порт'}</option>`).join('');
    const ownedPortFleetOptions = militaryFleets.filter(fleet => fleet.owner === playerOwner && fleet.status === 'active' && fleet.location_kind === 'port' && !fleet.colonization_mission_id)
        .map(fleet => `<option value="${fleet.id}">${escapeHtml(fleet.name)} · ${escapeHtml(portName(fleet.port_marker_id))}</option>`).join('');
    const cargoShipOptions = militaryFleets.filter(fleet => fleet.owner === playerOwner && fleet.status === 'active' && fleet.location_kind === 'port')
        .flatMap(fleet => (fleet.ships || []).map((ship, index) => `<option value="${fleet.id}:${index + 1}">${escapeHtml(fleet.name)} · ${escapeHtml(ship.type)} #${index + 1}</option>`)).join('');
    const cargoItemOptions = (type = 'resource') => (type === 'good' ? GOODS : RESOURCES).map(item => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join('');
    const portRows = militaryPorts.filter(port => isAdmin || port.owner === playerOwner).map(port => `<tr><td>${escapeHtml(portName(port.marker_id))}</td><td>${escapeHtml(port.owner)}</td><td>${port.port_type === 'river_port' ? 'Речной порт · 6 мест' : 'Порт · 12 мест'}</td><td>${port.status === 'active' ? 'Действует' : port.status === 'building' ? `Строится · с хода ${formatNumber(port.available_from_turn)}` : 'Разрушен'}</td></tr>`).join('');
    const shipBuildRows = shipBuildOrders.filter(order => isAdmin || order.owner === playerOwner).map(order => `<tr><td>${escapeHtml(order.ship_type)}</td><td>${escapeHtml(portName(order.port_marker_id))}</td><td>${escapeHtml(militaryFleets.find(fleet => fleet.id === order.fleet_id)?.name || 'Флотилия')}</td><td>${order.status === 'completed' ? 'Построено' : order.status === 'cancelled' ? 'Прервано' : `В постройке · готовность с хода ${formatNumber(order.due_turn)}`}</td></tr>`).join('');
    const portPanel = state.userProfile?.role === 'player' || isAdmin ? `<section class="page-panel military-structures-panel"><header class="page-panel-heading"><div><h2>Порты и базирование флота</h2><p>Строительство порта занимает сезон. Речной порт: 2 000 z, 150 Древесины и 30 Инструментов. Морской порт: 4 000 z, 300 Древесины и 60 Инструментов. Постройка судов и полное оснащение экипажа оплачиваются при заказе по ценам правил.</p></div></header>${portDataError ? `<p class="page-error military-db-warning">Не удалось загрузить порты: ${escapeHtml(portDataError)}</p>` : ''}${shipBuildDataError ? `<p class="page-error military-db-warning">Не удалось загрузить заказы судов: ${escapeHtml(shipBuildDataError)}</p>` : ''}${state.userProfile?.role === 'player' ? `<form id="military-port-build" class="military-form-grid"><label>Поселение<select name="marker_id" required>${colonySourceOptions}</select></label><label>Тип<select name="port_type"><option value="river_port">Речной порт</option><option value="port">Морской порт</option></select></label><label>Склад материалов<select name="source_marker_id" required>${colonySourceOptions}</select></label><button class="admin-btn" type="submit" ${!colonySourceOptions ? 'disabled' : ''}>Начать строительство</button></form><form id="military-ship-build" class="military-form-grid"><label>Действующий порт<select name="port_marker_id" required>${portOptions}</select></label><label>Судно<select name="ship_type"><option>Ушкуй</option><option>Насад</option><option>Ладья</option><option>Когг</option><option>Хольк</option></select></label><label>Склад материалов<select name="source_marker_id" required>${colonySourceOptions}</select></label><label>Пополнить флотилию<select name="fleet_id"><option value="">Создать новую</option>${ownedPortFleetOptions}</select></label><label>Название новой флотилии<input name="fleet_name" maxlength="80" placeholder="Например, Северная флотилия"></label><label>Имя Воеводы новой флотилии<input name="commander_name" maxlength="80" placeholder="Заполнить для новой флотилии"></label><label>Возраст Воеводы<input name="commander_age" type="number" min="16" max="100" placeholder="35"></label><button class="admin-btn" type="submit" ${!portOptions || !colonySourceOptions ? 'disabled' : ''}>Заложить судно</button></form><form id="military-fleet-cargo" class="military-form-grid"><label>Судно в вашем порту<select name="fleet_ship" required><option value="">Выбрать судно</option>${cargoShipOptions}</select></label><label>Категория<select name="item_type"><option value="resource">Ресурс</option><option value="good">Товар</option></select></label><label>Груз<select name="item_name">${cargoItemOptions()}</select></label><label>Количество<input name="quantity" type="number" min="0.01" max="10000" step="0.01" value="1" required></label><label><input name="unload" type="checkbox"> Выгрузить из трюма</label><button class="admin-btn" type="submit" ${!cargoShipOptions ? 'disabled' : ''}>Переместить груз</button></form>` : ''}<div class="page-table-wrap"><table class="page-table"><thead><tr><th>Поселение</th><th>Государство</th><th>Тип / причалы</th><th>Состояние</th></tr></thead><tbody>${portRows || '<tr><td colspan="4">Портов пока нет.</td></tr>'}</tbody></table></div><div class="page-table-wrap"><table class="page-table"><thead><tr><th>Судно</th><th>Порт</th><th>Флотилия</th><th>Состояние</th></tr></thead><tbody>${shipBuildRows || '<tr><td colspan="4">Заказов на строительство судов пока нет.</td></tr>'}</tbody></table></div></section>` : '';
    const fleetCommanderSkills = [['management','Управление'],['leadership','Лидерство'],['tactics','Тактика'],['planning','Планирование'],['engineering','Инженерия']];
    const fleetRows = militaryFleets.map(fleet => {
        const cargo = (fleet.ships || []).flatMap(ship => Object.entries(ship.cargo || {}).filter(([,quantity]) => Number(quantity) > 0).map(([name,quantity]) => `${escapeHtml(name.replace(/^resource:|^good:/,''))} × ${formatNumber(quantity,2)}`)).join(', ');
        const ships = (fleet.ships || []).map(ship => `${escapeHtml(ship.type)} (${formatNumber(ship.crew)}/${formatNumber(NAVAL_SHIP_PROFILES[ship.type]?.crew || ship.crew)} экип., корпус ${formatNumber(ship.hull)})${ship.weapon && ship.weapon !== 'none' ? ` · ${escapeHtml(NAVAL_WEAPONS[ship.weapon] || ship.weapon)}` : ''}`).join(' · ') || (shipBuildOrders.some(order => order.fleet_id === fleet.id && order.status === 'building') ? 'Ожидает завершения постройки' : 'Нет судов');
        const position = fleet.location_kind === 'water' ? `Вода · ${Number(fleet.cell_x)+1}:${Number(fleet.cell_y)+1}` : fleet.location_kind === 'port' ? `В порту · ${escapeHtml(portName(fleet.port_marker_id))}` : 'Не размещена';
        const owns = isAdmin || fleet.owner === playerOwner;
        const fleetSkillSummary = fleetCommanderSkills.map(([key,label]) => `${label} ${Number(fleet.commander_skills?.[key]) || 0}`).join(' · ');
        const fleetTrainingOptions = fleetCommanderSkills.filter(([key]) => (Number(fleet.commander_skills?.[key]) || 0) < 5).map(([key,label]) => {
            const level = Number(fleet.commander_skills?.[key]) || 0;
            return `<option value="${key}">${label} ${level}→${level + 1} · ${2 * (level + 1)} опыта</option>`;
        }).join('');
        const fleetTraining = owns && fleet.status === 'active' && fleetTrainingOptions
            ? `<small>${formatNumber(fleet.commander_experience || 0)} опыта · ${fleetSkillSummary}</small><form class="fleet-commander-training" data-fleet-id="${fleet.id}"><select name="skill" aria-label="Навык Воеводы флота">${fleetTrainingOptions}</select><button type="submit" class="compact-add-btn">Повысить</button></form>`
            : `<small>${formatNumber(fleet.commander_experience || 0)} опыта · ${fleetSkillSummary}</small>`;
        const move = owns && !fleet.in_pending_battle && fleet.location_kind === 'water' && fleet.ships?.length ? `<button type="button" class="compact-add-btn" data-select-fleet="${fleet.id}">Маршрут на карте</button><form class="military-fleet-dock" data-fleet-id="${fleet.id}"><select name="port_marker_id" required><option value="">Выбрать порт</option>${portOptions}</select><button type="submit" class="compact-add-btn">Войти в порт</button></form>` : '';
        const launch = owns && !fleet.in_pending_battle && fleet.location_kind === 'port' && fleet.ships?.length ? `<button type="button" class="compact-add-btn" data-launch-fleet="${fleet.id}">Выбрать выход на карте</button>` : '';
        const passengers = (fleet.ships || []).flatMap((ship, shipIndex) => (ship.passengers || []).map(passenger => {
            const people = (passenger.unit_groups || []).reduce((sum, group) => sum + (Number(group.count) || 0), 0);
            const disembark = owns && passenger.owner === playerOwner && !passenger.captured_by && !fleet.in_pending_battle
                ? `<button type="button" class="compact-add-btn" data-disembark-force="${escapeHtml(passenger.force_id)}" data-fleet-id="${escapeHtml(fleet.id)}">Высадить на карте</button>` : '';
            return `<span class="military-passenger">${escapeHtml(passenger.name || 'Армия')} · ${formatNumber(people)} бойцов · судно #${shipIndex + 1} ${disembark}</span>`;
        })).join('');
        return `<tr><td>${escapeHtml(fleet.name)}${fleet.commander_name ? `<small>Воевода: ${escapeHtml(fleet.commander_name)}, ${formatNumber(fleet.commander_age)} лет</small>` : ''}${fleetTraining}</td><td>${escapeHtml(fleet.owner)}</td><td>${ships}${cargo ? `<small class="military-supply-status">Запасы на борту: ${cargo}</small>` : ''}${passengers ? `<small class="military-supply-status">Перевозимые войска: ${passengers}</small>` : ''}</td><td>${position}</td><td>${formatNumber(fleet.morale)}%<small class="military-supply-status">Содержание в прошлом ходу: ${formatNumber((Number(fleet.maintenance_coverage) || 0) * 100)}%</small></td><td>${formatNumber(fleet.action_points)} ОД</td><td>${move}${launch}</td></tr>`;
    }).join('');
    const prisonerRows = militaryPrisoners.filter(row => isAdmin || row.captor_owner === playerOwner || row.original_owner === playerOwner)
        .map(row => `<tr><td>${escapeHtml(row.force_name)}</td><td>${escapeHtml(row.original_owner)}</td><td>${escapeHtml(row.captor_owner)}</td><td>${row.commander_name ? `${escapeHtml(row.commander_name)}${row.commander_age ? ` · ${formatNumber(row.commander_age)} лет` : ''}` : '—'}</td><td>${(row.unit_groups || []).map(group => `${escapeHtml(group.type)} ${formatNumber(group.count)}`).join(', ') || '—'}</td><td>${row.status === 'held' ? 'Удерживаются в плену' : row.status === 'released' ? 'Освобождены' : row.status === 'ransomed' ? 'Выкуплены' : 'Бежали'}</td></tr>`).join('');
    const fleetSourceOptions = side => militaryFleets.filter(fleet => isAdmin || fleet.owner === state.userProfile?.owner).map(fleet => `<option value="${fleet.id}">${escapeHtml(fleet.name)} · ${escapeHtml(fleet.owner)}</option>`).join('');
    const embarkShipOptions = militaryFleets.filter(fleet => fleet.owner === playerOwner && fleet.status === 'active' && !fleet.in_pending_battle)
        .flatMap(fleet => (fleet.ships || []).map((ship, index) => `<option value="${fleet.id}:${index + 1}">${escapeHtml(fleet.name)} · ${escapeHtml(ship.type)} #${index + 1}</option>`)).join('');
    const battleForceOptions = state.militaryForces.filter(force => force.force_kind === 'land_army' && force.status === 'active').map(force => `<option value="${force.id}">${escapeHtml(force.name)} · ${escapeHtml(force.owner)}</option>`).join('');
    const navalShipTypes = Object.keys(NAVAL_SHIP_PROFILES);
    const navalShipRow = (side, index) => {
        const defaultType = index === 0 ? (side === 'attacker' ? 'Ушкуй' : 'Ладья') : '';
        const profile = NAVAL_SHIP_PROFILES[defaultType] || { crew: 0, hull: 0 };
        return `<tr data-naval-ship-row><td><select data-naval-type><option value="">— нет судна —</option>${navalShipTypes.map(type => `<option value="${escapeHtml(type)}" ${type === defaultType ? 'selected' : ''}>${escapeHtml(type)}</option>`).join('')}</select></td><td><input data-naval-crew type="number" min="0" max="30" value="${profile.crew}" aria-label="Экипаж"></td><td><input data-naval-hull type="number" min="0" max="5" value="${profile.hull}" aria-label="Прочность корпуса"></td><td><select data-naval-weapon>${Object.entries(NAVAL_WEAPONS).map(([value, label]) => `<option value="${value}">${escapeHtml(label)}</option>`).join('')}</select></td><td><input data-naval-boarding type="number" min="0" max="10000" value="0" aria-label="Ушкуйники на борту"></td></tr>`;
    };
    const commanderSkills = fleetCommanderSkills;
    const forceRows = state.militaryForces.map(force => {
        const composition = (force.unit_groups || []).map(group => `${escapeHtml(group.type)} ${formatNumber(group.count)}`).join(', ') || 'нет отрядов';
        const cargo = Object.entries(force.cargo || {}).filter(([, quantity]) => Number(quantity) > 0).map(([name, quantity]) => `${escapeHtml(name)} × ${formatNumber(quantity, 2)}`).join(', ');
        const position = force.status === 'embarked' ? 'На борту флота' : force.force_kind === 'land_army' ? `Провинция ${formatNumber(force.province_id)} · клетка ${Number(force.cell_x) + 1}:${Number(force.cell_y) + 1}` : force.marker_id ? `Поселение #${formatNumber(force.marker_id)}` : `Гарнизон провинции ${formatNumber(force.province_id)}`;
        const skills = commanderSkills.map(([key, label]) => `${label} ${Number(force.commander_skills?.[key]) || 0}`).join(' · ');
        const canTrain = force.force_kind === 'land_army' && force.status === 'active' && force.owner === state.userProfile?.owner;
        const canReorganize = !isAdmin && canTrain && !force.in_pending_battle && !force.is_militia && !force.is_mercenary;
        const reorgTargets = state.militaryForces.filter(target => target.id !== force.id && target.force_kind === 'land_army'
            && target.status === 'active' && target.owner === force.owner && !target.in_pending_battle && !target.is_militia && !target.is_mercenary);
        const reorgTargetOptions = reorgTargets.map(target => `<option value="${escapeHtml(target.id)}">${escapeHtml(target.name)} · ${Number(target.cell_x)+1}:${Number(target.cell_y)+1}</option>`).join('');
        const options = commanderSkills.filter(([key]) => (Number(force.commander_skills?.[key]) || 0) < 5).map(([key, label]) => {
            const level = Number(force.commander_skills?.[key]) || 0;
            return `<option value="${key}">${label} ${level}→${level + 1} · ${2 * (level + 1)} опыта</option>`;
        }).join('');
        const experienceCell = `${force.force_kind === 'land_army' ? `<strong>${formatNumber(force.commander_experience || 0)} опыта</strong><small>${skills}</small>${canTrain && options ? `<form class="commander-training" data-force-id="${escapeHtml(force.id)}"><select name="skill" aria-label="Навык Воеводы">${options}</select><button type="submit" class="compact-add-btn">Повысить</button></form>` : ''}` : '—'}`;
        const canMobilize = !isAdmin && force.owner === state.userProfile?.owner && force.force_kind === 'garrison' && force.status === 'active' && (force.unit_groups || []).some(group => Number(group.count) > 0);
        const sourceMarker = force.marker_id ? state.dbMarkers?.find(marker => Number(marker.id) === Number(force.marker_id)) : null;
        const sourceProvinceId = force.province_id || sourceMarker?.province_id;
        const mobilizeAction = canMobilize && sourceProvinceId ? `<form class="military-garrison-mobilize" data-force-id="${escapeHtml(force.id)}" data-province-id="${Number(sourceProvinceId)}"><label>Название армии<input name="name" maxlength="80" value="${escapeHtml(`Армия: ${force.name}`)}" required></label><label>Воевода<input name="commander_name" maxlength="80" required></label><label>Возраст<input name="commander_age" type="number" min="16" max="100" value="35" required></label><button type="submit" class="compact-add-btn">Вывести на карту</button></form>` : '—';
        const canEmbark = !isAdmin && force.owner === playerOwner && force.force_kind === 'land_army' && force.status === 'active' && embarkShipOptions;
        const embarkAction = canEmbark ? `<form class="military-force-embark" data-force-id="${escapeHtml(force.id)}"><label>Судно<select name="fleet_ship" required><option value="">Выбрать судно</option>${embarkShipOptions}</select></label><button type="submit" class="compact-add-btn">Посадить · 1 ОД</button></form>` : force.status === 'embarked' ? 'На борту' : '—';
        const transferableTypes = (force.unit_groups || []).filter(group => Number(group.count) > 0).map(group => `<option value="${escapeHtml(group.type)}" data-available="${Number(group.count)}">${escapeHtml(group.type)} · ${formatNumber(group.count)}</option>`).join('');
        const reorganization = canReorganize ? `<details class="military-force-reorganization"><summary>Разделить / передать войска</summary>${reorgTargets.length ? `<form class="military-troop-transfer" data-force-id="${escapeHtml(force.id)}"><label>Целевая армия<select name="target_force_id" required>${reorgTargetOptions}</select></label><label>Тип войск<select name="unit_type" required>${transferableTypes}</select></label><label>Число бойцов<input name="count" type="number" min="1" max="100000" value="1" required></label><button class="compact-add-btn" type="submit">Передать по маршруту</button></form><div class="military-merge-actions">${reorgTargets.map(target => `<button type="button" class="compact-add-btn" data-merge-force="${escapeHtml(force.id)}" data-target-force="${escapeHtml(target.id)}">Объединить: ${escapeHtml(target.name)}</button>`).join('')}</div>` : '<small>Для передачи или объединения нужна другая доступная армия вашего государства.</small>'}<form class="military-force-split" data-force-id="${escapeHtml(force.id)}"><label>Тип войск<select name="unit_type" required>${transferableTypes}</select></label><label>Число бойцов<input name="count" type="number" min="1" max="100000" value="1" required></label><label>Название новой армии<input name="name" maxlength="80" value="Отряд армии" required></label><label>Имя Воеводы<input name="commander_name" maxlength="80" required></label><label>Возраст<input name="commander_age" type="number" min="16" max="100" value="35" required></label><button class="compact-add-btn" type="submit">Выделить в соседнюю клетку · 10 ОД</button></form></details>` : '';
        const conditionalOrder = conditionalOrders.find(order => order.force_id === force.id);
        const conditionalTargets = state.militaryForces.filter(target => target.id !== force.id && target.force_kind === 'land_army' && target.status === 'active' && (target.owner !== force.owner || (!target.is_militia && !target.is_mercenary)))
            .map(target => `<option value="${escapeHtml(target.id)}">${escapeHtml(target.name)} · ${escapeHtml(target.owner)} · ${Number(target.cell_x)+1}:${Number(target.cell_y)+1}</option>`).join('');
        const conditionalAction = canReorganize ? conditionalOrder
            ? `<small>Приказ по условию: ${conditionalOrder.action === 'retreat' ? 'отход' : conditionalOrder.action === 'move' ? 'перемещение' : conditionalOrder.action === 'join' ? 'соединение' : 'атака'} · клетка ${Number(conditionalOrder.condition_x)+1}:${Number(conditionalOrder.condition_y)+1} · резерв ${formatNumber(conditionalOrder.reserved_ap)} ОД</small><small>${escapeHtml(conditionalOrder.last_result || 'Ожидает проверки')}</small><button type="button" class="compact-add-btn" data-cancel-conditional-order="${escapeHtml(force.id)}">Отменить условный приказ</button>`
            : `<details class="military-force-reorganization"><summary>Приказ по условию</summary><form class="military-conditional-order" data-force-id="${escapeHtml(force.id)}"><label>Клетка противника X<input name="condition_x" type="number" min="0" max="10000" required></label><label>Клетка противника Y<input name="condition_y" type="number" min="0" max="10000" required></label><label>Действие<select name="action"><option value="retreat">Отойти к клетке</option><option value="move">Переместиться к клетке</option><option value="attack">Атаковать рядом стоящую цель</option><option value="join">Соединиться с союзной армией</option></select></label><label>Цель<select name="target_force_id"><option value="">Выберите армию</option>${conditionalTargets}</select></label><label>Назначение X<input name="dest_x" type="number" min="0" max="10000"></label><label>Назначение Y<input name="dest_y" type="number" min="0" max="10000"></label><label>Резерв ОД<input name="reserved_ap" type="number" min="1" max="100" value="20" required></label><button class="compact-add-btn" type="submit">Сохранить</button></form><small>Координаты клеток на карте начинаются с 0. Условие срабатывает, когда противник занимает указанную видимую клетку. Резерв уменьшает доступные ОД.</small></details>` : '';
        const campHireAction = !isAdmin && force.owner === 'Лагерь наёмников' && force.force_kind === 'land_army' && force.status === 'active'
            ? `<button type="button" class="compact-add-btn hire-mercenary-camp" data-force-id="${escapeHtml(force.id)}">Нанять лагерь · 2 z/чел.</button>` : '';
        const militiaTerm = force.is_militia && force.service_end_turn ? `<small class="military-service-term">Ополчение · служба до хода ${formatNumber(force.service_end_turn)}</small>` : '';
        const canExtend = !isAdmin && force.owner === state.userProfile?.owner && force.is_militia && force.status === 'active' && Number(force.service_end_turn) > (Number(state.gameCalendar?.turn) || 0);
        const extensionCost = (force.unit_groups || []).reduce((sum, group) => sum + (Number(group.count) || 0), 0) * 0.25;
        const extendAction = canExtend ? `<button type="button" class="compact-add-btn extend-militia-service" data-force-id="${escapeHtml(force.id)}">Продлить на сезон · ${formatNumber(extensionCost, 2)} z</button>` : '';
        const mercenaryTerm = force.is_mercenary && force.service_end_turn ? `<small class="military-service-term">Контракт наёмников · до хода ${formatNumber(force.service_end_turn)}</small>` : '';
        const forcePeople = (force.unit_groups || []).reduce((sum, group) => sum + (Number(group.count) || 0), 1);
        const canRenewMercenary = !isAdmin && force.owner === playerOwner && force.is_mercenary && force.status === 'active'
            && Number(force.service_end_turn) > (Number(state.gameCalendar?.turn) || 0)
            && Number(force.service_end_turn) <= (Number(state.gameCalendar?.turn) || 0) + 1;
        const renewMercenaryAction = canRenewMercenary ? `<button type="button" class="compact-add-btn renew-mercenary-contract" data-force-id="${escapeHtml(force.id)}">Продлить на сезон · ${formatNumber(forcePeople * 2)} z</button>` : '';
        const supplyCell = force.last_maintenance_turn == null ? 'нет расчёта' : `${formatNumber((Number(force.maintenance_coverage) || 0) * 100, 1)}% снабжения · ${Number(force.underfunded_turns) || 0} сез. дефицита`;
        return `<tr><td>${escapeHtml(force.name)}${militiaTerm}${mercenaryTerm}</td><td>${escapeHtml(force.owner)}</td><td>${position}</td><td>${force.commander_name ? `${escapeHtml(force.commander_name)}, ${formatNumber(force.commander_age)} лет` : '—'}</td><td>${composition}${cargo ? `<small class="military-supply-status">Добыча: ${cargo}</small>` : ''}</td><td>${formatNumber(force.morale)}%<small class="military-supply-status">${escapeHtml(supplyCell)}</small></td><td>${formatNumber(force.action_points)} ОД</td><td>${experienceCell}</td><td>${campHireAction}${mobilizeAction}${extendAction}${renewMercenaryAction}${embarkAction}${reorganization}${conditionalAction}</td></tr>`;
    }).join('');
    const ownedCommanders = militaryCommanders.filter(row => isAdmin || row.owner === playerOwner);
    const availableCommanders = ownedCommanders.filter(row => row.status === 'available');
    const commanderArmyOptions = state.militaryForces.filter(force => force.owner === playerOwner && force.force_kind === 'land_army' && force.status === 'active' && !force.in_pending_battle)
        .map(force => `<option value="${escapeHtml(force.id)}">${escapeHtml(force.name)} · ${Number(force.cell_x)+1}:${Number(force.cell_y)+1}</option>`).join('');
    const commanderLimit = 1 + (state.dbMarkers || []).filter(marker => marker.owner === playerOwner && marker.type !== 'ruins')
        .reduce((sum,marker) => sum + (marker.type === 'large_city' ? 2 : ['fortress','city','monastery'].includes(marker.type) ? 1 : 0),0);
    const commanderRows = ownedCommanders.map(officer => `<tr><td>${escapeHtml(officer.name)} · ${formatNumber(officer.age)} лет</td><td>${formatNumber(officer.experience)} опыта</td><td>${officer.status === 'dead' ? 'Погиб' : officer.status === 'assigned' ? `В армии ${escapeHtml(state.militaryForces.find(force=>force.id===officer.force_id)?.name || '')}` : 'В резерве'}</td><td>${!isAdmin && officer.status === 'available' && commanderArmyOptions ? `<form class="military-commander-assign" data-commander-id="${escapeHtml(officer.id)}"><select name="force_id" required>${commanderArmyOptions}</select><button class="compact-add-btn" type="submit">Назначить</button></form>` : '—'}</td></tr>`).join('');
    const commanderPanel = !spyOnly ? `<section class="page-panel military-commanders-panel"><header class="page-panel-heading"><div><h2>Воеводы</h2><p>Лимит: ${formatNumber(commanderLimit)} · занято ${formatNumber(ownedCommanders.filter(item=>item.status!=='dead').length)}. Найм стоит 10 ОП; свободного воеводу можно назначить своей полевой армии.</p></div></header>${commanderDataError ? `<p class="page-error">Не удалось загрузить реестр воевод: ${escapeHtml(commanderDataError)}. Примените supabase/military_commander_roster.sql.</p>` : ''}${!isAdmin ? `<form id="military-commander-hire" class="military-form-grid military-character-hire"><label>Имя Воеводы<input name="name" maxlength="80" autocomplete="off" required></label><button type="submit" class="admin-btn" ${ownedCommanders.filter(item=>item.status!=='dead').length>=commanderLimit?'disabled':''}>Нанять · 10 ОП</button><small>Возраст определяется случайно: от 30 до 60 лет.</small></form>` : ''}<div class="page-table-wrap"><table class="page-table"><thead><tr><th>Имя и возраст</th><th>Опыт</th><th>Статус</th><th>Назначение</th></tr></thead><tbody>${commanderRows || '<tr><td colspan="4">Воеводы ещё не наняты.</td></tr>'}</tbody></table></div></section>` : '';
    const visibleEpidemicProvinceNames = epidemicEvents.filter(item => Number(item.active_turn) === Number(state.gameCalendar?.turn)).map(item => state.dbProvinces?.[Number(item.province_id)]?.province_name || `Провинция ${item.province_id}`);
    const epidemicWarning = !isAdmin && visibleEpidemicProvinceNames.length ? `<p class="page-warning">Эпидемический очаг в провинции: ${visibleEpidemicProvinceNames.map(escapeHtml).join(', ')}. В этом ходу повышен риск небоевых потерь войск.</p>` : '';
    const forcePanel = `<section class="page-panel military-forces-panel"><header class="page-panel-heading"><div><h2>Армии и гарнизоны</h2><p>Полевые армии отображаются на карте в режиме военной сетки. Выберите армию, чтобы открыть её управление на карте и увидеть доступные клетки хода. Игрок может вывести собственный гарнизон в полевую армию в той же провинции.</p></div></header>${epidemicWarning}${forceDataError ? `<p class="page-error military-db-warning">Не удалось загрузить реестр войск: ${escapeHtml(forceDataError)}. Примените supabase/military_forces.sql.</p>` : ''}<div class="page-table-wrap"><table class="page-table"><thead><tr><th>Название</th><th>Государство</th><th>Положение</th><th>Воевода</th><th>Состав</th><th>Мораль</th><th>ОД</th><th>Опыт и навыки</th><th>Приказы</th></tr></thead><tbody>${forceRows || '<tr><td colspan="9">Армии пока не созданы.</td></tr>'}</tbody></table></div>${isAdmin ? `<form id="create-military-force" class="military-force-create"><h3>Создать полевую армию</h3><div class="military-force-controls"><label>Государство<select name="owner" required>${battleOwnerOptions}</select></label><label>Название<input name="name" maxlength="80" value="Новая армия" required></label><label>Имя Воеводы<input name="commander_name" maxlength="80" required></label><label>Возраст Воеводы<input name="commander_age" type="number" min="16" max="100" value="35" required></label><label>Управление<input name="skill_management" type="number" min="0" max="5" value="0"></label><label>Лидерство<input name="skill_leadership" type="number" min="0" max="5" value="0"></label><label>Тактика<input name="skill_tactics" type="number" min="0" max="5" value="0"></label><label>Планирование<input name="skill_planning" type="number" min="0" max="5" value="0"></label><label>Инженерия<input name="skill_engineering" type="number" min="0" max="5" value="0"></label></div><div class="page-table-wrap"><table class="page-table"><thead><tr><th>Тип войск</th><th>Численность</th></tr></thead><tbody>${unitNames.map(name => `<tr><td>${escapeHtml(name)}</td><td><input type="number" min="0" max="100000" step="1" value="${name === 'Пешие ратники' ? 100 : 0}" data-force-unit="${escapeHtml(name)}"></td></tr>`).join('')}</tbody></table></div><button class="admin-btn" type="submit">Выбрать клетку и создать армию</button></form>` : ''}</section>`;
    const battleArmyCard = (side, index) => `<article class="battle-army-card" data-side="${side}" data-army-index="${index}">
        <header><label>Название армии<input class="battle-army-name" value="${side === 'attacker' ? 'Армия атакующих' : 'Армия защитников'} ${index + 1}" maxlength="60"></label><button class="page-back-btn battle-remove-army" type="button" aria-label="Удалить армию" ${index === 0 ? 'disabled' : ''}>Удалить</button></header>
        ${battleForceOptions ? `<label class="battle-force-source-label">Загрузить постоянную армию<select class="battle-force-source"><option value="">Ввести состав вручную</option>${battleForceOptions}</select></label>` : ''}
        ${isAdmin ? `<div class="battle-army-controls"><label>Государство<select class="battle-army-owner">${battleOwnerOptions}</select></label></div>` : ''}
        <div class="battle-army-controls"><label>Приказ<select class="battle-army-order"><option value="обычный">Обычный</option><option value="решительный">Решительный</option><option value="осторожный">Осторожный</option></select></label><label>Тактика<select class="battle-army-tactic">${battleTactics}</select></label><label>Управление<input class="battle-army-management-level" type="number" min="0" max="5" step="1" value="0"></label><label>Лидерство<input class="battle-army-leadership-level" type="number" min="0" max="5" step="1" value="0"></label><label>Навык тактики<input class="battle-army-tactics-level" type="number" min="0" max="5" step="1" value="0"></label><label>Планирование<input class="battle-army-planning-level" type="number" min="0" max="5" step="1" value="0"></label><label>Мораль, %<input class="battle-army-morale" type="number" min="0" max="100" step="1" value="100"></label></div>
        ${side === 'defender' ? `<div class="battle-army-controls"><label>Решение<select class="battle-army-decision"><option value="fight">Вступить в бой</option><option value="withdraw">Попытаться отойти</option></select></label><label>Маршрут отхода, шаги<input class="battle-withdrawal-steps" type="number" min="1" max="20" value="1"></label><label>Труднопроходимые клетки<input class="battle-withdrawal-difficult" type="number" min="0" max="20" value="0"></label><label class="military-check"><input class="battle-withdrawal-friendly" type="checkbox"> Конец маршрута — дружественное поселение</label></div>` : ''}
        <div class="page-table-wrap"><table class="page-table"><thead><tr><th>Тип войск</th><th>Удар</th><th>Защита</th><th>Численность</th></tr></thead><tbody>${unitNames.map(name => `<tr><td>${escapeHtml(name)}</td><td>${LAND_UNIT_PROFILES[name].strike}</td><td>${LAND_UNIT_PROFILES[name].defense}</td><td><input class="battle-unit-count" data-unit="${escapeHtml(name)}" type="number" min="0" max="100000" step="1" value="${index === 0 && name === 'Пешие ратники' ? 500 : 0}" aria-label="${escapeHtml(name)}"></td></tr>`).join('')}</tbody></table></div>
    </article>`;
    const statusLabels = { pending: 'Ожидает решения и подтверждения', confirmed: 'Завершено', cancelled: 'Отменено' };
    const eventCards = battleHeaders.map(battle => `<article class="military-event-card"><div><strong>${battle.battle_type === 'naval' ? 'Морское сражение' : 'Сухопутное сражение'} · ${escapeHtml(battle.terrain)}</strong><span>${escapeHtml((battle.participant_owners || []).join(' · '))}</span><small>${statusLabels[battle.status] || battle.status}${battle.public_outcome ? ` · исход: ${battle.public_outcome === 'attacker' ? 'атакующие' : battle.public_outcome === 'defender' ? 'защитники' : 'ничья'}` : ''}</small></div><button class="page-back-btn" type="button" data-open-military-battle="${battle.id}">Открыть</button></article>`).join('');
    const eventPanel = `<section class="page-panel military-events-panel"><header class="page-panel-heading"><div><h2>Боевые события</h2><p>Приказы участников скрыты друг от друга. Полный предварительный расчёт виден только администратору.</p></div></header><p class="page-note">Событие хранит снимок состава. После подтверждения Администратором потери и мораль выбранных армий и флотилий записываются в соответствующий реестр.</p>${militaryDataError ? `<p class="page-error military-db-warning">Не удалось загрузить боевые события: ${escapeHtml(militaryDataError)}. Проверьте, что применены файлы боевых событий и синхронизации сил.</p>` : ''}<div id="military-event-list" class="military-event-list">${eventCards || '<p class="page-note">Активных и завершённых боевых событий пока нет.</p>'}</div><div id="military-battle-details" class="military-battle-details" aria-live="polite"></div></section>`;
    const fleetPanel = `<section class="page-panel military-fleets-panel"><header class="page-panel-heading"><div><h2>Флотилии</h2><p>Маршрут прокладывается по рекам, озёрам и морям, доступным всем судам в составе. В зиму внутренние воды закрыты; для использования карты после обновления водоёмов нужна синхронизация сетки.</p></div></header>${fleetDataError ? `<p class="page-error military-db-warning">Не удалось загрузить реестр флотов: ${escapeHtml(fleetDataError)}. Примените supabase/military_fleets.sql.</p>` : ''}<div class="page-table-wrap"><table class="page-table"><thead><tr><th>Название</th><th>Государство</th><th>Корабли и экипажи</th><th>Положение</th><th>Мораль</th><th>ОД</th><th>Приказы</th></tr></thead><tbody>${fleetRows || '<tr><td colspan="7">Сохранённых флотилий пока нет.</td></tr>'}</tbody></table></div></section>`;
    const prisonerPanel = militaryPrisoners.length || prisonerDataError ? `<section class="page-panel military-prisoners-panel"><header class="page-panel-heading"><div><h2>Пленные после морских сражений</h2><p>Захваченные пассажиры учитываются отдельно от корабельных экипажей и не возвращаются в состав исходной армии.</p></div></header>${prisonerDataError ? `<p class="page-error military-db-warning">Не удалось загрузить список пленных: ${escapeHtml(prisonerDataError)}</p>` : ''}<div class="page-table-wrap"><table class="page-table"><thead><tr><th>Отряд</th><th>Исходное государство</th><th>Пленители</th><th>Командир</th><th>Состав</th><th>Статус</th></tr></thead><tbody>${prisonerRows || '<tr><td colspan="6">Записей о пленных нет.</td></tr>'}</tbody></table></div></section>` : '';
    const shipServicePanel = state.userProfile?.role === 'player' ? `<section class="page-panel"><header class="page-panel-heading"><div><h2>Обслуживание кораблей</h2><p>Ремонт: до 4 очков корпуса за сезон, 1 z, 1 Древесина и 0,1 Инструмента за очко. Экипаж: 0,5 z, 0,05 оружия и 0,025 сукна за человека. Переоснащение доступно один раз; судно остаётся в порту до следующего хода.</p></div></header><form id="military-ship-service" class="military-form-grid"><label>Судно<select name="fleet_ship" required><option value="">Выбрать судно в порту</option>${cargoShipOptions}</select></label><label>Действие<select name="action"><option value="repair">Ремонт корпуса</option><option value="recruit">Пополнить экипаж</option><option value="refit">Переоснастить один раз</option></select></label><label>Очки корпуса / моряки<input name="quantity" type="number" min="1" max="100" step="1" value="1"></label><label>Вооружение<select name="weapon"><option value="deck">Палубное метательное оружие</option><option value="light_gun">Лёгкое корабельное орудие</option></select></label><button class="admin-btn" type="submit" ${!cargoShipOptions ? 'disabled' : ''}>Выполнить обслуживание</button></form></section>` : '';
    const content = spyOnly ? spyPanel : `${commanderPanel}${forcePanel}${isAdmin ? siegePanel : ''}${isAdmin ? raidPanel : ''}${isAdmin ? colonizationPanel : ''}${portPanel}${shipServicePanel}${fleetPanel}${prisonerPanel}${eventPanel}${recruitmentPanel}${mercenaryPanel}
        <section class="page-panel military-preview-panel">
            <header class="page-panel-heading"><div><h2>Расчёт состава и передвижения</h2><p>Предварительный расчёт по текущим правилам военной карты.</p></div></header>
            <p class="page-note military-preview-note">Этот блок — отдельный предварительный расчёт. Постоянные армии создаются в реестре выше.</p>
            <div class="page-table-wrap"><table class="page-table"><thead><tr><th>Тип войск</th><th>Мобильность</th><th>Численность</th></tr></thead><tbody>${rows}</tbody></table></div>
            <div class="military-preview-summary"><div><span>Общая нагрузка</span><strong id="military-load">—</strong></div><div><span>Мобильность армии</span><strong id="military-mobility">—</strong></div><div><span>Снабжение за сезон</span><strong id="military-supply">—</strong></div><div><span>ОД на ход</span><strong>100</strong></div><div><span>Вместимость Воеводы</span><strong>1 000</strong></div></div>
            <section class="military-step-costs"><h3>Цена шага по местности</h3><div class="page-table-wrap"><table class="page-table"><thead><tr><th>Местность</th><th>Прямой шаг</th><th>Диагональный шаг</th></tr></thead><tbody>${movementRows}</tbody></table></div><p class="page-note">Стоимость зависит от состава армии. Перегрузка снижает бонусы командования, но сама по себе не запрещает движение. Клетка Воды недоступна сухопутной армии без подходящего моста.</p></section>
        </section>
        <section class="page-panel military-battle-panel">
            <header class="page-panel-heading"><div><h2>Предварительный расчёт сухопутного боя</h2><p>Характеристики ударной силы и защищённости взяты из таблицы правил.</p></div></header>
            <div class="military-battle-controls"><label>Местность<select id="battle-terrain"><option value="plain">Равнина</option><option value="hill">Возвышенность</option><option value="forest">Лес</option><option value="marsh">Болото</option><option value="bridge">Мост</option></select></label><label class="military-check"><input id="battle-ranged" type="checkbox" checked> Сохраняется дистанция для стрелков</label><label class="military-check"><input id="battle-charge" type="checkbox"> Конная атака с разгона</label><label class="military-check"><input id="battle-flank" type="checkbox"> Фланговый обход достиг цели</label><label class="military-check"><input id="battle-surprise" type="checkbox"> Цель не заметила засаду</label><label class="military-check"><input id="battle-snow" type="checkbox"> Установлен снег</label><label class="military-check"><input id="battle-ski-maneuver" type="checkbox"> Лыжники выполняют манёвр</label><label class="military-check"><input id="battle-field-camp" type="checkbox"> У защитников есть полевой лагерь</label><label class="military-check"><input id="battle-attacker-pursuit" type="checkbox"> Атакующие преследуют при победе</label><label class="military-check"><input id="battle-defender-pursuit" type="checkbox"> Защитники преследуют при победе</label></div>
            <details class="military-siege-input"><summary>Параметры штурма укреплённого поселения</summary><div class="military-battle-controls"><label>Уровень укреплений<select id="battle-siege-level"><option value="1">Острог / I</option><option value="2">II</option><option value="3">III</option></select></label><label>Осадные работы<input id="battle-siege-works" type="number" min="0" max="100" value="0"></label><label>Путь штурма<select id="battle-siege-route"><option value="ladders">Лестницы</option><option value="tower">Осадная башня</option><option value="breach">Пролом</option><option value="ram">Ворота с тараном</option></select></label><label class="military-check"><input id="battle-siege-enabled" type="checkbox"> Это штурм укреплённого поселения</label></div><p class="page-note">Множители применяются к каждому этапу боя согласно состоянию укреплений и выбранному пути.</p></details>
            <div class="battle-side-grid"><section><header><h3>Атакующие</h3><button class="page-back-btn" id="battle-add-attacker" type="button">+ Добавить армию</button></header><div id="battle-attacker-armies" class="battle-army-list">${battleArmyCard('attacker', 0)}</div></section><section><header><h3>Защитники</h3><button class="page-back-btn" id="battle-add-defender" type="button">+ Добавить армию</button></header><div id="battle-defender-armies" class="battle-army-list">${battleArmyCard('defender', 0)}</div></section></div>
            <button class="admin-btn" id="calculate-land-battle" type="button">Рассчитать бой</button>${isAdmin ? '<button class="page-back-btn" id="save-land-battle" type="button">Создать событие из расчёта</button>' : ''}<div id="land-battle-result" class="military-battle-result" aria-live="polite"></div>
            <p class="page-note">Каждая армия сохраняет собственные мораль, приказ, тактику и навыки Воеводы. Предпросмотр не меняет реестр; после подтверждения Администратором потери и мораль выбранных постоянных армий сохраняются.</p>
        </section>
        <section class="page-panel military-battle-panel naval-battle-panel">
            <header class="page-panel-heading"><div><h2>Предварительный расчёт морского боя</h2><p>Три боевых цикла; экипаж, манёвренность, корпус, вооружение, абордаж и пожар.</p></div></header>
            <div class="battle-side-grid">${['attacker','defender'].map((side, index) => `<section data-naval-side="${side}"><header><h3>${side === 'attacker' ? 'Атакующие' : 'Защитники'}</h3></header>${isAdmin ? `<label>Государство<select data-naval-owner>${battleOwnerOptions}</select></label>` : ''}<label>Мораль флотилии, %<input data-naval-fleet-morale="${side}" type="number" min="0" max="100" value="100"></label><div class="page-table-wrap"><table class="page-table"><thead><tr><th>Судно</th><th>Экипаж</th><th>Корпус</th><th>Вооружение</th><th>Ушкуйники</th></tr></thead><tbody>${Array.from({ length: 12 }, (_, row) => navalShipRow(side, row)).join('')}</tbody></table></div></section>`).join('')}</div>
            <div class="military-battle-controls"><label class="military-check"><input id="naval-poor-visibility" type="checkbox"> Плохая видимость</label><label class="military-check"><input data-naval-retreat="attacker" type="checkbox"> Атакующие пытаются отойти до боя</label><label class="military-check"><input data-naval-retreat="defender" type="checkbox"> Защитники пытаются отойти до боя</label><label class="military-check"><input data-naval-safe-retreat="attacker" type="checkbox"> У атакующих есть безопасный маршрут</label><label class="military-check"><input data-naval-safe-retreat="defender" type="checkbox"> У защитников есть безопасный маршрут</label><label class="military-check"><input data-naval-adverse="attacker" type="checkbox"> Неблагоприятные условия для атакующих</label><label class="military-check"><input data-naval-adverse="defender" type="checkbox"> Неблагоприятные условия для защитников</label></div>
            <button class="admin-btn" id="calculate-naval-battle" type="button">Рассчитать морской бой</button>${isAdmin ? '<button class="page-back-btn" id="save-naval-battle" type="button">Создать событие из состава</button>' : ''}<div id="naval-battle-result" class="military-battle-result" aria-live="polite"></div>
            <p class="page-note">Это предварительный расчёт, он не меняет постоянный реестр флота. Дальнобойный залп и абордаж рассчитываются одновременно по состоянию судов в начале цикла.</p>
        </section>`;
    const playerMilitaryContent = !isAdmin && !spyOnly
        ? content.slice(0, content.indexOf('<section class="page-panel military-preview-panel">'))
        : content;
    showPageView(spyOnly ? 'Шпионаж и Саботаж' : 'Военное дело', playerMilitaryContent, { navId: spyOnly ? 'nav-spy' : 'nav-military', subtitle: state.userProfile?.owner || '' });
    elements.pageView.querySelector('#military-commander-hire')?.addEventListener('submit', async event => {
        event.preventDefault(); const form=event.currentTarget,button=form.querySelector('button[type="submit"]'); button.disabled=true;
        const age = 30 + Math.floor(Math.random() * 31);
        try { await hireMilitaryCommander(form.elements.name.value.trim(),age); showToast(`Воевода нанят за 10 ОП; возраст: ${age} лет`); await renderMilitaryPlanner(); }
        catch(error) { showToast(`Не удалось нанять Воеводу: ${error.message}`,7000); button.disabled=false; }
    });
    elements.pageView.querySelectorAll('.military-commander-assign').forEach(form => form.addEventListener('submit', async event => {
        event.preventDefault(); const button=form.querySelector('button[type="submit"]'); button.disabled=true;
        try { await assignMilitaryCommander(form.dataset.commanderId,form.elements.force_id.value); showToast('Воевода назначен армии'); await renderMilitaryPlanner(); }
        catch(error) { showToast(`Не удалось назначить Воеводу: ${error.message}`,7000); button.disabled=false; }
    }));
    elements.pageView.querySelector('#military-spy-hire')?.addEventListener('submit', async event => {
        event.preventDefault(); const form=event.currentTarget, button=form.querySelector('button[type="submit"]'); button.disabled=true;
        const age = 30 + Math.floor(Math.random() * 31);
        try { await hireMilitarySpy(form.elements.name.value.trim(),age); showToast(`Шпион нанят за 10 ОП; возраст: ${age} лет`); await renderMilitaryPlanner(); }
        catch(error) { showToast(`Не удалось нанять шпиона: ${error.message}`); button.disabled=false; }
    });
    elements.pageView.querySelectorAll('.military-spy-network').forEach(form => form.addEventListener('submit', async event => {
        event.preventDefault(); const button=form.querySelector('button[type="submit"]'); button.disabled=true;
        try { await assignMilitarySpyNetwork(form.dataset.spyId,form.elements.target_owner.value); showToast('Шпионская сеть создана или перенаправлена'); await renderMilitaryPlanner(); }
        catch(error) { showToast(`Не удалось создать сеть: ${error.message}`); button.disabled=false; }
    }));
    elements.pageView.querySelectorAll('.military-spy-counter').forEach(form => form.addEventListener('submit', async event => {
        event.preventDefault(); const button=form.querySelector('button[type="submit"]'); button.disabled=true;
        try { await setMilitarySpyCounterintelligence(form.dataset.spyId,form.elements.enabled.checked); showToast('Назначение шпиона обновлено'); await renderMilitaryPlanner(); }
        catch(error) { showToast(`Не удалось назначить контршпионаж: ${error.message}`); button.disabled=false; }
    }));
    elements.pageView.querySelectorAll('.military-spy-operation').forEach(form => {
        const operation=form.elements.operation;
        const refreshOperationFields=clearIrrelevant=>{
            const kind=operation.value, needsMarker=['garrison_intel','sabotage'].includes(kind), needsProvince=kind==='province_recon', needsItem=kind==='sabotage';
            form.querySelector('[data-spy-field="marker"]').hidden=!needsMarker;
            form.querySelector('[data-spy-field="province"]').hidden=!needsProvince;
            form.querySelector('[data-spy-field="item"]').hidden=!needsItem;
            if(clearIrrelevant){if(!needsMarker)form.elements.marker_id.value='';if(!needsProvince)form.elements.province_id.value='';if(!needsItem)form.elements.item_name.value='';}
        };
        operation.addEventListener('change',()=>refreshOperationFields(true)); refreshOperationFields(false);
        form.addEventListener('submit', async event => {
        event.preventDefault(); const button=form.querySelector('button[type="submit"]'); button.disabled=true;
        try { const markerId=form.elements.marker_id.value, provinceId=form.elements.province_id.value;
            await queueMilitarySpyOperation(form.dataset.spyId,form.elements.operation.value,markerId||null,provinceId||null,form.elements.item_name.value.trim()||null);
            showToast('Операция поставлена в очередь на сезонное разрешение'); await renderMilitaryPlanner();
        } catch(error) { showToast(`Не удалось отдать приказ шпиону: ${error.message}`); button.disabled=false; }
        });
    });
    elements.pageView.querySelectorAll('[data-dismiss-spy]').forEach(button => button.addEventListener('click', async () => {
        button.disabled=true;
        try { await dismissMilitarySpy(button.dataset.dismissSpy); showToast('Шпион распущен'); await renderMilitaryPlanner(); }
        catch(error) { showToast(`Не удалось распустить шпиона: ${error.message}`); button.disabled=false; }
    }));
    elements.pageView.querySelector('#military-siege-start')?.addEventListener('submit', async event => {
        event.preventDefault();
        const form = event.currentTarget, button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        try {
            const result = await startMilitarySiege(form.elements.force_id.value, Number(form.elements.marker_id.value));
            showToast(`Осада начата. Потрачено ${formatNumber(result.spent_action_points)} ОД.`);
            await renderMilitaryPlanner();
        } catch (error) { showToast(`Не удалось начать осаду: ${error.message}`, 7000); button.disabled = false; }
    });
    elements.pageView.querySelector('#military-raid-start')?.addEventListener('submit', async event => {
        event.preventDefault();
        const form = event.currentTarget, button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        try {
            const result = await startMilitaryRaid(form.elements.force_id.value);
            showToast(`Набег начат. Полный эффект при 500 бойцах; сила операции ${formatNumber(Number(result.strength) * 100, 0)}%. Он завершится при обработке текущего хода.`, 6000);
            await renderMilitaryPlanner();
        } catch (error) { showToast(`Не удалось начать набег: ${error.message}`, 7000); button.disabled = false; }
    });
    elements.pageView.querySelector('#military-colonization-start')?.addEventListener('submit', async event => {
        event.preventDefault();
        const form = event.currentTarget, button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        try {
            const result = await startMilitaryColonization(Number(form.elements.source_marker_id.value), Number(form.elements.target_province_id.value), Number(form.elements.extra_investment.value), form.elements.force_id.value || null);
            showToast(`Колонизация началась. Шанс успеха ${formatNumber(result.success_chance)}%; в следующих трёх ходах потребуется по 500 z.`, 7000);
            await renderMilitaryPlanner();
        } catch (error) { showToast(`Не удалось начать колонизацию: ${error.message}`, 7000); button.disabled = false; }
    });
    elements.pageView.querySelector('#military-sea-colonization-start')?.addEventListener('submit', async event => {
        event.preventDefault();
        const form = event.currentTarget, button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        try {
            const result = await startMilitarySeaColonization(Number(form.elements.source_marker_id.value), Number(form.elements.target_province_id.value), form.elements.fleet_id.value, Number(form.elements.extra_investment.value), form.elements.force_id.value || null);
            showToast(`Морская колонизация началась. Шанс успеха ${formatNumber(result.success_chance)}%; флот закреплён за миссией.`, 7000);
            await renderMilitaryPlanner();
        } catch (error) { showToast(`Не удалось начать морскую колонизацию: ${error.message}`, 7000); button.disabled = false; }
    });
    elements.pageView.querySelector('#military-port-build')?.addEventListener('submit', async event => {
        event.preventDefault();
        const form = event.currentTarget, button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        try {
            const result = await buildMilitaryPort(Number(form.elements.marker_id.value), form.elements.port_type.value, Number(form.elements.source_marker_id.value));
            showToast(`Строительство порта начато. Он будет готов с хода ${result.available_from_turn}; списано ${formatNumber(result.paid_z)} z, ${formatNumber(result.wood)} Древесины и ${formatNumber(result.tools)} Инструментов.`, 7000);
            await renderMilitaryPlanner();
        } catch (error) { showToast(`Не удалось начать строительство порта: ${error.message}`, 7000); button.disabled = false; }
    });
    elements.pageView.querySelector('#military-ship-build')?.addEventListener('submit', async event => {
        event.preventDefault();
        const form = event.currentTarget, button = form.querySelector('button[type="submit"]'); button.disabled = true;
        try {
            const result = await startMilitaryShipBuild({
                portMarkerId:Number(form.elements.port_marker_id.value), sourceMarkerId:Number(form.elements.source_marker_id.value),
                shipType:form.elements.ship_type.value, fleetId:form.elements.fleet_id.value || null,
                fleetName:form.elements.fleet_name.value.trim(), commanderName:form.elements.commander_name.value.trim(),
                commanderAge:form.elements.commander_age.value || 35
            });
            showToast(`Судно «${result.ship_type}» заложено; экипаж ${result.crew} человек. Готовность — с хода ${result.due_turn}. Списано ${formatNumber(result.paid_z)} z.`, 7000);
            await renderMilitaryPlanner();
        } catch (error) { showToast(`Не удалось заложить судно: ${error.message}`, 7000); button.disabled = false; }
    });
    const fleetCargoForm = elements.pageView.querySelector('#military-fleet-cargo');
    fleetCargoForm?.elements.item_type.addEventListener('change', () => {
        fleetCargoForm.elements.item_name.replaceChildren(...(fleetCargoForm.elements.item_type.value === 'good' ? GOODS : RESOURCES).map(item => {
            const option = document.createElement('option'); option.value = item; option.textContent = item; return option;
        }));
    });
    fleetCargoForm?.addEventListener('submit', async event => {
        event.preventDefault();
        const form = event.currentTarget, button = form.querySelector('button[type="submit"]'); button.disabled = true;
        try {
            const [fleetId, shipIndex] = form.elements.fleet_ship.value.split(':');
            await transferMilitaryFleetCargo(fleetId, Number(shipIndex), form.elements.item_type.value, form.elements.item_name.value, Number(form.elements.quantity.value), form.elements.unload.checked);
            showToast(form.elements.unload.checked ? 'Груз выгружен на склад порта' : 'Груз погружен в трюм');
            await renderMilitaryPlanner();
        } catch (error) { showToast(`Не удалось переместить груз: ${error.message}`, 7000); button.disabled = false; }
    });
    elements.pageView.querySelectorAll('.military-force-embark').forEach(form => form.addEventListener('submit', async event => {
        event.preventDefault();
        const button = form.querySelector('button[type="submit"]'); button.disabled = true;
        try {
            const [fleetId, shipIndex] = form.elements.fleet_ship.value.split(':');
            const result = await embarkMilitaryForce(form.dataset.forceId, fleetId, Number(shipIndex));
            showToast(`Армия погружена на судно; занято ${formatNumber(result.cargo_places)} грузовых мест. Потрачено 1 ОД.`);
            state.militaryForces = await fetchMilitaryForces();
            state.militaryFleets = await fetchMilitaryFleets();
            await renderMilitaryPlanner();
        } catch (error) { showToast(`Не удалось посадить армию на судно: ${error.message}`, 7000); button.disabled = false; }
    }));
    elements.pageView.querySelectorAll('[data-disembark-force]').forEach(button => button.addEventListener('click', () => {
        state.pendingMilitaryDisembark = { forceId: button.dataset.disembarkForce, fleetId: button.dataset.fleetId };
        state.militarySelectedFleetId = null; state.militarySelectedForceId = null;
        closePageView(); state.showMilitaryGrid = true;
        elements.militaryGridToggleBtn?.classList.add('active');
        elements.militaryGridToggleBtn?.setAttribute('aria-pressed', 'true');
        renderMilitaryGrid();
        showToast('Выбери соседнюю доступную клетку суши для высадки армии. На высадку расходуется 1 ОД.');
    }));
    elements.pageView.querySelector('#military-ship-service')?.addEventListener('submit', async event => {
        event.preventDefault();
        const form = event.currentTarget, button = form.querySelector('button[type="submit"]'); button.disabled = true;
        try {
            const [fleetId, shipIndex] = form.elements.fleet_ship.value.split(':');
            const result = await serviceMilitaryShip(fleetId, Number(shipIndex), form.elements.action.value, Number(form.elements.quantity.value), form.elements.weapon.value);
            const labels = { repair:'Ремонт завершён', recruit:'Экипаж пополнен', refit:'Судно переоснащено' };
            showToast(`${labels[result.action]}. Списано ${formatNumber(result.paid_z)} z${result.action === 'repair' ? `; восстановлено ${result.quantity} оч.` : result.action === 'recruit' ? `; добавлено ${result.quantity} моряков` : `; вооружение: ${form.elements.weapon.selectedOptions[0].textContent}`}.`, 7000);
            await renderMilitaryPlanner();
        } catch (error) { showToast(`Не удалось обслужить судно: ${error.message}`, 7000); button.disabled = false; }
    });
    elements.pageView.querySelectorAll('.military-fleet-dock').forEach(form => form.addEventListener('submit', async event => {
        event.preventDefault();
        const button = form.querySelector('button[type="submit"]'); button.disabled = true;
        try {
            const result = await dockMilitaryFleet(form.dataset.fleetId, Number(form.elements.port_marker_id.value));
            showToast(`Флотилия вошла в порт. Занято причальных мест: ${result.berths_used}/${result.berths_total}.`);
            await renderMilitaryPlanner();
        } catch (error) { showToast(`Не удалось войти в порт: ${error.message}`, 7000); button.disabled = false; }
    }));
    elements.pageView.querySelector('.military-fleets-panel')?.addEventListener('submit', async event => {
        const form = event.target.closest('.fleet-commander-training');
        if (!form) return;
        event.preventDefault();
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        try {
            const result = await trainMilitaryFleetCommander(form.dataset.fleetId, form.elements.skill.value);
            showToast(`Навык Воеводы флота повышен до ${result.level}-го уровня; потрачено ${result.cost} опыта.`);
            await renderMilitaryPlanner();
        } catch (error) {
            showToast(`Не удалось повысить навык: ${error.message}`, 6000);
            button.disabled = false;
        }
    });
    elements.pageView.querySelectorAll('[data-launch-fleet]').forEach(button => button.addEventListener('click', () => {
        state.pendingMilitaryFleetLaunch = { fleetId: button.dataset.launchFleet };
        state.militarySelectedFleetId = null; state.militaryFleetMoveDraft = null;
        closePageView();
        state.showMilitaryGrid = true;
        elements.militaryGridToggleBtn?.classList.add('active');
        elements.militaryGridToggleBtn?.setAttribute('aria-pressed', 'true');
        renderMilitaryGrid();
        showToast('Выбери на карте соседнюю водную клетку для выхода из порта.');
    }));
    elements.pageView.querySelectorAll('[data-select-fleet]').forEach(button => button.addEventListener('click', () => {
        const fleet = state.militaryFleets.find(item => item.id === button.dataset.selectFleet);
        if (!fleet) return;
        state.militarySelectedFleetId = fleet.id; state.militarySelectedForceId = null;
        state.militaryMoveDraft = null; state.militaryFleetMoveDraft = null;
        closePageView();
        state.showMilitaryGrid = true;
        elements.militaryGridToggleBtn?.classList.add('active');
        elements.militaryGridToggleBtn?.setAttribute('aria-pressed', 'true');
        renderMilitaryGrid(); syncMilitaryMovePanel();
        showToast(`Выбрана флотилия «${fleet.name}». Щёлкни по доступной водной клетке назначения.`);
    }));
    elements.pageView.querySelectorAll('[data-cancel-colonization]').forEach(button => button.addEventListener('click', async () => {
        button.disabled = true;
        try {
            const result = await cancelMilitaryColonization(button.dataset.cancelColonization);
            state.militaryColonizationMap = await fetchMilitaryColonizationMap();
            renderActiveLayer();
            showToast(`Миссия отменена. Возвращено ${formatNumber(result.returned_yards)} дворов; расходы не возмещаются.`);
            await renderMilitaryPlanner();
        } catch (error) { showToast(`Не удалось отменить миссию: ${error.message}`, 7000); button.disabled = false; }
    }));
    elements.pageView.querySelector('#military-fortification-level')?.addEventListener('submit', async event => {
        event.preventDefault();
        const form = event.currentTarget, button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        try {
            await setMarkerFortification(Number(form.elements.marker_id.value), Number(form.elements.level.value));
            const marker = state.dbMarkers.find(item => Number(item.id) === Number(form.elements.marker_id.value));
            if (marker) marker.fortification_level = Number(form.elements.level.value);
            showToast('Уровень укреплений сохранён.');
            await renderMilitaryPlanner();
        } catch (error) { showToast(`Не удалось сохранить укрепления: ${error.message}`, 7000); button.disabled = false; }
    });
    elements.pageView.querySelectorAll('.military-siege-order').forEach(form => form.addEventListener('submit', async event => {
        event.preventDefault();
        const button = form.querySelector('button[type="submit"]');
        const action = form.elements.action.value;
        button.disabled = true;
        try {
            const result = await setMilitarySiegeOrder(form.dataset.siegeId, action, {
                forceId: form.elements.force_id?.value || null,
                workMethod: form.elements.method?.value || 'bombardment',
                assaultRoute: form.elements.route?.value || 'ladders'
            });
            showToast(`Приказ принят. ${result.spent_action_points ? `Потрачено ${formatNumber(result.spent_action_points)} ОД.` : 'Ожидает разрешения в конце сезона.'}`);
            await renderMilitaryPlanner();
        } catch (error) { showToast(`Не удалось подать приказ: ${error.message}`, 7000); button.disabled = false; }
    }));
    if (isAdmin) {
        const currentTurn = Number(state.gameCalendar?.turn) || 0;
        const affectedIds = new Set(epidemicEvents.filter(item => Number(item.active_turn) === currentTurn).map(item => Number(item.province_id)));
        const epidemicProvinceOptions = Object.entries(state.dbProvinces || {}).map(([id, province]) => `<option value="${Number(id)}">${escapeHtml(province.province_name || province.region || `Провинция ${id}`)}${affectedIds.has(Number(id)) ? ' · очаг активен' : ''}</option>`).join('');
        const activeEventLabels = [...affectedIds].map(id => escapeHtml(state.dbProvinces?.[id]?.province_name || `Провинция ${id}`)).join(', ');
        elements.pageView.querySelector('.military-forces-panel header')?.insertAdjacentHTML('afterend', `<div class="military-grid-sync military-epidemic-admin"><form id="military-epidemic-event"><label>Очаг эпидемии на текущий ход<select name="province_id" required>${epidemicProvinceOptions}</select></label><button class="admin-btn" type="submit" value="true" data-epidemic-enabled="true">Отметить очаг</button><button class="page-back-btn" type="submit" value="false" data-epidemic-enabled="false">Снять очаг</button></form><small>${activeEventLabels ? `Активные провинции: ${activeEventLabels}` : 'Активных очагов нет.'} Эпидемия задаёт потери 1% в поселении или полевом лагере и 2% в поле на протяжении этого хода.</small></div>`);
    }
    elements.pageView.querySelector('#military-epidemic-event')?.addEventListener('submit', async event => {
        event.preventDefault();
        const form = event.currentTarget;
        const submitter = event.submitter;
        const provinceId = form.elements.province_id.value;
        const enabled = submitter?.dataset.epidemicEnabled === 'true';
        form.querySelectorAll('button').forEach(button => { button.disabled = true; });
        try {
            await setMilitaryEpidemicEvent(provinceId, enabled);
            showToast(enabled ? 'Очаг отмечен до конца текущего сезонного хода.' : 'Очаг снят для текущего сезонного хода.');
            await renderMilitaryPlanner();
        } catch (error) { showToast(`Не удалось обновить очаг эпидемии: ${error.message}`, 7000); form.querySelectorAll('button').forEach(button => { button.disabled = false; }); }
    });
    if (isAdmin) {
        for (const side of ['attacker','defender']) {
            const fleetSection = elements.pageView.querySelector(`[data-naval-side="${side}"]`);
            fleetSection?.querySelector('header')?.insertAdjacentHTML('afterend', `<div class="military-battle-controls"><label>Загрузить постоянный флот<select data-naval-fleet-source><option value="">Новый состав</option>${fleetSourceOptions(side)}</select></label><label>Название флотилии<input data-naval-fleet-name maxlength="80" value="${side === 'attacker' ? 'Флот атакующих' : 'Флот защитников'}"></label><label class="military-check"><input type="checkbox" data-naval-pursue> Преследовать отходящий флот при победе</label></div>`);
        }
        elements.pageView.querySelector('#calculate-naval-battle')?.insertAdjacentHTML('afterend', '<button class="page-back-btn" id="save-naval-fleets" type="button">Сохранить флотилии</button>');
    }
    elements.pageView.querySelector('.military-forces-panel')?.addEventListener('click', async event => {
        const cancelConditional = event.target.closest('[data-cancel-conditional-order]');
        if (cancelConditional) {
            cancelConditional.disabled = true;
            try {
                await cancelMilitaryConditionalOrder(cancelConditional.dataset.cancelConditionalOrder);
                state.militaryForces = await fetchMilitaryForces();
                showToast('Условный приказ отменён; резерв ОД освобождён.');
                await renderMilitaryPlanner();
            } catch (error) { showToast(`Не удалось отменить условный приказ: ${error.message}`, 7000); cancelConditional.disabled = false; }
            return;
        }
        const mergeButton = event.target.closest('[data-merge-force]');
        if (mergeButton) {
            mergeButton.disabled = true;
            try {
                const source = state.militaryForces.find(force => force.id === mergeButton.dataset.mergeForce);
                const target = state.militaryForces.find(force => force.id === mergeButton.dataset.targetForce);
                const draft = source && target && planMilitaryTransferPath(source, source.unit_groups || [], target);
                if (!draft?.reachable) throw new Error('Нет доступного пути или не хватает ОД для объединения.');
                const result = await transferMilitaryTroops(source.id, target.id, source.unit_groups || [], draft.path, true);
                state.militaryForces = await fetchMilitaryForces();
                showToast(`Армии объединены; маршрут ${draft.path.length - 1} кл., потрачено ${result.spent_action_points} ОД.`);
                await renderMilitaryPlanner();
            } catch (error) { showToast(`Не удалось объединить армии: ${error.message}`, 7000); mergeButton.disabled = false; }
            return;
        }
        const button = event.target.closest('.extend-militia-service');
        if (!button) return;
        button.disabled = true;
        try {
            const result = await extendMilitaryMilitiaService(button.dataset.forceId);
            const index = state.militaryForces.findIndex(force => force.id === button.dataset.forceId);
            if (index >= 0 && result?.force) state.militaryForces[index] = result.force;
            showToast(`Служба продлена до хода ${result.new_end_turn}; списано ${formatNumber(result.cost, 2)} z.`);
            await renderMilitaryPlanner();
        } catch (error) {
            showToast(`Не удалось продлить службу: ${error.message}`, 7000);
            button.disabled = false;
        }
    });
    elements.pageView.querySelector('.military-forces-panel')?.addEventListener('submit', async event => {
        const conditionalForm = event.target.closest('.military-conditional-order');
        if (conditionalForm) {
            event.preventDefault();
            const button = conditionalForm.querySelector('button[type="submit"]'); button.disabled = true;
            try {
                const force = state.militaryForces.find(item => item.id === conditionalForm.dataset.forceId);
                if (!force) throw new Error('Армия не найдена.');
                const action = conditionalForm.elements.action.value;
                const conditionX = Number(conditionalForm.elements.condition_x.value), conditionY = Number(conditionalForm.elements.condition_y.value);
                if (!Number.isInteger(conditionX) || !Number.isInteger(conditionY)) throw new Error('Координаты условия должны быть целыми числами.');
                const targetId = conditionalForm.elements.target_force_id.value || null;
                let route = [], minReserve = 1;
                if (action === 'retreat' || action === 'move') {
                    if (conditionalForm.elements.dest_x.value === '' || conditionalForm.elements.dest_y.value === '') throw new Error('Укажите координаты клетки назначения.');
                    const draft = planMilitaryMove(force, Number(conditionalForm.elements.dest_x.value), Number(conditionalForm.elements.dest_y.value));
                    if (!draft) throw new Error('Клетка назначения недоступна или маршрут не найден.');
                    route = draft.path; minReserve = draft.cost;
                } else if (action === 'join') {
                    const target = state.militaryForces.find(item => item.id === targetId);
                    const draft = target && planMilitaryTransferPath(force, force.unit_groups || [], target);
                    if (!draft?.reachable) throw new Error('Нет доступного маршрута к союзной армии.');
                    route = draft.path; minReserve = Math.max(draft.cost, Math.ceil(draft.cost / 2) + 5);
                } else {
                    if (!targetId) throw new Error('Выберите армию для атаки.');
                    minReserve = 10;
                }
                const reserve = Math.floor(Number(conditionalForm.elements.reserved_ap.value) || 0);
                if (reserve < minReserve) throw new Error(`Для этого приказа нужно зарезервировать не менее ${minReserve} ОД.`);
                if (!state.militaryGridCells.has(`${conditionX},${conditionY}`)) throw new Error('Указанной клетки нет на военной карте.');
                await setMilitaryConditionalOrder(force.id, conditionX, conditionY, action, route, targetId, reserve);
                state.militaryForces = await fetchMilitaryForces();
                showToast(`Условный приказ сохранён; зарезервировано ${reserve} ОД.`);
                await renderMilitaryPlanner();
            } catch (error) { showToast(`Не удалось сохранить условный приказ: ${error.message}`, 7000); button.disabled = false; }
            return;
        }
        const transferForm = event.target.closest('.military-troop-transfer');
        if (transferForm) {
            event.preventDefault();
            const button = transferForm.querySelector('button[type="submit"]'); button.disabled = true;
            try {
                const source = state.militaryForces.find(force => force.id === transferForm.dataset.forceId);
                const target = state.militaryForces.find(force => force.id === transferForm.elements.target_force_id.value);
                const units = [{ type: transferForm.elements.unit_type.value, count: Math.max(1, Math.floor(Number(transferForm.elements.count.value) || 0)) }];
                const draft = source && target && planMilitaryTransferPath(source, units, target);
                if (!draft?.reachable) throw new Error('Нет доступного пути или не хватает ОД для передачи.');
                const result = await transferMilitaryTroops(source.id, target.id, units, draft.path, false);
                state.militaryForces = await fetchMilitaryForces();
                showToast(`Войска переданы; маршрут ${draft.path.length - 1} кл., потрачено ${result.spent_action_points} ОД.`);
                await renderMilitaryPlanner();
            } catch (error) { showToast(`Не удалось передать войска: ${error.message}`, 7000); button.disabled = false; }
            return;
        }
        const splitForm = event.target.closest('.military-force-split');
        if (splitForm) {
            event.preventDefault();
            const button = splitForm.querySelector('button[type="submit"]'); button.disabled = true;
            try {
                const source = state.militaryForces.find(force => force.id === splitForm.dataset.forceId);
                const type = splitForm.elements.unit_type.value;
                const count = Math.max(1, Math.floor(Number(splitForm.elements.count.value) || 0));
                const group = source?.unit_groups?.find(item => item.type === type);
                if (!group || count > Number(group.count)) throw new Error('В армии недостаточно бойцов этого типа.');
                const options = [];
                for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                    if (!dx && !dy) continue;
                    const x = Number(source.cell_x) + dx, y = Number(source.cell_y) + dy;
                    const cell = state.militaryGridCells.get(`${x},${y}`), terrain = state.militaryTerrainCells.get(`${x},${y}`)?.terrain || cell?.base_terrain;
                    if (cell?.province_id && terrain !== 'water' && !state.militaryForces.some(other => other.force_kind === 'land_army' && other.status === 'active' && Number(other.cell_x) === x && Number(other.cell_y) === y)) options.push({x,y});
                }
                if (!options.length) throw new Error('Рядом нет свободной сухопутной клетки для новой армии.');
                const destination = options[0];
                await splitMilitaryForce(source.id, [{type,count}], splitForm.elements.name.value.trim(), splitForm.elements.commander_name.value.trim(), Number(splitForm.elements.commander_age.value), destination.x, destination.y);
                state.militaryForces = await fetchMilitaryForces();
                showToast(`Армия разделена и размещена в клетке ${destination.x + 1}:${destination.y + 1}. Новый отряд получит ОД в следующем ходу.`);
                await renderMilitaryPlanner();
            } catch (error) { showToast(`Не удалось разделить армию: ${error.message}`, 7000); button.disabled = false; }
            return;
        }
        const mobilizeForm = event.target.closest('.military-garrison-mobilize');
        if (mobilizeForm) {
            event.preventDefault();
            const name = mobilizeForm.elements.name.value.trim();
            const commanderName = mobilizeForm.elements.commander_name.value.trim();
            const commanderAge = Number(mobilizeForm.elements.commander_age.value);
            if (!name || !commanderName || commanderAge < 16 || commanderAge > 100) {
                showToast('Проверь название армии, имя и возраст Воеводы.');
                return;
            }
            state.pendingMilitaryMobilization = {
                forceId: mobilizeForm.dataset.forceId,
                forceName: name,
                commanderName,
                commanderAge,
                sourceProvinceId: Number(mobilizeForm.dataset.provinceId),
                owner: state.userProfile?.owner
            };
            state.showMilitaryGrid = true;
            elements.militaryGridToggleBtn?.classList.add('active');
            elements.militaryGridToggleBtn?.setAttribute('aria-pressed', 'true');
            if (elements.militaryGridToggleBtn) elements.militaryGridToggleBtn.textContent = 'Военная сетка: показана';
            elements.cancelMilitaryPlacementBtn.style.display = 'inline-flex';
            document.body.classList.add('military-army-placement');
            closePageView();
            renderMilitaryGrid();
            showToast('Выбери клетку в провинции, где расположен этот гарнизон.');
            return;
        }
        const form = event.target.closest('.commander-training');
        if (!form) return;
        event.preventDefault();
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        try {
            const result = await trainMilitaryCommander(form.dataset.forceId, form.elements.skill.value);
            showToast(`Навык Воеводы повышен до ${result.level}-го уровня; потрачено ${result.cost} опыта.`);
            await renderMilitaryPlanner();
        } catch (error) {
            showToast(`Не удалось повысить навык: ${error.message}`, 6000);
            button.disabled = false;
        }
    });
    elements.pageView.querySelector('#create-military-force')?.addEventListener('submit', event => {
        event.preventDefault();
        const form = event.currentTarget;
        const unitGroups = [...form.querySelectorAll('[data-force-unit]')].map(input => ({ type: input.dataset.forceUnit, count: Math.max(0, Math.floor(Number(input.value) || 0)) })).filter(group => group.count > 0);
        if (!unitGroups.length) { showToast('Укажи численность хотя бы одного типа войск.'); return; }
        state.pendingMilitaryPlacement = {
            owner: form.elements.owner.value,
            name: form.elements.name.value.trim(),
            force_kind: 'land_army',
            commander_name: form.elements.commander_name.value.trim(),
            commander_age: Number(form.elements.commander_age.value),
            commander_skills: {
                management: Math.max(0, Math.min(5, Number(form.elements.skill_management.value) || 0)),
                leadership: Math.max(0, Math.min(5, Number(form.elements.skill_leadership?.value) || 0)),
                tactics: Math.max(0, Math.min(5, Number(form.elements.skill_tactics.value) || 0)),
                planning: Math.max(0, Math.min(5, Number(form.elements.skill_planning.value) || 0)),
                engineering: Math.max(0, Math.min(5, Number(form.elements.skill_engineering?.value) || 0))
            },
            unit_groups: unitGroups,
            siege_equipment: {},
            morale: 100,
            action_points: 100,
            status: 'active'
        };
        if (!state.pendingMilitaryPlacement.owner || !state.pendingMilitaryPlacement.name || !state.pendingMilitaryPlacement.commander_name || state.pendingMilitaryPlacement.commander_age < 16 || state.pendingMilitaryPlacement.commander_age > 100) {
            state.pendingMilitaryPlacement = null;
            showToast('Проверь государство, название армии и данные Воеводы.');
            return;
        }
        state.showMilitaryGrid = true;
        elements.militaryGridToggleBtn?.classList.add('active');
        elements.militaryGridToggleBtn?.setAttribute('aria-pressed', 'true');
        if (elements.militaryGridToggleBtn) elements.militaryGridToggleBtn.textContent = 'Военная сетка: показана';
        elements.cancelMilitaryPlacementBtn.style.display = 'inline-flex';
        document.body.classList.add('military-army-placement');
        closePageView();
        renderMilitaryGrid();
        showToast('Щёлкни по клетке внутри провинции выбранного государства.');
    });
    const battleDetailsHost = elements.pageView.querySelector('#military-battle-details');
    const renderStoredBattle = async battleId => {
        battleDetailsHost.innerHTML = '<p class="page-loading">Загружаю данные сражения…</p>';
        try {
            const details = await fetchMilitaryBattleDetails(battleId);
            const battle = details.battle;
            if (!battle) throw new Error('Боевой эпизод не найден или недоступен этому профилю.');
            battleDetailsHost.dataset.battleType = battle.battle_type;
            const owner = state.userProfile?.owner;
            const isNaval = battle.battle_type === 'naval';
            const battleRegion = battle.location?.region || state.dbProvinces?.[Number(battle.location?.province_id)]?.region || 'Общая зона';
            const weather = battle.location?.weather || state.regionalWeather?.find(row => row.region === battleRegion)
                || state.regionalWeather?.find(row => row.region === 'Общая зона');
            const weatherLabels = { clear: 'ясно', rain: 'дождь', mud: 'распутица', snow: 'снег', frost: 'мороз', heat: 'жара', calm: 'штиль', rough: 'волнение', storm: 'шторм' };
            const weatherSummary = weather ? `${battleRegion}: суша — ${weatherLabels[weather.land_condition] || weather.land_condition}, море — ${weatherLabels[weather.sea_condition] || weather.sea_condition}` : 'Погода не задана';
            const armyCards = details.armies.map(army => {
                const mine = isAdmin || army.owner === owner;
                const savedRoute = army.withdrawal_route || {};
                const troops = isNaval
                    ? (army.unit_data?.ships || []).map(ship => `${escapeHtml(ship.type)} · ${formatNumber(ship.crew)} чел. экипажа · корпус ${formatNumber(ship.hull)}`).join(' · ') || 'Нет данных о флоте'
                    : Array.isArray(army.unit_data?.units) ? army.unit_data.units.map(unit => `${escapeHtml(unit.type)}: ${formatNumber(unit.count)}`).join(' · ') : 'Нет данных о составе';
                const tacticOptions = isNaval
                    ? [['none', 'Обычный бой'], ['naval_pursuit', 'Преследовать отходящий флот']]
                    : Object.entries(LAND_TACTICS).filter(([value]) => value !== 'feigned_retreat');
                return `<article class="military-event-army"><header><strong>${escapeHtml(army.name)}</strong><span>${escapeHtml(army.owner)} · ${army.side === 'attacker' ? 'атакующие' : 'защитники'}</span></header><p>${troops}</p><small>Мораль ${formatNumber(army.morale)}% · ${escapeHtml(army.order_name)} · ${escapeHtml(army.tactic)}</small>${mine && battle.status === 'pending' ? `<div class="battle-event-decision" data-army-id="${army.id}"><label>Моё решение<select class="event-decision"><option value="pending" ${army.decision === 'pending' ? 'selected' : ''}>Ожидает решения</option><option value="fight" ${army.decision === 'fight' ? 'selected' : ''}>Вступить в бой</option><option value="withdraw" ${army.decision === 'withdraw' ? 'selected' : ''}>Попытаться отойти</option></select></label><label>Приказ<select class="event-order"><option value="обычный" ${army.order_name === 'обычный' ? 'selected' : ''}>Обычный</option><option value="решительный" ${army.order_name === 'решительный' ? 'selected' : ''}>Решительный</option><option value="осторожный" ${army.order_name === 'осторожный' ? 'selected' : ''}>Осторожный</option></select></label><label>Тактика<select class="event-tactic">${tacticOptions.map(([value,label]) => `<option value="${escapeHtml(value)}" ${army.tactic === value ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select></label><label>Длина маршрута, шаги<input class="event-route-steps" type="number" min="1" max="20" value="${Number(savedRoute.steps) || 1}"></label><label>Труднопроходимые клетки<input class="event-route-difficult" type="number" min="0" max="20" value="${Number(savedRoute.difficultCells) || 0}"></label><label class="military-check"><input class="event-route-friendly" type="checkbox" ${savedRoute.friendlyDestination ? 'checked' : ''}> ${isNaval ? 'Есть безопасный маршрут отхода' : 'Дружественное поселение в конце'}</label><button class="page-back-btn" type="button" data-save-army-decision="${army.id}">Сохранить решение</button></div>` : `<p>Решение: ${army.decision === 'pending' ? 'ожидает' : army.decision === 'fight' ? 'вступить в бой' : 'отход'}${army.withdrawal_route ? ` · маршрут ${Number(army.withdrawal_route.steps) || 0} шаг.` : ''}</p>`}</article>`;
            }).join('');
            let completedReport = '';
            if (battle.status === 'confirmed') {
                const report = isAdmin ? details.adminReport : details.reports.find(row => row.owner === owner)?.report;
                completedReport = report ? `<pre class="military-event-report">${escapeHtml(JSON.stringify(report, null, 2))}</pre>` : '<p class="page-note">Отчёт для этого профиля не найден.</p>';
            }
            battleDetailsHost.innerHTML = `<div class="military-event-detail-heading"><h3>Сражение · ${escapeHtml(battle.terrain)} · версия ${battle.version}</h3><button type="button" class="page-back-btn" data-close-battle>Закрыть</button></div><p class="page-note">Погода · ${escapeHtml(weatherSummary)}. Она не меняет обзор.</p>${completedReport || `<div class="military-event-armies">${armyCards || '<p>Нет доступных армий.</p>'}</div>`}${isAdmin && battle.status === 'pending' ? `<div class="military-event-admin-actions"><button type="button" class="admin-btn" data-preview-stored-battle="${battle.id}">Рассчитать и подтвердить</button><div class="stored-battle-preview" aria-live="polite"></div></div>` : ''}`;
        } catch (error) { battleDetailsHost.innerHTML = `<p class="page-error">Не удалось открыть событие: ${escapeHtml(error.message)}</p>`; }
    };
    battleDetailsHost?.addEventListener('click', async event => {
        const close = event.target.closest('[data-close-battle]');
        if (close) { battleDetailsHost.innerHTML = ''; return; }
        const saveButton = event.target.closest('[data-save-army-decision]');
        if (saveButton) {
            const card = saveButton.closest('.battle-event-decision');
            const decision = card.querySelector('.event-decision').value;
            const withdrawalRoute = decision === 'withdraw' ? { steps: Number(card.querySelector('.event-route-steps').value) || 0, difficultCells: Number(card.querySelector('.event-route-difficult').value) || 0, friendlyDestination: card.querySelector('.event-route-friendly').checked, safeRetreat: card.querySelector('.event-route-friendly').checked, legal: true } : null;
            saveButton.disabled = true;
            try {
                await saveMilitaryBattleDecision(saveButton.dataset.saveArmyDecision, { decision, order_name: card.querySelector('.event-order').value, tactic: card.querySelector('.event-tactic').value, withdrawal_route: withdrawalRoute });
                showToast('Решение сохранено');
                await renderStoredBattle(battleDetailsHost.dataset.battleId);
            } catch (error) { showToast(`Не удалось сохранить решение: ${error.message}`, 6000); saveButton.disabled = false; }
            return;
        }
        const previewButton = event.target.closest('[data-preview-stored-battle]');
        if (previewButton) {
            const battleId = previewButton.dataset.previewStoredBattle;
            const previewHost = battleDetailsHost.querySelector('.stored-battle-preview');
            previewButton.disabled = true;
            try {
                const details = await fetchMilitaryBattleDetails(battleId);
                const battle = details.battle;
                if (!battle || battle.status !== 'pending') throw new Error('Событие уже закрыто или недоступно. Обновите список боёв.');
                if (details.armies.some(army => army.decision === 'pending')) throw new Error('Назначьте решение для каждого отряда; при отсутствии ответа решение может выбрать администратор.');
                const battleRegion = battle.location?.region || state.dbProvinces?.[Number(battle.location?.province_id)]?.region || 'Общая зона';
                const weather = battle.location?.weather || state.regionalWeather?.find(row => row.region === battleRegion)
                    || state.regionalWeather?.find(row => row.region === 'Общая зона') || null;
                const modifierSnapshot = state.economySnapshot || await fetchEconomySnapshot();
                state.economySnapshot = modifierSnapshot;
                const modifierTurn = Number(modifierSnapshot.calendar?.turn) || 1;
                const makeArmy = army => ({ id: army.id, modifierScopeId: army.persistent_force_id || army.unit_data?.persistent_force_id || army.id, modifiers: getOwnerModifiers(army.owner, modifierSnapshot, modifierTurn), name: army.name, owner: army.owner, morale: army.morale, order: army.order_name, tactic: army.tactic, skills: army.unit_data?.skills || {}, conditions: army.unit_data?.conditions || {}, units: army.unit_data?.units || [], decision: army.decision, withdrawalRoute: army.withdrawal_route });
                const attackers = details.armies.filter(army => army.side === 'attacker').map(makeArmy);
                const defenders = details.armies.filter(army => army.side === 'defender').map(makeArmy);
                const navalSide = side => {
                    const sideArmies = details.armies.filter(army => army.side === side);
                    const lead = sideArmies[0];
                    return { morale: sideArmies[0]?.morale ?? 100, commanderSkills: lead?.unit_data?.commander_skills || {}, ships: sideArmies.flatMap(army => army.unit_data?.ships || []), modifiers: getOwnerModifiers(lead?.owner, modifierSnapshot, modifierTurn), modifierScopeId: lead?.persistent_fleet_id || lead?.unit_data?.persistent_fleet_id || lead?.id };
                };
                const calculation = battle.battle_type === 'naval'
                    ? simulateNavalBattle({ battleId, randomSeed: battle.random_seed, attacker: navalSide('attacker'), defender: navalSide('defender'), weather, poorVisibility: !!battle.location?.poorVisibility, requestWithdrawal: Object.fromEntries(['attacker','defender'].map(side => [side, details.armies.filter(army => army.side === side).some(army => army.decision === 'withdraw')])), pursue: Object.fromEntries(['attacker','defender'].map(side => [side, details.armies.filter(army => army.side === side).some(army => army.tactic === 'naval_pursuit')])), safeRetreat: Object.fromEntries(['attacker','defender'].map(side => [side, details.armies.filter(army => army.side === side).some(army => army.withdrawal_route?.safeRetreat)])), adverseConditions: battle.location?.adverseConditions || {} })
                    : simulateLandBattle({ battleId, randomSeed: battle.random_seed, attackerArmies: attackers, defenderArmies: defenders, terrain: battle.terrain, weather, siege: battle.location?.siege || null });
                const label = calculation.noBattle ? 'Защитники отошли, боя не было' : calculation.outcome === 'attacker' ? 'Победа атакующих' : calculation.outcome === 'defender' ? 'Победа защитников' : 'Ничья';
                const withdrawalSummary = calculation.withdrawals.map(item => {
                    const name = battle.battle_type === 'naval' ? (item.side === 'attacker' ? 'Атакующие' : 'Защитники') : details.armies.find(army => army.id === item.armyId)?.name || item.armyId;
                    return `<li>${escapeHtml(name)}: ${item.unavailable ? 'отход невозможен' : item.success ? 'отход успешен' : 'отход не удался'} (${formatNumber(item.chance, 1)}%, бросок ${formatNumber(item.roll * 100, 1)})</li>`;
                }).join('');
                const pursuitSummary = calculation.pursuit
                    ? `<p>Преследование: ${calculation.pursuit.success ? calculation.pursuit.captured ? `захвачено судно ${escapeHtml(calculation.pursuit.targetShipId)}` : `судно ${escapeHtml(calculation.pursuit.targetShipId)} получило урон корпуса ${calculation.pursuit.hullDamage} и потеряло ${formatNumber(calculation.pursuit.crewLoss)} чел. экипажа` : escapeHtml(calculation.pursuit.reason || 'перехват не удался')} · шанс ${formatNumber(calculation.pursuit.chance, 1)}%, бросок ${formatNumber(calculation.pursuit.roll * 100, 1)}.</p>`
                    : '';
                const casualties = battle.battle_type === 'naval' ? [] : ['attacker','defender'].flatMap(side => calculation.phases.flatMap(phase => phase.casualties[side].map(row => ({ ...row, side, phase: phase.phase }))));
                const lossesSummary = casualties.map(row => `<li>${escapeHtml(details.armies.find(army => army.id === row.armyId)?.name || row.armyId)}: −${formatNumber(row.losses)} чел. · Мораль ${formatNumber(row.morale)}%</li>`).join('');
                const ownerReports = [...new Set(details.armies.map(army => army.owner))].map(reportOwner => ({ owner: reportOwner, report: battle.battle_type === 'naval'
                    ? { outcome: calculation.outcome, pursuit: calculation.pursuit && details.armies.some(army => army.owner === reportOwner && [calculation.pursuit.pursuerSide, calculation.pursuit.retreatingSide].includes(army.side)) ? calculation.pursuit : null, fleets: details.armies.filter(army => army.owner === reportOwner).map(army => ({ id: army.id, name: army.name, side: army.side, decision: army.decision, result: calculation.fleets[army.side] })) }
                    : { outcome: calculation.outcome, noBattle: calculation.noBattle, armies: details.armies.filter(army => army.owner === reportOwner).map(army => ({ id: army.id, name: army.name, side: army.side, decision: army.decision, withdrawal: calculation.withdrawals.find(item => item.armyId === army.id) ? { success: calculation.withdrawals.find(item => item.armyId === army.id).success } : null, result: calculation.armies[army.side].find(item => item.id === army.id) })) } }));
                previewHost.innerHTML = battle.battle_type === 'naval'
                    ? `<section class="military-event-calculation"><h4>${label}</h4><p>Боевых циклов: ${calculation.cycles.length}. Итоговый состав флотов и отчёты будут сохранены при подтверждении.</p>${withdrawalSummary ? `<h5>Проверки отхода</h5><ul>${withdrawalSummary}</ul>` : ''}${pursuitSummary}<pre class="military-event-report">${escapeHtml(JSON.stringify(calculation, null, 2))}</pre><button class="admin-btn" type="button" data-confirm-stored-battle="${battleId}" data-preview-version="${battle.version}">Подтвердить эту версию</button></section>`
                    : `<section class="military-event-calculation"><h4>${label}</h4>${withdrawalSummary ? `<h5>Проверки отхода</h5><ul>${withdrawalSummary}</ul>` : ''}${lossesSummary ? `<h5>Потери по армиям и циклам</h5><ul>${lossesSummary}</ul>` : '<p>Активных фаз боя не было.</p>'}<button class="admin-btn" type="button" data-confirm-stored-battle="${battleId}" data-preview-version="${battle.version}">Подтвердить эту версию</button></section>`;
                previewButton._militaryPayload = { calculation, ownerReports, version: battle.version };
                previewButton.dataset.previewReady = 'true';
                previewButton.dataset.outcome = calculation.outcome;
                previewButton.dataset.adminReport = JSON.stringify(calculation);
                previewHost._militaryPayload = previewButton._militaryPayload;
            } catch (error) { previewHost.innerHTML = `<p class="page-error">Не удалось рассчитать бой: ${escapeHtml(error.message)}</p>`; }
            finally { previewButton.disabled = false; }
            return;
        }
        const confirmButton = event.target.closest('[data-confirm-stored-battle]');
        if (confirmButton) {
            const previewHost = battleDetailsHost.querySelector('.stored-battle-preview');
            const payload = previewHost._militaryPayload;
            if (!payload) { showToast('Сначала пересчитайте бой', 5000); return; }
            confirmButton.disabled = true;
            try {
                await confirmMilitaryBattle(confirmButton.dataset.confirmStoredBattle, payload.version, payload.calculation.outcome, payload.calculation, payload.ownerReports);
                try { state.militaryForces = await fetchMilitaryForces(); } catch { /* The confirmed battle remains valid; the force list refreshes on next open. */ }
                if (battleDetailsHost.dataset.battleType === 'naval') {
                    try {
                        militaryFleets = await fetchMilitaryFleets();
                        const body = elements.pageView.querySelector('.military-fleets-panel tbody');
                        if (body) body.innerHTML = militaryFleets.map(fleet => `<tr><td>${escapeHtml(fleet.name)}</td><td>${escapeHtml(fleet.owner)}</td><td>${(fleet.ships || []).map(ship => `${escapeHtml(ship.type)} (${formatNumber(ship.crew)}/${formatNumber(NAVAL_SHIP_PROFILES[ship.type]?.crew || ship.crew)} экип., корпус ${formatNumber(ship.hull)})`).join(' · ') || 'Нет боеспособных судов'}</td><td>${formatNumber(fleet.morale)}%</td><td>${formatNumber(fleet.action_points)} ОД</td></tr>`).join('') || '<tr><td colspan="5">Сохранённых флотилий пока нет.</td></tr>';
                    } catch { /* The confirmed naval result is saved even if the registry refresh fails. */ }
                }
                showToast('Исход сражения подтверждён');
                await renderStoredBattle(confirmButton.dataset.confirmStoredBattle);
            } catch (error) { showToast(`Подтверждение не выполнено: ${error.message}`, 7000); confirmButton.disabled = false; }
        }
    });
    elements.pageView.querySelector('#military-event-list')?.addEventListener('click', event => {
        const opener = event.target.closest('[data-open-military-battle]');
        if (opener) {
            battleDetailsHost.dataset.battleId = opener.dataset.openMilitaryBattle;
            renderStoredBattle(opener.dataset.openMilitaryBattle);
        }
    });
    const levyKind = elements.pageView.querySelector('#levy-kind');
    const levyUnit = elements.pageView.querySelector('#levy-unit');
    const levyMarker = elements.pageView.querySelector('#levy-marker');
    const levyCulture = elements.pageView.querySelector('#levy-culture');
    const levyYards = elements.pageView.querySelector('#levy-yards');
    const levySeason = state.gameCalendar?.season || 'Весна';
    const getLevyContext = () => {
        const marker = ownedLevyMarkers.find(item => Number(item.id) === Number(levyMarker?.value));
        const province = marker && levySnapshot?.provinces?.find(item => Number(item.id) === Number(marker.province_id));
        const ratio = marker && levySnapshot?.estateRatios?.find(item => item.settlement_type === marker.type);
        const provinceRatio = levySnapshot?.estateRatios?.find(item => item.settlement_type === 'province');
        const kind = levyKind?.value;
        const culture = kind === 'peasants' ? (province?.main_culture || marker?.culture || '') : (marker?.culture || province?.main_culture || '');
        const yards = kind === 'peasants'
            ? (Number(province?.yards) || 0) * (Number(provinceRatio?.peasants) || 0.95)
            : (Number(marker?.yards) || 0) * (Number(ratio?.[kind]) || 0);
        const sourceId = kind === 'peasants' ? province?.id : marker?.id;
        const usedForces = state.militaryForces.filter(force => force.is_militia && force.status === 'active' && force.levy_source_kind === kind && Number(force.levy_source_id) === Number(sourceId))
            .reduce((sum, force) => sum + (force.unit_groups || []).reduce((subtotal, group) => subtotal + (Number(group.count) || 0), 0), 0);
        const usedOrders = militaryLevyOrders.filter(order => order.status === 'training' && order.levy_kind === kind && Number(order.source_id) === Number(sourceId))
            .reduce((sum, order) => sum + (Number(order.unit_count) || 0), 0);
        return { marker, province, kind, culture, yards, sourceId, used: usedForces + usedOrders };
    };
    const refreshLevyUnits = () => {
        const context = getLevyContext();
        const culture = context.culture.toLocaleLowerCase('ru');
        levyCulture.value = context.culture;
        levyYards.value = Math.floor(context.yards);
        let options = levyKind.value === 'aristocracy' ? cavalryUnits : levyKind.value === 'peasants' ? unitNames.filter(name => !['scout'].includes(LAND_UNIT_PROFILES[name].role)) : footUnits;
        options = options.filter(name => {
            if (name === 'Арбалетчики') return culture.includes('свей') || culture.includes('эст');
            if (name === 'Конные лучники') return culture.includes('казан');
            return true;
        });
        if (!options.length) options = ['Нет доступных типов'];
        levyUnit.innerHTML = options.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
        levyUnit.disabled = options[0] === 'Нет доступных типов';
    };
    const updateLevyEstimate = () => {
        const kind = levyKind.value;
        const yards = Number(elements.pageView.querySelector('#levy-yards').value) || 0;
        const count = Math.max(0, Math.floor(Number(elements.pageView.querySelector('#levy-count').value) || 0));
        const extraordinary = elements.pageView.querySelector('#levy-emergency').value === 'true';
        const context = getLevyContext();
        const capacity = calculateLevyCapacity(yards, kind, extraordinary);
        const availableQuota = Math.max(0, capacity - context.used);
        const unit = levyUnit.value;
        if (!LAND_UNIT_PROFILES[unit]) {
            elements.pageView.querySelector('#levy-estimate').innerHTML = '<p class="page-note">Выберите культуру с доступным для этого контингента типом войск.</p>';
            return;
        }
        const category = LAND_UNIT_PROFILES[unit]?.role === 'cavalry' ? 'cavalry' : 'foot';
        const ownerModifiers = getOwnerModifiers(playerOwner, levySnapshot || {}, levySnapshot?.calendar?.turn || state.gameCalendar?.turn || 1);
        const recruitmentFactor = Math.max(0, 1 + modifierValue(ownerModifiers,'military_recruitment_cost_pct') / 100);
        const cost = calculateRecruitmentCost(count, category, extraordinary);
        for (const key of ['treasury','arms','cloth']) cost[key] = Math.round(cost[key] * recruitmentFactor * 100) / 100;
        const upkeep = calculateSeasonalUpkeep([{ type: unit, count }], levySeason);
        const upkeepFactor = Math.max(0, 1 + modifierValue(ownerModifiers,'military_upkeep_pct') / 100);
        const supplyFactor = Math.max(0, 1 + modifierValue(ownerModifiers,'supply_consumption_pct') / 100);
        upkeep.treasury = Math.round(upkeep.treasury * upkeepFactor * 100) / 100;
        for (const key of ['food','cloth','grain','fuel']) upkeep[key] = Math.round(upkeep[key] * upkeepFactor * supplyFactor * 100) / 100;
        const inventory = levySnapshot?.inventories || [];
        const armsAvailable = Number(inventory.find(row => Number(row.marker_id) === Number(context.marker?.id) && row.item_type === 'good' && row.item_name === 'Оружие и Доспехи')?.quantity) || 0;
        const clothAvailable = Number(inventory.find(row => Number(row.marker_id) === Number(context.marker?.id) && row.item_type === 'good' && row.item_name === 'Сукно и Одежда')?.quantity) || 0;
        const settings = levySnapshot?.mechanics?.find(row => row.owner === playerOwner)?.settings || {};
        const treasuryAvailable = Number(settings.economy?.treasury) || 0;
        const available = treasuryAvailable >= cost.treasury && armsAvailable >= cost.arms && clothAvailable >= cost.cloth;
        const overLimit = count > availableQuota || !context.marker || !context.province;
        const button = elements.pageView.querySelector('#place-military-levy-order');
        if (button) button.disabled = overLimit || count < 1 || !available || levyUnit.disabled;
        elements.pageView.querySelector('#levy-estimate').innerHTML = `<div><span>Квота источника</span><strong>${formatNumber(availableQuota)} бойц. из ${formatNumber(capacity)} · уже в службе или сборе ${formatNumber(context.used)}</strong></div><div><span>Разовая стоимость</span><strong>${formatNumber(cost.treasury, 2)} z · ${formatNumber(cost.arms, 3)} оружия · ${formatNumber(cost.cloth, 3)} одежды</strong></div><div><span>Содержание за ход</span><strong>${formatNumber(upkeep.treasury, 2)} z · ${formatNumber(upkeep.food, 2)} продовольствия · ${formatNumber(upkeep.cloth, 3)} одежды${upkeep.grain ? ` · ${formatNumber(upkeep.grain, 2)} зерна` : ''}${upkeep.fuel ? ` · ${formatNumber(upkeep.fuel, 3)} топлива` : ''}</strong></div>${overLimit ? '<p class="page-error">Укажите поселение и численность в пределах доступной квоты.</p>' : ''}${!available ? `<p class="page-error">Не хватает средств или снаряжения на складе (казна ${formatNumber(treasuryAvailable,2)} z; оружие ${formatNumber(armsAvailable,3)}; одежда ${formatNumber(clothAvailable,3)}).</p>` : ''}`;
    };
    levyKind.addEventListener('change', () => { refreshLevyUnits(); updateLevyEstimate(); });
    levyMarker?.addEventListener('change', () => { refreshLevyUnits(); updateLevyEstimate(); });
    refreshLevyUnits();
    ['#levy-emergency','#levy-count'].forEach(selector => elements.pageView.querySelector(selector).addEventListener('input', updateLevyEstimate));
    levyUnit.addEventListener('change', updateLevyEstimate);
    updateLevyEstimate();
    elements.pageView.querySelectorAll('[data-hire-mercenary]').forEach(button => button.addEventListener('click', async () => {
        button.disabled = true;
        try {
            const result = await hireMilitaryMercenary(button.dataset.hireMercenary);
            showToast(`Наёмная группа нанята и размещена в Гарнизоне. Списано ${formatNumber(result.paid_z)} z за первый сезон.`, 6500);
            await renderMilitaryPlanner();
        } catch (error) { showToast(`Не удалось нанять группу: ${error.message}`, 7000); button.disabled = false; }
    }));
    elements.pageView.querySelectorAll('.hire-mercenary-camp').forEach(button => button.addEventListener('click', async () => {
        button.disabled = true;
        try {
            const result = await hireMilitaryMercenaryCamp(button.dataset.forceId);
            showToast(`Лагерь нанят целиком: ${formatNumber(result.troops)} бойцов и Воевода. Списано ${formatNumber(result.paid_z)} z.`, 6500);
            await renderMilitaryPlanner();
        } catch (error) { showToast(`Не удалось нанять лагерь: ${error.message}`, 7000); button.disabled = false; }
    }));
    elements.pageView.querySelectorAll('.renew-mercenary-contract').forEach(button => button.addEventListener('click', async () => {
        button.disabled = true;
        try {
            const result = await renewMilitaryMercenaryContract(button.dataset.forceId);
            showToast(`Контракт продлён до хода ${formatNumber(result.service_end_turn)}. Списано ${formatNumber(result.paid_z)} z.`, 6500);
            await renderMilitaryPlanner();
        } catch (error) { showToast(`Не удалось продлить контракт: ${error.message}`, 7000); button.disabled = false; }
    }));
    elements.pageView.querySelector('#place-military-levy-order')?.addEventListener('click', async event => {
        const button = event.currentTarget;
        button.disabled = true;
        try {
            const order = await placeMilitaryLevyOrder({ levyKind: levyKind.value, destinationMarkerId: Number(levyMarker.value), unitType: levyUnit.value, unitCount: Math.floor(Number(elements.pageView.querySelector('#levy-count').value) || 0), emergency: elements.pageView.querySelector('#levy-emergency').value === 'true' });
            showToast(`Сбор начат: ${order.unit_count} · ${order.unit_type}. Гарнизон появится с хода ${order.due_turn}.`);
            await renderMilitaryPlanner();
        } catch (error) {
            showToast(`Не удалось начать сбор: ${error.message}`, 7000);
            button.disabled = false;
            refreshLevyUnits();
            updateLevyEstimate();
        }
    });
    const update = () => {
        const groups = [...elements.pageView.querySelectorAll('.military-unit-count')].map(input => ({ type: input.dataset.unit, count: Number(input.value) || 0 }));
        const load = calculateLandCommandLoad(groups);
        const mobility = calculateArmyMobility(groups);
        elements.pageView.querySelector('#military-load').textContent = `${formatNumber(load.total)} / 1 000 пунктов`;
        elements.pageView.querySelector('#military-mobility').textContent = mobility.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2});
        elements.pageView.querySelector('#military-supply').textContent = `${formatNumber(calculateArmySupplyPoints(groups, state.gameCalendar?.season))} пунктов · ${state.gameCalendar?.season || 'сезон не задан'}`;
        elements.pageView.querySelectorAll('[data-terrain]').forEach(cell => { cell.textContent = `${movementStepCost(cell.dataset.terrain, cell.dataset.diagonal === 'true', mobility)} ОД`; });
    };
    elements.pageView.querySelectorAll('.military-unit-count').forEach(input => input.addEventListener('input', update));
    update();
    const armyLists = { attacker: elements.pageView.querySelector('#battle-attacker-armies'), defender: elements.pageView.querySelector('#battle-defender-armies') };
    for (const side of ['attacker', 'defender']) {
        elements.pageView.querySelector(`#battle-add-${side}`)?.addEventListener('click', () => {
            const index = armyLists[side].querySelectorAll('.battle-army-card').length;
            armyLists[side].insertAdjacentHTML('beforeend', battleArmyCard(side, index));
        });
        armyLists[side]?.addEventListener('click', event => {
            if (!event.target.closest('.battle-remove-army')) return;
            event.target.closest('.battle-army-card')?.remove();
        });
        armyLists[side]?.addEventListener('change', event => {
            const source = event.target.closest('.battle-force-source');
            if (!source) {
                const editedCard = event.target.closest('.battle-army-card');
                if (editedCard) delete editedCard.dataset.persistentForceId;
                return;
            }
            const force = state.militaryForces.find(item => item.id === source.value);
            const card = source.closest('.battle-army-card');
            if (!force || !card) { if (card) delete card.dataset.persistentForceId; return; }
            card.dataset.persistentForceId = force.id;
            card.querySelector('.battle-army-name').value = force.name;
            const owner = card.querySelector('.battle-army-owner');
            if (owner) owner.value = force.owner;
            card.querySelector('.battle-army-morale').value = force.morale;
            card.querySelector('.battle-army-order').value = force.order_name;
            card.querySelector('.battle-army-tactic').value = force.tactic;
            const skills = force.commander_skills || {};
            card.querySelector('.battle-army-management-level').value = skills.management || 0;
            card.querySelector('.battle-army-leadership-level').value = skills.leadership || 0;
            card.querySelector('.battle-army-tactics-level').value = skills.tactics || 0;
            card.querySelector('.battle-army-planning-level').value = skills.planning || 0;
            const counts = Object.fromEntries((force.unit_groups || []).map(group => [group.type, group.count]));
            card.querySelectorAll('.battle-unit-count').forEach(input => { input.value = counts[input.dataset.unit] || 0; });
        });
        armyLists[side]?.addEventListener('input', event => {
            const card = event.target.closest('.battle-army-card');
            if (card && !event.target.closest('.battle-force-source')) delete card.dataset.persistentForceId;
        });
    }
    const collectBattleArmies = side => [...armyLists[side].querySelectorAll('.battle-army-card')].map((card, index) => ({
        id: `${side}-${index}`,
        persistentForceId: card.dataset.persistentForceId || '',
        name: card.querySelector('.battle-army-name').value.trim() || `${side === 'attacker' ? 'Армия атакующих' : 'Армия защитников'} ${index + 1}`,
        owner: card.querySelector('.battle-army-owner')?.value || '',
        order: card.querySelector('.battle-army-order').value,
        tactic: card.querySelector('.battle-army-tactic').value,
        skills: { management: Number(card.querySelector('.battle-army-management-level').value) || 0, leadership: Number(card.querySelector('.battle-army-leadership-level').value) || 0, tactics: Number(card.querySelector('.battle-army-tactics-level').value) || 0, planning: Number(card.querySelector('.battle-army-planning-level').value) || 0 },
        morale: Number(card.querySelector('.battle-army-morale').value) || 0,
        decision: card.querySelector('.battle-army-decision')?.value || 'fight',
        withdrawalRoute: card.querySelector('.battle-army-decision')?.value === 'withdraw' ? { steps: Number(card.querySelector('.battle-withdrawal-steps').value) || 0, difficultCells: Number(card.querySelector('.battle-withdrawal-difficult').value) || 0, friendlyDestination: card.querySelector('.battle-withdrawal-friendly').checked } : null,
        conditions: { ranged: elements.pageView.querySelector('#battle-ranged').checked, snow: elements.pageView.querySelector('#battle-snow').checked, maneuver: elements.pageView.querySelector('#battle-ski-maneuver').checked, charge: side === 'attacker' && elements.pageView.querySelector('#battle-charge').checked, flank: side === 'attacker' && elements.pageView.querySelector('#battle-flank').checked, surprise: side === 'attacker' && elements.pageView.querySelector('#battle-surprise').checked, fieldCamp: side === 'defender' && elements.pageView.querySelector('#battle-field-camp').checked, flanked: side === 'defender' && elements.pageView.querySelector('#battle-flank').checked, pursue: elements.pageView.querySelector(`#battle-${side}-pursuit`).checked },
        units: [...card.querySelectorAll('.battle-unit-count')].map(input => ({ type: input.dataset.unit, count: Number(input.value) || 0 })).filter(group => group.count > 0)
    }));
    const readSiegeConfig = () => elements.pageView.querySelector('#battle-siege-enabled')?.checked ? {
        level: Number(elements.pageView.querySelector('#battle-siege-level').value) || 1,
        works: Number(elements.pageView.querySelector('#battle-siege-works').value) || 0,
        route: elements.pageView.querySelector('#battle-siege-route').value
    } : null;
    elements.pageView.querySelector('#calculate-land-battle')?.addEventListener('click', () => {
        const result = elements.pageView.querySelector('#land-battle-result');
        const attackerArmies = collectBattleArmies('attacker').filter(army => army.units.length), defenderArmies = collectBattleArmies('defender').filter(army => army.units.length);
        if (!attackerArmies.length || !defenderArmies.length) { result.innerHTML = '<p class="page-error">Укажите хотя бы одну армию с войсками для каждой стороны.</p>'; return; }
        try {
            const terrain = elements.pageView.querySelector('#battle-terrain').value;
            const siege = readSiegeConfig();
            const weather = state.regionalWeather?.find(row => row.region === 'Общая зона') || null;
            const battle = simulateLandBattle({ battleId: `preview-${terrain}`, attackerArmies, defenderArmies, terrain, siege, weather });
            const outcomeLabels = { attacker: battle.noBattle ? 'Все защитники успешно отошли · боя нет' : 'Преимущество у атакующих', defender: 'Преимущество у защитников', draw: 'Ничья' };
            const withdrawalRows = (battle.withdrawals || []).map(check => {
                const armyName = battle.armies.defender.find(army => army.id === check.armyId)?.name || check.armyId;
                const factors = Object.entries(check.factors).map(([name, value]) => `${escapeHtml(name)} ${value > 0 ? '+' : ''}${formatNumber(value, 1)} п.п.`).join(' · ');
                return `<article class="military-phase-result"><strong>Отход · ${escapeHtml(String(armyName))}: ${check.success ? 'успешен' : 'не удался'}</strong><span>Шанс ${formatNumber(check.chance, 1)}% · закреплённый бросок ${formatNumber(check.roll * 100, 1)} · маршрут ${check.routeSteps} шаг.</span><small>${factors}</small></article>`;
            }).join('');
            const phaseRows = battle.phases.map(phase => {
                const sideText = side => {
                    const armies = phase.casualties[side];
                    const byType = {};
                    armies.forEach(army => Object.entries(army.lossesByType).forEach(([type, count]) => { byType[type] = (byType[type] || 0) + count; }));
                    const detail = Object.entries(byType).filter(([, count]) => count > 0).map(([type, count]) => `${escapeHtml(type)} −${formatNumber(count)}`).join(', ') || 'без потерь';
                    const armyNames = Object.fromEntries(battle.armies[side].map(army => [army.id, army.name || army.id]));
                    const armyDetails = armies.map(army => `${escapeHtml(String(armyNames[army.armyId] || army.armyId))}: −${formatNumber(army.losses)} чел., мораль ${formatNumber(army.morale)}%${army.broke ? ', отступила' : ''}`).join('; ');
                    return `<span>${side === 'attacker' ? 'Атакующие' : 'Защитники'}: −${formatNumber(armies.total)} чел.</span><small>${armyDetails}</small><small>${detail}</small>`;
                };
                return `<article class="military-phase-result"><strong>${phase.phase === 'first' ? 'Первое столкновение' : `Перелом боя · цикл ${phase.cycle}`}</strong>${sideText('attacker')}${sideText('defender')}</article>`;
            }).join('');
            const pursuitReport = battle.pursuit ? `<article class="military-phase-result"><strong>Преследование · ${battle.pursuit.pursuerSide === 'attacker' ? 'атакующие' : 'защитники'}</strong><span>Потери отступающих: ${formatNumber(battle.pursuit.casualties.reduce((sum, row) => sum + row.losses, 0))} чел. (${formatNumber(battle.pursuit.lossRatio * 100, 1)}%)</span><small>${battle.pursuit.casualties.map(row => `${escapeHtml(String(battle.armies[battle.pursuit.retreatingSide]?.find(army => army.id === row.armyId)?.name || row.armyId))}: ${Object.entries(row.lossesByType).map(([type, count]) => `${escapeHtml(type)} −${formatNumber(count)}`).join(', ') || 'без потерь'}`).join('; ')}</small></article>` : '';
            const siegeModifiers = battle.phases[0]?.siege;
            const siegeSummary = siegeModifiers ? `<p class="page-note">Штурм: ${siegeModifiers.state === 'intact' ? 'укрепления целы' : siegeModifiers.state === 'weakened' ? 'укрепления ослаблены' : 'в укреплениях пролом'} · удар атакующих ×${formatNumber(siegeModifiers.attackMultiplier, 2)} · защита гарнизона ×${formatNumber(siegeModifiers.defenseMultiplier, 2)}.</p>` : '';
            const weatherNames = { clear: 'ясно', rain: 'дождь', mud: 'распутица', snow: 'снег', frost: 'мороз', heat: 'жара' };
            const weatherNote = weather ? `<p class="page-note">Автоматическая погода · ${weatherNames[weather.land_condition] || weather.land_condition}. Дождь ослабляет стрельбу на 10%, распутица и снег — удар конницы на 10%, жара — силу всех войск на 5%. Обзор не меняется.</p>` : '';
            result.innerHTML = `<h3>${outcomeLabels[battle.outcome]}</h3>${weatherNote}${siegeSummary}${withdrawalRows}${phaseRows}${pursuitReport}<p class="page-note">Вероятность отхода: 50% базово; сила −12…+12 п.п.; мобильность ±6; мораль ±10; Планирование до +15; длина маршрута до −12; трудная местность до −9; дружественный пункт +5; конница противника −5. Итог 10–80%. Предпросмотр не сохраняется.</p>`;
        } catch (error) { result.innerHTML = `<p class="page-error">${escapeHtml(error.message)}</p>`; }
    });
    elements.pageView.querySelectorAll('[data-naval-type]').forEach(select => select.addEventListener('change', () => {
        const row = select.closest('[data-naval-ship-row]');
        const profile = NAVAL_SHIP_PROFILES[select.value];
        row.querySelector('[data-naval-crew]').value = profile?.crew ?? 0;
        row.querySelector('[data-naval-hull]').value = profile?.hull ?? 0;
    }));
    const collectNavalFleet = side => {
        const section = elements.pageView.querySelector(`[data-naval-side="${side}"]`);
        return {
            owner: section.querySelector('[data-naval-owner]')?.value || state.userProfile?.owner || '',
            name: section.querySelector('[data-naval-fleet-name]')?.value.trim() || (side === 'attacker' ? 'Флот атакующих' : 'Флот защитников'),
            persistentFleetId: section.querySelector('[data-naval-fleet-source]')?.value || null,
            pursue: Boolean(section.querySelector('[data-naval-pursue]')?.checked),
            commanderSkills: militaryFleets.find(fleet => fleet.id === section.querySelector('[data-naval-fleet-source]')?.value)?.commander_skills || {},
            morale: Number(section.querySelector(`[data-naval-fleet-morale="${side}"]`).value),
            ships: [...section.querySelectorAll('[data-naval-ship-row]')].map((row, index) => ({
                id: row.dataset.shipId || `${side}-${index + 1}`, type: row.querySelector('[data-naval-type]').value,
                crew: Number(row.querySelector('[data-naval-crew]').value), hull: Number(row.querySelector('[data-naval-hull]').value),
                weapon: row.querySelector('[data-naval-weapon]').value, boardingMen: Number(row.querySelector('[data-naval-boarding]').value)
            })).filter(ship => ship.type)
        };
    };
    elements.pageView.querySelectorAll('[data-naval-fleet-source]').forEach(select => select.addEventListener('change', () => {
        const section = select.closest('[data-naval-side]');
        const fleet = militaryFleets.find(item => item.id === select.value);
        if (!fleet || !section) return;
        section.querySelector('[data-naval-owner]').value = fleet.owner;
        section.querySelector('[data-naval-fleet-name]').value = fleet.name;
        section.querySelector(`[data-naval-fleet-morale="${section.dataset.navalSide}"]`).value = fleet.morale;
        const rows = [...section.querySelectorAll('[data-naval-ship-row]')];
        rows.forEach((row, index) => {
            const ship = fleet.ships[index];
            row.dataset.shipId = ship?.id || '';
            row.querySelector('[data-naval-type]').value = ship?.type || '';
            row.querySelector('[data-naval-crew]').value = ship?.crew || 0;
            row.querySelector('[data-naval-hull]').value = ship?.hull || 0;
            row.querySelector('[data-naval-weapon]').value = ship?.weapon || 'none';
            row.querySelector('[data-naval-boarding]').value = ship?.boardingMen || 0;
        });
        if (fleet.ships.length > rows.length) showToast(`В форме доступно ${rows.length} судов; в этой флотилии больше, проверьте, что состав не будет обрезан.`, 6000);
    }));
    elements.pageView.querySelector('#calculate-naval-battle')?.addEventListener('click', () => {
        const result = elements.pageView.querySelector('#naval-battle-result');
        try {
            const weather = state.regionalWeather?.find(row => row.region === 'Общая зона') || null;
            const battle = simulateNavalBattle({ battleId: `naval-preview-${state.gameCalendar?.turn || 0}`, attacker: collectNavalFleet('attacker'), defender: collectNavalFleet('defender'), weather, pursue: Object.fromEntries(['attacker','defender'].map(side => [side, collectNavalFleet(side).pursue])), poorVisibility: elements.pageView.querySelector('#naval-poor-visibility').checked,
                requestWithdrawal: Object.fromEntries(['attacker','defender'].map(side => [side, elements.pageView.querySelector(`[data-naval-retreat="${side}"]`).checked])),
                safeRetreat: Object.fromEntries(['attacker','defender'].map(side => [side, elements.pageView.querySelector(`[data-naval-safe-retreat="${side}"]`).checked])),
                adverseConditions: Object.fromEntries(['attacker','defender'].map(side => [side, elements.pageView.querySelector(`[data-naval-adverse="${side}"]`).checked])) });
            const outcome = { attacker: 'Преимущество у атакующих', defender: 'Преимущество у защитников', draw: 'Ничья' }[battle.outcome];
            const withdrawals = battle.withdrawals.map(check => `<article class="military-phase-result"><strong>${check.side === 'attacker' ? 'Атакующие' : 'Защитники'} · отход ${check.cycle === 0 ? 'до боя' : `после цикла ${check.cycle}`}: ${check.unavailable ? 'невозможен — нет управляемого судна с экипажем от 75%' : check.success ? 'успешен' : 'не удался'}</strong><span>${check.unavailable ? '' : `Шанс ${formatNumber(check.chance, 1)}% · закреплённый бросок ${formatNumber(check.roll * 100, 1)}.`}</span></article>`).join('');
            const navalPursuit = battle.pursuit ? `<article class="military-phase-result"><strong>Преследование · ${battle.pursuit.pursuerSide === 'attacker' ? 'атакующие' : 'защитники'}</strong><span>${battle.pursuit.success ? battle.pursuit.captured ? `Захвачено судно ${escapeHtml(battle.pursuit.targetShipId)}.` : `Судно ${escapeHtml(battle.pursuit.targetShipId)} потеряло ${formatNumber(battle.pursuit.crewLoss)} чел. экипажа и 1 пункт корпуса.` : escapeHtml(battle.pursuit.reason || 'Перехват не удался')} ${battle.pursuit.chance ? `· шанс ${formatNumber(battle.pursuit.chance, 1)}%, бросок ${formatNumber(battle.pursuit.roll * 100, 1)}.` : ''}</span></article>` : '';
            const cycleRows = battle.cycles.map(cycle => {
                const rangedRows = cycle.ranged.map(attack => `<small>${attack.attacker} → ${attack.target}: ${attack.hit ? 'попадание' : 'промах'} (${attack.chance}%); ${attack.crewLoss ? `экипаж −${formatNumber(attack.crewLoss)}` : ''}${attack.damage ? `корпус −${attack.damage}` : ''}${attack.fire ? '; пожар' : ''}</small>`).join('') || '<small>Дальнобойных атак не было.</small>';
                const boardingRows = cycle.boarding.filter(row => typeof row.target === 'string').map(row => `<small>Абордаж ${row.attackerShips.join(', ')} → ${row.target}: экипаж цели −${formatNumber(row.targetLoss)}.</small>`).join('') || '<small>Абордажей не было.</small>';
                const losses = ['attacker','defender'].map(side => {
                    const ships = cycle.casualties[side].map(row => `${row.shipId}: экипаж −${formatNumber(row.crewLost)}, корпус ${formatNumber(row.hull)}, мораль ${formatNumber(row.morale)}%${row.crewRescued ? `, спасены ${formatNumber(row.crewRescued)}` : ''}${row.crewPrisoners ? `, в плену ${formatNumber(row.crewPrisoners)}` : ''}${row.crewMissing ? `, пропали ${formatNumber(row.crewMissing)}` : ''}${row.fire ? ', пожар' : ''}${row.captured ? ', сдалось/захвачено' : ''}${row.sunk ? ', затонуло' : ''}${row.disabled ? ', обездвижено' : ''}`).join('; ');
                    return `<small>${side === 'attacker' ? 'Атакующие' : 'Защитники'} — ${ships || 'без изменений'}</small>`;
                }).join('');
                return `<article class="military-phase-result"><strong>Боевой цикл ${cycle.cycle}</strong>${rangedRows}${boardingRows}${losses}</article>`;
            }).join('');
            const finalRows = ['attacker','defender'].map(side => `<p><strong>${side === 'attacker' ? 'Атакующие' : 'Защитники'} · мораль ${formatNumber(battle.fleets[side].morale)}%:</strong> ${battle.fleets[side].ships.map(ship => `${escapeHtml(ship.id)} (${escapeHtml(ship.type)}) — ${ship.sunk ? 'затонуло' : ship.captured ? `захвачено стороной ${ship.capturedBy === 'attacker' ? 'атакующих' : 'защитников'}` : `${formatNumber(ship.crew)} чел., корпус ${formatNumber(ship.hull)}/${NAVAL_SHIP_PROFILES[ship.type].hull}${ship.fire ? ', пожар' : ''}${ship.disabled ? ', обездвижено' : ''}${ship.weapon !== 'none' ? `, залпов осталось ${battle.drawsRemaining[side][ship.id]}` : ''}`}`).join('; ')}</p>`).join('');
            const seaWeatherLabels = { calm: 'штиль', rough: 'волнение', storm: 'шторм' };
            const weatherNote = weather ? `<p class="page-note">Автоматическая погода · ${seaWeatherLabels[weather.sea_condition] || weather.sea_condition}. Волнение снижает шанс попадания на 5 п.п., шторм — на 10 п.п.; обзор не меняется.</p>` : '';
            result.innerHTML = `<h3>${outcome}</h3>${weatherNote}${withdrawals}${navalPursuit}${cycleRows}${finalRows}<p class="page-note">Предпросмотр закрепляет случайные значения по идентификатору расчёта; обновите страницу или измените состав, чтобы получить новый расчёт.</p>`;
        } catch (error) { result.innerHTML = `<p class="page-error">${escapeHtml(error.message)}</p>`; }
    });
    elements.pageView.querySelector('#save-naval-fleets')?.addEventListener('click', async event => {
        const button = event.currentTarget;
        const fleets = ['attacker','defender'].map(collectNavalFleet);
        if (fleets.some(fleet => !fleet.owner || !fleet.name || !fleet.ships.length) || fleets.some(fleet => fleet.persistentFleetId && fleet.persistentFleetId === fleets.find(other => other !== fleet)?.persistentFleetId)) {
            showToast('Для каждой флотилии укажите государство, название и хотя бы одно судно; одну флотилию нельзя назначить обеим сторонам.', 6000);
            return;
        }
        button.disabled = true;
        try {
            await saveMilitaryFleets(fleets.map(fleet => ({ ...(fleet.persistentFleetId ? { id: fleet.persistentFleetId } : {}), owner: fleet.owner, name: fleet.name, morale: fleet.morale, ships: fleet.ships, status: 'active' })));
            militaryFleets = await fetchMilitaryFleets();
            showToast('Флотилии сохранены');
            await renderMilitaryPlanner();
        } catch (error) { showToast(`Не удалось сохранить флотилии: ${error.message}`, 7000); }
        finally { button.disabled = false; }
    });
    elements.pageView.querySelector('#save-naval-battle')?.addEventListener('click', async event => {
        const button = event.currentTarget;
        const result = elements.pageView.querySelector('#naval-battle-result');
        const fleets = { attacker: collectNavalFleet('attacker'), defender: collectNavalFleet('defender') };
        if (!fleets.attacker.owner || !fleets.defender.owner || fleets.attacker.owner === fleets.defender.owner || !fleets.attacker.ships.length || !fleets.defender.ships.length) {
            result.innerHTML = '<p class="page-error">Для каждой стороны выберите разные государства и укажите хотя бы одно судно.</p>';
            return;
        }
        button.disabled = true;
        try {
            const linkedFleets = ['attacker','defender'].map(side => fleets[side]).filter(fleet => fleet.persistentFleetId);
            if (linkedFleets.length) {
                await saveMilitaryFleets(linkedFleets.map(fleet => ({ id: fleet.persistentFleetId, owner: fleet.owner, name: fleet.name, morale: fleet.morale, ships: fleet.ships, status: 'active' })));
            }
            const adverseConditions = Object.fromEntries(['attacker','defender'].map(side => [side, elements.pageView.querySelector(`[data-naval-adverse="${side}"]`).checked]));
            const location = { source: 'admin_naval_preview', poorVisibility: elements.pageView.querySelector('#naval-poor-visibility').checked, adverseConditions };
            const payload = ['attacker','defender'].map(side => ({ owner: fleets[side].owner, side, name: fleets[side].name, morale: fleets[side].morale, order_name: 'обычный', tactic: fleets[side].pursue ? 'naval_pursuit' : 'none', decision: 'pending', withdrawal_route: null, unit_data: { ships: fleets[side].ships, commander_skills: fleets[side].commanderSkills, persistent_fleet_id: fleets[side].persistentFleetId } }));
            const battleId = await createMilitaryBattle({ battle_type: 'naval', terrain: 'sea', location }, payload);
            showToast(`Создано морское событие ${String(battleId).slice(0, 8)}`);
            await renderMilitaryPlanner();
        } catch (error) { result.innerHTML = `<p class="page-error">Не удалось создать морское событие: ${escapeHtml(error.message)}</p>`; }
        finally { button.disabled = false; }
    });
    elements.pageView.querySelector('#save-land-battle')?.addEventListener('click', async event => {
        const button = event.currentTarget, result = elements.pageView.querySelector('#land-battle-result');
        const armies = [...collectBattleArmies('attacker').map(army => ({ ...army, side: 'attacker' })), ...collectBattleArmies('defender').map(army => ({ ...army, side: 'defender' }))].filter(army => army.units.length);
        if (armies.some(army => !army.owner) || new Set(armies.map(army => army.owner)).size < 2 || !armies.some(army => army.side === 'attacker') || !armies.some(army => army.side === 'defender')) {
            result.innerHTML = '<p class="page-error">Для каждой армии укажите государство; нужны участники от двух государств и армии на обеих сторонах.</p>'; return;
        }
        button.disabled = true;
        try {
            const terrain = elements.pageView.querySelector('#battle-terrain').value;
            const payload = armies.map(army => ({ owner: army.owner, side: army.side, name: army.name, morale: army.morale, order_name: army.order, tactic: army.tactic, decision: army.side === 'defender' ? 'pending' : 'fight', withdrawal_route: null, unit_data: { units: army.units, skills: army.skills, conditions: army.conditions, persistent_force_id: army.persistentForceId || null } }));
            const siege = readSiegeConfig();
            const battleId = await createMilitaryBattle({ battle_type: 'land', terrain, location: { source: 'admin_preview', ...(siege ? { siege } : {}) } }, payload);
            showToast(`Создано боевое событие ${String(battleId).slice(0, 8)}`);
            await renderMilitaryPlanner();
        } catch (error) { result.innerHTML = `<p class="page-error">Не удалось создать событие: ${escapeHtml(error.message)}</p>`; }
        finally { button.disabled = false; }
    });
}

async function renderDiplomacy(owner) {
    const isAdmin = state.userProfile?.role === 'admin';
    const myOwner = owner || state.userProfile?.owner;
    try {
        const data = await fetchDiplomacyData();
        const contracts = state.economySnapshot?.tradeContracts || [];
        const states = Object.keys(state.dbOwnerColors || {}).filter(name => name && name !== myOwner).sort((a,b) => a.localeCompare(b, 'ru'));
        const relationFor = other => data.relations.find(row => [row.owner_a,row.owner_b].includes(myOwner) && [row.owner_a,row.owner_b].includes(other));
        const relationRows = states.map(other => {
            const rel = relationFor(other);
            const trade = contracts.some(c => c.status === 'active' && ((c.seller_owner === myOwner && c.buyer_owner === other) || (c.buyer_owner === myOwner && c.seller_owner === other)));
            const war = rel?.state === 'war' ? 'Война' : 'Мир';
            const treaty = rel?.treaty === 'alliance' ? 'Союз' : rel?.treaty === 'non_aggression' ? 'Пакт о ненападении' : 'Нет';
            return `<tr><td>${escapeHtml(other)}</td><td>${war}</td><td>${treaty}</td><td>${trade ? 'Торговля' : 'Нет'}</td></tr>`;
        }).join('');
        const proposals = data.proposals.filter(p => isAdmin || p.proposer_owner === myOwner || p.target_owner === myOwner);
        const proposalRows = proposals.map(p => {
            const label = {non_aggression:'Пакт о ненападении',alliance:'Союз',peace:'Мир',war:'Объявление войны',end_treaty:'Расторжение договора'}[p.action] || p.action;
            const status = p.status === 'approved' ? 'Действует' : p.status === 'rejected' ? 'Отклонено' : p.admin_approved ? 'Ожидает игрока' : p.player_approved ? 'Ожидает администратора' : 'Ожидает ответа государства';
            const canAnswer = !isAdmin && p.target_owner === myOwner && !p.player_approved && p.status === 'pending';
            const canAdmin = isAdmin && p.player_approved && !p.admin_approved && p.status === 'pending';
            return `<tr><td>${escapeHtml(p.proposer_owner)} → ${escapeHtml(p.target_owner)}</td><td>${label}</td><td>${status}</td><td>${canAnswer ? `<button class="compact-add-btn" data-diplomacy-id="${p.id}" data-diplomacy-approve="true">Принять</button><button class="page-back-btn" data-diplomacy-id="${p.id}" data-diplomacy-approve="false">Отклонить</button>` : canAdmin ? `<button class="compact-add-btn" data-diplomacy-id="${p.id}" data-diplomacy-approve="true">Подтвердить</button><button class="page-back-btn" data-diplomacy-id="${p.id}" data-diplomacy-approve="false">Отклонить</button>` : '—'}</td></tr>`;
        }).join('');
        const proposeForm = !isAdmin && myOwner ? `<form id="diplomacy-proposal-form" class="military-form-grid"><label>Государство<select name="target" required><option value="">Выберите государство</option>${states.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')}</select></label><label>Предложение<select name="action"><option value="non_aggression">Пакт о ненападении · 5 ОП</option><option value="alliance">Союз · 10 ОП</option><option value="peace">Мир · 10 ОП</option><option value="war">Объявить войну · 5 ОП</option><option value="end_treaty">Расторгнуть пакт / союз</option></select></label><button class="admin-btn" type="submit">Отправить предложение</button></form>` : '';
        showPageView('Дипломатия', `<section class="page-panel"><header class="page-panel-heading"><div><h2>Отношения государств</h2><p>Торговля отображается по активным торговым договорам. Пакт и Союз требуют согласия второй стороны и подтверждения администратора.</p></div></header><div class="page-table-wrap"><table class="page-table"><thead><tr><th>Государство</th><th>Мир / Война</th><th>Договор о безопасности</th><th>Торговля</th></tr></thead><tbody>${relationRows || '<tr><td colspan="4">Других государств пока нет.</td></tr>'}</tbody></table></div>${proposeForm}<section class="diplomacy-proposals"><h3>Предложения и решения</h3><div class="page-table-wrap"><table class="page-table"><thead><tr><th>Стороны</th><th>Предмет</th><th>Статус</th><th>Действие</th></tr></thead><tbody>${proposalRows || '<tr><td colspan="4">Открытых предложений нет.</td></tr>'}</tbody></table></div></section></section>`, { navId: 'nav-diplomacy', subtitle: myOwner || '' });
        elements.pageView.querySelector('#diplomacy-proposal-form')?.addEventListener('submit', async event => {
            event.preventDefault(); const form=event.currentTarget, button=form.querySelector('button[type="submit"]'); button.disabled=true;
            try { await createDiplomacyProposal(form.elements.target.value,form.elements.action.value); showToast('Дипломатическое предложение отправлено'); await renderDiplomacy(myOwner); }
            catch(error) { showToast(`Не удалось отправить предложение: ${error.message}`,7000); button.disabled=false; }
        });
        elements.pageView.querySelectorAll('[data-diplomacy-id]').forEach(button => button.addEventListener('click', async () => {
            button.disabled=true;
            try { await decideDiplomacyProposal(button.dataset.diplomacyId,button.dataset.diplomacyApprove==='true'); showToast('Решение сохранено'); await renderDiplomacy(myOwner); }
            catch(error) { showToast(`Не удалось сохранить решение: ${error.message}`,7000); button.disabled=false; }
        }));
    } catch(error) {
        showPageView('Дипломатия', `<div class="page-panel"><p class="page-error">Не удалось загрузить дипломатические отношения: ${escapeHtml(error.message)}. Примените миграцию diplomacy_relations_and_proposals.sql.</p></div>`, { navId:'nav-diplomacy', subtitle:myOwner || '' });
    }
}

function getNavigationItems() {
    const isAdmin = state.userProfile?.role === 'admin';
    const isAuth = !!state.currentUser;
    const hasOwner = !!state.userProfile?.owner;
    if (isAdmin) return [{ id: 'nav-map', label: 'Карта' }, { id: 'nav-stats', label: 'Статистика' }, { id: 'nav-modifiers', label: 'Модификаторы' }, ...(activePageOwner ? [{ id: 'nav-economy', label: 'Экономика' }, { id: 'nav-trade', label: 'Торговля' }, { id: 'nav-production', label: 'Производство' }, { id: 'nav-military', label: 'Военное дело' }, { id: 'nav-spy', label: 'Шпионаж и Саботаж' }, { id: 'nav-diplomacy', label: 'Дипломатия' }] : []), { id: 'nav-rules', label: 'Правила и механики' }];
    if (!isAuth || !hasOwner) return [{ id: 'nav-rules', label: 'Правила и механики' }, { id: 'nav-vk', label: 'Сообщество VK', externalUrl: 'https://vk.ru/sixieme_terre' }];
    return [{ id: 'nav-map', label: 'Карта' }, { id: 'nav-stats', label: 'Статистика' }, { id: 'nav-economy', label: 'Экономика' }, { id: 'nav-trade', label: 'Торговля' }, { id: 'nav-production', label: 'Производство' }, { id: 'nav-cities', label: 'Города' }, { id: 'nav-provinces', label: 'Провинции' }, { id: 'nav-military', label: 'Военное дело' }, { id: 'nav-spy', label: 'Шпионаж и Саботаж' }, { id: 'nav-diplomacy', label: 'Дипломатия' }, { id: 'nav-modifiers', label: 'Модификаторы' }, { id: 'nav-rules', label: 'Правила и механики' }, { id: 'nav-vk', label: 'Сообщество VK', externalUrl: 'https://vk.ru/sixieme_terre' }];
}

function activateNavigationItem(id, url) {
    if (url) { window.open(url, '_blank', 'noopener,noreferrer'); return; }
    const owner = activePageOwner || state.userProfile?.owner || '';
    if (id === 'nav-map') closePageView();
    else if (id === 'nav-stats') state.userProfile?.role === 'admin' ? renderAdminStateList() : state.userProfile?.owner && renderStateStatistics(state.userProfile.owner, state.userProfile.nickname || '');
    else if (id === 'nav-economy') owner && renderEconomy(owner, state.userProfile?.nickname || '');
    else if (id === 'nav-trade') owner && renderProductionConsumption(owner, 'trade', state.userProfile?.nickname || '');
    else if (id === 'nav-production') owner && renderProductionConsumption(owner, 'production', state.userProfile?.nickname || '');
    else if (id === 'nav-provinces') owner && renderOwnerProvinces(owner);
    else if (id === 'nav-cities') owner && renderOwnerSettlements(owner);
    else if (id === 'nav-military') renderMilitaryPlanner();
    else if (id === 'nav-spy') renderMilitaryPlanner(true);
    else if (id === 'nav-diplomacy') renderDiplomacy(owner);
    else if (id === 'nav-modifiers') renderModifierPage(owner);
    else if (id === 'nav-rules') renderUnavailableSection('Правила и механики', 'Раздел откроется здесь после публикации отдельной вики-страницы проекта.', id);
}

export function renderNavMenu() {
    if (!elements.navDropdownMenu) return;

    const items = getNavigationItems();

    elements.navDropdownMenu.innerHTML = items.map(item => `
        <button class="nav-menu-item" data-id="${item.id}" ${item.externalUrl ? `data-url="${item.externalUrl}"` : ''}>
            ${item.label}
        </button>
    `).join('');

    elements.navDropdownMenu.querySelectorAll('.nav-menu-item').forEach(btn => {
        btn.addEventListener('click', (e) => {
            activateNavigationItem(e.currentTarget.dataset.id, e.currentTarget.dataset.url);
            elements.navDropdownMenu.classList.remove('active');
        });
    });
}

function renderMapFinanceBadge() {
    const badge = elements.mapFinanceBadge;
    const owner = state.userProfile?.role === 'player' ? state.userProfile.owner : null;
    if (!badge || !owner) { if (badge) badge.hidden = true; return; }
    const economy = state.stateMechanics[owner]?.economy || {};
    badge.innerHTML = `<span class="map-finance-item"><span class="finance-coin-icon" aria-label="Казна">◉</span>${formatNumber(Number(economy.treasury) || 0)} z</span><span class="map-finance-item"><span class="finance-op-icon">ОП</span>${formatNumber(Number(economy.prestige) || 0)}</span>`;
    badge.hidden = false;
}

export function updateAuthUI() {
    if (state.currentUser) {
        const nickname = state.userProfile?.nickname || state.currentUser.email;
        elements.openLoginBtn.textContent = `${nickname} (Выход)`;
    } else {
        elements.openLoginBtn.textContent = 'Вход';
    }

    if (state.userProfile?.role === 'admin') {
        elements.adminControls.style.display = 'flex';
        if (elements.advanceTurnBtn) elements.advanceTurnBtn.style.display = 'inline-flex';
    } else {
        elements.adminControls.style.display = 'none';
        if (elements.advanceTurnBtn) elements.advanceTurnBtn.style.display = 'none';
    }

    renderMapFinanceBadge();
    if (elements.militaryMapTools) elements.militaryMapTools.hidden = !state.showMilitaryGrid || !['player','admin'].includes(state.userProfile?.role);
    renderNavMenu();
}

export function initEventListeners() {
    if (!document.getElementById('military-order-panel')) {
        const panel = document.createElement('section');
        panel.id = 'military-order-panel';
        panel.className = 'military-order-panel';
        panel.hidden = true;
        panel.innerHTML = '<span data-order-summary></span><div class="army-map-actions"><select data-attack-target aria-label="Вражеская армия" hidden></select><button type="button" data-order-attack hidden>Напасть · 10 ОД</button><select data-siege-target aria-label="Поселение для осады"><option value="">Поселение для осады</option></select><button type="button" data-order-siege>Начать осаду</button><button type="button" data-order-raid>Набег</button><button type="button" data-order-cancel>Отмена</button><button type="button" data-order-confirm>Выполнить движение</button></div>';
        document.body.append(panel);
        panel.addEventListener('click', async event => {
            const action = event.target.closest('button');
            if (!action) return;
            if (action.matches('[data-order-cancel]')) {
                state.militarySelectedForceId = null;
                state.militaryMoveDraft = null;
                state.militarySelectedFleetId = null;
                state.militaryFleetMoveDraft = null;
                renderMilitaryGrid();
                syncMilitaryMovePanel();
                return;
            }
            if (action.matches('[data-order-attack]')) {
                const attacker = state.militaryForces.find(item => item.id === state.militarySelectedForceId);
                const defenderId = panel.querySelector('[data-attack-target]')?.value;
                if (!attacker || !defenderId) return;
                action.disabled = true;
                try {
                    const battleId = await startMilitaryBattle(attacker.id, defenderId);
                    state.militarySelectedForceId = null;
                    state.militaryMoveDraft = null;
                    state.militaryForces = await fetchMilitaryForces();
                    renderMilitaryGrid();
                    syncMilitaryMovePanel();
                    showToast(`Приказ атаковать отправлен. Сражение ${String(battleId).slice(0, 8)} ожидает решения сторон и подтверждения администратора.`, 7000);
                } catch (error) {
                    showToast(`Не удалось начать сражение: ${error.message}`, 7000);
                    action.disabled = false;
                }
                return;
            }
            if (action.matches('[data-order-raid]')) {
                const army = state.militaryForces.find(item => item.id === state.militarySelectedForceId);
                if (!army) return;
                action.disabled = true;
                try { await startMilitaryRaid(army.id); showToast('Приказ на набег принят; операция займёт текущий ход.'); state.militaryForces = await fetchMilitaryForces(); renderMilitaryGrid(); syncMilitaryMovePanel(); }
                catch(error) { showToast(`Не удалось начать набег: ${error.message}`,7000); action.disabled=false; }
                return;
            }
            if (action.matches('[data-order-siege]')) {
                const army = state.militaryForces.find(item => item.id === state.militarySelectedForceId);
                const markerId = panel.querySelector('[data-siege-target]')?.value;
                if (!army || !markerId) { showToast('Выберите укреплённое поселение.'); return; }
                action.disabled = true;
                try { const result=await startMilitarySiege(army.id,Number(markerId)); showToast(`Осада начата. Потрачено ${formatNumber(result.spent_action_points)} ОД.`); state.militaryForces=await fetchMilitaryForces(); renderMilitaryGrid(); syncMilitaryMovePanel(); }
                catch(error) { showToast(`Не удалось начать осаду: ${error.message}`,7000); action.disabled=false; }
                return;
            }
            if (!action.matches('[data-order-confirm]') || (!state.militaryMoveDraft && !state.militaryFleetMoveDraft)) return;
            action.disabled = true;
            try {
                const draft = state.militaryFleetMoveDraft || state.militaryMoveDraft;
                const isFleet = !!state.militaryFleetMoveDraft;
                const result = isFleet ? await moveMilitaryFleet(draft.fleetId, draft.path) : await moveMilitaryForce(draft.forceId, draft.path);
                if (isFleet) state.militaryFleets = await fetchMilitaryFleets();
                else state.militaryForces = await fetchMilitaryForces();
                state.militaryMoveDraft = null;
                state.militaryFleetMoveDraft = null;
                state.militarySelectedForceId = null;
                state.militarySelectedFleetId = null;
                renderMilitaryGrid();
                syncMilitaryMovePanel();
                showToast(`${isFleet ? 'Флотилия' : 'Армия'} перемещена на ${result.cost} ОД. Осталось ${result.remaining} ОД.`);
            } catch (error) {
                showToast(`Не удалось переместить армию: ${error.message}`, 7000);
                action.disabled = false;
            }
        });
    }
    if (window.innerWidth <= 768) {
        elements.legendPanel?.classList.add('collapsed');
        elements.controlsPanel?.classList.add('collapsed');
        if (elements.legendToggleBtn) elements.legendToggleBtn.textContent = '+';
        if (elements.controlsToggleBtn) elements.controlsToggleBtn.textContent = '+';
    }

    elements.legendToggleBtn?.addEventListener('click', () => {
        const isCollapsed = elements.legendPanel.classList.toggle('collapsed');
        elements.legendToggleBtn.textContent = isCollapsed ? '+' : '−';
    });

    elements.advanceTurnBtn?.addEventListener('click', async () => {
        if (state.userProfile?.role !== 'admin') return;
        const button = elements.advanceTurnBtn;
        button.disabled = true;
        try {
            state.gameCalendar = await advanceEconomyTurn();
            renderGameCalendar();
            showToast('Рассчитаны производство, потребление и запасы. Наступил новый ход');
        } catch (error) {
            showToast(`Не удалось сменить ход: ${error.message}`);
        } finally {
            button.disabled = false;
        }
    });

    elements.controlsToggleBtn?.addEventListener('click', () => {
        const isCollapsed = elements.controlsPanel.classList.toggle('collapsed');
        elements.controlsToggleBtn.textContent = isCollapsed ? '+' : '−';
    });

    elements.tradeRoutesToggleBtn?.addEventListener('click', () => {
        state.showTradeRoutes = !state.showTradeRoutes;
        elements.tradeRoutesToggleBtn.classList.toggle('active', state.showTradeRoutes);
        elements.tradeRoutesToggleBtn.textContent = `Торговые маршруты: ${state.showTradeRoutes ? 'показаны' : 'скрыты'}`;
        refreshTradeRouteOverlay();
    });

    elements.tradeRouteUndoBtn?.addEventListener('click', () => {
        if (state.tradeRouteDraft?.path.length > 1) state.tradeRouteDraft.path.pop();
        syncTradeRouteEditor();
    });
    elements.tradeRouteClearBtn?.addEventListener('click', () => {
        if (state.tradeRouteDraft) state.tradeRouteDraft.path = [state.tradeRouteDraft.sourceProvinceId];
        syncTradeRouteEditor();
    });
    elements.tradeRouteCancelBtn?.addEventListener('click', cancelTradeRouteSelection);
    elements.tradeRouteSaveBtn?.addEventListener('click', async () => {
        const draft = state.tradeRouteDraft;
        if (!draft || draft.path.at(-1) !== draft.destinationProvinceId) return;
        elements.tradeRouteSaveBtn.disabled = true;
        try {
            await saveStateTradeContractRoute(draft.contractId, draft.path);
            state.tradeRouteDraft = null;
            elements.tradeRouteEditor.hidden = true;
            state.economySnapshot = await fetchEconomySnapshot();
            refreshTradeRouteOverlay();
            showToast('Ручной торговый маршрут сохранён');
            await renderProductionConsumption(draft.owner, 'trade', draft.playerName);
        } catch (error) {
            showToast(`Не удалось сохранить маршрут: ${error.message}`);
            syncTradeRouteEditor();
        }
    });

    elements.openLoginBtn?.addEventListener('click', async () => {
        if (state.currentUser) {
            await signOutUser();
            showToast('Вы вышли из системы');
        } else {
            elements.loginModal?.classList.add('active');
        }
    });

    elements.loginModalClose?.addEventListener('click', () => {
        elements.loginModal?.classList.remove('active');
    });

    elements.loginModal?.addEventListener('click', (e) => {
        if (e.target === elements.loginModal) {
            elements.loginModal.classList.remove('active');
        }
    });

    elements.authLoginBtn?.addEventListener('click', async () => {
        const email = elements.authEmailInput.value.trim();
        const password = elements.authPasswordInput.value;

        if (!email || !password) {
            showToast('Заполните все поля');
            return;
        }

        try {
            elements.authLoginBtn.textContent = 'Вход...';
            await signInUser(email, password);
            elements.loginModal?.classList.remove('active');
            elements.authEmailInput.value = '';
            elements.authPasswordInput.value = '';
            showToast('Вы успешно вошли');
        } catch (err) {
            showToast('Ошибка входа: ' + err.message);
        } finally {
            elements.authLoginBtn.textContent = 'Вход';
        }
    });

    elements.openRegisterBtn?.addEventListener('click', () => {
        elements.loginModal?.classList.remove('active');
        elements.registerModal?.classList.add('active');
    });

    elements.registerModalClose?.addEventListener('click', () => {
        elements.registerModal?.classList.remove('active');
    });

    elements.registerModal?.addEventListener('click', (e) => {
        if (e.target === elements.registerModal) {
            elements.registerModal.classList.remove('active');
        }
    });

    elements.regSubmitBtn?.addEventListener('click', async () => {
        const nickname = elements.regNicknameInput.value.trim();
        const email = elements.regEmailInput.value.trim();
        const password = elements.regPasswordInput.value;
        const confirmPass = elements.regPasswordConfirmInput.value;

        if (!nickname || !email || !password) {
            showToast('Заполните все обязательные поля');
            return;
        }

        if (password !== confirmPass) {
            showToast('Пароли не совпадают');
            return;
        }

        try {
            elements.regSubmitBtn.textContent = 'Регистрация...';
            await signUpUser(email, password, nickname);
            showToast('Регистрация успешна!');
            elements.registerModal?.classList.remove('active');
            elements.regNicknameInput.value = '';
            elements.regEmailInput.value = '';
            elements.regPasswordInput.value = '';
            elements.regPasswordConfirmInput.value = '';
        } catch (err) {
            showToast('Ошибка регистрации: ' + err.message);
        } finally {
            elements.regSubmitBtn.textContent = 'Зарегистрироваться';
        }
    });

    elements.addMarkerModeBtn?.addEventListener('click', () => {
        state.isAddingMarkerMode = !state.isAddingMarkerMode;
        elements.addMarkerModeBtn.classList.toggle('active', state.isAddingMarkerMode);
        if (state.isAddingMarkerMode) {
            showToast('Кликните по карте в месте создания нового маркера', 0);
        } else {
            hideToast();
        }
    });

    elements.layerButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            elements.layerButtons.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            state.activeLayer = e.target.dataset.layer;
            renderActiveLayer();
        });
    });

    elements.militaryGridToggleBtn?.addEventListener('click', () => {
        if (state.editingMilitaryTerrain) {
            state.editingMilitaryTerrain = false;
            document.body.classList.remove('military-terrain-editing');
            elements.militaryTerrainEditBtn?.classList.remove('active');
            elements.militaryTerrainEditBtn?.setAttribute('aria-pressed', 'false');
            if (elements.militaryTerrainEditBtn) elements.militaryTerrainEditBtn.textContent = 'Разметка военной карты: выкл.';
        }
        state.showMilitaryGrid = !state.showMilitaryGrid;
        elements.militaryGridToggleBtn.classList.toggle('active', state.showMilitaryGrid);
        elements.militaryGridToggleBtn.setAttribute('aria-pressed', String(state.showMilitaryGrid));
        elements.militaryGridToggleBtn.textContent = `Военная сетка: ${state.showMilitaryGrid ? 'показана' : 'скрыта'}`;
        if (elements.militaryMapTools) elements.militaryMapTools.hidden = !state.showMilitaryGrid || !['player','admin'].includes(state.userProfile?.role);
        if (!state.showMilitaryGrid) {
            state.militarySelectedForceId = null; state.militaryMoveDraft = null;
            state.militarySelectedFleetId = null; state.militaryFleetMoveDraft = null; state.pendingMilitaryFleetLaunch = null;
        }
        renderMilitaryGrid();
        syncMilitaryMovePanel();
    });
    elements.militaryTerrainEditBtn?.addEventListener('click', () => {
        if (state.userProfile?.role !== 'admin') return;
        state.editingMilitaryTerrain = !state.editingMilitaryTerrain;
        if (state.editingMilitaryTerrain) state.showMilitaryGrid = true;
        document.body.classList.toggle('military-terrain-editing', state.editingMilitaryTerrain);
        elements.militaryTerrainEditBtn.classList.toggle('active', state.editingMilitaryTerrain);
        elements.militaryTerrainEditBtn.setAttribute('aria-pressed', String(state.editingMilitaryTerrain));
        elements.militaryTerrainEditBtn.textContent = `Разметка военной карты: ${state.editingMilitaryTerrain ? 'вкл.' : 'выкл.'}`;
        if (elements.militaryGridToggleBtn) {
            elements.militaryGridToggleBtn.classList.toggle('active', state.showMilitaryGrid);
            elements.militaryGridToggleBtn.setAttribute('aria-pressed', String(state.showMilitaryGrid));
            elements.militaryGridToggleBtn.textContent = `Военная сетка: ${state.showMilitaryGrid ? 'показана' : 'скрыта'}`;
        }
        if (elements.militaryMapTools) elements.militaryMapTools.hidden = !state.showMilitaryGrid || !['player','admin'].includes(state.userProfile?.role);
        renderMilitaryGrid();
        if (state.editingMilitaryTerrain) showToast('Щёлкни по клетке для выбранной местности; чтобы разметить реку, выбери направление течения в списке.');
    });
    const structureCosts = { camp:[100,40,10], watchtower:[160,60,10], palisade:[100,40,10], bridge:[1800,140,30], ferry:[1200,80,20] };
    const refreshStructureCost = () => {
        const type = document.getElementById('map-structure-type')?.value || 'camp';
        const [z, wood, tools] = structureCosts[type] || structureCosts.camp;
        const admin = state.userProfile?.role === 'admin';
        const cost = document.getElementById('map-structure-cost');
        if (cost) cost.textContent = admin ? 'Администратор: бесплатно, начинает действовать сразу.' : `Стоимость: ${formatNumber(z)} z · ${formatNumber(wood)} Древесины · ${formatNumber(tools)} Инструментов. Действует со следующего хода.`;
        const sourceWrap = document.getElementById('map-structure-source-wrap');
        const ownerWrap = document.getElementById('map-structure-owner-wrap');
        if (sourceWrap) sourceWrap.hidden = admin;
        if (ownerWrap) ownerWrap.hidden = !admin;
    };
    const ownerSelect = document.getElementById('map-structure-owner');
    if (ownerSelect) ownerSelect.innerHTML = Object.keys(state.dbOwnerColors || {}).map(owner => `<option value="${escapeHtml(owner)}">${escapeHtml(owner)}</option>`).join('');
    const sourceSelect = document.getElementById('map-structure-source');
    if (sourceSelect) sourceSelect.innerHTML = (state.dbMarkers || []).filter(marker => marker.owner === state.userProfile?.owner && marker.type !== 'ruins').map(marker => `<option value="${Number(marker.id)}">${escapeHtml(marker.name || `Поселение #${marker.id}`)}</option>`).join('');
    document.getElementById('map-structure-type')?.addEventListener('change', refreshStructureCost);
    document.getElementById('map-structure-build')?.addEventListener('click', () => {
        const type = document.getElementById('map-structure-type')?.value;
        const isAdmin = state.userProfile?.role === 'admin';
        const sourceMarkerId = Number(sourceSelect?.value);
        if (!state.militaryGridCells.size) { showToast('Сначала синхронизируйте клетки военной карты.'); return; }
        if (!isAdmin && !sourceMarkerId) { showToast('Нужно выбрать поселение со складом материалов.'); return; }
        state.pendingMilitaryStructure = { type, sourceMarkerId, owner: isAdmin ? ownerSelect?.value : state.userProfile?.owner, admin: isAdmin };
        state.showMilitaryGrid = true;
        elements.militaryGridToggleBtn?.classList.add('active');
        elements.militaryGridToggleBtn?.setAttribute('aria-pressed','true');
        if (elements.militaryGridToggleBtn) elements.militaryGridToggleBtn.textContent = 'Военная сетка: показана';
        elements.militaryMapTools.hidden = false;
        document.getElementById('map-structure-status').textContent = 'Щёлкните по клетке на карте.';
        document.getElementById('map-structure-cancel').hidden = false;
        renderMilitaryGrid();
    });
    document.getElementById('map-structure-cancel')?.addEventListener('click', () => {
        state.pendingMilitaryStructure = null;
        document.getElementById('map-structure-status').textContent = 'Выбор отменён.';
        document.getElementById('map-structure-cancel').hidden = true;
    });
    refreshStructureCost();
    elements.cancelMilitaryPlacementBtn?.addEventListener('click', () => {
        state.pendingMilitaryPlacement = null;
        state.pendingMilitaryMobilization = null;
        document.body.classList.remove('military-army-placement');
        elements.cancelMilitaryPlacementBtn.style.display = 'none';
        showToast('Размещение армии отменено.');
    });

    elements.markerTypeCheckboxes.forEach(cb => {
        cb.addEventListener('change', (e) => {
            state.visibleMarkerTypes[e.target.value] = e.target.checked;
            renderMarkers();
        });
    });

    elements.toggleMarkerNamesBtn?.addEventListener('click', () => {
        state.showMarkerNames = !state.showMarkerNames;
        elements.toggleMarkerNamesBtn.classList.toggle('active', state.showMarkerNames);
        renderMarkers();
    });

    elements.trackerBtn?.addEventListener('click', () => {
        state.trackerActive = !state.trackerActive;
        elements.trackerBtn.classList.toggle('active', state.trackerActive);

        if (state.trackerActive) {
            state.trackerPos.x = Math.round((window.innerWidth / 2 - state.tx) / state.scale);
            state.trackerPos.y = Math.round((window.innerHeight / 2 - state.ty) / state.scale);
            showTrackerPopup();
        } else {
            if (state.activePopupType === 'tracker') clearSelection();
        }
        renderMarkers();
    });

    elements.viewport?.addEventListener('wheel', (e) => {
        if (elements.pageView?.classList.contains('active')) return;
        e.preventDefault();
        const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
        const newScale = Math.min(Math.max(state.minScale, state.scale * zoomFactor), 2.5);

        const rect = elements.viewport.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const imgX = (mouseX - state.tx) / state.scale;
        const imgY = (mouseY - state.ty) / state.scale;

        state.tx = mouseX - imgX * newScale;
        state.ty = mouseY - imgY * newScale;
        state.scale = newScale;

        updateTransform();
    }, { passive: false });

    elements.viewport?.addEventListener('mousedown', async (e) => {
        if (elements.pageView?.classList.contains('active')) return;
        if (e.target === elements.popup || elements.popup.contains(e.target) || e.target.closest('#controls-panel') || e.target.closest('#left-sidebar') || e.target.closest('#login-modal') || e.target.closest('#register-modal') || e.target.closest('#trade-route-editor') || e.target.closest('#military-order-panel')) return;

        const rect = elements.viewport.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const imgX = Math.floor((mouseX - state.tx) / state.scale);
        const imgY = Math.floor((mouseY - state.ty) / state.scale);

        if (state.pendingMilitaryFleetLaunch && state.userProfile?.role === 'player') {
            if (imgX < 0 || imgX >= elements.hiddenCanvas.width || imgY < 0 || imgY >= elements.hiddenCanvas.height) return;
            const cellX = Math.floor(imgX / MILITARY_GRID_CELL_SIZE), cellY = Math.floor(imgY / MILITARY_GRID_CELL_SIZE);
            try {
                await launchMilitaryFleet(state.pendingMilitaryFleetLaunch.fleetId, cellX, cellY);
                state.pendingMilitaryFleetLaunch = null;
                state.militaryFleets = await fetchMilitaryFleets();
                renderMilitaryGrid();
                showToast(`Флотилия вышла из порта в клетку ${cellX + 1}:${cellY + 1}.`);
            } catch (error) { showToast(`Не удалось вывести флот: ${error.message}`, 7000); }
            return;
        }

        if (state.movingMarkerId !== null) {
            const movingMarker = state.dbMarkers.find(m => m.id === state.movingMarkerId);
            if (movingMarker) {
                const img = markerImages[movingMarker.type];
                const w = img?.naturalWidth || 24;
                const h = img?.naturalHeight || 24;
                if (imgX >= movingMarker.coord_1 - w / 2 && imgX <= movingMarker.coord_1 + w / 2 &&
                    imgY >= movingMarker.coord_2 - h / 2 && imgY <= movingMarker.coord_2 + h / 2) {
                    state.isDraggingMarker = true;
                    return;
                }
            }
        }

        if (state.trackerActive) {
            const dx = imgX - state.trackerPos.x;
            const dy = imgY - state.trackerPos.y;
            if (Math.hypot(dx, dy) <= 20) {
                state.isDraggingTracker = true;
                return;
            }
        }

        state.isDragging = true;
        state.startX = e.clientX - state.tx;
        state.startY = e.clientY - state.ty;
        state.dragDistance = 0;
    });

    window.addEventListener('mousemove', (e) => {
        if (!elements.viewport || elements.pageView?.classList.contains('active')) return;
        const rect = elements.viewport.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const imgX = Math.round((mouseX - state.tx) / state.scale);
        const imgY = Math.round((mouseY - state.ty) / state.scale);

        if (state.isDraggingMarker && state.movingMarkerId !== null) {
            const idx = state.dbMarkers.findIndex(m => m.id === state.movingMarkerId);
            if (idx !== -1) {
                state.dbMarkers[idx].coord_1 = imgX;
                state.dbMarkers[idx].coord_2 = imgY;
                renderMarkers();
            }
            return;
        }

        if (state.isDraggingTracker) {
            state.trackerPos.x = imgX;
            state.trackerPos.y = imgY;
            renderMarkers();
            showTrackerPopup();
            return;
        }

        if (!state.isDragging) return;
        const newTx = e.clientX - state.startX;
        const newTy = e.clientY - state.startY;
        state.dragDistance += Math.hypot(newTx - state.tx, newTy - state.ty);
        state.tx = newTx;
        state.ty = newTy;
        updateTransform();
    });

    window.addEventListener('mouseup', async () => {
        if (state.isDraggingMarker && state.movingMarkerId !== null) {
            state.isDraggingMarker = false;
            const movingMarker = state.dbMarkers.find(m => m.id === state.movingMarkerId);
            if (movingMarker) {
                try {
                    await updateMarkerData(movingMarker.id, {
                        coord_1: movingMarker.coord_1,
                        coord_2: movingMarker.coord_2
                    });
                    showToast('Новое положение поселения сохранено');
                } catch (err) {
                    showToast('Ошибка сохранения позиции: ' + err.message);
                }
            }
            state.movingMarkerId = null;
        }

        state.isDragging = false;
        state.isDraggingTracker = false;
    });

    elements.viewport?.addEventListener('click', async (e) => {
        if (elements.pageView?.classList.contains('active')) return;
        if (state.dragDistance > 5) return;
        if (e.target === elements.popup || elements.popup.contains(e.target) || e.target.closest('#controls-panel') || e.target.closest('#left-sidebar') || e.target.closest('#login-modal') || e.target.closest('#register-modal') || e.target.closest('#trade-route-editor')) return;

        const rect = elements.viewport.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const imgX = Math.floor((mouseX - state.tx) / state.scale);
        const imgY = Math.floor((mouseY - state.ty) / state.scale);

        if (state.editingMilitaryTerrain && state.userProfile?.role === 'admin') {
            if (imgX < 0 || imgX >= elements.hiddenCanvas.width || imgY < 0 || imgY >= elements.hiddenCanvas.height) return;
            const cellX = Math.floor(imgX / MILITARY_GRID_CELL_SIZE), cellY = Math.floor(imgY / MILITARY_GRID_CELL_SIZE);
            const selected = elements.militaryTerrainSelect?.value || 'plain';
            if (selected.startsWith('flow:')) {
                const cell = state.militaryGridCells.get(`${cellX},${cellY}`);
                if (!(Number(cell?.water_types) & 1)) { showToast('Для направления течения выбери клетку, отмеченную как река.'); return; }
                const [dx, dy] = selected.slice(5).split(',').map(Number);
                try {
                    await setMilitaryWaterCurrent(cellX, cellY, dx, dy);
                    state.militaryGridCells.set(`${cellX},${cellY}`, { ...cell, flow_dx:dx, flow_dy:dy });
                    renderMilitaryGrid();
                    showToast(`Течение в клетке ${cellX + 1}:${cellY + 1} направлено ${elements.militaryTerrainSelect.selectedOptions[0].textContent.replace(/^На /, '').trim().toLowerCase()}.`);
                } catch (error) { showToast(`Не удалось сохранить течение: ${error.message}`, 7000); }
                return;
            }
            const cellLeft = cellX * MILITARY_GRID_CELL_SIZE, cellTop = cellY * MILITARY_GRID_CELL_SIZE;
            const cellWidth = Math.max(1, Math.min(elements.hiddenCanvas.width - cellLeft, MILITARY_GRID_CELL_SIZE));
            const cellHeight = Math.max(1, Math.min(elements.hiddenCanvas.height - cellTop, MILITARY_GRID_CELL_SIZE));
            const provincePixels = elements.hiddenCtx.getImageData(cellLeft, cellTop, cellWidth, cellHeight).data;
            const provinceVotes = new Map();
            for (let py = 1; py < cellHeight - 1; py += 3) {
                for (let px = 1; px < cellWidth - 1; px += 3) {
                    const index = (py * cellWidth + px) * 4;
                    const id = state.provinceRgbToId[(provincePixels[index] << 16) | (provincePixels[index + 1] << 8) | provincePixels[index + 2]];
                    if (id) provinceVotes.set(id, (provinceVotes.get(id) || 0) + 1);
                }
            }
            const provinceId = [...provinceVotes].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
            const terrain = selected === 'bridge' ? 'water' : selected;
            try {
                const cell = { cell_x: cellX, cell_y: cellY, province_id: provinceId, terrain, bridge: selected === 'bridge' };
                await saveMilitaryTerrainCell(cell);
                const key = `${cellX},${cellY}`;
                state.militaryTerrainCells.set(key, cell);
                renderMilitaryGrid();
                const terrainLabels = { plain: 'равнина', forest: 'лес', hill: 'возвышенность', marsh: 'болото', water: 'вода', bridge: 'мост через воду' };
                showToast(`Клетка ${cellX + 1}:${cellY + 1} — ${terrainLabels[selected] || selected}`);
            } catch (error) { showToast(`Не удалось сохранить местность: ${error.message}`, 7000); }
            return;
        }

        if (state.pendingMilitaryMobilization && state.userProfile?.role === 'player') {
            if (imgX < 0 || imgX >= elements.hiddenCanvas.width || imgY < 0 || imgY >= elements.hiddenCanvas.height) return;
            const cellX = Math.floor(imgX / MILITARY_GRID_CELL_SIZE), cellY = Math.floor(imgY / MILITARY_GRID_CELL_SIZE);
            const centerX = Math.min(elements.hiddenCanvas.width - 1, cellX * MILITARY_GRID_CELL_SIZE + Math.floor(MILITARY_GRID_CELL_SIZE / 2));
            const centerY = Math.min(elements.hiddenCanvas.height - 1, cellY * MILITARY_GRID_CELL_SIZE + Math.floor(MILITARY_GRID_CELL_SIZE / 2));
            let provinceId = null;
            const sampleOffsets = [[0,0], [0,-4], [4,0], [0,4], [-4,0], [4,-4], [4,4], [-4,4], [-4,-4]];
            for (const [ox, oy] of sampleOffsets) {
                const px = centerX + ox, py = centerY + oy;
                if (px < 0 || py < 0 || px >= elements.hiddenCanvas.width || py >= elements.hiddenCanvas.height) continue;
                const pixel = elements.hiddenCtx.getImageData(px, py, 1, 1).data;
                provinceId = state.provinceRgbToId[(pixel[0] << 16) | (pixel[1] << 8) | pixel[2]] || null;
                if (provinceId) break;
            }
            const pending = state.pendingMilitaryMobilization;
            const province = provinceId ? state.dbProvinces[provinceId] : null;
            if (!provinceId || Number(provinceId) !== pending.sourceProvinceId || province?.owner !== pending.owner) {
                showToast('Гарнизон можно вывести только в полевую армию внутри своей исходной провинции.');
                return;
            }
            try {
                const force = await mobilizeMilitaryGarrison({ forceId: pending.forceId, name: pending.forceName, commanderName: pending.commanderName, commanderAge: pending.commanderAge, provinceId: Number(provinceId), cellX, cellY });
                const index = state.militaryForces.findIndex(item => item.id === pending.forceId);
                if (index >= 0 && force) state.militaryForces[index] = force;
                state.pendingMilitaryMobilization = null;
                document.body.classList.remove('military-army-placement');
                elements.cancelMilitaryPlacementBtn.style.display = 'none';
                renderMilitaryGrid();
                showToast(`Гарнизон «${pending.forceName}» выведен на военную карту.`);
            } catch (error) { showToast(`Не удалось вывести гарнизон: ${error.message}`, 7000); }
            return;
        }
        if (state.pendingMilitaryStructure && ['player','admin'].includes(state.userProfile?.role)) {
            if (imgX < 0 || imgX >= elements.hiddenCanvas.width || imgY < 0 || imgY >= elements.hiddenCanvas.height) return;
            const cellX = Math.floor(imgX / MILITARY_GRID_CELL_SIZE), cellY = Math.floor(imgY / MILITARY_GRID_CELL_SIZE);
            const structureDraft = state.pendingMilitaryStructure;
            try {
                const result = structureDraft.admin
                    ? await adminBuildMilitaryStructure(structureDraft.type, cellX, cellY, structureDraft.owner)
                    : await buildMilitaryStructure(structureDraft.type, cellX, cellY, structureDraft.sourceMarkerId);
                state.militaryStructures = await fetchMilitaryStructures();
                state.pendingMilitaryStructure = null;
                document.getElementById('map-structure-status').textContent = structureDraft.admin ? 'Объект построен и действует.' : `Постройка начата. Будет действовать с хода ${formatNumber(result.available_from_turn)}.`;
                document.getElementById('map-structure-cancel').hidden = true;
                renderMilitaryGrid();
                showToast(structureDraft.admin ? `Объект построен в клетке ${cellX+1}:${cellY+1} бесплатно.` : `Строительство начато; списано ${formatNumber(result.paid_treasury)} z, ${formatNumber(result.paid_wood)} Древесины и ${formatNumber(result.paid_tools)} Инструментов.`,7000);
            } catch (error) {
                document.getElementById('map-structure-status').textContent = error.message;
                showToast(`Не удалось построить сооружение: ${error.message}`,7000);
            }
            return;
        }
        if (state.pendingMilitaryPlacement && state.userProfile?.role === 'admin') {
            if (imgX < 0 || imgX >= elements.hiddenCanvas.width || imgY < 0 || imgY >= elements.hiddenCanvas.height) return;
            const cellX = Math.floor(imgX / MILITARY_GRID_CELL_SIZE), cellY = Math.floor(imgY / MILITARY_GRID_CELL_SIZE);
            const centerX = Math.min(elements.hiddenCanvas.width - 1, cellX * MILITARY_GRID_CELL_SIZE + Math.floor(MILITARY_GRID_CELL_SIZE / 2));
            const centerY = Math.min(elements.hiddenCanvas.height - 1, cellY * MILITARY_GRID_CELL_SIZE + Math.floor(MILITARY_GRID_CELL_SIZE / 2));
            let provinceId = null;
            const sampleOffsets = [[0,0], [0,-4], [4,0], [0,4], [-4,0], [4,-4], [4,4], [-4,4], [-4,-4]];
            for (const [ox, oy] of sampleOffsets) {
                const px = centerX + ox, py = centerY + oy;
                if (px < 0 || py < 0 || px >= elements.hiddenCanvas.width || py >= elements.hiddenCanvas.height) continue;
                const pixel = elements.hiddenCtx.getImageData(px, py, 1, 1).data;
                provinceId = state.provinceRgbToId[(pixel[0] << 16) | (pixel[1] << 8) | pixel[2]] || null;
                if (provinceId) break;
            }
            const province = provinceId ? state.dbProvinces[provinceId] : null;
            if (!provinceId || province?.owner !== state.pendingMilitaryPlacement.owner) {
                showToast('Полевую армию можно разместить только в провинции её государства.');
                return;
            }
            try {
                const draft = state.pendingMilitaryPlacement;
                const id = await saveMilitaryForce({ ...draft, province_id: provinceId, cell_x: cellX, cell_y: cellY });
                state.militaryForces.push({ ...draft, id, province_id: provinceId, cell_x: cellX, cell_y: cellY });
                state.pendingMilitaryPlacement = null;
                document.body.classList.remove('military-army-placement');
                elements.cancelMilitaryPlacementBtn.style.display = 'none';
                renderMilitaryGrid();
                showToast(`Армия «${draft.name}» размещена в клетке ${cellX + 1}:${cellY + 1}.`);
            } catch (error) { showToast(`Не удалось создать армию: ${error.message}`, 7000); }
            return;
        }

        if (state.tradeRouteDraft) {
            if (imgX < 0 || imgX >= elements.hiddenCanvas.width || imgY < 0 || imgY >= elements.hiddenCanvas.height) return;
            const pixel = elements.hiddenCtx.getImageData(imgX, imgY, 1, 1).data;
            const hex = '#' + ((1 << 24) + (pixel[0] << 16) + (pixel[1] << 8) + pixel[2]).toString(16).slice(1).toUpperCase();
            const province = state.provincesMeta[hex];
            if (province) addTradeRouteProvince(Number(province.id));
            else showToast('Выбери провинцию, а не море или пустую область');
            return;
        }

        if (state.showMilitaryGrid) {
            const cellX = Math.floor(imgX / MILITARY_GRID_CELL_SIZE), cellY = Math.floor(imgY / MILITARY_GRID_CELL_SIZE);
            if (state.pendingMilitaryDisembark) {
                const pending = state.pendingMilitaryDisembark;
                try {
                    await disembarkMilitaryForce(pending.forceId, pending.fleetId, cellX, cellY);
                    state.pendingMilitaryDisembark = null;
                    state.militaryForces = await fetchMilitaryForces();
                    state.militaryFleets = await fetchMilitaryFleets();
                    renderMilitaryGrid(); syncMilitaryMovePanel();
                    showToast(`Армия высажена в клетке ${cellX + 1}:${cellY + 1}; потрачено 1 ОД.`);
                } catch (error) { showToast(`Не удалось высадить армию: ${error.message}`, 7000); }
                return;
            }
            const fleetAtCell = state.militaryFleets.find(item => item.status === 'active' && item.location_kind === 'water'
                && Number(item.cell_x) === cellX && Number(item.cell_y) === cellY);
            if (fleetAtCell) {
                if (fleetAtCell.in_pending_battle) { showToast(`Флотилия «${fleetAtCell.name}» участвует в незавершённом сражении и пока недоступна.`); return; }
                const selectedFleet = state.militaryFleets.find(item => item.id === state.militarySelectedFleetId);
                if (fleetAtCell.owner !== state.userProfile?.owner && state.userProfile?.role === 'player'
                    && selectedFleet?.owner === state.userProfile?.owner) {
                    try {
                        const battleId = await startMilitaryNavalBattle(selectedFleet.id, fleetAtCell.id);
                        state.militarySelectedFleetId = null; state.militaryFleetMoveDraft = null;
                        state.militaryFleets = await fetchMilitaryFleets();
                        renderMilitaryGrid(); syncMilitaryMovePanel();
                        showToast(`Морская атака отправлена. Сражение ${String(battleId).slice(0,8)} ожидает решений сторон и подтверждения администратора.`, 7000);
                    } catch (error) { showToast(`Не удалось начать морское сражение: ${error.message}`, 7000); }
                } else if (fleetAtCell.owner === state.userProfile?.owner || state.userProfile?.role === 'admin') {
                    state.militarySelectedFleetId = fleetAtCell.id;
                    state.militarySelectedForceId = null;
                    state.militaryMoveDraft = null;
                    state.militaryFleetMoveDraft = null;
                    renderMilitaryGrid();
                    syncMilitaryMovePanel();
                    showToast(`Выбрана флотилия «${fleetAtCell.name}». Щёлкни по доступной водной клетке назначения.`);
                } else {
                    const crew = (fleetAtCell.ships || []).reduce((sum, ship) => sum + (Number(ship.crew) || 0), 0);
                    showToast(`${fleetAtCell.name} · ${fleetAtCell.owner} · ${fleetAtCell.ships?.length || 0} судов · ${crew} членов экипажа`, 7000);
                }
                return;
            }
            if (state.militarySelectedFleetId) {
                const selectedFleet = state.militaryFleets.find(item => item.id === state.militarySelectedFleetId);
                const draft = selectedFleet && planMilitaryFleetMove(selectedFleet, cellX, cellY);
                if (!draft) showToast('До этой клетки нельзя пройти всем составом флота за оставшиеся ОД или путь закрыт.');
                else state.militaryFleetMoveDraft = draft;
                renderMilitaryGrid();
                syncMilitaryMovePanel();
                return;
            }
            const selectedForce = state.militaryForces.find(item => item.id === state.militarySelectedForceId);
            const structure = state.militaryStructures.find(item => item.status === 'active' && Number(item.cell_x) === cellX && Number(item.cell_y) === cellY);
            if (structure && selectedForce && (state.userProfile?.role === 'admin' || selectedForce.owner === state.userProfile?.owner)) {
                if (structure.owner === state.userProfile?.owner && state.userProfile?.role !== 'admin') {
                    showToast('Нельзя разрушить собственное сооружение.');
                    return;
                }
                try {
                    const result = await destroyMilitaryStructure(structure.id);
                    state.militaryStructures = await fetchMilitaryStructures();
                    state.militaryForces = await fetchMilitaryForces();
                    renderMilitaryGrid();
                    showToast(`${structure.structure_type === 'bridge' ? 'Мост сломан' : 'Сооружение разрушено'} · потрачено ${result.spent_action_points} ОД.`);
                } catch (error) { showToast(`Не удалось разрушить сооружение: ${error.message}`,7000); }
                return;
            }
            const force = state.militaryForces.find(item => item.force_kind === 'land_army' && item.status === 'active' && Number(item.cell_x) === cellX && Number(item.cell_y) === cellY);
            if (force) {
                const canCommand = state.userProfile?.role === 'admin' || force.owner === state.userProfile?.owner;
                if (canCommand) {
                    state.militarySelectedForceId = force.id;
                    state.militaryReachableCells = getReachableMilitaryCells(force);
                    state.militaryMoveDraft = null;
                    renderMilitaryGrid();
                    syncMilitaryMovePanel();
                    showToast(`Выбрана армия «${force.name}». Щёлкни по клетке назначения.`);
                    return;
                }
                const selectedForce = state.militaryForces.find(item => item.id === state.militarySelectedForceId);
                if (state.userProfile?.role === 'player' && selectedForce?.owner === state.userProfile.owner && force.owner !== state.userProfile.owner) {
                    try {
                        const battleId = await startMilitaryBattle(selectedForce.id, force.id);
                        state.militarySelectedForceId = null;
                        state.militaryMoveDraft = null;
                        state.militaryForces = await fetchMilitaryForces();
                        renderMilitaryGrid();
                        syncMilitaryMovePanel();
                        showToast(`Приказ атаковать отправлен. Сражение ${String(battleId).slice(0, 8)} ожидает решения сторон и подтверждения администратора.` , 6000);
                    } catch (error) { showToast(`Не удалось начать сражение: ${error.message}`, 7000); }
                    return;
                }
                const roster = (force.unit_groups || []).map(group => `${group.type}: ${formatNumber(group.count)}`).join(' · ') || 'состав не задан';
                showToast(`${force.name} · ${force.owner} · Воевода ${force.commander_name || 'не назначен'} · Мораль ${formatNumber(force.morale)}% · ${roster}`, 7000);
                return;
            }
            if (state.militarySelectedForceId) {
                const selectedForce = state.militaryForces.find(item => item.id === state.militarySelectedForceId);
                const draft = selectedForce && planMilitaryMove(selectedForce, cellX, cellY);
                if (!draft) showToast('До этой клетки нельзя дойти за оставшиеся ОД или путь заблокирован.');
                else state.militaryMoveDraft = draft;
                renderMilitaryGrid();
                syncMilitaryMovePanel();
                return;
            }
        }

        if (state.isAddingMarkerMode) {
            hideToast();
            showNewMarkerPopup(imgX, imgY);
            return;
        }

        for (const marker of state.dbMarkers) {
            if (!state.visibleMarkerTypes[marker.type]) continue;
            const mx = marker.coord_1;
            const my = marker.coord_2;
            const img = markerImages[marker.type];
            const w = img?.naturalWidth || 24;
            const h = img?.naturalHeight || 24;

            if (imgX >= mx - w / 2 && imgX <= mx + w / 2 && imgY >= my - h / 2 && imgY <= my + h / 2) {
                showMarkerPopup(marker);
                return;
            }
        }

        if (imgX < 0 || imgX >= elements.hiddenCanvas.width || imgY < 0 || imgY >= elements.hiddenCanvas.height) {
            clearSelection();
            return;
        }

        const pixel = elements.hiddenCtx.getImageData(imgX, imgY, 1, 1).data;
        const hex = '#' + ((1 << 24) + (pixel[0] << 16) + (pixel[1] << 8) + pixel[2]).toString(16).slice(1).toUpperCase();

        const info = state.provincesMeta[hex];

        if (info) {
            highlightProvince(hex);
            showProvincePopup(imgX, imgY, info);
        } else {
            clearSelection();
        }
    });

    elements.popupClose?.addEventListener('click', clearSelection);

    elements.searchBtn?.addEventListener('click', () => {
        const id = parseInt(elements.searchInput.value, 10);
        if (!isNaN(id)) {
            goToProvince(id);
        }
    });

    elements.searchInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const id = parseInt(elements.searchInput.value, 10);
            if (!isNaN(id)) {
                goToProvince(id);
            }
        }
    });

    elements.toggleIdsBtn?.addEventListener('click', () => {
        state.showIDs = !state.showIDs;
        elements.toggleIdsBtn.classList.toggle('active', state.showIDs);
        renderIDs();
    });

    elements.burgerMenuBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        renderNavMenu();
        elements.navDropdownMenu?.classList.toggle('active');
    });

    document.addEventListener('click', (e) => {
        if (elements.navDropdownMenu && !elements.navDropdownMenu.contains(e.target) && e.target !== elements.burgerMenuBtn && !elements.burgerMenuBtn.contains(e.target)) {
            elements.navDropdownMenu.classList.remove('active');
        }
    });
}
