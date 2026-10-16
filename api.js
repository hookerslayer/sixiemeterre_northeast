import { supabaseClient, state } from './config.js?v=military-ui-update-20261016d';

export async function loadSupabaseData() {
    const [resProvinces, resRegions, resOwners, resMarkers, resCultures, resReligions, resResources, resEstateRatios] = await Promise.all([
        supabaseClient.from('Provinces').select('*'),
        supabaseClient.from('region_color').select('*'),
        supabaseClient.from('owner_color').select('*'),
        supabaseClient.from('markers').select('*'),
        supabaseClient.from('culture_color').select('*'),
        supabaseClient.from('religion_color').select('*'),
        supabaseClient.from('resource_color').select('*'),
        supabaseClient.from('settlement_estate_ratios').select('*')
    ]);

    if (resProvinces.data) {
        resProvinces.data.forEach(row => state.dbProvinces[row.id] = row);
    }
    if (resRegions.data) {
        resRegions.data.forEach(row => {
            if (row.region && row.region_color) state.dbRegionColors[row.region] = row.region_color;
        });
    }
    if (resOwners.data) {
        resOwners.data.forEach(row => {
            if (row.owner && row.owner_color) state.dbOwnerColors[row.owner] = row.owner_color;
        });
    }
    if (resMarkers.data) {
        state.dbMarkers = resMarkers.data;
    }
    if (resCultures.data) {
        resCultures.data.forEach(row => {
            if (row.culture && row.culture_color) state.dbCultureColors[row.culture] = row.culture_color;
        });
    }
    if (resReligions.data) {
        resReligions.data.forEach(row => {
            if (row.religion && row.religion_color) state.dbReligionColors[row.religion] = row.religion_color;
        });
    }
    if (resResources.data) {
        resResources.data.forEach(row => {
            if (row.resource_name && row.resource_color) state.dbResourceColors[row.resource_name] = row.resource_color;
        });
    }
    if (resEstateRatios.data) {
        resEstateRatios.data.forEach(row => {
            state.dbEstateRatios[row.settlement_type] = row;
        });
    }
}

export async function signUpUser(email, password, nickname) {
    const { data, error } = await supabaseClient.auth.signUp({
        email,
        password,
        options: {
            data: { nickname },
            emailRedirectTo: 'https://hookerslayer.github.io/sixiemeterre_northeast/'
        }
    });
    if (error) throw error;
    return data;
}

export async function signInUser(email, password) {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
        email,
        password
    });
    if (error) throw error;
    return data;
}

export async function requestPasswordReset(email) {
    const { data, error } = await supabaseClient.auth.resetPasswordForEmail(email, {
        redirectTo: 'https://hookerslayer.github.io/sixiemeterre_northeast/'
    });
    if (error) throw error;
    return data;
}

export async function updateCurrentUserPassword(password) {
    const { data, error } = await supabaseClient.auth.updateUser({ password });
    if (error) throw error;
    return data;
}

export async function signOutUser() {
    const { error } = await supabaseClient.auth.signOut();
    if (error) throw error;
}

export async function fetchUserProfile(userId) {
    const { data, error } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

    if (error) {
        console.error('Ошибка загрузки профиля:', error);
        return null;
    }
    return data;
}

export async function fetchStateProfiles() {
    const { data, error } = await supabaseClient
        .from('profiles')
        .select('nickname, role, owner')
        .not('owner', 'is', null)
        .order('nickname');

    if (error) throw error;
    return data || [];
}

export async function fetchAdminStateUsers() {
    if (state.userProfile?.role !== 'admin') throw new Error('Only an administrator can load state registration users.');
    const { data, error } = await supabaseClient.from('profiles').select('nickname,role,owner')
        .eq('role', 'player').is('owner', null).order('nickname');
    if (error) throw error;
    return data || [];
}

export async function fetchAdminStateNames() {
    if (state.userProfile?.role !== 'admin') throw new Error('Only an administrator can load the state list.');
    const { data, error } = await supabaseClient.from('state_mechanics').select('owner').order('owner');
    if (error) throw error;
    return data || [];
}

export async function adminCreateState(values) {
    const { data, error } = await supabaseClient.rpc('admin_create_state', {
        p_username: values.username, p_owner: values.owner, p_government_form: values.governmentForm,
        p_ruler_name: values.rulerName, p_ruler_age: values.rulerAge, p_region: values.region,
        p_titular_culture: values.culture, p_titular_religion: values.religion,
        p_province_ids: values.provinceIds, p_capital_province_id: values.capitalProvinceId,
        p_owner_color: values.color, p_city_name: values.cityName || null,
        p_city_x: values.cityX ?? null, p_city_y: values.cityY ?? null
    });
    if (error) throw error;
    return data;
}

export async function adminDeleteState(owner) {
    const { data, error } = await supabaseClient.rpc('admin_delete_state', { p_owner: owner });
    if (error) throw error;
    return data;
}

export async function fetchStateMechanics(owner) {
    const { data, error } = await supabaseClient.from('state_mechanics').select('settings').eq('owner', owner).maybeSingle();
    if (error) throw error;
    return data?.settings || null;
}

