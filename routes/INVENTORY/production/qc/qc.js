const express = require("express");
const router = express.Router();


const { encode, decode } = require("html-entities");

let { invtDB } = require("../../../../config/db/connection");
const auth = require("../../../../middleware/auth");
const permission = require("../../../../middleware/permission");


const Validator = require("validatorjs");

// GET QC SAMPLING
router.post("/fetchQCSamples", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    wise: "required",
    data: "required",
  });

  if (validation.fails()) {
    res.json({ status: "error", success: false, message: "something you missing in form field to supply", data: validation.errors.all() });
    return;
  }

  const wise = req.body.wise;
  const data = req.body.data;

  try {
    let main_stmt;
    //   by date search
    if (wise == "datewise") {
      const date = data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);

      const fromdate = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
      const todate = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");
      const durationInMonths = moment(date[1], "DD-MM-YYYY").diff(moment(date[0], "DD-MM-YYYY"), "months");
      if (durationInMonths > 3) {
        return res.json({
          status: "error", success: false,
          message: "on the w.e.f Nov 11, 2021: We can provide you 90 days OR (3 months) data only",
          code: "500",
        });
      }

      main_stmt = await invtDB.query(
        "SELECT *,`rm_location`.`insert_date` AS 'material_insert_date', `rm_location`.`ID` AS 'material_row_id', `rm_location`.`is_qc_sample` AS `sampleStatus` FROM `rm_location` LEFT JOIN `components` ON `rm_location`.`components_id` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` WHERE (`rm_location`.`vendor_type` = 'v01' OR `rm_location`.`vendor_type` = 'j01') AND DATE_FORMAT(`rm_location`.`insert_date`,'%Y-%m-%d') BETWEEN :date1 AND :date2 AND `rm_location`.`is_qc_sample` = :status AND `components`.`c_type` = 'R' AND `components`.`c_is_enabled` = 'Y' AND `rm_location`.`company_branch` = :branch ORDER BY `rm_location`.`insert_date` DESC",
        {
          replacements: {
            date1: fromdate,
            date2: todate,
            status: "N",
            branch: req.branch
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else if (wise == "powise") {
      main_stmt = await invtDB.query(
        "SELECT *,`rm_location`.`insert_date` AS 'material_insert_date', `rm_location`.`ID` AS 'material_row_id', `rm_location`.`is_qc_sample` AS `sampleStatus` FROM `rm_location` LEFT JOIN `components` ON `rm_location`.`components_id` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` WHERE (`rm_location`.`vendor_type` = 'v01' OR `rm_location`.`vendor_type` = 'j01') AND `rm_location`.`in_po_transaction_id` = :po_id AND `rm_location`.`is_qc_sample` = :status AND `components`.`c_type` = 'R' AND `components`.`c_is_enabled` = 'Y' AND `rm_location`.`company_branch` = :branch ORDER BY `rm_location`.`insert_date` DESC",
        {
          replacements: {
            po_id: data,
            status: "N",
            branch: req.branch
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else if (wise == "vendorwise") {
      main_stmt = await invtDB.query(
        "SELECT *,`rm_location`.`insert_date` AS 'material_insert_date', `rm_location`.`ID` AS 'material_row_id', `rm_location`.`is_qc_sample` AS `sampleStatus` FROM `rm_location` LEFT JOIN `components` ON `rm_location`.`components_id` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` WHERE (`rm_location`.`vendor_type` = 'v01' OR `rm_location`.`vendor_type` = 'j01') AND `rm_location`.`in_vendor_name` = :venid AND `rm_location`.`is_qc_sample` = :status AND `components`.`c_type` = 'R' AND `components`.`c_is_enabled` = 'Y' AND `rm_location`.`company_branch` =:branch ORDER BY `rm_location`.`insert_date` DESC",
        {
          replacements: {
            venid: data,
            status: "N",
            branch: req.branch
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else if (wise == "minwise") {
      main_stmt = await invtDB.query(
        "SELECT *,`rm_location`.`insert_date` AS 'material_insert_date', `rm_location`.`ID` AS 'material_row_id', `rm_location`.`is_qc_sample` AS `sampleStatus` FROM `rm_location` LEFT JOIN `components` ON `rm_location`.`components_id` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` WHERE (`rm_location`.`vendor_type` = 'v01' OR `rm_location`.`vendor_type` = 'j01') AND `rm_location`.`in_transaction_id` LIKE CONCAT('%', :minno, '%') AND `rm_location`.`is_qc_sample` = :status AND `components`.`c_type` = 'R' AND `components`.`c_is_enabled` = 'Y' AND `rm_location`.`company_branch` = :branch ORDER BY `rm_location`.`insert_date` DESC",
        {
          replacements: {
            minno: data,
            status: "N",
            branch: req.branch
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else if (wise == "partwise") {
      main_stmt = await invtDB.query(
        "SELECT *,`rm_location`.`insert_date` AS 'material_insert_date', `rm_location`.`ID` AS 'material_row_id', `rm_location`.`is_qc_sample` AS `sampleStatus` FROM `rm_location` LEFT JOIN `components` ON `rm_location`.`components_id` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` WHERE (`rm_location`.`vendor_type` = 'v01' OR `rm_location`.`vendor_type` = 'j01') AND `rm_location`.`components_id` = :part AND `rm_location`.`is_qc_sample` = :status AND `components`.`c_type` = 'R' AND `components`.`c_is_enabled` = 'Y' AND `rm_location`.`company_branch` =:branch ORDER BY `rm_location`.`insert_date` DESC",
        {
          replacements: {
            part: data,
            status: "N",
            branch: req.branch
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else {
      res.json({ status: "error", success: false, message: "Please select valid filter method" });
      return;
    }

    if (main_stmt.length > 0) {
      let final_data = [];

      for (let i = 0; i < main_stmt.length; i++) {
        // START VENDOR
        if (main_stmt[i].in_vendor_name !== "--") {
          let ven_stmt = await invtDB.query("SELECT `ven_name`,`ven_register_id` FROM `ven_basic_detail` WHERE `ven_register_id` = :vendor", {
            replacements: { vendor: main_stmt[i].in_vendor_name },
            type: invtDB.QueryTypes.SELECT,
          });

          if (ven_stmt.length > 0) {
            vendorname = ven_stmt[0].ven_name;
            vendorkey = ven_stmt[0].ven_register_id;
          } else {
            vendorname = "N/A";
            vendorkey = "N/A";
          }
        } else {
          vendorname = "N/A";
          vendorkey = "N/A";
        }
        // END VENDOR
        //
        if (main_stmt[i].in_po_invoice_id !== "--" && main_stmt[i].in_invoice_id == "--") {
          if (main_stmt[i].in_po_invoice_id == "") {
            invoice = "N/A";
          } else {
            invoice = main_stmt[i].in_po_invoice_id;
          }
        } else {
          if (main_stmt[i].in_po_invoice_id == "--" && main_stmt[i].in_invoice_id !== "--") {
            if (main_stmt[i].in_invoice_id == "") {
              invoice = "N/A";
            } else {
              invoice = main_stmt[i].in_invoice_id;
            }
          } else {
            invoice = "N/A";
          }
        }

        final_data.push({
          slno: i + 1,
          date: moment(main_stmt[i].material_insert_date).tz("Asia/Kolkata").format("DD-MM-YYYY HH:mm:ss"),
          part: main_stmt[i].c_part_no,
          componentKey: main_stmt[i].component_key,
          component: decode(main_stmt[i].c_name),
          inQty: main_stmt[i].qty,
          invoice: invoice,
          pono: main_stmt[i].in_po_transaction_id,
          unit: main_stmt[i].units_name,
          vendorcode: vendorkey,
          vendorname: decode(vendorname),
          authKey: main_stmt[i].material_row_id,
          min_txn: main_stmt[i].in_transaction_id,
        });
      }

      res.json({ status: "success", success: true, message: "Data fetched successfully", data: final_data });
    } else {
      res.json({ status: "error", success: false, message: "No data found" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// ADD SAMPLING_STAGE1
router.post("/addSampling_stage1", [auth.isAuthorized], async (req, res) => {
  const t = await invtDB.transaction();
  try {
    const row_length = req.body.component.length;

    let tcode_stmt = await invtDB.query("SELECT `qc_transaction` FROM `pending_qc` ORDER BY `ID` DESC LIMIT 1", {
      type: invtDB.QueryTypes.SELECT,
    });
    let transactionCode;

    if (tcode_stmt.length > 0) {
      transactionCode = tcode_stmt[0].qc_transaction;
    } else {
      transactionCode = "SMP0001";
    }

    //let count = 0;
    for (let i = 0; i < row_length; i++) {
      if (helper.number(req.body.samQty[i]) > 0) {
        // $count++;
        // if (count <= 0) {
        // 	await transaction.rollback();
        // 	res.json({ message: "Please add atleast one item for sampling", status: "error", success: false });
        // 	return;
        // }

        let strings = transactionCode.replace(/[0-9]/g, "");
        let digits = (parseInt(transactionCode.replace(/[^0-9]/g, "")) + 1).toString();
        if (digits.length < 2) digits = ("000" + digits).substr(-3);
        transactionCode = strings + digits;

        let comp_smt = await invtDB.query("SELECT * FROM `components` WHERE `component_key` = :component", {
          replacements: { component: req.body.component[i] },
          type: invtDB.QueryTypes.SELECT,
        });

        if (comp_smt.length <= 0) {
          await t.rollback();
          return res.json({ status: "error", success: false, message: "transaction failed due to some client misconfiguration.." });
        }

        let stmt0 = await invtDB.query("SELECT `qty`, `in_po_invoice_id`, `in_invoice_id` FROM `rm_location` WHERE `in_transaction_id` = :min_txn AND `components_id` = :component AND `ID` = :row AND `company_branch` = :branch", {
          replacements: { min_txn: req.body.min_txn[i], component: req.body.component[i], row: req.body.authKey[i], branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        });
        if (stmt0.length <= 0) {
          await t.rollback();
          return res.json({ status: "error", success: false, message: "MIN is not valid for sampling, contact system administrator" });
        }

        let stmt1 = await invtDB.query(
          "INSERT INTO `pending_qc` (`company_branch`,`min_row_id`,`qc_vendor_name`, `qc_component_id`, `qc_mat_date`, `qc_sample_qty`, `qc_totalinward_qty`, `qc_inserted_by`, `qc_insert_fdate`, `qc_status`, `qc_transaction`, `qc_comment_1`, `mat_in_transaction`, `qc_mat_inv_no`) VALUES (:branch,:authkey, :vendor, :component, :min_dt, :sample, :minqty, :insert_by, :insert_date, :status, :sample_txn, :comment, :min_txn, :min_inv)",
          {
            replacements: {
              branch: req.branch,
              authkey: req.body.authKey[i],
              vendor: req.body.vendor[i],
              component: req.body.component[i],
              min_dt: moment(req.body.min_dt[i], "DD-MM-YYYY HH:mm:ss").format("YYYY-MM-DD HH:mm:ss"),
              sample: req.body.samQty[i],
              minqty: stmt0[0].qty,
              insert_by: req.logedINUser,
              insert_date: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
              status: "W",
              sample_txn: transactionCode,
              comment: req.body.remark[i] == "" ? "N/A" : req.body.remark[i],
              min_txn: req.body.min_txn[i],
              min_inv: stmt0[0].in_invoice_id == "--" ? stmt0[0].in_po_invoice_id : stmt0[0].in_invoice_id,
            },
            type: invtDB.QueryTypes.INSERT,
            transaction: t,
          }
        );

        if (stmt1.length > 0) {
          let stmt2 = await invtDB.query("UPDATE `rm_location` SET `is_qc_sample` = 'Y' WHERE `is_qc_sample` = 'N' AND `ID` = :row AND `components_id` = :component AND `in_transaction_id` = :min_txn", {
            replacements: { row: req.body.authKey[i], min_txn: req.body.min_txn[i], component: req.body.component[i] },
            type: invtDB.QueryTypes.UPDATE,
            transaction: t,
          });
        } else {
          await t.rollback();
          return res.json({ status: "error", success: false, message: "an error while executing your request, contact system administrator.." });
        }
      }

      if (i == row_length - 1) {
        await t.commit();
        return res.json({ status: "success", success: true, message: "sample sent..." });
      }
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// GET PENDING SAMPLE
router.post("/pendingSample", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    wise: "required",
    data: "required",
  });

  if (validation.fails()) {
    res.json({ status: "error", success: false, message: "something you missing in form field to supply", data: validation.errors.all() });
    return;
  }

  const wise = req.body.wise;
  const data = req.body.data;
  try {
    let main_stmt;
    if (wise == "datewise") {
      const date = data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);

      const fromdate = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
      const todate = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");
      const durationInMonths = moment(date[1], "DD-MM-YYYY").diff(moment(date[0], "DD-MM-YYYY"), "months");
      if (durationInMonths > 3) {
        return res.json({
          status: "error", success: false,
          message: "on the w.e.f Nov 11, 2021: We can provide you 90 days OR (3 months) data only",
          code: "500",
        });
      }

      main_stmt = await invtDB.query(
        "SELECT *, `ven_basic_detail`.`ven_name`, `pending_qc`.`ID` AS `rowid` FROM `pending_qc` LEFT JOIN `components` ON  `pending_qc`.`qc_component_id` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` LEFT JOIN `ven_basic_detail` ON `pending_qc`.`qc_vendor_name` = `ven_basic_detail`.`ven_register_id` WHERE `pending_qc`.`qc_status` = :status AND DATE_FORMAT(`pending_qc`.`qc_insert_fdate`,'%Y-%m-%d') BETWEEN :date1 AND :date2 AND `pending_qc`.`company_branch` = :branch ORDER BY `pending_qc`.`ID` DESC",
        {
          replacements: {
            date1: fromdate,
            date2: todate,
            status: "W",
            branch: req.branch
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else if (wise == "vendorwise") {
      main_stmt = await invtDB.query(
        "SELECT *, `ven_basic_detail`.`ven_name`, `pending_qc`.`ID` AS `rowid` FROM `pending_qc` LEFT JOIN `components` ON  `pending_qc`.`qc_component_id` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` LEFT JOIN `ven_basic_detail` ON `pending_qc`.`qc_vendor_name` = `ven_basic_detail`.`ven_register_id` WHERE `pending_qc`.`qc_status` = :status AND `pending_qc`.`qc_vendor_name` = :venid AND `pending_qc`.`company_branch` = :branch ORDER BY `pending_qc`.`ID` DESC",
        {
          replacements: {
            venid: data,
            status: "W",
            branch: req.branch
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else if (wise == "partwise") {
      main_stmt = await invtDB.query(
        "SELECT *, `ven_basic_detail`.`ven_name`, `pending_qc`.`ID` AS `rowid` FROM `pending_qc` LEFT JOIN `components` ON  `pending_qc`.`qc_component_id` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` LEFT JOIN `ven_basic_detail` ON `pending_qc`.`qc_vendor_name` = `ven_basic_detail`.`ven_register_id` WHERE `pending_qc`.`qc_status` = :status AND `pending_qc`.`qc_component_id` = :part AND `pending_qc`.`company_branch` = :branch ORDER BY `pending_qc`.`ID` DESC",
        {
          replacements: {
            part: data,
            status: "W",
            branch: req.branch
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else {
      res.json({ status: "error", success: false, message: "Please select valid filter method" });
      return;
    }

    if (main_stmt.length > 0) {
      var finalResult = [];
      for (let i = 0; i < main_stmt.length; i++) {
        finalResult.push({
          authkey: main_stmt[i].rowid,
          sample_dt: moment(main_stmt[i].qc_insert_fdate).tz("Asia/Kolkata").format("DD-MM-YYYY HH:mm:ss"),
          part: main_stmt[i].c_part_no,
          componentKey: main_stmt[i].component_key,
          component: decode(main_stmt[i].c_name),
          unit: main_stmt[i].units_name,
          rowid: main_stmt[i].rowid,
          transaction: main_stmt[i].qc_transaction,
          invoice: main_stmt[i].qc_mat_inv_no,
          qc_transaction: main_stmt[i].mat_in_transaction,
          samQty: main_stmt[i].qc_sample_qty,
          vendorcode: main_stmt[i].qc_vendor_name,
          vendorname: main_stmt[i].ven_name,
          inQty: main_stmt[i].qc_totalinward_qty,
          comment: "<strong>Stage 1 -!!! Comment: </strong>" + main_stmt[i].qc_comment_1,
        });
      }
      res.json({ status: "success", success: true, message: "Data fetched successfully", data: finalResult });
      return;
    } else {
      res.json({ status: "error", success: false, message: "No data found" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// UPDATE SAMPLING_STAGE2
router.post("/updateSampling_stage2", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    authKey: "required",
    status: "required",
    component: "required",
    sample_txn: "required",
    min_txn: "required",
  });

  if (validation.fails()) {
    res.json({ status: "error", success: false, message: "something you missing in form field to supply", data: validation.errors.all() });
  }

  if (req.body.status !== "P" && req.body.status !== "F") {
    return res.json({ status: "error", success: false, message: "status invalid.." });
  }

  try {
    let stmt = await invtDB.query("SELECT * FROM `pending_qc` WHERE `ID` = :id AND `qc_component_id` = :component AND `qc_transaction` = :sample_txn AND `mat_in_transaction` = :min_txn AND `pending_qc`.`company_branch` = :branch", {
      replacements: {
        component: req.body.component,
        id: req.body.authKey,
        sample_txn: req.body.sample_txn,
        min_txn: req.body.min_txn,
        branch: req.branch
      },
      type: invtDB.QueryTypes.SELECT,
    });
    if (stmt.length > 0) {
      if (stmt[0].qc_status !== "W") {
        return res.json({ status: "error", success: false, message: "seems the QC has already been tested.." });
      } else {
        let stmt_update = await invtDB.query(
          "UPDATE `pending_qc` SET `qc_comment_2` = :comment , `qc_status` = :status, `qc_approved_by` = :name, `qc_approve_fdate` = :date WHERE `ID` = :id AND `qc_component_id` = :component AND `qc_transaction` = :sample_txn AND `mat_in_transaction` = :min_txn",
          {
            replacements: {
              status: req.body.status,
              component: req.body.component,
              id: req.body.authKey,
              sample_txn: req.body.sample_txn,
              comment: req.body.remark == "" ? "N/A" : req.body.remark,
              min_txn: req.body.min_txn,
              name: req.logedINUser,
              date: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
            },
            type: invtDB.QueryTypes.UPDATE,
          }
        );
        if (stmt_update.length > 0) {
          return res.json({ status: "success", success: true, message: "QC updated and sent to ahead department...", updatestatus: req.body.status });
        } else {
          return res.json({ status: "error", success: false, message: "operation failed...!!! contact to system administrator" });
        }
      }
    } else {
      return res.json({ status: "error", success: false, message: "transaction failed.." });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// GET QC APPROVAL
router.post("/qcApproval", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    wise: "required",
    data: "required",
  });

  if (validation.fails()) {
    res.json({ status: "error", success: false, message: "something you missing in form field to supply", data: validation.errors.all() });
    return;
  }

  const wise = req.body.wise;
  const data = req.body.data;

  try {
    let main_stmt;
    //   by date search
    if (wise == "datewise") {
      const date = data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);

      const fromdate = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
      const todate = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");
      const durationInMonths = moment(date[1], "DD-MM-YYYY").diff(moment(date[0], "DD-MM-YYYY"), "months");
      if (durationInMonths > 3) {
        return res.json({
          status: "error", success: false,
          message: "on the w.e.f Nov 11, 2021: We can provide you 90 days OR (3 months) data only",
          code: "500",
        });
      }

      main_stmt = await invtDB.query(
        "SELECT *, `ven_basic_detail`.`ven_name`, `pending_qc`.`ID` AS `rowid` FROM `pending_qc` LEFT JOIN `components` ON  `pending_qc`.`qc_component_id` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` LEFT JOIN `ven_basic_detail` ON `pending_qc`.`qc_vendor_name` = `ven_basic_detail`.`ven_register_id` WHERE `pending_qc`.`qc_status` != 'W' AND `pending_qc`.`qc_status_2` = 'W' AND DATE_FORMAT(`pending_qc`.`qc_approve_fdate`,'%Y-%m-%d') BETWEEN :date1 AND :date2 AND `pending_qc`.`company_branch` = :branch ORDER BY `pending_qc`.`ID` DESC",
        {
          replacements: {
            date1: fromdate,
            date2: todate,
            branch: req.branch
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else if (wise == "vendorwise") {
      main_stmt = await invtDB.query(
        "SELECT *, `ven_basic_detail`.`ven_name`, `pending_qc`.`ID` AS `rowid` FROM `pending_qc` LEFT JOIN `components` ON  `pending_qc`.`qc_component_id` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` LEFT JOIN `ven_basic_detail` ON `pending_qc`.`qc_vendor_name` = `ven_basic_detail`.`ven_register_id` WHERE `pending_qc`.`qc_status` != 'W' AND `pending_qc`.`qc_status_2` = 'W' AND `pending_qc`.`qc_vendor_name` = :venid AND `pending_qc`.`company_branch` = :branch ORDER BY `pending_qc`.`ID` DESC",
        {
          replacements: {
            venid: data,
            branch: req.branch
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else if (wise == "partwise") {
      main_stmt = await invtDB.query(
        "SELECT *, `ven_basic_detail`.`ven_name`, `pending_qc`.`ID` AS `rowid` FROM `pending_qc` LEFT JOIN `components` ON  `pending_qc`.`qc_component_id` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` LEFT JOIN `ven_basic_detail` ON `pending_qc`.`qc_vendor_name` = `ven_basic_detail`.`ven_register_id` WHERE `pending_qc`.`qc_status` != 'W' AND `pending_qc`.`qc_status_2` = 'W' AND `pending_qc`.`qc_component_id` = :part AND `pending_qc`.`company_branch` = :branch ORDER BY `pending_qc`.`ID` DESC",
        {
          replacements: {
            part: data,
            branch: req.branch
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else {
      res.json({ status: "error", success: false, message: "Please select valid filter method" });
      return;
    }
    if (main_stmt.length > 0) {
      var finalResult = [];
      for (let i = 0; i < main_stmt.length; i++) {
        let status;
        if (main_stmt[i].qc_status == "F") {
          status = "R";
        } else {
          status = "A";
        }

        finalResult.push({
          authkey: main_stmt[i].rowid,
          status: status,
          sample_qc_date: moment(main_stmt[i].qc_insert_fdate, "YYYY-MM-DD HH:mm:ss").format("DD-MM-YYYY HH:mm:ss"),
          part: main_stmt[i].c_part_no,
          componentKey: main_stmt[i].component_key,
          component: decode(main_stmt[i].c_name),
          unit: main_stmt[i].units_name,
          rowid: main_stmt[i].rowid,
          invoice: main_stmt[i].qc_mat_inv_no,
          vendorcode: main_stmt[i].qc_vendor_name,
          vendorname: main_stmt[i].ven_name,
          sample_txn: main_stmt[i].qc_transaction,
          min_txn: main_stmt[i].mat_in_transaction,
          min_txn_dt: moment(main_stmt[i].qc_mat_date, "YYYY-MM-DD HH:mm:ss").format("DD-MM-YYYY HH:mm:ss"),
          samQty: main_stmt[i].qc_sample_qty,
          inQty: main_stmt[i].qc_totalinward_qty,
          comment_stage_first: main_stmt[i].qc_comment_1,
          comment_stage_second: main_stmt[i].qc_comment_2
        });
      }
      res.json({ status: "success", success: true, message: "Data fetched successfully", data: finalResult });
      return;
    } else {
      return res.json({ status: "error", success: false, message: "No data found" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// UPDATE SAMPLING STAGE3
router.post("/updateSampling_stage3", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    component: "required",
    sample_txn: "required",
    min_txn: "required",
    authKey: "required",
    status: "required",
  });
  if (validation.fails()) {
    res.json({ status: "error", success: false, message: "something you missing in form field to supply", data: validation.errors.all() });
  }
  if (req.body.status !== "A" && req.body.status !== "R") {
    return res.json({ status: "error", success: false, message: "status invalid.." });
  }
  try {
    let stmt = await invtDB.query("SELECT * FROM `pending_qc` WHERE `ID` = :id AND `qc_component_id` = :component AND `qc_transaction` = :sample_txn AND `mat_in_transaction` = :min_txn AND `company_branch` = :branch", {
      replacements: {
        component: req.body.component,
        id: req.body.authKey,
        sample_txn: req.body.sample_txn,
        min_txn: req.body.min_txn,
        branch: req.branch
      },
      type: invtDB.QueryTypes.SELECT,
    });

    if (stmt.length > 0) {
      if (stmt[0].qc_status_2 !== "W") {
        return res.json({ status: "error", success: false, message: "seems like QC has already been tested.." });
      } else {
        let stmt_update = await invtDB.query(
          "UPDATE `pending_qc` SET `qc_comment_3` = :comment , `qc_status_2` = :status , `qc_final_inserted_date` = :date , `qc_final_inserted_by` = :name WHERE `ID` = :id AND `qc_component_id` = :component AND `qc_transaction` = :sample_txn AND `mat_in_transaction` = :min_txn",
          {
            replacements: {
              status: req.body.status,
              component: req.body.component,
              name: req.logedINUser,
              date: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
              id: req.body.authKey,
              sample_txn: req.body.sample_txn,
              comment: req.body.remark == "" ? "N/A" : req.body.remark,
              min_txn: req.body.min_txn,
            },
          }
        );
        if (stmt_update.length > 0) {
          return res.json({ status: "success", success: true, message: "operation passed...", updatestatus: req.body.status });
        } else {
          return res.json({ status: "error", success: false, message: "operation failed...try again" });
        }
      }
    } else {
      return res.json({ status: "error", success: false, message: "transaction failed.." });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// qc_report_view
// FINAL QC REPORT
router.post("/final_qc_report", [auth.isAuthorized], async (req, res) => {
	let validation = new Validator(req.body, {
		type: "required",
		data: "required",
	});
	if (validation.fails()) {
		res.json({ status: "error", success: false, message: "something you missing in form field to supply", data: validation.errors.all() });
	}

	try {
		const date = req.body.data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);

		let date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
		let date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

		if (moment(date[1], "DD-MM-YYYY").diff(moment(date[0], "DD-MM-YYYY"), "days") > "90") {
			return res.json({
				status: "error", success: false,
				message: "on the w.e.f Nov 11, 2021: We can provide you 90 days OR (3 months) data only",
				code: "500",
			});
		}

		let main_stmt = await invtDB.query(
			"SELECT *, `pending_qc`.`ID` AS `rowid` FROM `pending_qc` LEFT JOIN `components` ON  `pending_qc`.`qc_component_id` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` WHERE `pending_qc`.`qc_status` != 'W' AND `pending_qc`.`qc_status_2` != 'W' AND (DATE_FORMAT(`pending_qc`.`qc_insert_fdate`,'%Y-%m-%d') BETWEEN :date1 AND :date2) AND `pending_qc`.`qc_status_2` = :status AND `pending_qc`.`company_branch` = :branch ORDER BY `pending_qc`.`qc_insert_fdate` DESC",
			{
				replacements: { date1: date1, date2: date2, status: req.body.type, branch: req.branch },
				type: invtDB.QueryTypes.SELECT,
			}
		);

		if (main_stmt.length > 0) {
			let final_data = [];
			for (let i = 0; i < main_stmt.length; i++) {
				let vname, vcode;
				if (main_stmt[i].qc_vendor_name !== "N/A") {
					let stmt_ven = await invtDB.query("SELECT `ven_name` FROM `ven_basic_detail` WHERE `ven_register_id` = :vendor", {
						replacements: { vendor: main_stmt[i].qc_vendor_name },
						type: invtDB.QueryTypes.SELECT,
					});

					if (stmt_ven.length > 0) {
						vname = stmt_ven[0].ven_name;
						vcode = main_stmt[i].qc_vendor_name;
					} else {
						vname = "N/A";
						vcode = "--";
					}
				} else {
					vname = "N/A";
					vcode = "--";
				}

				final_data.push({
					status: main_stmt[i].qc_status_2 == "A" ? "A" : "R",
					smp_txn: main_stmt[i].qc_transaction,
					min_txn: main_stmt[i].mat_in_transaction,
					min_dt: moment(main_stmt[i].qc_mat_date, "YYYY-MM-DD HH:mm:ss").tz("Asia/Kolkata").format("DD-MM-YYYY HH:mm:ss"),
					apv_dt: moment(main_stmt[i].qc_final_inserted_date).tz("Asia/Kolkata").format("DD-MM-YYYY HH:mm:ss"),
					part: main_stmt[i].c_part_no,
					component: decode(main_stmt[i].c_name),
					vname: decode(vname),
					vcode: vcode,
					invoice: main_stmt[i].qc_mat_inv_no,
					min_qty: main_stmt[i].qc_totalinward_qty,
					smp_qty: main_stmt[i].qc_sample_qty,
					uom: main_stmt[i].units_name,
					comment: {
            				stage_1 : "Stage 1 -!!! Comment: " + main_stmt[i].qc_comment_1,
            				stage_2 : "Stage 2 -!!! Comment: " + main_stmt[i].qc_comment_2,
            				stage_3 : "Stage 3 -!!! Comment: " + main_stmt[i].qc_comment_3
          			},
				});
			}
			return res.json({ status: "success", success: true, message: "Data fetched successfully", data: final_data });
		} else {
			return res.json({ status: "error", success: false, message: "nothing found that match the given search criteria." });
		}
	} catch (err) {
	    return helper.errorResponse(res, err);
	}
});

module.exports = router;

