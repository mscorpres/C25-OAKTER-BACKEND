const express = require("express");
const router = express.Router();
const moment = require("moment");
const Validator = require("validatorjs");
const { getDbContextByGST } = require("../../helper/utils/gstDbMapper");

const CHUNK_SIZE = 100;

const VBT_TYPE_MAP = {
  VBT01: "PurchaseC25",
  VBT04: "PurchaseC25",
  VBT05: "PurchaseC25",
  VBT02: "Purchase-Services",
  VBT06: "Purchase-Services",
  VBT03: "Purchase-Import(Goods)",
  VBT07: "RCM-Invoice",
};

const CONSIGNEE_CONFIGS = {
  C25: {
    name: "Riot Labz Private Limited",
    address: "WH: C-25, Phase II,",
    address1: "Hosiery Complex, Noida 201305",
    pin: "201305",
    state: "Uttar Pradesh",
    country: "India",
    gst: "09AAHCR1005Q1Z4",
  },
};

// Helper: replace "--", null, undefined, or "0" (when placeholder) with clean string
function cleanValue(val) {
  if (val === null || val === undefined) return "";
  const str = String(val).trim();
  if (str === "--" || str === "N/A" || str === "null" || str === "undefined") {
    return "";
  }
  return str;
}

// Helper: formats address string into 2-3 clean lines array of objects
function formatAddressLines(rawAddress, maxLines = 3) {
  if (!rawAddress || cleanValue(rawAddress) === "") return [];

  const cleaned = String(rawAddress).replace(/[\r\n]+/g, ", ").trim();

  const parts = cleaned
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  if (!parts.length) return [];

  const lines = [];
  const chunkSize = Math.ceil(parts.length / maxLines);

  for (let i = 0; i < parts.length; i += chunkSize) {
    const chunk = parts.slice(i, i + chunkSize).join(", ");
    if (chunk) {
      lines.push({ address: chunk });
    }
  }

  return lines;
}

function getConsigneeConfigByGst(gstNo) {
  const normalized = String(gstNo || "").trim().toUpperCase();
  const match = Object.values(CONSIGNEE_CONFIGS).find(
    (cfg) => cfg.gst.toUpperCase() === normalized
  );
  return match || CONSIGNEE_CONFIGS.C25;
}

function buildItemQueryByVBT(inventoryDbName) {
  return `
    SELECT DISTINCT
      components.c_name AS partname,
      components.c_part_no AS partno,
      all_sub_groups.sub_group_name AS subgroupname,
      units.units_name AS uom,
      components.c_hsn AS hsn,
      components.c_gst AS gst,
      components.c_tax_type AS taxtype
    FROM tally_vbt
    INNER JOIN ${inventoryDbName}.components AS components 
      ON components.component_key = tally_vbt.part_code
    LEFT JOIN ${inventoryDbName}.units AS units 
      ON units.units_id = components.c_uom
    LEFT JOIN ${inventoryDbName}.all_sub_groups AS all_sub_groups 
      ON all_sub_groups.sub_group_id = components.c_sub_group
    WHERE tally_vbt.vbt_status != 'DE'
      AND (DATE_FORMAT(tally_vbt.insert_date, '%Y-%m-%d') BETWEEN :date1 AND :date2)
      AND components.c_is_enabled = 'Y'
    ORDER BY components.c_name ASC
  `;
}

function buildVendorQueryByVBT(inventoryDbName) {
  return `
    SELECT DISTINCT
      vendor.ven_name AS vendorName,
      vendor.ven_register_id AS vendorCode,
      'India' AS vendorCountry,
      stateCode.state_name AS vendorState,
      vad.ven_pincode AS vendorPincode,
      vad.ven_address AS rawAddress,
      vad.ven_bank_ac AS vendorBankAc,
      vad.ven_bank_ifsc AS vendorBankIfsc,
      vad.ven_bank_name AS vendorBankName,
      vendor.ven_pan_no AS vendorPan,
      'Regular' AS vendorGstType,
      vad.ven_add_gst AS vendorGst,
      vad.ven_email AS vendorEmail,
      vad.ven_mobile AS vendorMobile,
      vendor.ven_msme_id AS vendorMsmeId,
      vendor.ven_msme_type AS vendorMsmeType,
      vendor.ven_msme_activity AS vendorMsmeActivity
    FROM tally_vbt
    INNER JOIN ${inventoryDbName}.ven_basic_detail AS vendor 
      ON vendor.ven_register_id = tally_vbt.ven_code
    LEFT JOIN ${inventoryDbName}.ven_address_detail vad 
      ON vad.ven_id = vendor.ven_register_id
    LEFT JOIN ${inventoryDbName}.state_code AS stateCode 
      ON stateCode.state_code = vad.ven_state
    WHERE tally_vbt.vbt_status != 'DE'
      AND (DATE_FORMAT(tally_vbt.insert_date, '%Y-%m-%d') BETWEEN :date1 AND :date2)
      AND vendor.status = 'A'
    ORDER BY vendor.ven_name ASC
  `;
}

