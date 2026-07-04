const express = require("express");
const router = express.Router();


const auth = require("../../../../middleware/auth");
const permission = require("../../../../middleware/permission");

let { invtDB } = require("../../../../config/db/connection");


const htmlToPdf = require("html-pdf-node");
const fs = require("fs");

const Validator = require("validatorjs");

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



module.exports = router