export async function saveStateMechanics(owner, settings) {
    if (state.userProfile?.role !== 'admin') {
        const protectedKeys = ['crime_rate', 'corruption_rate', 'government_form', 'titular_culture', 'titular_religion', 'estate_loyalty', 'culture_loyalty', 'religion_loyalty'];
        const { data: current, error: currentError } = await supabaseClient.from('state_mechanics').select('settings').eq('owner', owner).maybeSingle();
        if (currentError) throw currentError;
        const merged = { ...settings };
        for (const key of protectedKeys) {
            if (Object.prototype.hasOwnProperty.call(current?.settings || {}, key)) merged[key] = current.settings[key];
            else delete merged[key];
        }
        if (Object.prototype.hasOwnProperty.call(current?.settings || {}, 'ruler')) merged.ruler = current.settings.ruler;
        else delete merged.ruler;
        settings = merged;
    }
    const { data, error } = await supabaseClient.from('state_mechanics').upsert({ owner, settings, updated_at: new Date().toISOString() }, { onConflict: 'owner' }).select('settings').single();
    if (error) throw error;
    return data.settings;
}

export async function saveStateOneOffOperations(owner, operations) {
    const { data, error } = await supabaseClient.rpc('save_state_one_off_operations', {
        p_owner: owner,
        p_one_off_income_treasury: operations.one_off_income_treasury || [],
        p_one_off_expenses_treasury: operations.one_off_expenses_treasury || [],
        p_one_off_income_prestige: operations.one_off_income_prestige || [],
        p_one_off_expenses_prestige: operations.one_off_expenses_prestige || []
    });
    if (error) throw error;
    return data;
}

export async function adminSetStateBalances(owner, treasury, prestige) {
    const { data, error } = await supabaseClient.rpc('admin_set_state_balances', {
        p_owner: owner, p_treasury: Number(treasury), p_prestige: Number(prestige)
    });
    if (error) throw error;
    return data;
}

export async function submitStateModifierProposal(values) {
    const { data, error } = await supabaseClient.rpc('submit_state_modifier_proposal', {
        p_effect_key: values.effectKey, p_value: values.value, p_scope_type: values.scopeType,
        p_scope_value: values.scopeValue || null, p_target_type: values.targetType || null,
        p_item_name: values.itemName || null, p_source: values.source,
        p_starts_turn: values.startsTurn, p_ends_turn: values.endsTurn ?? null
    });
    if (error) throw error;
    return data;
}

export async function adminCreateStateModifier(values) {
    const { data, error } = await supabaseClient.rpc('admin_create_state_modifier', {
        p_owner: values.owner, p_effect_key: values.effectKey, p_value: values.value,
        p_scope_type: values.scopeType, p_scope_value: values.scopeValue || null,
        p_target_type: values.targetType || null, p_item_name: values.itemName || null,
        p_source: values.source, p_starts_turn: values.startsTurn, p_ends_turn: values.endsTurn ?? null
    });
    if (error) throw error;
    return data;
}

export async function adminDecideStateModifier(id, decision) {
    const { data, error } = await supabaseClient.rpc('admin_decide_state_modifier', { p_modifier_id: id, p_decision: decision });
    if (error) throw error;
    return data;
}

export async function fetchGameCalendar() {
    const { data, error } = await supabaseClient.from('game_calendar').select('turn, season, year').eq('singleton', true).single();
    if (error) throw error;
    return data;
}

export async function fetchRegionalWeather(turn = null) {
    let query = supabaseClient.from('regional_weather').select('*').order('region');
    if (turn !== null && turn !== undefined) query = query.eq('turn', Number(turn));
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
}

export async function advanceGameTurn() {
    const { data, error } = await supabaseClient.rpc('advance_game_turn');
    if (error) throw error;
    return Array.isArray(data) ? data[0] : data;
}

export async function fetchMilitaryBattles() {
    const { data, error } = await supabaseClient.from('military_battles').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
}

export async function fetchMilitaryBattleDetails(battleId) {
    const [battleResult, armiesResult, reportsResult, adminResult] = await Promise.all([
        supabaseClient.from('military_battles').select('*').eq('id', battleId).single(),
        supabaseClient.from('military_battle_armies').select('*').eq('battle_id', battleId).order('side').order('updated_at'),
        supabaseClient.from('military_battle_reports').select('*').eq('battle_id', battleId),
        supabaseClient.from('military_battle_admin_results').select('report').eq('battle_id', battleId).maybeSingle()
    ]);
    if (battleResult.error) throw battleResult.error;
    if (armiesResult.error) throw armiesResult.error;
    if (reportsResult.error) throw reportsResult.error;
    if (adminResult.error) throw adminResult.error;
    return { battle: battleResult.data, armies: armiesResult.data || [], reports: reportsResult.data || [], adminReport: adminResult.data?.report || null };
}

export async function createMilitaryBattle(battle, armies) {
    const { data, error } = await supabaseClient.rpc('create_military_battle', { p_battle: battle, p_armies: armies });
    if (error) throw error;
    return data;
}