async function batchLoadVendorSubGroups(vendorCodes, tallyDb) {
  if (!vendorCodes.size) return new Map();

  const escapedCodes = [...vendorCodes].map((c) => tallyDb.escape(c)).join(",");
  const sql = `
    SELECT 
      tally_ledger.code AS vendorCode,
      tally_group.group_name AS group_name,
      tally_group.code AS group_code
    FROM tally_ledger
    LEFT JOIN tally_group ON tally_group.group_key = tally_ledger.sub_group_key
    WHERE tally_ledger.code IN (${escapedCodes})
  `;

  const rows = await tallyDb.query(sql, { type: tallyDb.QueryTypes.SELECT });
  const map = new Map();

  for (const r of rows) {
    if (r.vendorCode) {
      const subGroupName = r.group_name
        ? `${r.group_name}${r.group_code ? `(${r.group_code})` : ""}`
        : "";
      map.set(String(r.vendorCode).trim(), subGroupName);
    }
  }

  return map;
}

function buildMainQuery(inventoryDbName) {
  const base = `
    SELECT tally_vbt.*,
      COALESCE(components.c_name, products.p_name)                  AS itemName,
      COALESCE(components.c_part_no, products.p_sku)                AS partNo,
      COALESCE(components.c_specification, products.p_description) AS itemDesc,
      tally_vbt.hsn_code                                              AS hsn_code,
      units.units_name                                              AS uom_name,
      currency.currency_symbol,
      gl.ladger_name          AS glName,
      cgstLadger.ladger_name  AS cgstLedgerName,
      sgstLadger.ladger_name  AS sgstLedgerName,
      igstLadger.ladger_name  AS igstLedgerName,
      tdsLadger.ladger_name   AS tdsLedgerName,
      roundoffLadger.ladger_name AS roundoffLedgerName,
      tdsCode.code AS tdsName
    FROM tally_vbt
    LEFT JOIN ${inventoryDbName}.components      AS components ON components.component_key  = tally_vbt.part_code
    LEFT JOIN ${inventoryDbName}.products        AS products   ON products.product_key       = tally_vbt.part_code
    LEFT JOIN ${inventoryDbName}.units           AS units      ON units.units_id             = components.c_uom
    LEFT JOIN tally_ledger                       AS gl          ON gl.ledger_key             = tally_vbt.gl_code
    LEFT JOIN tally_ledger                       AS cgstLadger  ON cgstLadger.ledger_key     = tally_vbt.vbt_cgst_gl
    LEFT JOIN tally_ledger                       AS sgstLadger  ON sgstLadger.ledger_key     = tally_vbt.vbt_sgst_gl
    LEFT JOIN tally_ledger                       AS igstLadger  ON igstLadger.ledger_key     = tally_vbt.vbt_igst_gl
    LEFT JOIN tally_ledger                       AS tdsLadger   ON tdsLadger.ledger_key      = tally_vbt.tds_gl
    LEFT JOIN tally_ledger                       AS roundoffLadger ON roundoffLadger.ledger_key = tally_vbt.round_off_gl
    LEFT JOIN tally_ledger AS tdsCode ON tally_vbt.tds_gl = tdsCode.ledger_key
    LEFT JOIN ${inventoryDbName}.ims_currency    AS currency    ON currency.currency_id       = tally_vbt.currency_type
  `;

  const notDeleted = `tally_vbt.vbt_status != 'DE'`;
  const order = `ORDER BY tally_vbt.effective_date DESC`;

  return `${base} WHERE (DATE_FORMAT(tally_vbt.insert_date,'%Y-%m-%d') BETWEEN :date1 AND :date2) AND ${notDeleted} ${order}`;
}

