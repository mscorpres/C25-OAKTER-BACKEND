const express = require("express");
const router = express.Router();
const XLSX = require("xlsx");
const { invtDB, tallyDB } = require("../../../config/db/connection");

/**
 * REUSABLE MASTER BLOCKS
 */
const masterBlocks = {
  freightLedger: {
    sheetName: "Freight GL Master",
    columns: [
      { header: "Ledger_Code", key: "code", width: 22 },
      { header: "Ledger_Name", key: "ledger_name", width: 30 },
    ],
    fetch: async () => {
      const rows = await tallyDB.query(
        "SELECT code, ladger_name AS ledger_name FROM tally_ledger",
        { type: tallyDB.QueryTypes.SELECT }
      );
      return rows;
    },
  },

  natureOfTDS: {
    sheetName: "TDS Code",
    columns: [
      { header: "TDS Code", key: "tds_code", width: 16 },
      { header: "TDS Name", key: "tds_name", width: 30 },
    ],
    fetch: async () => {
      const stmt = await tallyDB.query(
        "SELECT `tds_code`, `tds_name` FROM `tally_tds`",
        { type: tallyDB.QueryTypes.SELECT }
      );

      return stmt.map((row) => ({
        tds_code: row.tds_code,
        tds_name: row.tds_name,
      }));
    },
  },
};

/**
 * VBT SAMPLE CONFIGURATION
 */
const vbtConfig = {
  label: "VBT",
  sampleSheetName: "Sheet1",
  sampleColumns: [
    { header: "Date", key: "date", width: 14 },
    { header: "Part Code", key: "part_code", width: 16 },
    { header: "Vendor Code", key: "vendor_code", width: 16 },
    { header: "Voucher No.", key: "voucher_no", width: 18 },
    { header: "Voucher Ref. No.", key: "voucher_ref_no", width: 22 },
    { header: "GSTIN/UIN", key: "gstin", width: 18 },
    { header: "Narration", key: "narration", width: 45 },
    { header: "Quantity", key: "quantity", width: 12 },
    { header: "UOM", key: "uom", width: 10 },
    { header: "Rate", key: "rate", width: 12 },
    { header: "Value", key: "value", width: 14 },
    { header: "GL_Name", key: "gl_name", width: 20 },
    { header: "IGST_Input_Reversal", key: "igst_reversal", width: 20 },
    { header: "SGST_Input_Reversal", key: "sgst_reversal", width: 20 },
    { header: "CGST_Input_Reversal", key: "cgst_reversal", width: 20 },
    { header: "Round_off", key: "Round_off", width: 12 },
    { header: "TDS", key: "tds", width: 12 },
    { header: "DN_Status", key: "dnsStatus", width: 12 },
  ],

  getExampleRows: async (req) => {
    return [
      {
        date: "07-08-2026",
        part_code: "PE211011A",
        vendor_code: "VEN0881",
        voucher_no: "DN/26-27/0232",
        voucher_ref_no: "SMI/26-27/0605, 0615",
        gstin: "07AAJCS1362B2ZN",
        narration: "being material return back to party agst inv no: SMI/26-27/0605, 0615 (0024)",
        quantity: 12,
        uom: "Pcs",
        rate: 0.34,
        value: "5,727.00",
        gl_name: "4020505",
        igst_reversal: 122.76,
        sgst_reversal: "",
        cgst_reversal: "",
        Round_off: 0.24,
        tds: "TDS005",
        dnsStatus:"A"
      },
      {
        date: "07-08-2026",
        part_code: "PE206001A",
        vendor_code: "VEN0881",
        voucher_no: "DN/26-27/0232",
        voucher_ref_no: "SMI/26-27/0605, 0615",
        gstin: "07AAJCS1362B2ZN",
        narration: "being material return back to party agst inv no: SMI/26-27/0605, 0615 (0024)",
        quantity: 12,
        uom: "Pcs",
        rate: 0.34,
        value: "13,797.00",
        gl_name: "4020505",
        igst_reversal: "",
        sgst_reversal: 122.76,
        cgst_reversal: 122.76,
        Round_off: -0.24,
        tds: "TDS002",
        dnsStatus:"C"
      },
    ];
  },
  masters: ["freightLedger", "natureOfTDS"],
};

/**
 * GET /api/downloadSample?vbt_code=VBT01/26-27/4234
 */
router.get("/downloadSample", async (req, res) => {
  try {
    const workbook = XLSX.utils.book_new();

    // ---- SHEET 1: SAMPLE / TEMPLATE ----
    const resolvedExampleRows = await vbtConfig.getExampleRows(req);
    const sampleHeaderRow = vbtConfig.sampleColumns.map((c) => c.header);
    const sampleDataRows = resolvedExampleRows.map((row) =>
      vbtConfig.sampleColumns.map((c) => row[c.key] ?? "")
    );

    const sampleSheet = XLSX.utils.aoa_to_sheet([sampleHeaderRow, ...sampleDataRows]);
    sampleSheet["!cols"] = vbtConfig.sampleColumns.map((c) => ({ wch: c.width }));
    XLSX.utils.book_append_sheet(workbook, sampleSheet, vbtConfig.sampleSheetName);

    // ---- SHEET 2..N: MASTER / REFERENCE SHEETS ----
    for (const masterKey of vbtConfig.masters || []) {
      const master = masterBlocks[masterKey];
      if (!master || !master.fetch) continue;

      const masterRows = await master.fetch();
      const masterHeaderRow = master.columns.map((c) => c.header);
      const masterDataRows = masterRows.map((row) =>
        master.columns.map((c) => row[c.key] ?? "")
      );

      const masterSheet = XLSX.utils.aoa_to_sheet([masterHeaderRow, ...masterDataRows]);
      masterSheet["!cols"] = master.columns.map((c) => ({ wch: c.width }));
      XLSX.utils.book_append_sheet(workbook, masterSheet, master.sheetName);
    }

    // ---- PREPARE BUFFER & RETURN JSON AS PREVIOUSLY CONFIGURED ----
    const fileName = `${vbtConfig.label.replace(/\s+/g, "_")}_Sample.xlsx`;
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    return res.json({
      code: 200,
      status: "success",
      message: "file generated successfully...",
      data: { buffer: buffer, filename: fileName },
    });
  } catch (err) {
    console.log(err);
    console.log(err.stack);
    return res.status(500).json({
      code: 500,
      status: "error",
      message: "Internal Error!!! If this condition persists, contact your system administrator",
      error: err.stack,
    });
  }
});

module.exports = router;