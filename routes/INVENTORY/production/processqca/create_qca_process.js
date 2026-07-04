const express = require("express");
const router = express.Router();

const auth = require("../../../../middleware/auth");
const permission = require("../../../../middleware/permission");
let { invtDB } = require("../../../../config/db/connection");

const Validator = require("validatorjs");

// CREATE BULK QCA PROCESS ENTRY
router.post(
  "/bulk_insert_qca_Process",
  [auth.isAuthorized],
  async (req, res) => {
    const validation = new Validator(req.body, {
      qca_ppr: "required",
      qca_process: "required",
      qca_result: "required",
      numberRows: "required",
    });

    if (validation.fails()) {
      return res.json({
        status: "error", success: false,
        success: false,
        message: helper.firstErrorValidatorjs(validation),
      });
    }

    //Get SKU from PPR No.
    const stmt2 = await invtDB.query(
      "SELECT prod_product_sku FROM mfg_production_1 WHERE prod_transaction = :ppr",
      {
        replacements: { ppr: req.body.qca_ppr },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt2.length === 0) {
      return res.json({
        status: "error", success: false,
        success: false,
        message: "SKU not found",
      });
    }

    let qca_sku = stmt2[0].prod_product_sku;

    // CHECK PROCESS MAPPED WITH SKU
    const stmt1 = await invtDB.query(
      "SELECT * FROM qa_process WHERE qa_sku = :sku AND qa_process = :process",
      {
        replacements: { sku: qca_sku, process: req.body.qca_process },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt1.length === 0) {
      return res.json({
        status: "error", success: false,
        success: false,
        message: "Process not assign to SKU!!!",
      });
    }

    // CHECK LOAD SIZE
    if (Number(req.body.numberRows) > Number(stmt1[0].lot_size)) {
      return res.json({
        status: "error", success: false,
        success: false,
        message: `Generated Qty is exceeded ( lot size ${stmt1[0].lot_size}) !!!`,
      });
    }

    // CHECK PPR EXE QTY
    const checkPpr = await invtDB.query(
      "SELECT * FROM mfg_production_1 WHERE prod_transaction = :ppr",
      {
        replacements: { ppr: req.body.qca_ppr },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (
      Number(checkPpr[0].prod_planned_qty) -
      Number(checkPpr[0].prod_executed_qty) <
      Number(req.body.numberRows)
    ) {
      return res.json({
        status: "error", success: false,
        success: false,
        message: `Generated Qty is exceeded ( PPR qty ${checkPpr[0].prod_planned_qty} - ${checkPpr[0].prod_executed_qty}) !!!`,
      });
    }
    // END CHECK PPR EXE QTY

    let qca_subject = stmt1[0].qa_subject;
    let level = stmt1[0].qa_process_level;
    let from_location = stmt1[0].process_loc;

    if (level > 1) {
      return res
        .status(500)
        .send({ success: false, message: "Level not be grater than one" });
    }

    let to_location;
    if (req.body.qca_result == "PASS") {
      to_location = stmt1[0].process_pass_loc;
    } else {
      to_location = stmt1[0].process_fail_loc;
    }

    const transaction = await invtDB.transaction();
    try {
      let barcode;

      const bulkInsertData = [];
      const allBarcodes = [];

      const prefix = moment().format("YYMMDDHHmmss");
      for (let i = 0; i < req.body.numberRows; i++) {
        barcode = prefix.toString() + Math.floor(Math.random() * 99999 + 10000);

        // if (level > 1) {
        // return res.status(500).send({ success: false, message: "Level not be grater than one" });
        // const prevProcess = level - 1;
        // const prevLeveldata = await invtDB.query("SELECT * FROM qca WHERE qca_barcode = :barcode AND qca_sku = :sku AND qca_process_level = :prevLevel AND qca_result = 'PASS'", {
        //   replacements: { barcode: barcode, sku: qca_sku, prevLevel: prevProcess },
        //   type: invtDB.QueryTypes.SELECT,
        //   transaction: transaction,
        // });

        // if (prevLeveldata.length === 0) {
        //   await transaction.rollback();
        //   return res.json({ status: "error", success: false, message: "This data not be present at Previous level or Fail at previous level." });
        // }
        // }

        allBarcodes.push(barcode);

        // GET LAST PROCESS
        // const checkData = await invtDB.query("SELECT * FROM qca WHERE qca_barcode = :barcode AND qca_process = :process AND qca_result = 'PASS' ORDER BY ID DESC LIMIT 1 ", {
        //   replacements: {
        //     barcode: barcode,
        //     process: req.body.qca_process,
        //   },
        //   type: invtDB.QueryTypes.SELECT,
        //   transaction: transaction,
        // });

        // if (checkData.length > 0) {
        //   if (checkData[0].qca_result === "PASS") {
        //     await transaction.rollback();
        //     return res.json({ status: "error", success: false, message: "This QCA is already Pass" });
        //   }
        // }

        bulkInsertData.push({
          qca_barcode: barcode,
          qca_ppr: req.body.qca_ppr,
          qca_sku: qca_sku,
          qca_process: req.body.qca_process,
          qca_process_level: level,
          qca_bom_id: qca_subject,
          qca_result: req.body.qca_result,
          qca_fail_reason: req.body.failReason ?? "--",
          qca_correction: req.body.correction ?? "--",
          qca_from_loc: from_location,
          qca_to_loc: to_location,
          qca_insert_by: req.logedINUser,
          qca_insertdt: moment().format("YYYY-MM-DD HH:mm:ss"),
        });

        // const result = await invtDB.query(
        //   "INSERT INTO qca (qca_barcode, qca_ppr, qca_sku, qca_process, qca_process_level, qca_bom_id, qca_result, qca_fail_reason, qca_correction, qca_from_loc, qca_to_loc, qca_insert_by, qca_insertdt) VALUES (:qca_barcode, :qca_ppr, :qca_sku, :qca_process, :qca_process_level, :qca_bom_id, :qca_result, :qca_fail_reason, :correction, :from_loc, :to_loc, :insert_by, :insert_dt )",
        //   {
        //     replacements: {
        //       qca_barcode: barcode,
        //       qca_ppr: req.body.qca_ppr,
        //       qca_sku: qca_sku,
        //       qca_process: req.body.qca_process,
        //       qca_process_level: level,
        //       qca_bom_id: qca_subject,
        //       qca_result: req.body.qca_result,
        //       qca_fail_reason: req.body.failReason ?? "--",
        //       qca_correction: req.body.correction ?? "--",
        //       qca_from_loc: from_location,
        //       qca_to_loc: to_location,
        //       qca_insert_by: req.logedINUser,
        //       qca_insertdt: moment().format("YYYY-MM-DD HH:mm:ss"),
        //     },
        //     type: invtDB.QueryTypes.INSERT,
        //     transaction: transaction,
        //   }
        // );

        // if (result.length === 0) {
        //   await transaction.rollback();
        //   return res.json({ status: "error", success: false, message: "Failed to added data" });
        // }
        //
      }

      const checkData = await invtDB.query(
        "SELECT * FROM qca WHERE qca_barcode IN (:barcode) AND qca_process = :process AND qca_result = 'PASS' ORDER BY ID DESC LIMIT 1 ",
        {
          replacements: {
            barcode: allBarcodes,
            process: req.body.qca_process,
          },
          type: invtDB.QueryTypes.SELECT,
          transaction: transaction,
        }
      );

      if (checkData.length > 0) {
        await transaction.rollback();
        return res.json({
          status: "error", success: false,
          success: false,
          message: "This QCA is already Pass",
        });
      }

      await invtDB
        .getQueryInterface()
        .bulkInsert("qca", bulkInsertData, { transaction: transaction });

      await transaction.commit();
      return res.json({ success: true, message: "QCA CREATED successfully" });
    } catch (e) {
      return helper.errorResponse(res, e);
    }
  }
);

// CREATE QCA PROCESS
router.post("/insert_qca_Process", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    qca_ppr: "required",
    qca_process: "required",
    bar_code: "required",
    qca_result: "required",
  });

  if (validation.fails()) {
    return res.json({
      status: "error", success: false,
      success: false,
      message: helper.firstErrorValidatorjs(validation),
    });
  }

  //Get SKU from PPR No.
  const stmt2 = await invtDB.query(
    "SELECT prod_product_sku FROM mfg_production_1 WHERE prod_transaction = :ppr",
    {
      replacements: { ppr: req.body.qca_ppr },
      type: invtDB.QueryTypes.SELECT,
    }
  );

  if (stmt2.length === 0) {
    return res.json({
      status: "error", success: false,
      success: false,
      message: "SKU not found",
    });
  }

  let qca_sku = stmt2[0].prod_product_sku;

  // CHECK PROCESS MAPPED WITH SKU
  const stmt1 = await invtDB.query(
    "SELECT qa_subject, qa_process_level, process_loc, process_pass_loc, process_fail_loc FROM qa_process WHERE qa_sku = :sku AND qa_process = :process",
    {
      replacements: { sku: qca_sku, process: req.body.qca_process },
      type: invtDB.QueryTypes.SELECT,
    }
  );

  if (stmt1.length === 0) {
    return res.json({
      status: "error", success: false,
      success: false,
      message: "Process not assign to SKU!!!",
    });
  }

  let qca_subject = stmt1[0].qa_subject;
  let level = stmt1[0].qa_process_level;
  let from_location = stmt1[0].process_loc;

  let to_location;
  if (req.body.qca_result == "PASS") {
    to_location = stmt1[0].process_pass_loc;
  } else {
    to_location = stmt1[0].process_fail_loc;
  }

  const transaction = await invtDB.transaction();

  try {
    if (level > 1) {
      const prevProcess = level - 1;
      const prevLeveldata = await invtDB.query(
        "SELECT * FROM qca WHERE qca_barcode = :barcode AND qca_sku = :sku AND qca_process_level = :prevLevel AND qca_result = 'PASS'",
        {
          replacements: {
            barcode: req.body.bar_code,
            sku: qca_sku,
            prevLevel: prevProcess,
          },
          type: invtDB.QueryTypes.SELECT,
          transaction: transaction,
        }
      );

      if (prevLeveldata.length === 0) {
        await transaction.rollback();
        return res.json({
          status: "error", success: false,
          success: false,
          message:
            "This data not be present at Previous level or Fail at previous level.",
        });
      }
    }

    // GET LAST PROCESS
    const checkData = await invtDB.query(
      "SELECT * FROM qca WHERE qca_barcode = :barcode AND qca_process = :process ORDER BY ID DESC LIMIT 1 ",
      {
        replacements: {
          barcode: req.body.bar_code,
          process: req.body.qca_process,
        },
        type: invtDB.QueryTypes.SELECT,
        transaction: transaction,
      }
    );

    if (checkData.length > 0) {
      if (checkData[0].qca_result === "PASS") {
        await transaction.rollback();
        return res.json({
          status: "error", success: false,
          success: false,
          message: "This QCA is already Pass",
        });
      }
    }
    const result = await invtDB.query(
      "INSERT INTO qca (qca_barcode, qca_ppr, qca_sku, qca_process, qca_process_level, qca_bom_id, qca_result, qca_fail_reason, qca_correction, qca_from_loc, qca_to_loc, qca_insert_by, qca_insertdt) VALUES (:barcode, :ppr, :sku, :process, :process_level, :bom_id, :result, :fail_reason, :correction, :from_loc, :to_loc, :insert_by, :insert_dt )",
      {
        replacements: {
          barcode: req.body.bar_code,
          ppr: req.body.qca_ppr,
          sku: qca_sku,
          process: req.body.qca_process,
          process_level: level,
          bom_id: qca_subject,
          result: req.body.qca_result,
          fail_reason: req.body.failReason,
          correction: req.body.correction,
          from_loc: from_location,
          to_loc: to_location,
          insert_by: req.logedINUser,
          insert_dt: moment().format("YYYY-MM-DD HH:mm:ss"),
        },
        type: invtDB.QueryTypes.INSERT,
        transaction: transaction,
      }
    );

    if (result.length === 0) {
      await transaction.rollback();
      return res.json({
        status: "error", success: false,
        success: false,
        message: "Failed to added data",
      });
    }

    await transaction.commit();
    return res.json({
      status: "success", success: true,
      success: true,
      message: "Data has been successfully added",
    });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// Fetch QCA Testing data
router.post("/fetch_testing_data", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    qca_ppr: "required",
    qca_process: "required",
  });

  if (validation.fails()) {
    return res.json({
      status: "error", success: false,
      success: false,
      message: helper.firstErrorValidatorjs(validation),
    });
  }

  try {
    const stmt = await invtDB.query(
      "SELECT * FROM qca WHERE qca_ppr = :ppr AND qca_process = :process AND lot_no = '' ",
      {
        replacements: { ppr: req.body.qca_ppr, process: req.body.qca_process },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    let result = [];
    for (let i = 0; i < stmt.length; i++) {
      result.push({
        barcode: stmt[i].qca_barcode,
        insertdt: stmt[i].qca_insertdt,
        result: stmt[i].qca_result,
      });
    }

    return res.json({ status: "success", success: true, data: result });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

//Delete QCA Testing data
router.post("/delete_testing_data", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    sku: "required",
    bar_code: "required|array",
    qca_process: "required",
  });

  if (validation.fails()) {
    return res.json({
      status: "error", success: false,
      success: false,
      message: helper.firstErrorValidatorjs(validation),
    });
  }

  const transaction = await invtDB.transaction();

  try {
    // for (let i = 0; i < req.body.bar_code.length; i++) {
    //   let stmt1 = await invtDB.query("SELECT * FROM qca WHERE qca_sku = :sku AND qca_barcode = :bar_code AND qca_process = :process AND qca_result = :result AND lot_no = '' ", {
    //     replacements: { sku: req.body.sku, bar_code: req.body.bar_code[i], process: req.body.qca_process, result: req.body.result[i] },
    //     type: invtDB.QueryTypes.SELECT,
    //   });

    //   if (stmt1.length > 0) {
    //     let stmt2 = await invtDB.query("DELETE FROM qca WHERE qca_sku = :sku AND qca_barcode = :bar_code AND qca_process = :process AND qca_result = :result", {
    //       replacements: { sku: req.body.sku, bar_code: req.body.bar_code[i], process: req.body.qca_process, result: req.body.result[i] },
    //       type: invtDB.QueryTypes.DELETE,
    //       transaction: transaction,
    //     });
    //   } else {
    //     await transaction.rollback();
    //     return res.json({ status: "error", success: false, message: "Failed to delete data" });
    //   }
    // }

    const { sku, bar_code, qca_process, result } = req.body;

    // Build replacements for the IN clause
    const barcodes = bar_code.map((code, i) => ({
      sku: sku,
      bar_code: code,
      process: qca_process,
      result: result[i],
    }));

    // Flatten barcode replacements for query binding
    const flattenedReplacements = barcodes.reduce((acc, val, index) => {
      acc[`sku${index}`] = val.sku;
      acc[`bar_code${index}`] = val.bar_code;
      acc[`process${index}`] = val.process;
      acc[`result${index}`] = val.result;
      return acc;
    }, {});

    // Construct IN clause with indexed placeholders
    const inClause = barcodes
      .map(
        (_, index) =>
          `(:sku${index}, :bar_code${index}, :process${index}, :result${index})`
      )
      .join(", ");

    // Query to check the existence of records
    const selectQuery = `
      SELECT * 
      FROM qca 
      WHERE (qca_sku, qca_barcode, qca_process, qca_result) 
      IN (${inClause}) 
      AND lot_no = ''
    `;

    const stmt1 = await invtDB.query(selectQuery, {
      replacements: flattenedReplacements,
      type: invtDB.QueryTypes.SELECT,
    });

    if (stmt1.length === barcodes.length) {
      // All records exist, proceed with delete
      const deleteQuery = `
        DELETE FROM qca 
        WHERE (qca_sku, qca_barcode, qca_process, qca_result) 
        IN (${inClause})
      `;

      await invtDB.query(deleteQuery, {
        replacements: flattenedReplacements,
        type: invtDB.QueryTypes.DELETE,
        transaction: transaction,
      });

      await transaction.commit();
      return res.json({
        status: "success", success: true,
        success: true,
        message: "Data deleted successfully",
      });
    } else {
      await transaction.rollback();
      return res.json({
        status: "error", success: false,
        success: false,
        message: "Failed to delete data",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

//Get PPR NO.
router.post("/getPprNo", [auth.isAuthorized], async (req, res) => {
  try {
    const limit = 10;
    let stmt;
    if (req.body.searchTerm) {
      stmt = await invtDB.query(
        "SELECT prod_transaction FROM mfg_production_1 WHERE mfg_production_1.phase1_status = 'A' AND prod_transaction LIKE :search ORDER BY ID ASC LIMIT :limit",
        {
          replacements: { search: `%${req.body.searchTerm}%`, limit: limit },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else {
      stmt = await invtDB.query(
        "SELECT prod_transaction FROM mfg_production_1 WHERE mfg_production_1.phase1_status = 'A' ORDER BY ID ASC LIMIT :limit",
        {
          replacements: { limit: limit },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    }

    if (stmt.length > 0) {
      let final = [];

      for (let i = 0; i < stmt.length; i++) {
        final.push({
          id: stmt[i].prod_transaction,
          text: stmt[i].prod_transaction,
        });
      }

      return res.json({
        status: "success", success: true,
        success: true,
        message: "Data fetched successfully",
        data: final,
      });
    } else {
      return res.json({
        status: "error", success: false,
        success: false,
        message: "No Data Found",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

//Get number of total scans, passed and failed
router.post("/qca_scan_counts", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    qca_ppr: "required",
    qca_process: "required",
  });

  if (validation.fails()) {
    return res.json({
      status: "error", success: false,
      success: false,
      message: helper.firstErrorValidatorjs(validation),
    });
  }

  try {
    // Get total scan count for the provided PPR
    const totalScanCount = await invtDB.query(
      "SELECT COUNT(*) as total FROM qca WHERE qca_ppr = :ppr AND qca_process = :process",
      {
        replacements: { ppr: req.body.qca_ppr, process: req.body.qca_process },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    // Get passed list for the provided PPR
    const passedCount = await invtDB.query(
      "SELECT COUNT(*) as passed FROM qca WHERE qca_ppr = :ppr AND qca_process = :process AND qca_result = 'PASS'",
      {
        replacements: { ppr: req.body.qca_ppr, process: req.body.qca_process },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    // Get failed list for the provided PPR
    const failedCount = await invtDB.query(
      "SELECT COUNT(*) as failed FROM qca WHERE qca_ppr = :ppr AND qca_process = :process AND qca_result = 'FAIL'",
      {
        replacements: { ppr: req.body.qca_ppr, process: req.body.qca_process },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    return res.json({
      totalScans: totalScanCount[0].total,
      passedPCBs: passedCount[0].passed,
      failedPCBs: failedCount[0].failed,
    });
  } catch {
    return res.json({
      status: "error", success: false,
      success: false,
      message:
        "Internal Error<br/>If this condition persists, contact your system administrator",
      ...(process.env.NODE_ENV === "development" && { debug: err.stack }),
    });
  }
});

//Get passed PCB list
router.post("/fetchPassedPCB", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    qca_ppr: "required",
    qca_process: "required",
    data: "required",
  });

  if (validation.fails()) {
    return res.json({
      status: "error", success: false,
      success: false,
      message: helper.firstErrorValidatorjs(validation),
    });
  }

  const date = req.body.data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
  const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
  const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

  try {
    const stmtPass = await invtDB.query(
      "SELECT qca.*, p_name, subject_name, bom_product_sku, process_location.loc_name AS process_loc, to_location.loc_name AS to_loc FROM qca LEFT JOIN bom_recipe ON qca.qca_bom_id = bom_recipe.subject_id LEFT JOIN products ON qca.qca_sku = products.p_sku LEFT JOIN location_main AS process_location ON qca.qca_from_loc = process_location.location_key LEFT JOIN location_main AS to_location ON qca.qca_to_loc = to_location.location_key WHERE qca_ppr = :ppr AND qca_process = :process AND qca_result = 'PASS' AND DATE_FORMAT(qca_insertdt,'%Y-%m-%d') BETWEEN :date1 AND :date2 AND lot_no != '' GROUP BY lot_no ORDER BY ID ASC",
      {
        replacements: {
          ppr: req.body.qca_ppr,
          process: req.body.qca_process,
          date1: date1,
          date2: date2,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmtPass.length === 0) {
      return res.json({
        status: "error", success: false,
        success: false,
        message: "No Data Found",
      });
    }

    let result = [];
    for (let i = 0; i < stmtPass.length; i++) {
      let barcodedata = [];

      const barcodesForLot = await invtDB.query(
        "SELECT qca_barcode, qca_insertdt FROM qca WHERE lot_no = :lotNo",
        {
          replacements: { lotNo: stmtPass[i].lot_no },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      for (const barcode of barcodesForLot) {
        barcodedata.push({
          barcode: barcode.qca_barcode,
          insert_dt: barcode.qca_insertdt,
        });
      }

      result.push({
        barcode: barcodedata,
        sku: stmtPass[i].qca_sku,
        product_name: stmtPass[i].p_name,
        process_level: stmtPass[i].qca_process_level,
        lot_no: stmtPass[i].lot_no,
        process_loc: stmtPass[i].process_loc,
        to_loc: stmtPass[i].to_loc,
        bom_name: stmtPass[i].subject_name,
        sfg: stmtPass[i].bom_product_sku,
      });
    }

    return res.json({
      status: "success", success: true,
      success: true,
      message: "Data fetched successfully",
      data: result,
    });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

//Get failed PCB list
router.post("/fetchFailedPCB", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    qca_ppr: "required",
    qca_process: "required",
    data: "required",
  });

  if (validation.fails()) {
    return res.json({
      status: "error", success: false,
      success: false,
      message: helper.firstErrorValidatorjs(validation),
    });
  }

  const date = req.body.data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
  const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
  const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

  try {
    const stmtFail = await invtDB.query(
      "SELECT qca.*, p_name, subject_name, bom_product_sku, process_location.loc_name AS process_loc, to_location.loc_name AS to_loc, defect_name FROM qca LEFT JOIN bom_recipe ON qca.qca_bom_id = bom_recipe.subject_id LEFT JOIN products ON qca.qca_sku = products.p_sku LEFT JOIN location_main AS process_location ON qca.qca_from_loc = process_location.location_key LEFT JOIN location_main AS to_location ON qca.qca_to_loc = to_location.location_key LEFT JOIN defect_type ON qca.qca_fail_reason = defect_type.problem_key WHERE qca_ppr = :ppr AND qca_process = :process AND qca_result = 'FAIL' AND DATE_FORMAT(qca_insertdt,'%Y-%m-%d') BETWEEN :date1 AND :date2 AND lot_no != '' GROUP BY lot_no ORDER BY ID ASC",
      {
        replacements: {
          ppr: req.body.qca_ppr,
          process: req.body.qca_process,
          date1: date1,
          date2: date2,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmtFail.length === 0) {
      return res.json({
        status: "error", success: false,
        success: false,
        message: "No Data Found",
      });
    }

    let result = [];
    for (let i = 0; i < stmtFail.length; i++) {
      let barcodedata = [];

      const barcodesForLot = await invtDB.query(
        "SELECT qca_barcode, qca_insertdt, defect_name FROM qca LEFT JOIN defect_type ON qca.qca_fail_reason = defect_type.problem_key WHERE lot_no = :lotNo",
        {
          replacements: { lotNo: stmtFail[i].lot_no },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      for (const barcode of barcodesForLot) {
        barcodedata.push({
          barcode: barcode.qca_barcode,
          insert_dt: barcode.qca_insertdt,
          fail_reason: barcode.defect_name,
        });
      }

      result.push({
        barcode: barcodedata,
        sku: stmtFail[i].qca_sku,
        product_name: stmtFail[i].p_name,
        process_level: stmtFail[i].qca_process_level,
        lot_no: stmtFail[i].lot_no,
        process_loc: stmtFail[i].process_loc,
        to_loc: stmtFail[i].to_loc,
        bom_name: stmtFail[i].subject_name,
        sfg: stmtFail[i].bom_product_sku,
      });
    }

    return res.json({
      status: "success", success: true,
      success: true,
      message: "Data fetched successfully",
      data: result,
    });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

//Insert Defect Type
router.post("/insertDefectType", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    defect_name: "required",
  });

  if (validation.fails()) {
    return res.json({
      status: "error", success: false,
      success: false,
      message: helper.firstErrorValidatorjs(validation),
    });
  } else {
    const check = await invtDB.query(
      "SELECT * FROM defect_type WHERE defect_name = ? ",
      {
        replacements: [req.body.defect_name],
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (check.length > 0) {
      return res.json({
        status: "error", success: false,
        success: false,
        message: "Defect type already exists",
      });
    }
  }

  try {
    const result = await invtDB.query(
      "INSERT INTO defect_type (problem_key, defect_name, insert_by, insert_dt) VALUES (:key, :defect_name , :insert_by , :insert_dt)",
      {
        replacements: {
          key: helper.getUniqueNumber(),
          defect_name: req.body.defect_name,
          insert_by: req.logedINUser,
          insert_dt: moment().format("YYYY-MM-DD HH:mm:ss"),
        },
        type: invtDB.QueryTypes.INSERT,
      }
    );

    return res.json({
      status: "success", success: true,
      success: true,
      message: "Defect type added",
    });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

//fetch defect_name
router.get("/getDefectNames", [auth.isAuthorized], async (req, res) => {
  try {
    const defectNames = await invtDB.query(
      "SELECT problem_key,defect_name FROM defect_type",
      {
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (defectNames.length === 0) {
      return res.json({
        status: "error", success: false,
        success: false,
        message: "No defect names found",
      });
    }

    return res.json({ status: "success", success: true, data: defectNames });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

//fetch ppr Details
router.post("/fetchPprDetails", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    ppr_no: "required",
  });

  if (validation.fails()) {
    return res.json({
      status: "error", success: false,
      success: false,
      message: helper.firstErrorValidatorjs(validation),
    });
  }

  try {
    let main_stmt = await invtDB.query(
      "SELECT * FROM mfg_production_1 LEFT JOIN products ON mfg_production_1.prod_product_sku = products.p_sku WHERE mfg_production_1.phase1_status = 'A' AND mfg_production_1.prod_transaction = :ppr_no ORDER BY mfg_production_1.ID DESC",
      {
        replacements: { ppr_no: req.body.ppr_no },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (main_stmt.length > 0) {
      let count = 0;
      let result;

      // TOTAL REQUIRED and executed QUANTITY
      let totalReqQTY;
      let totalExeQTY;

      let stmt0 = await invtDB.query(
        "SELECT admin_login.user_name, COALESCE(SUM(prod_planned_qty), 0) AS totalReqQTY, COALESCE(SUM(prod_executed_qty), 0) AS totalExeQTY, prod_transaction,prod_product_sku,ppr_randomcode FROM mfg_production_1 LEFT JOIN admin_login ON admin_login.CustID = mfg_production_1.prod_inserted_by WHERE prod_transaction = :ppr AND prod_product_sku = :sku AND ppr_randomcode = :random AND mfg_production_1.prod_branch = :branch",
        {
          replacements: {
            ppr: main_stmt[0].prod_transaction,
            sku: main_stmt[0].prod_product_sku,
            random: main_stmt[0].ppr_randomcode,
            branch: req.branch,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      let username;
      if (stmt0.length > 0) {
        totalReqQTY = stmt0[0].totalReqQTY;
        totalExeQTY = stmt0[0].totalExeQTY;
        username = stmt0[0].user_name;
      } else {
        return res.json({
          status: "error", success: false,
          success: false,
          message: "unable to fetch total req qty",
        });
      }

      let remaining_qty =
        helper.number(totalReqQTY) - helper.number(totalExeQTY);

      // SCANNED QTY
      const scanStmt = await invtDB.query(
        "SELECT COALESCE(count(ID), 0) AS scanned_qty FROM qca WHERE qca_ppr = :ppr",
        {
          replacements: { ppr: req.body.ppr_no },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      let scanned_qty = 0;
      if (scanStmt.length > 0) {
        scanned_qty = scanStmt[0].scanned_qty;
      }

      // PASSED QTY
      const passStmt = await invtDB.query(
        "SELECT COALESCE(count(ID), 0) AS scanned_qty FROM qca WHERE qca_ppr = :ppr AND qca_result = 'PASS'",
        {
          replacements: { ppr: req.body.ppr_no },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      let passed_qty = 0;
      if (passStmt.length > 0) {
        passed_qty = passStmt[0].scanned_qty;
      }

      // FAILED QTY
      const failStmt = await invtDB.query(
        "SELECT COALESCE(count(ID), 0) AS scanned_qty FROM qca WHERE qca_ppr = :ppr AND qca_result = 'FAIL'",
        {
          replacements: { ppr: req.body.ppr_no },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      let failed_qty = 0;
      if (failStmt.length > 0) {
        failed_qty = failStmt[0].scanned_qty;
      }

      result = {
        customer_name: main_stmt[0].prod_customer_name,
        total_qty: main_stmt[0].prod_planned_qty,
        remaining_qty: remaining_qty,
        scanned_qty: scanned_qty,
        passed_qty: passed_qty,
        failed_qty: failed_qty,
        product_name: main_stmt[0].p_name,
        product_sku: main_stmt[0].prod_product_sku,
        access_token: main_stmt[0].ppr_randomcode,
        status:
          helper.number(totalExeQTY) < helper.number(totalReqQTY)
            ? "pending"
            : "completed",
      };

      return res.json({ status: "success", success: true, data: result });
    } else {
      return res.json({
        status: "error", success: false,
        success: false,
        message: "no any records found",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

//Fetch the list of process based on SKU
router.post("/getQAProcesses", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    sku: "required",
  });

  if (validation.fails()) {
    return res.json({
      status: "error", success: false,
      success: false,
      message: "Please provide sku",
    });
  }

  try {
    const processes = await invtDB.query(
      "SELECT process_name, qa_process_level FROM qa_process LEFT JOIN qa_process_master ON qa_process.qa_process = qa_process_master.process_key WHERE qa_sku = :sku",
      {
        replacements: { sku: req.body.sku },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (processes.length === 0) {
      return res.json({
        status: "error", success: false,
        success: false,
        message: "No processes found for the provided SKU",
      });
    }

    return res.json({
      status: "success", success: true,
      success: true,
      message: "Data fetched successfully",
      data: processes,
    });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

//Lot transfer and update lot no
// router.post("/lot_transfer", [auth.isAuthorized], async (req, res) => {
//   const validation = new Validator(req.body, {
//     qca_barcode: "required",
//     skucode: "required",
//     ppr_transaction: "required",
//     process: "required",
//   });

//   if (validation.fails()) {
//     return res.status(500).send({ success: false, message: helper.firstErrorValidatorjs(validation) });
//   }

//   let lot_no = helper.getUniqueNumber();

//   const transaction = await invtDB.transaction();
//   try {
//     //Get Locations, Lot size
//     const stmt2 = await invtDB.query(
//       "SELECT process_name,  qa_sfg_sku, qa_subject, bom_required, lot_size, process_loc, process_pass_loc, process_fail_loc FROM qa_process LEFT JOIN qa_process_master ON qa_process.qa_process = qa_process_master.process_key WHERE qa_process = :process AND qa_sku = :sku ",
//       {
//         replacements: { process: req.body.process, sku: req.body.skucode },
//         type: invtDB.QueryTypes.SELECT,
//       }
//     );

//     let bom_required = stmt2[0].bom_required;
//     let process_name = stmt2[0].process_name;
//     let sku_sfg = stmt2[0].qa_sfg_sku;
//     // If qa_sfg_sku is empty/null, use the actual skucode from request
//     if (!sku_sfg || sku_sfg.trim() === '') {
//       sku_sfg = req.body.skucode;
//     }
//     let bom_id = stmt2[0].qa_subject;
//     let Lot_size = stmt2[0].lot_size;

//     //Update Lot NO.
//     const updateResult = await invtDB.query("UPDATE qca SET lot_no = :lotNo WHERE qca_barcode IN (:qca_barcode) AND qca_result = :result AND qca_process = :process", {
//       replacements: { lotNo: lot_no, qca_barcode: req.body.qca_barcode, result: req.body.result, process: req.body.process },
//       type: invtDB.QueryTypes.UPDATE,
//       transaction: transaction,
//     });

//     let consump_Loc = stmt2[0].process_loc;

//     let send_Loc;
//     if (req.body.result == "PASS") {
//       send_Loc = stmt2[0].process_pass_loc;
//     } else {
//       send_Loc = stmt2[0].process_fail_loc;
//     }

//     let lot_qty = req.body.qca_barcode.length;

//     if (lot_qty > Lot_size) {
//       await transaction.rollback();
//       return res.status(500).json({ success: false, message: `Lot Quantity will not more than ${Lot_size}` });
//     }

//     //Check Maximum Consumption quantity
//     let stmt = await invtDB.query(
//       "SELECT mfg_production_1.ppr_randomcode,mfg_production_1.prod_transaction, mfg_production_1.prod_planned_qty, bom_quantity.product_sku FROM bom_quantity LEFT JOIN bom_recipe ON bom_quantity.subject_under = bom_recipe.subject_id LEFT JOIN mfg_production_1 ON bom_quantity.product_sku = mfg_production_1.prod_product_sku LEFT JOIN location_main ON mfg_production_1.prod_location = location_main.location_key WHERE bom_quantity.product_sku = :sku AND mfg_production_1.prod_transaction = :req AND mfg_production_1.ppr_randomcode = :access AND mfg_production_1.prod_branch = :branch GROUP BY bom_recipe.subject_name ORDER BY bom_recipe.subject_name ASC",
//       {
//         replacements: {
//           sku: req.body.skucode,
//           req: req.body.ppr_transaction,
//           access: req.body.accesstoken,
//           branch: req.branch,
//         },
//         type: invtDB.QueryTypes.SELECT,
//       }
//     );

//     let MaxConsumptQtyis = 0;
//     if (stmt.length > 0) {
//       for (let i = 0; i < stmt.length; i++) {
//         let row = stmt[i];

//         let stmt0 = await invtDB.query(
//           "SELECT COALESCE(SUM(mfg_prod_planing_qty),0) AS totalYetConsupted, mfg_sku,mfg_ref_id FROM mfg_production_2 WHERE mfg_sku = :sku AND mfg_ref_id = :req AND ppr_randomcode = :access AND mfg_production_2.mfg_prod_type = 'C'",
//           {
//             replacements: {
//               sku: sku_sfg,
//               req: req.body.ppr_transaction,
//               access: req.body.accesstoken,
//             },
//             type: invtDB.QueryTypes.SELECT,
//           }
//         );
//         if (stmt0.length > 0) {
//           MaxConsumptQtyis = helper.number(row.prod_planned_qty) - helper.number(stmt0[0].totalYetConsupted);
//           if (helper.number(MaxConsumptQtyis) < helper.number(lot_qty)) {
//             await transaction.rollback();
//             return res.status(500).json({ success: false, message: "executing QTY is can't be accept" });
//           }
//         }
//       }
//     } else {
//       await transaction.rollback();
//       return res.status(500).json({ success: false, message: "something happend wrong" });
//     }

//     let stmt1 = await invtDB.query(
//       "SELECT * FROM mfg_production_1 WHERE ppr_randomcode = :accesstoken AND prod_transaction = :transaction AND prod_product_sku = :sku AND phase1_status = 'A' AND mfg_production_1.prod_branch = :branch",
//       {
//         replacements: {
//           sku: req.body.skucode,
//           transaction: req.body.ppr_transaction,
//           accesstoken: req.body.accesstoken,
//           branch: req.branch,
//         },
//         type: invtDB.QueryTypes.SELECT,
//       }
//     );

//     if (stmt1.length > 0) {
//       let mfg_transaction;
//       let getNumber = await invtDB.query("SELECT * FROM ims_numbering WHERE for_number = 'MFG' FOR UPDATE", {
//         type: invtDB.QueryTypes.SELECT,
//         transaction: transaction,
//       });

//       mfg_transaction = stmt2[0].mfg_transaction;
//       if (getNumber.length > 0) {
//         var suffix = getNumber[0].suffix;
//         suffix = parseInt(suffix) + 1;
//         suffix = suffix.toString();
//         suffix = suffix.padStart(parseInt(getNumber[0].number_length_limit), "0");

//         mfg_transaction = getNumber[0].prefix + "/" + getNumber[0].session + "/" + suffix;
//       } else {
//         let currYear = parseInt(new Date().getFullYear().toString().substr(2, 2));
//         mfg_transaction = "MFG/" + currYear + "-" + (currYear + 1) + "/0001";
//       }

//       await invtDB.query("UPDATE ims_numbering SET suffix = suffix+1 WHERE for_number= 'MFG'", {
//         type: invtDB.QueryTypes.UPDATE,
//         transaction: transaction,
//       });

//       let stmt3 = await invtDB.query("SELECT * FROM mfg_production_2 WHERE mfg_ref_id = :pprid AND mfg_sku = :sku ORDER BY ID DESC LIMIT 1", {
//         replacements: {
//           pprid: req.body.ppr_transaction,
//           sku: sku_sfg,
//         },
//         type: invtDB.QueryTypes.SELECT,
//       });

//       let stepcount;
//       if (stmt3.length > 0) {
//         stepcount = helper.number(stmt3[0].step_count) + 1;
//       } else {
//         stepcount = 1;
//       }

//       let pprcreatedBY;
//       let stmt4 = await invtDB.query("SELECT * FROM mfg_production_1 WHERE prod_product_sku = :sku AND prod_transaction = :pprid ORDER BY ID DESC LIMIT 1", {
//         replacements: {
//           pprid: req.body.ppr_transaction,
//           sku: req.body.skucode,
//         },
//         type: invtDB.QueryTypes.SELECT,
//       });
//       if (stmt4.length > 0) {
//         pprcreatedBY = stmt4[0].prod_inserted_by;
//       } else {
//         pprcreatedBY = "--";
//       }

//       //Get SKU type
//       // If sku_sfg is empty/null, use req.body.skucode instead
//       let sku_to_query = sku_sfg && sku_sfg.trim() !== '' ? sku_sfg : req.body.skucode;
//       let skutype = await invtDB.query("SELECT bom_recipe_type , sfg_mapped_rm FROM bom_recipe WHERE bom_product_sku = :skusfg ", {
//         replacements: { skusfg: sku_to_query },
//         type: invtDB.QueryTypes.SELECT,
//       });

//       let sku_type;

//       if (skutype.length == 0) {
//         sku_type = "SFG";
//       } else {
//         if (skutype[0].bom_recipe_type == "default") {
//           sku_type = "FG";
//         } else {
//           sku_type = "SFG";
//         }
//       }

//       let insertDate = moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");

//       let productAvgRate = 0;

//       if (bom_required == "YES") {
//         let stmt1 = await invtDB.query(
//           "INSERT INTO mfg_production_2 (company_branch,mfg_prod_planing_qty,mfg_sku,mfg_sku_type,mfg_send_location,mfg_con_location,mfg_comment,mfg_insert_date,mfg_full_date,mfg_approved_by,mfg_transaction,mfg_ref_id,step_count,mfg_prod_type,mfg_ppr_created_by,ppr_randomcode,from_module) VALUES (:branch,:lot_qty,:sku,:sku_type,:sendLoc,:conLoc,:comment,:insertdate,:fulldate,:by,:transaction,:ref,:count,:type,:pprinsertedby,:random,'QCA')",
//           {
//             replacements: {
//               branch: req.branch,
//               lot_qty: lot_qty,
//               sku: sku_sfg,
//               sku_type: sku_type,
//               sendLoc: send_Loc,
//               conLoc: consump_Loc,
//               comment: "--",
//               insertdate: moment(new Date()).format("YYYY-MM-DD"),
//               fulldate: insertDate,
//               by: req.logedINUser,
//               transaction: mfg_transaction,
//               ref: req.body.ppr_transaction,
//               count: stepcount,
//               type: "C",
//               pprinsertedby: pprcreatedBY,
//               random: req.body.accesstoken,
//             },
//             type: invtDB.QueryTypes.INSERT,
//             transaction: transaction,
//           }
//         );

//         //INSERT DATA INTO MFG_PRODUCTION_3
//         let stmt_insert = await invtDB.query(
//           "INSERT INTO mfg_production_3 (company_branch, mfg_pro_apr_sku, mfg_approve_in_qty, mfg_pro_location_in, mfg_pro_apr_by, ppr_created_by,  mfg_pro_apr_date, mfgphase2_insert_date, mfg_pro_apr_fulldate, mfg_ref_transid_1, mfg_ref_transid_2, type) VALUES (:branch, :sku, :lot_qty, :location, :approved_by, :created_by, :apr_date, :insert_date, :full_date, :ppr_no, :mfg_id, 'IN')",
//           {
//             replacements: {
//               branch: req.branch,
//               sku: sku_sfg,
//               lot_qty: lot_qty,
//               location: send_Loc,
//               approved_by: req.logedINUser,
//               created_by: pprcreatedBY,
//               apr_date: moment(new Date()).format("YYYY-MM-DD"),
//               full_date: moment(new Date()).format("YYYY-MM-DD HH:mm:ss"),
//               insert_date: insertDate,
//               ppr_no: req.body.ppr_transaction,
//               mfg_id: mfg_transaction,
//             },
//             type: invtDB.QueryTypes.INSERT,
//             transaction: transaction,
//           }
//         );

//         //Insert data into rm_location
//         if (stmt1.length > 0) {
//           let stmt3 = await invtDB.query("SELECT qty,component_id FROM bom_quantity WHERE subject_under = :bomid AND bom_status = 'A' ", {
//             replacements: { bomid: bom_id },
//             type: invtDB.QueryTypes.SELECT,
//           });

//           for (let i = 0; i < stmt3.length; i++) {
//             let consumption_quantity = lot_qty * stmt3[i].qty;
//             let component = stmt3[i].component_id;

//             //

//             const avagRate = await require("../../../../helper/utils/avgRate").getWeightedPurchaseRate(component, moment(new Date()).format("YYYY-MM-DD HH:mm:ss"));

//             productAvgRate += avagRate * stmt3[i].qty;

//             // console.log(avagRate * stmt3[i].qty ,  avagRate ,  stmt3[i].qty , "----------------------------")

//             //

//             if (helper.number(consumption_quantity) > 0) {
//               let comp_stmt = await invtDB.query(
//                 "INSERT INTO rm_location (company_branch,trans_type,components_id,qty,mfg_bom_qty,loc_out,insert_date,insert_by,mfg_ppr_trans_id_1,mfg_ppr_trans_id_2,mfg_step_count,bom_subject_id,any_remark) VALUES(:branch, 'CONSUMPTION', :component, :qty, :bom_qty, :loc_out, :insert_date, :insert_by, :mfg_id_1, :mfg_id_2, :step_count, :subject, :remark)",
//                 {
//                   replacements: {
//                     branch: req.branch,
//                     component: stmt3[i].component_id,
//                     qty: consumption_quantity,
//                     bom_qty: stmt3[i].qty,
//                     loc_out: consump_Loc,
//                     insert_date: insertDate,
//                     insert_by: req.logedINUser,
//                     mfg_id_1: req.body.ppr_transaction,
//                     mfg_id_2: mfg_transaction,
//                     step_count: stepcount,
//                     subject: bom_id,
//                     remark: "--",
//                   },
//                   type: invtDB.QueryTypes.INSERT,
//                   transaction: transaction,
//                 }
//               );

//               // ALL INWARD
//               let component_qty_yet_in_location;
//               let stmt6 = await invtDB.query(
//                 "SELECT COALESCE(SUM(qty+other_qty), 0) AS Inward FROM rm_location WHERE components_id = :component AND loc_in = :location AND trans_type IN ('INWARD' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER')",
//                 {
//                   replacements: {
//                     component: stmt3[i].component_id,
//                     location: consump_Loc,
//                     branch: req.branch,
//                   },
//                   type: invtDB.QueryTypes.SELECT,
//                 }
//               );
//               if (stmt6.length > 0) {
//                 component_qty_yet_in_location = helper.number(stmt6[0].Inward);
//               } else {
//                 component_qty_yet_in_location = 0;
//               }

//               // ALL OUTWARD
//               let component_qty_yet_out_location;
//               let stmt7 = await invtDB.query(
//                 "SELECT COALESCE(SUM(qty+other_qty), 0) AS Outward FROM rm_location WHERE components_id = :component AND loc_out = :location AND trans_type IN ('CONSUMPTION' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER')",
//                 {
//                   replacements: {
//                     component: stmt3[i].component_id,
//                     location: consump_Loc,
//                     branch: req.branch,
//                   },
//                   type: invtDB.QueryTypes.SELECT,
//                 }
//               );

//               if (stmt7.length > 0) {
//                 component_qty_yet_out_location = helper.number(stmt7[0].Outward);
//               } else {
//                 component_qty_yet_out_location = 0;
//               }

//               if (helper.number(component_qty_yet_in_location - component_qty_yet_out_location) >= helper.number(consumption_quantity)) {
//               } else {
//                 const stmt = await invtDB.query("SELECT c_name , c_part_no FROM components WHERE component_key = :component", {
//                   replacements: { component: component },
//                   type: invtDB.QueryTypes.SELECT,
//                 });

//                 let component_name = stmt[0].c_part_no;

//                 await transaction.rollback();
//                 return res.status(500).json({
//                   message: `${component_qty_yet_in_location} / ${component_qty_yet_out_location} Attention: Some of the components ${component_name} are not available at the pick location`,
//                   success: false,
//                 });
//               }
//             }
//           }
//         }
//       }
//       //Update Execution quantity
//       let stmt8 = await invtDB.query("UPDATE mfg_production_1 SET prod_executed_qty= prod_executed_qty + :execute_qty WHERE prod_product_sku = :skucode AND prod_transaction = :ppr", {
//         replacements: { execute_qty: lot_qty, skucode: req.body.skucode, ppr: req.body.ppr_transaction },
//         type: invtDB.QueryTypes.UPDATE,
//         transaction: transaction,
//       });
//       if (stmt8.length > 0) {
//         // Get sku_sfg req.body.skucode
//         // AUTO TRASFER ONLY FOR SFG TO COMPONENT
//         if (sku_type == "SFG") {
//           // If skutype is empty, query bom_recipe using req.body.skucode
//           let sfg_mapped_rm_value;
//           if (skutype.length > 0 && skutype[0].sfg_mapped_rm) {
//             sfg_mapped_rm_value = skutype[0].sfg_mapped_rm;
//           } else {
//             // Query bom_recipe using the actual skucode from request
//             let skutype_fallback = await invtDB.query("SELECT bom_recipe_type , sfg_mapped_rm FROM bom_recipe WHERE bom_product_sku = :skusfg LIMIT 1", {
//               replacements: { skusfg: req.body.skucode },
//               type: invtDB.QueryTypes.SELECT,
//             });
//             if (skutype_fallback.length > 0 && skutype_fallback[0].sfg_mapped_rm) {
//               sfg_mapped_rm_value = skutype_fallback[0].sfg_mapped_rm;
//             } else {
//               await transaction.rollback();
//               return res.status(500).json({ success: false, message: "SFG mapped RM not found in bom_recipe for SKU: " + req.body.skucode });
//             }
//           }
//           // const stmt4 = await invtDB.query("SELECT component_key FROM components WHERE c_part_no = :component", {
//           const stmt4 = await invtDB.query("SELECT component_key FROM components WHERE component_key = :component", {
//             // replacements: { component: sku_sfg },
//             replacements: { component: sfg_mapped_rm_value },
//             type: invtDB.QueryTypes.SELECT,
//           });

//           if (stmt4.length <= 0) {
//             await transaction.rollback();
//             return res.status(500).json({ success: false, message: "This SFG is not present in component data" });
//           }
//           let transactionID;
//           let stmt = await invtDB.query("SELECT * FROM `ims_numbering` WHERE `for_number` = 'GODOWN_TRANSFER' FOR UPDATE", { type: invtDB.QueryTypes.SELECT, transaction: transaction });

//           if (stmt.length > 0) {
//             var suffix = stmt[0].suffix;
//             suffix = helper.number(suffix) + 1;
//             suffix = suffix.toString();
//             suffix = suffix.padStart(helper.number(stmt[0].number_length_limit), "0");
//             transactionID = stmt[0].prefix + "/" + stmt[0].session + "/" + suffix;
//           } else {
//             let currYear = parseInt(new Date().getFullYear().toString().substr(2, 2));
//             transactionID = "IGA/" + currYear + "-" + (currYear + 1) + "/0001";
//           }

//           // CREATE NEW SFG AS COMPONENT
//           let getNumber = await invtDB.query("SELECT * FROM `ims_numbering` WHERE `for_number` = 'QCA' FOR UPDATE", {
//             type: invtDB.QueryTypes.SELECT,
//             transaction: transaction,
//           });
//           var in_txn_no;

//           if (getNumber.length > 0) {
//             var suffix = getNumber[0].suffix;
//             suffix = parseInt(suffix) + 1;
//             suffix = suffix.toString();
//             suffix = suffix.padStart(parseInt(getNumber[0].number_length_limit), "0");

//             in_txn_no = getNumber[0].prefix + "/" + getNumber[0].session + "/" + suffix;
//           } else {
//             let currYear = parseInt(new Date().getFullYear().toString().substr(2, 2));
//             in_txn_no = "QCA/" + currYear + "-" + (currYear + 1) + "/0001";
//           }

//           await invtDB.query("UPDATE `ims_numbering` SET `suffix` = `suffix`+1 WHERE `for_number`= 'QCA'", {
//             type: invtDB.QueryTypes.UPDATE,
//             transaction: transaction,
//           });

//           let stmt_new_comp = await invtDB.query(
//             "INSERT INTO rm_location (in_module,company_branch,components_id,qty,loc_in,any_remark,insert_date,insert_by,in_transaction_id, in_po_rate) VALUES ('IN-QCA',:branch,:component,:qty,:loc_in,:remark,:insert_date,:insert_by,:in_transaction_id, :in_po_rate)",
//             {
//               replacements: {
//                 branch: req.branch,
//                 component: stmt4[0].component_key,
//                 qty: lot_qty,
//                 in_po_rate: productAvgRate,
//                 loc_in: send_Loc,
//                 in_transaction_id: in_txn_no,
//                 remark: "Process MIN",
//                 insert_date: moment(new Date()).format("YYYY-MM-DD HH:mm:ss"),
//                 insert_by: req.logedINUser,
//               },
//               type: invtDB.QueryTypes.INSERT,
//               transaction: transaction,
//             }
//           );
//           // MIN DONE

//           //Auto transfer
//           let stmt1 = await invtDB.query(
//             "INSERT INTO `rm_location` (`in_module`,`company_branch`,`trans_type`,`components_id`,`qty`,`loc_in`,`loc_out`,`any_remark`,`insert_date`,`insert_by`,`transfer_transaction_id`)VALUES ('IN-TRN',:branch,'TRANSFER',:component,:qty,:loc_in,:loc_out,:remark,:insert_date,:insert_by,:transfer_transaction_id)",
//             {
//               replacements: {
//                 branch: req.branch,
//                 component: stmt4[0].component_key,
//                 qty: lot_qty,
//                 loc_in: send_Loc,
//                 loc_out: consump_Loc,
//                 remark: "Auto Transfer",
//                 insert_date: moment(new Date()).format("YYYY-MM-DD HH:mm:ss"),
//                 insert_by: req.logedINUser,
//                 transfer_transaction_id: transactionID,
//               },
//               type: invtDB.QueryTypes.INSERT,
//               transaction: transaction,
//             }
//           );

//           if (stmt1.length <= 0) {
//             await transaction.rollback();
//             return res.status(500).json({ success: false, message: "an error by shifting the SFG to the location" });
//           }
//         }
//         // END AUTO TRANSFER ONLY FOR SFG TO COMPONENT

//         await transaction.commit();
//         return res.status(200).json({
//           success: true,
//           Lot_No: lot_no,
//           Lot_Qty: lot_qty,
//           PPR_No: req.body.ppr_transaction,
//           SKU: req.body.skucode,
//           Lot_type: req.body.result,
//           Process: process_name,
//           message: "Lot Transfer Successfully",
//         });
//       } else {
//         await transaction.rollback();
//         return res.status(500).json({ success: false, message: "an error occured while updating your request" });
//       }
//     }
//   } catch (err) {
//     console.log(err);
//     await transaction.rollback();
//     return res.status(500).json({ message: "Internal Error<br/>If this condition persists, contact your system administrator", success: false, error: err.stack });
//   }
// });
router.post("/lot_transfer", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    qca_barcode: "required",
    skucode: "required",
    ppr_transaction: "required",
    process: "required",
  });

  if (validation.fails()) {
    return res.json({ success: false, status: "error", message: helper.firstErrorValidatorjs(validation) });
  }

  let lot_no = helper.getUniqueNumber();

  const transaction = await invtDB.transaction();
  try {
    const stmt2 = await invtDB.query(
      "SELECT process_name,  qa_sfg_sku, qa_subject, bom_required, lot_size, process_loc, process_pass_loc, process_fail_loc FROM qa_process LEFT JOIN qa_process_master ON qa_process.qa_process = qa_process_master.process_key WHERE qa_process = :process AND qa_sku = :sku ",
      {
        replacements: { process: req.body.process, sku: req.body.skucode },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    let bom_required = stmt2[0].bom_required;
    let process_name = stmt2[0].process_name;
    let sku_sfg = stmt2[0].qa_sfg_sku;
    let bom_id = stmt2[0].qa_subject;
    let Lot_size = stmt2[0].lot_size;

    await invtDB.query(
      "UPDATE qca SET lot_no = :lotNo WHERE qca_barcode IN (:qca_barcode) AND qca_result = :result AND qca_process = :process",
      {
        replacements: {
          lotNo: lot_no,
          qca_barcode: req.body.qca_barcode,
          result: req.body.result,
          process: req.body.process,
        },
        type: invtDB.QueryTypes.UPDATE,
        transaction: transaction,
      },
    );

    let consump_Loc = stmt2[0].process_loc;

    let send_Loc;
    if (req.body.result == "PASS") {
      send_Loc = stmt2[0].process_pass_loc;
    } else {
      send_Loc = stmt2[0].process_fail_loc;
    }

    let lot_qty = req.body.qca_barcode.length;

    if (lot_qty > Lot_size) {
      await transaction.rollback();
      return res.json({ success: false, status: "error", message: `Lot Quantity will not more than ${Lot_size}` });
    }

    let stmt = await invtDB.query(
      "SELECT mfg_production_1.ppr_randomcode,mfg_production_1.prod_transaction, mfg_production_1.prod_planned_qty, bom_quantity.product_sku FROM bom_quantity LEFT JOIN bom_recipe ON bom_quantity.subject_under = bom_recipe.subject_id LEFT JOIN mfg_production_1 ON bom_quantity.product_sku = mfg_production_1.prod_product_sku LEFT JOIN location_main ON mfg_production_1.prod_location = location_main.location_key WHERE bom_quantity.product_sku = :sku AND mfg_production_1.prod_transaction = :req AND mfg_production_1.ppr_randomcode = :access AND mfg_production_1.prod_branch = :branch GROUP BY bom_recipe.subject_name ORDER BY bom_recipe.subject_name ASC",
      {
        replacements: {
          sku: req.body.skucode,
          req: req.body.ppr_transaction,
          access: req.body.accesstoken,
          branch: "BRMSC012",
        },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    let MaxConsumptQtyis = 0;
    if (stmt.length > 0) {
      for (let i = 0; i < stmt.length; i++) {
        let row = stmt[i];

        let stmt0 = await invtDB.query(
          "SELECT COALESCE(SUM(mfg_prod_planing_qty),0) AS totalYetConsupted, mfg_sku,mfg_ref_id FROM mfg_production_2 WHERE mfg_sku = :sku AND mfg_ref_id = :req AND ppr_randomcode = :access AND mfg_production_2.mfg_prod_type = 'C'",
          {
            replacements: {
              sku: sku_sfg,
              req: req.body.ppr_transaction,
              access: req.body.accesstoken,
            },
            type: invtDB.QueryTypes.SELECT,
          },
        );
        if (stmt0.length > 0) {
          MaxConsumptQtyis =
            helper.number(row.prod_planned_qty) -
            helper.number(stmt0[0].totalYetConsupted);
          if (helper.number(MaxConsumptQtyis) < helper.number(lot_qty)) {
            await transaction.rollback();
            return res.json({ success: false, status: "error", message: "executing QTY is can't be accept" });
          }
        }
      }
    } else {
      await transaction.rollback();
      return res.json({ success: false, status: "error", message: "something happend wrong" });
    }

    let stmt1 = await invtDB.query(
      "SELECT * FROM mfg_production_1 WHERE ppr_randomcode = :accesstoken AND prod_transaction = :transaction AND prod_product_sku = :sku AND phase1_status = 'A' AND mfg_production_1.prod_branch = :branch",
      {
        replacements: {
          sku: req.body.skucode,
          transaction: req.body.ppr_transaction,
          accesstoken: req.body.accesstoken,
          branch: "BRMSC012",
        },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    if (stmt1.length > 0) {
      let mfg_transaction;
      let getNumber = await invtDB.query(
        "SELECT * FROM ims_numbering WHERE for_number = 'MFG' FOR UPDATE",
        {
          type: invtDB.QueryTypes.SELECT,
          transaction: transaction,
        },
      );

      mfg_transaction = stmt2[0].mfg_transaction;
      if (getNumber.length > 0) {
        var suffix = getNumber[0].suffix;
        suffix = parseInt(suffix) + 1;
        suffix = suffix.toString();
        suffix = suffix.padStart(
          parseInt(getNumber[0].number_length_limit),
          "0",
        );

        mfg_transaction =
          getNumber[0].prefix + "/" + getNumber[0].session + "/" + suffix;
      } else {
        let currYear = parseInt(
          new Date().getFullYear().toString().substr(2, 2),
        );
        mfg_transaction = "MFG/" + currYear + "-" + (currYear + 1) + "/0001";
      }

      await invtDB.query(
        "UPDATE ims_numbering SET suffix = suffix+1 WHERE for_number= 'MFG'",
        {
          type: invtDB.QueryTypes.UPDATE,
          transaction: transaction,
        },
      );

      let stmt3 = await invtDB.query(
        "SELECT * FROM mfg_production_2 WHERE mfg_ref_id = :pprid AND mfg_sku = :sku ORDER BY ID DESC LIMIT 1",
        {
          replacements: {
            pprid: req.body.ppr_transaction,
            sku: sku_sfg,
          },
          type: invtDB.QueryTypes.SELECT,
        },
      );

      let stepcount;
      if (stmt3.length > 0) {
        stepcount = helper.number(stmt3[0].step_count) + 1;
      } else {
        stepcount = 1;
      }

      let pprcreatedBY;
      let stmt4 = await invtDB.query(
        "SELECT * FROM mfg_production_1 WHERE prod_product_sku = :sku AND prod_transaction = :pprid ORDER BY ID DESC LIMIT 1",
        {
          replacements: {
            pprid: req.body.ppr_transaction,
            sku: req.body.skucode,
          },
          type: invtDB.QueryTypes.SELECT,
        },
      );
      if (stmt4.length > 0) {
        pprcreatedBY = stmt4[0].prod_inserted_by;
      } else {
        pprcreatedBY = "--";
      }

      let skutype = await invtDB.query(
        "SELECT bom_recipe_type , sfg_mapped_rm FROM bom_recipe WHERE bom_product_sku = :skusfg ",
        {
          replacements: { skusfg: sku_sfg },
          type: invtDB.QueryTypes.SELECT,
        },
      );

      let sku_type;

      if (skutype.length == 0) {
        sku_type = "SFG";
      } else {
        if (skutype[0].bom_recipe_type == "default") {
          sku_type = "FG";
        } else {
          sku_type = "SFG";
        }
      }

      let insertDate = moment(new Date())
        .tz("Asia/Kolkata")
        .format("YYYY-MM-DD HH:mm:ss");

      let productAvgRate = 0;

      if (bom_required == "YES") {
        let stmt1 = await invtDB.query(
          "INSERT INTO mfg_production_2 (txn_session,company_branch,mfg_prod_planing_qty,mfg_sku,mfg_sku_type,mfg_send_location,mfg_con_location,mfg_comment,mfg_insert_date,mfg_full_date,mfg_approved_by,mfg_transaction,mfg_ref_id,step_count,mfg_prod_type,mfg_ppr_created_by,ppr_randomcode,from_module) VALUES (:txn_session,:branch,:lot_qty,:sku,:sku_type,:sendLoc,:conLoc,:comment,:insertdate,:fulldate,:by,:transaction,:ref,:count,:type,:pprinsertedby,:random,'QCA')",
          {
            replacements: {
              txn_session: helper.generateTxnSession(),
              branch: "BRMSC012",
              lot_qty: lot_qty,
              sku: sku_sfg,
              sku_type: sku_type,
              sendLoc: send_Loc,
              conLoc: consump_Loc,
              comment: "--",
              insertdate: moment(new Date()).format("YYYY-MM-DD"),
              fulldate: insertDate,
              by: req.logedINUser,
              transaction: mfg_transaction,
              ref: req.body.ppr_transaction,
              count: stepcount,
              type: "C",
              pprinsertedby: pprcreatedBY,
              random: req.body.accesstoken,
            },
            type: invtDB.QueryTypes.INSERT,
            transaction: transaction,
          },
        );

        await invtDB.query(
          "INSERT INTO mfg_production_3 (txn_session,company_branch, mfg_pro_apr_sku, mfg_approve_in_qty, mfg_pro_location_in, mfg_pro_apr_by, ppr_created_by, mfgphase2_insert_date, mfg_pro_apr_fulldate, mfg_ref_transid_1, mfg_ref_transid_2, type) VALUES (:txn_session,:branch, :sku, :lot_qty, :location, :approved_by, :created_by, :insert_date, :full_date, :ppr_no, :mfg_id, 'IN')",
          {
            replacements: {
              txn_session: helper.generateTxnSession(),
              branch: "BRMSC012",
              sku: sku_sfg,
              lot_qty: lot_qty,
              location: send_Loc,
              approved_by: req.logedINUser,
              created_by: pprcreatedBY,
              full_date: moment(new Date()).format("YYYY-MM-DD HH:mm:ss"),
              insert_date: insertDate,
              ppr_no: req.body.ppr_transaction,
              mfg_id: mfg_transaction,
            },
            type: invtDB.QueryTypes.INSERT,
            transaction: transaction,
          },
        );

        if (stmt1.length > 0) {
          const bomComponents = await invtDB.query(
            "SELECT qty,component_id FROM bom_quantity WHERE subject_under = :bomid AND bom_status = 'A' ",
            {
              replacements: { bomid: bom_id },
              type: invtDB.QueryTypes.SELECT,
            },
          );

          const componentData = await Promise.all(
            bomComponents.map(async (comp) => {
              const consumption_quantity = lot_qty * comp.qty;

              const [avgRate, inwardRows, outwardRows] = await Promise.all([
                require("../../../../helper/utils/newAvgRate").lastNewWeightedAverageRate(
                  comp.component_id,
                ),

                // ALL INWARD at consumption location
                invtDB.query(
                  `SELECT COALESCE(SUM(qty + other_qty), 0) AS Inward
               FROM   rm_location
               WHERE  components_id = :component
                 AND  loc_in        = :location
                 AND  trans_type IN ('INWARD','ISSUE','JOBWORK','REJECTION','TRANSFER')`,
                  {
                    replacements: {
                      component: comp.component_id,
                      location: consump_Loc,
                    },
                    type: invtDB.QueryTypes.SELECT,
                  },
                ),
                // ALL OUTWARD at consumption location
                invtDB.query(
                  `SELECT COALESCE(SUM(qty + other_qty), 0) AS Outward
               FROM   rm_location
               WHERE  components_id = :component
                 AND  loc_out       = :location
                 AND  trans_type IN ('CONSUMPTION','ISSUE','JOBWORK','REJECTION','TRANSFER')`,
                  {
                    replacements: {
                      component: comp.component_id,
                      location: consump_Loc,
                    },
                    type: invtDB.QueryTypes.SELECT,
                  },
                ),
              ]);

              const inward = inwardRows.length
                ? helper.number(inwardRows[0].Inward)
                : 0;
              const outward = outwardRows.length
                ? helper.number(outwardRows[0].Outward)
                : 0;

              return { comp, consumption_quantity, avgRate, inward, outward };
            }),
          );

          for (const {
            comp,
            consumption_quantity,
            avgRate,
            inward,
            outward,
          } of componentData) {
            productAvgRate += avgRate * comp.qty;

            if (helper.number(consumption_quantity) <= 0) continue;

            if (
              helper.number(inward - outward) <
              helper.number(consumption_quantity)
            ) {
              const [compInfo] = await Promise.all([
                invtDB.query(
                  `SELECT c_name, c_part_no FROM components WHERE component_key = :component`,
                  {
                    replacements: { component: comp.component_id },
                    type: invtDB.QueryTypes.SELECT,
                  },
                ),
              ]);
              const component_name =
                compInfo[0]?.c_part_no ?? comp.component_id;
              await transaction.rollback();
              return res.json({
                status: "error",
                message: `${inward} / ${outward} Attention: Some of the components ${component_name} are not available at the pick location`,
                success: false,
              });
            }

            await invtDB.query(
              `INSERT INTO rm_location
             (txn_session, company_branch, trans_type, components_id, qty,
              mfg_bom_qty, loc_out, insert_date, insert_by,
              mfg_ppr_trans_id_1, mfg_ppr_trans_id_2, mfg_step_count,
              bom_subject_id, any_remark)
           VALUES
             (:txn_session, :branch, 'CONSUMPTION', :component, :qty,
              :bom_qty, :loc_out, :insert_date, :insert_by,
              :mfg_id_1, :mfg_id_2, :step_count, :subject, :remark)`,
              {
                replacements: {
                  txn_session: helper.generateTxnSession(),
                  branch: "BRMSC012",
                  component: comp.component_id,
                  qty: consumption_quantity,
                  bom_qty: comp.qty,
                  loc_out: consump_Loc,
                  insert_date: insertDate,
                  insert_by: req.logedINUser,
                  mfg_id_1: req.body.ppr_transaction,
                  mfg_id_2: mfg_transaction,
                  step_count: stepcount,
                  subject: bom_id,
                  remark: "--",
                },
                type: invtDB.QueryTypes.INSERT,
                transaction,
              },
            );
          }
        }

        const stmt8 = await invtDB.query(
          `UPDATE mfg_production_1
       SET    prod_executed_qty = prod_executed_qty + :execute_qty
       WHERE  prod_product_sku  = :skucode
         AND  prod_transaction  = :ppr`,
          {
            replacements: {
              execute_qty: lot_qty,
              skucode: req.body.skucode,
              ppr: req.body.ppr_transaction,
            },
            type: invtDB.QueryTypes.UPDATE,
            transaction,
          },
        );

        if (stmt8.length <= 0) {
          await transaction.rollback();
          return res.json({
            status: "error",
            success: false,
            message: "an error occured while updating your request",
          });
        }

        if (sku_type === "SFG") {
          const [sfgComp, godownTxnRow, qcaNumberRow] = await Promise.all([
            invtDB.query(
              `SELECT component_key FROM components WHERE component_key = :component`,
              {
                replacements: { component: skutype[0].sfg_mapped_rm },
                type: invtDB.QueryTypes.SELECT,
              },
            ),
            invtDB.query(
              `SELECT * FROM ims_numbering WHERE for_number = 'GODOWN_TRANSFER' FOR UPDATE`,
              { type: invtDB.QueryTypes.SELECT, transaction },
            ),
            invtDB.query(
              `SELECT * FROM ims_numbering WHERE for_number = 'QCA' FOR UPDATE`,
              { type: invtDB.QueryTypes.SELECT, transaction },
            ),
          ]);

          if (sfgComp.length <= 0) {
            await transaction.rollback();
            return res.json({
              status: "error",
              success: false,
              message: "This SFG is not present in component data",
            });
          }

          let transactionID;
          if (godownTxnRow.length > 0) {
            const suffix = (helper.number(godownTxnRow[0].suffix) + 1)
              .toString()
              .padStart(
                helper.number(godownTxnRow[0].number_length_limit),
                "0",
              );
            transactionID = `${godownTxnRow[0].prefix}/${godownTxnRow[0].session}/${suffix}`;
          } else {
            const currYear = parseInt(
              new Date().getFullYear().toString().substr(2, 2),
            );
            transactionID = `IGA/${currYear}-${currYear + 1}/0001`;
          }

          let getNumber = await invtDB.query(
            "SELECT * FROM `ims_numbering` WHERE `for_number` = 'QCA' FOR UPDATE",
            {
              type: invtDB.QueryTypes.SELECT,
              transaction: transaction,
            },
          );
          var in_txn_no;

          if (getNumber.length > 0) {
            var suffix = getNumber[0].suffix;
            suffix = parseInt(suffix) + 1;
            suffix = suffix.toString();
            suffix = suffix.padStart(
              parseInt(getNumber[0].number_length_limit),
              "0",
            );

            in_txn_no =
              getNumber[0].prefix + "/" + getNumber[0].session + "/" + suffix;
          } else {
            let currYear = parseInt(
              new Date().getFullYear().toString().substr(2, 2),
            );
            in_txn_no = "QCA/" + currYear + "-" + (currYear + 1) + "/0001";
          }

          await invtDB.query(
            "UPDATE `ims_numbering` SET `suffix` = `suffix`+1 WHERE `for_number`= 'QCA'",
            {
              type: invtDB.QueryTypes.UPDATE,
              transaction: transaction,
            },
          );

          await invtDB.query(
            "INSERT INTO rm_location (txn_session,in_module,company_branch,components_id,qty,loc_in,any_remark,insert_date,insert_by,in_transaction_id, in_po_rate) VALUES (:txn_session,'IN-QCA',:branch,:component,:qty,:loc_in,:remark,:insert_date,:insert_by,:in_transaction_id, :in_po_rate)",
            {
              replacements: {
                txn_session: helper.generateTxnSession(),
                branch: "BRMSC012",
                component: sfgComp[0].component_key,
                qty: lot_qty,
                in_po_rate: productAvgRate,
                loc_in: send_Loc,
                in_transaction_id: in_txn_no,
                remark: "Process MIN",
                insert_date: moment(new Date()).format("YYYY-MM-DD HH:mm:ss"),
                insert_by: req.logedINUser,
              },
              type: invtDB.QueryTypes.INSERT,
              transaction: transaction,
            },
          );


          let stmt1 = await invtDB.query(
            "INSERT INTO `rm_location` (`txn_session`,`in_module`,`company_branch`,`trans_type`,`components_id`,`qty`,`loc_in`,`loc_out`,`any_remark`,`insert_date`,`insert_by`,`transfer_transaction_id`)VALUES (:txn_session,'IN-TRN',:branch,'TRANSFER',:component,:qty,:loc_in,:loc_out,:remark,:insert_date,:insert_by,:transfer_transaction_id)",
            {
              replacements: {
                txn_session: helper.generateTxnSession(),
                branch: "BRMSC012",
                component: sfgComp[0].component_key,
                qty: lot_qty,
                loc_in: send_Loc,
                loc_out: consump_Loc,
                remark: "Auto Transfer",
                insert_date: moment(new Date()).format("YYYY-MM-DD HH:mm:ss"),
                insert_by: req.logedINUser,
                transfer_transaction_id: transactionID,
              },
              type: invtDB.QueryTypes.INSERT,
              transaction: transaction,
            },
          );

          if (stmt1.length <= 0) {
            await transaction.rollback();
            return res.json({ success: false, status: "error", message: "an error by shifting the SFG to the location" });
          }
        }

        await transaction.commit();
        return res.json({
          data: {
            Lot_No: lot_no,
            Lot_Qty: lot_qty,
            PPR_No: req.body.ppr_transaction,
            SKU: req.body.skucode,
            Lot_type: req.body.result,
            Process: process_name,
          },
          success: true, status: "success", message: "Lot Transfer Successfully",
        });
      } else {
        await transaction.rollback();
        return res.json({ success: false, status: "error", message: "an error occured while updating your request" });
      }
    }
  } catch (err) {
    console.log(err);
    await transaction.rollback();
    return helper.errorResponse(res, err);
  }
});

module.exports = router;
