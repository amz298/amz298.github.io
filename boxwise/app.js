'use strict';
const EPS = 1e-8;
const outerVolume = x => x.l * x.w * x.h;
function factor(p) { return Number.isFinite(p.sizeFactor) && p.sizeFactor > 0 ? p.sizeFactor : 1; }
function dims(p) { const f = factor(p); return { l:p.l * f, w:p.w * f, h:p.h * f }; }
function itemVolume(p) { const d = dims(p); return d.l * d.w * d.h; }
function packedVolume(p) { return itemVolume(p) * (p.packRatio ?? 1); }
function overlap1d(a1, a2, b1, b2) { return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1)); }
function overlapArea(a, b) { return overlap1d(a.x,a.x+a.l,b.x,b.x+b.l) * overlap1d(a.y,a.y+a.w,b.y,b.y+b.w); }

function orientations(p) {
  const d=dims(p),a=[d.l,d.w,d.h]; let options;
  if (p.orientation==='fixed'||p.rotate===false) options=[a];
  else if (p.orientation==='upright') options=[[a[0],a[1],a[2]],[a[1],a[0],a[2]]];
  else options=[[a[0],a[1],a[2]],[a[0],a[2],a[1]],[a[1],a[0],a[2]],[a[1],a[2],a[0]],[a[2],a[0],a[1]],[a[2],a[1],a[0]]];
  return [...new Map(options.map(x=>[x.map(n=>n.toFixed(8)).join('/'),{l:x[0],w:x[1],h:x[2]}])).values()];
}
function earlierPriority(a,b){for(let i=0;i<a.length;i++)if(Math.abs(a[i]-b[i])>EPS)return a[i]<b[i];return false;}
function supportsFor(item,items,productMap){
  if(item.z<=EPS)return[];
  return items.filter(other=>other!==item&&!other.approximate&&Math.abs(other.z+other.h-item.z)<=EPS&&overlapArea(item,other)>EPS&&productMap.get(other.sku)?.canSupport!==false&&!productMap.get(other.sku)?.fragile);
}
function analyzeStack(items,productMap){
  const records=new Map(items.map(item=>[item,{supportRatio:item.z<=EPS?1:0,centerSupported:item.z<=EPS,layer:1,loadAbove:0}]));
  for(const item of [...items].sort((a,b)=>a.z-b.z)){
    if(item.z<=EPS)continue; const supports=supportsFor(item,items,productMap),area=supports.reduce((n,s)=>n+overlapArea(item,s),0);
    const cx=item.x+item.l/2,cy=item.y+item.w/2,rec=records.get(item);
    rec.supportRatio=Math.min(1,area/(item.l*item.w));
    rec.centerSupported=supports.some(s=>cx>=s.x-EPS&&cx<=s.x+s.l+EPS&&cy>=s.y-EPS&&cy<=s.y+s.w+EPS);
    rec.layer=supports.length?1+Math.max(...supports.map(s=>records.get(s)?.layer||1)):Infinity;
  }
  for(const item of [...items].sort((a,b)=>(b.z+b.h)-(a.z+a.h))){
    const supports=supportsFor(item,items,productMap); if(!supports.length)continue;
    const totalArea=supports.reduce((n,s)=>n+overlapArea(item,s),0),transmitted=(productMap.get(item.sku)?.weight||0)+records.get(item).loadAbove;
    for(const support of supports)records.get(support).loadAbove+=transmitted*overlapArea(item,support)/totalArea;
  }
  let valid=true;
  for(const item of items){
    const p=productMap.get(item.sku)||{},r=records.get(item),supportMinimum=Number.isFinite(p.supportRatio)?p.supportRatio:0.8;
    const maxLayers=Number.isFinite(p.maxLayers)&&p.maxLayers>0?p.maxLayers:Infinity,maxLoad=Number.isFinite(p.maxLoad)&&p.maxLoad>=0?p.maxLoad:Infinity;
    if(item.z>EPS&&(r.supportRatio+EPS<supportMinimum||!r.centerSupported))valid=false;
    if(r.layer>maxLayers+EPS||((p.fragile||p.canSupport===false)&&r.loadAbove>EPS)||r.loadAbove>maxLoad+EPS)valid=false;
  }
  return{valid,records};
}
function hasTopInsertionPath(candidate,placedItems){return !placedItems.some(item=>!item.approximate&&overlapArea(candidate,item)>EPS&&item.z+item.h>candidate.z+EPS);}
function stablePlacement(candidate,product,placedItems,productMap){
  if(!hasTopInsertionPath(candidate,placedItems))return null;
  if(candidate.z>EPS){
    const supports=supportsFor(candidate,placedItems,productMap),area=supports.reduce((n,s)=>n+overlapArea(candidate,s),0),minimum=Number.isFinite(product.supportRatio)?product.supportRatio:0.8;
    const cx=candidate.x+candidate.l/2,cy=candidate.y+candidate.w/2,center=supports.some(s=>cx>=s.x-EPS&&cx<=s.x+s.l+EPS&&cy>=s.y-EPS&&cy<=s.y+s.w+EPS);
    const layer=supports.length?1+Math.max(...supports.map(s=>s.layer||1)):Infinity,maxLayers=Number.isFinite(product.maxLayers)&&product.maxLayers>0?product.maxLayers:Infinity;
    if(area+EPS<candidate.l*candidate.w*minimum||!center||layer>maxLayers)return null;
  }
  const item={sku:product.sku,...candidate},analysis=analyzeStack([...placedItems,item],productMap);
  return analysis.valid?analysis.records.get(item):null;
}
function placement(spaces,p,mode,box,placedItems,productMap){
  let best;
  for(let i=0;i<spaces.length;i++)for(const d of orientations(p)){
    const s=spaces[i]; if(d.l>s.l+EPS||d.w>s.w+EPS||d.h>s.h+EPS)continue;
    const candidate={x:s.x,y:s.y,z:s.z,...d},stability=stablePlacement(candidate,p,placedItems,productMap); if(!stability)continue;
    const waste=s.l*s.w*s.h-d.l*d.w*d.h,gridCapacity=mode==='grid'?Math.floor((box.il+EPS)/d.l)*Math.floor((box.iw+EPS)/d.w)*Math.floor((box.ih+EPS)/d.h):0;
    const priority=mode==='grid'?[-gridCapacity,s.z,s.y,s.x,waste]:[waste,s.z,s.y,s.x];
    if(!best||earlierPriority(priority,best.priority))best={index:i,d,priority,stability};
  }
  return best;
}
function put(spaces,choice){
  const origin=spaces[choice.index],d=choice.d,placed={x:origin.x,y:origin.y,z:origin.z,...d},end={x:origin.x+d.l,y:origin.y+d.w,z:origin.z+d.h},next=[];
  for(const s of spaces){
    const x2=s.x+s.l,y2=s.y+s.w,z2=s.z+s.h;
    if(end.x<=s.x+EPS||placed.x>=x2-EPS||end.y<=s.y+EPS||placed.y>=y2-EPS||end.z<=s.z+EPS||placed.z>=z2-EPS){next.push(s);continue;}
    const parts=[{x:s.x,y:s.y,z:s.z,l:placed.x-s.x,w:s.w,h:s.h},{x:end.x,y:s.y,z:s.z,l:x2-end.x,w:s.w,h:s.h},{x:s.x,y:s.y,z:s.z,l:s.l,w:placed.y-s.y,h:s.h},{x:s.x,y:end.y,z:s.z,l:s.l,w:y2-end.y,h:s.h},{x:s.x,y:s.y,z:s.z,l:s.l,w:s.w,h:placed.z-s.z},{x:s.x,y:s.y,z:end.z,l:s.l,w:s.w,h:z2-end.z}];
    for(const q of parts)if(q.l>EPS&&q.w>EPS&&q.h>EPS)next.push(q);
  }
  for(let i=next.length-1;i>=0;i--){const a=next[i];if(next.some((b,j)=>i!==j&&a.x>=b.x-EPS&&a.y>=b.y-EPS&&a.z>=b.z-EPS&&a.x+a.l<=b.x+b.l+EPS&&a.y+a.w<=b.y+b.w+EPS&&a.z+a.h<=b.z+b.h+EPS&&(a.x>b.x+EPS||a.y>b.y+EPS||a.z>b.z+EPS||a.l<b.l-EPS||a.w<b.w-EPS||a.h<b.h-EPS||j<i)))next.splice(i,1);}
  spaces.splice(0,spaces.length,...next);return placed;
}
function itemScore(p,strategy,usedVolume,currentWeight,box,divisor){
  const v=itemVolume(p),density=p.weight/v;
  if(strategy==='volume')return v;if(strategy==='weight')return p.weight*1e4+v/1e3;if(strategy==='light')return-density*1e8+v/1e3;if(strategy==='dense')return density*1e8+v/1e3;
  if(strategy==='fragile')return(p.fragile?-1:1)*1e9+p.weight*1e4+v;
  if(strategy==='target'){const td=Math.max(0,outerVolume(box)/divisor-box.tare)/(box.il*box.iw*box.ih*0.8);return-Math.abs((currentWeight-box.tare+p.weight)/(usedVolume+v)-td)*1e8+v/1e3;}
  return-Math.abs((currentWeight+p.weight)-(usedVolume+v)/divisor)*1e4+v/1e3;
}
function decoratePlacements(placements,products){const map=new Map(products.map(p=>[p.sku,p])),rigid=placements.filter(p=>!p.approximate),a=analyzeStack(rigid,map);for(const item of rigid)Object.assign(item,a.records.get(item));}