async function batchLoadMinData(rows, inventoryDb, inventoryDbName) {
  const pairs = rows
    .filter(
      (r) => r.min_id && r.min_id !== "--" && r.min_id !== "" && r.part_code
    )
    .map((r) => `(${inventoryDb.escape(r.min_id)}, ${inventoryDb.escape(r.part_code)})`);

  if (!pairs.length) return new Map();

  const sql = `
    SELECT minTable.in_transaction_id   AS min_id,
           minTable.components_id        AS part_code,
           minTable.insert_date          AS minDate,
           minTable.in_vendor_branch,
           minTable.in_vendor_name       AS venCode,
           minTable.rm_loc_cost_center   AS costCentreCode
    FROM ${inventoryDbName}.rm_location AS minTable
    WHERE minTable.trans_type = 'INWARD' AND (minTable.in_transaction_id, minTable.components_id) IN (${pairs.join(",")})
  `;
  const results = await inventoryDb.query(sql, { type: inventoryDb.QueryTypes.SELECT });
  const map = new Map();
  for (const r of results) {
    map.set(`${r.min_id}::${r.part_code}`, r);
  }
  return map;
}

async function batchLoadFgMinData(rows, minMap, inventoryDb, inventoryDbName) {
  const pairs = [];
  const seen = new Set();
  for (const r of rows) {
    const k = `${r.min_id}::${r.part_code}`;
    if (minMap.has(k)) continue;
    if (!r.min_id || r.min_id === "--" || r.min_id === "") continue;
    if (!(r.txn_type === "FG" || String(r.min_id).toUpperCase().includes("FGIN")))
      continue;
    if (seen.has(k)) continue;
    seen.add(k);
    pairs.push(`(${inventoryDb.escape(r.min_id)}, ${inventoryDb.escape(r.part_code)})`);
  }
  if (!pairs.length) return new Map();

  const sql = `
    SELECT mfg.mfg_pro_apr_fulldate AS minDate,
           mfg.mfg_ref_transid_1    AS mfgPoRef,
           mfg.mfg_cost_center      AS costCentreCode,
           mfg.mfg_pro_apr_transaction AS min_id,
           p.product_key             AS part_code
    FROM ${inventoryDbName}.mfg_production_3 AS mfg
    INNER JOIN ${inventoryDbName}.products AS p ON mfg.mfg_pro_apr_sku = p.p_sku
    WHERE (mfg.mfg_pro_apr_transaction, p.product_key) IN (${pairs.join(",")})
      AND mfg.type IN ('IN','FGMIN')
  `;
  const results = await inventoryDb.query(sql, { type: inventoryDb.QueryTypes.SELECT });
  const map = new Map();
  for (const row of results) {
    map.set(`${row.min_id}::${row.part_code}`, row);
  }
  return map;
}

async function batchLoadVendorDetails(venIds, inventoryDb) {
  if (!venIds.size) return new Map();

  const ids = [...venIds].map((id) => inventoryDb.escape(id)).join(",");
  const primarySql = `
    SELECT venAddress.ven_id,
           venAddress.ven_address_id,
           venAddress.ven_address,
           venAddress.ven_city,
           venAddress.ven_pincode,
           venAddress.ven_add_gst AS venGst,
           vendor.ven_name        AS vendor_name,
           CASE WHEN venAddress.ven_state = 100 THEN 'Other' 
              ELSE venState.state_name 
         END AS venState
    FROM ven_address_detail AS venAddress
    LEFT JOIN ven_basic_detail AS vendor ON vendor.ven_register_id = venAddress.ven_id
    LEFT JOIN state_code AS venState ON venState.state_code = venAddress.ven_state
    WHERE venAddress.ven_id IN (${ids})
  `;
  const allAddresses = await inventoryDb.query(primarySql, {
    type: inventoryDb.QueryTypes.SELECT,
  });

  const venMap = new Map();
  for (const r of allAddresses) {
    if (!venMap.has(r.ven_id)) venMap.set(r.ven_id, { default: null, branches: new Map() });
    const entry = venMap.get(r.ven_id);
    if (!entry.default) entry.default = r;
    entry.branches.set(String(r.ven_address_id), r);
  }
  return venMap;
}

async function batchLoadCostCenters(keys, inventoryDb) {
  if (!keys.size) return new Map();
  const ids = [...keys].map((k) => inventoryDb.escape(k)).join(",");
  const sql = `
    SELECT cost_center_key, cost_center_short_name, cost_center_name, cost_center_alias
    FROM cost_center
    WHERE cost_center_key IN (${ids})
  `;
  const rows = await inventoryDb.query(sql, { type: inventoryDb.QueryTypes.SELECT });
  return new Map(
    rows.map((r) => [
      String(r.cost_center_key),
      {
        name: r.cost_center_name,
        alias: r.cost_center_alias,
      },
    ])
  );
}