export async function saveMilitaryBattleDecision(armyId, decision) {
    const { data, error } = await supabaseClient.from('military_battle_armies').update(decision).eq('id', armyId).select().single();
    if (error) throw error;
    return data;
}

export async function confirmMilitaryBattle(battleId, expectedVersion, outcome, adminReport, ownerReports) {
    const { data, error } = await supabaseClient.rpc('confirm_military_battle', {
        p_battle_id: battleId,
        p_expected_version: expectedVersion,
        p_outcome: outcome,
        p_admin_report: adminReport,
        p_owner_reports: ownerReports
    });
    if (error) throw error;
    return data;
}

async function fetchAllRows(tableName, orderColumns, pageSize = 1000) {
    const rows = [];
    for (let from = 0; ; from += pageSize) {
        let query = supabaseClient.from(tableName).select('*');
        for (const column of orderColumns) query = query.order(column, { ascending: true });
        const { data, error } = await query.range(from, from + pageSize - 1);
        if (error) throw error;
        rows.push(...(data || []));
        if (!data || data.length < pageSize) return rows;
    }
}

export async function fetchMilitaryTerrainCells() {
    return fetchAllRows('military_terrain_cells', ['cell_x', 'cell_y']);
}

export async function fetchMilitaryGridCells() {
    return fetchAllRows('military_grid_cells', ['cell_x', 'cell_y']);
}

export async function syncMilitaryGridCells(cells) {
    const { data, error } = await supabaseClient.rpc('sync_military_grid_cells', { p_cells: cells });
    if (error) throw error;
    return Number(data) || 0;
}

export async function setMilitaryWaterType(cellX, cellY, waterTypes) {
    const { data, error } = await supabaseClient.rpc('set_military_water_type', {
        p_cell_x:Number(cellX), p_cell_y:Number(cellY), p_water_types:Number(waterTypes)
    });
    if (error) throw error;
    return data;
}

export async function moveMilitaryForce(forceId, path) {
    const { data, error } = await supabaseClient.rpc('move_military_force', {
        p_force_id: forceId,
        p_path: path
    });
    if (error) throw error;
    return data;
}

export async function settleMilitaryForce(forceId, markerId) {
    const { data, error } = await supabaseClient.rpc('settle_military_force', {
        p_force_id: forceId, p_marker_id: Number(markerId)
    });
    if (error) throw error;
    return data;
}

export async function transferMilitaryTroops(sourceForceId, targetForceId, units, path, merge = false) {
    const { data, error } = await supabaseClient.rpc('transfer_military_troops', {
        p_source_force_id: sourceForceId, p_target_force_id: targetForceId,
        p_units: units, p_path: path, p_merge: !!merge
    });
    if (error) throw error;
    return data;
}

export async function splitMilitaryForce(forceId, units, name, commanderName, commanderAge, cellX, cellY) {
    const { data, error } = await supabaseClient.rpc('split_military_force', {
        p_force_id: forceId, p_units: units, p_name: name, p_commander_name: commanderName,
        p_commander_age: Number(commanderAge), p_cell_x: Number(cellX), p_cell_y: Number(cellY)
    });
    if (error) throw error;
    return data;
}

export async function splitMilitaryForceWithCommander(forceId, units, name, commanderId, cellX, cellY) {
    const { data, error } = await supabaseClient.rpc('split_military_force_with_commander', {
        p_force_id: forceId, p_units: units, p_name: String(name).trim(), p_commander_id: commanderId,
        p_cell_x: Number(cellX), p_cell_y: Number(cellY)
    });
    if (error) throw error;
    return data;
}

export async function setMilitaryConditionalOrderZone(forceId, mode, cells, centerX, centerY, action, route, targetForceId, reservedAp) {
    const { data, error } = await supabaseClient.rpc('set_military_conditional_order_zone', {
        p_force_id: forceId, p_condition_mode: mode, p_condition_cells: cells,
        p_condition_x: Number(centerX), p_condition_y: Number(centerY), p_action: action,
        p_route: route || [], p_target_force_id: targetForceId || null, p_reserved_ap: Number(reservedAp)
    });
    if (error) throw error;
    return data;
}

export async function fetchMilitaryConditionalOrders() {
    const { data, error } = await supabaseClient.from('military_conditional_orders').select('*');
    if (error) throw error;
    return data || [];
}

export async function setMilitaryConditionalOrder(forceId, conditionX, conditionY, action, route, targetForceId, reservedAp) {
    const { data, error } = await supabaseClient.rpc('set_military_conditional_order', {
        p_force_id:forceId, p_condition_x:Number(conditionX), p_condition_y:Number(conditionY), p_action:action,
        p_route:route || [], p_target_force_id:targetForceId || null, p_reserved_ap:Number(reservedAp)
    });
    if (error) throw error;
    return data;
}

export async function cancelMilitaryConditionalOrder(forceId) {
    const { data, error } = await supabaseClient.rpc('cancel_military_conditional_order', { p_force_id:forceId });
    if (error) throw error;
    return data;
}

