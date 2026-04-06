// @ts-nocheck
import { useState, useMemo } from "react";

// ─── Constants ────────────────────────────────────────────────────────────────
const ENGINES = {
  cfm7b: { name:"CFM56-7B", acq:5700000, lrMo:90000,  mroFreqHr:4000, mroCost:4500000, eflHrPa:3500 },
  cfm5b: { name:"CFM56-5B", acq:5200000, lrMo:65000,  mroFreqHr:4000, mroCost:4300000, eflHrPa:3500 },
  v2500: { name:"V2500-A5", acq:4800000, lrMo:75000,  mroFreqHr:4000, mroCost:4000000, eflHrPa:3500 },
};
const POOL  = { purchase:[3,5,8,12,15], slb:[3,6,9,12,15], consignment:[5,10,15,20,25] };
const STAFF = [180000,240000,360000,480000,600000];
const DEBT_RATE=0.065, TAX_RATE=0.09, DEPR_RATE=0.05, APPRC_RATE=0.10;
const INS_PER_ENG=60000, STR_PER_ENG=20000, MGMT_FEE=80000, REV_SHARE=0.30, MRO_IDLE_SH=0.30;

// ─── Palette ──────────────────────────────────────────────────────────────────
const C = {
  bg:       "#F7F8FA",
  card:     "#FFFFFF",
  border:   "#E4E7EE",
  accent:   "#2563EB",
  accent2:  "#7C3AED",
  teal:     "#0D9488",
  amber:    "#D97706",
  red:      "#DC2626",
  green:    "#16A34A",
  txt:      "#111827",
  txt2:     "#4B5563",
  txt3:     "#9CA3AF",
  hi:       "#EFF6FF",
  hiB:      "#DBEAFE",
  pill:     {blue:["#DBEAFE","#1D4ED8"], green:["#DCFCE7","#15803D"], amber:["#FEF3C7","#B45309"], red:["#FEE2E2","#B91C1C"], purple:["#EDE9FE","#6D28D9"]},
};

// ─── Model ────────────────────────────────────────────────────────────────────
function buildModel(engKey, acqModel, util, debtPct, engOvr, poolOvr, intRate=DEBT_RATE, costs={}) {
  const eng  = engOvr  || ENGINES[engKey];
  const pool = poolOvr || POOL[acqModel];
  const INS  = costs.insPerEng  ?? INS_PER_ENG;
  const STR  = costs.strPerEng  ?? STR_PER_ENG;
  const MFEE = costs.mgmtFee    ?? MGMT_FEE;
  const RS   = costs.revShare   ?? REV_SHARE;
  const MIS  = costs.mroIdleSh  ?? MRO_IDLE_SH;
  const TAX  = costs.taxRate    ?? TAX_RATE;
  const DEPR = costs.deprRate   ?? DEPR_RATE;
  const APPR = costs.apprRate   ?? APPRC_RATE;
  const STFF = costs.staffY     ?? STAFF;
  let cumDebt=0,cumCash=0,cumEq=0,cumRE=0;
  return [0,1,2,3,4].map(i=>{
    const engines=pool[i], newEng=i===0?pool[0]:pool[i]-pool[i-1];
    const grossLease=engines*eng.lrMo*12*util;
    const revenue=acqModel==="consignment"?grossLease*RS+engines*MFEE:grossLease;
    const mroCost=acqModel==="consignment"?0:engines*(eng.eflHrPa*(1-util))*(eng.mroCost/eng.mroFreqHr)*MIS;
    const insurance=acqModel==="consignment"?0:engines*INS;
    const storage=acqModel==="consignment"?0:engines*STR;
    const staff=STFF[i]??STFF[STFF.length-1];
    const opex=mroCost+insurance+storage+staff;
    const ebitda=revenue-opex;
    const capex=acqModel==="consignment"?0:newEng*eng.acq;
    const debtDrawn=capex*debtPct, eqDrawn=capex*(1-debtPct);
    cumDebt+=debtDrawn;
    const interest=cumDebt*intRate;
    const ebt=ebitda-interest, tax=Math.max(0,ebt*TAX), netIncome=ebt-tax;
    const depr=(acqModel==="consignment"?0:engines*eng.acq*(1-DEPR*(i+1)))*DEPR;
    const bookVal=acqModel==="consignment"?0:engines*eng.acq*(1-DEPR*(i+1));
    const mktVal=acqModel==="consignment"?0:engines*eng.acq*Math.pow(1+APPR,i+1);
    const cfo=netIncome+depr, cfi=-capex, debtRepay=cumDebt/7, cff=debtDrawn-debtRepay;
    cumCash+=cfo+cfi+cff; cumEq+=eqDrawn; cumRE+=netIncome;
    return {yr:i+1,engines,newEng,grossLease,revenue,mroCost,insurance,storage,staff,opex,
      ebitda,ebitdaM:revenue>0?ebitda/revenue:0,interest,ebt,tax,netIncome,
      niM:revenue>0?netIncome/revenue:0,capex,debtDrawn,eqDrawn,debtRepay,
      bookVal,mktVal,depr,cfo,cfi,cff,ncf:cfo+cfi+cff,cumDebt,cumCash,
      paidEq:cumEq,retEarn:cumRE,totEq:cumEq+cumRE,
      totAssets:bookVal+Math.max(0,cumCash)+500000};
  });
}

