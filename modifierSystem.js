const RESOURCES = ['Зерно', 'Древесина', 'Железная руда', 'Скот', 'Камень', 'Соль', 'Пушнина', 'Бивни', 'Ворвань', 'Самоцветы', 'Мёд и Воск', 'Лён', 'Морепродукты'];
const GOODS = ['Топливо', 'Сукно и Одежда', 'Инструменты', 'Оружие и Доспехи', 'Обработанный камень', 'Оловина', 'Бумага'];

export const MODIFIER_EFFECTS = [
    { key: 'estate_loyalty_pp', label: 'Лояльность сословия', unit: 'п.п.', scopes: ['estate'] },
    { key: 'culture_loyalty_pp', label: 'Лояльность культуры', unit: 'п.п.', scopes: ['culture'] },
    { key: 'religion_loyalty_pp', label: 'Лояльность религии', unit: 'п.п.', scopes: ['religion'] },
    { key: 'crime_rate_pp', label: 'Преступность', unit: 'п.п.', scopes: ['state'] },
    { key: 'corruption_rate_pp', label: 'Коррупция', unit: 'п.п.', scopes: ['state'] },
    { key: 'tax_income_pct', label: 'Итоговые налоговые поступления', unit: '%', scopes: ['state'] },
    { key: 'internal_trade_income_pct', label: 'Доход от внутренней торговли', unit: '%', scopes: ['state'] },
    { key: 'resource_production_pct', label: 'Производство ресурса', unit: '%', scopes: ['state','culture','religion','resource','province'], targets: ['province'] },
    { key: 'good_production_pct', label: 'Производство товара', unit: '%', scopes: ['state','culture','religion','good','marker'], targets: ['city','large_city','monastery'] },
    { key: 'guild_capacity_pct', label: 'Мощность ремесленного производства', unit: '%', scopes: ['state','culture','religion','marker'], targets: ['city','large_city'] },
    { key: 'consumption_pct', label: 'Потребление категории потребностей', unit: '%', scopes: ['state','need','culture','religion','province','marker'], targets: ['province','city','large_city','monastery','fortress'] },
    { key: 'spoilage_pct', label: 'Порча запасов', unit: '%', scopes: ['state','resource','good','marker'], targets: ['city','large_city','monastery','fortress'] },
    { key: 'storage_capacity_pct', label: 'Вместимость складов', unit: '%', scopes: ['state','marker'], targets: ['city','large_city','monastery','fortress'] },
    { key: 'population_growth_pct', label: 'Годовой рост дворов', unit: '%', scopes: ['state'] },
    { key: 'treasury_income_z', label: 'Постоянный доход казны', unit: 'z/ход', scopes: ['state'] },
    { key: 'treasury_expense_z', label: 'Постоянный расход казны', unit: 'z/ход', scopes: ['state'] },
    { key: 'prestige_income_op', label: 'Постоянный доход престижа', unit: 'ОП/ход', scopes: ['state'] },
    { key: 'prestige_expense_op', label: 'Постоянный расход престижа', unit: 'ОП/ход', scopes: ['state'] },
    { key: 'military_upkeep_pct', label: 'Содержание войск', unit: '%', scopes: ['state','army'], targets: ['army','fleet'] },
    { key: 'supply_consumption_pct', label: 'Потребление армейского снабжения', unit: '%', scopes: ['state','army'], targets: ['army','fleet'] },
    { key: 'supply_capacity_pct', label: 'Пропускная способность снабжения', unit: '%', scopes: ['state','army'], targets: ['army'] },
    { key: 'morale_change_pp', label: 'Изменение морали войск', unit: 'п.п.', scopes: ['state','army'], targets: ['army','fleet'] },
    { key: 'military_recruitment_cost_pct', label: 'Стоимость сбора войск', unit: '%', scopes: ['state'] },
    { key: 'colonization_cost_pct', label: 'Стоимость колонизации', unit: '%', scopes: ['state'] },
    { key: 'spy_network_growth_pct', label: 'Рост шпионской сети', unit: '%', scopes: ['state'] },
    { key: 'spy_operation_success_pp', label: 'Шанс успеха шпионской операции', unit: 'п.п.', scopes: ['state'] },
    { key: 'spy_exposure_chance_pp', label: 'Риск раскрытия чужих шпионов', unit: 'п.п.', scopes: ['state'] },
    { key: 'counterintelligence_success_pp', label: 'Успешность контршпионажа', unit: 'п.п.', scopes: ['state'] },
    { key: 'assimilation_duration_pct', label: 'Срок ассимиляции', unit: '%', scopes: ['state','province','marker'] },
    { key: 'battle_strength_pct', label: 'Боеспособность армии', unit: '%', scopes: ['state','army'], targets: ['army','fleet'] },
    { key: 'siege_work_gain_pct', label: 'Скорость осадных работ', unit: '%', scopes: ['state','army'], targets: ['army'] }
];