async function batchLoadPODetails(poNumbers, inventoryDb) {
  if (!poNumbers.size) return new Map();
  const ids = [...poNumbers].map((n) => inventoryDb.escape(n)).join(",");
  const sql = `
    SELECT po_transaction, po_full_date AS poDate, po_ship_id AS poShipId, po_cost_center
    FROM po_purchase_req
    WHERE po_transaction IN (${ids})
  `;
  const rows = await inventoryDb.query(sql, { type: inventoryDb.QueryTypes.SELECT });
  return new Map(rows.map((r) => [r.po_transaction, r]));
}

async function batchLoadJWDetails(jwIds, inventoryDb) {
  if (!jwIds.size) return new Map();
  const ids = [...jwIds].map((n) => inventoryDb.escape(n)).join(",");
  const sql = `
    SELECT jw_jw_transaction, jw_po_ship_id AS jwShipId, jw_po_full_date AS jwDate, jw_cost_center
    FROM jw_purchase_req
    WHERE jw_jw_transaction IN (${ids})
  `;
  const rows = await inventoryDb.query(sql, { type: inventoryDb.QueryTypes.SELECT });
  return new Map(rows.map((r) => [r.jw_jw_transaction, r]));
}

async function batchLoadShipments(codes, tallyDb, inventoryDbName) {
  if (!codes.size) return new Map();
  const ids = [...codes].map((c) => tallyDb.escape(c)).join(",");
  const sql = `
    SELECT * FROM ${inventoryDbName}.shipment_address
    WHERE shipment_code IN (${ids})
  `;
  const rows = await tallyDb.query(sql, { type: tallyDb.QueryTypes.SELECT });
  return new Map(rows.map((r) => [r.shipment_code, r]));
}