export async function fetchMilitarySpyRecords() {
    const [spies, networks, orders, intel, alerts, effects] = await Promise.all([
        supabaseClient.from('military_spies').select('*').order('created_at'),
        supabaseClient.from('military_spy_networks').select('*').order('created_turn'),
        supabaseClient.from('military_spy_orders').select('*').order('created_at', { ascending: false }).limit(100),
        supabaseClient.from('military_spy_intel').select('*').order('created_at', { ascending: false }).limit(100),
        supabaseClient.from('military_spy_alerts').select('*').order('created_at', { ascending: false }).limit(100),
        supabaseClient.rpc('get_military_spy_sabotage_effects')
    ]);
    for (const result of [spies, networks, orders, intel, alerts, effects]) if (result.error) throw result.error;
    return { spies:spies.data || [], networks:networks.data || [], orders:orders.data || [], intel:intel.data || [], alerts:alerts.data || [], sabotageEffects:effects.data || [] };
}

export async function fetchDiplomacyData() {
    const [relations, proposals] = await Promise.all([
        supabaseClient.from('state_diplomatic_relations').select('*'),
        supabaseClient.from('state_diplomatic_proposals').select('*').order('created_at', { ascending: false })
    ]);
    if (relations.error) throw relations.error;
    if (proposals.error) throw proposals.error;
    return { relations: relations.data || [], proposals: proposals.data || [] };
}

export async function createDiplomacyProposal(targetOwner, action) {
    const { data, error } = await supabaseClient.rpc('create_diplomacy_proposal', { p_target_owner: targetOwner, p_action: action });
    if (error) throw error;
    return data;
}

export async function decideDiplomacyProposal(proposalId, approve) {
    const { data, error } = await supabaseClient.rpc('decide_diplomacy_proposal', { p_proposal_id: proposalId, p_approve: !!approve });
    if (error) throw error;
    return data;
}

export async function fetchDynasticMarriageProposals() {
    const { data, error } = await supabaseClient.from('state_dynastic_marriage_proposals').select('*').order('created_at', { ascending:false });
    if (error) throw error;
    return data || [];
}

export async function createDynasticMarriageProposal(targetOwner, heirsOwner, childId) {
    const { data, error } = await supabaseClient.rpc('create_dynastic_marriage_proposal', { p_target_owner:targetOwner, p_heirs_owner:heirsOwner, p_child_id:String(childId) });
    if (error) throw error;
    return data;
}

export async function decideDynasticMarriageProposal(proposalId, approve, targetChildId = null) {
    const { data, error } = await supabaseClient.rpc('decide_dynastic_marriage_proposal', { p_proposal_id:proposalId, p_approve:!!approve, p_target_child_id:targetChildId ? String(targetChildId) : null });
    if (error) throw error;
    return data;
}

export async function fetchStateGovernance(owner) {
    const { data, error } = await supabaseClient.rpc('open_state_governance', { p_owner:owner });
    if (error) throw error;
    return data || {};
}

export async function electStateRuler(candidateId) {
    const { data, error } = await supabaseClient.rpc('elect_state_ruler', { p_candidate_id:String(candidateId) });
    if (error) throw error;
    return data;
}

export async function findLocalRulerSpouse() {
    const { data, error } = await supabaseClient.rpc('find_local_ruler_spouse');
    if (error) throw error;
    return data;
}

export async function hireMilitarySpy() {
    const { data, error } = await supabaseClient.rpc('hire_military_spy');
    if (error) throw error;
    return data;
}

export async function assignMilitarySpyNetwork(spyId, targetOwner) {
    const { data, error } = await supabaseClient.rpc('assign_military_spy_network', { p_spy_id:spyId, p_target_owner:targetOwner });
    if (error) throw error;
    return data;
}

export async function setMilitarySpyCounterintelligence(spyId, enabled) {
    const { data, error } = await supabaseClient.rpc('set_military_spy_counterintelligence', { p_spy_id:spyId, p_enabled:!!enabled });
    if (error) throw error;
    return data;
}

export async function queueMilitarySpyOperation(spyId, operation, markerId = null, provinceId = null, itemName = null) {
    const { data, error } = await supabaseClient.rpc('queue_military_spy_operation', {
        p_spy_id:spyId, p_operation:operation, p_marker_id:markerId ? Number(markerId) : null,
        p_province_id:provinceId ? Number(provinceId) : null, p_item_name:itemName || null
    });
    if (error) throw error;
    return data;
}

export async function dismissMilitarySpy(spyId) {
    const { data, error } = await supabaseClient.rpc('dismiss_military_spy', { p_spy_id:spyId });
    if (error) throw error;
    return data;
}

export async function setStateRulerHeir(name, age) {
    const { data, error } = await supabaseClient.rpc('set_state_ruler_heir', { p_name: name, p_age: Number(age) });
    if (error) throw error;
    return data;
}

export async function proposeStateRuler(name, title, age) {
    const { data, error } = await supabaseClient.rpc('propose_state_ruler', { p_name: name, p_title: title, p_age: Number(age) });
    if (error) throw error;
    return data;
}

export async function resolveStateRulerProposal(owner, approve) {
    const { data, error } = await supabaseClient.rpc('resolve_state_ruler_proposal', { p_owner: owner, p_approve: Boolean(approve) });
    if (error) throw error;
    return data;
}

