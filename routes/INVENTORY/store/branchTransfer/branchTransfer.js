const express = require("express");
const router = express.Router();


const auth = require("../../../../middleware/auth");
const permission = require("../../../../middleware/permission");

let { invtDB } = require("../../../../config/db/connection");


const htmlToPdf = require("html-pdf-node");
const fs = require("fs");
const axios = require("axios");

const Validator = require("validatorjs");

const OAKTER_BASE_URL = process.env.OAKTER_BASE_URL

// CREATE BRANCH TRANSFER
router.post("/createBranchTransfer", [auth.isAuthorized], async (req, res) => {

  try {

    const header_valid = new Validator(req.body.header, {
      vendor: "required",
      vendor_branch: "required",
      vendor_address: "required",
      mode: "required",
      reference_no: "required",
      other_term: "required",
      dispatch_doc_no: "required",
      dispatch_through: "required",
      destination: "required",
      term_of_delivery: "required",
      vehicle_no: "required",
      narration: "required",
      billing_id: "required",
      billing_address: "required",
      narration: "required",
    });

    if (header_valid.fails()) {
      return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(header_valid) });
    }

    const materials = req.body.materials;
    const materials_length = materials.component.length;

    if (materials_length == 0) {
      return res.json({ status: "error", success: false, message: "Please add at least one item" });
    }

    for (let i = 0; i < materials_length; i++) {
      const material_valid = new Validator({
        component: materials.component[i],
        qty: materials.qty[i],
        hsn: materials.hsn[i],
        from_location: materials.from_location[i],
        to_location: materials.to_location[i],
        item_description: materials.item_description[i],
      }, {
        component: "required",
        qty: "required",
        hsn: "required",
        from_location: "required",
        to_location: "required",
        item_description: "required",
      });
      if (material_valid.fails()) {
        return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(material_valid) });
      }
    }
  }
  catch (err) {
    return res.json({ status: "error", success: false, message: "Internal Error!!! If this condition persists, contact your system administrator", debug: process.env.NODE_ENV === 'development' ? err.stack : undefined });
  }

  const transaction = await invtDB.transaction();

  try {

    // TRANSACTION NUMBER
    let trans_id;
    let getNumber = await invtDB.query("SELECT * FROM ims_numbering WHERE for_number = 'BRANCH_TRANSFER' FOR UPDATE", {
      type: invtDB.QueryTypes.SELECT,
      transaction: transaction,
    });

    if (getNumber.length > 0) {
      var suffix = getNumber[0].suffix;
      suffix = parseInt(suffix) + 1;
      suffix = suffix.toString();
      suffix = suffix.padStart(parseInt(getNumber[0].number_length_limit), "0");

      trans_id = getNumber[0].prefix + "/" + getNumber[0].session + "/" + suffix;
    } else {
      let currYear = parseInt(new Date().getFullYear().toString().substr(2, 2));
      trans_id = "BRTC/" + currYear + "-" + (currYear + 1) + "/0001";
    }

    await invtDB.query("UPDATE ims_numbering SET suffix = (suffix + 1) WHERE for_number = 'BRANCH_TRANSFER'", {
      type: invtDB.QueryTypes.UPDATE,
      transaction: transaction,
    });

    // END TRANSACTION NUMBER

	let insert_dt = moment(new Date()).format("YYYY-MM-DD HH:mm:ss");
    const materials = req.body.materials;
    const materials_length = materials.component.length;
    for (let i = 0; i < materials_length; i++) {
      // ALL INWARD
      let stmtInward = await invtDB.query("SELECT COALESCE(SUM(qty+other_qty), 0) AS Inward FROM rm_location WHERE components_id = :component AND (trans_type IN ('INWARD', 'ISSUE','JOBWORK','REJECTION','TRANSFER')) AND loc_in = :pic_loc", {
        replacements: {
          component: materials.component[i],
          pic_loc: materials.from_location[i]
        },
        type: invtDB.QueryTypes.SELECT,
      });

      let inward_all_qty = 0;
      if (stmtInward.length > 0) {
        inward_all_qty = helper.number(stmtInward[0].Inward);
      }

      // ALL OUTWARD
      let stmtOutward = await invtDB.query("SELECT COALESCE(SUM(qty+other_qty), 0) AS Outward FROM rm_location WHERE components_id = :component AND (trans_type IN ( 'CONSUMPTION', 'ISSUE', 'JOBWORK', 'REJECTION', 'TRANSFER')) AND loc_out = :pic_loc", {
        replacements: {
          component: materials.component[i],
          pic_loc: materials.from_location[i]
        },
        type: invtDB.QueryTypes.SELECT,
      });

      let outward_all_qty = 0;
      if (stmtOutward.length > 0) {
        outward_all_qty = helper.number(stmtOutward[0].Outward);
      }

      if (helper.number(inward_all_qty - outward_all_qty) < materials.qty[i]) {
        await transaction.rollback();
        return res.json({ status: "error", success: false, message: `Insufficient stock of component at row ${i + 1}` });
      }

      // INSERT BRANCH TRANSFER TABLE

      let stmt_insert_bt = await invtDB.query("INSERT INTO brach_transfer_challan (company_branch , bt_trans_id, bt_challan_status, bt_billing_id, bt_billing_address, bt_ven_id, bt_ven_address, bt_add_id, bt_component_id, bt_qty, from_location, from_branch, to_location, to_branch, bt_hsn, bt_comp_desc, bt_mode, bt_ref_no, bt_other_term, bt_disp_doc_no, bt_disp_through, bt_destination, bt_term_dlvy, bt_vehicle_no, bt_narration, bt_insert_dt, bt_insert_by) VALUES ( :branch, :bt_trans_id , :status , :bill_id , :bill_add , :ven_id , :ven_add  , :ven_add_id, :comp , :qty , :from_loc , :from_branch , :to_loc , :to_branch , :hsn , :comp_desc , :mode , :ref_no , :other_term , :disp_doc_no , :disp_through , :destination , :term_of_dlvy , :vehicle_no , :narration , :insert_dt , :user )", {
        replacements: {
          branch: req.branch,
          bt_trans_id: trans_id,
          status: "A",
          bill_id: req.body.header.billing_id,
          bill_add: req.body.header.billing_address,
          ven_id: req.body.header.vendor,
          ven_add: req.body.header.vendor_address,
          ven_add_id: req.body.header.vendor_branch,
          comp: materials.component[i],
          qty: materials.qty[i],
          from_loc: materials.from_location[i],
          // from_branch: materials.from_branch[i],
          from_branch: "--",
          to_loc: materials.to_location[i],
          // to_branch: materials.to_branch[i],
          to_branch: "--",
          hsn: materials.hsn[i],
          comp_desc: materials.item_description[i],
          mode: req.body.header.mode,
          ref_no: req.body.header.reference_no,
          other_term: req.body.header.other_term,
          disp_doc_no: req.body.header.dispatch_doc_no,
          disp_through: req.body.header.dispatch_through,
          destination: req.body.header.destination,
          term_of_dlvy: req.body.header.term_of_delivery,
          vehicle_no: req.body.header.vehicle_no,
          narration: req.body.header.narration,
          insert_dt: moment(new Date()).format("YYYY-MM-DD HH:mm:ss"),
          user: req.logedINUser
        },
        type: invtDB.QueryTypes.INSERT,
        transaction: transaction
      });

      // INSERT RM LOCATION ISSUE
      let stmt_issue = await invtDB.query("INSERT INTO rm_location (company_branch,trans_type,components_id,loc_in,loc_out,qty,any_remark,insert_date,insert_by,out_transaction_id)VALUES (:branch,:type,:component,:loc_in,:loc_out,:qty,:remark,:indate,:inby,:out_transaction_id)", {
        replacements: {
          branch: req.branch,
          type: "ISSUE",
          component: materials.component[i],
          loc_in: materials.to_location[i],
          loc_out: materials.from_location[i],
          qty: materials.qty,
          remark: materials.item_description[i] == "" ? "--" : materials.item_description[i],
          indate: insert_dt,
          inby: req.logedINUser,
          out_transaction_id: trans_id,
        },
        type: invtDB.QueryTypes.INSERT,
        transaction: transaction,
      });
      //   END INSERT RM LOCATION ISSUE

      // INSERT RM LOCATION INWARD
      let stmt_inward = await invtDB.query("INSERT INTO rm_location (company_branch,trans_type,components_id,loc_in,loc_out,qty,any_remark,insert_date,insert_by,in_transaction_id , stock_status)VALUES (:branch,:type,:component,:loc_in,:loc_out,:qty,:remark,:indate,:inby,:in_transaction_id , :stock_status)", {
        replacements: {
          branch: req.branch,
          type: "INWARD",
          component: materials.component[i],
          loc_in: materials.to_location[i],
          loc_out: materials.from_location[i],
          qty: materials.qty,
          remark: materials.item_description[i] == "" ? "--" : materials.item_description[i],
          indate: insert_dt,
          inby: req.logedINUser,
          in_transaction_id: trans_id,
          stock_status: 'INTRANSIT'
        },
        type: invtDB.QueryTypes.INSERT,
        transaction: transaction,
      });
      // END INSERT RM LOCATION INWARD

    }// END LOOP

    await transaction.commit();
    return res.json({ status: "success", success: true, message: "Branch Transfer Successfully" });

  }
  catch (err) {
    await transaction.rollback();
    return res.json({ status: "error", success: false, message: "Internal Error!!! If this condition persists, contact your system administrator", debug: process.env.NODE_ENV === 'development' ? err.stack : undefined });
  }
});

