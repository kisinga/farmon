var y={controller:{id:"controller",category:"controller",subCategory:"esp32_relay_board",name:"Controller",description:"Main ESP32 relay controller for the system.",parameters:[],defaultParams:{}},compute:{id:"compute",category:"base_infra",subCategory:"single_board_computer",name:"Home Assistant Host",description:"Single-board computer running the local automation hub.",parameters:[],defaultParams:{}},power_ups:{id:"power_ups",category:"power",subCategory:"ups",name:"UPS / Power Bank",description:"Battery backup for controller and compute.",parameters:[],defaultParams:{}},power_solar:{id:"power_solar",category:"power",subCategory:"solar",name:"Solar Kit",description:"Solar panel and charge controller for off-grid sites.",parameters:[],defaultParams:{}},enclosure:{id:"enclosure",category:"enclosure",subCategory:"din_rail",name:"DIN Rail Enclosure",description:"Polycarbonate enclosure with DIN rail mounting.",parameters:[],defaultParams:{}},relay:{id:"relay",category:"relay",subCategory:"high_current_relay",name:"Pump Relay",description:"High-current relay module for pump switching.",parameters:[],defaultParams:{}},cable_valve:{id:"cable_valve",category:"base_infra",subCategory:"cable",name:"Valve Cable",description:"Two-core cable for valve actuator wiring.",parameters:[{name:"gauge",label:"Gauge",type:"select",options:["1.0mm\xB2","1.5mm\xB2"]}],defaultParams:{gauge:"1.0mm\xB2"}},cable_sensor:{id:"cable_sensor",category:"base_infra",subCategory:"cable",name:"Sensor Cable",description:"Shielded twisted pair for sensor signal runs.",parameters:[{name:"gauge",label:"Gauge",type:"select",options:["0.34mm\xB2","0.5mm\xB2"]}],defaultParams:{gauge:"0.34mm\xB2"}},valve:{id:"valve",category:"valve",subCategory:"ball_valve",name:"Ball Valve",description:"12V DC electrically actuated ball valve.",parameters:[{name:"portSize",label:"Port Size",type:"select",options:["DN15","DN20","DN25","DN32"]}],defaultParams:{portSize:"DN20"}},flow_sensor:{id:"flow_sensor",category:"flow_sensor",subCategory:"pulse_flow",name:"Flow Sensor",description:"Hall effect water flow sensor.",parameters:[{name:"portSize",label:"Port Size",type:"select",options:["DN15","DN20","DN25"]}],defaultParams:{portSize:"DN20"}}};function l(e,t,a){return{params:{portSize:e},unitCost:t,currency:"USD",partNumber:a,isActive:!0}}function h(e,t){return{params:{gauge:e},unitCost:t,currency:"USD",isActive:!0}}var D=[{id:"ctrl-kc868-a16",componentId:"controller",manufacturer:"Kincony",name:"KC868-A16",manufacturerPartNumber:"KC868-A16",description:"Industrial ESP32 relay controller with 16 relay outputs, 16 digital inputs, 4 ADC channels, Ethernet, and WiFi.",selectionHelp:"Primary recommended controller for all MajiFlow installations. DIN-rail mountable.",baseSpecs:{voltage:"12V DC",communication:"Ethernet + WiFi",relays:"16",inputs:"16",adc:"4"},variants:[{params:{},unitCost:42.5,currency:"USD",isActive:!0}],isActive:!0,isUserDefined:!1},{id:"compute-rpi-3bp",componentId:"compute",manufacturer:"Raspberry Pi Foundation",name:"Raspberry Pi 3B+",manufacturerPartNumber:"RPI3-MODBP",description:"Home Assistant OS host. Quad-core 1.4GHz, 1GB RAM, onboard WiFi and Ethernet.",selectionHelp:"Required for Home Assistant OS. Runs the local automation hub.",baseSpecs:{voltage:"5V DC",memory:"1GB",storage:"microSD",ports:"4x USB, Ethernet, HDMI"},variants:[{params:{},unitCost:33,currency:"USD",isActive:!0}],isActive:!0,isUserDefined:!1},{id:"power-ups-12v",componentId:"power_ups",manufacturer:"Generic",name:"12V DC UPS / Power Bank",manufacturerPartNumber:"UPS-12V-20AH",description:"12V DC uninterruptible power supply with lithium battery backup. Automatic switchover.",selectionHelp:"Keeps the controller and Pi alive during power outages. Essential for water systems.",baseSpecs:{voltage:"12V DC",capacity:"20Ah",output:"12V/5A",switchover:"<10ms"},variants:[{params:{},unitCost:26.4,currency:"USD",isActive:!0}],isActive:!0,isUserDefined:!1},{id:"power-solar-kit",componentId:"power_solar",manufacturer:"Generic",name:"Solar Panel + Charge Controller Kit",manufacturerPartNumber:"SP-100W-KIT",description:"100W solar panel with 10A PWM charge controller. Keeps the UPS battery topped up.",selectionHelp:"Reduces running costs and ensures off-grid capability. Always recommended.",baseSpecs:{wattage:"100W",voltage:"12V",controller:"PWM 10A",panelSize:"100W poly/mono"},variants:[{params:{},unitCost:51.9,currency:"USD",isActive:!0}],isActive:!0,isUserDefined:!1},{id:"enclosure-din-ip54",componentId:"enclosure",manufacturer:"Fibox",name:"DIN Rail Enclosure IP54",manufacturerPartNumber:"PC-300-300-150",description:"IP54 polycarbonate enclosure with DIN rail mounting. Houses controller, Pi, and power supplies.",selectionHelp:"IP54 is sufficient for covered outdoor installs. Upgrade to IP65 for direct exposure.",baseSpecs:{ipRating:"IP54",dimensions:"300x300x150mm",material:"polycarbonate",modules:"18"},variants:[{params:{},unitCost:30.2,currency:"USD",isActive:!0}],isActive:!0,isUserDefined:!1},{id:"relay-30a-module",componentId:"relay",manufacturer:"SainSmart",name:"30A Relay Module",manufacturerPartNumber:"30A-RELAY-1CH",description:"Single-channel 30A relay module for high-current pump switching. 12V coil.",selectionHelp:"Required for direct pump control (non-VFD). Omit if using a VFD.",baseSpecs:{voltage:"12V DC",current:"30A",contacts:"SPDT",coil:"12V"},variants:[{params:{},unitCost:8,currency:"USD",isActive:!0}],isActive:!0,isUserDefined:!1},{id:"cable-valve-2c",componentId:"cable_valve",manufacturer:"Generic",name:"Valve Cable 2-Core 1.0mm\xB2",manufacturerPartNumber:"CV-2C-1.0",description:"Two-core 1.0mm\xB2 cable for valve actuator wiring. Price per meter.",selectionHelp:"Allow 10-20m per valve depending on layout.",baseSpecs:{cores:"2",rating:"300V",length:"per meter"},variants:[h("1.0mm\xB2",.75)],isActive:!0,isUserDefined:!1},{id:"cable-sensor-shielded",componentId:"cable_sensor",manufacturer:"Generic",name:"Sensor Cable Shielded Twisted Pair 0.34mm\xB2",manufacturerPartNumber:"STP-2PR-0.34",description:"Shielded twisted pair for flow sensor and level sensor signal runs. Price per meter.",selectionHelp:"Allow 5-15m per sensor depending on layout.",baseSpecs:{cores:"2 pair",shield:"foil+braid",length:"per meter"},variants:[h("0.34mm\xB2",1.12)],isActive:!0,isUserDefined:!1},{id:"valve-bv12-atv",componentId:"valve",manufacturer:"ATV Motors",name:"12V DC Electric Ball Valve",manufacturerPartNumber:"ATV-BV12",description:"2-way brass ball valve with 12V DC electric actuator. BSP thread.",selectionHelp:"Default choice for most systems. Reliable in hard water. ATV has good field feedback.",baseSpecs:{voltage:"12V DC",pressureRating:"1.6MPa",material:"brass",actuator:"CR2-01"},variants:[l("DN15",21.2,"ATV-BV12-15"),l("DN20",27,"ATV-BV12-20"),l("DN25",33.7,"ATV-BV12-25"),l("DN32",46.3,"ATV-BV12-32")],isActive:!0,isUserDefined:!1},{id:"valve-bv12-vx",componentId:"valve",manufacturer:"VX Industrial",name:"12V DC Electric Ball Valve",manufacturerPartNumber:"VX-EV-12",description:"2-way stainless steel ball valve with 12V DC actuator. BSP thread.",selectionHelp:"Stainless steel body \u2014 better for corrosive or saline water. Slightly higher cost.",baseSpecs:{voltage:"12V DC",pressureRating:"1.0MPa",material:"SS304",actuator:"standard"},variants:[l("DN15",25.1,"VX-EV15-12"),l("DN20",30.8,"VX-EV20-12"),l("DN25",40.5,"VX-EV25-12"),l("DN32",48,"VX-EV32-12")],isActive:!0,isUserDefined:!1},{id:"flow-yfs201-sea",componentId:"flow_sensor",manufacturer:"Sea Electronics",name:"Hall Effect Flow Sensor",manufacturerPartNumber:"YF-S201",description:"Hall effect water flow sensor with BSP threads.",selectionHelp:"Reliable and cheap. Good for small zones and residential systems.",baseSpecs:{voltage:"5-24V DC",material:"nylon"},variants:[l("DN15",7.2,"YF-S201-DN15"),l("DN20",8.7,"YF-S201-DN20"),l("DN25",11.1,"YF-S201-DN25")],isActive:!0,isUserDefined:!1},{id:"flow-bronze-flowmax",componentId:"flow_sensor",manufacturer:"FlowMax",name:"Brass Hall Effect Flow Sensor",manufacturerPartNumber:"FM-BR",description:"Brass-bodied Hall effect flow sensor. More durable than nylon in hard water.",selectionHelp:"Upgrade for hard water or high-temperature applications.",baseSpecs:{voltage:"5-24V DC",material:"brass"},variants:[l("DN20",17.4,"FM-BR-20")],isActive:!0,isUserDefined:!1}],P=[{componentId:"controller",manufacturerId:"ctrl-kc868-a16",params:{}},{componentId:"compute",manufacturerId:"compute-rpi-3bp",params:{}},{componentId:"power_ups",manufacturerId:"power-ups-12v",params:{}},{componentId:"power_solar",manufacturerId:"power-solar-kit",params:{}},{componentId:"enclosure",manufacturerId:"enclosure-din-ip54",params:{}},{componentId:"relay",manufacturerId:"relay-30a-module",params:{}},{componentId:"cable_valve",manufacturerId:"cable-valve-2c",params:{gauge:"1.0mm\xB2"}},{componentId:"cable_sensor",manufacturerId:"cable-sensor-shielded",params:{gauge:"0.34mm\xB2"}},{componentId:"valve",manufacturerId:"valve-bv12-atv",params:{portSize:"DN20"}},{componentId:"flow_sensor",manufacturerId:"flow-yfs201-sea",params:{portSize:"DN20"}}],Q={registry:y,lines:D,defaults:P};function g(e,t,a){let o=a.registry[e];if(!o)return null;let r=a.defaults.find(s=>s.componentId===e),n=a.lines.filter(s=>s.isActive&&s.componentId===e);if(n.length===0)return null;let c=r?.manufacturerId??n[0].id,i=n.find(s=>s.id===c)??n[0],p={...r?.params??o.defaultParams,...t},u=i.variants.find(s=>s.isActive&&Object.entries(p).every(([V,_])=>s.params[V]===_));return!u||u.unitCost===0?null:{line:i,variant:u}}function L(){let t=new Date().toISOString().slice(0,10).replace(/-/g,""),a=Math.floor(Math.random()*1e4).toString().padStart(4,"0");return`Q-${t}-${a}`}var v=1.3;function S(e,t,a,o=v,r){let n=Math.round(t.unitCost*o*100)/100;return{manufacturerId:e.id,name:e.name,manufacturer:e.manufacturer,specs:{...e.baseSpecs,...t.params},description:e.description,quantity:a,unitCost:t.unitCost,unitPrice:n,lineTotal:Math.round(n*a*100)/100,currency:t.currency,selectionHelp:e.selectionHelp,notes:r}}function T(e){return Math.round(e.reduce((t,a)=>t+a.lineTotal,0)*100)/100}function w(e,t,a){let o=[],r=(c,i={},m,p)=>{let u=g(c,i,t);if(!u){a?.diagnostics?.push({componentId:c,reason:`No active variant found for params ${JSON.stringify(i)}`});return}o.push(S(u.line,u.variant,m,v,p))};r("controller",{},1,"Main controller"),r("compute",{},1,"Home Assistant OS host"),r("power_ups",{},1,"Battery backup for controller and Pi"),r("power_solar",{},1,"Keeps UPS charged, reduces running costs"),r("enclosure",{},1,"Houses all electronics"),e||r("relay",{},1,"Pump switching (omitted for VFD installs)");let n=a?.cableLengthMeters??50;return r("cable_valve",a?.componentParams?.cable_valve??{},n,"Valve actuator wiring (~10-20m per valve)"),r("cable_sensor",a?.componentParams?.cable_sensor??{},Math.round(n*.6),"Sensor signal wiring (~5-15m per sensor)"),o}function I(e,t,a){let o=[],r=(i,m={},p,u)=>{let s=g(i,m,t);if(!s){a?.diagnostics?.push({componentId:i,reason:`No active variant found for params ${JSON.stringify(m)}`});return}o.push(S(s.line,s.variant,p,v,u))},n=e.componentParams?.valve??{portSize:e.maxPipeDiameter},c=e.componentParams?.flow_sensor??{portSize:e.maxPipeDiameter};return e.numValveZones>0&&r("valve",n,e.numValveZones),e.numFlowSensors>0&&r("flow_sensor",c,e.numFlowSensors),o}function x(e,t,a){let o=a?.diagnostics,r=w(e.hasVfd,t,{cableLengthMeters:a?.cableLengthMeters,componentParams:e.componentParams,diagnostics:o}),n=I(e,t,{diagnostics:o}),c=[...r,...n];return{quoteId:L(),generatedAt:new Date().toISOString(),customerName:a?.customerName,siteName:a?.siteName,baseInfrastructure:r,systemComponents:n,subtotal:T(c),currency:"USD"}}function d(e,t){return e.filter(a=>a.kind===t).length}function U(e,t,a){let o=d(e.nodes,"vfd")>0,r=d(e.nodes,"valve"),n=d(e.nodes,"flow_sensor"),i={numTanks:d(e.nodes,"tank"),numPumps:d(e.nodes,"pump")+d(e.nodes,"vfd"),hasVfd:o,numValveZones:r,maxPipeDiameter:"DN20",numFlowSensors:n,componentParams:a?.componentParams,customerName:a?.customerName};return x(i,t,a)}function C(e){return new Date(e).toLocaleDateString("en-US",{year:"numeric",month:"short",day:"numeric"})}function b(e,t){let a=e.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});return t==="USD"?`$${a}`:`${a} ${t}`}function N(e,t){if(e.length===0)return"<p>None</p>";let a=t?'<th class="num">Unit Price</th><th class="num">Line Total</th>':"",o=e.map(r=>{let n=Object.entries(r.specs).map(([p,u])=>`<span class="tag">${p}: ${u}</span>`).join(" "),c=t?`<td class="num">${b(r.unitPrice,r.currency)}</td><td class="num">${b(r.lineTotal,r.currency)}</td>`:"",i=r.selectionHelp?`<div class="selection-help">${f(r.selectionHelp)}</div>`:"",m=r.notes?`<div class="notes">${f(r.notes)}</div>`:"";return`
        <tr>
          <td>
            <div class="item-name">${f(r.name)}</div>
            <div class="item-meta">
              <span class="manufacturer">${f(r.manufacturer)}</span>
              ${n}
            </div>
            ${i}${m}
          </td>
          <td class="num">${r.quantity}</td>
          ${c}
        </tr>
      `}).join("");return`
    <table class="bom-table">
      <thead>
        <tr>
          <th>Item</th>
          <th class="num">Qty</th>
          ${a}
        </tr>
      </thead>
      <tbody>
        ${o}
      </tbody>
    </table>
  `}function f(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function B(){return`
    <style>
      :root { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
      body { max-width: 900px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; line-height: 1.5; }
      .header { border-bottom: 2px solid #0d7377; padding-bottom: 16px; margin-bottom: 24px; }
      .header h1 { margin: 0 0 8px; font-size: 24px; color: #0d7377; }
      .meta { color: #666; font-size: 14px; }
      .meta span { margin-right: 16px; }
      h2 { font-size: 18px; margin-top: 28px; margin-bottom: 12px; color: #0d7377; border-bottom: 1px solid #e0e0e0; padding-bottom: 6px; }
      .bom-table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 14px; }
      .bom-table th { text-align: left; padding: 10px 8px; background: #f6f8fa; border-bottom: 2px solid #d0d7de; font-weight: 600; }
      .bom-table td { padding: 10px 8px; border-bottom: 1px solid #e8edf2; vertical-align: top; }
      .bom-table .num { text-align: right; white-space: nowrap; }
      .item-name { font-weight: 600; }
      .item-meta { color: #555; font-size: 12px; margin-top: 2px; }
      .tag { display: inline-block; background: #eef2f7; padding: 1px 6px; border-radius: 4px; margin-right: 4px; font-size: 11px; }
      .manufacturer { font-weight: 500; color: #0d7377; margin-right: 8px; }
      .selection-help { color: #555; font-size: 12px; margin-top: 4px; font-style: italic; }
      .notes { color: #777; font-size: 12px; margin-top: 4px; }
      .totals { margin-top: 16px; text-align: right; font-size: 16px; }
      .totals .subtotal { font-weight: 700; font-size: 18px; }
      .totals .approx { color: #666; font-size: 14px; margin-top: 6px; }
      .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #888; text-align: center; }
      @media print {
        body { margin: 0; padding: 20px; }
        .footer { page-break-inside: avoid; }
        h2 { page-break-after: avoid; }
        tr { page-break-inside: avoid; }
      }
    </style>
  `}function A(e,t){let a=e.customerName?`<div class="meta"><span>Customer: ${f(e.customerName)}</span></div>`:"",o=e.siteName?`<div class="meta"><span>Site: ${f(e.siteName)}</span></div>`:"",r=t.showPricing?`<div class="totals">
         <span class="subtotal">Subtotal: ${b(e.subtotal,e.currency)}</span>
         ${t.exchangeRate?`<div class="approx">Approximate KES total: KSh ${b(Math.round(e.subtotal*t.exchangeRate*100)/100,"KES")}</div>`:""}
       </div>`:"";return`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Quotation ${e.quoteId}</title>
  ${B()}
</head>
<body>
  <div class="header">
    <h1>MajiFlow Quotation</h1>
    <div class="meta">
      <span>Quote ID: ${e.quoteId}</span>
      <span>Date: ${C(e.generatedAt)}</span>
    </div>
    ${a}${o}
  </div>

  <h2>Base Infrastructure</h2>
  ${N(e.baseInfrastructure,t.showPricing)}

  <h2>System Components</h2>
  ${N(e.systemComponents,t.showPricing)}

  ${r}

  <div class="footer">
    Generated by MajiFlow \xB7 ${C(e.generatedAt)}<br>
    Prices are estimates and subject to supplier availability.
  </div>
</body>
</html>`}function R(e){return A(e,{showPricing:!1})}export{y as COMPONENT_REGISTRY,Q as DEFAULT_CATALOG,P as DEFAULT_DEFAULTS,D as DEFAULT_LINES,w as buildBaseInfrastructure,x as buildQuotation,U as buildQuotationFromTopology,I as buildTopologyComponents,A as renderQuotationHtml,R as renderTechnicalBomHtml,g as resolveQuoteLineItem};