export async function startMilitaryBattle(attackerForceId, defenderForceId) {
    const { data, error } = await supabaseClient.rpc('start_military_battle', {
        p_attacker_force_id: attackerForceId,
        p_defender_force_id: defenderForceId
    });
    if (error) throw error;
    return data;
}

export async function fetchMilitaryColonizationMap() {
    const { data, error } = await supabaseClient.from('military_active_colonization_map').select('*');
    if (error) throw error;
    return data || [];
}

export async function fetchMilitaryStructures() {
    const { data, error } = await supabaseClient.from('military_structures').select('*').order('available_from_turn').order('id');
    if (error) throw error;
    return data || [];
}

export async function buildMilitaryStructure(type, cellX, cellY, sourceMarkerId) {
    const { data, error } = await supabaseClient.rpc('build_military_structure', {
        p_type: type, p_cell_x: cellX, p_cell_y: cellY, p_source_marker_id: sourceMarkerId
    });
    if (error) throw error;
    return data;
}

export async function adminBuildMilitaryStructure(type, cellX, cellY, owner) {
    const { data, error } = await supabaseClient.rpc('admin_build_military_structure', {
        p_type: type, p_cell_x: Number(cellX), p_cell_y: Number(cellY), p_owner: owner
    });
    if (error) throw error;
    return data;
}

export async function destroyMilitaryStructure(structureId) {
    const { data, error } = await supabaseClient.rpc('destroy_military_structure', { p_structure_id: structureId });
    if (error) throw error;
    return data;
}

export async function adminBuildMilitaryPort(markerId, portType, owner) {
    const { data, error } = await supabaseClient.rpc('admin_build_military_port', {
        p_marker_id: Number(markerId), p_port_type: portType, p_owner: owner
    });
    if (error) throw error;
    return data;
}

export async function attemptReligiousMission(targetType, targetId) {
    const { data, error } = await supabaseClient.rpc('attempt_religious_mission', {
        p_target_type: targetType, p_target_id: Number(targetId)
    });
    if (error) throw error;
    return data;
}

export async function fetchReligiousMissionEvents() {
    const { data, error } = await supabaseClient.rpc('get_religious_mission_events');
    if (error) throw error;
    return Array.isArray(data) ? data : [];
}

export async function recruitPermanentGarrison(markerId, unitType, count) {
    const { data, error } = await supabaseClient.rpc('recruit_permanent_garrison', {
        p_marker_id: Number(markerId), p_unit_type: unitType, p_count: Number(count)
    });
    if (error) throw error;
    return data;
}

export async function fetchMilitarySieges() {
    const { data, error } = await supabaseClient.rpc('get_military_sieges');
    if (error) throw error;
    return Array.isArray(data) ? data : [];
}

export async function fetchMilitaryRaids() {
    const { data, error } = await supabaseClient.from('military_raids').select('*, military_raid_loot(item_type,item_name,quantity)').order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    return data || [];
}

export async function startMilitaryRaid(forceId) {
    const { data, error } = await supabaseClient.rpc('start_military_raid', { p_force_id: forceId });
    if (error) throw error;
    return data;
}

export async function fetchMilitaryColonizationMissions() {
    const { data, error } = await supabaseClient.from('military_colonization_missions').select('*').order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    return data || [];
}

export async function startMilitaryColonization(sourceMarkerId, targetProvinceId, extraInvestment = 0, forceId = null) {
    const { data, error } = await supabaseClient.rpc('start_military_land_colonization_with_escort', {
        p_source_marker_id: sourceMarkerId,
        p_target_province_id: targetProvinceId,
        p_extra_investment: extraInvestment,
        p_force_id: forceId || null
    });
    if (error) throw error;
    return data;
}

export async function startMilitarySeaColonization(sourceMarkerId, targetProvinceId, fleetId, extraInvestment = 0, forceId = null) {
    const { data, error } = await supabaseClient.rpc('start_military_sea_colonization_with_escort', {
        p_source_marker_id: sourceMarkerId,
        p_target_province_id: targetProvinceId,
        p_fleet_id: fleetId,
        p_extra_investment: extraInvestment,
        p_force_id: forceId || null
    });
    if (error) throw error;
    return data;
}

export async function cancelMilitaryColonization(missionId) {
    const { data, error } = await supabaseClient.rpc('cancel_military_colonization', { p_mission_id: missionId });
    if (error) throw error;
    return data;
}

export async function startMilitarySiege(forceId, markerId) {
    const { data, error } = await supabaseClient.rpc('start_military_siege', {
        p_force_id: forceId,
        p_marker_id: markerId
    });
    if (error) throw error;
    return data;
}

export async function setMilitarySiegeOrder(siegeId, action, { forceId = null, workMethod = 'bombardment', assaultRoute = 'ladders' } = {}) {
    const { data, error } = await supabaseClient.rpc('set_military_siege_order', {
        p_siege_id: siegeId,
        p_action: action,
        p_force_id: forceId,
        p_work_method: workMethod,
        p_assault_route: assaultRoute
    });
    if (error) throw error;
    return data;
}