// ─── Formatters ───────────────────────────────────────────────────────────────
const fM  = v => v<0?`($${Math.abs(v/1e6).toFixed(1)}M)`:`$${(v/1e6).toFixed(1)}M`;
const fK  = v => v<0?`($${Math.abs(Math.round(v/1000)).toLocaleString()}K)`:`$${Math.round(v/1000).toLocaleString()}K`;
const f0  = v => v<0?`(${Math.abs(Math.round(v/1000)).toLocaleString()})`:`${Math.round(v/1000).toLocaleString()}`;
const pp  = v => `${(v*100).toFixed(1)}%`;
const isNeg = v => typeof v==="number"&&v<0;

// ─── Mini components ──────────────────────────────────────────────────────────
const Pill = ({t,color="blue"})=>{
  const [bg,tc]=C.pill[color]||C.pill.blue;
  return <span style={{display:"inline-block",fontSize:11,fontWeight:600,padding:"2px 10px",borderRadius:999,background:bg,color:tc,letterSpacing:"0.02em"}}>{t}</span>;
};

const KPI = ({label,val,sub,accent=C.accent})=>(
  <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:"16px 18px",borderTop:`3px solid ${accent}`}}>
    <div style={{fontSize:22,fontWeight:700,color:C.txt,letterSpacing:"-0.5px"}}>{val}</div>
    <div style={{fontSize:12,color:C.txt2,marginTop:4,fontWeight:500}}>{label}</div>
    {sub&&<div style={{fontSize:11,color:accent,marginTop:3,fontWeight:600}}>{sub}</div>}
  </div>
);

const SectionHead = ({title,icon})=>(
  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
    {icon&&<span style={{fontSize:16}}>{icon}</span>}
    <div style={{fontSize:12,fontWeight:700,color:C.txt2,textTransform:"uppercase",letterSpacing:"0.08em"}}>{title}</div>
  </div>
);