function processChunk(rows, consigneeConfig, inventoryDb, inventoryDbName, tallyDb) {
  return (async () => {
    const venIds = new Set();
    const poNumbers = new Set();
    const jwIds = new Set();
    const ccKeys = new Set();

    for (const r of rows) {
      if (r.po_number && r.po_number !== "--" && r.po_number !== "")
        poNumbers.add(r.po_number);
      if (r.jw_id && r.jw_id !== "--" && r.jw_id !== "")
        jwIds.add(r.jw_id);
      if (r.ven_code && r.ven_code !== "--") venIds.add(String(r.ven_code));
    }

    const minMap = await batchLoadMinData(rows, inventoryDb, inventoryDbName);
    const fgMinMap = await batchLoadFgMinData(rows, minMap, inventoryDb, inventoryDbName);

    for (const r of rows) {
      const k = `${r.min_id}::${r.part_code}`;
      if (!minMap.has(k) && fgMinMap.has(k)) {
        const fg = fgMinMap.get(k);
        minMap.set(k, {
          minDate: fg.minDate,
          venCode: r.ven_code,
          in_vendor_branch: "--",
          costCentreCode:
            fg.costCentreCode && fg.costCentreCode !== "--"
              ? String(fg.costCentreCode)
              : null,
          mfgPoRef: fg.mfgPoRef,
        });
      }
    }

    for (const minData of minMap.values()) {
      if (minData.venCode) venIds.add(String(minData.venCode));
      if (minData.costCentreCode && minData.costCentreCode !== "--")
        ccKeys.add(String(minData.costCentreCode));
    }

    for (const r of rows) {
      const k = `${r.min_id}::${r.part_code}`;
      const m = minMap.get(k);
      if (
        (!r.po_number || r.po_number === "--" || r.po_number === "") &&
        m?.mfgPoRef &&
        m.mfgPoRef !== "--" &&
        String(m.mfgPoRef).trim() !== ""
      ) {
        poNumbers.add(String(m.mfgPoRef));
      }
    }

    const [venMap, poMap, jwMap] = await Promise.all([
      batchLoadVendorDetails(venIds, inventoryDb),
      batchLoadPODetails(poNumbers, inventoryDb),
      batchLoadJWDetails(jwIds, inventoryDb),
    ]);

    const shipCodes = new Set();
    for (const po of poMap.values()) {
      if (po.poShipId && po.poShipId !== "--") shipCodes.add(po.poShipId);
      if (po.po_cost_center && po.po_cost_center !== "--")
        ccKeys.add(String(po.po_cost_center));
    }
    for (const jw of jwMap.values()) {
      if (jw.jwShipId && jw.jwShipId !== "--") shipCodes.add(jw.jwShipId);
      if (jw.jw_cost_center && jw.jw_cost_center !== "--")
        ccKeys.add(String(jw.jw_cost_center));
    }

    const [ccMap] = await Promise.all([
      batchLoadCostCenters(ccKeys, inventoryDb),
      batchLoadShipments(shipCodes, tallyDb, inventoryDbName),
    ]);

    const voucherGroups = new Map();

    for (const row of rows) {
      const vbtKey = row.vbt_key || row.vbt_invoice_no;
      if (!voucherGroups.has(vbtKey)) {
        voucherGroups.set(vbtKey, []);
      }
      voucherGroups.get(vbtKey).push(row);
    }

    const vouchers = [];

    for (const [vbtKey, vbtRows] of voucherGroups.entries()) {
      const firstRow = vbtRows[0];
      const minKey = `${firstRow.min_id}::${firstRow.part_code}`;
      const minData = minMap.get(minKey);

      let venName = cleanValue(firstRow.ven_code);
      const venEntry = venMap.get(String(firstRow.ven_code));
      if (venEntry?.default?.vendor_name) {
        venName = cleanValue(venEntry.default.vendor_name);
      }

      const orderMap = new Map();
      const delnotesMap = new Map();

      for (const row of vbtRows) {
        const rowMinKey = `${row.min_id}::${row.part_code}`;
        const rowMinData = minMap.get(rowMinKey);

        // Collect unique delivery notes
        if (row.min_id && row.min_id !== "--" && !delnotesMap.has(row.min_id)) {
          delnotesMap.set(row.min_id, {
            basicshippingdate: rowMinData?.minDate
              ? moment(rowMinData.minDate).format("DD-MM-YYYY")
              : moment(row.insert_date).format("DD-MM-YYYY"),
            basicshipdeliverynote: cleanValue(row.min_id),
          });
        }

        // Determine PO or JW key for the current row
        const rowPoLookupKey =
          row.po_number && row.po_number !== "--" && row.po_number !== ""
            ? row.po_number
            : rowMinData?.mfgPoRef &&
              rowMinData.mfgPoRef !== "--" &&
              String(rowMinData.mfgPoRef).trim() !== ""
              ? String(rowMinData.mfgPoRef)
              : null;

        const po = rowPoLookupKey ? poMap.get(rowPoLookupKey) : null;
        const jw = jwMap.get(row.jw_id);

        if (po && !orderMap.has(rowPoLookupKey)) {
          const parsedDate = moment(po.poDate, "DD-MM-YYYY", true).isValid()
            ? moment(po.poDate, "DD-MM-YYYY")
            : moment(po.poDate);
          orderMap.set(rowPoLookupKey, {
            basicorderdate: parsedDate.isValid() ? parsedDate.format("DD-MM-YYYY") : "",
            basicpurchaseorderno: cleanValue(rowPoLookupKey),
          });
        } else if (jw && !orderMap.has(row.jw_id)) {
          const parsedDate = moment(jw.jwDate).isValid() ? moment(jw.jwDate).format("DD-MM-YYYY") : "";
          orderMap.set(row.jw_id, {
            basicorderdate: parsedDate,
            basicpurchaseorderno: cleanValue(row.jw_id),
          });
        }
      }

      const delnotes = Array.from(delnotesMap.values());
      const orderlist = Array.from(orderMap.values());

      // Fallback configuration for reference strings using the first detected order
      const firstOrderKey = orderMap.size > 0 ? orderMap.keys().next().value : null;
      const po = firstOrderKey ? poMap.get(firstOrderKey) : null;
      const jw = jwMap.get(firstRow.jw_id);
      const invNo = cleanValue(firstRow.vbt_invoice_no);

      let orderNo, reference, refNo;
      if (po) {
        orderNo = cleanValue(firstOrderKey);
        const parts = orderNo.split("-");
        const formattedOrder = orderNo.replace(/^(PO|JO)\/(\d{2})-(\d{2})\/(\d+)$/i, "$1$3$4");
        refNo = `${invNo} ${formattedOrder}`.trim();
        reference = firstRow.vbt_invoice_no + " PO" + parts[1]?.replace("/", "");
      } else if (jw) {
        orderNo = cleanValue(firstRow.jw_id);
        const parts = orderNo.split("-");
        reference = firstRow.vbt_invoice_no + " JO" + parts[1]?.replace("/", "");
        const formattedOrder = orderNo.replace(/^(PO|JO)\/(\d{2})-(\d{2})\/(\d+)$/i, "$1$3$4");
        refNo = `${invNo} ${formattedOrder}`.trim();
      }

      let totalTaxable = 0;
      let totalCgst = 0;
      let totalSgst = 0;
      let totalIgst = 0;
      let totalRoundOff = 0;
      let totalPartyAmt = 0;

      let cgstLedgerName = "";
      let sgstLedgerName = "";
      let igstLedgerName = "";
      let roundoffLedgerName = "";
      let primaryCostCenter = "";

      const inventoryentry = [];
      const tdsLedgerMap = new Map(); // Tracks TDS ledgers and sums identical ones

      for (const row of vbtRows) {
        const itemMinKey = `${row.min_id}::${row.part_code}`;
        const itemMinData = minMap.get(itemMinKey);
        let costCenterKey = itemMinData?.costCentreCode ? String(itemMinData.costCentreCode) : null;
        // Fall back to the PO / JW cost centre when the MIN has none
        if (!costCenterKey || !ccMap.get(costCenterKey)) {
          if (po?.po_cost_center && po.po_cost_center !== "--") {
            costCenterKey = String(po.po_cost_center);
          } else if (jw?.jw_cost_center && jw.jw_cost_center !== "--") {
            costCenterKey = String(jw.jw_cost_center);
          }
        }
        const costCenter = costCenterKey ? ccMap.get(costCenterKey) : null;
        // Tally cost centre allocations should show the alias, not the full name
        const costCenterAlias = costCenter?.alias || costCenter?.name || "";

        if (!primaryCostCenter && costCenterAlias) {
          primaryCostCenter = costCenterAlias;
        }

        const taxableVal = Number(row.vbt_taxable_value) || 0;
        const cgstVal = Number(row.vbt_cgst) || 0;
        const sgstVal = Number(row.vbt_sgst) || 0;
        const igstVal = Number(row.vbt_igst) || 0;
        const roundVal = row.round_off_amt
          ? Number((row.round_off_sign === "-" ? "-" : "") + row.round_off_amt)
          : 0;
        const partyVal =
          Number(row.vbt_ven_ammount) ||
          (taxableVal + cgstVal + sgstVal + igstVal + roundVal);

        totalTaxable += taxableVal;
        totalCgst += cgstVal;
        totalSgst += sgstVal;
        totalIgst += igstVal;
        totalRoundOff += roundVal;
        totalPartyAmt += partyVal;

        if (row.cgstLedgerName) cgstLedgerName = cleanValue(row.cgstLedgerName);
        if (row.sgstLedgerName) sgstLedgerName = cleanValue(row.sgstLedgerName);
        if (row.igstLedgerName) igstLedgerName = cleanValue(row.igstLedgerName);
        if (row.roundoffLedgerName) roundoffLedgerName = cleanValue(row.roundoffLedgerName);

        // Group & sum TDS by ledger name across all rows
        const rowTdsName = cleanValue(row.tdsName);
        const rowTdsAmt = Number(row.vbt_tds_amount) || 0;
        if (rowTdsName && rowTdsAmt > 0) {
          const currentTds = tdsLedgerMap.get(rowTdsName) || 0;
          tdsLedgerMap.set(rowTdsName, currentTds + rowTdsAmt);
        }

        const godown =
          row.txn_type === "RAW" || row.txn_type === "SER"
            ? "GDRM001_C25"
            : "GDFG001";

        const isTaxable = Number(row.vbt_gst_rate) > 0 ? "Taxable" : "Non-Taxable";
        inventoryentry.push({
          stockitemname: cleanValue(row.partNo) || cleanValue(row.itemName),
          gstovrdntaxability: isTaxable,
          gstrate: String(row.vbt_gst_rate || 0),
          gsthsnname: cleanValue(row.hsn_code),
          rate: `${Number(row.vbt_inrate)}`,
          amount: `${taxableVal.toFixed(2)}`,
          billedqty: `${Number(row.vbt_bill_qty).toFixed(2)}`,
          godownname: godown,
          ledgername: cleanValue(row.glName),
          category: "Main",
          costcentreallocations: costCenterAlias
            ? [
              {
                name: costCenterAlias,
                amount: taxableVal.toFixed(2),
              },
            ]
            : [],
        });
      }

      // 1. Single Bill Allocation (Created once per voucher, not inside the row loop)
      const invoiceAmt =
        firstRow.vbt_invoice_total_ammount && firstRow.vbt_invoice_total_ammount !== "--"
          ? Number(firstRow.vbt_invoice_total_ammount).toFixed(2)
          : totalPartyAmt.toFixed(2);

      const billallocations = [
        {
          name: cleanValue(refNo) || invNo,
          billtype: reference || cleanValue(firstRow.vbt_invoice_no),
          amount: invoiceAmt,
          CostCentre: primaryCostCenter || "",
        },
      ];

      const ledgerentries = [
        {
          ledgername: cleanValue(firstRow.ven_code),
          ispartyledger: true,
          amount: totalPartyAmt.toFixed(2),
          billallocations: billallocations,
        },
      ];

      if (totalSgst > 0) {
        ledgerentries.push({
          ledgername: sgstLedgerName,
          ispartyledger: false,
          amount: totalSgst.toFixed(2),
        });
      }

      if (totalCgst > 0) {
        ledgerentries.push({
          ledgername: cgstLedgerName,
          ispartyledger: false,
          amount: totalCgst.toFixed(2),
        });
      }

      if (totalIgst > 0) {
        ledgerentries.push({
          ledgername: igstLedgerName,
          ispartyledger: false,
          amount: totalIgst.toFixed(2),
        });
      }

      if (totalRoundOff !== 0) {
        ledgerentries.push({
          ledgername: roundoffLedgerName,
          ispartyledger: false,
          amount: totalRoundOff.toFixed(2),
        });
      }

      // 2. Add TDS ledger entries: identical ledgers are summed; different ones stay separate
      for (const [tdsName, sumTdsAmt] of tdsLedgerMap.entries()) {
        ledgerentries.push({
          ledgername: tdsName,
          ispartyledger: false,
          amount: `-${sumTdsAmt.toFixed(2)}`,
        });
      }

      vouchers.push({
        vouchertypename: VBT_TYPE_MAP[firstRow.vbt_type] || "",
        vouchernumber: cleanValue(firstRow.vbt_key),
        voucherdate: moment(firstRow.effective_date).format("DD-MM-YYYY"),
        refnumber: cleanValue(firstRow.vbt_invoice_no),
        refdate: firstRow.vbt_invoice_date,
        narration: cleanValue(firstRow.vbt_comment),
        BuyerName: cleanValue(firstRow.ven_code),
        BuyerAddressType: "Primary",
        consigneemailingname: consigneeConfig.name,
        consigneeaddress: [
          { address: consigneeConfig.address },
          { address: consigneeConfig.address1 },
        ],
        consigneepinnumber: consigneeConfig.pin,
        consigneestatename: consigneeConfig.state,
        consigneecountryname: consigneeConfig.country,
        consigneegstin: consigneeConfig.gst,
        delnotes,
        orderlist,
        inventoryentry,
        ledgerentries,
      });
    }

    return vouchers;
  })();
}