export async function saveMilitaryTerrainCell(cell) {
    const { error } = await supabaseClient.rpc('set_military_terrain_cell', {
        p_cell_x: cell.cell_x,
        p_cell_y: cell.cell_y,
        p_province_id: cell.province_id,
        p_terrain: cell.terrain,
        p_bridge: !!cell.bridge
    });
    if (error) throw error;
}

export async function fetchMilitaryForces() {
    const { data, error } = await supabaseClient.rpc('get_visible_military_forces');
    if (error) throw error;
    state.militaryVisibleCells = new Set((data?.visible_cells || []).map(cell => `${Number(cell.x)},${Number(cell.y)}`));
    const { data: embarked, error: embarkedError } = await supabaseClient.from('military_forces').select('*').eq('status', 'embarked');
    if (embarkedError) throw embarkedError;
    const visibleForces = data?.forces || [];
    const seen = new Set(visibleForces.map(force => force.id));
    return [...visibleForces, ...(embarked || []).filter(force => !seen.has(force.id))];
}

export async function fetchMilitaryCommanders() {
    const { data, error } = await supabaseClient.from('military_commanders').select('*').order('owner').order('name');
    if (error) throw error;
    return data || [];
}

export async function hireMilitaryCommander() {
    const { data, error } = await supabaseClient.rpc('hire_military_commander');
    if (error) throw error;
    return data;
}

export async function assignMilitaryCommander(commanderId, forceId) {
    const { data, error } = await supabaseClient.rpc('assign_military_commander', { p_commander_id:commanderId, p_force_id:forceId });
    if (error) throw error;
    return data;
}

export async function embarkMilitaryForce(forceId, fleetId, shipIndex) {
    const { data, error } = await supabaseClient.rpc('embark_military_force', {
        p_force_id: forceId, p_fleet_id: fleetId, p_ship_index: Number(shipIndex)
    });
    if (error) throw error;
    return data;
}

export async function disembarkMilitaryForce(forceId, fleetId, cellX, cellY) {
    const { data, error } = await supabaseClient.rpc('disembark_military_force', {
        p_force_id: forceId, p_fleet_id: fleetId, p_cell_x: Number(cellX), p_cell_y: Number(cellY)
    });
    if (error) throw error;
    return data;
}

export async function saveMilitaryForce(force) {
    const { data, error } = await supabaseClient.rpc('save_military_force', { p_force: force });
    if (error) throw error;
    return data;
}

export async function fetchMilitaryFleets() {
    const { data, error } = await supabaseClient.rpc('get_visible_military_fleets');
    if (error) throw error;
    return data || [];
}

export async function fetchMilitaryPrisoners() {
    const { data, error } = await supabaseClient.from('military_prisoners').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
}

export async function startMilitaryNavalBattle(attackerFleetId, defenderFleetId) {
    const { data, error } = await supabaseClient.rpc('start_military_naval_battle', {
        p_attacker_fleet_id:attackerFleetId,
        p_defender_fleet_id:defenderFleetId
    });
    if (error) throw error;
    return data;
}

export async function saveMilitaryFleets(fleets) {
    const { error } = await supabaseClient.rpc('save_military_fleets', { p_fleets: fleets });
    if (error) throw error;
}

export async function fetchMilitaryPorts() {
    const { data, error } = await supabaseClient.from('military_ports').select('*').order('available_from_turn').order('id');
    if (error) throw error;
    return data || [];
}

export async function buildMilitaryPort(markerId, portType, sourceMarkerId) {
    const { data, error } = await supabaseClient.rpc('build_military_port', {
        p_marker_id: markerId,
        p_port_type: portType,
        p_source_marker_id: sourceMarkerId
    });
    if (error) throw error;
    return data;
}

export async function startMilitaryShipBuild(values) {
    const { data, error } = await supabaseClient.rpc('start_military_ship_build_with_commander', {
        p_port_marker_id: values.portMarkerId,
        p_source_marker_id: values.sourceMarkerId,
        p_ship_type: values.shipType,
        p_fleet_name: values.fleetName || null,
        p_commander_id: values.commanderId || null,
        p_fleet_id: values.fleetId || null
    });
    if (error) throw error;
    return data;
}

export async function adminCreateMilitaryFleet(values) {
    const { data, error } = await supabaseClient.rpc('admin_create_military_fleet', {
        p_owner: values.owner,
        p_name: values.name,
        p_port_marker_id: Number(values.portMarkerId),
        p_commander_id: values.commanderId,
        p_ships: values.ships
    });
    if (error) throw error;
    return data;
}

export async function fetchMilitaryShipBuildOrders() {
    const { data, error } = await supabaseClient.from('military_ship_build_orders').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
}

export async function dockMilitaryFleet(fleetId, markerId) {
    const { data, error } = await supabaseClient.rpc('dock_military_fleet', { p_fleet_id: fleetId, p_marker_id: markerId });
    if (error) throw error;
    return data;
}

export async function launchMilitaryFleet(fleetId, cellX, cellY) {
    const { data, error } = await supabaseClient.rpc('launch_military_fleet', { p_fleet_id: fleetId, p_cell_x: cellX, p_cell_y: cellY });
    if (error) throw error;
    return data;
}

