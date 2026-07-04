let { invtDB } = require("../../../config/db/connection");


const QRCode = require("qrcode");
const htmlToPdf = require("html-pdf-node");
const fs = require("fs");
const Validator = require("validatorjs");

const getLableHtml = require("./label");

const express = require("express");
const router = express.Router();

const auth = require("./../../../middleware/auth");
const permission = require("./../../../middleware/permission");


router.post("/generateBoxLabel", [auth.isAuthorized], async (req, res) => {
  const transaction = await invtDB.transaction();

  try {
    const valid = new Validator(req.body, {
      minId: "required",
      components: "required|array",
    });

    if (valid.fails()) {
      await transaction.rollback();
      return res.json({ success: false, message: helper.firstErrorValidatorjs(valid) });
    }

    if (req.body.components.length > 1) {
      await transaction.rollback();
      return res.json({ success: false, message: "Please select only one component" });
    }

    const valid2 = new Validator(req.body.components[0], {
      componentKey: "required",
      boxes: "required|array",
    });

    if (valid2.fails()) {
      await transaction.rollback();
      return res.json({ success: false, message: helper.firstErrorValidatorjs(valid2) });
    }

    const checkStmt = await invtDB.query("SELECT * FROM tbl_box_lable WHERE bl_min = :bl_min AND bl_component = :bl_component", {
      replacements: {
        bl_min: req.body.minId,
        bl_component: req.body.components[0].componentKey,
      },
      type: invtDB.QueryTypes.SELECT,
    });

    if (checkStmt.length > 0) {
      // await transaction.rollback();
      // return res.json({ success: false, message: "Already generated" });
    } else {
      const bl_key = helper.getUniqueNumber();

      for (let i = 0; i < req.body.components[0].boxes.length; i++) {
        const stmt = await invtDB.query(
          "INSERT INTO tbl_box_lable( bl_key, bl_min, bl_component, bl_minQty, bl_box_avl_qty ,  bl_box, bl_box_qty, bl_createby, bl_insert_dt) VALUES ( :bl_key, :bl_min, :bl_component, :bl_minQty, :bl_box_avl_qty , :bl_box, :bl_box_qty, :bl_createby, :bl_insert_dt )",
          {
            replacements: {
              bl_key: bl_key,
              bl_min: req.body.minId,
              bl_component: req.body.components[0].componentKey,
              bl_minQty: req.body.components[0].minQty,
              bl_box: req.body.components[0].boxes[i].label,
              bl_box_qty: req.body.components[0].boxes[i].qty,
              bl_box_avl_qty: req.body.components[0].boxes[i].qty,
              bl_createby: req.logedINUser,
              bl_insert_dt: moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
            },
            type: invtDB.QueryTypes.INSERT,
            transaction: transaction,
          }
        );
      }
    }

    // GET MINDATA

    let minDataStmt = await invtDB.query(
      "SELECT location_main.loc_name, rm_location.insert_date , rm_location.in_vendor_name, rm_location.in_transaction_id, rm_location.qty, rm_location.components_id, cost_center.cost_center_name, project_master.project_name , project_master.project_description FROM rm_location LEFT JOIN po_purchase_req ON po_purchase_req.po_part_no = rm_location.components_id AND po_purchase_req.po_transaction = rm_location.in_po_transaction_id LEFT JOIN cost_center ON cost_center.cost_center_key = po_purchase_req.po_cost_center LEFT JOIN project_master ON project_master.project_name = po_purchase_req.po_project_name LEFT JOIN location_main ON rm_location.loc_in = location_main.location_key WHERE rm_location.in_transaction_id = :min_transaction_id AND rm_location.trans_type = 'INWARD' AND rm_location.components_id = :components ",
      {
        replacements: {
          min_transaction_id: req.body.minId,
          components: req.body.components[0].componentKey,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (minDataStmt.length == 0) {
      await transaction.rollback();
      return res.json({ success: false, message: "MIN data not found!!!" });
    }

    let compDataStmt = await invtDB.query(
      "SELECT `c_part_no`,`c_name`,`c_uom`,`units_name`,`component_key` , pia_status FROM `components` LEFT JOIN `units` ON `units`.`units_id` = `components`.`c_uom` WHERE `components`.`component_key` = :component_key",
      {
        replacements: { component_key: req.body.components[0].componentKey },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (compDataStmt.length == 0) {
      await transaction.rollback();
      return res.json({ success: false, message: "Component data not found!!!" });
    }
    if (compDataStmt[0].pia_status != "Y") {
      await transaction.rollback();
      return res.json({ success: false, message: "Component is not approved!!!" });
    }

    // GET COMPONENT DATA
    let minData = {
      "MIN ID": minDataStmt[0].in_transaction_id,
      "MIN Qty": minDataStmt[0].qty,
	   "MIN Loc": minDataStmt[0].loc_name,
      "MIN Date": moment(minDataStmt[0].insert_date).format("DD-MM-YYYY"),
      "PRJ ID": minDataStmt[0].project_name,
      "Cost Center": minDataStmt[0].cost_center_name,
      "Part Code": compDataStmt[0].c_part_no,
      "Part Name": compDataStmt[0].c_name,
      part_uom: compDataStmt[0].units_name,
      component_key: compDataStmt[0].component_key,
      "Vendor Name": "N/A",
      "Vendor Code": "N/A",
    };

    if (minDataStmt[0].in_vendor_name != "--" && minDataStmt[0].in_vendor_name != "") {
      let stmt3 = await invtDB.query("SELECT * from `ven_basic_detail` WHERE `ven_register_id` = :vendor_code", {
        replacements: { vendor_code: minDataStmt[0].in_vendor_name },
        type: invtDB.QueryTypes.SELECT,
      });
      if (stmt3.length > 0) {
        minData["Vendor Name"] = stmt3[0].ven_name;
        minData["Vendor Code"] = stmt3[0].ven_register_id;
      }
    }

    // PRINT LABLE

    let body = "";
    for (let i = 0; i < req.body.components[0].boxes.length; i++) {
      let data = { ...minData, ...req.body.components[0].boxes[i] };
      // console.log(data);

      let qr_data = JSON.stringify(data);
      let img = await QRCode.toDataURL(qr_data);
      data = { ...data, totalBox: req.body.components[0].boxes.length };

      if (i % 2 == 0) {
        body += "<tr>";
      }
      body += getLableHtml.getBoxLableBodyHtml(data, img);
      if (i % 2 != 0) {
        body += "</tr>";
      }
    }

    // HTML TO PDF
    let head = getLableHtml.getHeaderHtml();
    let footer = getLableHtml.getFooterHtml();
    let options = { format: "A4" };
    let file = { content: head + body + footer };
    let pdfBuffer = await htmlToPdf.generatePdf(file, options);

    await transaction.commit();

    // const fs = require("fs");
    // fs.writeFileSync("LP.pdf", pdfBuffer);

    return res.json({
      message: "Label Generated..",
      success: true,
      data: {
        buffer: pdfBuffer,
        filename: "BOX_" + req.body.transaction + ".pdf",
      },
    });
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

router.post("/fetchBoxDetails", [auth.isAuthorized], async (req, res) => {
  try {
    const valid = new Validator(req.body, {
      minId: "required",
      box: "required",
    });

    if (valid.fails()) {
      return res.json({ success: false, message: helper.firstErrorValidatorjs(valid) });
    }

    const stmt = await invtDB.query(
      "SELECT tbl_box_lable.* , components.c_name , components.c_part_no FROM tbl_box_lable LEFT JOIN components ON components.component_key = tbl_box_lable.bl_component  WHERE bl_min = :bl_min AND bl_box = :bl_box",
      {
        replacements: {
          bl_min: req.body.minId,
          bl_box: req.body.box,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length == 0) {
      return res.json({ success: false, message: "Box not found!!!" });
    }

    let minDataStmt = await invtDB.query(
      "SELECT rm_location.insert_date , rm_location.in_vendor_name, rm_location.in_transaction_id, rm_location.qty, rm_location.components_id, cost_center.cost_center_name, project_master.project_name , project_master.project_description FROM rm_location LEFT JOIN po_purchase_req ON po_purchase_req.po_part_no = rm_location.components_id AND po_purchase_req.po_transaction = rm_location.in_po_transaction_id LEFT JOIN cost_center ON cost_center.cost_center_key = po_purchase_req.po_cost_center LEFT JOIN project_master ON project_master.project_name = po_purchase_req.po_project_name WHERE rm_location.in_transaction_id = :min_transaction_id AND rm_location.trans_type = 'INWARD' AND rm_location.components_id = :components ",
      {
        replacements: {
          min_transaction_id: req.body.minId,
          components: stmt[0].bl_component,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    // console.log(stmt);
    // console.log(minDataStmt);

    let vendorName = "--";
    let vendorCode = "--";

    if (minDataStmt[0].in_vendor_name != "--" && minDataStmt[0].in_vendor_name != "") {
      let stmt3 = await invtDB.query("SELECT * from `ven_basic_detail` WHERE `ven_register_id` = :vendor_code", {
        replacements: { vendor_code: minDataStmt[0].in_vendor_name },
        type: invtDB.QueryTypes.SELECT,
      });
      if (stmt3.length > 0) {
        vendorName = stmt3[0].ven_name;
        vendorCode = stmt3[0].ven_register_id;
      }
    }

    const data = {
      minId: stmt[0].bl_min,
      minQty: minDataStmt[0].qty,
      minDate: moment(minDataStmt[0].insert_date).format("DD-MM-YYYY"),
      prjId: minDataStmt[0].project_name,
      costCenter: minDataStmt[0].cost_center_name,
      partCode: stmt[0].c_part_no,
      partName: stmt[0].c_name,
      box: stmt[0].bl_box,
      qty: stmt[0].bl_box_qty,
      avlQty: stmt[0].bl_box_avl_qty,
      vendorName: vendorName,
      vendorCode: vendorCode,
      boxCreateDt: moment(stmt[0].bl_insert_dt).format("DD-MM-YYYY"),
    };

    return res.json({ success: true, data: data });
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// VERIFY QTY
router.post("/getComponetQty", [auth.isAuthorized], async (req, res) => {
  try {
    const valid = new Validator(req.body, {
      component: "required",
    });

    if (valid.fails()) {
      return res.json({ success: false, message: helper.firstErrorValidatorjs(valid) });
    }

    // Q5 RM Locations
    let stmtLocations = await invtDB.query("SELECT locations FROM `location_allotted` WHERE `loc_all_key` = :location_key", {
      replacements: { location_key: "2023112717950595" },
      type: invtDB.QueryTypes.SELECT,
    });

    let all_branch__location = [];
    if (stmtLocations.length > 0) {
      for (let loc_i = 0; loc_i < stmtLocations.length; loc_i++) {
        all_branch__location = stmtLocations[loc_i].locations.split(",");
      }
    } else {
      return res.json({ status: "error", success: false, message: "Branch Location Not Found, contact to administrator" });
    }

    //ALL INWARD
    let stmt6 = await invtDB.query(
      "SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Inward` FROM `rm_location` WHERE `components_id` = :component AND trans_type IN ('INWARD' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND `loc_in` IN (:location)",
      {
        replacements: {
          component: req.body.component,
          location: all_branch__location,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    let inward_all_qty = 0;
    if (stmt6.length > 0) {
      inward_all_qty = helper.number(stmt6[0].Inward);
    }

    // ALL OUTWARD
    let stmt7 = await invtDB.query(
      "SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Outward` FROM `rm_location` WHERE `components_id` = :component AND trans_type IN ('CONSUMPTION' , 'ISSUE' , 'JOBWORK' , 'REJECTION' , 'TRANSFER') AND `loc_out` IN (:location)",
      {
        replacements: {
          component: req.body.component,
          location: all_branch__location,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    let outward_all_qty = 0;
    if (stmt7.length > 0) {
      outward_all_qty = helper.number(stmt7[0].Outward);
    }

    return res.json({ success: true, data: { stock: helper.number(inward_all_qty - outward_all_qty) } });

    // END
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// UPDATE AVAIL QTY
router.post("/updateAvailQty", [auth.isAuthorized], async (req, res) => {
  const transaction = await invtDB.transaction();
  try {
    const valid = new Validator(req.body, {
      minId: "required|array",
      box: "required|array",
      avlQty: "required|array",
      component: "required",
      is_open: "required|array",
      imsQty: "required",
      remark: "required",
    });

    if (valid.fails()) {
      await transaction.rollback();
      return res.json({ success: false, message: helper.firstErrorValidatorjs(valid) });
    }

    // VALIDAT SAME BOX MULTIPLE TIME

    const boxes = req.body.box;
    const minIds = req.body.minId;
    const avls = req.body.avlQty;

    if (boxes.length !== avls.length || minIds.length !== avls.length) {
      await transaction.rollback();
      return res.json({ success: false, message: "Please Enter Valid Data" });
    }

    const totalAvlQty = avls.reduce((a, b) => Number(a) + Number(b));

    if (req.body.imsQty != totalAvlQty) {
      await transaction.rollback();
      return res.json({ success: false, message: "Qty Not Match!" });
    }

    function hasDuplicates(arr) {
      return new Set(arr).size !== arr.length;
    }

    // if (hasDuplicates(minIds)) {
    //   await transaction.rollback();
    //   return res.json({ success: false, message: "Duplicate Min Id Not Allowed" });
    // }

    // if (hasDuplicates(boxes)) {
    //   await transaction.rollback();
    //   return res.json({ success: false, message: "Duplicate Box Not Allowed" });
    // }

    // ///////////////////////
    let trnStmt = await invtDB.query("SELECT audit_ref_id FROM ims_rm_audit GROUP BY audit_ref_id ORDER BY ID DESC LIMIT 1", {
      type: invtDB.QueryTypes.SELECT,
    });
    let transactionCode;

    if (trnStmt.length > 0) {
      transactionCode = trnStmt[0].audit_ref_id;
      let strings = transactionCode.replace(/[0-9]/g, "");
      let digits = (helper.number(transactionCode.replace(/[^0-9]/g, "")) + 1).toString();
      if (digits.length < 3) digits = ("000" + digits).substr(-3);
      transactionCode = strings + digits;
    } else {
      transactionCode = "AUD001";
    }
    // ///////////////////////

    let stmt1 = await invtDB.query(
      "INSERT INTO  ims_rm_audit  ( company_branch , isPia , component_key , closing_qty , audit_qty , audit_dt , audit_by , audit_ref_id , audit_remark )VALUES (:branch , :isPia , :part, :closing, :audit, :date, :by, :transaction, :remark)",
      {
        replacements: {
          branch: req.branch,
          isPia: 1,
          part: req.body.component,
          closing: helper.number(req.body.imsQty),
          audit: totalAvlQty,
          date: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
          by: req.logedINUser,
          transaction: transactionCode,
          remark: req.body.remark,
        },
        type: invtDB.QueryTypes.INSERT,
        transaction: transaction,
      }
    );

    for (let i = 0; i < boxes.length; i++) {
      const valid = new Validator(
        {
          minId: minIds[i],
          box: boxes[i],
          avlQty: avls[i],
          is_open: req.body.is_open[i],
        },
        {
          minId: "required",
          box: "required",
          avlQty: "required",
          is_open: "required|in:true,false",
        }
      );

      if (valid.fails()) {
        await transaction.rollback();
        return res.json({ success: false, message: helper.firstErrorValidatorjs(valid) });
      }

      const stmt = await invtDB.query(
        "UPDATE tbl_box_lable SET bl_box_avl_qty = :bl_box_avl_qty, bl_box_is_open = :bl_box_is_open , bl_update_by = :bl_update_by , bl_update_dt = :bl_update_dt , bl_rm_audit_ref = :bl_rm_audit_ref WHERE bl_min = :bl_min AND bl_box = :bl_box AND bl_component = :bl_component",
        {
          replacements: {
            bl_box_avl_qty: req.body.avlQty[i],
            bl_box_is_open: req.body.is_open[i],
            bl_min: req.body.minId[i],
            bl_box: req.body.box[i],
            bl_component: req.body.component,
            bl_update_by: req.logedINUser,
            bl_update_dt: moment(new Date()).format("YYYY-MM-DD HH:mm:ss"),
            bl_rm_audit_ref: transactionCode,
          },
          transaction: transaction,
        }
      );

      if (stmt[0].affectedRows < 1) {
        await transaction.rollback();
        return res.json({ success: false, message: "There is no changes!!!" });
      }
    }

    await transaction.commit();

    return res.json({ success: true, message: "Updated Successfully" });
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

module.exports = router;