function packOne(products,remaining,box,divisor,strategy='balance',softReserve=0,placementMode='waste'){
  const spaces=[{x:0,y:0,z:0,l:box.il,w:box.iw,h:box.ih}],counts={},placements=[],productMap=new Map(products.map(p=>[p.sku,p]));
  let productWeight=0,productVolume=0;const innerVolume=box.il*box.iw*box.ih,hasSoft=products.some((p,i)=>remaining[i]&&(p.packRatio??1)<1),limit=Math.min(remaining.reduce((n,q)=>n+q,0),300);
  for(let step=0;step<limit;step++){
    let selected;
    for(let i=0;i<products.length;i++){
      const p=products[i];if((p.packRatio??1)<1||!remaining[i]||box.tare+productWeight+p.weight>box.maxWeight+EPS)continue;
      if(hasSoft&&productVolume+itemVolume(p)>innerVolume*(1-softReserve)+EPS)continue;
      const fit=placement(spaces,p,placementMode,box,placements,productMap);if(!fit)continue;const score=itemScore(p,strategy,productVolume,box.tare+productWeight,box,divisor);if(!selected||score>selected.score)selected={i,fit,score};
    }
    if(!selected)break;const p=products[selected.i],coordinates=put(spaces,selected.fit);counts[p.sku]=(counts[p.sku]||0)+1;placements.push({sku:p.sku,...coordinates});decoratePlacements(placements,products);remaining[selected.i]--;productWeight+=p.weight;productVolume+=itemVolume(p);
  }
  for(let step=placements.length;step<limit;step++){
    let selected=-1,bestVolume=-1;
    for(let i=0;i<products.length;i++){const p=products[i],v=packedVolume(p);if((p.packRatio??1)>=1||!remaining[i]||productVolume+v>innerVolume+EPS||box.tare+productWeight+p.weight>box.maxWeight+EPS)continue;if(v>bestVolume){selected=i;bestVolume=v;}}
    if(selected<0)break;const p=products[selected];counts[p.sku]=(counts[p.sku]||0)+1;placements.push({sku:p.sku,approximate:true,effectiveVolume:bestVolume});remaining[selected]--;productWeight+=p.weight;productVolume+=bestVolume;
  }
  if(!placements.length)return null;decoratePlacements(placements,products);const gross=productWeight+box.tare,volumetric=outerVolume(box)/divisor;
  return{box:box.name,counts,placements,units:placements.length,productWeight,productVolume,gross,volumetric,excess:Math.max(0,volumetric-gross),chargeable:Math.max(gross,volumetric),utilization:productVolume/innerVolume,hasSoft:placements.some(p=>p.approximate),boxCost:Number(box.cost)||0};
}
function targetPenalty(candidate,input){const min=Number(input.targetMinWeight)||0,max=Number(input.targetMaxWeight)||0;return(min&&candidate.gross<min?(min-candidate.gross)*0.4:0)+(max&&candidate.gross>max?(candidate.gross-max)*2:0);}
function runPass(products,boxes,input,bias,placementModes){
  const remaining=products.map(p=>p.qty),result=[],used=new Map();let total=remaining.reduce((a,b)=>a+b,0);
  const maxInnerVolume=Math.max(...boxes.map(b=>b.il*b.iw*b.ih)),minTare=Math.min(...boxes.map(b=>b.tare)),bestOuterRatio=Math.min(...boxes.map(b=>outerVolume(b)/(b.il*b.iw*b.ih)));
  while(total&&result.length<1000){
    let selected;
    for(const box of boxes){if(Number(box.maxQty)>0&&(used.get(box.name)||0)>=Number(box.maxQty))continue;
      for(const strategy of ['volume','weight','light','dense','balance','target','fragile'])for(const mode of placementModes)for(const reserve of(products.some((p,i)=>remaining[i]&&(p.packRatio??1)<1)?[0,0.2,0.4,0.6,0.7]:[0])){
        const candidate=packOne(products,[...remaining],box,input.divisor,strategy,reserve,mode);if(!candidate)continue;let restVolume=0,restWeight=0;
        for(let i=0;i<products.length;i++){const q=remaining[i]-(candidate.counts[products[i].sku]||0);restVolume+=q*packedVolume(products[i]);restWeight+=q*products[i].weight;}
        const future=Math.ceil(restVolume/(maxInnerVolume*0.82)),futureTare=future*minTare,softRemaining=products.some((p,i)=>(p.packRatio??1)<1&&remaining[i]>(candidate.counts[p.sku]||0));
        const futureExcess=Math.max(0,restVolume*bestOuterRatio/(input.divisor*(softRemaining?0.9:0.75))-restWeight-futureTare);
        const score=box.tare+candidate.excess+futureTare+futureExcess+bias*outerVolume(box)/candidate.productVolume+0.1*(1+future)+targetPenalty(candidate,input)+(Number(box.cost)||0)*(input.objective==='minCost'?2:0.05);
        if(!selected||score<selected.score)selected={candidate,score};
      }
    }
    if(!selected)return null;result.push(selected.candidate);used.set(selected.candidate.box,(used.get(selected.candidate.box)||0)+1);for(let i=0;i<products.length;i++)remaining[i]-=selected.candidate.counts[products[i].sku]||0;total-=selected.candidate.units;
  }
  return total?null:result;
}
function rebalance(plan,products,boxes,input){
  const result=[...plan],cache=new Map(),modes=products.some(p=>(p.packRatio??1)<1)?['waste']:['waste','grid'];
  const exact=(box,counts)=>{const q=products.map(p=>counts[p.sku]||0),key=`${box.name}/${q.join('/')}`;if(cache.has(key))return cache.get(key);const wanted=q.reduce((n,x)=>n+x,0);let packed=null;if(wanted)for(const strategy of['volume','weight','light','dense','balance','target','fragile'])for(const mode of modes){const c=packOne(products,[...q],box,input.divisor,strategy,0,mode);if(c?.units===wanted){packed=c;break;}}cache.set(key,packed);return packed;};
  for(let step=0;step<40;step++){
    let best;
    for(let from=0;from<result.length;from++){const source=result[from],sourceBox=boxes.find(b=>b.name===source.box);
      for(const p of products){if(!source.counts[p.sku])continue;const sc={...source.counts,[p.sku]:source.counts[p.sku]-1};if(!sc[p.sku])delete sc[p.sku];const smaller=exact(sourceBox,sc);if(Object.keys(sc).length&&!smaller)continue;
        for(let to=0;to<result.length;to++){if(to===from)continue;const target=result[to],targetBox=boxes.find(b=>b.name===target.box),tc={...target.counts,[p.sku]:(target.counts[p.sku]||0)+1},larger=exact(targetBox,tc);if(!larger)continue;const gain=source.chargeable+target.chargeable-(smaller?.chargeable||0)-larger.chargeable+(smaller?0:0.02);if(gain>EPS&&(!best||gain>best.gain+EPS))best={from,to,smaller,larger,gain};}
      }
    }
    if(!best)break;result[best.to]=best.larger;if(best.smaller)result[best.from]=best.smaller;else result.splice(best.from,1);
  }
  return result;
}
function metrics(plan,input){const sum=k=>plan.reduce((n,c)=>n+(c[k]||0),0),chargeable=sum('chargeable'),packagingCost=sum('boxCost'),freightCost=chargeable*(Number(input.freightRate)||0);return{cartons:plan.length,chargeable,excess:sum('excess'),thrownCartons:plan.filter(c=>c.excess>0.01).length,packagingCost,freightCost,totalCost:packagingCost+freightCost};}
function comparePlans(a,b,input){const A=metrics(a,input),B=metrics(b,input),o=input.objective||'balanced',tuple=m=>o==='minCartons'?[m.cartons,m.chargeable,m.totalCost]:o==='minChargeable'?[m.chargeable,m.cartons,m.totalCost]:o==='minCost'?[m.totalCost,m.chargeable,m.cartons]:o==='noThrow'?[m.thrownCartons,m.excess,m.chargeable,m.cartons]:[(Number(input.freightRate)>0?m.totalCost:m.chargeable+m.packagingCost),m.excess,m.cartons,m.chargeable],x=tuple(A),y=tuple(B);for(let i=0;i<x.length;i++)if(Math.abs(x[i]-y[i])>1e-6)return x[i]-y[i];return 0;}

