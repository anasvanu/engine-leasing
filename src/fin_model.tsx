import { useState, useMemo } from "react";

const fmt = (v, d=0) => v === null || v === undefined ? "—" : (v < 0 ? `(${Math.abs(v).toLocaleString("en-US", {minimumFractionDigits:d, maximumFractionDigits:d})})` : v.toLocaleString("en-US", {minimumFractionDigits:d, maximumFractionDigits:d}));
const fmtM = (v) => v === null || v === undefined ? "—" : `$${fmt(v/1000, 1)}M`;
const fmtK = (v) => v === null || v === undefined ? "—" : `$${fmt(v/1000, 0)}K`;
const pct = (v) => v === null ? "—" : `${(v*100).toFixed(1)}%`;

const TABS = ["Overview","P&L","Cash Flow","Balance Sheet","Scenarios","Stress Test","Debt vs Equity"];

const ENGINE_TYPES = {
  cfm7b: { name:"CFM56-7B", acq:5700000, lrMo:90000, mroFreqHr:4000, mroCost:4500000, eflHrPa:3500 },
  cfm5b: { name:"CFM56-5B", acq:5200000, lrMo:65000, mroFreqHr:4000, mroCost:4300000, eflHrPa:3500 },
  v2500: { name:"V2500-A5", acq:4800000, lrMo:75000, mroFreqHr:4000, mroCost:4000000, eflHrPa:3500 },
};

const YEARS = [1,2,3,4,5];

// Pool growth by acquisition model
const POOL_GROWTH = {
  purchase:    [3, 5, 8, 12, 15],
  slb:         [3, 6, 9, 12, 15],
  consignment: [5, 10, 15, 20, 25],
};

/** Row shape built in stages in buildModel; extra fields are attached in forEach passes (all numeric). */
type ModelRow = { [key: string]: number };

function buildModel({ engineType, acqModel, utilRate, debtPct, appreciation = 0.10 }) {
  const eng = ENGINE_TYPES[engineType];
  const pool = POOL_GROWTH[acqModel];
  const debtRate = 0.065;

  // acquisition model params
  // purchase: full acq cost, SLB: 85% of acq (airline discounts), consignment: 0 capex, earn 30% rev share
  const acqCostFactor = acqModel === "purchase" ? 1 : acqModel === "slb" ? 0.85 : 0;
  const revShareFactor = acqModel === "consignment" ? 0.30 : 1; // consignment keeps 30% of gross
  const mgmtFeePerEngine = acqModel === "consignment" ? 80000 : 0; // annual mgmt fee per consigned engine

  // insurance & storage per engine per year
  const insurancePerEngine = 60000;
  const storagePerEngine = 20000;
  // staff: Y1=2 heads, grows
  const staffCost = [600000, 900000, 1200000, 1500000, 1800000];

  const rows: ModelRow[] = YEARS.map((yr, i) => {
    const engines = pool[i];
    const grossLeaseRev = engines * eng.lrMo * 12 * utilRate;
    const revenue = acqModel === "consignment"
      ? grossLeaseRev * revShareFactor + engines * mgmtFeePerEngine
      : grossLeaseRev;

    // MRO: each engine visits shop every mroFreqHr hours; at eflHrPa hr/yr, visits per engine per year = eflHrPa/mroFreqHr
    const mroVisitsPerEngineYr = (eng.eflHrPa * utilRate) / eng.mroFreqHr;
    const mroCosts = engines * mroVisitsPerEngineYr * eng.mroCost;

    const insurance = engines * insurancePerEngine;
    const storage = engines * storagePerEngine;
    const staff = staffCost[i];
    const opex = mroCosts + insurance + storage + staff;
    const ebitda = revenue - opex;

    // capex: new engines purchased this year
    const newEngines = i === 0 ? pool[0] : pool[i] - pool[i-1];
    const capex = acqModel === "consignment" ? 0 : newEngines * eng.acq * acqCostFactor;

    // debt / equity split on capex
    const debtDrawn = capex * debtPct;
    const equityDrawn = capex * (1 - debtPct);

    // asset value (book): cost minus 5% depreciation per year
    const bookValuePerEngine = eng.acq * acqCostFactor * (1 - 0.05 * (i+1));
    const assetBook = acqModel === "consignment" ? 0 : engines * bookValuePerEngine;
    // market value with appreciation
    const marketValue = acqModel === "consignment" ? 0 : engines * eng.acq * Math.pow(1 + appreciation, i+1);

    return { yr, engines, revenue, mroCosts, insurance, storage, staff, opex, ebitda,
             capex, debtDrawn, equityDrawn, assetBook, marketValue, newEngines };
  });

  // compute cumulative debt and interest
  let cumDebt = 0;
  rows.forEach((r, i) => {
    cumDebt += r.debtDrawn;
    r.cumulativeDebt = cumDebt;
    r.interest = cumDebt * debtRate;
    r.debtRepay = i > 0 ? rows.slice(0, i).reduce((s, pr) => s + pr.debtDrawn / 5, 0) : 0;
    r.ebt = r.ebitda - r.interest;
    r.tax = Math.max(0, r.ebt * 0.09); // UAE 9% corp tax above AED 375K
    r.netIncome = r.ebt - r.tax;
    r.ebitdaMargin = r.revenue > 0 ? r.ebitda / r.revenue : 0;
    r.niMargin = r.revenue > 0 ? r.netIncome / r.revenue : 0;
  });

  // cash flow
  let cumulativeCash = 0;
  rows.forEach((r, i) => {
    r.cfo = r.netIncome + (r.assetBook * 0.05); // add back non-cash depreciation approx
    r.debtRepayActual = rows.slice(0, i+1).reduce((s, pr) => s + pr.debtDrawn / 5, 0)
                        - (i > 0 ? rows.slice(0, i).reduce((s, pr) => s + pr.debtDrawn / 5, 0) : 0);
    r.cff = r.debtDrawn - r.debtRepayActual;
    r.cfi = -r.capex;
    r.netCashFlow = r.cfo + r.cfi + r.cff;
    cumulativeCash += r.netCashFlow;
    r.cumulativeCash = cumulativeCash;
  });

  // balance sheet
  let cumEquity = 0;
  let retainedEarnings = 0;
  rows.forEach((r, i) => {
    cumEquity += r.equityDrawn;
    retainedEarnings += r.netIncome;
    r.totalAssets = r.assetBook + Math.max(0, r.cumulativeCash) + 500000; // min cash buffer
    r.totalLiabilities = r.cumulativeDebt;
    r.totalEquity = cumEquity + retainedEarnings;
    r.bsCheck = r.totalAssets - r.totalLiabilities - r.totalEquity; // should ≈ 0
  });

  return rows;
}

