// Deterministic seasonal production, logistics, storage, conversion and consumption.
// Flax and seafood norms are provisional balancing values based on comparable
// seasonal resources; no additional uses for them are inferred here.
export const RESOURCES = ['Зерно', 'Древесина', 'Железная руда', 'Скот', 'Камень', 'Соль', 'Пушнина', 'Бивни', 'Ворвань', 'Самоцветы', 'Мёд и Воск', 'Лён', 'Морепродукты'];
export const GOODS = ['Топливо', 'Сукно и Одежда', 'Инструменты', 'Оружие и Доспехи', 'Обработанный камень', 'Оловина', 'Бумага'];
export const BASE_MARKET_PRICES = Object.freeze({
  'Зерно':1,'Древесина':1.2,'Железная руда':2.5,'Скот':2,'Камень':.8,'Соль':1.4,'Пушнина':3,'Бивни':5,'Ворвань':2,
  'Самоцветы':8,'Мёд и Воск':1.6,'Лён':1.2,'Морепродукты':1.1,'Топливо':1.5,'Сукно и Одежда':4,'Инструменты':5,
  'Оружие и Доспехи':8,'Обработанный камень':2,'Оловина':3.2,'Бумага':3.5
});
const NORMS = {
  'Зерно':[2,[1,1.2,1.8,.1]], 'Древесина':[1.5,[.8,1,1,1.2]], 'Железная руда':[.5,[.8,1,1,1]],
  'Скот':[1,[1,1.2,1.5,.5]], 'Камень':[.4,[.6,1,1,.8]], 'Соль':[.6,[1,1,1,1]],
  'Пушнина':[.8,[.5,.2,1,1.8]], 'Бивни':[.3,[.5,.2,1,1.5]], 'Ворвань':[.5,[.8,.3,1.2,1.2]],
  'Самоцветы':[.2,[.5,.5,1,1]], 'Мёд и Воск':[.6,[1,1.5,1.5,.2]],
  'Лён':[.8,[.5,1,1.8,.1]], 'Морепродукты':[1,[.8,1.5,1.2,.5]]
};
const SEASONS = { 'Весна':0, 'Лето':1, 'Осень':2, 'Зима':3 };
const PEASANT_FOOD_SEASONS = {
  'Зерно':[.55,1.15,1.7,.6],
  'Скот':[.85,1.05,1.15,.95]
};
const NORTHERN_CATTLE_REGIONS = new Set(['лапландия','югорская земля','мезенская земля','поморье']);
const RECIPES = {
  'Топливо':{alternatives:[[['Древесина',1]],[['Ворвань',.8]]],cost:1,spend:'one'}, 'Сукно и Одежда':{inputs:[['Скот',.5],['Лён',.5]],cost:2},
  'Инструменты':{inputs:[['Железная руда',1],['Древесина',.5]],cost:3}, 'Оружие и Доспехи':{inputs:[['Железная руда',2],['Древесина',1]],cost:5},
  'Обработанный камень':{inputs:[['Камень',1],['Древесина',.5]],cost:2}, 'Оловина':{inputs:[['Зерно',1],['Древесина',.2]],cost:2}, 'Бумага':{inputs:[['Древесина',1],['Мёд и Воск',.2]],cost:3}
};
const NEED_GOODS = [
  {name:'Продовольствие',choices:[['Зерно',1],['Скот',1],['Морепродукты',1],['Мёд и Воск',1]],basket:[['Зерно',.6],['Скот',.2],['Морепродукты',.15],['Мёд и Воск',.05]]},
  {name:'Топливо',choices:[['Топливо',1],['Древесина',1],['Ворвань',1]],basket:[['Топливо',.7],['Древесина',.2],['Ворвань',.1]]},
  {name:'Стройматериалы',choices:[['Древесина',1],['Обработанный камень',1]],basket:[['Древесина',.8],['Обработанный камень',.2]]},
  {name:'Инструменты',choices:[['Инструменты',1]],basket:[['Инструменты',1]]},{name:'Сукно и Одежда',choices:[['Сукно и Одежда',1]],basket:[['Сукно и Одежда',1]]},
  {name:'Оловина',choices:[['Оловина',1]],basket:[['Оловина',1]]},{name:'Оружие и Доспехи',choices:[['Оружие и Доспехи',1]],basket:[['Оружие и Доспехи',1]]},
  {name:'Бумага',choices:[['Бумага',1]],basket:[['Бумага',1]]},{name:'Роскошь',choices:[['Самоцветы',1],['Пушнина',1],['Бивни',1]],basket:[['Самоцветы',.6],['Пушнина',.25],['Бивни',.15]]}
];
const ESTATES=['aristocracy','clergy','burghers','peasants'];
const spoilageRate = name => ['Скот','Ворвань','Оловина','Морепродукты'].includes(name) ? .10 : ['Зерно','Древесина','Пушнина','Мёд и Воск','Сукно и Одежда','Бумага','Лён'].includes(name) ? .03 : 0;
const round = value => Math.round((Number(value)||0)*100)/100;
export function annualPopulationGrowthRate(reports=[], settings={}) {
  const coverage=reports.slice(0,4).map(row=>{
    const value=Number(row?.report?.state_effects?.food_coverage ?? row?.state_effects?.food_coverage);
    return Number.isFinite(value)?Math.max(0,Math.min(1,value)):1;
  });
  const averageFoodCoverage=(coverage.reduce((sum,value)=>sum+value,0)+(4-coverage.length))/4;
  const averageLoyalty=ESTATES.reduce((sum,estate)=>sum+Math.max(0,Math.min(100,Number(settings.estate_loyalty?.[estate]??50))),0)/ESTATES.length;
  return Math.round(.02*averageFoodCoverage*(.75+.5*averageLoyalty/100)*1e6)/1e6;
}
const statusMultiplier = status => status === 'expulsion' ? 0 : status === 'recognition' ? 1 : .8;
function getStatus(settings, kind, name) {
  const titular=settings?.[`titular_${kind}`]; if (!name || name===titular) return 'recognition';
  if(kind==='religion'&&String(name).toLocaleLowerCase('ru')==='язычество'&&settings?.titular_religion==='Ислам')return 'expulsion';
  const stored=settings?.[`${kind}_status`]?.[name];
  return (typeof stored==='object'?stored?.status:stored) || 'noninterference';
}
function invKey(type,name){return `${type}\u0000${name}`;}
function addInv(inv,type,name,amount){if(amount<=0)return; const k=invKey(type,name);inv.set(k,(inv.get(k)||0)+amount);}
function readInv(inv,type,name){return inv.get(invKey(type,name))||0;}
function takeNeed(inv,need,demand,onConsume=()=>{}){
  let covered=0;const choices=new Map(need.choices.map(([name,rate])=>[name,rate]));
  for(const [name,share] of need.basket||[]){const rate=choices.get(name)||1,target=demand*share,type=GOODS.includes(name)?'good':'resource',used=Math.min(readInv(inv,type,name),target/rate);if(used>0){inv.set(invKey(type,name),readInv(inv,type,name)-used);covered+=used*rate;onConsume(name,used);}}
  let remaining=Math.max(0,demand-covered);
  for(const [name,rate] of need.choices){if(remaining<=1e-8)break;const type=GOODS.includes(name)?'good':'resource',used=Math.min(readInv(inv,type,name),remaining/rate);if(used>0){inv.set(invKey(type,name),readInv(inv,type,name)-used);remaining-=used*rate;covered+=used*rate;onConsume(name,used);}}
  return covered;
}
function provinceDestinations(startId, markersByProvince, provincesById, adjacency, owner) {
  const queue=[[startId,0]], seen=new Set([startId]), candidates=[];
  while(queue.length){const [id,distance]=queue.shift(); for(const m of markersByProvince.get(id)||[])if(m.owner===owner&&m.type!=='ruins')candidates.push({marker:m,distance});
    for(const next of adjacency.get(id)||[]){const p=provincesById.get(next);if(!seen.has(next)&&p?.owner===owner){seen.add(next);queue.push([next,distance+1]);}}
  }
  const local=candidates.filter(candidate=>candidate.distance===0), remote=candidates.filter(candidate=>candidate.distance>0);
  const nearestDistance=remote.length?Math.min(...remote.map(candidate=>candidate.distance)):Infinity;
  const nearestRemote=remote.filter(candidate=>candidate.distance===nearestDistance);
  const weightedShares=group=>{
    const weights=group.map(({marker,distance})=>Math.max(1,Number(marker.yards)||0)/(distance===0?1:distance*distance));
    const total=weights.reduce((sum,weight)=>sum+weight,0)||group.length;
    return group.map((candidate,index)=>({...candidate,share:(weights[index]||1)/total}));
  };
  // A province's own settlement group is guaranteed half when a route outward
  // also exists; the other half goes to the nearest reachable settlement group.
  if(local.length&&nearestRemote.length)return [...weightedShares(local).map(item=>({...item,share:item.share*.5})),...weightedShares(nearestRemote).map(item=>({...item,share:item.share*.5}))];
  return weightedShares(local.length?local:nearestRemote);
}
function distributeAmount(amount,destinations) {
  let assigned=0;
  return destinations.map((destination,index)=>{
    const quantity=index===destinations.length-1?round(Math.max(0,amount-assigned)):round(amount*destination.share);
    assigned=round(assigned+quantity);
    return {marker_id:destination.marker.id,share:destination.share,quantity};
  });
}
export function buildProvinceAdjacency(imageData,width,height,meta) {
  const rgbToId=new Map(Object.entries(meta||{}).map(([hex,p])=>[Number.parseInt(hex.slice(1),16),Number(p.id)]));
  const adj=new Map(), data=imageData.data; for(const p of Object.values(meta||{}))adj.set(Number(p.id),new Set());
  const idAt=i=>rgbToId.get((data[i]<<16)|(data[i+1]<<8)|data[i+2]);
  const connect=(a,b)=>{if(a===undefined||b===undefined||a===b)return;adj.get(a)?.add(b);adj.get(b)?.add(a);};
  // Province fills in color_map.png are separated by thin black outline pixels.
  // Scan four raster directions and bridge at most two black pixels; wider gaps
  // (for example, sea) remain impassable.
  const scanLine=(x,y,dx,dy)=>{
    let previousId,blackGap=0;
    while(x>=0&&x<width&&y>=0&&y<height){
      const i=(y*width+x)*4,id=idAt(i);
      if(id!==undefined){connect(previousId,id);previousId=id;blackGap=0;}
      else if(data[i]===0&&data[i+1]===0&&data[i+2]===0&&previousId!==undefined){
        blackGap++;if(blackGap>2){previousId=undefined;blackGap=0;}
      } else {previousId=undefined;blackGap=0;}
      x+=dx;y+=dy;
    }
  };
  for(let y=0;y<height;y++)scanLine(0,y,1,0);
  for(let x=0;x<width;x++)scanLine(x,0,0,1);
  for(let x=0;x<width;x++)scanLine(x,0,1,1);
  for(let y=1;y<height;y++)scanLine(0,y,1,1);
  for(let x=0;x<width;x++)scanLine(x,0,-1,1);
  for(let y=1;y<height;y++)scanLine(width-1,y,-1,1);
  return adj;
}
export function buildProvinceCentroids(imageData,width,height,meta) {
  const rgbToId=new Map(Object.entries(meta||{}).map(([hex,province])=>[Number.parseInt(hex.slice(1),16),Number(province.id)])),totals=new Map(),data=imageData.data;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4,id=rgbToId.get((data[i]<<16)|(data[i+1]<<8)|data[i+2]);if(id===undefined)continue;const item=totals.get(id)||{x:0,y:0,count:0};item.x+=x;item.y+=y;item.count++;totals.set(id,item);}
  return new Map([...totals].map(([id,item])=>[id,{x:item.x/item.count,y:item.y/item.count}]));
}
export function buildWaterMarkerComponents(imageData,width,height,markers,{cellSize=2,attachRadius=20,kind='river',provinceMapImageData=null,provinceMeta={}}={}) {
  const gridWidth=Math.ceil(width/cellSize),gridHeight=Math.ceil(height/cellSize),size=gridWidth*gridHeight;
  const labels=new Int32Array(size),data=imageData.data;
  const waterAt=(x,y)=>{const i=(y*width+x)*4,r=data[i],g=data[i+1],b=data[i+2],a=data[i+3];
    if(a<16)return false;
    // The supplied sea/lake masks use a pale blue fill on black; rivers use
    // the same blue-channel test as before. Ignore black outlines/background.
    return kind==='river' ? b>r+15&&g>r+5&&b>60 : b>r+12&&g>r+8&&b>70;
  };
  for(let gy=0;gy<gridHeight;gy++)for(let gx=0;gx<gridWidth;gx++){
    let water=false;for(let oy=0;oy<cellSize&&!water;oy++)for(let ox=0;ox<cellSize&&!water;ox++){
      const x=gx*cellSize+ox,y=gy*cellSize+oy;if(x<width&&y<height&&waterAt(x,y))water=true;
    }
    if(water)labels[gy*gridWidth+gx]=-1;
  }
  const queue=new Uint32Array(size);let component=0;
  for(let start=0;start<size;start++)if(labels[start]===-1){component++;let head=0,tail=0;labels[start]=component;queue[tail++]=start;
    while(head<tail){const index=queue[head++],x=index%gridWidth,y=(index/gridWidth)|0;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=gridWidth||ny>=gridHeight)continue;const next=ny*gridWidth+nx;if(labels[next]===-1){labels[next]=component;queue[tail++]=next;}}
    }
  }
  const result=new Map(),radiusSquared=attachRadius*attachRadius;
  for(const marker of markers){const cx=Math.round(Number(marker.coord_1)/cellSize),cy=Math.round(Number(marker.coord_2)/cellSize);let bestDistance=radiusSquared+1,bestComponent=0,bestX=0,bestY=0;
    for(let y=Math.max(0,cy-attachRadius);y<=Math.min(gridHeight-1,cy+attachRadius);y++)for(let x=Math.max(0,cx-attachRadius);x<=Math.min(gridWidth-1,cx+attachRadius);x++){
      const distance=(x-cx)*(x-cx)+(y-cy)*(y-cy),id=labels[y*gridWidth+x];if(id>0&&distance<bestDistance){bestDistance=distance;bestComponent=id;bestX=x;bestY=y;}
    }
    if(bestComponent)result.set(Number(marker.id),{component:bestComponent,x:bestX,y:bestY});
  }
  const rgbToProvinceId=new Map(Object.entries(provinceMeta||{}).map(([hex,p])=>[Number.parseInt(hex.slice(1),16),Number(p.id)]));
  const provinceGrid=provinceMapImageData?new Int32Array(size):null;
  if(provinceGrid){const provinceData=provinceMapImageData.data,pixelAt=(x,y)=>{if(x<0||y<0||x>=width||y>=height)return 0;const i=(y*width+x)*4;return rgbToProvinceId.get((provinceData[i]<<16)|(provinceData[i+1]<<8)|provinceData[i+2])||0;};
    for(let gy=0;gy<gridHeight;gy++)for(let gx=0;gx<gridWidth;gx++){const index=gy*gridWidth+gx,cx=gx*cellSize+Math.floor(cellSize/2),cy=gy*cellSize+Math.floor(cellSize/2);let id=pixelAt(cx,cy);
      // Water masks usually overlap black areas in the political map. Read a
      // nearby bank pixel so rivers and lake passages retain their territory.
      for(let radius=1;!id&&radius<=4;radius++)for(let dy=-radius;dy<=radius&&!id;dy++)for(let dx=-radius;dx<=radius&&!id;dx++)if(Math.max(Math.abs(dx),Math.abs(dy))===radius)id=pixelAt(cx+dx,cy+dy);
      provinceGrid[index]=id;
    }
  }
  result.network={kind,width,height,cellSize,gridWidth,gridHeight,labels,provinceGrid};
  return result;
}
export function buildRiverMarkerComponents(imageData,width,height,markers,cellSize=2,attachRadius=20) {
  return new Map([...buildWaterMarkerComponents(imageData,width,height,markers,{cellSize,attachRadius,kind:'river'})].map(([id,entry])=>[id,entry.component]));
}
function waterRoute(sourceId,destinationId,{riverComponents,lakeComponents,seaComponents},markersById,provincesById) {
  const source=markersById.get(Number(sourceId)),destination=markersById.get(Number(destinationId));if(!source||!destination)return null;
  const routes=[];
  for(const [kind,components] of [['river',riverComponents],['lake',lakeComponents],['sea',seaComponents]]){
    const from=components?.get(Number(sourceId)),to=components?.get(Number(destinationId)),network=components?.network;
    if(!from?.component||from.component!==to?.component||!network)continue;
    const {gridWidth,gridHeight,cellSize,labels,provinceGrid}=network,start=from.y*gridWidth+from.x,end=to.y*gridWidth+to.x;
    const size=gridWidth*gridHeight,gScore=new Float64Array(size);gScore.fill(Infinity);const previous=new Int32Array(size);previous.fill(-1);const closed=new Uint8Array(size),heap=[];
    const heuristic=index=>Math.hypot(index%gridWidth-(end%gridWidth),Math.floor(index/gridWidth)-Math.floor(end/gridWidth));
    const push=(index,score)=>{let i=heap.length;heap.push({index,score});while(i){const parent=(i-1)>>1;if(heap[parent].score<=score)break;heap[i]=heap[parent];i=parent;}heap[i]={index,score};};
    const pop=()=>{const top=heap[0],last=heap.pop();if(heap.length){let i=0;while(true){let child=i*2+1;if(child>=heap.length)break;if(child+1<heap.length&&heap[child+1].score<heap[child].score)child++;if(heap[child].score>=last.score)break;heap[i]=heap[child];i=child;}heap[i]=last;}return top;};
    gScore[start]=0;push(start,heuristic(start));let found=false,visited=0;
    while(heap.length&&visited<Math.min(size,250000)){const current=pop(),index=current.index;if(closed[index])continue;closed[index]=1;visited++;if(index===end){found=true;break;}const x=index%gridWidth,y=Math.floor(index/gridWidth);
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=gridWidth||ny>=gridHeight)continue;const next=ny*gridWidth+nx;if(closed[next]||labels[next]!==from.component)continue;const cost=gScore[index]+(dx&&dy?Math.SQRT2:1);if(cost>=gScore[next])continue;gScore[next]=cost;previous[next]=index;push(next,cost+heuristic(next));}
    }
    if(!found)continue;const path=[];for(let cursor=end;cursor!==-1;cursor=previous[cursor]){path.push(cursor);if(cursor===start)break;}path.reverse();
    const provinceIds=[],seenProvinces=new Set();if(provinceGrid)for(const index of path){const id=provinceGrid[index];if(id&&!seenProvinces.has(id)){seenProvinces.add(id);provinceIds.push(id);}}
    const endpointOwners=new Set([provincesById.get(Number(source.province_id))?.owner,provincesById.get(Number(destination.province_id))?.owner].filter(Boolean));
    const transitOwners=kind==='sea'?[]:[...new Set(provinceIds.map(id=>provincesById.get(Number(id))?.owner).filter(owner=>owner&&!endpointOwners.has(owner)))];
    const neutralProvinceCount=kind==='sea'?0:provinceIds.filter(id=>!provincesById.get(Number(id))?.owner&&Number(id)!==Number(source.province_id)&&Number(id)!==Number(destination.province_id)).length;
    const pixelLength=Math.hypot(Number(source.coord_1)-from.x*cellSize,Number(source.coord_2)-from.y*cellSize)+gScore[end]*cellSize+Math.hypot(Number(destination.coord_1)-to.x*cellSize,Number(destination.coord_2)-to.y*cellSize);
    if(kind==='sea'&&pixelLength>1000)continue;
    const points=[{x:Number(source.coord_1),y:Number(source.coord_2)}];for(let i=0;i<path.length;i+=Math.max(1,Math.ceil(path.length/80))){const index=path[i];points.push({x:(index%gridWidth)*cellSize+cellSize/2,y:Math.floor(index/gridWidth)*cellSize+cellSize/2});}points.push({x:Number(destination.coord_1),y:Number(destination.coord_2)});
    routes.push({mode:kind,distance:Math.max(1,Math.ceil(pixelLength/100)),pixelLength,mapPoints:points,provinceIds,neutralProvinceCount,transitOwners});
  }
  return routes.length?routes:null;
}
function routeCapacity(mode,distance){
  if(distance===null)return 0;
  const base=mode==='river'?160:mode==='lake'?120:mode==='sea'?240:40;
  const floor=mode==='land'?10:40;
  return Math.max(floor,Math.floor(base/Math.max(1,distance)));
}
function routeScore(route,transitTolls=[],quantity=0){
  if(!route||route.distance===null)return Infinity;
  const capacity=routeCapacity(route.mode,route.distance),capacityPenalty=quantity>capacity?((quantity-capacity)/Math.max(1,quantity))*route.distance:0;
  return route.distance+(Number(route.neutralProvinceCount)||0)*.5+transitTolls.reduce((sum,row)=>sum+(Number(row.rate)||0),0)/10+capacityPenalty;
}
function ownedProvinceDistance(startId,endId,provincesById,adjacency,owner){
  if(Number(startId)===Number(endId))return 0;
  const queue=[[Number(startId),0]],seen=new Set([Number(startId)]);
  while(queue.length){const [id,distance]=queue.shift();for(const next of adjacency.get(id)||[]){const province=provincesById.get(Number(next));if(seen.has(Number(next))||province?.owner!==owner)continue;if(Number(next)===Number(endId))return distance+1;seen.add(Number(next));queue.push([Number(next),distance+1]);}}
  return null;
}
function tradeProvincePath(startId,endId,provincesById,adjacency,blockedOwners=new Set()){
  const start=Number(startId),end=Number(endId);
  if(start===end)return {provinceIds:[start],distance:0,neutralProvinceCount:0,transitOwners:[]};
  const queue=[start],previous=new Map([[start,null]]);
  while(queue.length){const id=queue.shift();for(const rawNext of adjacency.get(id)||[]){const next=Number(rawNext),province=provincesById.get(next);if(previous.has(next)||!province||blockedOwners.has(province.owner))continue;previous.set(next,id);if(next===end){const path=[];for(let cursor=end;cursor!==null;cursor=previous.get(cursor))path.push(cursor);path.reverse();const intermediate=path.slice(1,-1),neutralProvinceCount=intermediate.filter(provinceId=>!provincesById.get(provinceId)?.owner).length,transitOwners=[...new Set(intermediate.map(provinceId=>provincesById.get(provinceId)?.owner).filter(owner=>owner&&owner!==provincesById.get(start)?.owner&&owner!==provincesById.get(end)?.owner))];return {provinceIds:path,distance:path.length-1,neutralProvinceCount,transitOwners};}queue.push(next);}}
  return null;
}
function manualTradeProvincePath(path,startId,endId,provincesById,adjacency,blockedOwners=new Set()){
  if(!Array.isArray(path)||!path.length)return null;
  const provinceIds=path.map(Number),start=Number(startId),end=Number(endId);
  if(provinceIds[0]!==start||provinceIds.at(-1)!==end||new Set(provinceIds).size!==provinceIds.length||provinceIds.length>200)return null;
  for(let index=0;index<provinceIds.length;index++){
    if(!provincesById.has(provinceIds[index]))return null;
    if(index>0&&!(adjacency.get(provinceIds[index-1])||new Set()).has(provinceIds[index]))return null;
  }
  const intermediate=provinceIds.slice(1,-1),neutralProvinceCount=intermediate.filter(id=>!provincesById.get(id)?.owner).length;
  const transitOwners=[...new Set(intermediate.map(id=>provincesById.get(id)?.owner).filter(Boolean))];
  return {provinceIds,distance:provinceIds.length-1,neutralProvinceCount,transitOwners,blocked:transitOwners.some(owner=>blockedOwners.has(owner))};
}
export function processTurnSimulation({calendar,provinces,markers,mechanics={},inventories=[],consumptionRates=[],estateRatios={},adjacency=new Map(),provinceCentroids=new Map(),riverComponents=new Map(),lakeComponents=new Map(),seaComponents=new Map(),transportRoutes=[],tradeContracts=[],tradeTransitRules=[],militaryProvinceIds=new Set()}={}) {
  const seasonIndex=SEASONS[calendar?.season]??2, season=calendar?.season||'Осень';
  const provincesById=new Map(provinces.map(p=>[Number(p.id),p])),markersByProvince=new Map(),markersById=new Map(markers.map(marker=>[Number(marker.id),marker])),settingsFor=owner=>mechanics[owner]||(mechanics[owner]={});
  const initialTreasury=Object.fromEntries(Object.keys(mechanics).map(owner=>[owner,Number(mechanics[owner]?.economy?.treasury)||0]));
  for(const m of markers){const id=Number(m.province_id);if(!markersByProvince.has(id))markersByProvince.set(id,[]);markersByProvince.get(id).push(m);}
  const stock=new Map(),invByMarker=new Map(); for(const m of markers){const inv=new Map();for(const row of inventories)if(Number(row.marker_id)===Number(m.id))inv.set(invKey(row.item_type,row.item_name),Number(row.quantity)||0);invByMarker.set(Number(m.id),inv);}
  const spoilMult=season==='Лето' ? 1.5 : season==='Зима' ? .4 : 1;
  for(const inv of invByMarker.values())for(const [key,quantity] of inv){const itemName=key.split('\u0000')[1];inv.set(key,Math.max(0,quantity-quantity*spoilageRate(itemName)*spoilMult));}
  const provinceStored=new Map(provinces.map(p=>[Number(p.id),Number(p.stored_resource_qty)||0]));
  const production={}, consumption={}, shortages={}, markerReports={}, provinceReports={}, ownerProduction={}, ownerConsumption={}, ownerShortages={}, ownerMarkerReports={}, ownerProvinceReports={}, ownerTransportReports={}, ownerNeeds={}, ownerMarketSupply={};
  const addBalance=(map,name,value)=>map[name]=(map[name]||0)+value;
  const addNeedCoverage=(owner,need,demand,covered)=>{ownerNeeds[owner]??={};ownerNeeds[owner][need]??={demand:0,covered:0};ownerNeeds[owner][need].demand+=demand;ownerNeeds[owner][need].covered+=covered;};
  const ownerTaxBases={},ownerTaxTerritories={};
  const addTaxBase=(owner,yards,type,territoryType,id)=>{
    if(!owner)return;
    const ratios=estateRatios[type]||{};
    ownerTaxBases[owner]??=Object.fromEntries(ESTATES.map(estate=>[estate,0]));
    const taxableYards=Object.fromEntries(ESTATES.map(estate=>[estate,Math.round((Number(yards)||0)*(Number(ratios[estate])||0))]));
    for(const estate of ESTATES)ownerTaxBases[owner][estate]+=taxableYards[estate];
    ownerTaxTerritories[owner]??=[];
    ownerTaxTerritories[owner].push({territoryType,id,taxableYards});
  };
  for(const province of provinces)addTaxBase(province.owner,province.yards,'province','province',Number(province.id));
  for(const marker of markers)if(marker.type!=='ruins')addTaxBase(marker.owner,marker.yards,marker.type,'marker',Number(marker.id));
  const demandByMarker=new Map();
  const calculateNeeds=(religion,estates)=>{
    const rows=consumptionRates.filter(r=>r.religion===religion), needs={};
    for(const need of NEED_GOODS)needs[need.name]=rows.filter(r=>r.need_name===need.name).reduce((total,row)=>total+ESTATES.reduce((sum,estate)=>sum+(Number(estates[estate])||0)*(Number(row[estate])||0),0),0);
    return needs;
  };
  for(const province of provinces){const owner=province.owner;if(!owner)continue;const pId=Number(province.id),setting=settingsFor(owner),resource=province.resource;
    const norm=NORMS[resource], markerList=markersByProvince.get(pId)||[], culture=province.main_culture,religion=province.main_religion;
    const status=statusMultiplier(getStatus(setting,'culture',culture))*statusMultiplier(getStatus(setting,'religion',religion));
    const crime=Math.max(0,Math.min(100,Number(setting.crime_rate??20)));
    const isOpen=['Древесина','Железная руда','Камень','Пушнина','Бивни','Ворвань','Самоцветы'].includes(resource);
    const threat=season==='Лето'&&isOpen&&!markerList.some(m=>['large_city','city','fortress'].includes(m.type))&&!militaryProvinceIds.has(pId) ? .7 : 1;
    const developmentMultiplier=Math.max(0,1+(Number(province.development??20)-20)*.01);
    const provinceRatio=estateRatios.province||{},provinceYards=Number(province.yards)||0,peasantsYards=Math.round(provinceYards*(Number(provinceRatio.peasants)||0));
    const regionNames=[province.region,province.province_name].map(value=>String(value||'').trim().toLocaleLowerCase('ru'));
    const foodResource=regionNames.some(name=>NORTHERN_CATTLE_REGIONS.has(name))?'Скот':'Зерно';
    const foodSeason=PEASANT_FOOD_SEASONS[foodResource][seasonIndex];
    const peasantFoodBase=round(peasantsYards*.95*1.25*foodSeason*status*(1-crime/100)*developmentMultiplier);
    const resourceAmount=norm?round(provinceYards*.95*norm[0]*norm[1][seasonIndex]*status*(1-crime/100)*threat*developmentMultiplier):0;
    const sameStaple=resource===foodResource;
    const amount=sameStaple?Math.max(resourceAmount,peasantFoodBase):resourceAmount;
    const foodAmount=sameStaple?0:peasantFoodBase;
    const foodAvailable=sameStaple?amount:foodAmount;
    if(resource&&norm){addBalance(production,resource,amount);ownerProduction[owner]??={};addBalance(ownerProduction[owner],resource,amount);}
    if(foodAmount>0){addBalance(production,foodResource,foodAmount);ownerProduction[owner]??={};addBalance(ownerProduction[owner],foodResource,foodAmount);}
    const destinations=provinceDestinations(pId,markersByProvince,provincesById,adjacency,owner);
    const localBuffer=provinceStored.get(pId)||0;
    const deliveries=[...distributeAmount(amount+localBuffer,destinations).map(item=>({...item,item_name:resource})),...distributeAmount(foodAmount,destinations).map(item=>({...item,item_name:foodResource}))];
    const primaryDestination=destinations.find(destination=>destination.distance===0)||destinations[0];
    province.target_marker_id=primaryDestination?.marker.id??null;
    const provinceEstates={};for(const estate of ESTATES)provinceEstates[estate]=Math.round(provinceYards*(Number(provinceRatio[estate])||0));
    const provinceNeeds=calculateNeeds(religion,provinceEstates);
    let localFoodUsed=0;
    if(destinations.length){for(const delivery of deliveries)if(delivery.item_name)addInv(invByMarker.get(Number(delivery.marker_id)),'resource',delivery.item_name,delivery.quantity);provinceStored.set(pId,0);}
    else {
      const localFoodDemand=Number(provinceNeeds['Продовольствие'])||0,currentFoodUsed=Math.min(foodAvailable,localFoodDemand),storedFoodUsed=sameStaple?Math.min(localBuffer,Math.max(0,localFoodDemand-currentFoodUsed)):0;
      localFoodUsed=currentFoodUsed+storedFoodUsed;
      if(localFoodUsed>0){addBalance(consumption,foodResource,localFoodUsed);ownerConsumption[owner]??={};addBalance(ownerConsumption[owner],foodResource,localFoodUsed);}
      provinceStored.set(pId,sameStaple?Math.max(0,localBuffer-storedFoodUsed)+Math.max(0,amount-currentFoodUsed):localBuffer+resourceAmount);
      for(const [need,demand] of Object.entries(provinceNeeds)){const covered=need==='Продовольствие'?localFoodUsed:0;if(demand>covered){addBalance(shortages,need,demand-covered);ownerShortages[owner]??={};addBalance(ownerShortages[owner],need,demand-covered);}addNeedCoverage(owner,need,demand,covered);}
    }
    if(destinations.length){for(const destination of destinations){const markerId=Number(destination.marker.id);if(!demandByMarker.has(markerId))demandByMarker.set(markerId,[]);demandByMarker.get(markerId).push({owner,territoryType:'province',territoryId:pId,needs:Object.fromEntries(Object.entries(provinceNeeds).map(([need,value])=>[need,value*destination.share]))});}}
    provinceReports[pId]={production:amount,resource,food_resource:foodResource,food_production:sameStaple?amount:foodAmount,food_base_production:peasantFoodBase,local_food_consumed:round(localFoodUsed),target_marker_id:primaryDestination?.marker.id??null,deliveries,isolated:!destinations.length,stored_resource_qty:round(provinceStored.get(pId)||0),crime};
    ownerProvinceReports[owner]??={};ownerProvinceReports[owner][pId]=provinceReports[pId];
  }
  const demandsByMarker=new Map();
  for(const marker of markers){const owner=marker.owner;if(!owner)continue;const province=provincesById.get(Number(marker.province_id))||{},religion=marker.religion||province.main_religion,yards=Number(marker.yards)||0,type=marker.type;
    const ratios=estateRatios[type]||{},estates=Object.fromEntries(ESTATES.map(estate=>[estate,Math.round(yards*(Number(ratios[estate])||0))]));
    const contributions=[{owner,territoryType:'marker',territoryId:Number(marker.id),needs:calculateNeeds(religion,estates)},...(demandByMarker.get(Number(marker.id))||[])];
    demandsByMarker.set(Number(marker.id),contributions);
  }
  for(const marker of markers){const owner=marker.owner;if(!owner)continue;const inv=invByMarker.get(Number(marker.id)),setting=settingsFor(owner);
    const province=provincesById.get(Number(marker.province_id))||{}, culture=marker.culture||province.main_culture,religion=marker.religion||province.main_religion;
    const cultureM=statusMultiplier(getStatus(setting,'culture',culture)),religionM=statusMultiplier(getStatus(setting,'religion',religion));
    const crime=Math.max(0,Math.min(100,Number(setting.crime_rate??20))), corruption=Math.max(0,Math.min(100,Number(setting.corruption_rate??20)));
    const yards=Number(marker.yards)||0,type=marker.type;
    if(['city','large_city'].includes(type)){
      const ratios=estateRatios[type]||{}, burghers=Math.round(yards*(Number(ratios.burghers)||0));
      const developmentBase=type==='large_city'?200:50;
      const developmentMultiplier=Math.max(0,1+(Number(marker.development??developmentBase)-developmentBase)*.01);
      let capacity=burghers*10*(1-crime/100)*cultureM*religionM*developmentMultiplier;
      let directive=['civilian','military','market'].includes(marker.production_directive)?marker.production_directive:'civilian';
      let orderGood=marker.state_order_good||'', orderQty=Math.min(Number(marker.state_order_qty)||0,Math.max(0,capacity*.5));
      const priority=['Топливо','Сукно и Одежда'];
      const directiveOrders=directive==='military'?['Оружие и Доспехи','Инструменты','Топливо','Сукно и Одежда']:directive==='civilian'?['Инструменты','Обработанный камень','Бумага','Оловина','Топливо','Сукно и Одежда']:[];
      const reserveCost=orderGood&&RECIPES[orderGood]&&orderQty>0?Math.min(capacity*.5,orderQty*RECIPES[orderGood].cost):0;
      const goodsProduced={};
      const produce=(good,limit=Infinity,capacityLimit=Infinity)=>{const recipe=RECIPES[good];if(!recipe||capacity<=0)return 0;let max=Math.min(limit,capacity/recipe.cost,capacityLimit/recipe.cost);const alternatives=recipe.alternatives||[recipe.inputs];const selected=alternatives.map(inputs=>({inputs,amount:Math.min(max,...inputs.map(([input,qty])=>readInv(inv,'resource',input)/qty))})).sort((a,b)=>b.amount-a.amount)[0];max=Math.floor(selected.amount*100)/100;if(max<=0)return 0;for(const [input,qty] of selected.inputs)inv.set(invKey('resource',input),readInv(inv,'resource',input)-max*qty);addInv(inv,'good',good,max);capacity-=max*recipe.cost;addBalance(production,good,max);goodsProduced[good]=(goodsProduced[good]||0)+max;ownerProduction[owner]??={};addBalance(ownerProduction[owner],good,max);return max;};
      priority.forEach(g=>produce(g,Infinity,Math.max(0,capacity-reserveCost)));
      let producedOrder=0;if(orderGood&&RECIPES[orderGood]&&orderQty>0){const unitCost=RECIPES[orderGood].cost;const e=setting.economy||{};const fundedLimit=Math.max(0,Number(e.treasury)||0)/unitCost;producedOrder=produce(orderGood,Math.min(orderQty,fundedLimit));e.treasury=Math.max(0,(Number(e.treasury)||0)-round(producedOrder*unitCost));setting.economy=e;}
      if(directive==='market'){
        const candidates=Object.keys(RECIPES).filter(g=>!priority.includes(g)&&g!==orderGood).map(g=>({good:g,potential:Math.max(...(RECIPES[g].alternatives||[RECIPES[g].inputs]).map(inputs=>Math.min(...inputs.map(([input,qty])=>readInv(inv,'resource',input)/qty))))/RECIPES[g].cost})).sort((a,b)=>b.potential-a.potential||a.good.localeCompare(b.good,'ru'));
        if(candidates[0]?.potential>0)produce(candidates[0].good);
      } else for(const g of directiveOrders)if(!priority.includes(g)&&g!==orderGood)produce(g);
      for(const g of Object.keys(RECIPES).sort())if(!priority.includes(g)&&g!==orderGood)produce(g);
      markerReports[marker.id]={guild_capacity:round(burghers*10*(1-crime/100)*cultureM*religionM*developmentMultiplier),directive,state_order_good:orderGood,state_order_qty:orderQty,state_order_produced:producedOrder,goods_produced:goodsProduced,max_storage:0};
    }
  }
  const transportReports=[],routeGroups=new Map();
  for(const route of transportRoutes){const key=`${Number(route.source_marker_id)}:${Number(route.destination_marker_id)}`;if(!routeGroups.has(key))routeGroups.set(key,[]);routeGroups.get(key).push(route);}
  const pendingTransfers=[];
  for(const [linkKey,routes] of routeGroups){routes.sort((a,b)=>(Number(a.priority)||100)-(Number(b.priority)||100)||Number(a.id)-Number(b.id));const [sourceId,destinationId]=linkKey.split(':').map(Number),source=markers.find(m=>Number(m.id)===sourceId),destination=markers.find(m=>Number(m.id)===destinationId),owner=source?.owner;
    const sourceProvince=provincesById.get(Number(source?.province_id)),destinationProvince=provincesById.get(Number(destination?.province_id));
    const sameState=source&&destination&&owner&&source.owner===destination.owner&&sourceProvince?.owner===owner&&destinationProvince?.owner===owner&&source.type!=='ruins'&&destination.type!=='ruins';
    const landDistance=sameState?ownedProvinceDistance(source.province_id,destination.province_id,provincesById,adjacency,owner):null;
    const waterCandidates=sameState?waterRoute(sourceId,destinationId,{riverComponents,lakeComponents,seaComponents},markersById,provincesById)||[]:[];
    const water=waterCandidates.filter(candidate=>candidate.mode==='sea'||(candidate.transitOwners.every(transitOwner=>transitOwner===owner)&&candidate.provinceIds.every(provinceId=>provincesById.get(Number(provinceId))?.owner===owner))).sort((a,b)=>routeScore(a)-routeScore(b))[0]||null;
    const mode=water?.mode||'land',distance=water?.distance??landDistance,capacity=routeCapacity(mode,distance);let remainingCapacity=capacity;
    for(const route of routes){const sourceInv=invByMarker.get(sourceId),itemType=route.item_type,itemName=route.item_name,key=invKey(itemType,itemName),original=sourceInv?readInv(sourceInv,itemType,itemName):0;
      const reserveMap=new Map();if(sourceInv){const reserved=new Map(sourceInv);for(const need of NEED_GOODS){const demand=(demandsByMarker.get(sourceId)||[]).reduce((sum,contribution)=>sum+(Number(contribution.needs?.[need.name])||0),0);takeNeed(reserved,need,demand);}for(const [itemKey,qty] of sourceInv)reserveMap.set(itemKey,Math.max(0,qty-readInv(reserved,itemKey.split('\u0000')[0],itemKey.split('\u0000')[1])));}
      const available=Math.max(0,original-(reserveMap.get(key)||0)),requested=Math.max(0,Number(route.quantity_per_turn)||0),sent=distance===null?0:round(Math.min(requested,remainingCapacity,available));
      if(sent>0){sourceInv.set(key,original-sent);pendingTransfers.push({marker_id:Number(destinationId),item_type:itemType,item_name:itemName,quantity:sent});remainingCapacity=round(remainingCapacity-sent);}
      const result={route_id:route.id,source_marker_id:sourceId,destination_marker_id:destinationId,item_type:itemType,item_name:itemName,mode,distance,capacity,requested,delivered:sent,reason:distance===null?'Нет сухопутного или водного пути под контролем государства':sent<requested?(remainingCapacity<=0?'Исчерпана пропускная способность':available<=sent?'Недостаточно свободного запаса':'Ограничение маршрута'):null};
      transportReports.push(result);ownerTransportReports[owner]??=[];ownerTransportReports[owner].push(result);
    }
  }
  for(const transfer of pendingTransfers)addInv(invByMarker.get(transfer.marker_id),transfer.item_type,transfer.item_name,transfer.quantity);
  const externalTradeReports=[],ownerExternalTradeReports={},externalLinkCapacity=new Map(),contractFunds=Object.fromEntries(Object.keys(mechanics).map(owner=>[owner,Math.max(0,Number(mechanics[owner]?.economy?.treasury)||0)]));
  for(const contract of [...tradeContracts].filter(row=>row.status==='active').sort((a,b)=>Number(a.id)-Number(b.id))){
    const sourceId=Number(contract.source_marker_id),destinationId=Number(contract.destination_marker_id),source=markersById.get(sourceId),destination=markersById.get(destinationId),seller=contract.seller_owner,buyer=contract.buyer_owner;
    if(!source||!destination||source.owner!==seller||destination.owner!==buyer||!seller||!buyer||seller===buyer||source.type==='ruins'||destination.type==='ruins')continue;
    const sourceProvince=provincesById.get(Number(source.province_id)),destinationProvince=provincesById.get(Number(destination.province_id));
    if(sourceProvince?.owner!==seller||destinationProvince?.owner!==buyer)continue;
    const contractRules=tradeTransitRules.filter(rule=>Number(rule.contract_id)===Number(contract.id));
    const blockedOwners=new Set(contractRules.filter(rule=>rule.blocked===true).map(rule=>rule.transit_owner));
    const hasManualRoute=Array.isArray(contract.route_province_ids)&&contract.route_province_ids.length>0;
    const waterCandidates=hasManualRoute?[]:(waterRoute(sourceId,destinationId,{riverComponents,lakeComponents,seaComponents},markersById,provincesById)||[]);
    const tollsFor=owners=>owners.map(owner=>{const rule=contractRules.find(row=>row.transit_owner===owner),configured=Number(rule?.toll_rate);return {owner,rate:Number.isFinite(configured)?Math.max(0,Math.min(50,configured)):10};});
    const waterOptions=waterCandidates.filter(candidate=>candidate.mode==='sea'||!candidate.transitOwners.some(owner=>blockedOwners.has(owner))).map(candidate=>({...candidate,score:routeScore(candidate,tollsFor(candidate.transitOwners),Number(contract.quantity_per_turn)||0)}));
    const landPath=hasManualRoute
      ? manualTradeProvincePath(contract.route_province_ids,source.province_id,destination.province_id,provincesById,adjacency,blockedOwners)
      : tradeProvincePath(source.province_id,destination.province_id,provincesById,adjacency,blockedOwners);
    const routeBlocked=!!landPath?.blocked;
    const tollsByOwner=new Map(contractRules.map(rule=>[rule.transit_owner,rule]));
    const landTolls=(landPath?.transitOwners||[]).map(owner=>{const rule=tollsByOwner.get(owner),configured=Number(rule?.toll_rate);return {owner,rate:Number.isFinite(configured)?Math.max(0,Math.min(50,configured)):10};});
    const selectedRoute=hasManualRoute?(landPath&&!routeBlocked?{...landPath,mode:'land'}:null):([...waterOptions,landPath&&{...landPath,mode:'land',score:routeScore(landPath,landTolls,Number(contract.quantity_per_turn)||0)}].filter(Boolean).sort((a,b)=>a.score-b.score)[0]||null);
    const water=selectedRoute&&selectedRoute.mode!=='land'?selectedRoute:null;
    const mode=selectedRoute?.mode||'land',distance=selectedRoute?.distance??null;
    const neutralProvinceCount=selectedRoute?.neutralProvinceCount||0;
    const transitOwners=selectedRoute?.transitOwners||[];
    const neutralLossFactor=Math.pow(.95,neutralProvinceCount);
    const transitTolls=transitOwners.map(owner=>{const rule=tollsByOwner.get(owner),configured=Number(rule?.toll_rate),rate=Number.isFinite(configured)?Math.max(0,Math.min(50,configured)):10;return {owner,rate};});
    const mapPoints=water?water.mapPoints:[{x:Number(source.coord_1),y:Number(source.coord_2)},...(selectedRoute?.provinceIds.slice(1,-1)||[]).map(id=>provinceCentroids.get(Number(id))).filter(point=>point&&Number.isFinite(point.x)&&Number.isFinite(point.y)),{x:Number(destination.coord_1),y:Number(destination.coord_2)}];
    const capacity=routeCapacity(mode,distance),linkKey=`${sourceId}:${destinationId}`;if(!externalLinkCapacity.has(linkKey))externalLinkCapacity.set(linkKey,capacity);const remainingCapacity=externalLinkCapacity.get(linkKey),itemType=contract.item_type,itemName=contract.item_name,key=invKey(itemType,itemName),sourceInv=invByMarker.get(sourceId);
    const reserved=new Map(sourceInv||[]);for(const need of NEED_GOODS){const demand=(demandsByMarker.get(sourceId)||[]).reduce((sum,contribution)=>sum+(Number(contribution.needs?.[need.name])||0),0);takeNeed(reserved,need,demand);}
    const available=Math.max(0,readInv(sourceInv||new Map(),itemType,itemName)-readInv(reserved,itemType,itemName));
    const requested=Math.max(0,Number(contract.quantity_per_turn)||0),unitPrice=Math.max(0,Number(contract.unit_price)||0),tollRate=transitTolls.reduce((sum,row)=>sum+row.rate,0),buyerCostPerShippedUnit=unitPrice*(neutralLossFactor+tollRate/100),affordable=buyerCostPerShippedUnit>0?contractFunds[buyer]/buyerCostPerShippedUnit:requested;
    const shipped=distance===null?0:round(Math.min(requested,remainingCapacity,available,affordable)),delivered=round(shipped*neutralLossFactor),routeLoss=round(shipped-delivered),paid=round(delivered*unitPrice),tolls=transitTolls.map(row=>({...row,amount:round(shipped*unitPrice*row.rate/100)})),tollPaid=round(tolls.reduce((sum,row)=>sum+(Number(row.amount)||0),0)),buyerTotalPaid=round(paid+tollPaid);externalLinkCapacity.set(linkKey,round(Math.max(0,remainingCapacity-shipped)));
    if(shipped>0){sourceInv.set(key,readInv(sourceInv,itemType,itemName)-shipped);if(delivered>0)addInv(invByMarker.get(destinationId),itemType,itemName,delivered);contractFunds[buyer]=round(Math.max(0,contractFunds[buyer]-buyerTotalPaid));const sellerEconomy=settingsFor(seller).economy||{};sellerEconomy.treasury=round((Number(sellerEconomy.treasury)||0)+paid);settingsFor(seller).economy=sellerEconomy;const buyerEconomy=settingsFor(buyer).economy||{};buyerEconomy.treasury=round(Math.max(0,(Number(buyerEconomy.treasury)||0)-buyerTotalPaid));settingsFor(buyer).economy=buyerEconomy;for(const toll of tolls){if(toll.amount<=0)continue;const transitEconomy=settingsFor(toll.owner).economy||{};transitEconomy.treasury=round((Number(transitEconomy.treasury)||0)+toll.amount);settingsFor(toll.owner).economy=transitEconomy;}}
    const result={contract_id:Number(contract.id),source_marker_id:sourceId,destination_marker_id:destinationId,source_name:source.name||`Поселение #${sourceId}`,destination_name:destination.name||`Поселение #${destinationId}`,seller_owner:seller,buyer_owner:buyer,item_type:itemType,item_name:itemName,requested,shipped,delivered,route_loss:routeLoss,neutral_province_count:neutralProvinceCount,transit_owners:transitOwners,transit_tolls:tolls,toll_paid:tollPaid,buyer_total_paid:buyerTotalPaid,unit_price:unitPrice,paid,mode,distance,capacity,province_ids:selectedRoute?.provinceIds||[],map_points:mapPoints,manual_route:hasManualRoute,blocked_transit_owners:[...blockedOwners],reason:routeBlocked?'Ручной маршрут проходит через государство, запретившее транзит':distance===null?'Нет доступного сухопутного или водного пути':shipped<requested?(available<=shipped?'Недостаточно свободного избытка':affordable<=shipped?'Недостаточно средств у покупателя':'Ограничение пропускной способности'):null};
    externalTradeReports.push(result);ownerExternalTradeReports[seller]??=[];ownerExternalTradeReports[seller].push({...result,side:'export'});ownerExternalTradeReports[buyer]??=[];ownerExternalTradeReports[buyer].push({...result,side:'import'});for(const toll of tolls){ownerExternalTradeReports[toll.owner]??=[];ownerExternalTradeReports[toll.owner].push({...result,side:'transit',transit_toll_income:toll.amount,transit_toll_owner:toll.owner,transit_toll_rate:toll.rate});}
  }
  for(const marker of markers){if(!marker.owner||marker.type==='ruins')continue;ownerMarketSupply[marker.owner]??={};for(const [key,quantity] of invByMarker.get(Number(marker.id))||[]){const itemName=key.split('\u0000')[1];addBalance(ownerMarketSupply[marker.owner],itemName,quantity);}}
  const ownerFreeSurplus={};
  for(const marker of markers){
    if(!marker.owner||marker.type==='ruins')continue;
    const markerId=Number(marker.id),free=new Map(invByMarker.get(markerId)||[]);
    for(const need of NEED_GOODS){const demand=(demandsByMarker.get(markerId)||[]).reduce((sum,contribution)=>sum+(Number(contribution.needs?.[need.name])||0),0);takeNeed(free,need,demand);}
    for(const [key,quantity] of free){if(quantity<=0.01)continue;const [item_type,item_name]=key.split('\u0000');ownerFreeSurplus[marker.owner]??=[];ownerFreeSurplus[marker.owner].push({marker_id:markerId,marker_name:marker.name||`Поселение #${markerId}`,item_type,item_name,quantity:round(quantity)});}
  }
  for(const marker of markers){const owner=marker.owner;if(!owner)continue;const inv=invByMarker.get(Number(marker.id)),province=provincesById.get(Number(marker.province_id))||{},religion=marker.religion||province.main_religion,type=marker.type,yards=Number(marker.yards)||0,setting=settingsFor(owner),corruption=Math.max(0,Math.min(100,Number(setting.corruption_rate??20))),contributions=demandsByMarker.get(Number(marker.id))||[],coverage=[];
    for(const need of NEED_GOODS){const demand=contributions.reduce((sum,contribution)=>sum+(Number(contribution.needs?.[need.name])||0),0),used=takeNeed(inv,need,demand,(item,qty)=>{addBalance(consumption,item,qty);ownerConsumption[owner]??={};addBalance(ownerConsumption[owner],item,qty);});
      addNeedCoverage(owner,need.name,demand,used);
      coverage.push({need:need.name,demand:round(demand),covered:round(used),ratio:demand?round(used/demand):1});if(demand>used){addBalance(shortages,need.name,demand-used);ownerShortages[owner]??={};addBalance(ownerShortages[owner],need.name,demand-used);}
    }
    const capBase=type==='large_city'?[20000,15]:type==='city'?[6000,10]:type==='monastery'?[3000,8]:type==='fortress'?[1000,5]:[0,0];
    const maxStorage=round((capBase[0]+yards*capBase[1])*(1-corruption/200));
    const total=()=>[...inv.values()].reduce((a,b)=>a+b,0);const overflow=Math.max(0,total()-maxStorage),overflowLoss=overflow*.4,current=total();
    if(current>0&&overflowLoss>0)for(const [key,value] of inv)inv.set(key,Math.max(0,value-overflowLoss*value/current));
    markerReports[marker.id]={...markerReports[marker.id],max_storage:maxStorage,stock:round(total()),items:[...inv.entries()].map(([key,quantity])=>{const [item_type,item_name]=key.split('\u0000');return {item_type,item_name,quantity:round(quantity)};}).filter(x=>x.quantity>0),coverage,overflow_loss:round(overflowLoss)};
    markerReports[marker.id]={...markerReports[marker.id],transport:transportReports.filter(item=>item.source_marker_id===Number(marker.id)||item.destination_marker_id===Number(marker.id))};
    ownerMarkerReports[owner]??={};ownerMarkerReports[owner][marker.id]=markerReports[marker.id];
  }
  const ownerMarketReports={};
  for(const owner of new Set([...Object.keys(ownerNeeds),...Object.keys(mechanics)])){
    const settings=settingsFor(owner),previous=settings.market_prices||{},demand={...(ownerConsumption[owner]||{})};
    for(const need of NEED_GOODS){const row=ownerNeeds[owner]?.[need.name]||{},gap=Math.max(0,(Number(row.demand)||0)-(Number(row.covered)||0));if(gap>0)for(const [item,share] of need.basket||[])addBalance(demand,item,gap*share);}
    const supply=ownerMarketSupply[owner]||{},prices={},rows=[];let turnover=0;
    for(const item of [...RESOURCES,...GOODS]){
      const base=Number(BASE_MARKET_PRICES[item])||1,available=Math.max(0,Number(supply[item])||0),wanted=Math.max(0,Number(demand[item])||0),consumed=Math.max(0,Number(ownerConsumption[owner]?.[item])||0),deals=ownerExternalTradeReports[owner]||[],imported=round(deals.filter(deal=>deal.side==='import'&&deal.item_name===item).reduce((sum,deal)=>sum+(Number(deal.delivered)||0),0)),exported=round(deals.filter(deal=>deal.side==='export'&&deal.item_name===item).reduce((sum,deal)=>sum+(Number(deal.delivered)||0),0));
      const old=Math.max(base*.5,Math.min(base*2,Number(previous[item])||base));
      const target=wanted===0&&available===0?old:available===0?base*2:wanted===0?base*.5:base*Math.max(.5,Math.min(2,Math.pow(wanted/available,.35)));
      const price=round(old*.7+target*.3);prices[item]=price;turnover+=consumed*price;
      rows.push({item,base_price:base,price,demand:round(wanted),supply:round(available),consumed:round(consumed),imported,exported,turnover:round(consumed*price)});
    }
    const storedTradeRate=Number(settings.internal_trade_tax_rate);
    const tradeRate=Number.isFinite(storedTradeRate)?Math.max(0,Math.min(15,storedTradeRate)):5;
    const tradeIncome=round(turnover*tradeRate/100);settings.market_prices=prices;ownerMarketReports[owner]={prices,rows,turnover:round(turnover),trade_tax_rate:tradeRate,trade_income:tradeIncome};
  }
  const stateLoyaltyUpdates={},stateEffectsByOwner={};
  for(const owner of new Set([...Object.keys(ownerNeeds),...Object.keys(mechanics)])){
    const needs=ownerNeeds[owner]||{},food=needs['Продовольствие']||{demand:0,covered:0},fuel=needs['Топливо']||{demand:0,covered:0};
    const foodCoverage=food.demand>0?Math.max(0,Math.min(1,food.covered/food.demand)):1;
    const fuelCoverage=fuel.demand>0?Math.max(0,Math.min(1,fuel.covered/fuel.demand)):1;
    const foodDeficit=food.demand>0?1-foodCoverage:0,fuelDeficit=fuel.demand>0?1-fuelCoverage:0,populationLossRate=foodDeficit*.01;
    let yardsBefore=0,yardsLost=0;
    for(const province of provinces)if(province.owner===owner){const old=Math.max(0,Number(province.yards)||0),next=Math.floor(old*(1-populationLossRate));province.yards=next;yardsBefore+=old;yardsLost+=old-next;}
    for(const marker of markers)if(marker.owner===owner&&marker.type!=='ruins'){const old=Math.max(0,Number(marker.yards)||0),next=Math.floor(old*(1-populationLossRate));marker.yards=next;yardsBefore+=old;yardsLost+=old-next;}
    const settings=settingsFor(owner),values={};
    for(const estate of ESTATES)values[estate]=round(Math.max(0,Math.min(100,Number(settings.estate_loyalty?.[estate]??50))));
    const peasantsBefore=values.peasants;
    const burghersBefore=values.burghers;
    values.peasants=round(Math.max(0,Math.min(100,values.peasants+(foodDeficit>0?-2*foodDeficit:(food.demand>0?.25:0)))));
    if(season==='Зима'&&fuelDeficit>0)for(const estate of ESTATES)values[estate]=round(Math.max(0,values[estate]-fuelDeficit));
    const storedTradeRate=Number(settings.internal_trade_tax_rate);
    const tradeRate=Number.isFinite(storedTradeRate)?Math.max(0,Math.min(15,storedTradeRate)):5;
    // The existing 5% levy is neutral; each percentage point away from it
    // shifts state-wide burgher loyalty by 0.2 points in the opposite direction.
    values.burghers=round(Math.max(0,Math.min(100,values.burghers+(5-tradeRate)*.2)));
    settings.estate_loyalty=values;
    stateLoyaltyUpdates[owner]=values;
    const base=ownerTaxBases[owner]||Object.fromEntries(ESTATES.map(estate=>[estate,0]));
    const rates={aristocracy:10,clergy:1,burghers:2,peasants:1,...(settings.tax_rates||{})};
    const crimeRate=Math.max(0,Math.min(100,Number(settings.crime_rate??20)));
    const corruptionRate=Math.max(0,Math.min(100,Number(settings.corruption_rate??20)));
    const collectionMultiplier=(1-crimeRate/100)*(1-corruptionRate/100);
    const taxableYards=Object.fromEntries(ESTATES.map(estate=>[estate,round(base[estate])]));
    let taxIncome=0;
    for(const territory of ownerTaxTerritories[owner]||[]){
      const territorialTax=round(ESTATES.reduce((sum,estate)=>sum+(Number(territory.taxableYards[estate])||0)*Math.max(0,Number(rates[estate])||0),0)*collectionMultiplier);
      taxIncome=round(taxIncome+territorialTax);
      if(territory.territoryType==='province'){
        provinceReports[territory.id]={...provinceReports[territory.id],tax_income:territorialTax};
        ownerProvinceReports[owner]??={};
        ownerProvinceReports[owner][territory.id]=provinceReports[territory.id];
      }else{
        markerReports[territory.id]={...markerReports[territory.id],tax_income:territorialTax};
        ownerMarkerReports[owner]??={};
        ownerMarkerReports[owner][territory.id]=markerReports[territory.id];
      }
    }
    const economy=settings.economy||{},income=economy.income||{},expenses=economy.expenses||{};
    const sumItems=items=>Array.isArray(items)?items.reduce((sum,item)=>sum+Math.max(0,Number(item?.amount)||0),0):0;
    const tradeIncome=ownerMarketReports[owner]?.trade_income||0;
    const treasuryRecurringIncome=taxIncome+tradeIncome+Math.max(0,Number(income.other_recurring)||0);
    const treasuryOneOffIncome=sumItems(economy.one_off_income_treasury)+Math.max(0,Number(income.other_one_off)||0);
    const treasuryRecurringExpenses=Math.max(0,Number(expenses.army)||0)+Math.max(0,Number(expenses.trade)||0)+Math.max(0,Number(expenses.other_recurring)||0);
    const treasuryOneOffExpenses=sumItems(economy.one_off_expenses_treasury)+Math.max(0,Number(expenses.other_one_off)||0);
    const treasuryIncomeTotal=round(treasuryRecurringIncome+treasuryOneOffIncome);
    const treasuryExpenseTotal=round(treasuryRecurringExpenses+treasuryOneOffExpenses);
    const treasuryAvailable=round(Math.max(0,Number(economy.treasury)||0)+treasuryIncomeTotal);
    const treasuryExpensePaid=round(Math.min(treasuryAvailable,treasuryExpenseTotal));
    economy.treasury=round(Math.max(0,treasuryAvailable-treasuryExpensePaid));
    economy.income={...income,taxes:taxIncome,trade:tradeIncome,other_one_off:0};
    economy.expenses={...expenses,other_one_off:0};
    economy.one_off_income_treasury=[];
    economy.one_off_expenses_treasury=[];
    const prestigeIncomeRecurring=Math.max(0,Number(economy.prestige_recurring_income)||0);
    const prestigeIncomeOneOff=sumItems(economy.one_off_income_prestige);
    const prestigeExpenseRecurring=Math.max(0,Number(economy.prestige_recurring_expenses)||0);
    const prestigeExpenseOneOff=sumItems(economy.one_off_expenses_prestige)+Math.max(0,Number(economy.prestige_one_off_expenses)||0);
    const prestigeIncomeTotal=round(prestigeIncomeRecurring+prestigeIncomeOneOff);
    const prestigeExpenseTotal=round(prestigeExpenseRecurring+prestigeExpenseOneOff);
    const prestigeAvailable=round(Math.max(0,Number(economy.prestige)||0)+prestigeIncomeTotal);
    const prestigeExpensePaid=round(Math.min(prestigeAvailable,prestigeExpenseTotal));
    economy.prestige=round(Math.max(0,prestigeAvailable-prestigeExpensePaid));
    economy.one_off_income_prestige=[];
    economy.one_off_expenses_prestige=[];
    economy.prestige_one_off_expenses=0;
    settings.economy=economy;
    const coverage=Object.fromEntries(Object.entries(needs).map(([name,row])=>[name,{demand:round(row.demand),covered:round(row.covered),ratio:row.demand?round(row.covered/row.demand):1}]));
    const externalDeals=ownerExternalTradeReports[owner]||[],externalTradeIncome=round(externalDeals.filter(item=>item.side==='export').reduce((sum,item)=>sum+(Number(item.paid)||0),0)),externalTradeExpenses=round(externalDeals.filter(item=>item.side==='import').reduce((sum,item)=>sum+(Number(item.paid)||0),0)),transitTollIncome=round(externalDeals.filter(item=>item.side==='transit').reduce((sum,item)=>sum+(Number(item.transit_toll_income)||0),0)),transitTollExpenses=round(externalDeals.filter(item=>item.side==='import').reduce((sum,item)=>sum+(Number(item.toll_paid)||0),0));
    stateEffectsByOwner[owner]={food_coverage:round(foodCoverage),population_loss_rate:round(populationLossRate),yards_before:yardsBefore,yards_lost:yardsLost,peasants_loyalty_change:round(values.peasants-peasantsBefore),burghers_loyalty_change:round(values.burghers-burghersBefore),trade_tax_rate:tradeRate,winter_fuel_coverage:season==='Зима'?round(fuelCoverage):null,taxable_yards:taxableYards,tax_collection_multiplier:round(collectionMultiplier),tax_income:taxIncome,trade_income:tradeIncome,external_trade_income:externalTradeIncome,external_trade_expenses:externalTradeExpenses,transit_toll_income:transitTollIncome,transit_toll_expenses:transitTollExpenses,market_prices:ownerMarketReports[owner]?.prices||{},market_demand:ownerMarketReports[owner]?.rows||[],market_turnover:ownerMarketReports[owner]?.turnover||0,treasury_income:treasuryIncomeTotal,treasury_expenses:treasuryExpenseTotal,treasury_expenses_paid:treasuryExpensePaid,treasury_unpaid:round(treasuryExpenseTotal-treasuryExpensePaid),treasury_balance:economy.treasury,prestige_income:prestigeIncomeTotal,prestige_expenses:prestigeExpenseTotal,prestige_expenses_paid:prestigeExpensePaid,prestige_unpaid:round(prestigeExpenseTotal-prestigeExpensePaid),prestige_balance:economy.prestige};
    ownerNeeds[owner]??={};ownerNeeds[owner].coverage=coverage;
  }
  const loyaltyUpdates=[];
  const inventoryUpdates=[];for(const [markerId,inv] of invByMarker)for(const [key,quantity] of inv){const [item_type,item_name]=key.split('\u0000');inventoryUpdates.push({marker_id:markerId,item_type,item_name,quantity:round(quantity)});}
  const nextTurn={turn:Number(calendar.turn)+1,season:({Осень:'Зима',Зима:'Весна',Весна:'Лето',Лето:'Осень'})[season],year:Number(calendar.year)+(season==='Осень'?1:0)};
  for(const p of provinces)if(provinceStored.has(Number(p.id))){const pr=provinceReports[p.id]||{};provinceReports[p.id]={...pr,stored_resource_qty:round(provinceStored.get(Number(p.id)))};}
  const owners=new Set([...Object.keys(ownerProduction),...Object.keys(ownerConsumption),...Object.keys(ownerShortages),...Object.keys(ownerTransportReports),...Object.keys(ownerNeeds),...Object.keys(ownerExternalTradeReports)]);
  const ownerReports=Object.fromEntries([...owners].map(owner=>[owner,{processed_calendar:calendar,next_calendar:nextTurn,production:ownerProduction[owner]||{},consumption:ownerConsumption[owner]||{},shortages:ownerShortages[owner]||{},needs_coverage:ownerNeeds[owner]?.coverage||{},state_effects:stateEffectsByOwner[owner]||{},transport:ownerTransportReports[owner]||[],external_trade:ownerExternalTradeReports[owner]||[],free_surplus:ownerFreeSurplus[owner]||[],markerReports:ownerMarkerReports[owner]||{},provinceReports:ownerProvinceReports[owner]||{}}]));
  const treasuryAdjustments={};for(const owner of Object.keys(mechanics)){const adjustment=round((Number(mechanics[owner]?.economy?.treasury)||0)-initialTreasury[owner]);if(adjustment)treasuryAdjustments[owner]=adjustment;}
  return {calendar:nextTurn,inventoryUpdates,loyaltyUpdates,territoryLoyalty:loyaltyUpdates,stateLoyaltyUpdates,provinceUpdates:provinces.map(p=>({id:p.id,yards:p.yards,target_marker_id:p.target_marker_id??null,stored_resource_qty:round(provinceStored.get(Number(p.id))||0)})),markerUpdates:markers.map(marker=>({id:marker.id,yards:marker.yards})),production,consumption,shortages,transportReports,externalTradeReports,markerReports,provinceReports,treasuryAdjustments,ownerReports,report:{processed_calendar:calendar,next_calendar:nextTurn,production,consumption,shortages,transport:transportReports,external_trade:externalTradeReports,markerReports,provinceReports}};
}