function validate(input){
  const errors=[];if(!Number.isFinite(input.divisor)||input.divisor<=0)errors.push('体积重换算系数必须大于 0。');if(Number(input.freightRate)<0)errors.push('运费单价不能小于 0。');if(Number(input.targetMaxWeight)>0&&Number(input.targetMinWeight)>Number(input.targetMaxWeight))errors.push('目标毛重下限不能大于上限。');if(!input.products?.length)errors.push('请至少添加一个产品。');if(!input.boxes?.length)errors.push('请至少添加一种外箱。');
  const seen=new Set();for(const[i,p]of(input.products||[]).entries()){if(!p.sku?.trim())errors.push(`产品第 ${i+1} 行缺少 SKU。`);if(seen.has(p.sku))errors.push(`SKU ${p.sku} 重复。`);seen.add(p.sku);if(![p.l,p.w,p.h,p.weight].every(n=>Number.isFinite(n)&&n>0))errors.push(`SKU ${p.sku||i+1} 的尺寸和重量必须大于 0。`);if(p.packRatio!==undefined&&(!Number.isFinite(p.packRatio)||p.packRatio<=0||p.packRatio>1))errors.push(`SKU ${p.sku||i+1} 的装箱体积比例须大于 0 且不超过 100%。`);if(!Number.isInteger(p.qty)||p.qty<0)errors.push(`SKU ${p.sku||i+1} 的数量必须为非负整数。`);if(Number.isFinite(p.maxLoad)&&p.maxLoad<0)errors.push(`SKU ${p.sku||i+1} 的最大承重不能小于 0。`);if(Number.isFinite(p.maxLayers)&&p.maxLayers<1)errors.push(`SKU ${p.sku||i+1} 的最高摆放层必须至少为 1。`);}
  const names=new Set();for(const[i,b]of(input.boxes||[]).entries()){if(!b.name?.trim())errors.push(`外箱第 ${i+1} 行缺少名称。`);if(names.has(b.name))errors.push(`箱规名称 ${b.name} 重复。`);names.add(b.name);if(![b.l,b.w,b.h,b.il,b.iw,b.ih,b.maxWeight].every(n=>Number.isFinite(n)&&n>0)||!Number.isFinite(b.tare)||b.tare<0)errors.push(`外箱 ${b.name||i+1} 的尺寸、箱重或重量上限无效。`);if(Number(b.cost)<0)errors.push(`外箱 ${b.name||i+1} 的纸箱成本不能小于 0。`);if(b.il>b.l||b.iw>b.w||b.ih>b.h)errors.push(`外箱 ${b.name||i+1} 的内尺寸不能大于外尺寸。`);if(b.tare>=b.maxWeight)errors.push(`外箱 ${b.name||i+1} 的重量上限必须大于空箱重。`);if(Number(b.maxQty)<0||!Number.isInteger(Number(b.maxQty||0)))errors.push(`外箱 ${b.name||i+1} 的库存箱数必须为非负整数。`);}
  if((input.products||[]).reduce((n,p)=>n+p.qty,0)>3000)errors.push('一次最多计算 3000 件，请拆成多个批次。');return errors;
}
function optimize(input){
  const errors=validate(input);if(errors.length)return{errors};const products=input.products.filter(p=>p.qty>0);if(!products.length)return{errors:['请填写至少一个大于 0 的产品数量。']};
  const boxes=input.boxes;
  const unmatched=products.filter(p=>!boxes.some(b=>b.tare+p.weight<=b.maxWeight+EPS&&orientations(p).some(d=>d.l<=b.il+EPS&&d.w<=b.iw+EPS&&d.h<=b.ih+EPS))).map(p=>p.sku);if(unmatched.length)return{errors:[`以下产品无法放入任何候选外箱，或超过单箱重量上限：${unmatched.join('、')}`]};
  const hasSoft=products.some(p=>(p.packRatio??1)<1),softVariants=[products];if(hasSoft)for(const floor of[0.9,0.95,1])if(products.some(p=>(p.packRatio??1)<floor))softVariants.push(products.map(p=>({...p,packRatio:Math.max(p.packRatio??1,floor)})));
  const modeSets=hasSoft?[['waste']]:[['waste'],['grid'],['waste','grid']],plans=[];for(const ps of softVariants)for(const bias of[0.08,1.2])for(const modes of modeSets){const plan=runPass(ps,boxes,input,bias,modes);if(plan)plans.push(plan);}if(!plans.length)return{errors:['未能在当前箱规库存、尺寸、承重和摆放限制下生成方案。请增加箱规库存或放宽限制。']};
  plans.sort((a,b)=>comparePlans(a,b,input));const byCount=[...plans].sort((a,b)=>a.length-b.length||comparePlans(a,b,input)),shortlist=[...new Set([...plans.slice(0,2),...byCount.slice(0,1)])],balanced=shortlist.map(p=>rebalance(p,products,boxes,input));balanced.sort((a,b)=>comparePlans(a,b,input));
  const cartons=balanced[0].map((c,i)=>{const box=boxes.find(b=>b.name===c.box),actualVolume=products.reduce((n,p)=>n+(c.counts[p.sku]||0)*packedVolume(p),0);decoratePlacements(c.placements,products);return{...c,number:i+1,productVolume:actualVolume,utilization:actualVolume/(box.il*box.iw*box.ih)};});
  const sum=k=>cartons.reduce((n,c)=>n+(c[k]||0),0),pm=metrics(cartons,input),rigid=cartons.flatMap(c=>c.placements.filter(p=>!p.approximate)),elevated=rigid.filter(p=>p.z>EPS);
  return{cartons,summary:{cartons:cartons.length,units:sum('units'),gross:sum('gross'),volumetric:sum('volumetric'),chargeable:sum('chargeable'),excess:sum('excess'),thrownCartons:cartons.filter(c=>c.excess>0.01).length,utilization:cartons.reduce((n,c)=>n+c.utilization,0)/cartons.length,packagingCost:pm.packagingCost,freightCost:pm.freightCost,totalCost:pm.totalCost,minSupport:elevated.length?Math.min(...elevated.map(p=>p.supportRatio)):1,maxLoadRatio:Math.max(0,...rigid.map(p=>{const product=products.find(x=>x.sku===p.sku);return Number.isFinite(product?.maxLoad)&&product.maxLoad>0?p.loadAbove/product.maxLoad:0;})),pathChecked:rigid.length}};
}