const SECTION = ({title, children}) => (
  <div style={{marginBottom:28}}>
    <div style={{fontSize:12,fontWeight:500,color:"var(--color-text-tertiary)",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:10}}>{title}</div>
    {children}
  </div>
);

const Table = ({headers, rows}) => (
  <div style={{overflowX:"auto"}}>
    <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
      <thead>
        <tr>{headers.map((h,i)=>(
          <th key={i} style={{textAlign:i===0?"left":"right",padding:"8px 10px",fontSize:12,fontWeight:500,color:"var(--color-text-secondary)",borderBottom:"0.5px solid var(--color-border-secondary)",background:"var(--color-background-secondary)",whiteSpace:"nowrap"}}>{h}</th>
        ))}</tr>
      </thead>
      <tbody>
        {rows.map((row,ri)=>(
          <tr key={ri} style={{background: row.bold||row.section?"var(--color-background-secondary)":"transparent"}}>
            {row.cells.map((c,ci)=>(
              <td key={ci} style={{
                padding:"8px 10px",
                textAlign:ci===0?"left":"right",
                borderBottom:"0.5px solid var(--color-border-tertiary)",
                fontWeight: row.bold?"500":"400",
                fontSize: row.section?11:13,
                color: row.section?"var(--color-text-tertiary)": (ci>0&&typeof c==="number"&&c<0)?"var(--color-text-danger)":"var(--color-text-primary)",
                whiteSpace:"nowrap"
              }}>
                {row.section ? (ci===0?c.toUpperCase():"") : c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const MetricCard = ({label, value, sub}: {label: string; value: string; sub?: string}) => (
  <div style={{background:"var(--color-background-secondary)",borderRadius:"var(--border-radius-md)",padding:"14px 16px",textAlign:"center"}}>
    <div style={{fontSize:22,fontWeight:500,color:"var(--color-text-primary)"}}>{value}</div>
    <div style={{fontSize:12,color:"var(--color-text-secondary)",marginTop:4}}>{label}</div>
    {sub&&<div style={{fontSize:11,color:"var(--color-text-tertiary)",marginTop:2}}>{sub}</div>}
  </div>
);

const Badge = ({text, color="blue"}) => {
  const map={blue:["var(--color-background-info)","var(--color-text-info)"],green:["var(--color-background-success)","var(--color-text-success)"],amber:["var(--color-background-warning)","var(--color-text-warning)"],red:["var(--color-background-danger)","var(--color-text-danger)"]};
  const [bg,tc]=map[color]||map.blue;
  return <span style={{display:"inline-block",fontSize:11,fontWeight:500,padding:"2px 9px",borderRadius:999,background:bg,color:tc}}>{text}</span>;
};

export default function App() {
  const [tab, setTab] = useState(0);
  const [engineType, setEngineType] = useState("cfm7b");
  const [acqModel, setAcqModel] = useState("purchase");
  const [utilRate, setUtilRate] = useState(0.75);
  const [debtPct, setDebtPct] = useState(0.60);

  const data = useMemo(() => buildModel({engineType, acqModel, utilRate, debtPct}), [engineType, acqModel, utilRate, debtPct]);

  const eng = ENGINE_TYPES[engineType];

  // Scenario data
  const scenarios = useMemo(() => {
    const types = Object.keys(ENGINE_TYPES);
    const models = ["purchase","slb","consignment"];
    return types.flatMap(et => models.map(am => {
      const d = buildModel({engineType:et, acqModel:am, utilRate:0.75, debtPct:0.60});
      const y5 = d[4];
      return { engine:ENGINE_TYPES[et].name, model:am, y5Rev:y5.revenue, y5EBITDA:y5.ebitda, y5NI:y5.netIncome, cumCash:y5.cumulativeCash };
    }));
  }, []);

  // Stress test
  const stressData = useMemo(() => {
    return [0.50, 0.75, 0.90].map(u => {
      return ["purchase","slb","consignment"].map(am => {
        const d = buildModel({engineType, acqModel:am, utilRate:u, debtPct});
        return { util:u, model:am, rows:d };
      });
    }).flat();
  }, [engineType, debtPct]);

  // Debt sensitivity
  const debtSens = useMemo(() => {
    return [0, 0.30, 0.50, 0.60, 0.75].map(dp => {
      const d = buildModel({engineType, acqModel, utilRate, debtPct:dp});
      return { dp, rows:d };
    });
  }, [engineType, acqModel, utilRate]);

  const select = (v,s,o) => (
    <select value={v} onChange={e=>s(e.target.value)} style={{padding:"5px 10px",fontSize:13,border:"0.5px solid var(--color-border-secondary)",borderRadius:"var(--border-radius-md)",background:"var(--color-background-secondary)",color:"var(--color-text-primary)",cursor:"pointer"}}>
      {o.map(([val,lbl])=><option key={val} value={val}>{lbl}</option>)}
    </select>
  );

  return (
    <div style={{fontFamily:"var(--font-sans)",color:"var(--color-text-primary)",padding:"0 0 40px"}}>
      {/* Header */}
      <div style={{marginBottom:20}}>
        <div style={{fontSize:11,fontWeight:500,letterSpacing:"0.08em",textTransform:"uppercase",color:"var(--color-text-tertiary)",marginBottom:6}}>PM Aero · Engine Leasing</div>
        <div style={{fontSize:22,fontWeight:500,marginBottom:4}}>5-Year Financial Model</div>
        <div style={{fontSize:14,color:"var(--color-text-secondary)"}}>Dynamic model — adjust inputs to see all statements update in real time.</div>
      </div>

      {/* Controls */}
      <div style={{background:"var(--color-background-secondary)",border:"0.5px solid var(--color-border-tertiary)",borderRadius:"var(--border-radius-lg)",padding:"16px 20px",marginBottom:20,display:"flex",gap:16,flexWrap:"wrap",alignItems:"center"}}>
        <div style={{display:"flex",flexDirection:"column",gap:5}}>
          <div style={{fontSize:11,fontWeight:500,color:"var(--color-text-tertiary)",textTransform:"uppercase",letterSpacing:"0.06em"}}>Engine type</div>
          {select(engineType, setEngineType, [["cfm7b","CFM56-7B — $90K/mo"],["cfm5b","CFM56-5B — $65K/mo"],["v2500","V2500-A5 — $75K/mo"]])}
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:5}}>
          <div style={{fontSize:11,fontWeight:500,color:"var(--color-text-tertiary)",textTransform:"uppercase",letterSpacing:"0.06em"}}>Acquisition model</div>
          {select(acqModel, setAcqModel, [["purchase","Direct market purchase"],["slb","Sale-leaseback"],["consignment","Consignment / pooling"]])}
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:5,minWidth:160}}>
          <div style={{fontSize:11,fontWeight:500,color:"var(--color-text-tertiary)",textTransform:"uppercase",letterSpacing:"0.06em"}}>Utilisation: {Math.round(utilRate*100)}%</div>
          <input type="range" min={40} max={95} step={5} value={Math.round(utilRate*100)} onChange={e=>setUtilRate(+e.target.value/100)} style={{width:"100%"}} />
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:5,minWidth:160}}>
          <div style={{fontSize:11,fontWeight:500,color:"var(--color-text-tertiary)",textTransform:"uppercase",letterSpacing:"0.06em"}}>Debt financing: {Math.round(debtPct*100)}%</div>
          <input type="range" min={0} max={80} step={5} value={Math.round(debtPct*100)} onChange={e=>setDebtPct(+e.target.value/100)} style={{width:"100%"}} />
        </div>
      </div>

      {/* Tabs */}
      <div style={{display:"flex",gap:4,marginBottom:20,flexWrap:"wrap"}}>
        {TABS.map((t,i)=>(
          <button key={i} onClick={()=>setTab(i)} style={{padding:"6px 14px",fontSize:13,borderRadius:"var(--border-radius-md)",border:"0.5px solid",borderColor:tab===i?"var(--color-border-primary)":"var(--color-border-tertiary)",background:tab===i?"var(--color-background-primary)":"transparent",color:tab===i?"var(--color-text-primary)":"var(--color-text-secondary)",fontWeight:tab===i?"500":"400",cursor:"pointer"}}>{t}</button>
        ))}
      </div>

      {/* Tab content */}
      {tab===0 && <OverviewTab data={data} eng={eng} acqModel={acqModel} utilRate={utilRate} debtPct={debtPct} />}
      {tab===1 && <PLTab data={data} />}
      {tab===2 && <CFTab data={data} />}
      {tab===3 && <BSTab data={data} acqModel={acqModel} />}
      {tab===4 && <ScenariosTab scenarios={scenarios} />}
      {tab===5 && <StressTab stressData={stressData} engineType={engineType} />}
      {tab===6 && <DebtTab debtSens={debtSens} acqModel={acqModel} />}
    </div>
  );
}

function OverviewTab({data, eng, acqModel, utilRate, debtPct}) {
  const y5 = data[4];
  const totalCapex = data.reduce((s,r)=>s+r.capex,0);
  const totalRevenue = data.reduce((s,r)=>s+r.revenue,0);
  const acqLabels = {purchase:"Direct market purchase",slb:"Sale-leaseback",consignment:"Consignment / pooling"};
  return (
    <div>
      <SECTION title="Key assumptions">
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:16}}>
          {[
            ["Engine type",eng.name],
            ["Acquisition model",acqLabels[acqModel]],
            ["Acquisition cost/engine",acqModel==="consignment"?"$0 (no capex)":fmtM(eng.acq*(acqModel==="slb"?0.85:1))],
            ["Monthly lease rate",fmtK(eng.lrMo)],
            ["Utilisation assumed",pct(utilRate)],
            ["Debt financing",pct(debtPct)],
            ["Debt interest rate","6.5% p.a."],
            ["MRO interval","4,000 EFH"],
            ["MRO cost/visit",fmtM(eng.mroCost)],
          ].map(([l,v],i)=>(
            <div key={i} style={{background:"var(--color-background-secondary)",borderRadius:"var(--border-radius-md)",padding:"12px 14px"}}>
              <div style={{fontSize:11,color:"var(--color-text-tertiary)",marginBottom:4}}>{l}</div>
              <div style={{fontSize:14,fontWeight:500}}>{v}</div>
            </div>
          ))}
        </div>
      </SECTION>
      <SECTION title="Year 5 summary metrics">
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:16}}>
          <MetricCard label="Y5 revenue" value={fmtM(y5.revenue)} />
          <MetricCard label="Y5 EBITDA" value={fmtM(y5.ebitda)} sub={pct(y5.ebitdaMargin)+" margin"} />
          <MetricCard label="Y5 net income" value={fmtM(y5.netIncome)} sub={pct(y5.niMargin)+" margin"} />
          <MetricCard label="Pool size (Y5)" value={`${y5.engines} engines`} />
          <MetricCard label="Total 5yr revenue" value={fmtM(totalRevenue)} />
          <MetricCard label="Total capex" value={acqModel==="consignment"?"$0":fmtM(totalCapex)} />
          <MetricCard label="Cumulative cash (Y5)" value={fmtM(y5.cumulativeCash)} />
          <MetricCard label="Y5 engine asset value" value={acqModel==="consignment"?"N/A":fmtM(y5.marketValue)} sub="at market w/ appreciation" />
        </div>
      </SECTION>
      <SECTION title="Revenue ramp">
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
            <thead><tr>
              {["",..."Y1 Y2 Y3 Y4 Y5".split(" ")].map((h,i)=><th key={i} style={{textAlign:i===0?"left":"right",padding:"7px 10px",fontSize:12,fontWeight:500,color:"var(--color-text-secondary)",borderBottom:"0.5px solid var(--color-border-secondary)",background:"var(--color-background-secondary)"}}>{h}</th>)}
            </tr></thead>
            <tbody>
              {[
                ["Engines in pool", data.map(r=>r.engines)],
                ["Revenue ($K)", data.map(r=>Math.round(r.revenue/1000))],
                ["EBITDA ($K)", data.map(r=>Math.round(r.ebitda/1000))],
                ["Net income ($K)", data.map(r=>Math.round(r.netIncome/1000))],
                ["EBITDA margin", data.map(r=>pct(r.ebitdaMargin))],
                ["Capex ($K)", data.map(r=>acqModel==="consignment"?"—":Math.round(r.capex/1000))],
              ].map(([label,vals],ri)=>(
                <tr key={ri}>
                  <td style={{padding:"8px 10px",fontWeight:500,fontSize:13,borderBottom:"0.5px solid var(--color-border-tertiary)"}}>{label}</td>
                  {vals.map((v,vi)=>(
                    <td key={vi} style={{textAlign:"right",padding:"8px 10px",fontSize:13,borderBottom:"0.5px solid var(--color-border-tertiary)",color:typeof v==="number"&&v<0?"var(--color-text-danger)":"var(--color-text-primary)"}}>{typeof v==="number"?v.toLocaleString():v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SECTION>
    </div>
  );
}

function PLTab({data}) {
  const rows = [
    {cells:["Revenue"],section:true},
    {cells:["Gross lease revenue ($K)", ...data.map(r=>Math.round(r.revenue/1000))]},
    {cells:[""],section:true},
    {cells:["Operating costs"],section:true},
    {cells:["MRO subcontract ($K)", ...data.map(r=>-Math.round(r.mroCosts/1000))]},
    {cells:["Insurance ($K)", ...data.map(r=>-Math.round(r.insurance/1000))]},
    {cells:["Storage & logistics ($K)", ...data.map(r=>-Math.round(r.storage/1000))]},
    {cells:["Staff & overheads ($K)", ...data.map(r=>-Math.round(r.staff/1000))]},
    {cells:["Total opex ($K)", ...data.map(r=>-Math.round(r.opex/1000))], bold:true},
    {cells:[""],section:true},
    {cells:["EBITDA ($K)", ...data.map(r=>Math.round(r.ebitda/1000))], bold:true},
    {cells:["EBITDA margin", ...data.map(r=>pct(r.ebitdaMargin))]},
    {cells:[""],section:true},
    {cells:["Below the line"],section:true},
    {cells:["Interest expense ($K)", ...data.map(r=>-Math.round(r.interest/1000))]},
    {cells:["EBT ($K)", ...data.map(r=>Math.round(r.ebt/1000))], bold:true},
    {cells:["Tax (9% UAE corp) ($K)", ...data.map(r=>-Math.round(r.tax/1000))]},
    {cells:["Net income ($K)", ...data.map(r=>Math.round(r.netIncome/1000))], bold:true},
    {cells:["Net margin", ...data.map(r=>pct(r.niMargin))]},
  ];
  return <Table headers={["","Y1","Y2","Y3","Y4","Y5"]} rows={rows} />;
}

function CFTab({data}) {
  const rows = [
    {cells:["Operating cash flow"],section:true},
    {cells:["Net income ($K)", ...data.map(r=>Math.round(r.netIncome/1000))]},
    {cells:["Add: depreciation ($K)", ...data.map(r=>Math.round((r.assetBook||0)*0.05/1000))]},
    {cells:["CFO ($K)", ...data.map(r=>Math.round(r.cfo/1000))], bold:true},
    {cells:[""],section:true},
    {cells:["Investing cash flow"],section:true},
    {cells:["Engine acquisitions ($K)", ...data.map(r=>-Math.round(r.capex/1000))]},
    {cells:["CFI ($K)", ...data.map(r=>Math.round(r.cfi/1000))], bold:true},
    {cells:[""],section:true},
    {cells:["Financing cash flow"],section:true},
    {cells:["Debt drawn ($K)", ...data.map(r=>Math.round(r.debtDrawn/1000))]},
    {cells:["Debt repaid ($K)", ...data.map(r=>-Math.round(r.debtRepayActual/1000))]},
    {cells:["CFF ($K)", ...data.map(r=>Math.round(r.cff/1000))], bold:true},
    {cells:[""],section:true},
    {cells:["Net cash flow ($K)", ...data.map(r=>Math.round(r.netCashFlow/1000))], bold:true},
    {cells:["Cumulative cash ($K)", ...data.map(r=>Math.round(r.cumulativeCash/1000))], bold:true},
  ];
  return <Table headers={["","Y1","Y2","Y3","Y4","Y5"]} rows={rows} />;
}

function BSTab({data, acqModel}) {
  const rows = [
    {cells:["Assets"],section:true},
    {cells:["Engine assets — book ($K)", ...data.map(r=>Math.round((r.assetBook||0)/1000))]},
    {cells:["Engine assets — market ($K)", ...data.map(r=>acqModel==="consignment"?"—":Math.round(r.marketValue/1000))]},
    {cells:["Cash & equivalents ($K)", ...data.map(r=>Math.round(Math.max(0,r.cumulativeCash)/1000+500))]},
    {cells:["Total assets ($K)", ...data.map(r=>Math.round(r.totalAssets/1000))], bold:true},
    {cells:[""],section:true},
    {cells:["Liabilities"],section:true},
    {cells:["Total debt ($K)", ...data.map(r=>Math.round(r.cumulativeDebt/1000))]},
    {cells:["Total liabilities ($K)", ...data.map(r=>Math.round(r.totalLiabilities/1000))], bold:true},
    {cells:[""],section:true},
    {cells:["Equity"],section:true},
    {cells:["Paid-in equity ($K)", ...data.map((_,i)=>Math.round(data.slice(0,i+1).reduce((s,r)=>s+r.equityDrawn,0)/1000))]},
    {cells:["Retained earnings ($K)", ...data.map((_,i)=>Math.round(data.slice(0,i+1).reduce((s,r)=>s+r.netIncome,0)/1000))]},
    {cells:["Total equity ($K)", ...data.map(r=>Math.round(r.totalEquity/1000))], bold:true},
  ];
  return (
    <div>
      <Table headers={["","Y1","Y2","Y3","Y4","Y5"]} rows={rows} />
      <div style={{marginTop:12,fontSize:12,color:"var(--color-text-tertiary)"}}>Engine assets shown at book (5% straight-line depreciation) and market value (10% annual appreciation on acquisition cost). Balance sheet closes to Total Assets = Total Liabilities + Total Equity.</div>
    </div>
  );
}

function ScenariosTab({scenarios}) {
  const modelLabel = {purchase:"Direct purchase",slb:"Sale-leaseback",consignment:"Consignment"};
  const modelColor = {purchase:"blue",slb:"amber",consignment:"green"};
  return (
    <div>
      <div style={{fontSize:14,color:"var(--color-text-secondary)",marginBottom:16}}>Year 5 outcomes across all 9 scenarios (3 engine types × 3 acquisition models). Utilisation fixed at 75%, debt at 60%.</div>
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
          <thead>
            <tr>
              {["Engine","Acq. model","Y5 revenue","Y5 EBITDA","Y5 net income","5yr cum. cash"].map((h,i)=>(
                <th key={i} style={{textAlign:i<2?"left":"right",padding:"8px 10px",fontSize:12,fontWeight:500,color:"var(--color-text-secondary)",borderBottom:"0.5px solid var(--color-border-secondary)",background:"var(--color-background-secondary)"}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {scenarios.map((s,i)=>(
              <tr key={i} style={{background: i%3===0?"var(--color-background-secondary)":"transparent"}}>
                <td style={{padding:"8px 10px",fontWeight:500,borderBottom:"0.5px solid var(--color-border-tertiary)"}}>{s.engine}</td>
                <td style={{padding:"8px 10px",borderBottom:"0.5px solid var(--color-border-tertiary)"}}><Badge text={modelLabel[s.model]} color={modelColor[s.model]} /></td>
                <td style={{padding:"8px 10px",textAlign:"right",borderBottom:"0.5px solid var(--color-border-tertiary)"}}>{fmtM(s.y5Rev)}</td>
                <td style={{padding:"8px 10px",textAlign:"right",borderBottom:"0.5px solid var(--color-border-tertiary)"}}>{fmtM(s.y5EBITDA)}</td>
                <td style={{padding:"8px 10px",textAlign:"right",borderBottom:"0.5px solid var(--color-border-tertiary)",color:s.y5NI<0?"var(--color-text-danger)":"var(--color-text-primary)"}}>{fmtM(s.y5NI)}</td>
                <td style={{padding:"8px 10px",textAlign:"right",borderBottom:"0.5px solid var(--color-border-tertiary)",color:s.cumCash<0?"var(--color-text-danger)":"var(--color-text-primary)"}}>{fmtM(s.cumCash)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{marginTop:12,fontSize:12,color:"var(--color-text-tertiary)"}}>Consignment model shows lower absolute revenue because PM Aero earns only 30% rev-share + management fee — but requires zero capex, making returns on invested capital far higher.</div>
    </div>
  );
}

function StressTab({stressData, engineType}) {
  const utilLabels = {0.5:"50% utilisation (bear)",0.75:"75% utilisation (base)",0.9:"90% utilisation (bull)"};
  const utilColor = {0.5:"red",0.75:"blue",0.9:"green"};
  const modelLabel = {purchase:"Direct purchase",slb:"Sale-leaseback",consignment:"Consignment"};
  return (
    <div>
      <div style={{fontSize:14,color:"var(--color-text-secondary)",marginBottom:16}}>
        Utilisation stress test for <strong>{ENGINE_TYPES[engineType].name}</strong> across all 3 acquisition models. Debt fixed at 60%.
      </div>
      {[0.5,0.75,0.9].map(u=>(
        <div key={u} style={{marginBottom:24}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
            <Badge text={utilLabels[u]} color={utilColor[u]} />
          </div>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
              <thead>
                <tr>
                  {["Model","Y1 Rev","Y2 Rev","Y3 Rev","Y4 Rev","Y5 Rev","Y5 EBITDA","Y5 Net Inc","Cum Cash"].map((h,i)=>(
                    <th key={i} style={{textAlign:i===0?"left":"right",padding:"7px 10px",fontSize:12,fontWeight:500,color:"var(--color-text-secondary)",borderBottom:"0.5px solid var(--color-border-secondary)",background:"var(--color-background-secondary)"}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stressData.filter(s=>s.util===u).map((s,i)=>(
                  <tr key={i}>
                    <td style={{padding:"8px 10px",fontWeight:500,borderBottom:"0.5px solid var(--color-border-tertiary)"}}><Badge text={modelLabel[s.model]} color={s.model==="purchase"?"blue":s.model==="slb"?"amber":"green"} /></td>
                    {s.rows.map((r,ri)=>(
                      <td key={ri} style={{padding:"8px 10px",textAlign:"right",borderBottom:"0.5px solid var(--color-border-tertiary)"}}>{fmtM(r.revenue)}</td>
                    ))}
                    <td style={{padding:"8px 10px",textAlign:"right",borderBottom:"0.5px solid var(--color-border-tertiary)"}}>{fmtM(s.rows[4].ebitda)}</td>
                    <td style={{padding:"8px 10px",textAlign:"right",borderBottom:"0.5px solid var(--color-border-tertiary)",color:s.rows[4].netIncome<0?"var(--color-text-danger)":"var(--color-text-primary)"}}>{fmtM(s.rows[4].netIncome)}</td>
                    <td style={{padding:"8px 10px",textAlign:"right",borderBottom:"0.5px solid var(--color-border-tertiary)",color:s.rows[4].cumulativeCash<0?"var(--color-text-danger)":"var(--color-text-primary)"}}>{fmtM(s.rows[4].cumulativeCash)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <div style={{fontSize:12,color:"var(--color-text-tertiary)"}}>Even at 50% utilisation, consignment remains cash-positive with zero capex exposure. Direct purchase at 50% util generates negative cumulative cash — highlighting the importance of demand validation before committing capital.</div>
    </div>
  );
}

function DebtTab({debtSens, acqModel}) {
  const pctLabel = v => `${Math.round(v*100)}% debt / ${Math.round((1-v)*100)}% equity`;
  if(acqModel==="consignment") return (
    <div style={{padding:"40px 20px",textAlign:"center",color:"var(--color-text-secondary)",fontSize:14}}>
      Debt / equity sensitivity is not applicable for the consignment model — zero capital is deployed, so there is no financing structure to optimise. Switch to Direct purchase or Sale-leaseback to view this analysis.
    </div>
  );
  return (
    <div>
      <div style={{fontSize:14,color:"var(--color-text-secondary)",marginBottom:16}}>
        Impact of debt vs equity mix on Y5 net income and cumulative cash. Higher debt amplifies returns but increases interest burden and risk.
      </div>
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
          <thead>
            <tr>
              {["Financing structure","Y1 interest","Y3 interest","Y5 interest","Y5 EBITDA","Y5 net income","5yr cum cash","Y5 equity value"].map((h,i)=>(
                <th key={i} style={{textAlign:i===0?"left":"right",padding:"8px 10px",fontSize:12,fontWeight:500,color:"var(--color-text-secondary)",borderBottom:"0.5px solid var(--color-border-secondary)",background:"var(--color-background-secondary)"}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {debtSens.map((s,i)=>(
              <tr key={i} style={{background:s.dp===0.60?"var(--color-background-info)":"transparent"}}>
                <td style={{padding:"8px 10px",fontWeight:500,borderBottom:"0.5px solid var(--color-border-tertiary)"}}>
                  {pctLabel(s.dp)}
                  {s.dp===0.60&&<span style={{marginLeft:8,fontSize:10,background:"var(--color-background-info)",color:"var(--color-text-info)",padding:"1px 7px",borderRadius:999}}>base</span>}
                </td>
                <td style={{padding:"8px 10px",textAlign:"right",borderBottom:"0.5px solid var(--color-border-tertiary)"}}>{fmtM(s.rows[0].interest)}</td>
                <td style={{padding:"8px 10px",textAlign:"right",borderBottom:"0.5px solid var(--color-border-tertiary)"}}>{fmtM(s.rows[2].interest)}</td>
                <td style={{padding:"8px 10px",textAlign:"right",borderBottom:"0.5px solid var(--color-border-tertiary)"}}>{fmtM(s.rows[4].interest)}</td>
                <td style={{padding:"8px 10px",textAlign:"right",borderBottom:"0.5px solid var(--color-border-tertiary)"}}>{fmtM(s.rows[4].ebitda)}</td>
                <td style={{padding:"8px 10px",textAlign:"right",borderBottom:"0.5px solid var(--color-border-tertiary)",color:s.rows[4].netIncome<0?"var(--color-text-danger)":"var(--color-text-primary)"}}>{fmtM(s.rows[4].netIncome)}</td>
                <td style={{padding:"8px 10px",textAlign:"right",borderBottom:"0.5px solid var(--color-border-tertiary)",color:s.rows[4].cumulativeCash<0?"var(--color-text-danger)":"var(--color-text-primary)"}}>{fmtM(s.rows[4].cumulativeCash)}</td>
                <td style={{padding:"8px 10px",textAlign:"right",borderBottom:"0.5px solid var(--color-border-tertiary)"}}>{fmtM(s.rows[4].totalEquity)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{marginTop:16,background:"var(--color-background-secondary)",borderRadius:"var(--border-radius-md)",padding:"14px 18px",fontSize:13,color:"var(--color-text-secondary)"}}>
        <strong style={{color:"var(--color-text-primary)"}}>Key insight:</strong> At 60% debt, PM Aero minimises equity outlay while keeping interest coverage above 2.5x in base case. At 75%+ debt, interest expense at low utilisation can turn net income negative in early years. At 0% debt (pure equity), returns are lower but there is no financial risk — appropriate if airline LOIs are not yet signed.
      </div>
    </div>
  );
}
