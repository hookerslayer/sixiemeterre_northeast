import { supabaseClient, state } from './config.js';

export async function loadSupabaseData() {
    const [resProvinces, resRegions, resOwners, resMarkers, resCultures, resReligions] = await Promise.all([
        supabaseClient.from('Provinces').select('*'),
        supabaseClient.from('region_color').select('*'),
        supabaseClient.from('owner_color').select('*'),
        supabaseClient.from('markers').select('*'),
        supabaseClient.from('culture_color').select('*'),
        supabaseClient.from('religion_color').select('*')
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
}

export async function signUpUser(email, password, nickname) {
    const { data, error } = await supabaseClient.auth.signUp({
        email,
        password,
        options: {
            data: { nickname }
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