const decoder = new TextDecoder('utf-8');
const normalize = value => String(value ?? '').toLowerCase().replace(/[\s_（）()\[\]【】:：/\\.-]/g, '');
const colIndex = ref => {
  const letters = String(ref).match(/^[A-Z]+/i)?.[0] || '';
  let n = 0; for (const ch of letters.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
};

async function unzip(buffer) {
  const bytes = new Uint8Array(buffer), view = new DataView(buffer);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65558); i--) if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('不是有效的 XLSX 文件。');
  const entries = view.getUint16(eocd + 10, true), centralOffset = view.getUint32(eocd + 16, true), files = new Map();
  let pointer = centralOffset;
  for (let i = 0; i < entries; i++) {
    if (view.getUint32(pointer, true) !== 0x02014b50) throw new Error('XLSX 压缩目录损坏。');
    const method = view.getUint16(pointer + 10, true), compressedSize = view.getUint32(pointer + 20, true);
    const nameLength = view.getUint16(pointer + 28, true), extraLength = view.getUint16(pointer + 30, true), commentLength = view.getUint16(pointer + 32, true), localOffset = view.getUint32(pointer + 42, true);
    const name = decoder.decode(bytes.slice(pointer + 46, pointer + 46 + nameLength));
    const localNameLength = view.getUint16(localOffset + 26, true), localExtraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + localExtraLength, compressed = bytes.slice(start, start + compressedSize);
    let data;
    if (method === 0) data = compressed;
    else if (method === 8) {
      if (typeof DecompressionStream === 'undefined') throw new Error('当前浏览器不支持本地解压 XLSX，请改用 CSV。');
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      data = new Uint8Array(await new Response(stream).arrayBuffer());
    } else throw new Error(`暂不支持 XLSX 压缩方式 ${method}。`);
    files.set(name.replace(/^\//, ''), data);
    pointer += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

function decodeXml(value) { return String(value ?? '').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&'); }
function attributes(text) { const result={}; for(const match of text.matchAll(/([\w:.-]+)="([^"]*)"/g)) result[match[1]]=decodeXml(match[2]); return result; }
function parseSharedStrings(files) {
  const bytes = files.get('xl/sharedStrings.xml'); if (!bytes) return [];
  const source=decoder.decode(bytes);
  return [...source.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(si=>[...si[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(t=>decodeXml(t[1])).join(''));
}
function workbookSheets(files) {
  const workbook = files.get('xl/workbook.xml'), rels = files.get('xl/_rels/workbook.xml.rels');
  if (!workbook || !rels) throw new Error('XLSX 缺少工作簿结构。');
  const relationships = new Map([...decoder.decode(rels).matchAll(/<Relationship\b([^>]*)\/?\s*>/g)].map(match=>{const a=attributes(match[1]);return[a.Id,a.Target];}));
  return [...decoder.decode(workbook).matchAll(/<sheet\b([^>]*)\/?\s*>/g)].map(match => {
    const a=attributes(match[1]),target=relationships.get(a['r:id'])||'';
    return { name:a.name||'Sheet', path:`xl/${target.replace(/^\/?xl\//, '').replace(/^\//, '')}`.replace('/worksheets/../', '/') };
  });
}
function parseSheet(bytes, shared) {
  const source=decoder.decode(bytes),rows=[];
  for (const match of source.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
    const a=attributes(match[1]),body=match[2],index=colIndex(a.r),type=a.t;
    let value = '';
    if (type === 'inlineStr') value = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(t=>decodeXml(t[1])).join('');
    else {
      const raw = decodeXml(body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1] ?? '');
      if (type === 's') value = shared[Number(raw)] ?? '';
      else if (type === 'b') value = raw === '1';
      else value = raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : raw;
    }
    const row = Number(a.r?.match(/\d+/)?.[0] || 1) - 1;
    rows[row] ||= []; rows[row][index] = value;
  }
  return rows;
}

function parseDelimited(text, separator) {
  const rows = []; let row = [], value = '', quoted = false;
  for (let i = 0; i <= text.length; i++) {
    const ch = text[i] ?? '\n';
    if (quoted && ch === '"' && text[i + 1] === '"') { value += '"'; i++; }
    else if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === separator) { row.push(value); value = ''; }
    else if (!quoted && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(value); if (row.some(v => String(v).trim())) rows.push(row); row = []; value = '';
    } else value += ch;
  }
  return rows;
}

const aliases = {
  sku:['sku','msku','fnsku','sellersku','产品编码','商品编码','货号','型号'],
  name:['产品名称','商品名称','品名','名称','title','productname'],
  l:['长','长度','单件长','包装长','length','长cm'], w:['宽','宽度','单件宽','包装宽','width','宽cm'], h:['高','高度','单件高','包装高','height','高cm'],
  weight:['单件重量','单件重','单重','重量','weight','重量g','重量kg'], qty:['数量','发货数量','备货数量','总数量','qty','quantity','计划发货数量'],
  packRatio:['装箱体积','装箱体积比例','压缩比例','packratio'],
};
function matchField(value) {
  const n = normalize(value);
  for (const [field, list] of Object.entries(aliases)) if (list.some(a => n === normalize(a) || (normalize(a).length > 2 && n.includes(normalize(a))))) return field;
  return null;
}
function detectTable(rows) {
  let best = null;
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const mapping = {}; (rows[r] || []).forEach((value, c) => { const field = matchField(value); if (field && mapping[field] === undefined) mapping[field] = c; });
    const score = ['sku','l','w','h','weight','qty'].filter(key => mapping[key] !== undefined).length;
    if (!best || score > best.score) best = { row:r, mapping, score, headers:rows[r] || [] };
  }
  if (best?.score >= 5 && best.mapping.sku !== undefined && best.mapping.qty !== undefined) return best;
  // Common 卓雅/恒泰 template: C=SKU, D=name, G:K=length/width/height/weight/quantity.
  const templateRow = rows.slice(0,40).find(row => String(row?.[1] || '').includes('-') && [6,7,8,9,10].filter(c => Number(row?.[c]) > 0).length >= 4);
  if (templateRow) return { row:-1, mapping:{sku:1,name:5,l:6,w:7,h:8,weight:9,qty:10}, score:6, headers:['','','','','','','长','宽','高','单件重量 g','数量'] };
  const viable = rows.slice(0,40).some(row => String(row?.[2] || '').includes('-') && [6,7,8,9,10].filter(c => Number(row?.[c]) > 0).length >= 4);
  return viable ? { row:-1, mapping:{sku:2,name:3,l:6,w:7,h:8,weight:9,qty:10}, score:6, headers:['','','','','','','长','宽','高','单件重量 g','数量'] } : null;
}
function number(value) { const n = Number(String(value ?? '').replace(/,/g,'').trim()); return Number.isFinite(n) ? n : NaN; }
function productsFromRows(rows, info) {
  const products = [], weightHeader = normalize(info.headers[info.mapping.weight] || '');
  const weightInGrams = weightHeader.includes('g') && !weightHeader.includes('kg') || weightHeader.includes('克');
  for (let r = info.row + 1; r < rows.length; r++) {
    const row = rows[r] || [], sku = String(row[info.mapping.sku] ?? '').trim();
    if (!sku) continue;
    const l=number(row[info.mapping.l]),w=number(row[info.mapping.w]),h=number(row[info.mapping.h]),rawWeight=number(row[info.mapping.weight]),qty=number(row[info.mapping.qty]);
    if (![l,w,h,rawWeight,qty].every(Number.isFinite) || l<=0 || w<=0 || h<=0 || rawWeight<=0 || qty<0 || !Number.isInteger(qty)) continue;
    const likelyGrams = weightInGrams || rawWeight > 80;
    products.push({sku,name:info.mapping.name===undefined?'':String(row[info.mapping.name]??'').trim(),l,w,h,weight:likelyGrams?rawWeight/1000:rawWeight,qty,
      packRatio:info.mapping.packRatio===undefined?1:Math.min(1,Math.max(0.01,number(row[info.mapping.packRatio])/(number(row[info.mapping.packRatio])>1?100:1))),orientation:'any',rotate:true,canSupport:true,maxLayers:99,maxLoad:999,sizeFactor:1});
  }
  return products;
}
function mergeProducts(groups) {
  const merged = new Map();
  for (const product of groups.flat()) {
    const existing = merged.get(product.sku);
    if (!existing) merged.set(product.sku, product);
    else if ([existing.l,existing.w,existing.h,existing.weight].every((v,i)=>Math.abs(v-[product.l,product.w,product.h,product.weight][i])<1e-8)) existing.qty += product.qty;
  }
  return [...merged.values()];
}

async function readProductsFile(file) {
  const extension = file.name.split('.').pop().toLowerCase(); let sheets;
  if (extension === 'csv' || extension === 'tsv') {
    const text = await file.text(), rows = parseDelimited(text, extension === 'tsv' || text.includes('\t') ? '\t' : ',');
    sheets = [{name:file.name, rows}];
  } else if (extension === 'xlsx') {
    const files = await unzip(await file.arrayBuffer()), shared = parseSharedStrings(files);
    sheets = workbookSheets(files).filter(s => files.has(s.path)).map(s => ({name:s.name, rows:parseSheet(files.get(s.path),shared)}));
  } else throw new Error('请选择 .xlsx、.csv 或 .tsv 文件。');
  const found = [];
  for (const sheet of sheets) { const info = detectTable(sheet.rows); if (!info) continue; const products = productsFromRows(sheet.rows,info); if (products.length) found.push({sheet:sheet.name,products}); }
  const products = mergeProducts(found.map(x=>x.products));
  if (!products.length) throw new Error('没有识别到完整的 SKU、长、宽、高、重量和数量。请检查表头，或使用批量粘贴。');
  return { products, sheets:found.map(x=>x.sheet), warning:found.length>1?'已合并多个工作表中尺寸一致的同名 SKU。':'' };
}


const KEY=window.BOXWISE_SCENARIO_ID?`boxwise-${window.BOXWISE_SCENARIO_ID}`:'boxwise-v1';
const PROGRESS_KEY=`${KEY}-operations`,FEEDBACK_KEY=`${KEY}-feedback`,HISTORY_KEY='boxwise-shipment-history-v1',BOX_LIBRARY_KEY='boxwise-box-library-v1';
const demo={divisor:6000,objective:'balanced',freightRate:0,targetMinWeight:18,targetMaxWeight:23,products:[
  {sku:'DEMO-LIGHT',name:'示例轻货',l:24,w:18,h:10,weight:.32,qty:24,packRatio:1,orientation:'any',canSupport:true,maxLoad:20,maxLayers:5,sizeFactor:1},
  {sku:'DEMO-HEAVY',name:'示例重货',l:14,w:12,h:9,weight:.9,qty:18,packRatio:1,orientation:'any',canSupport:true,maxLoad:40,maxLayers:5,sizeFactor:1},
  {sku:'DEMO-MID',name:'示例中等货',l:18,w:15,h:8,weight:.48,qty:12,packRatio:1,orientation:'any',canSupport:true,maxLoad:25,maxLayers:5,sizeFactor:1}],boxes:[
  {name:'40 × 30 × 30',l:40,w:30,h:30,il:39,iw:29,ih:29,tare:.55,maxWeight:20,cost:0,maxQty:0},
  {name:'50 × 40 × 35',l:50,w:40,h:35,il:49,iw:39,ih:34,tare:.8,maxWeight:23,cost:0,maxQty:0}]};
const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=n=>Number.isFinite(n)?n.toFixed(2).replace(/\.00$/,''):'—',clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const PRODUCT_COLORS=['#4d91d8','#ed9565','#34aa9b','#a67dd3','#d8af4d','#dd748f','#6984be','#8ba85c'];
function productColor(sku,carton){const approximate=carton?.placements?.some(p=>p.sku===sku&&p.approximate),index=state.products.findIndex(p=>p.sku===sku);return approximate?'#9daeb1':PRODUCT_COLORS[(index<0?0:index)%PRODUCT_COLORS.length];}
function cartonProducts(carton){return Object.entries(carton.counts).map(([sku,quantity])=>({sku,quantity,product:state.products.find(p=>p.sku===sku),color:productColor(sku,carton)}));}
function cartonProductPreview(carton){return cartonProducts(carton).map(item=>`<span title="${esc(item.product?.name||item.sku)}"><i style="background:${item.color}"></i>${esc(item.sku)} × ${item.quantity}</span>`).join('');}
function cartonProductList(carton){const items=cartonProducts(carton);return`<div class="carton-products-heading"><strong>本箱产品清单</strong><span>${items.length} 种产品 · ${carton.units} 件</span></div><div class="carton-products">${items.map(item=>`<div class="carton-product-row"><i style="background:${item.color}"></i><div><strong>${esc(item.sku)}</strong><span>${esc(item.product?.name||'未填写产品名称')}</span></div><b>× ${item.quantity}<small>件</small></b></div>`).join('')}</div>`;}
function normalizeState(raw){
  const s=structuredClone(raw||demo);s.shipmentName||='';s.objective||='balanced';s.freightRate=Number(s.freightRate)||0;s.targetMinWeight=Number(s.targetMinWeight)||0;s.targetMaxWeight=Number(s.targetMaxWeight)||0;
  s.products=(s.products||[]).map(p=>({...p,packRatio:p.packRatio??1,orientation:p.orientation||(p.rotate===false?'fixed':'any'),rotate:p.rotate!==false,fragile:!!p.fragile,canSupport:p.canSupport!==false,maxLoad:Number.isFinite(Number(p.maxLoad))?Number(p.maxLoad):999,maxLayers:Number.isFinite(Number(p.maxLayers))?Number(p.maxLayers):99,sizeFactor:Number.isFinite(Number(p.sizeFactor))?Number(p.sizeFactor):1}));
  s.boxes=(s.boxes||[]).map(b=>({...b,cost:Number(b.cost)||0,maxQty:Number(b.maxQty)||0}));return s;
}
let state;try{const saved=JSON.parse(localStorage.getItem(KEY));state=normalizeState(saved?.products&&saved?.boxes?saved:(window.BOXWISE_INITIAL_STATE||demo));}catch{state=normalizeState(window.BOXWISE_INITIAL_STATE||demo);}
let result=null,ruleIndex=-1,progress={},feedback=[],shipmentHistory=[];
try{progress=JSON.parse(localStorage.getItem(PROGRESS_KEY))||{};}catch{}
try{feedback=JSON.parse(localStorage.getItem(FEEDBACK_KEY))||[];}catch{}
try{shipmentHistory=JSON.parse(localStorage.getItem(HISTORY_KEY))||[];}catch{}
function save(){try{localStorage.setItem(KEY,JSON.stringify(state));}catch{}}
function saveOperations(){try{localStorage.setItem(PROGRESS_KEY,JSON.stringify(progress));}catch{}}
function saveFeedbackStore(){try{localStorage.setItem(FEEDBACK_KEY,JSON.stringify(feedback));}catch{}}
function saveShipmentStore(){try{localStorage.setItem(HISTORY_KEY,JSON.stringify(shipmentHistory));}catch{}}
function invalidate(){result=null;progress={};saveOperations();$('results').hidden=true;$('messages').hidden=true;save();updateCounts();}
function input(field,value,cls='',type='number',extra=''){return`<input class="${cls}" data-field="${field}" type="${type}" ${type==='number'?'step="any" min="0" inputmode="decimal"':''} value="${esc(value)}" ${extra}>`;}
function ruleSummary(p){const orientation={any:'任意旋转',upright:'保持竖直',fixed:'固定方向'}[p.orientation]||'任意旋转';const flags=[orientation];if(p.fragile)flags.push('易碎');if(p.canSupport===false)flags.push('不承重');if((p.sizeFactor??1)!==1)flags.push(`校准 ${Math.round(p.sizeFactor*100)}%`);return flags.join(' · ');}
function renderProducts(){
  $('products-body').innerHTML=state.products.map((p,i)=>`<tr data-index="${i}"><td><div class="product-name-cell">${input('sku',p.sku,'sku-input','text','aria-label="SKU"')}${input('name',p.name,'name-input','text','aria-label="产品名称"')}</div></td><td>${input('l',p.l,'','','aria-label="产品长"')}</td><td>${input('w',p.w,'','','aria-label="产品宽"')}</td><td>${input('h',p.h,'','','aria-label="产品高"')}</td><td>${input('weight',p.weight,'','','aria-label="单件重量"')}</td><td>${input('qty',p.qty,'','','aria-label="数量"')}</td><td>${input('packRatio',Math.round((p.packRatio??1)*100),'','','aria-label="装箱体积比例"')}</td><td><button type="button" class="rule-button" data-rule="${i}">${esc(ruleSummary(p))}</button></td><td><button type="button" class="remove-row" data-remove="product" aria-label="删除产品">×</button></td></tr>`).join('');updateCounts();
}
function renderBoxes(){
  $('boxes-body').innerHTML=state.boxes.map((b,i)=>`<tr data-index="${i}"><td>${input('name',b.name,'box-name-input','text')}</td><td>${input('l',b.l)}</td><td>${input('w',b.w)}</td><td>${input('h',b.h)}</td><td>${input('il',b.il)}</td><td>${input('iw',b.iw)}</td><td>${input('ih',b.ih)}</td><td>${input('tare',b.tare)}</td><td>${input('maxWeight',b.maxWeight)}</td><td>${input('cost',b.cost??0)}</td><td>${input('maxQty',b.maxQty??0,'','','title="0 表示不限库存"')}</td><td><button type="button" class="remove-row" data-remove="box" aria-label="删除箱规">×</button></td></tr>`).join('');updateCounts();
}
function updateCounts(){$('product-count').textContent=`${state.products.length} SKU`;$('box-count').textContent=`${state.boxes.length} 种`;$('total-units').textContent=`合计 ${state.products.reduce((n,p)=>n+(Number(p.qty)||0),0)} 件`;}
function onTableChange(kind,e){
  const row=e.target.closest('tr[data-index]');if(!row)return;const i=Number(row.dataset.index);
  if(e.target.dataset.remove){state[kind].splice(i,1);kind==='products'?renderProducts():renderBoxes();invalidate();return;}
  const field=e.target.dataset.field;if(!field)return;state[kind][i][field]=e.target.type==='number'?(e.target.value===''?NaN:Number(e.target.value)/(field==='packRatio'?100:1)):e.target.value;invalidate();
}
function showMessage(lines,type='error'){$('messages').innerHTML=lines.map(esc).join('<br>');$('messages').classList.toggle('success',type==='success');$('messages').hidden=false;$('messages').scrollIntoView({behavior:'smooth',block:'center'});}
function cartonView(number){const carton=result?.cartons[Number(number)-1],box=state.boxes.find(b=>b.name===carton?.box);return carton&&box?{carton,box,products:state.products}:null;}
function previewCarton(number){const view=cartonView(number);if(!view)return;window.BoxwiseViewer.preview(view);const rigid=view.carton.placements.filter(p=>!p.approximate).length,soft=view.carton.placements.length-rigid;$('preview-play').disabled=!rigid;$('preview-legend').innerHTML=cartonProducts(view.carton).map(item=>`<div><i style="background:${item.color}"></i><span><strong>${esc(item.sku)}</strong><small>${esc(item.product?.name||'')}</small></span><b>× ${item.quantity} 件</b></div>`).join('');$('preview-coverage').textContent=soft?`本箱 ${rigid} 件固定产品可逐件播放；${soft} 件可压缩产品只做体积估算。`:`本箱 ${rigid} 件固定产品已通过尺寸、支撑、承重和顶部放入路径检查。`;}
function objectiveName(){return{balanced:'综合平衡',noThrow:'优先不抛',minCartons:'最少箱数',minChargeable:'最低计费重',minCost:'最低预计成本'}[state.objective]||'综合平衡';}
function renderOperations(){
  $('operations-list').innerHTML=result.cartons.map(c=>{const p=progress[c.number]||{};return`<div class="operation-row" data-carton="${c.number}"><label class="operation-check"><input type="checkbox" data-operation="done" ${p.done?'checked':''}> 箱 ${String(c.number).padStart(2,'0')} 已完成</label><span>${esc(c.box)} · ${c.units} 件</span><span class="operation-products">${cartonProducts(c).map(item=>`<b><i style="background:${item.color}"></i>${esc(item.sku)} × ${item.quantity}</b><small>${esc(item.product?.name||'')}</small>`).join('')}</span><label>实测毛重 <input type="number" min="0" step="any" data-operation="gross" value="${esc(p.gross??'')}"> kg</label></div>`;}).join('');
}
function updateFeedbackSku(){const carton=result?.cartons[Number($('feedback-carton').value)-1];$('feedback-sku').innerHTML='<option value="*">本箱全部 SKU</option>'+Object.keys(carton?.counts||{}).map(sku=>`<option value="${esc(sku)}">${esc(sku)}</option>`).join('');}
function renderFeedbackHistory(){
  $('feedback-history').innerHTML=feedback.length?`<table><thead><tr><th>时间</th><th>箱号</th><th>结果</th><th>SKU</th><th>实测毛重</th><th>校准</th><th>备注</th></tr></thead><tbody>${feedback.slice(-20).reverse().map(x=>`<tr><td>${esc(x.time.slice(0,16).replace('T',' '))}</td><td>${x.carton}</td><td>${esc({ok:'正常',tight:'偏紧',fail:'装不下',roomy:'空隙较大'}[x.status])}</td><td>${esc(x.sku==='*'?'本箱全部':x.sku)}</td><td>${x.gross||'—'}</td><td>${esc(x.adjustment)}</td><td>${esc(x.note||'')}</td></tr>`).join('')}</tbody></table>`:'<p class="empty-feedback">暂无实装反馈。</p>';
}
function renderShipmentHistory(){
  const host=$('shipment-history');if(!host)return;
  host.innerHTML=shipmentHistory.length?shipmentHistory.slice().reverse().map(item=>`<div class="shipment-history-row" data-history-id="${item.id}"><div><strong>${esc(item.name)}</strong><small>${esc(item.time.slice(0,16).replace('T',' '))}</small></div><span>${item.summary.cartons} 箱 · ${item.summary.units} 件 · 计费重 ${num(item.summary.chargeable)} kg</span><div><button type="button" class="button ghost" data-history-load>恢复</button><button type="button" class="button ghost" data-history-delete>删除</button></div></div>`).join(''):'<p class="empty-feedback">暂无已保存货件。</p>';
}
function saveCurrentShipment(){
  if(!result)return;const name=state.shipmentName.trim()||`货件 ${new Date().toLocaleDateString('zh-CN')}`;
  shipmentHistory.push({id:`${Date.now()}-${Math.random().toString(36).slice(2,7)}`,name,time:new Date().toISOString(),state:structuredClone(state),summary:structuredClone(result.summary)});
  shipmentHistory=shipmentHistory.slice(-30);saveShipmentStore();renderShipmentHistory();showMessage([`已保存“${name}”，可从历史货件恢复。`],'success');
}
function saveBoxLibrary(){try{localStorage.setItem(BOX_LIBRARY_KEY,JSON.stringify(state.boxes));showMessage([`已保存 ${state.boxes.length} 种箱规到本机箱规库。`],'success');}catch{showMessage(['箱规库保存失败，请检查浏览器存储权限。']);}}
function loadBoxLibrary(){try{const boxes=JSON.parse(localStorage.getItem(BOX_LIBRARY_KEY));if(!Array.isArray(boxes)||!boxes.length){showMessage(['本机箱规库为空，请先保存当前箱规。']);return;}state.boxes=normalizeState({...state,boxes}).boxes;renderBoxes();invalidate();showMessage([`已载入 ${boxes.length} 种箱规。`],'success');}catch{showMessage(['箱规库读取失败。']);}}
function renderPrintArea(){
  $('print-area').innerHTML=`<div class="print-title"><h1>混箱装箱操作单</h1><p>${new Date().toLocaleString('zh-CN')} · ${result.summary.cartons} 箱 · ${result.summary.units} 件</p></div>`+result.cartons.map(c=>`<article class="packing-label"><header><strong>箱 ${String(c.number).padStart(2,'0')}</strong><span>${esc(c.box)}</span></header><div class="label-metrics"><span>计划毛重 ${num(c.gross)} kg</span><span>计费重 ${num(c.chargeable)} kg</span><span>${c.excess>.01?`抛 ${num(c.excess)} kg`:'不抛'}</span></div><table><thead><tr><th>SKU</th><th>产品</th><th>数量</th></tr></thead><tbody>${Object.entries(c.counts).map(([sku,n])=>{const p=state.products.find(x=>x.sku===sku);return`<tr><td>${esc(sku)}</td><td>${esc(p?.name||'')}</td><td>${n}</td></tr>`;}).join('')}</tbody></table><footer>□ 已装箱　实测毛重：________ kg　操作员：________</footer></article>`).join('');
}
function renderResult(scroll=true){
  const{cartons,summary}=result;$('m-cartons').textContent=summary.cartons;$('m-gross').textContent=num(summary.gross);$('m-billable').textContent=num(summary.chargeable);$('m-excess').textContent=num(summary.excess);$('m-excess-note').textContent=`kg · ${summary.thrownCartons} 箱抛货`;$('m-cost').textContent=state.freightRate||state.boxes.some(b=>b.cost)?num(summary.totalCost):'未设置';
  const note=$('result-note');note.classList.toggle('warn',summary.thrownCartons>0);note.textContent=`当前按“${objectiveName()}”选择方案；刚性产品已检查顶部放入路径 ${summary.pathChecked} 件，最低底面支撑 ${Math.round(summary.minSupport*100)}%。${summary.thrownCartons?`仍有 ${summary.thrownCartons} 箱抛，合计 ${num(summary.excess)} kg。`:'每箱实重均不低于体积重。'}${state.products.some(p=>(p.packRatio??1)<1)?' 可压缩产品只按有效体积估算，须实物试装。':''}`;
  $('carton-list').innerHTML=cartons.map((c,index)=>`<details class="carton" ${index===0?'open':''}><summary><strong>箱号 ${String(c.number).padStart(2,'0')}</strong><div class="carton-summary-products"><span>${esc(c.box)} · <b>${c.units}</b> 件 · ${Object.keys(c.counts).length} 种产品</span><div class="carton-product-preview">${cartonProductPreview(c)}</div></div><span>实重 <b>${num(c.gross)}</b> kg</span><span>体积重 <b>${num(c.volumetric)}</b> kg</span><span>利用率 <b>${Math.round(c.utilization*100)}%</b></span><em class="${c.excess>.01?'warn':''}">${c.excess>.01?`抛 ${num(c.excess)} kg`:'不抛'}</em></summary><div class="carton-detail">${cartonProductList(c)}<div class="carton-detail-footer"><div class="placement-note">颜色与 3D 图例一致。固定产品已做尺寸、支撑、承重和顶部放入路径检查；重量含空箱，实际打包请复核。</div><button type="button" class="view-3d" data-view-carton="${c.number}">◈ 查看本箱 3D 装箱</button></div></div></details>`).join('');
  const head=`<thead><tr><th>SKU / 产品</th>${cartons.map(c=>`<th><span class="matrix-carton-head">箱 ${c.number}<small>${c.units} 件</small></span></th>`).join('')}<th>合计</th></tr></thead>`,body=state.products.filter(p=>p.qty>0).map(p=>`<tr><td><div class="matrix-product"><i style="background:${productColor(p.sku)}"></i><span><strong>${esc(p.sku)}</strong><small>${esc(p.name)}</small></span></div></td>${cartons.map(c=>`<td>${c.counts[p.sku]||'—'}</td>`).join('')}<td>${p.qty}</td></tr>`).join(''),footer=`<tr class="total-row"><td>每箱合计</td>${cartons.map(c=>`<td>${c.units}</td>`).join('')}<td>${summary.units}</td></tr>`;$('matrix').innerHTML=head+`<tbody>${body}${footer}</tbody>`;
  $('preview-carton').innerHTML=cartons.map(c=>`<option value="${c.number}">箱 ${String(c.number).padStart(2,'0')} · ${c.units} 件 · ${Object.keys(c.counts).length} 种产品</option>`).join('');$('feedback-carton').innerHTML=cartons.map(c=>`<option value="${c.number}">箱 ${String(c.number).padStart(2,'0')} · ${c.units} 件</option>`).join('');
  renderOperations();updateFeedbackSku();renderFeedbackHistory();renderShipmentHistory();renderPrintArea();$('results').hidden=false;requestAnimationFrame(()=>previewCarton(1));if(scroll)requestAnimationFrame(()=>$('results').scrollIntoView({behavior:'smooth',block:'start'}));
}
function calculate(scroll=true){const calculated=optimize(state);if(calculated.errors){showMessage(calculated.errors);return false;}result=calculated;$('messages').hidden=true;renderResult(scroll);return true;}
function csvCell(v){const s=String(v??'');return/[,"\n]/.test(s)?`"${s.replaceAll('"','""')}"`:s;}
function download(content,type,name){const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function exportCsv(){if(!result)return;const cs=result.cartons,rows=[['SKU','产品名称','装箱体积%','方向','易碎','可承重','最大承重kg','最高层','尺寸校准%',...cs.map(c=>`箱 ${c.number}`),'合计'],...state.products.filter(p=>p.qty>0).map(p=>[p.sku,p.name,Math.round((p.packRatio??1)*100),p.orientation,p.fragile?'是':'否',p.canSupport?'是':'否',p.maxLoad,p.maxLayers,Math.round((p.sizeFactor??1)*100),...cs.map(c=>c.counts[p.sku]||0),p.qty]),[],['箱号','箱规','件数','实重kg','体积重kg','计费重kg','抛重kg','利用率','纸箱成本'],...cs.map(c=>[c.number,c.box,c.units,num(c.gross),num(c.volumetric),num(c.chargeable),num(c.excess),`${Math.round(c.utilization*100)}%`,c.boxCost])];download('\ufeff'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n'),'text/csv;charset=utf-8',`混箱配货方案_${new Date().toISOString().slice(0,10)}.csv`);}
const xmlEsc=v=>String(v??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
function worksheet(name,rows){return`<Worksheet ss:Name="${xmlEsc(name)}"><Table>${rows.map(row=>`<Row>${row.map(value=>`<Cell><Data ss:Type="${typeof value==='number'?'Number':'String'}">${xmlEsc(value)}</Data></Cell>`).join('')}</Row>`).join('')}</Table></Worksheet>`;}
function exportExcel(){if(!result)return;const cs=result.cartons,matrix=[['SKU','产品名称',...cs.map(c=>`箱 ${c.number}`),'合计'],...state.products.filter(p=>p.qty>0).map(p=>[p.sku,p.name,...cs.map(c=>c.counts[p.sku]||0),p.qty])],cartons=[['箱号','箱规','件数','计划毛重kg','体积重kg','计费重kg','抛重kg','利用率','纸箱成本'],...cs.map(c=>[c.number,c.box,c.units,c.gross,c.volumetric,c.chargeable,c.excess,`${Math.round(c.utilization*100)}%`,c.boxCost])],actions=[['箱号','顺序','SKU','x','y','z','摆放长','摆放宽','摆放高','支撑率','承载重量kg'],...cs.flatMap(c=>c.placements.map((p,i)=>[c.number,i+1,p.sku,p.x??'',p.y??'',p.z??'',p.l??'',p.w??'',p.h??'',p.supportRatio??'',p.loadAbove??'']))];const workbook=`<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${worksheet('装箱矩阵',matrix)}${worksheet('逐箱汇总',cartons)}${worksheet('摆放操作',actions)}</Workbook>`;download('\ufeff'+workbook,'application/vnd.ms-excel',`混箱配货方案_${new Date().toISOString().slice(0,10)}.xls`);}
function openRule(index){ruleIndex=index;const p=state.products[index];$('rule-product-name').textContent=`${p.sku} · ${p.name||'未命名产品'}`;$('rule-orientation').value=p.orientation||'any';$('rule-size-factor').value=Math.round((p.sizeFactor??1)*1000)/10;$('rule-max-layers').value=p.maxLayers??99;$('rule-max-load').value=p.maxLoad??999;$('rule-fragile').checked=!!p.fragile;$('rule-support').checked=p.canSupport!==false;$('rule-dialog').showModal();}
function saveRule(){if(ruleIndex<0)return;const p=state.products[ruleIndex];p.orientation=$('rule-orientation').value;p.rotate=p.orientation!=='fixed';p.sizeFactor=clamp(Number($('rule-size-factor').value)/100,.8,1.3);p.maxLayers=Math.max(1,Math.floor(Number($('rule-max-layers').value)||99));p.maxLoad=Math.max(0,Number($('rule-max-load').value)||0);p.fragile=$('rule-fragile').checked;p.canSupport=$('rule-support').checked&&!p.fragile;renderProducts();invalidate();$('rule-dialog').close();}
async function importFile(file){try{const imported=await readProductsFile(file);state.products=imported.products;renderProducts();invalidate();showMessage([`已从 ${imported.sheets.join('、')} 识别 ${imported.products.length} 个 SKU。`,imported.warning].filter(Boolean),'success');}catch(error){showMessage([error.message||String(error)]);}finally{$('import-file').value='';}}
function applyFeedback(){if(!result)return;const carton=Number($('feedback-carton').value),status=$('feedback-status').value,sku=$('feedback-sku').value,gross=Number($('feedback-gross').value)||0,note=$('feedback-note').value.trim(),factor={ok:1,tight:1.01,fail:1.03,roomy:.99}[status];const skus=sku==='*'?Object.keys(result.cartons[carton-1].counts):[sku];for(const code of skus){const p=state.products.find(x=>x.sku===code);if(p)p.sizeFactor=clamp((p.sizeFactor??1)*factor,.8,1.3);}const adjustment=factor===1?'未调整':`${factor>1?'+':'−'}${Math.abs((factor-1)*100).toFixed(0)}% 尺寸系数`;feedback.push({time:new Date().toISOString(),carton,status,sku,gross,note,adjustment});saveFeedbackStore();renderProducts();invalidate();$('feedback-gross').value='';$('feedback-note').value='';showMessage([`反馈已保存，${skus.length} 个 SKU 的尺寸校准已更新；请重新生成方案。`],'success');}

$('products-body').addEventListener('input',e=>onTableChange('products',e));$('products-body').addEventListener('click',e=>{const rule=e.target.closest('[data-rule]');if(rule)openRule(Number(rule.dataset.rule));else if(e.target.dataset.remove)onTableChange('products',e);});
$('workspace-link').addEventListener('click',e=>{e.preventDefault();window.scrollTo({top:0,behavior:'smooth'});$('workspace-link').classList.add('active');$('results-link').classList.remove('active');});
$('results-link').addEventListener('click',e=>{e.preventDefault();if(result||calculate(false)){$('results').scrollIntoView({behavior:'smooth',block:'start'});$('results-link').classList.add('active');$('workspace-link').classList.remove('active');}});
$('boxes-body').addEventListener('input',e=>onTableChange('boxes',e));$('boxes-body').addEventListener('click',e=>{if(e.target.dataset.remove)onTableChange('boxes',e);});
$('add-product').addEventListener('click',()=>{state.products.push({sku:'',name:'',l:'',w:'',h:'',weight:'',qty:0,packRatio:1,orientation:'any',rotate:true,fragile:false,canSupport:true,maxLoad:999,maxLayers:99,sizeFactor:1});renderProducts();invalidate();$('products-body tr:last-child input').focus();});
$('add-box').addEventListener('click',()=>{state.boxes.push({name:'',l:'',w:'',h:'',il:'',iw:'',ih:'',tare:0,maxWeight:'',cost:0,maxQty:0});renderBoxes();invalidate();});
for(const[id,field]of[['divisor','divisor'],['freight-rate','freightRate'],['target-min','targetMinWeight'],['target-max','targetMaxWeight']])$(id).addEventListener('input',e=>{state[field]=e.target.value===''?0:Number(e.target.value);invalidate();});
$('shipment-name').addEventListener('input',e=>{state.shipmentName=e.target.value;save();});
$('objective').addEventListener('change',e=>{state.objective=e.target.value;invalidate();});$('calculate').addEventListener('click',()=>calculate());$('hero-3d-link').addEventListener('click',()=>{if(result||calculate(false))requestAnimationFrame(()=>$('packing-preview').scrollIntoView({behavior:'smooth'}));});
$('save-shipment').addEventListener('click',saveCurrentShipment);$('save-box-library').addEventListener('click',saveBoxLibrary);$('load-box-library').addEventListener('click',loadBoxLibrary);$('download-csv').addEventListener('click',exportCsv);$('download-excel').addEventListener('click',exportExcel);$('print-operations').addEventListener('click',()=>{document.body.classList.add('print-operations');window.print();setTimeout(()=>document.body.classList.remove('print-operations'),500);});
$('preview-carton').addEventListener('change',e=>previewCarton(e.target.value));$('preview-open').addEventListener('click',()=>{const v=cartonView($('preview-carton').value);if(v)window.BoxwiseViewer.open(v);});$('preview-play').addEventListener('click',()=>{const v=cartonView($('preview-carton').value);if(v)window.BoxwiseViewer.play(v);});$('carton-list').addEventListener('click',e=>{const b=e.target.closest('[data-view-carton]'),v=b&&cartonView(b.dataset.viewCarton);if(v)window.BoxwiseViewer.open(v);});
$('operations-list').addEventListener('input',e=>{const row=e.target.closest('[data-carton]');if(!row)return;const n=row.dataset.carton;progress[n]||={};progress[n][e.target.dataset.operation]=e.target.type==='checkbox'?e.target.checked:e.target.value;saveOperations();});
$('feedback-carton').addEventListener('change',updateFeedbackSku);$('save-feedback').addEventListener('click',applyFeedback);$('save-rule').addEventListener('click',saveRule);
$('shipment-history').addEventListener('click',e=>{const row=e.target.closest('[data-history-id]');if(!row)return;const index=shipmentHistory.findIndex(x=>x.id===row.dataset.historyId);if(index<0)return;if(e.target.closest('[data-history-delete]')){shipmentHistory.splice(index,1);saveShipmentStore();renderShipmentHistory();return;}if(e.target.closest('[data-history-load]')){state=normalizeState(shipmentHistory[index].state);renderProducts();renderBoxes();$('shipment-name').value=state.shipmentName;$('divisor').value=state.divisor;$('objective').value=state.objective;$('freight-rate').value=state.freightRate||'';$('target-min').value=state.targetMinWeight||'';$('target-max').value=state.targetMaxWeight||'';save();calculate();}});
$('import-products').addEventListener('click',()=>$('import-file').click());$('import-file').addEventListener('change',e=>{if(e.target.files[0])importFile(e.target.files[0]);});
$('paste-products').addEventListener('click',()=>$('paste-dialog').showModal());$('apply-paste').addEventListener('click',()=>{const lines=$('paste-text').value.trim().split(/\r?\n/).filter(Boolean),products=lines.map(line=>{const f=line.includes('\t')?line.split('\t'):line.split(',');return{sku:(f[0]||'').trim(),name:(f[1]||'').trim(),l:Number(f[2]),w:Number(f[3]),h:Number(f[4]),weight:Number(f[5]),qty:Number(f[6]),packRatio:f[7]?Number(f[7])/100:1,orientation:'any',rotate:true,fragile:false,canSupport:true,maxLoad:999,maxLayers:99,sizeFactor:1};});if(!products.length||products.some(p=>!p.sku||![p.l,p.w,p.h,p.weight].every(n=>n>0)||!Number.isInteger(p.qty)||p.qty<0)){$('paste-dialog').close();showMessage(['粘贴格式不正确。每行需包含 SKU、名称、长、宽、高、单件重和数量。']);return;}state.products=products;renderProducts();invalidate();$('paste-dialog').close();$('paste-text').value='';});
renderProducts();renderBoxes();$('shipment-name').value=state.shipmentName;$('divisor').value=state.divisor;$('objective').value=state.objective;$('freight-rate').value=state.freightRate||'';$('target-min').value=state.targetMinWeight||'';$('target-max').value=state.targetMaxWeight||'';renderFeedbackHistory();renderShipmentHistory();if(window.BOXWISE_AUTO_CALCULATE&&calculate(false))requestAnimationFrame(()=>$('packing-preview').scrollIntoView({behavior:'auto'}));
