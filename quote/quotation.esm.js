var P=[{id:"ctrl-kc868-a16",category:"controller",subCategory:"esp32_relay_board",name:"Kincony KC868-A16",manufacturer:"Kincony",manufacturerPartNumber:"KC868-A16",specs:{voltage:"12V DC",communication:"Ethernet + WiFi",relays:"16",inputs:"16",adc:"4"},unitCostUsd:45,currency:"USD",description:"Industrial ESP32 relay controller with 16 relay outputs, 16 digital inputs, 4 ADC channels, Ethernet, and WiFi.",selectionHelp:"Primary recommended controller for all MajiFlow installations. DIN-rail mountable.",isActive:!0,isUserDefined:!1},{id:"compute-rpi-3bp",category:"base_infra",subCategory:"single_board_computer",name:"Raspberry Pi 3B+",manufacturer:"Raspberry Pi Foundation",manufacturerPartNumber:"RPI3-MODBP",specs:{voltage:"5V DC",memory:"1GB",storage:"microSD",ports:"4x USB, Ethernet, HDMI"},unitCostUsd:35,currency:"USD",description:"Home Assistant OS host. Quad-core 1.4GHz, 1GB RAM, onboard WiFi and Ethernet.",selectionHelp:"Required for Home Assistant OS. Runs the local automation hub.",isActive:!0,isUserDefined:!1},{id:"power-ups-12v",category:"power",subCategory:"ups",name:"12V DC UPS / Power Bank",manufacturer:"Generic",manufacturerPartNumber:"UPS-12V-20AH",specs:{voltage:"12V DC",capacity:"20Ah",output:"12V/5A",switchover:"<10ms"},unitCostUsd:28,currency:"USD",description:"12V DC uninterruptible power supply with lithium battery backup. Automatic switchover.",selectionHelp:"Keeps the controller and Pi alive during power outages. Essential for water systems.",isActive:!0,isUserDefined:!1},{id:"power-solar-kit",category:"power",subCategory:"solar",name:"Solar Panel + Charge Controller Kit",manufacturer:"Generic",manufacturerPartNumber:"SP-100W-KIT",specs:{wattage:"100W",voltage:"12V",controller:"PWM 10A",panelSize:"100W poly/mono"},unitCostUsd:55,currency:"USD",description:"100W solar panel with 10A PWM charge controller. Keeps the UPS battery topped up.",selectionHelp:"Reduces running costs and ensures off-grid capability. Always recommended.",isActive:!0,isUserDefined:!1},{id:"enclosure-din-ip54",category:"enclosure",subCategory:"din_rail",name:"DIN Rail Enclosure IP54",manufacturer:"Fibox",manufacturerPartNumber:"PC-300-300-150",specs:{ipRating:"IP54",dimensions:"300x300x150mm",material:"polycarbonate",modules:"18"},unitCostUsd:32,currency:"USD",description:"IP54 polycarbonate enclosure with DIN rail mounting. Houses controller, Pi, and power supplies.",selectionHelp:"IP54 is sufficient for covered outdoor installs. Upgrade to IP65 for direct exposure.",isActive:!0,isUserDefined:!1},{id:"relay-30a-module",category:"relay",subCategory:"high_current_relay",name:"30A Relay Module",manufacturer:"SainSmart",manufacturerPartNumber:"30A-RELAY-1CH",specs:{voltage:"12V DC",current:"30A",contacts:"SPDT",coil:"12V"},unitCostUsd:8.5,currency:"USD",description:"Single-channel 30A relay module for high-current pump switching. 12V coil.",selectionHelp:"Required for direct pump control (non-VFD). Omit if using a VFD.",isActive:!0,isUserDefined:!1},{id:"cable-valve-2c",category:"base_infra",subCategory:"cable",name:"Valve Cable 2-Core 1.0mm\xB2",manufacturer:"Generic",manufacturerPartNumber:"CV-2C-1.0",specs:{cores:"2",gauge:"1.0mm\xB2",rating:"300V",length:"per meter"},unitCostUsd:.8,currency:"USD",description:"Two-core 1.0mm\xB2 cable for valve actuator wiring. Price per meter.",selectionHelp:"Allow 10-20m per valve depending on layout.",isActive:!0,isUserDefined:!1},{id:"cable-sensor-shielded",category:"base_infra",subCategory:"cable",name:"Sensor Cable Shielded Twisted Pair 0.34mm\xB2",manufacturer:"Generic",manufacturerPartNumber:"STP-2PR-0.34",specs:{cores:"2 pair",gauge:"0.34mm\xB2",shield:"foil+braid",length:"per meter"},unitCostUsd:1.2,currency:"USD",description:"Shielded twisted pair for flow sensor and level sensor signal runs. Price per meter.",selectionHelp:"Allow 5-15m per sensor depending on layout.",isActive:!0,isUserDefined:!1},{id:"valve-bv12-dn15-atv",category:"valve",subCategory:"ball_valve",name:"12V DC Electric Ball Valve DN15",manufacturer:"ATV Motors",manufacturerPartNumber:"ATV-BV12-15",specs:{portSize:"DN15",voltage:"12V DC",pressureRating:"1.6MPa",material:"brass",actuator:"CR2-01"},unitCostUsd:22,currency:"USD",description:'2-way brass ball valve with 12V DC electric actuator. DN15 (1/2") BSP thread.',selectionHelp:"Default choice for DN15 systems. Reliable in hard water. ATV has good field feedback.",isActive:!0,isUserDefined:!1},{id:"valve-bv12-dn15-vx",category:"valve",subCategory:"ball_valve",name:"12V DC Electric Ball Valve DN15",manufacturer:"VX Industrial",manufacturerPartNumber:"VX-EV15-12",specs:{portSize:"DN15",voltage:"12V DC",pressureRating:"1.0MPa",material:"SS304",actuator:"standard"},unitCostUsd:26,currency:"USD",description:'2-way stainless steel ball valve with 12V DC actuator. DN15 (1/2") BSP thread.',selectionHelp:"Stainless steel body \u2014 better for corrosive or saline water. Slightly higher cost.",isActive:!0,isUserDefined:!1},{id:"valve-bv12-dn20-atv",category:"valve",subCategory:"ball_valve",name:"12V DC Electric Ball Valve DN20",manufacturer:"ATV Motors",manufacturerPartNumber:"ATV-BV12-20",specs:{portSize:"DN20",voltage:"12V DC",pressureRating:"1.6MPa",material:"brass",actuator:"CR2-01"},unitCostUsd:28,currency:"USD",description:'2-way brass ball valve with 12V DC electric actuator. DN20 (3/4") BSP thread.',selectionHelp:"Most common size for residential and small commercial systems.",isActive:!0,isUserDefined:!1},{id:"valve-bv12-dn20-vx",category:"valve",subCategory:"ball_valve",name:"12V DC Electric Ball Valve DN20",manufacturer:"VX Industrial",manufacturerPartNumber:"VX-EV20-12",specs:{portSize:"DN20",voltage:"12V DC",pressureRating:"1.0MPa",material:"SS304",actuator:"standard"},unitCostUsd:32,currency:"USD",description:'2-way stainless steel ball valve with 12V DC actuator. DN20 (3/4") BSP thread.',selectionHelp:"SS304 body for corrosive environments.",isActive:!0,isUserDefined:!1},{id:"valve-bv12-dn25-atv",category:"valve",subCategory:"ball_valve",name:"12V DC Electric Ball Valve DN25",manufacturer:"ATV Motors",manufacturerPartNumber:"ATV-BV12-25",specs:{portSize:"DN25",voltage:"12V DC",pressureRating:"1.6MPa",material:"brass",actuator:"CR2-02"},unitCostUsd:35,currency:"USD",description:'2-way brass ball valve with 12V DC electric actuator. DN25 (1") BSP thread.',selectionHelp:"Use for main lines or higher-flow zones.",isActive:!0,isUserDefined:!1},{id:"valve-bv12-dn25-vx",category:"valve",subCategory:"ball_valve",name:"12V DC Electric Ball Valve DN25",manufacturer:"VX Industrial",manufacturerPartNumber:"VX-EV25-12",specs:{portSize:"DN25",voltage:"12V DC",pressureRating:"1.0MPa",material:"SS304",actuator:"standard"},unitCostUsd:42,currency:"USD",description:'2-way stainless steel ball valve with 12V DC actuator. DN25 (1") BSP thread.',selectionHelp:"SS304 for larger corrosive lines.",isActive:!0,isUserDefined:!1},{id:"valve-bv12-dn32-atv",category:"valve",subCategory:"ball_valve",name:"12V DC Electric Ball Valve DN32",manufacturer:"ATV Motors",manufacturerPartNumber:"ATV-BV12-32",specs:{portSize:"DN32",voltage:"12V DC",pressureRating:"1.6MPa",material:"brass",actuator:"CR2-03"},unitCostUsd:48,currency:"USD",description:'2-way brass ball valve with 12V DC electric actuator. DN32 (1-1/4") BSP thread.',selectionHelp:"Commercial-grade flow. Verify pump capacity matches valve size.",isActive:!0,isUserDefined:!1},{id:"flow-yfs201-dn15",category:"flow_sensor",subCategory:"pulse_flow",name:"Hall Effect Flow Sensor DN15",manufacturer:"Sea Electronics",manufacturerPartNumber:"YF-S201-DN15",specs:{portSize:"DN15",voltage:"5-24V DC",flowRange:"1-30 L/min",pulsesPerLiter:"450",material:"nylon"},unitCostUsd:7.5,currency:"USD",description:'Hall effect water flow sensor with 1/2" BSP threads. 450 pulses per liter.',selectionHelp:"Reliable and cheap. Good for small zones and residential systems.",isActive:!0,isUserDefined:!1},{id:"flow-yfs201-dn20",category:"flow_sensor",subCategory:"pulse_flow",name:"Hall Effect Flow Sensor DN20",manufacturer:"Sea Electronics",manufacturerPartNumber:"YF-S201-DN20",specs:{portSize:"DN20",voltage:"5-24V DC",flowRange:"2-60 L/min",pulsesPerLiter:"300",material:"nylon"},unitCostUsd:9,currency:"USD",description:'Hall effect water flow sensor with 3/4" BSP threads. 300 pulses per liter.',selectionHelp:"Use for main lines or higher-flow zones.",isActive:!0,isUserDefined:!1},{id:"flow-yfs201-dn25",category:"flow_sensor",subCategory:"pulse_flow",name:"Hall Effect Flow Sensor DN25",manufacturer:"Sea Electronics",manufacturerPartNumber:"YF-S201-DN25",specs:{portSize:"DN25",voltage:"5-24V DC",flowRange:"5-100 L/min",pulsesPerLiter:"200",material:"nylon"},unitCostUsd:11.5,currency:"USD",description:'Hall effect water flow sensor with 1" BSP threads. 200 pulses per liter.',selectionHelp:"For commercial systems with higher flow requirements.",isActive:!0,isUserDefined:!1},{id:"flow-bronze-dn20",category:"flow_sensor",subCategory:"pulse_flow",name:"Brass Hall Effect Flow Sensor DN20",manufacturer:"FlowMax",manufacturerPartNumber:"FM-BR-20",specs:{portSize:"DN20",voltage:"5-24V DC",flowRange:"2-60 L/min",pulsesPerLiter:"280",material:"brass"},unitCostUsd:18,currency:"USD",description:"Brass-bodied Hall effect flow sensor. More durable than nylon in hard water.",selectionHelp:"Upgrade for hard water or high-temperature applications.",isActive:!0,isUserDefined:!1}];function d(e,a,r,o){let t=e.filter(n=>n.isActive&&n.category===a&&(!r||n.subCategory===r));if(t.length===0)return;if(Object.keys(o).length>0){for(let n of t){let i=!0;for(let[c,l]of Object.entries(o))if(n.specs[c]!==l){i=!1;break}if(i)return n}return}return t[0]}function U(){let a=new Date().toISOString().slice(0,10).replace(/-/g,""),r=Math.floor(Math.random()*1e4).toString().padStart(4,"0");return`Q-${a}-${r}`}var f=1.3;function v(e,a,r=f,o){let t=Math.round(e.unitCostUsd*r*100)/100;return{catalogItemId:e.id,name:e.name,manufacturer:e.manufacturer,specs:e.specs,description:e.description,quantity:a,unitCost:e.unitCostUsd,unitPrice:t,lineTotal:Math.round(t*a*100)/100,selectionHelp:e.selectionHelp,notes:o}}function V(e){return Math.round(e.reduce((a,r)=>a+r.lineTotal,0)*100)/100}function y(e,a,r){let o=[],t=(n,i,c,l,p)=>{let b=d(a,n,i,c);b&&o.push(v(b,l,f,p))};t("controller","esp32_relay_board",{},1,"Main controller"),t("base_infra","single_board_computer",{},1,"Home Assistant OS host"),t("power","ups",{},1,"Battery backup for controller and Pi"),t("power","solar",{},1,"Keeps UPS charged, reduces running costs"),t("enclosure","din_rail",{},1,"Houses all electronics"),e||t("relay","high_current_relay",{},1,"Pump switching (omitted for VFD installs)");let s=r?.cableLengthMeters??50;return t("base_infra","cable",{gauge:"1.0mm\xB2"},s,"Valve actuator wiring (~10-20m per valve)"),t("base_infra","cable",{gauge:"0.34mm\xB2"},Math.round(s*.6),"Sensor signal wiring (~5-15m per sensor)"),o}function h(e,a){let r=[],o=(t,s,n,i,c)=>{let l=d(a,t,s,n);l&&r.push(v(l,i,f,c))};return e.numValveZones>0&&o("valve","ball_valve",{portSize:e.maxPipeDiameter},e.numValveZones),e.numFlowSensors>0&&o("flow_sensor","pulse_flow",{portSize:e.maxPipeDiameter},e.numFlowSensors),r}function D(e,a,r){let o=y(e.hasVfd,a,r),t=h(e,a),s=[...o,...t];return{quoteId:U(),generatedAt:new Date().toISOString(),customerName:r?.customerName,siteName:r?.siteName,baseInfrastructure:o,systemComponents:t,subtotal:V(s),currency:"USD"}}function u(e,a){return e.filter(r=>r.kind===a).length}function x(e,a,r){let o=u(e.nodes,"vfd")>0,t=u(e.nodes,"valve"),s=u(e.nodes,"flow_sensor"),i={numTanks:u(e.nodes,"tank"),numPumps:u(e.nodes,"pump")+u(e.nodes,"vfd"),hasVfd:o,numValveZones:t,maxPipeDiameter:"DN20",numFlowSensors:s,customerName:r?.customerName};return D(i,a,r)}function C(e){return new Date(e).toLocaleDateString("en-US",{year:"numeric",month:"short",day:"numeric"})}function g(e){return e.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}function S(e,a){if(e.length===0)return"<p>None</p>";let r=a?'<th class="num">Unit Price</th><th class="num">Line Total</th>':"",o=e.map(t=>{let s=Object.entries(t.specs).map(([l,p])=>`<span class="tag">${l}: ${p}</span>`).join(" "),n=a?`<td class="num">$${g(t.unitPrice)}</td><td class="num">$${g(t.lineTotal)}</td>`:"",i=t.selectionHelp?`<div class="selection-help">${m(t.selectionHelp)}</div>`:"",c=t.notes?`<div class="notes">${m(t.notes)}</div>`:"";return`
        <tr>
          <td>
            <div class="item-name">${m(t.name)}</div>
            <div class="item-meta">
              <span class="manufacturer">${m(t.manufacturer)}</span>
              ${s}
            </div>
            ${i}${c}
          </td>
          <td class="num">${t.quantity}</td>
          ${n}
        </tr>
      `}).join("");return`
    <table class="bom-table">
      <thead>
        <tr>
          <th>Item</th>
          <th class="num">Qty</th>
          ${r}
        </tr>
      </thead>
      <tbody>
        ${o}
      </tbody>
    </table>
  `}function m(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function N(){return`
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
      .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #888; text-align: center; }
      @media print {
        body { margin: 0; padding: 20px; }
        .footer { page-break-inside: avoid; }
        h2 { page-break-after: avoid; }
        tr { page-break-inside: avoid; }
      }
    </style>
  `}function w(e,a){let r=e.customerName?`<div class="meta"><span>Customer: ${m(e.customerName)}</span></div>`:"",o=e.siteName?`<div class="meta"><span>Site: ${m(e.siteName)}</span></div>`:"",t=a.showPricing?`<div class="totals"><span class="subtotal">Subtotal: $${g(e.subtotal)}</span></div>`:"";return`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Quotation ${e.quoteId}</title>
  ${N()}
</head>
<body>
  <div class="header">
    <h1>MajiFlow Quotation</h1>
    <div class="meta">
      <span>Quote ID: ${e.quoteId}</span>
      <span>Date: ${C(e.generatedAt)}</span>
    </div>
    ${r}${o}
  </div>

  <h2>Base Infrastructure</h2>
  ${S(e.baseInfrastructure,a.showPricing)}

  <h2>System Components</h2>
  ${S(e.systemComponents,a.showPricing)}

  ${t}

  <div class="footer">
    Generated by MajiFlow \xB7 ${C(e.generatedAt)}<br>
    Prices are estimates and subject to supplier availability.
  </div>
</body>
</html>`}function I(e){return w(e,{showPricing:!1})}export{P as DEFAULT_CATALOG,y as buildBaseInfrastructure,D as buildQuotation,x as buildQuotationFromTopology,h as buildTopologyComponents,d as findDefaultCatalogItem,w as renderQuotationHtml,I as renderTechnicalBomHtml};
