import { supabaseClient, state } from './config.js';

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

export async function fetchStateMechanics(owner) {
    const { data, error } = await supabaseClient.from('state_mechanics').select('settings').eq('owner', owner).maybeSingle();
    if (error) throw error;
    return data?.settings || null;
}

export async function saveStateMechanics(owner, settings) {
    const { data, error } = await supabaseClient.from('state_mechanics').upsert({ owner, settings, updated_at: new Date().toISOString() }, { onConflict: 'owner' }).select('settings').single();
    if (error) throw error;
    return data.settings;
}

export async function fetchGameCalendar() {
    const { data, error } = await supabaseClient.from('game_calendar').select('turn, season, year').eq('singleton', true).single();
    if (error) throw error;
    return data;
}

export async function advanceGameTurn() {
    const { data, error } = await supabaseClient.rpc('advance_game_turn');
    if (error) throw error;
    return Array.isArray(data) ? data[0] : data;
}

export async function fetchEconomySnapshot() {
    const queries = await Promise.all([
        supabaseClient.from('Provinces').select('*'),
        supabaseClient.from('markers').select('*'),
        supabaseClient.from('marker_inventories').select('*'),
        supabaseClient.from('estate_consumption_rates').select('*'),
        supabaseClient.from('settlement_estate_ratios').select('*'),
        supabaseClient.from('state_mechanics').select('owner,settings'),
        supabaseClient.from('marker_transport_routes').select('*'),
        supabaseClient.from('turn_economy_reports').select('*').order('year', { ascending: false }).order('turn', { ascending: false }),
        supabaseClient.from('state_trade_contracts').select('*'),
        supabaseClient.from('state_trade_transit_rules').select('*')
    ]);
    const names = ['provinces', 'markers', 'inventories', 'consumptionRates', 'estateRatios', 'mechanics', 'transportRoutes', 'reports', 'tradeContracts', 'tradeTransitRules'];
    const result = {};
    queries.forEach((query, index) => {
        if (query.error) throw query.error;
        result[names[index]] = query.data || [];
    });
    result.calendar = await fetchGameCalendar();
    return result;
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

export async function saveProductionDirective(markerId, directive, orderGood, orderQuantity) {
    const { data, error } = await supabaseClient.rpc('save_production_directive', {
        p_marker_id: markerId,
        p_directive: directive,
        p_order_good: orderGood || null,
        p_order_qty: orderQuantity
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