export const MODIFIER_SCOPES = [
    ['state','Государство'], ['estate','Сословие'], ['culture','Культура'], ['religion','Религия'],
    ['resource','Ресурс'], ['good','Товар'], ['need','Категория потребностей'], ['province','Провинция'],
    ['marker','Поселение'], ['army','Армия']
];

export const MODIFIER_SCOPE_VALUES = {
    estate: [['aristocracy','Аристократия'],['clergy','Духовенство'],['burghers','Горожане'],['peasants','Крестьянство']],
    need: ['Продовольствие','Топливо','Стройматериалы','Инструменты','Сукно и Одежда','Оловина','Оружие и Доспехи','Бумага','Роскошь'].map(value=>[value,value])
};

const CULTURE_RESOURCE_BONUSES = {
    'Низовцы': ['Зерно'], 'Галичане': ['Зерно'], 'Двиняне': ['Древесина','Морепродукты'],
    'Вятчане': ['Скот'], 'Вотяки': ['Скот'], 'Вогулы': ['Пушнина'], 'Самоеды': ['Скот','Пушнина'],
    'Казанлы': ['Скот'], 'Башкорт': ['Скот'], 'Саамы': ['Скот','Пушнина'], 'Сумь': ['Зерно','Лён'],
    'Емь': ['Зерно','Лён'], 'Эсты': ['Зерно','Лён'], 'Водь': ['Древесина','Пушнина'],
    'Ижора': ['Морепродукты'], 'Псковичи': ['Зерно'], 'Корелы': ['Древесина','Пушнина'],
    'Поморы': ['Морепродукты'], 'Коми': ['Пушнина'], 'Весь': ['Древесина','Пушнина']
};
const CULTURE_RESOURCE_VALUES = { Самоеды:15, Башкорт:15, Поморы:15 };
const CRAFT_CULTURES = new Set(['Новгородцы','Свеи']);
const RELIGIONS = ['Католичество','Православие','Ислам','Язычество'];

function makeStatic(owner, effect_key, value, scope_type='state', scope_value=null, extra={}) {
    return { id:`static:${owner}:${effect_key}:${scope_type}:${scope_value||''}:${extra.item_name||''}:${extra.target_type||''}`,
        owner,effect_key, value, unit:MODIFIER_EFFECTS.find(item=>item.key===effect_key)?.unit||'', scope_type,scope_value,
        target_type:extra.target_type||null,item_name:extra.item_name||null,source:extra.source||'Форма правления, культура или религия',
        source_type:'static',status:'active',starts_turn:1,ends_turn:null,issued_turn:1 };
}