// FETCH RECORDS
router.post("/getBranchTransfer", [auth.isAuthorized], async (req, res) => {
  try {

    let valid = new Validator(req.body, {
      data: "required",
      type: "required"
    });

    if (valid.fails()) {
      return res.json({ status: "error", success: false, message: "Select All Fields!", data: valid.errors.all() });
    }

    let stmt_main;

    if (req.body.type == "vendor") {
      main_stmt = await invtDB.query("SELECT brach_transfer_challan.*, f_loc.loc_name as from_loc_name , to_loc.loc_name as to_loc_name , ven_basic_detail.ven_name FROM brach_transfer_challan LEFT JOIN location_main f_loc ON brach_transfer_challan.from_location = f_loc.location_key LEFT JOIN location_main to_loc ON brach_transfer_challan.to_location = to_loc.location_key LEFT JOIN ven_basic_detail ON ven_basic_detail.ven_register_id = brach_transfer_challan.bt_ven_id WHERE brach_transfer_challan.company_branch = :branch AND bt_ven_id = :ven_id GROUP BY bt_trans_id", {
        replacements: {
          branch: req.branch, ven_id: req.body.data
        },
        type: invtDB.QueryTypes.SELECT
      });
    }
    if (req.body.type == "date") {
      const date = req.body.data.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
      const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
      const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

      if (date1 == "Invalid date" || date2 == "Invalid date") {
        return res.json({ status: "error", success: false, message: "Invalid date" });
      }

      main_stmt = await invtDB.query("SELECT brach_transfer_challan.*, f_loc.loc_name as from_loc_name , to_loc.loc_name as to_loc_name , ven_basic_detail.ven_name FROM brach_transfer_challan LEFT JOIN location_main f_loc ON brach_transfer_challan.from_location = f_loc.location_key LEFT JOIN location_main to_loc ON brach_transfer_challan.to_location = to_loc.location_key LEFT JOIN ven_basic_detail ON ven_basic_detail.ven_register_id = brach_transfer_challan.bt_ven_id WHERE brach_transfer_challan.company_branch = :branch AND DATE_FORMAT(bt_insert_dt, '%Y-%m-%d') BETWEEN :date1 AND :date2 GROUP BY bt_trans_id", {
        replacements: {
          branch: req.branch, date1: date1, date2: date2
        },
        type: invtDB.QueryTypes.SELECT
      });
    }


    if (main_stmt.length <= 0) {
      return res.json({ status: "error", success: false, message: "No Record Found" });
    }

    let data = [];

    for (let i = 0; i < main_stmt.length; i++) {
      data.push({
        trans_id: main_stmt[i].bt_trans_id,
        vendor_code: main_stmt[i].bt_ven_id,
        vendor: main_stmt[i].ven_name,
        from_location: main_stmt[i].from_loc_name,
        to_location: main_stmt[i].to_loc_name,
        doc_n0: main_stmt[i].doc_no,
        doc_dt: main_stmt[i].bt_disp_doc_no,
        vehicle_no: main_stmt[i].bt_vehicle_no,
        narration: main_stmt[i].bt_narration,
        create_dt: moment(main_stmt[i].bt_insert_dt, "YYYY-MM-DD HH:mm:ss").format("DD-MM-YYYY HH:mm:ss"),
      })
    }

    return res.json({ status: "success", success: true, data: data });

  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// FETCH COMPONENT DETAILS
router.post("/branchTransferDetails", [auth.isAuthorized], async (req, res) => {

  try {
    const valid = new Validator(req.body, {
      trans_id: "required",
    });

    if (valid.fails()) {
      return res.json({ status: "error", success: false, message: "Challan ID missing!", data: valid.errors.all() });
    }


    let stmt = await invtDB.query("SELECT c_name , c_part_no , bt_qty , bt_comp_desc FROM brach_transfer_challan LEFT JOIN components ON components.component_key = brach_transfer_challan.bt_component_id WHERE bt_trans_id = :trans_id", {
      replacements: {
        trans_id: req.body.trans_id
      },
      type: invtDB.QueryTypes.SELECT
    });

    if (stmt.length <= 0) {
      return res.json({ status: "error", success: false, message: "No Record Found" });
    }

    let data = [];

    for (let i = 0; i < stmt.length; i++) {
      data.push({
        component: stmt[i].c_name,
        part_no: stmt[i].c_part_no,
        qty: stmt[i].bt_qty,
        comp_remark: stmt[i].bt_comp_desc
      })
    }

    return res.json({ status: "success", success: true, data: data });

  }
  catch (err) {
    return res.json({ status: "error", success: false, message: "Internal Error!!! If this condition persists, contact your system administrator", debug: process.env.NODE_ENV === 'development' ? err.stack : undefined });
  }

});

// TRANSFER LOCATIONS
router.post("/transferLocations", [auth.isAuthorized], async (req, res) => {
  try {

    const valid = new Validator(req.body, {
      from_branch: "required",
      to_branch: "required",
    });

    if (valid.fails()) {
      return res.json({ status: "error", success: false, message: "Select branches first!", data: valid.errors.all() });
    }

    if (req.body.from_branch == req.body.to_branch) {
      return res.json({ status: "error", success: false, message: "Branches cannot be the same!" });
    }

    // PICK LOCATIONS
    const stmt_pick = await invtDB.query("SELECT locations FROM location_allotted WHERE loc_all_key = :from_branch ", {
      replacements: { from_branch: "PICK_" + req.body.from_branch },
      type: invtDB.QueryTypes.SELECT
    });

    let b29PickLocation = [];
    if (stmt_pick.length > 0) {
      const pick_locs_key = stmt_pick[0].locations.split(",");

      const stmt_locations = await invtDB.query("SELECT loc_name as text , location_key as value  FROM location_main WHERE location_key IN ( :pick_locs_key ) ", {
        replacements: { pick_locs_key },
        type: invtDB.QueryTypes.SELECT
      });

      if (stmt_locations.length > 0) {
        b29PickLocation = stmt_locations;
      }
    }
    // END PICK LOCATIONS

    // DROP LOCATIONS
    const stmt_drop = await invtDB.query("SELECT locations FROM location_allotted WHERE loc_all_key = :to_branch ", {
      replacements: { to_branch: "DROP_" + req.body.to_branch },
      type: invtDB.QueryTypes.SELECT
    });

    let a21DropLocation = [];
    if (stmt_drop.length > 0) {
      const drop_locs_key = stmt_drop[0].locations.split(",");

      const stmt_locations = await invtDB.query("SELECT loc_name as text  , location_key as value FROM location_main WHERE location_key IN ( :drop_locs_key) ", {
        replacements: { drop_locs_key },
        type: invtDB.QueryTypes.SELECT
      });

      if (stmt_locations.length > 0) {
        a21DropLocation = stmt_locations;
      }
    }
    // END DROP LOCATIONS
    return res.json({ status: "success", success: true, data: { picklocs: b29PickLocation, droplocs: a21DropLocation } });

  }
  catch (err) {
    return res.json({ status: "error", success: false, message: "Internal Error!!! If this condition persists, contact your system administrator", debug: process.env.NODE_ENV === 'development' ? err.stack : undefined });
  }
})

// APPROVE BRANCH TRANSFER
router.post("/approveTransferStock", [auth.isAuthorized], async (req, res) => {
  try {

    const valid = new Validator(req.body, {
      trans_id: "required",
    });

    if (valid.fails()) {
      return res.json({ status: "error", success: false, message: "Challan ID missing!", data: valid.errors.all() });
    }

    const stmt = await invtDB.query("UPDATE rm_location SET stock_status = 'PHYSICAL' WHERE in_transaction_id = :bt_key ", {
      replacements: { bt_key: req.body.trans_id },
      type: invtDB.QueryTypes.UPDATE
    });

    if (stmt.length > 0) {
      return res.json({ status: "success", success: true, message: "Stock approved successfully" });
    }
    else {
      return res.json({ status: "error", success: false, message: "Internal Error!!! If this condition persists, contact your system administrator" });
    }

  }
  catch (err) {
    return res.json({ status: "error", success: false, message: "Internal Error!!! If this condition persists, contact your system administrator", debug: process.env.NODE_ENV === 'development' ? err.stack : undefined });
  }
})

// LIST OF BRANCH TRANSFER
router.get("/listBranchTransfer", [auth.isAuthorized], async (req, res) => {
  try {

    const stmt = await invtDB.query("SELECT branch_name as text, branch_code as id FROM branches", {
      type: invtDB.QueryTypes.SELECT
    });

    if (stmt.length > 0) {
      return res.json({ status: "success", success: true, data: stmt });
    }
    else {
      return res.json({ status: "error", success: false, message: "No data found" });
    }

  }
  catch (err) {
    return res.json({ status: "error", success: false, message: "Internal Error!!! If this condition persists, contact your system administrator", debug: process.env.NODE_ENV === 'development' ? err.stack : undefined });
  }

});


// LIST INCOMING BRANCH TRANSFERS FROM SOURCE BRANCH SOFTWARE, WITH LOCAL PENDING/COMPLETED STATUS
router.get("/incomingBranchTransferList", async (req, res) => {

  try {

    const valid = new Validator(req.query, {
      from: "required",
      to: "required",
    });

    if (valid.fails()) {
      return res.json({ status: "error", success: false, message: "From and To dates are required!", data: valid.errors.all() });
    }

    // FETCH CHALLAN LIST FROM SOURCE BRANCH SOFTWARE
    let remote_response;
    try {
      remote_response = await axios.get(`${OAKTER_BASE_URL}/api/v1/branchTransfer/list`, {
        params: { from: req.query.from, to: req.query.to },
      });
    }
    catch (err) {
      console.error("incomingBranchTransferList remote fetch failed:", err.response ? err.response.data : err.message);
      return res.json({ status: "error", success: false, message: "Unable to fetch data from source branch software", debug: process.env.NODE_ENV === 'development' ? (err.response ? err.response.data : err.message) : undefined });
    }

    const remote_data = remote_response.data;

    if (!remote_data || !remote_data.success || !Array.isArray(remote_data.data) || remote_data.data.length == 0) {
      return res.json({ status: "error", success: false, message: "No record found for the selected date range" });
    }

    const items = remote_data.data;
    let data = [];

    for (let i = 0; i < items.length; i++) {

      // A CHALLAN IS "Completed" ONCE IT HAS BEEN PULLED AND INWARDED HERE (stock_status = 'COMPLETED')
      const already_inward = await invtDB.query("SELECT 1 FROM rm_location WHERE in_transaction_id = :trans_id AND trans_type = 'INWARD' AND stock_status = 'COMPLETED' LIMIT 1", {
        replacements: { trans_id: items[i].transId },
        type: invtDB.QueryTypes.SELECT
      });

      data.push({
        transId: items[i].transId,
        branchCode: items[i].branchCode,
        branchName: items[i].branchName,
        fromLocation: items[i].fromLocation,
        toLocation: items[i].toLocation,
        vendor: items[i].vendor,
        docNo: items[i].docNo,
        vehicleNo: items[i].vehicleNo,
        narration: items[i].narration,
        insertDate: items[i].insertDate,
        status: already_inward.length > 0 ? "Completed" : "Pending",
      });
    }

    if (data.length == 0) {
      return res.json({ status: "error", success: false, message: "No record found for the selected date range" });
    }

    return res.json({ status: "success", success: true, data: data });

  }
  catch (err) {
    return res.json({ status: "error", success: false, message: "Internal Error!!! If this condition persists, contact your system administrator", debug: process.env.NODE_ENV === 'development' ? err.stack : undefined });
  }

});

// DETAILS OF AN INCOMING BRANCH TRANSFER — LOCAL rm_location DATA IF ALREADY COMPLETED, ELSE LIVE FROM SOURCE BRANCH SOFTWARE (PENDING)
router.get("/incomingBranchTransferDetails", [auth.isAuthorized], async (req, res) => {

  try {

    const valid = new Validator(req.query, {
      trans_id: "required",
    });

    if (valid.fails()) {
      return res.json({ status: "error", success: false, message: "Challan ID missing!", data: valid.errors.all() });
    }

    const stmt = await invtDB.query(
      `SELECT
        rm_location.company_branch,
        branches.branch_name,
        rm_location.trans_type,
        rm_location.in_transaction_id,
        rm_location.components_id,
        components.c_name,
        components.c_part_no,
        rm_location.loc_in,
        loc_in_tbl.loc_name AS loc_in_name,
        rm_location.loc_out,
        loc_out_tbl.loc_name AS loc_out_name,
        rm_location.qty,
        rm_location.in_po_rate,
        rm_location.in_vendor_name,
        ven_basic_detail.ven_name,
        rm_location.any_remark,
        rm_location.insert_date,
        rm_location.insert_by,
        admin_login.user_name AS insert_by_name,
        rm_location.stock_status
      FROM rm_location
      LEFT JOIN components ON rm_location.components_id = components.component_key
      LEFT JOIN location_main AS loc_in_tbl ON rm_location.loc_in = loc_in_tbl.location_key
      LEFT JOIN location_main AS loc_out_tbl ON rm_location.loc_out = loc_out_tbl.location_key
      LEFT JOIN admin_login ON rm_location.insert_by = admin_login.CustID
      LEFT JOIN branches ON rm_location.company_branch = branches.branch_code
      LEFT JOIN ven_basic_detail ON ven_basic_detail.ven_register_id = rm_location.in_vendor_name
      WHERE rm_location.in_transaction_id = :trans_id AND rm_location.trans_type = 'INWARD'`,
      {
        replacements: { trans_id: req.query.trans_id },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    // ALREADY COMPLETED LOCALLY — RETURN OUR OWN rm_location DATA
    if (stmt.length > 0) {
      let data = [];

      for (let i = 0; i < stmt.length; i++) {
        data.push({
          transId: stmt[i].in_transaction_id,
          branchCode: stmt[i].company_branch,
          branchName: stmt[i].branch_name,
          transType: stmt[i].trans_type,
          componentKey: stmt[i].components_id,
          componentName: stmt[i].c_name,
          partNo: stmt[i].c_part_no,
          locInKey: stmt[i].loc_in,
          locInName: stmt[i].loc_in_name,
          locOutKey: stmt[i].loc_out,
          locOutName: stmt[i].loc_out_name,
          qty: stmt[i].qty,
          rate: stmt[i].in_po_rate,
          vendorCode: stmt[i].in_vendor_name,
          vendorName: stmt[i].ven_name,
          remark: stmt[i].any_remark,
          insertDate: moment(stmt[i].insert_date, "YYYY-MM-DD HH:mm:ss").format("YYYY-MM-DD HH:mm:ss"),
          insertBy: stmt[i].insert_by,
          insertByName: stmt[i].insert_by_name,
          status: stmt[i].stock_status,
        });
      }

      return res.json({ status: "success", success: true, data: data });
    }

    // NOT YET PULLED — FETCH LIVE DETAILS FROM SOURCE BRANCH SOFTWARE
    let remote_response;
    try {
      remote_response = await axios.get(`${OAKTER_BASE_URL}/api/v1/branchTransfer/details`, {
        params: { trans_id: req.query.trans_id },
      });
    }
    catch (err) {
      console.error("incomingBranchTransferDetails remote fetch failed:", err.response ? err.response.data : err.message);
      return res.json({ status: "error", success: false, message: "Unable to fetch data from source branch software", debug: process.env.NODE_ENV === 'development' ? (err.response ? err.response.data : err.message) : undefined });
    }

    const remote_data = remote_response.data;

    if (!remote_data || !remote_data.success || !Array.isArray(remote_data.data) || remote_data.data.length == 0) {
      return res.json({ status: "error", success: false, message: "No Record Found" });
    }

    const items = remote_data.data;
    let data = [];

    for (let i = 0; i < items.length; i++) {
      data.push({
        transId: items[i].transId,
        branchCode: items[i].branchCode,
        branchName: items[i].branchName,
        transType: items[i].transType,
        componentKey: items[i].componentKey,
        componentName: items[i].componentName,
        partNo: items[i].partNo,
        locInKey: items[i].locInKey,
        locInName: items[i].locInName,
        locOutKey: items[i].locOutKey,
        locOutName: items[i].locOutName,
        qty: items[i].qty,
        rate: items[i].rate,
        vendorCode: items[i].vendorCode,
        vendorName: items[i].vendorName,
        remark: items[i].remark,
        insertDate: items[i].insertDate,
        insertBy: items[i].insertBy,
        insertByName: items[i].insertByName,
        status: "INTRANSIT",
      });
    }

    return res.json({ status: "success", success: true, data: data });

  }
  catch (err) {
    return res.json({ status: "error", success: false, message: "Internal Error!!! If this condition persists, contact your system administrator", debug: process.env.NODE_ENV === 'development' ? err.stack : undefined });
  }

});

// CREATE BRANCH TRANSFER INWARD (PULL ISSUE DATA FROM SOURCE BRANCH SOFTWARE)
router.post("/createBranchTransferInward", [auth.isAuthorized], async (req, res) => {

  try {

    const valid = new Validator(req.body, {
      trans_id: "required",
    });

    if (valid.fails()) {
      return res.json({ status: "error", success: false, message: "Challan ID missing!", data: valid.errors.all() });
    }

    const trans_id = req.body.trans_id;

    // ALREADY INWARDED CHECK (RM side or FG side)
    const already_inward_rm = await invtDB.query("SELECT 1 FROM rm_location WHERE in_transaction_id = :trans_id AND trans_type = 'INWARD' LIMIT 1", {
      replacements: { trans_id },
      type: invtDB.QueryTypes.SELECT
    });

    const already_inward_fg = await invtDB.query("SELECT 1 FROM mfg_production_3 WHERE mfg_pro_apr_transaction = :trans_id AND type = 'BRANCHTRANSFER' LIMIT 1", {
      replacements: { trans_id },
      type: invtDB.QueryTypes.SELECT
    });

    if (already_inward_rm.length > 0 || already_inward_fg.length > 0) {
      return res.json({ status: "error", success: false, message: "This branch transfer has already been received!" });
    }

    // FETCH ISSUE DETAILS FROM SOURCE BRANCH SOFTWARE
    let remote_response;
    try {
      remote_response = await axios.get(`${OAKTER_BASE_URL}/api/v1/branchTransfer/details`, {
        params: { trans_id: trans_id },
      });
    }
    catch (err) {
      return res.json({ status: "error", success: false, message: "Unable to fetch data from source branch software" });
    }

    const remote_data = remote_response.data;

    if (!remote_data || !remote_data.success || !Array.isArray(remote_data.data) || remote_data.data.length == 0) {
      return res.json({ status: "error", success: false, message: "No record found for this transaction on source branch" });
    }

    const transaction = await invtDB.transaction();

    try {

      let insert_dt = moment(new Date()).format("YYYY-MM-DD HH:mm:ss");
      const items = remote_data.data;

      // ENSURE A LOCATION FROM THE REMOTE (OAKTER) RESPONSE EXISTS LOCALLY, ELSE CREATE IT WITH SAME KEY
      const ensureLocation = async (location_key, loc_name) => {
        if (!location_key) return;

        const loc_exists = await invtDB.query("SELECT 1 FROM location_main WHERE location_key = :location_key LIMIT 1", {
          replacements: { location_key },
          type: invtDB.QueryTypes.SELECT,
          transaction: transaction,
        });

        if (loc_exists.length == 0) {
          await invtDB.query("INSERT INTO location_main (company_branch, loc_name, location_key, insert_date, inserted_by) VALUES (:branch, :loc_name, :location_key, :insert_date, :inserted_by)", {
            replacements: {
              branch: req.branch,
              loc_name: loc_name ? loc_name : "--",
              location_key: location_key,
              insert_date: insert_dt,
              inserted_by: req.logedINUser,
            },
            type: invtDB.QueryTypes.INSERT,
            transaction: transaction,
          });
        }
      };

      for (let i = 0; i < items.length; i++) {

        const transferType = items[i].transferType ? items[i].transferType : "component";

        // CHECK PICK (loc_out) AND DROP (loc_in) LOCATIONS EXIST LOCALLY
        await ensureLocation(items[i].locOutKey, items[i].locOutName);
        await ensureLocation(items[i].locInKey, items[i].locInName);
        // END CHECK LOCATIONS

        if (transferType === "product") {

          // RESOLVE LOCAL PRODUCT MASTER BY product_key (componentKey is the product_key for FG items)
          const product = await invtDB.query("SELECT p_sku FROM products WHERE product_key = :product_key LIMIT 1", {
            replacements: { product_key: items[i].componentKey },
            type: invtDB.QueryTypes.SELECT,
            transaction: transaction,
          });

          if (product.length == 0) {
            await transaction.rollback();
            return res.json({ status: "error", success: false, message: `Product "${items[i].componentName || items[i].componentKey}" not found in local products master (key: ${items[i].componentKey})` });
          }

          const sku_code = product[0].p_sku;

          // DUPLICATE CHECK — sku_code is the products key-space, separate from RM's components_id key-space
          const already_item = await invtDB.query("SELECT 1 FROM mfg_production_3 WHERE mfg_pro_apr_transaction = :trans_id AND mfg_pro_apr_sku = :sku_code AND type = 'BRANCHTRANSFER' LIMIT 1", {
            replacements: { trans_id: items[i].transId, sku_code },
            type: invtDB.QueryTypes.SELECT,
            transaction: transaction,
          });

          if (already_item.length > 0) continue;

          // INSERT INTO mfg_production_3 (same FG-stock/WAR table used by savefginward — NOT fg_location, which stock/rate calculations don't read)
          await invtDB.query(
            `INSERT INTO mfg_production_3
              (txn_session, company_branch, mfg_pro_apr_sku, mfg_approve_in_qty, in_fg_rate,
               mfg_pro_location_in, fgout_pro_location_out, vendor_type, in_vendor_name,
               mfg_pro_apr_fulldate, mfg_pro_apr_by, fg_out_remark, type, mfg_pro_apr_transaction)
             VALUES
              (:txn_session, :branch, :sku, :qty, :rate,
               :loc_in, :loc_out, :vendor_type, :vendor_code,
               :insert_dt, :insert_by, :remark, 'BRANCHTRANSFER', :trans_id)`,
            {
              replacements: {
                txn_session: helper.generateTxnSession(),
                branch: req.branch,
                sku: sku_code,
                qty: items[i].qty,
                rate: items[i].rate ? items[i].rate : 0,
                loc_in: items[i].locInKey,
                loc_out: items[i].locOutKey,
                vendor_type: "BT",
                vendor_code: items[i].vendorCode ? items[i].vendorCode : "--",
                insert_dt: insert_dt,
                insert_by: req.logedINUser,
                remark: items[i].remark ? items[i].remark : "--",
                trans_id: items[i].transId,
              },
              type: invtDB.QueryTypes.INSERT,
              transaction: transaction,
            }
          );
          // END INSERT INTO mfg_production_3

        } else {

          // DUPLICATE CHECK — components_id is the RM key-space
          const already_item = await invtDB.query("SELECT 1 FROM rm_location WHERE in_transaction_id = :trans_id AND trans_type = 'INWARD' AND components_id = :component LIMIT 1", {
            replacements: { trans_id: items[i].transId, component: items[i].componentKey },
            type: invtDB.QueryTypes.SELECT,
            transaction: transaction,
          });

          if (already_item.length > 0) continue;

          // INSERT RM LOCATION INWARD
          await invtDB.query("INSERT INTO rm_location (company_branch,trans_type,components_id,loc_in,loc_out,qty,any_remark,insert_date,insert_by,in_transaction_id,stock_status,in_po_rate,in_vendor_name,vendor_type) VALUES (:branch,:type,:component,:loc_in,:loc_out,:qty,:remark,:indate,:inby,:in_transaction_id,:stock_status,:in_po_rate,:in_vendor_name,:vendor_type)", {
            replacements: {
              branch: req.branch,
              type: "INWARD",
              component: items[i].componentKey,
              loc_in: items[i].locInKey,
              loc_out: items[i].locOutKey,
              qty: items[i].qty,
              remark: items[i].remark ? items[i].remark : "--",
              indate: insert_dt,
              inby: req.logedINUser,
              in_transaction_id: items[i].transId,
              stock_status: "COMPLETED",
              in_po_rate: items[i].rate ? items[i].rate : 0,
              in_vendor_name: items[i].vendorCode ? items[i].vendorCode : "--",
              vendor_type: "BT",
            },
            type: invtDB.QueryTypes.INSERT,
            transaction: transaction,
          });
          // END INSERT RM LOCATION INWARD

        }

      }// END LOOP

      await transaction.commit();
      return res.json({ status: "success", success: true, message: "Branch Transfer Inward Successfully" });

    }
    catch (err) {
      await transaction.rollback();
      return res.json({ status: "error", success: false, message: "Internal Error!!! If this condition persists, contact your system administrator", debug: process.env.NODE_ENV === 'development' ? err.stack : undefined });
    }

  }
  catch (err) {
    return res.json({ status: "error", success: false, message: "Internal Error!!! If this condition persists, contact your system administrator", debug: process.env.NODE_ENV === 'development' ? err.stack : undefined });
  }

});

module.exports = router