export async function moveMilitaryFleet(fleetId, path) {
    const { data, error } = await supabaseClient.rpc('move_military_fleet', { p_fleet_id: fleetId, p_path: path });
    if (error) throw error;
    return data;
}

export async function transferMilitaryFleetCargo(fleetId, shipIndex, itemType, itemName, quantity, unload = false) {
    const { data, error } = await supabaseClient.rpc('transfer_military_fleet_cargo', {
        p_fleet_id:fleetId, p_ship_index:Number(shipIndex), p_item_type:itemType,
        p_item_name:itemName, p_quantity:Number(quantity), p_unload:Boolean(unload)
    });
    if (error) throw error;
    return data;
}

export async function trainMilitaryCommander(forceId, skill) {
    const { data, error } = await supabaseClient.rpc('train_military_commander', {
        p_force_id: forceId,
        p_skill: skill
    });
    if (error) throw error;
    return data;
}

export async function trainMilitaryFleetCommander(fleetId, skill) {
    const { data, error } = await supabaseClient.rpc('train_military_fleet_commander', {
        p_fleet_id: fleetId,
        p_skill: skill
    });
    if (error) throw error;
    return data;
}

export async function fetchMilitaryMercenaryOffers() {
    const { data, error } = await supabaseClient.from('military_mercenary_market').select('*').order('marker_id').order('slot');
    if (error) throw error;
    return data || [];
}

export async function hireMilitaryMercenary(offerId) {
    const { data, error } = await supabaseClient.rpc('hire_military_mercenary', { p_offer_id: offerId });
    if (error) throw error;
    return data;
}

export async function hireMilitaryMercenaryCamp(forceId) {
    const { data, error } = await supabaseClient.rpc('hire_military_mercenary_camp', { p_force_id: forceId });
    if (error) throw error;
    return data;
}

export async function renewMilitaryMercenaryContract(forceId) {
    const { data, error } = await supabaseClient.rpc('renew_military_mercenary_contract', { p_force_id: forceId });
    if (error) throw error;
    return data;
}

export async function fetchMilitaryLevyOrders() {
    const { data, error } = await supabaseClient.from('military_levy_orders').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
}

export async function placeMilitaryLevyOrder(provinceId) {
    const { data, error } = await supabaseClient.rpc('place_military_levy_order', {
        p_province_id: provinceId
    });
    if (error) throw error;
    return data;
}

export async function fetchMilitaryRetinueOrders() {
    const { data, error } = await supabaseClient.from('military_retinue_orders').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
}

export async function placeMilitaryRetinueOrder(values) {
    const { data, error } = await supabaseClient.rpc('place_military_retinue_order', {
        p_marker_id: values.markerId,
        p_unit_type: values.unitType,
        p_unit_count: values.unitCount
    });
    if (error) throw error;
    return data;
}

export async function mobilizeMilitaryGarrison(values) {
    const { data, error } = await supabaseClient.rpc('mobilize_military_garrison', {
        p_force_id: values.forceId,
        p_name: values.name,
        p_commander_name: values.commanderName,
        p_commander_age: values.commanderAge,
        p_province_id: values.provinceId,
        p_cell_x: values.cellX,
        p_cell_y: values.cellY
    });
    if (error) throw error;
    return data;
}

export async function extendMilitaryMilitiaService(forceId) {
    const { data, error } = await supabaseClient.rpc('extend_military_militia_service', { p_force_id: forceId });
    if (error) throw error;
    return data;
}

export async function fetchEconomySnapshot() {
    const [{ data: sessionData }, calendar] = await Promise.all([
        supabaseClient.auth.getSession(),
        fetchGameCalendar()
    ]);
    const queries = [
        supabaseClient.from('Provinces').select('*'),
        supabaseClient.from('markers').select('*'),
        supabaseClient.from('marker_inventories').select('*'),
        supabaseClient.from('estate_consumption_rates').select('*'),
        supabaseClient.from('settlement_estate_ratios').select('*'),
        supabaseClient.from('state_mechanics').select('owner,settings'),
        supabaseClient.from('marker_transport_routes').select('*'),
        // The UI needs only the recent four reports per state for growth trends,
        // plus the newest detailed report; fetching the full history grows every turn.
        supabaseClient.from('turn_economy_reports').select('owner,year,season,turn,report').order('year', { ascending: false }).order('turn', { ascending: false }).limit(200),
        supabaseClient.from('state_trade_contracts').select('*'),
        supabaseClient.from('state_trade_transit_rules').select('*'),
        supabaseClient.from('territory_rebellions').select('*')
    ];
    const names = ['provinces', 'markers', 'inventories', 'consumptionRates', 'estateRatios', 'mechanics', 'transportRoutes', 'reports', 'tradeContracts', 'tradeTransitRules', 'rebellions'];
    if (sessionData?.session) {
        queries.push(supabaseClient.from('state_modifiers').select('*'));
        names.push('modifiers');
        queries.push(
            supabaseClient.from('military_forces').select('*').in('status', ['active','embarked']),
            supabaseClient.from('military_structures').select('*'),
            supabaseClient.from('military_fleets').select('*').eq('status', 'active'),
            supabaseClient.from('military_ports').select('*'),
            supabaseClient.from('military_epidemic_events').select('*')
        );
        names.push('militaryForces','militaryStructures','militaryFleets','militaryPorts','militaryEpidemicEvents');
        queries.push(supabaseClient.rpc('get_military_spy_sabotage_effects'));
        names.push('militarySpySabotageEffects');
    }
    const results = await Promise.all(queries);
    const result = {};
    results.forEach((query, index) => {
        if (query.error) throw query.error;
        result[names[index]] = query.data || [];
    });
    result.calendar = calendar;
    return result;
}