export function buildStaticModifiers(owner, settings={}) {
    const rows=[];
    const form=settings.government_form;
    const add=(effect,value,scope='state',scopeValue=null,extra={})=>rows.push(makeStatic(owner,effect,value,scope,scopeValue,{...extra,source:extra.source||`Форма правления: ${form||'—'}`}));
    if(form==='Феодальная монархия'){
        add('tax_income_pct',10);add('estate_loyalty_pp',5,'estate','aristocracy');
        add('crime_rate_pp',5);add('guild_capacity_pct',-10);add('military_recruitment_cost_pct',-20);add('battle_strength_pct',10,'state',null,{target_type:'army'});
    }
    if(form==='Вечевая республика'){
        add('internal_trade_income_pct',15);add('estate_loyalty_pp',5,'estate','burghers');
        add('corruption_rate_pp',15);add('crime_rate_pp',-5);add('guild_capacity_pct',20);add('storage_capacity_pct',20);
    }
    if(form==='Теократия'){
        add('estate_loyalty_pp',10,'estate','clergy');if(settings.titular_religion)add('religion_loyalty_pp',10,'religion',settings.titular_religion);
        add('tax_income_pct',20);add('corruption_rate_pp',5);add('crime_rate_pp',-15);add('military_upkeep_pct',20);
    }
    if(form==='Вождество'&&settings.titular_culture){
        add('estate_loyalty_pp',10,'estate','peasants');
        for(const item_name of ['Скот','Пушнина'])add('resource_production_pct',15,'culture',settings.titular_culture,{item_name,source:`Форма правления: Вождество`});
    }
    if(form==='Вождество'){
        add('crime_rate_pp',15);add('battle_strength_pct',10,'state',null,{target_type:'army'});add('morale_change_pp',10);
        add('guild_capacity_pct',-10);add('resource_production_pct',15);
    }
    for(const [culture,items] of Object.entries(CULTURE_RESOURCE_BONUSES))for(const item_name of items){
        const value=CULTURE_RESOURCE_VALUES[culture]||10;
        add('resource_production_pct',value,'culture',culture,{item_name,source:`Культура: ${culture}`});
    }
    for(const culture of CRAFT_CULTURES)add('guild_capacity_pct',10,'culture',culture,{target_type:'city',source:`Культура: ${culture}`});
    for(const religion of RELIGIONS)add('religion_loyalty_pp',5,'religion',religion,{source:`Религия: ${religion}`});
    add('guild_capacity_pct',10,'religion','Католичество',{target_type:'city',source:'Религия: Католичество'});
    add('good_production_pct',10,'religion','Православие',{target_type:'monastery',source:'Религия: Православие'});
    if(settings.titular_religion==='Православие')add('battle_strength_pct',10,'state',null,{target_type:'army',source:'Религия: Православие'});
    if(settings.titular_religion==='Ислам')add('internal_trade_income_pct',10,'state',null,{source:'Религия: Ислам'});
    for(const item_name of ['Скот','Пушнина'])add('resource_production_pct',10,'religion','Язычество',{item_name,source:'Религия: Язычество'});
    if(form==='Вечевая республика'&&settings.ruler?.status==='active'){
        for(const effect of settings.ruler.elected_effects||[]){
            if(!MODIFIER_EFFECTS.some(item=>item.key===effect.effect_key))continue;
            rows.push(makeStatic(owner,effect.effect_key,Number(effect.value)||0,effect.scope_type||'state',effect.scope_value||null,{target_type:effect.target_type||null,source:`Посадник: ${settings.ruler.name||'избранный'} (${Number(settings.ruler.term_start_year)||'—'}–${Number(settings.ruler.term_end_year)||'—'})`}));
        }
    }
    return rows;
}

export function getOwnerModifiers(owner, snapshot={}, turn=snapshot.calendar?.turn||1) {
    const settings=snapshot.mechanics?.find(row=>row.owner===owner)?.settings||{};
    const permanent=buildStaticModifiers(owner,settings);
    const records=(snapshot.modifiers||[]).filter(row=>row.owner===owner&&row.status==='active'
        && Number(row.starts_turn||1)<=Number(turn)
        && (row.ends_turn===null||row.ends_turn===undefined||Number(row.ends_turn)>=Number(turn)));
    return [...permanent,...records];
}

export function modifierValue(rows,effectKey,context={}) {
    let permanent=0,temporary=0;
    for(const row of rows||[]){
        if(row.effect_key!==effectKey)continue;
        const scope=row.scope_type||'state';
        if(scope!=='state'&&String(context[scope]??'')!==String(row.scope_value??''))continue;
        if(row.item_name&&String(context.item_name??'')!==String(row.item_name))continue;
        if(row.target_type){
            const allowed=row.target_type==='city'?['city','large_city']:[row.target_type];
            if(!allowed.includes(String(context.territory_type||'')))continue;
        }
        if(row.source_type==='static')permanent+=Number(row.value)||0;
        else temporary+=Number(row.value)||0;
    }
    const staticValue=effectKey.endsWith('_pct')?Math.max(-30,Math.min(30,permanent)):permanent;
    return staticValue+temporary;
}

export function modifierLabel(effectKey) {
    return MODIFIER_EFFECTS.find(effect=>effect.key===effectKey)?.label||effectKey;
}

export function modifierItemOptions() {
    return [...RESOURCES,...GOODS].map(value=>[value,value]);
}