function resolveWarehouseByGst(gstNo) {
  let ctx;
  try {
    ctx = getDbContextByGST(gstNo);
  } catch (err) {
    return null;
  }

  const consigneeConfig = getConsigneeConfigByGst(gstNo);

  return { consigneeConfig, warehouseContext: ctx };
}

function normalizeGst(gst) {
  const trimmed = String(gst || "").trim().toUpperCase();
  if (trimmed.length === 14 && /^[0-9]/.test(trimmed)) {
    return "0" + trimmed;
  }
  return trimmed;
}

router.get("/purchase/gst=:gst", async (req, res) => {
  try {
    const { gst: rawGst } = req.params;
    const { data, from, to, mode, type, queryType, reportType, wise } = req.query;

    const gst = normalizeGst(rawGst);

    if (!gst) {
      return res.status(400).json({
        success: false,
        message: "GST number is required in the route parameter",
      });
    }

    const resolved = resolveWarehouseByGst(gst);
    if (!resolved) {
      return res.status(404).json({
        success: false,
        message: `GST number ${gst} is not a recognized branch GST`,
      });
    }

    const { consigneeConfig, warehouseContext } = resolved;
    const reportMode = String(mode || type || queryType || reportType || "vbt").toLowerCase();

    if (!["vbt", "item", "vendor"].includes(reportMode)) {
      return res.status(400).json({
        success: false,
        message: "Unsupported report mode. Use vbt, item, or vendor.",
      });
    }

    // 1. Validate that 'wise' is explicitly provided as 'datewise'
    if (!wise || String(wise).toLowerCase() !== "datewise") {
      return res.status(400).json({
        success: false,
        message: "Filter type 'wise=datewise' is required",
      });
    }

    // 2. Validate date fields presence with validatorjs
    const validation = new Validator(
      { data, from, to },
      {
        data: "required_without_all:from,to",
        from: "required_without:data",
        to: "required_without:data",
      },
      {
        "required_without_all.data": "Date range is required (provide 'data' or both 'from' & 'to')",
        "required_without.from": "'from' date is required when 'data' is omitted",
        "required_without.to": "'to' date is required when 'data' is omitted",
      }
    );

    if (validation.fails()) {
      return res.status(422).json({
        success: false,
        errors: validation.errors.all(),
      });
    }

    // 3. Extract and parse DD-MM-YYYY dates
    const dateRange = data || [from, to].filter(Boolean).join(" to ");
    const dates = String(dateRange).match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);

    if (!dates || dates.length < 2) {
      return res.status(400).json({
        success: false,
        message: "Provide two valid dates in DD-MM-YYYY format using 'data' (e.g. 01-08-2026 to 31-08-2026) or 'from' & 'to'",
      });
    }

    const replacements = {
      date1: moment(dates[0], "DD-MM-YYYY").format("YYYY-MM-DD"),
      date2: moment(dates[1], "DD-MM-YYYY").format("YYYY-MM-DD"),
    };
    // ITEM MODE
    if (reportMode == "item") {
      const itemRows = await warehouseContext.tallyDb.query(
        buildItemQueryByVBT(warehouseContext.inventoryDbName),
        {
          replacements,
          type: warehouseContext.tallyDb.QueryTypes.SELECT,
        }
      );

      const cleanedItemRows = itemRows.map((row) => ({
        partname: cleanValue(row.partname),
        partno: cleanValue(row.partno),
        groupname: cleanValue(row.subgroupname),
        uom: cleanValue(row.uom),
        hsn: cleanValue(row.hsn),
        gst: cleanValue(row.gst),
        taxtype: cleanValue(row.taxtype),
      }));

      return res.status(200).json({
        success: true,
        data: cleanedItemRows,
      });
    }

    // VENDOR MODE
    if (reportMode == "vendor") {
      const vendorRows = await warehouseContext.tallyDb.query(
        buildVendorQueryByVBT(warehouseContext.inventoryDbName),
        {
          replacements,
          type: warehouseContext.tallyDb.QueryTypes.SELECT,
        }
      );

      const vendorCodes = new Set();
      for (const row of vendorRows) {
        if (row.vendorCode && row.vendorCode !== "--") {
          vendorCodes.add(String(row.vendorCode).trim());
        }
      }

      const subGroupMap = await batchLoadVendorSubGroups(
        vendorCodes,
        warehouseContext.tallyDb
      );

      const formattedVendors = vendorRows.map((row) => {
        const vCode = cleanValue(row.vendorCode);
        const subGroupVal = subGroupMap.get(vCode) || "";

        return {
          vendorName: cleanValue(row.vendorName),
          vendorCode: vCode,
          vendorCountry: cleanValue(row.vendorCountry),
          vendorState: cleanValue(row.vendorState),
          vendorPincode: cleanValue(row.vendorPincode),
          address: formatAddressLines(row.rawAddress, 3),
          vendorBankAc: cleanValue(row.vendorBankAc),
          vendorBankIfsc: cleanValue(row.vendorBankIfsc),
          vendorBankName: cleanValue(row.vendorBankName),
          vendorPan: cleanValue(row.vendorPan),
          vendorGstType: cleanValue(row.vendorGstType),
          vendorGst: cleanValue(row.vendorGst),
          vendorEmail: cleanValue(row.vendorEmail) === "0" ? "" : cleanValue(row.vendorEmail),
          vendorMobile: cleanValue(row.vendorMobile),
          vendorMsmeId: cleanValue(row.vendorMsmeId),
          vendorMsmeType: cleanValue(row.vendorMsmeType),
          vendorMsmeActivity: cleanValue(row.vendorMsmeActivity),
          subGroup: subGroupVal,
        };
      });

      return res.status(200).json({
        success: true,
        data: formattedVendors,
      });
    }

    // VBT MODE
    const sqlQuery = buildMainQuery(warehouseContext.inventoryDbName);
    const main_stmt = await warehouseContext.tallyDb.query(sqlQuery, {
      replacements,
      type: warehouseContext.tallyDb.QueryTypes.SELECT,
    });

    if (!main_stmt.length) {
      return res.status(200).json({
        tallymessage: [],
      });
    }

    const tallymessage = [];
    for (let i = 0; i < main_stmt.length; i += CHUNK_SIZE) {
      const chunk = main_stmt.slice(i, i + CHUNK_SIZE);
      const transformed = await processChunk(
        chunk,
        consigneeConfig,
        warehouseContext.inventoryDb,
        warehouseContext.inventoryDbName,
        warehouseContext.tallyDb
      );
      tallymessage.push(...transformed);
    }

    return res.status(200).json({
      tallymessage,
    });
  } catch (error) {
    console.error(error.stack);
    return res.status(500).json({
      success: false,
      message: "an internal error occurred",
      error: error.message,
    });
  }
});

module.exports = router;