export async function setMilitaryEpidemicEvent(provinceId, enabled) {
    const { data, error } = await supabaseClient.rpc('set_military_epidemic_event', {
        p_province_id:Number(provinceId), p_enabled:!!enabled
    });
    if (error) throw error;
    return data;
}

export async function fetchMilitaryEpidemicEvents() {
    const { data, error } = await supabaseClient.from('military_epidemic_events').select('*');
    if (error) throw error;
    return data || [];
}

export async function saveMarkerTransportRoute(sourceMarkerId, destinationMarkerId, itemType, itemName, quantityPerTurn) {
    const { data, error } = await supabaseClient.rpc('save_marker_transport_route', {
        p_source_marker_id: sourceMarkerId,
        p_destination_marker_id: destinationMarkerId,
        p_item_type: itemType,
        p_item_name: itemName,
        p_quantity_per_turn: quantityPerTurn
    });
    if (error) throw error;
    return data;
}

export async function saveStateTradeContract(action, values = {}) {
    const { data, error } = await supabaseClient.rpc('save_state_trade_contract', {
        p_action: action,
        p_contract_id: values.contractId ?? null,
        p_source_marker_id: values.sourceMarkerId ?? null,
        p_destination_marker_id: values.destinationMarkerId ?? null,
        p_item_type: values.itemType ?? null,
        p_item_name: values.itemName ?? null,
        p_quantity_per_turn: values.quantityPerTurn ?? null,
        p_unit_price: values.unitPrice ?? null
    });
    if (error) throw error;
    return data;
}

export async function saveStateTradeContractRoute(contractId, provinceIds = null) {
    const { data, error } = await supabaseClient.rpc('save_state_trade_contract_route', {
        p_contract_id: contractId,
        p_route_province_ids: provinceIds
    });
    if (error) throw error;
    return data;
}

export async function saveStateTradeTransitPolicy(action, values = {}) {
    const { data, error } = await supabaseClient.rpc('set_state_trade_transit_policy', {
        p_contract_id: values.contractId,
        p_transit_owner: values.transitOwner,
        p_action: action,
        p_toll_rate: values.tollRate ?? null,
        p_blocked: values.blocked ?? null
    });
    if (error) throw error;
    return data;
}

export async function applyEconomyTurn(payload) {
    const { data, error } = await supabaseClient.rpc('apply_economy_turn', { p_payload: payload });
    if (error) throw error;
    return data;
}

export async function saveTerritoryRebellions(rows) {
    const { data, error } = await supabaseClient.rpc('save_territory_rebellions', { p_rows: rows });
    if (error) throw error;
    return data;
}

export async function saveProductionOrders(markerId, orders) {
    const { data, error } = await supabaseClient.rpc('save_production_orders', {
        p_marker_id: markerId,
        p_orders: orders
    });
    if (error) throw error;
    return data;
}

export async function uploadStateSymbol(owner, file) {
    const ownerKey = Array.from(new TextEncoder().encode(owner), byte => byte.toString(16).padStart(2, '0')).join('');
    const path = `${ownerKey}/symbol`;
    const { error } = await supabaseClient.storage.from('state-symbols').upload(path, file, {
        upsert: true,
        contentType: file.type,
        cacheControl: '3600'
    });
    if (error) throw error;
    const { data } = supabaseClient.storage.from('state-symbols').getPublicUrl(path);
    return { path, url: `${data.publicUrl}?v=${Date.now()}` };
}

export async function deleteStateSymbol(path) {
    const { error } = await supabaseClient.storage.from('state-symbols').remove([path]);
    if (error) throw error;
}

export async function updateProvinceData(id, fields) {
    const { data, error } = await supabaseClient
        .from('Provinces')
        .update(fields)
        .eq('id', id)
        .select();

    if (error) throw error;
    return data;
}

export async function renameOwnedProvince(id, provinceName) {
    const { data, error } = await supabaseClient.rpc('rename_owned_province', {
        p_province_id: id,
        p_province_name: provinceName
    });
    if (error) throw error;
    return data;
}

export async function createMarkerData(markerData) {
    const { data, error } = await supabaseClient
        .from('markers')
        .insert([markerData])
        .select();

    if (error) throw error;
    return data;
}

export async function updateMarkerData(id, fields) {
    const { data, error } = await supabaseClient
        .from('markers')
        .update(fields)
        .eq('id', id)
        .select();

    if (error) throw error;
    return data;
}

export async function deleteMarkerData(id) {
    const { error } = await supabaseClient
        .from('markers')
        .delete()
        .eq('id', id);

    if (error) throw error;
}