function DataTable({cols,rows}){
  return(
    <div style={{overflowX:"auto",borderRadius:10,border:`1px solid ${C.border}`}}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
        <thead>
          <tr style={{background:"#F1F5FF"}}>
            {cols.map((c,i)=>(
              <th key={i} style={{textAlign:i===0?"left":"right",padding:"9px 14px",fontSize:11,fontWeight:700,
                color:C.accent,textTransform:"uppercase",letterSpacing:"0.06em",borderBottom:`1px solid ${C.hiB}`,whiteSpace:"nowrap"}}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row,ri)=>(
            <tr key={ri} style={{background:row.hi?"#F8FAFF":row.sec?"#FAFAFA":"#FFFFFF",
              borderBottom:`1px solid ${C.border}`}}>
              {row.cells.map((c,ci)=>(
                <td key={ci} style={{padding:"8px 14px",textAlign:ci===0?"left":"right",
                  fontWeight:row.hi?"700":row.sec?"600":"400",
                  fontSize:row.sec?11:13,letterSpacing:row.sec?"0.05em":"0",
                  color:row.sec?C.txt3:isNeg(c)?C.red:row.hi?C.txt:C.txt,
                  whiteSpace:"nowrap"}}>
                  {row.sec&&ci>0?"":typeof c==="number"?c.toLocaleString():c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NumInput({label,value,onChange,min,max,step,hint}){
  return(
    <div>
      <div style={{fontSize:11,fontWeight:600,color:C.txt2,marginBottom:5,letterSpacing:"0.03em"}}>{label}</div>
      <input type="number" min={min} max={max} step={step} value={value}
        onChange={e=>onChange(+e.target.value||min)}
        style={{width:"100%",padding:"7px 10px",fontSize:13,fontWeight:500,
          border:`1.5px solid ${C.border}`,borderRadius:8,background:C.card,
          color:C.txt,outline:"none",boxSizing:"border-box"}}/>
      {hint&&<div style={{fontSize:11,color:C.accent,marginTop:4,fontWeight:500}}>{hint}</div>}
    </div>
  );
}

const TABS=[
  {id:"overview",label:"Overview",icon:"📊"},
  {id:"pl",label:"P&L",icon:"📈"},
  {id:"cf",label:"Cash Flow",icon:"💵"},
  {id:"bs",label:"Balance Sheet",icon:"🏦"},
  {id:"scenarios",label:"Scenarios",icon:"🔀"},
  {id:"stress",label:"Stress Test",icon:"⚡"},
  {id:"debt",label:"Debt vs Equity",icon:"⚖️"},
];

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App(){
  const [tab,setTab]=useState("overview");
  const [eng,setEng]=useState("cfm7b");
  const [mdl,setMdl]=useState("purchase");
  const [util,setUtil]=useState(75);
  const [debt,setDebt]=useState(60);
  const [showAdv,setShowAdv]=useState(false);

  const base=ENGINES[eng];
  const [lrMo,setLrMo]=useState(base.lrMo);
  const [acqCost,setAcqCost]=useState(base.acq);
  const [mroCost,setMroCost]=useState(base.mroCost);
  const [intRate,setIntRate]=useState(65);
  const [pool,setPool]=useState([...POOL[mdl]]);
  const [insPerEng,setInsPerEng]=useState(INS_PER_ENG);
  const [strPerEng,setStrPerEng]=useState(STR_PER_ENG);
  const [mgmtFee,setMgmtFee]=useState(MGMT_FEE);
  const [revShare,setRevShare]=useState(30);
  const [mroIdleSh,setMroIdleSh]=useState(30);
  const [taxRate,setTaxRate]=useState(9);
  const [deprRate,setDeprRate]=useState(5);
  const [apprRate,setApprRate]=useState(10);
  const [staffY,setStaffY]=useState([...STAFF]);

  useMemo(()=>{const e=ENGINES[eng];setLrMo(e.lrMo);setAcqCost(e.acq);setMroCost(e.mroCost);},[eng]);
  useMemo(()=>{setPool([...POOL[mdl]]);},[mdl]);

  const utilR=util/100,debtR=debt/100,intR=intRate/1000;
  const costs={insPerEng,strPerEng,mgmtFee,revShare:revShare/100,mroIdleSh:mroIdleSh/100,
    taxRate:taxRate/100,deprRate:deprRate/100,apprRate:apprRate/100,staffY};
  const engOvr={...ENGINES[eng],lrMo,acq:acqCost,mroCost};
  const data=useMemo(()=>buildModel(eng,mdl,utilR,debtR,engOvr,pool,intR,costs),
    [eng,mdl,utilR,debtR,lrMo,acqCost,mroCost,intRate,pool.join(","),
     insPerEng,strPerEng,mgmtFee,revShare,mroIdleSh,taxRate,deprRate,apprRate,staffY.join(",")]);

  const SelBox=({value,onChange,opts})=>(
    <select value={value} onChange={e=>onChange(e.target.value)}
      style={{padding:"8px 12px",fontSize:13,fontWeight:500,border:`1.5px solid ${C.border}`,
        borderRadius:8,background:C.card,color:C.txt,cursor:"pointer",width:"100%"}}>
      {opts.map(([v,l])=><option key={v} value={v}>{l}</option>)}
    </select>
  );

  const SliderRow=({label,value,onChange,min,max,step,display})=>(
    <div>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
        <div style={{fontSize:11,fontWeight:600,color:C.txt2,letterSpacing:"0.03em"}}>{label}</div>
        <div style={{fontSize:12,fontWeight:700,color:C.accent}}>{display}</div>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e=>onChange(+e.target.value)}
        style={{width:"100%",accentColor:C.accent}}/>
    </div>
  );

  const ResetBtn=({onClick})=>(
    <button onClick={onClick} style={{fontSize:11,fontWeight:600,padding:"5px 12px",
      border:`1.5px solid ${C.border}`,borderRadius:6,background:"#F8FAFF",
      color:C.accent,cursor:"pointer",letterSpacing:"0.03em"}}>↺ Reset</button>
  );

  return(
    <div style={{background:C.bg,minHeight:"100vh",fontFamily:"'Inter',system-ui,sans-serif",color:C.txt,padding:"0 0 48px"}}>

      {/* ── Top bar ── */}
      <div style={{background:`linear-gradient(135deg,${C.accent} 0%,${C.accent2} 100%)`,padding:"20px 24px 18px",marginBottom:0}}>
        <div style={{fontSize:11,fontWeight:700,color:"rgba(255,255,255,0.7)",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:4}}>PM Aero · Engine Leasing</div>
        <div style={{fontSize:24,fontWeight:800,color:"#FFFFFF",letterSpacing:"-0.5px",marginBottom:2}}>5-Year Financial Model</div>
        <div style={{fontSize:13,color:"rgba(255,255,255,0.75)"}}>All figures in <strong>$000s</strong> (USD thousands) · Adjust any input below — all tabs update live</div>
      </div>

      <div style={{padding:"0 20px"}}>

        {/* ── Controls card ── */}
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:"20px 22px",margin:"16px 0",boxShadow:"0 1px 4px rgba(0,0,0,0.06)"}}>

          {/* Row 1: selects + sliders */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:16,marginBottom:20}}>
            <div><div style={{fontSize:11,fontWeight:700,color:C.txt2,marginBottom:6,textTransform:"uppercase",letterSpacing:"0.06em"}}>Engine type</div>
              <SelBox value={eng} onChange={setEng} opts={[["cfm7b","CFM56-7B"],["cfm5b","CFM56-5B"],["v2500","V2500-A5"]]}/>
            </div>
            <div><div style={{fontSize:11,fontWeight:700,color:C.txt2,marginBottom:6,textTransform:"uppercase",letterSpacing:"0.06em"}}>Acquisition model</div>
              <SelBox value={mdl} onChange={setMdl} opts={[["purchase","Direct purchase"],["slb","Sale-leaseback"],["consignment","Consignment"]]}/>
            </div>
            <SliderRow label="UTILISATION" value={util} onChange={setUtil} min={40} max={95} step={5} display={`${util}%`}/>
            <SliderRow label="DEBT FINANCING" value={debt} onChange={setDebt} min={0} max={80} step={5} display={`${debt}%`}/>
          </div>

          {/* Row 2: core numeric inputs */}
          <div style={{background:"#F8FAFF",borderRadius:10,padding:"14px 16px",marginBottom:12}}>
            <div style={{fontSize:11,fontWeight:700,color:C.accent,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:12}}>Engine &amp; Deal Parameters</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14}}>
              <NumInput label="Monthly lease rate ($)" value={lrMo} onChange={setLrMo} min={1000} max={500000} step={5000} hint={`$${(lrMo/1000).toFixed(0)}K / month`}/>
              <NumInput label="Engine acquisition cost ($)" value={acqCost} onChange={setAcqCost} min={100000} max={15000000} step={100000} hint={`$${(acqCost/1e6).toFixed(2)}M`}/>
              <NumInput label="MRO cost per visit ($)" value={mroCost} onChange={setMroCost} min={500000} max={12000000} step={100000} hint={`$${(mroCost/1e6).toFixed(2)}M`}/>
              <NumInput label="Interest rate (×0.1%)" value={intRate} onChange={setIntRate} min={10} max={150} step={5} hint={`${(intRate/10).toFixed(1)}% per annum`}/>
            </div>
          </div>

          {/* Pool size */}
          <div style={{background:"#F8FAFF",borderRadius:10,padding:"14px 16px",marginBottom:12}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <div style={{fontSize:11,fontWeight:700,color:C.accent,textTransform:"uppercase",letterSpacing:"0.07em"}}>Engine Pool Size by Year</div>
              <ResetBtn onClick={()=>setPool([...POOL[mdl]])}/>
            </div>
            <div style={{display:"flex",gap:10}}>
              {pool.map((v,i)=>(
                <div key={i} style={{flex:1}}>
                  <div style={{fontSize:11,fontWeight:700,color:C.txt3,textAlign:"center",marginBottom:5}}>Y{i+1}</div>
                  <input type="number" min={1} max={100} step={1} value={v}
                    onChange={e=>{const n=[...pool];n[i]=Math.max(1,+e.target.value||1);
                      for(let j=i+1;j<5;j++)if(n[j]<n[j-1])n[j]=n[j-1];
                      for(let j=i-1;j>=0;j--)if(n[j]>n[j+1])n[j]=n[j+1];setPool(n);}}
                    style={{width:"100%",padding:"7px 4px",fontSize:14,fontWeight:700,textAlign:"center",
                      border:`1.5px solid ${C.hiB}`,borderRadius:8,background:C.card,color:C.accent,boxSizing:"border-box"}}/>
                </div>
              ))}
            </div>
          </div>

          {/* Advanced toggle */}
          <button onClick={()=>setShowAdv(!showAdv)}
            style={{fontSize:12,fontWeight:600,color:C.accent,background:"transparent",border:"none",cursor:"pointer",padding:"2px 0",letterSpacing:"0.02em"}}>
            {showAdv?"▲ Hide":"▼ Show"} advanced cost assumptions
          </button>

          {showAdv&&(
            <div style={{marginTop:14,display:"flex",flexDirection:"column",gap:12}}>
              {/* Operating costs */}
              <div style={{background:"#F8FAFF",borderRadius:10,padding:"14px 16px"}}>
                <div style={{fontSize:11,fontWeight:700,color:C.teal,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:12}}>Operating Costs</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14}}>
                  <NumInput label="Insurance / engine / yr ($)" value={insPerEng} onChange={setInsPerEng} min={0} max={500000} step={5000} hint={`$${(insPerEng/1000).toFixed(0)}K`}/>
                  <NumInput label="Storage / engine / yr ($)" value={strPerEng} onChange={setStrPerEng} min={0} max={200000} step={1000} hint={`$${(strPerEng/1000).toFixed(0)}K`}/>
                  <NumInput label="Consignment mgmt fee ($)" value={mgmtFee} onChange={setMgmtFee} min={0} max={500000} step={5000} hint={`$${(mgmtFee/1000).toFixed(0)}K / engine / yr`}/>
                  <NumInput label="MRO idle-time share (%)" value={mroIdleSh} onChange={setMroIdleSh} min={0} max={100} step={5} hint={`${mroIdleSh}% of pro-rated idle MRO`}/>
                </div>
              </div>

              {/* Financial params */}
              <div style={{background:"#F8FAFF",borderRadius:10,padding:"14px 16px"}}>
                <div style={{fontSize:11,fontWeight:700,color:C.amber,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:12}}>Financial Parameters</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14}}>
                  <NumInput label="Consignment rev share (%)" value={revShare} onChange={setRevShare} min={5} max={80} step={5} hint={`PM Aero keeps ${revShare}%`}/>
                  <NumInput label="Corporate tax rate (%)" value={taxRate} onChange={setTaxRate} min={0} max={40} step={1} hint={`${taxRate}% on positive EBT`}/>
                  <NumInput label="Depreciation rate (%)" value={deprRate} onChange={setDeprRate} min={1} max={25} step={1} hint={`${deprRate}% p.a. straight-line`}/>
                  <NumInput label="Asset appreciation (%)" value={apprRate} onChange={setApprRate} min={0} max={30} step={1} hint={`${apprRate}% p.a. market uplift`}/>
                </div>
              </div>

              {/* Staff */}
              <div style={{background:"#F8FAFF",borderRadius:10,padding:"14px 16px"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <div style={{fontSize:11,fontWeight:700,color:C.accent2,textTransform:"uppercase",letterSpacing:"0.07em"}}>Staff &amp; Overheads by Year ($)</div>
                  <ResetBtn onClick={()=>setStaffY([...STAFF])}/>
                </div>
                <div style={{display:"flex",gap:10}}>
                  {staffY.map((v,i)=>(
                    <div key={i} style={{flex:1}}>
                      <div style={{fontSize:11,fontWeight:700,color:C.txt3,textAlign:"center",marginBottom:5}}>Y{i+1}</div>
                      <input type="number" min={0} max={5000000} step={10000} value={v}
                        onChange={e=>{const n=[...staffY];n[i]=+e.target.value||0;setStaffY(n);}}
                        style={{width:"100%",padding:"7px 4px",fontSize:13,fontWeight:600,textAlign:"center",
                          border:`1.5px solid #EDE9FE`,borderRadius:8,background:C.card,color:C.accent2,boxSizing:"border-box"}}/>
                      <div style={{fontSize:10,color:C.txt3,textAlign:"center",marginTop:3}}>${(v/1000).toFixed(0)}K</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Tabs ── */}
        <div style={{display:"flex",gap:4,marginBottom:16,flexWrap:"wrap"}}>
          {TABS.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)}
              style={{padding:"8px 16px",fontSize:13,fontWeight:tab===t.id?"700":"500",
                borderRadius:8,border:"none",cursor:"pointer",transition:"all 0.15s",
                background:tab===t.id?C.accent:"#FFFFFF",
                color:tab===t.id?"#FFFFFF":C.txt2,
                boxShadow:tab===t.id?"0 2px 8px rgba(37,99,235,0.3)":"0 1px 3px rgba(0,0,0,0.07)"}}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* ── Tab content ── */}
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:"22px 22px",boxShadow:"0 1px 4px rgba(0,0,0,0.06)"}}>
          {tab==="overview"  && <OverviewTab  data={data} engine={engOvr} mdl={mdl} utilR={utilR} debtR={debtR} intRate={intRate}/>}
          {tab==="pl"        && <PLTab        data={data}/>}
          {tab==="cf"        && <CFTab        data={data}/>}
          {tab==="bs"        && <BSTab        data={data} mdl={mdl}/>}
          {tab==="scenarios" && <ScenariosTab utilR={utilR} debtR={debtR}/>}
          {tab==="stress"    && <StressTab    eng={eng} debtR={debtR}/>}
          {tab==="debt"      && <DebtTab      eng={eng} mdl={mdl} utilR={utilR}/>}
        </div>
      </div>
    </div>
  );
}

// ─── Overview ─────────────────────────────────────────────────────────────────
function OverviewTab({data,engine,mdl,utilR,debtR,intRate}){
  const y1=data[0],y5=data[4];
  const wt=[
    ["Engines in pool (Y1)",`${y1.engines}`,""],
    ["Monthly lease rate / engine",fK(engine.lrMo),`market rate 2025`],
    ["Annual gross lease / engine",fK(engine.lrMo*12*utilR),`${pp(utilR)} utilisation`],
    ["Total gross lease revenue",fK(y1.grossLease),`${y1.engines} engines`],
    mdl==="consignment"
      ?["Revenue (30% rev-share + fee)",fK(y1.revenue),"PM Aero keeps 30% + mgmt fee"]
      :["Revenue (100% kept)",fK(y1.revenue),"PM Aero owns engines"],
    mdl!=="consignment"
      ?["MRO – idle time only",`(${fK(y1.mroCost)})`,`idle hrs × rate × ${Math.round(y1.mroCost/y1.engines/((engine.eflHrPa*(1-utilR))*(engine.mroCost/engine.mroFreqHr))*100)}% lessor share`]
      :["MRO costs","$0","Owner bears all MRO in consignment"],
    mdl!=="consignment"?["Insurance",`(${fK(y1.insurance)})`,`per engine/yr`]:["Insurance","$0","Owner's cost"],
    mdl!=="consignment"?["Storage",`(${fK(y1.storage)})`,`per engine/yr`]:["Storage","$0","Owner's cost"],
    ["Staff & overheads",`(${fK(y1.staff)})`,"Y1 lean team"],
    null,
    ["EBITDA",fK(y1.ebitda),pp(y1.ebitdaM)+" margin"],
    mdl!=="consignment"
      ?["Interest expense",`(${fK(y1.interest)})`,`$${(y1.cumDebt/1e6).toFixed(1)}M debt × ${(intRate/10).toFixed(1)}%`]
      :["Interest","$0","No debt in consignment"],
    ["Tax",y1.tax>0?`(${fK(y1.tax)})`:"$0","UAE 9% on +ve EBT"],
    null,
    ["NET INCOME",fK(y1.netIncome),pp(y1.niM)+" margin"],
  ];

  return(
    <div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:24}}>
        <KPI label="Y5 Revenue"    val={fM(y5.revenue)}    accent={C.accent}/>
        <KPI label="Y5 EBITDA"     val={fM(y5.ebitda)}     sub={pp(y5.ebitdaM)+" margin"} accent={C.teal}/>
        <KPI label="Y5 Net income" val={fM(y5.netIncome)}  sub={pp(y5.niM)+" margin"}     accent={C.accent2}/>
        <KPI label="Pool size Y5"  val={`${y5.engines} eng`} accent={C.amber}/>
      </div>

      <SectionHead title="Year 1 — full calculation walkthrough" icon="🔍"/>
      <div style={{background:"#F8FAFF",borderRadius:10,border:`1px solid ${C.hiB}`,overflow:"hidden",marginBottom:24}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
          <tbody>
            {wt.map((row,i)=>{
              if(!row) return <tr key={i}><td colSpan={3} style={{height:6,background:"#EFF6FF"}}></td></tr>;
              const [label,val,note]=row;
              const bold=label==="EBITDA"||label==="NET INCOME";
              const neg=val&&val.startsWith("(");
              return(
                <tr key={i} style={{background:bold?"#DBEAFE":"transparent",borderBottom:`1px solid ${C.hiB}`}}>
                  <td style={{padding:"9px 14px",fontWeight:bold?"700":"400",width:"35%",color:C.txt}}>{label}</td>
                  <td style={{padding:"9px 14px",textAlign:"right",fontWeight:bold?"700":"600",
                    color:neg?C.red:bold?C.accent:C.txt,width:"20%"}}>{val}</td>
                  <td style={{padding:"9px 14px",fontSize:12,color:C.txt3}}>{note}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <SectionHead title="5-year summary ($000s)" icon="📅"/>
      <DataTable
        cols={["($000s)","Y1","Y2","Y3","Y4","Y5"]}
        rows={[
          {cells:["Engines in pool",...data.map(r=>r.engines)]},
          {cells:["Gross lease revenue",...data.map(r=>Math.round(r.grossLease/1000))]},
          {cells:["Revenue to PM Aero",...data.map(r=>Math.round(r.revenue/1000))],hi:true},
          {cells:["  MRO costs",...data.map(r=>r.mroCost>0?-Math.round(r.mroCost/1000):0)]},
          {cells:["  Insurance",...data.map(r=>r.insurance>0?-Math.round(r.insurance/1000):0)]},
          {cells:["  Storage",...data.map(r=>r.storage>0?-Math.round(r.storage/1000):0)]},
          {cells:["  Staff",...data.map(r=>-Math.round(r.staff/1000))]},
          {cells:["EBITDA",...data.map(r=>Math.round(r.ebitda/1000))],hi:true},
          {cells:["EBITDA margin",...data.map(r=>pp(r.ebitdaM))]},
          {cells:["  Interest",...data.map(r=>r.interest>0?-Math.round(r.interest/1000):0)]},
          {cells:["  Tax",...data.map(r=>r.tax>0?-Math.round(r.tax/1000):0)]},
          {cells:["NET INCOME",...data.map(r=>Math.round(r.netIncome/1000))],hi:true},
          {cells:["Net margin",...data.map(r=>pp(r.niM))]},
          {cells:["Capex",...data.map(r=>r.capex>0?-Math.round(r.capex/1000):0)]},
          {cells:["Cumulative cash",...data.map(r=>Math.round(r.cumCash/1000))]},
        ]}
      />
    </div>
  );
}

// ─── P&L ──────────────────────────────────────────────────────────────────────
function PLTab({data}){
  return <DataTable cols={["($000s)","Y1","Y2","Y3","Y4","Y5"]} rows={[
    {cells:["REVENUE"],sec:true},
    {cells:["Gross lease revenue",...data.map(r=>Math.round(r.grossLease/1000))]},
    {cells:["Revenue to PM Aero",...data.map(r=>Math.round(r.revenue/1000))],hi:true},
    {cells:["OPERATING COSTS"],sec:true},
    {cells:["MRO (idle-time share)",...data.map(r=>r.mroCost>0?-Math.round(r.mroCost/1000):0)]},
    {cells:["Insurance",...data.map(r=>r.insurance>0?-Math.round(r.insurance/1000):0)]},
    {cells:["Storage & logistics",...data.map(r=>r.storage>0?-Math.round(r.storage/1000):0)]},
    {cells:["Staff & overheads",...data.map(r=>-Math.round(r.staff/1000))]},
    {cells:["Total opex",...data.map(r=>-Math.round(r.opex/1000))],hi:true},
    {cells:["EBITDA",...data.map(r=>Math.round(r.ebitda/1000))],hi:true},
    {cells:["EBITDA margin",...data.map(r=>pp(r.ebitdaM))]},
    {cells:["BELOW THE LINE"],sec:true},
    {cells:["Interest expense",...data.map(r=>r.interest>0?-Math.round(r.interest/1000):0)]},
    {cells:["EBT",...data.map(r=>Math.round(r.ebt/1000))],hi:true},
    {cells:["Tax (9% UAE)",...data.map(r=>r.tax>0?-Math.round(r.tax/1000):0)]},
    {cells:["NET INCOME",...data.map(r=>Math.round(r.netIncome/1000))],hi:true},
    {cells:["Net margin",...data.map(r=>pp(r.niM))]},
  ]}/>;
}

// ─── Cash Flow ────────────────────────────────────────────────────────────────
function CFTab({data}){
  return <DataTable cols={["($000s)","Y1","Y2","Y3","Y4","Y5"]} rows={[
    {cells:["OPERATING"],sec:true},
    {cells:["Net income",...data.map(r=>Math.round(r.netIncome/1000))]},
    {cells:["Add: depreciation",...data.map(r=>Math.round(r.depr/1000))]},
    {cells:["CFO",...data.map(r=>Math.round(r.cfo/1000))],hi:true},
    {cells:["INVESTING"],sec:true},
    {cells:["Engine acquisitions",...data.map(r=>r.capex>0?-Math.round(r.capex/1000):0)]},
    {cells:["CFI",...data.map(r=>Math.round(r.cfi/1000))],hi:true},
    {cells:["FINANCING"],sec:true},
    {cells:["Debt drawn",...data.map(r=>Math.round(r.debtDrawn/1000))]},
    {cells:["Debt repaid",...data.map(r=>r.debtRepay>0?-Math.round(r.debtRepay/1000):0)]},
    {cells:["CFF",...data.map(r=>Math.round(r.cff/1000))],hi:true},
    {cells:["Net cash flow",...data.map(r=>Math.round(r.ncf/1000))],hi:true},
    {cells:["Cumulative cash",...data.map(r=>Math.round(r.cumCash/1000))],hi:true},
  ]}/>;
}

// ─── Balance Sheet ────────────────────────────────────────────────────────────
function BSTab({data,mdl}){
  return(
    <div>
      <DataTable cols={["($000s)","Y1","Y2","Y3","Y4","Y5"]} rows={[
        {cells:["ASSETS"],sec:true},
        {cells:["Engine assets – book",...data.map(r=>Math.round(r.bookVal/1000))]},
        {cells:["Engine assets – market",...data.map(r=>mdl==="consignment"?"N/A":Math.round(r.mktVal/1000))]},
        {cells:["Cash & equivalents",...data.map(r=>Math.round((Math.max(0,r.cumCash)+500000)/1000))]},
        {cells:["TOTAL ASSETS",...data.map(r=>Math.round(r.totAssets/1000))],hi:true},
        {cells:["LIABILITIES"],sec:true},
        {cells:["Total debt",...data.map(r=>Math.round(r.cumDebt/1000))]},
        {cells:["TOTAL LIABILITIES",...data.map(r=>Math.round(r.cumDebt/1000))],hi:true},
        {cells:["EQUITY"],sec:true},
        {cells:["Paid-in equity",...data.map(r=>Math.round(r.paidEq/1000))]},
        {cells:["Retained earnings",...data.map(r=>Math.round(r.retEarn/1000))]},
        {cells:["TOTAL EQUITY",...data.map(r=>Math.round(r.totEq/1000))],hi:true},
      ]}/>
      <div style={{marginTop:10,fontSize:12,color:C.txt3}}>Book: 5% straight-line depreciation. Market: 10%/yr appreciation on acquisition cost.</div>
    </div>
  );
}

// ─── Scenarios ────────────────────────────────────────────────────────────────
function ScenariosTab({utilR,debtR}){
  const mLabel={purchase:"Direct purchase",slb:"Sale-leaseback",consignment:"Consignment"};
  const mColor={purchase:"blue",slb:"amber",consignment:"green"};
  const rows=[];
  Object.keys(ENGINES).forEach(et=>{
    ["purchase","slb","consignment"].forEach(am=>{
      const d=buildModel(et,am,utilR,debtR);
      const y5=d[4],cap=d.reduce((s,r)=>s+r.capex,0);
      rows.push({engine:ENGINES[et].name,model:am,y5Rev:y5.revenue,y5EB:y5.ebitda,y5EBM:y5.ebitdaM,y5NI:y5.netIncome,y5NIM:y5.niM,cumCash:y5.cumCash,capex:cap});
    });
  });
  return(
    <div>
      <div style={{fontSize:13,color:C.txt2,marginBottom:16}}>Year 5 outcomes across all 9 combinations. Utilisation and debt sliders apply.</div>
      <div style={{overflowX:"auto",borderRadius:10,border:`1px solid ${C.border}`}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
          <thead>
            <tr style={{background:"#F1F5FF"}}>
              {["Engine","Model","Y5 Rev","Y5 EBITDA","EBITDA %","Y5 Net Inc","NI %","Cum Cash","Capex"].map((h,i)=>(
                <th key={i} style={{textAlign:i<2?"left":"right",padding:"9px 14px",fontSize:11,fontWeight:700,
                  color:C.accent,textTransform:"uppercase",letterSpacing:"0.06em",borderBottom:`1px solid ${C.hiB}`}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r,i)=>(
              <tr key={i} style={{background:i%3===0?"#F8FAFF":"#FFFFFF",borderBottom:`1px solid ${C.border}`}}>
                <td style={{padding:"9px 14px",fontWeight:700,color:C.txt}}>{r.engine}</td>
                <td style={{padding:"9px 14px"}}><Pill t={mLabel[r.model]} color={mColor[r.model]}/></td>
                {[r.y5Rev,r.y5EB].map((v,i)=>(
                  <td key={i} style={{padding:"9px 14px",textAlign:"right",color:v<0?C.red:C.txt,fontWeight:600}}>{Math.round(v/1000).toLocaleString()}</td>
                ))}
                <td style={{padding:"9px 14px",textAlign:"right",color:C.txt2}}>{pp(r.y5EBM)}</td>
                <td style={{padding:"9px 14px",textAlign:"right",color:r.y5NI<0?C.red:C.txt,fontWeight:600}}>{Math.round(r.y5NI/1000).toLocaleString()}</td>
                <td style={{padding:"9px 14px",textAlign:"right",color:C.txt2}}>{pp(r.y5NIM)}</td>
                <td style={{padding:"9px 14px",textAlign:"right",color:r.cumCash<0?C.red:C.green,fontWeight:600}}>{Math.round(r.cumCash/1000).toLocaleString()}</td>
                <td style={{padding:"9px 14px",textAlign:"right",color:C.txt2}}>{r.capex===0?"$0":Math.round(r.capex/1000).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Stress Test ──────────────────────────────────────────────────────────────
function StressTab({eng,debtR}){
  const utils=[0.50,0.75,0.90];
  const models=["purchase","slb","consignment"];
  const mLabel={purchase:"Direct purchase",slb:"Sale-leaseback",consignment:"Consignment"};
  const mColor={purchase:"blue",slb:"amber",consignment:"green"};
  const uLabel={0.50:"50% — Bear case",0.75:"75% — Base case",0.90:"90% — Bull case"};
  const uColor={0.50:"red",0.75:"blue",0.90:"green"};
  return(
    <div>
      <div style={{fontSize:13,color:C.txt2,marginBottom:16}}>{ENGINES[eng].name} across all 3 models. Debt % from slider above.</div>
      {utils.map(u=>(
        <div key={u} style={{marginBottom:20}}>
          <div style={{marginBottom:10}}><Pill t={uLabel[u]} color={uColor[u]}/></div>
          <DataTable
            cols={["Model","Y1","Y2","Y3","Y4","Y5 Rev","Y5 EBITDA","Y5 Net Inc","Cum Cash"]}
            rows={models.map(am=>{
              const d=buildModel(eng,am,u,debtR);
              return{cells:[mLabel[am],...d.map(r=>Math.round(r.revenue/1000)),
                Math.round(d[4].ebitda/1000),Math.round(d[4].netIncome/1000),Math.round(d[4].cumCash/1000)]};
            })}
          />
        </div>
      ))}
    </div>
  );
}

// ─── Debt vs Equity ───────────────────────────────────────────────────────────
function DebtTab({eng,mdl,utilR}){
  if(mdl==="consignment") return(
    <div style={{padding:"40px",textAlign:"center",color:C.txt2,fontSize:14}}>
      Not applicable for consignment — zero capex means no financing to optimise.<br/>Switch to Direct Purchase or Sale-Leaseback.
    </div>
  );
  return(
    <div>
      <div style={{fontSize:13,color:C.txt2,marginBottom:16}}>{ENGINES[eng].name}, {mdl==="purchase"?"Direct Purchase":"Sale-Leaseback"}, {Math.round(utilR*100)}% utilisation.</div>
      <DataTable
        cols={["Structure","Y1 Interest","Y3 Interest","Y5 Interest","Y5 EBITDA","Y5 Net Inc","Cum Cash","Y5 Equity"]}
        rows={[0,0.30,0.50,0.60,0.75].map(dp=>{
          const d=buildModel(eng,mdl,utilR,dp);
          return{hi:dp===0.60,cells:[
            `${Math.round(dp*100)}% debt / ${Math.round((1-dp)*100)}% equity`,
            Math.round(d[0].interest/1000),Math.round(d[2].interest/1000),Math.round(d[4].interest/1000),
            Math.round(d[4].ebitda/1000),Math.round(d[4].netIncome/1000),
            Math.round(d[4].cumCash/1000),Math.round(d[4].totEq/1000),
          ]};
        })}
      />
      <div style={{marginTop:14,background:"#F8FAFF",borderRadius:10,padding:"14px 18px",fontSize:13,color:C.txt2,border:`1px solid ${C.hiB}`}}>
        <strong style={{color:C.accent}}>60% debt</strong> (highlighted) is the base case. Higher leverage amplifies returns but increases early-year interest burden.
      </div>
    </div>
  );
}
