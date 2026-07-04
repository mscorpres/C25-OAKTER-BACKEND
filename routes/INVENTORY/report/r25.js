let { invtDB, otherDB } = require("../../../config/db/connection");

const express = require("express");
const router = express.Router();

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");
const Validator = require("validatorjs");

checkNegativeValue = (value) => {
  return value < 0 ? 0 : value;
};

// CREATE REPORT
router.post("/createR25Report", [auth.isAuthorized], async (req, res) => {
  try {
    const validation = new Validator(req.body, {
      parts: "required:array",
      qty: "required",
      report_name: "required",

    });

    if (validation.fails()) {
      return res.status(400).json({ status: "error", success: false, message: validation.errors.all() });
    }

    // CHECK PART AND QTY
    let parts = req.body.parts;
    let qty = req.body.qty;

    if (parts.length != qty.length) {
      return res.status(400).json({ status: "error", success: false, message: "Parts and Quantity should be same" });
    }

    for (let i = 0; i < parts.length; i++) {

      let valid = new Validator({
        part: parts[i],
        qty: qty[i],
      },
        {
          part: "required",
          qty: "required",
        }
      );

      if (valid.fails()) {
        return res.status(400).json({ status: "error", success: false, message: "Parts and Quantity should not be empty" });
      }
    }

    const stmt_check = await otherDB.query("SELECT * FROM invt_r25 WHERE report_name = :report_name ", {
      replacements: {
        report_name: req.body.report_name,
      },
      type: otherDB.QueryTypes.SELECT
    });

    if (stmt_check.length > 0) {
      return res.status(400).json({ status: "error", success: false, message: "Report name already exists" });
    }

    let new_key = helper.getUniqueNumber();

    const result = await otherDB.query("INSERT INTO invt_r25 (report_id, report_name, user_id, parts, part_qty , insert_dt) VALUES (:report_id, :report_name, :user_id, :parts, :part_qty, :insert_dt)", {
      replacements: {
        report_id: new_key,
        report_name: req.body.report_name,
        user_id: req.logedINUser,
        parts: req.body.parts.join(","),
        part_qty: req.body.qty.join(","),
        insert_dt: moment(new Date()).format("YYYY-MM-DD HH:mm:ss"),
      },
      type: otherDB.QueryTypes.INSERT
    });

    if (result.length > 0) {
      return res.status(200).json({ status: "success", success: true, message: "Report created successfully" });
    } else {
      return res.status(500).json({ status: "error", success: false, message: "Internal Error!!! If this condition persists, contact your system administrator" });
    }

  }
  catch (err) {
      return helper.errorResponse(res, err);
  }
});

// FETCH REPORT NAME OPTION USER WISE
router.post("/fetchR25ReportName", [auth.isAuthorized], async (req, res) => {
  try {

    const valid = new Validator(req.body, {
      search: "required",
    });

    let stmt;

    if (valid.fails()) {
      stmt = await otherDB.query("SELECT report_name AS text , report_id AS id  FROM invt_r25 WHERE user_id = :user_id", {
        replacements: {
          user_id: req.logedINUser
        },
        type: otherDB.QueryTypes.SELECT
      })
    } else {
      stmt = await otherDB.query("SELECT report_name , report_id  FROM invt_r25 WHERE user_id = :user_id AND report_name LIKE :search", {
        replacements: {
          user_id: req.logedINUser,
          search: `%${req.body.search}%`
        },
        type: otherDB.QueryTypes.SELECT
      })
    }

    if (stmt.length > 0) {
      return res.status(200).json({ status: "success", success: true, message: "Report names fetched", data: stmt });
    } else {
      return res.status(404).json({ status: "error", success: false, message: "No data found" });
    }


  } catch (err) {
      return helper.errorResponse(res, err);
  }
})

// EDIT REPORT
router.post("/editR25Report", [auth.isAuthorized], async (req, res) => {
  try {
    const validation = new Validator(req.body, {
      report_id: "required",
    });

    if (validation.fails()) {
      return res.status(400).json({ status: "error", success: false, message: validation.errors.all() });
    }

    const stmt = await otherDB.query("SELECT parts, part_qty, report_name, report_id FROM invt_r25 WHERE report_id = :report_id AND user_id = :user_id ", {
      replacements: {
        report_id: req.body.report_id,
        user_id: req.logedINUser
      },
      type: otherDB.QueryTypes.SELECT
    });

    if (stmt.length > 0) {

      const part_str = stmt[0].parts;
      const qty_str = stmt[0].part_qty;

      let parts = part_str.split(",");
      let qty = qty_str.split(",");

      const parts_data = [];
      for (let i = 0; i < parts.length; i++) {
        const stmt_comp = await invtDB.query("SELECT c_name , c_part_no FROM components WHERE component_key = :components_key", {
          replacements: { components_key: parts[i] },
          type: invtDB.QueryTypes.SELECT
        });
        parts_data.push({
          id: parts[i],
          text: stmt_comp[0].c_name + " ( " + stmt_comp[0].c_part_no + " )",
        })

      }


      return res.status(200).json({ status: "success", success: true, message: "Report fetched", data: { parts: parts_data, qty: qty, report: { label: stmt[0].report_name, value: stmt[0].report_id } } });

    }



  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// UPDATE REPORT
router.post("/updateR25Report", [auth.isAuthorized], async (req, res) => {
  try {
    const validation = new Validator(req.body, {
      report_id: "required",
      parts: "required|array",
      qty: "required|array",
    });

    if (validation.fails()) {
      return res.status(400).json({ status: "error", success: false, message: validation.errors.all() });
    }

    // CHECK PART AND QTY
    let parts = req.body.parts;
    let qty = req.body.qty;

    if (parts.length != qty.length) {
      return res.status(400).json({ status: "error", success: false, message: "Parts and Quantity should be same" });
    }

    for (let i = 0; i < parts.length; i++) {
      let valid = new Validator({
        part: parts[i],
        qty: qty[i],
      },
        {
          part: "required",
          qty: "required",
        }
      );

      if (valid.fails()) {
        return res.status(400).json({ status: "error", success: false, message: "Parts and Quantity should not be empty" });
      }

    }

    const result = await otherDB.query("UPDATE invt_r25 SET parts = :parts , part_qty = :part_qty WHERE report_id = :report_id AND user_id = :user_id", {
      replacements: {
        parts: req.body.parts.join(","),
        part_qty: req.body.qty.join(","),
        report_id: req.body.report_id,
        user_id: req.logedINUser
      },
      type: otherDB.QueryTypes.UPDATE
    });

    if (result.length > 0) {
      return res.status(200).json({ status: "success", success: true, message: "Report updated successfully" });
    } else {
      return res.status(500).json({ status: "error", success: false, message: "Internal Error!!! If this condition persists, contact your system administrator" });
    }


  } catch (err) {
      return helper.errorResponse(res, err);
  }

});

// FETCH REPORT
router.post("/", [auth.isAuthorized], async (req, res) => {
  try {
    const valid = new Validator(req.body, {
      report_id: "required",
      product_fg_qty: "required",
    });

    if (valid.fails()) {
      return res.status(400).json({ status: "error", success: false, message: valid.errors.all() });
    }

    const result = await otherDB.query("SELECT * FROM invt_r25 WHERE report_id = :report_id", {
      replacements: {
        report_id: req.body.report_id
      },
      type: otherDB.QueryTypes.SELECT
    });

    if (result.length <= 0) {
      return res.status(404).json({ status: "error", success: false, message: "Report not found" });
    }

    const parts_arr = result[0].parts.split(",");
    const part_qty_arr = result[0].part_qty.split(",");

    const length = parts_arr.length;

    //RM Locations
    let stmt_get_rm_loc = await invtDB.query("SELECT locations FROM location_allotted WHERE loc_all_key = :location_key", {
      replacements: { location_key: "20239259491700" },
      type: invtDB.QueryTypes.SELECT,
    });

    let all_rmlocation = [];
    if (stmt_get_rm_loc.length > 0) {
      for (let loc_i = 0; loc_i < stmt_get_rm_loc.length; loc_i++) {
        all_rmlocation = stmt_get_rm_loc[loc_i].locations.split(",");
      }
    } else {
      return res.json({ status: "error", success: false, message: "RM Location Not Found, contact to administrator" });
    }
    // RM LOCATION END

    // SF LOCATION
    let stmt_get_sf = await invtDB.query("SELECT locations FROM `location_allotted` WHERE `loc_all_key` = :location_key", {
      replacements: { location_key: "202391817340454" },
      type: invtDB.QueryTypes.SELECT,
    });

    let sf_locations = [];
    if (stmt_get_sf.length > 0) {
      for (let loc_i = 0; loc_i < stmt_get_sf.length; loc_i++) {
        sf_locations = stmt_get_sf[loc_i].locations.split(",");
      }
    } else {
      return res.json({ status: "error", success: false, message: "Branch Location Not Found, contact to administrator" });
    }
    // SF LOCATION END

    let data = [];
    for (let i = 0; i < length; i++) {
      // // PPR
      const getRequiredCom = await otherDB.query(`SELECT A.c_part_no, A.c_name, A.component_key, B.project_ppr_sku, COALESCE(SUM(B.project_requirement), 0) as total_requirement, COALESCE(SUM(B.executed_qty), 0) as total_executed FROM ${global.ims_db_name}.components A JOIN ${global.other_db_name}.invt_projects B ON A.component_key = B.project_rm WHERE B.project_rm = :comonents_key AND B.status !='C' GROUP BY B.project_rm`, {
        replacements: { comonents_key: parts_arr[i] },
        type: otherDB.QueryTypes.SELECT
      });

      let ppr_plan_qty = 0, ppr_consupt_qty = 0;
      if (getRequiredCom.length > 0) {
        ppr_plan_qty = getRequiredCom[0].total_requirement;
        ppr_consupt_qty = getRequiredCom[0].total_executed;
      } else {
        ppr_plan_qty = 0, ppr_consupt_qty = 0;
      }

      // const getComsumpCom = await invtDB.query("SELECT COALESCE(SUM(`qty`), 0) AS `totalConsumpQTY` FROM rm_location WHERE components_id = :comonents_key AND trans_type ='CONSUMPTION'", {
      //   replacements: { comonents_key: parts_arr[i] },
      //   type: invtDB.QueryTypes.SELECT
      // });

      // let ppr_consupt_qty = 0;
      // if (getComsumpCom.length > 0) {
      //   ppr_consupt_qty = getComsumpCom[0].totalConsumpQTY;
      // } else {
      //   ppr_consupt_qty = 0;
      // }

      let ppr_qty = Number(ppr_plan_qty) - Number(ppr_consupt_qty);


      // COMPONENT DATA 
      const stmt_comp = await invtDB.query("SELECT c_name , c_part_no , c_new_part_no , units_name FROM components LEFT JOIN units ON components.c_uom = units.units_id WHERE component_key = :components_key", {
        replacements: { components_key: parts_arr[i] },
        type: invtDB.QueryTypes.SELECT
      })

      if (stmt_comp.length <= 0) {
        return res.status(404).json({ status: "error", success: false, message: "Component Not Found, contact to administrator" });
      }

      // RM STOCK
      let Rm_stmt = await invtDB.query(
        "SELECT (SELECT COALESCE(SUM(qty+other_qty), 0) AS Inward FROM rm_location WHERE components_id = :component AND loc_in IN (:location) AND DATE_FORMAT(insert_date,'%Y-%m-%d') = :date AND trans_type IN ('INWARD', 'ISSUE', 'JOBWORK', 'REJECTION', 'TRANSFER')) as inward, (SELECT COALESCE(SUM(qty+other_qty), 0) AS Outward FROM rm_location WHERE components_id = :component AND loc_out IN (:location) AND DATE_FORMAT(insert_date,'%Y-%m-%d') = :date AND trans_type IN ('CONSUMPTION', 'ISSUE', 'JOBWORK', 'REJECTION', 'TRANSFER')) as outward, (SELECT COALESCE(SUM(QTY), 0) AS OpeningBalance FROM ( SELECT qty QTY FROM rm_location CR WHERE CR.components_id = :component AND CR.loc_in IN (:location) AND DATE_FORMAT(CR.insert_date, '%Y-%m-%d') < :date AND CR.trans_type IN ('INWARD','TRANSFER','ISSUE','REJECTION','JOBWORK') UNION ALL SELECT - COALESCE(SUM(qty + other_qty), 0) QTY FROM rm_location DR WHERE DR.components_id = :component AND DR.loc_out IN (:location) AND DATE_FORMAT(DR.insert_date, '%Y-%m-%d') < :date AND DR.trans_type IN ('ISSUE','REJECTION','JOBWORK','TRANSFER')) t) as OpeningBalance FROM DUAL",
        {
          replacements: {
            component: parts_arr[i],
            location: all_rmlocation,
            date: moment(new Date()).format("YYYY-MM-DD"),
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      let Rm_inward_all_qty = 0, Rm_outward_all_qty = 0, Rm_opening_qty = 0;
      if (Rm_stmt.length > 0) {
        Rm_inward_all_qty = Rm_stmt[0].inward;
        Rm_outward_all_qty = Rm_stmt[0].outward;
        Rm_opening_qty = Rm_stmt[0].OpeningBalance;
      }
      // END RM STOCK

      // SF STOCK
      let Sf_stmt = await invtDB.query(
        "SELECT COALESCE( SUM( CASE WHEN trans_type IN('INWARD', 'ISSUE', 'JOBWORK', 'REJECTION') AND loc_in IN (:location) AND DATE_FORMAT( insert_date, '%Y-%m-%d' ) = :date THEN qty ELSE 0 END ), 0 ) AS inward, COALESCE( SUM( CASE WHEN trans_type IN( 'ISSUE', 'JOBWORK', 'REJECTION', 'CONSUMPTION' ) AND loc_out IN (:location) AND DATE_FORMAT( insert_date, '%Y-%m-%d' ) = :date THEN qty ELSE 0 END ), 0 ) AS outward, COALESCE( SUM( CASE WHEN trans_type IN('INWARD', 'ISSUE', 'JOBWORK', 'REJECTION', 'TRANSFER') AND loc_in IN (:location) AND DATE_FORMAT( insert_date, '%Y-%m-%d' ) < :date THEN qty ELSE 0 END ), 0 ) - COALESCE( SUM( CASE WHEN trans_type IN( 'ISSUE', 'JOBWORK', 'REJECTION', 'TRANSFER', 'CONSUMPTION' ) AND loc_out IN (:location) AND DATE_FORMAT( insert_date, '%Y-%m-%d' ) < :date THEN qty ELSE 0 END ), 0 ) AS OpeningBalance  FROM rm_location WHERE components_id = :component ",
        {
          replacements: {
            component: parts_arr[i],
            location: sf_locations,
            date: moment(new Date()).format("YYYY-MM-DD"),
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      let Sf_inward_all_qty = 0, Sf_outward_all_qty = 0, Sf_opening_qty = 0;
      if (Sf_stmt.length > 0) {
        Sf_inward_all_qty = Sf_stmt[0].inward;
        Sf_outward_all_qty = Sf_stmt[0].outward;
        Sf_opening_qty = Sf_stmt[0].OpeningBalance;
      }
      // END SF STOCK

      //PO INTRANSIT
      let stmt_po_intransit = await invtDB.query("SELECT COALESCE(SUM(po_order_qty),0) totalReq_Qty, COALESCE(SUM(po_inward_qty),0) Inward FROM po_purchase_req WHERE (po_part_no = :component) AND (po_status = 'A' OR po_status = 'C' AND po_inward_qty != 0)", {
        replacements: {
          component: parts_arr[i]
        },
        type: invtDB.QueryTypes.SELECT
      });
      let po_transit = stmt_po_intransit[0].totalReq_Qty > stmt_po_intransit[0].Inward ? helper.number(stmt_po_intransit[0].totalReq_Qty - stmt_po_intransit[0].Inward) : 0;
      // END PO INTRANSIT

      let db_qty = part_qty_arr[i];
      let rm_stock = Rm_opening_qty + Rm_inward_all_qty - Rm_outward_all_qty;
      let sf_stock = Number(Sf_opening_qty + Sf_inward_all_qty) - Sf_outward_all_qty;
      let reqStock = db_qty * req.body.product_fg_qty;
      let free_qty = rm_stock + sf_stock + po_transit - (ppr_qty);

      data.push({
        serial_no: i + 1,
        partno: stmt_comp[0].c_part_no,
        part_no_new : stmt_comp[0].c_new_part_no,
        components: stmt_comp[0].c_name,
        currentStock: rm_stock,
        reqStock: reqStock,
        uom: stmt_comp[0].units_name,
        bomqty: db_qty,
        sf_qty: helper.number(sf_stock),
        ppr_qty: ppr_qty,
        po_intransit: po_transit,
        free_qty: helper.number(free_qty),
        new_order_qty: helper.number(reqStock - free_qty)
      });


    } // LOOP END

    return res.status(200).json({ status: "success", success: true, message: "Report generated successfully", data: data });


  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

// FETCH REPORT
router.post("/old", [auth.isAuthorized], async (req, res) => {
  try {
    if (req.body.skucode == "") {
      res.json({
        status: "error",
        message: "Please supply product",
        code: "500",
      });
      return;
    }
    if (req.body.subjectcode == "") {
      res.json({
        status: "error",
        message: "Please supply product BOM [Bill of Material]",
        code: "500",
      });
      return;
    }
    if (req.body.product_fg_qty == "") {
      res.json({
        status: "error",
        message: "Please supply product FG Qty",
        code: "500",
      });
      return;
    }

    let stmt1 = await invtDB.query("SELECT * FROM `bom_recipe` WHERE `bom_product_sku` = :skucode AND `subject_id` = :subjectcode", {
      replacements: {
        skucode: req.body.skucode,
        subjectcode: req.body.subjectcode,
      },
      type: invtDB.QueryTypes.SELECT,
    });
    if (stmt1.length > 0) {
      let stmt2 = await invtDB.query(
        "SELECT * FROM `bom_quantity` LEFT JOIN `components` ON `bom_quantity`.`component_id` = `components`.`component_key` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` WHERE `bom_quantity`.`product_sku` = :skucode AND `bom_quantity`.`subject_under` = :subject_id AND (`bom_quantity`.`bom_status` = 'A' OR `bom_quantity`.`bom_status` = 'ALT')",
        {
          replacements: {
            skucode: req.body.skucode,
            subject_id: req.body.subjectcode,
          },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      if (stmt2.length > 0) {


        // A21 RM Locations
        let stmt_get_rm_loc = await invtDB.query("SELECT locations FROM location_allotted WHERE loc_all_key = :location_key", {
          replacements: { location_key: "20239259491700" },
          type: invtDB.QueryTypes.SELECT,
        });

        let all_rmlocation = [];
        if (stmt_get_rm_loc.length > 0) {
          for (let loc_i = 0; loc_i < stmt_get_rm_loc.length; loc_i++) {
            all_rmlocation = stmt_get_rm_loc[loc_i].locations.split(",");
          }
        } else {
          return res.json({ status: "error", success: false, message: "RM Location Not Found, contact to administrator" });
        }
        // END


        let stmt_get_sf = await invtDB.query("SELECT locations FROM `location_allotted` WHERE `loc_all_key` = :location_key", {
          replacements: { location_key: "202391817340454" },
          type: invtDB.QueryTypes.SELECT,
        });

        let sf_locations = [];
        if (stmt_get_sf.length > 0) {
          for (let loc_i = 0; loc_i < stmt_get_sf.length; loc_i++) {
            sf_locations = stmt_get_sf[loc_i].locations.split(",");
          }
        } else {
          return res.json({ status: "error", success: false, message: "Branch Location Not Found, contact to administrator" });
        }

        // PPR QUERY
        const stmt_ppr_plan_qty = await invtDB.query("SELECT COALESCE(SUM(prod_planned_qty), 0) AS totalReqQTY , COALESCE(SUM(prod_executed_qty), 0) AS totalConsumpQTY FROM mfg_production_1 WHERE prod_planned_qty !=  prod_executed_qty AND  mfg_production_1.phase1_status = 'A' AND prod_product_sku = :sku ", {
          replacements: {
            sku: req.body.skucode,
          },
          type: invtDB.QueryTypes.SELECT
        });

        let ppr_plan_qty = 0;
        let ppr_consupt_qty = 0;
        if (stmt_ppr_plan_qty.length > 0) {
          ppr_plan_qty = stmt_ppr_plan_qty[0].totalReqQTY;
          ppr_consupt_qty = stmt_ppr_plan_qty[0].totalConsumpQTY;
        }

        let ppr_qty = 0;

        if (Number(ppr_plan_qty) > Number(ppr_consupt_qty)) {
          ppr_qty = Number(ppr_plan_qty) - helper.number(ppr_consupt_qty);
        }

        // END PPR QUERY

        const data = [];
        count = 0;
        srno = 0;
        stmt2.map(async (item) => {

          let Rm_stmt = await invtDB.query(
            "SELECT (SELECT COALESCE(SUM(qty+other_qty), 0) AS Inward FROM rm_location WHERE components_id = :component AND loc_in IN (:location) AND DATE_FORMAT(insert_date,'%Y-%m-%d') = :date AND trans_type IN ('INWARD', 'ISSUE', 'JOBWORK', 'REJECTION', 'TRANSFER')) as inward, (SELECT COALESCE(SUM(qty+other_qty), 0) AS Outward FROM rm_location WHERE components_id = :component AND loc_out IN (:location) AND DATE_FORMAT(insert_date,'%Y-%m-%d') = :date AND trans_type IN ('CONSUMPTION', 'ISSUE', 'JOBWORK', 'REJECTION', 'TRANSFER')) as outward, (SELECT COALESCE(SUM(QTY), 0) AS OpeningBalance FROM ( SELECT qty QTY FROM rm_location CR WHERE CR.components_id = :component AND CR.loc_in IN (:location) AND DATE_FORMAT(CR.insert_date, '%Y-%m-%d') < :date AND CR.trans_type IN ('INWARD','TRANSFER','ISSUE','REJECTION','JOBWORK') UNION ALL SELECT - COALESCE(SUM(qty + other_qty), 0) QTY FROM rm_location DR WHERE DR.components_id = :component AND DR.loc_out IN (:location) AND DATE_FORMAT(DR.insert_date, '%Y-%m-%d') < :date AND DR.trans_type IN ('ISSUE','REJECTION','JOBWORK','TRANSFER')) t) as OpeningBalance FROM DUAL",
            {
              replacements: {
                component: item.component_key,
                location: all_rmlocation,
                date: moment(new Date()).format("YYYY-MM-DD"),
              },
              type: invtDB.QueryTypes.SELECT,
            }
          );

          let Rm_inward_all_qty = 0, Rm_outward_all_qty = 0, Rm_opening_qty = 0;
          if (Rm_stmt.length > 0) {
            Rm_inward_all_qty = Rm_stmt[0].inward;
            Rm_outward_all_qty = Rm_stmt[0].outward;
            Rm_opening_qty = Rm_stmt[0].OpeningBalance;
          }

          if (item.qty * req.body.product_fg_qty > Rm_inward_all_qty - Rm_outward_all_qty) {

            // SELECT (SELECT COALESCE(SUM(qty+other_qty), 0) AS Inward FROM rm_location WHERE components_id = :component AND loc_in IN (:location) AND DATE_FORMAT(insert_date,'%Y-%m-%d') = :date AND trans_type IN ('INWARD', 'ISSUE', 'JOBWORK', 'REJECTION', 'TRANSFER')) as inward, (SELECT COALESCE(SUM(qty+other_qty), 0) AS Outward FROM rm_location WHERE components_id = :component AND loc_out IN (:location) AND DATE_FORMAT(insert_date,'%Y-%m-%d') = :date AND trans_type IN ('CONSUMPTION', 'ISSUE', 'JOBWORK', 'REJECTION', 'TRANSFER')) as outward, (SELECT COALESCE(SUM(QTY), 0) AS OpeningBalance FROM ( SELECT qty QTY FROM rm_location CR WHERE CR.components_id = :component AND CR.loc_in IN (:location) AND DATE_FORMAT(CR.insert_date, '%Y-%m-%d') < :date AND CR.trans_type IN ('INWARD','TRANSFER','ISSUE') UNION ALL SELECT - COALESCE(SUM(qty + other_qty), 0) QTY FROM rm_location DR WHERE DR.components_id = :component AND DR.loc_out IN (:location) AND DATE_FORMAT(DR.insert_date, '%Y-%m-%d') < :date AND DR.trans_type IN ('ISSUE','REJECTION','JOBWORK','TRANSFER')) t) as OpeningBalance FROM DUAL

            // SF STOCK

            let Sf_stmt = await invtDB.query(
              "SELECT COALESCE( SUM( CASE WHEN trans_type IN('INWARD', 'ISSUE', 'JOBWORK', 'REJECTION') AND loc_in IN (:location) AND DATE_FORMAT( insert_date, '%Y-%m-%d' ) = :date THEN qty ELSE 0 END ), 0 ) AS inward, COALESCE( SUM( CASE WHEN trans_type IN( 'ISSUE', 'JOBWORK', 'REJECTION', 'CONSUMPTION' ) AND loc_out IN (:location) AND DATE_FORMAT( insert_date, '%Y-%m-%d' ) = :date THEN qty ELSE 0 END ), 0 ) AS outward, COALESCE( SUM( CASE WHEN trans_type IN('INWARD', 'ISSUE', 'JOBWORK', 'REJECTION', 'TRANSFER') AND loc_in IN (:location) AND DATE_FORMAT( insert_date, '%Y-%m-%d' ) < :date THEN qty ELSE 0 END ), 0 ) - COALESCE( SUM( CASE WHEN trans_type IN( 'ISSUE', 'JOBWORK', 'REJECTION', 'TRANSFER', 'CONSUMPTION' ) AND loc_out IN (:location) AND DATE_FORMAT( insert_date, '%Y-%m-%d' ) < :date THEN qty ELSE 0 END ), 0 ) AS OpeningBalance  FROM rm_location WHERE components_id = :component ",
              {
                replacements: {
                  component: item.component_key,
                  location: sf_locations,
                  date: moment(new Date()).format("YYYY-MM-DD"),
                },
                type: invtDB.QueryTypes.SELECT,
              }
            );

            let Sf_inward_all_qty = 0, Sf_outward_all_qty = 0, Sf_opening_qty = 0;
            if (Sf_stmt.length > 0) {
              Sf_inward_all_qty = Sf_stmt[0].inward;
              Sf_outward_all_qty = Sf_stmt[0].outward;
              Sf_opening_qty = Sf_stmt[0].OpeningBalance;
            }

            // END SF STOCK


            //PO INTRANSIT
            let stmt_po_intransit = await invtDB.query("SELECT COALESCE(SUM(po_order_qty),0) totalReq_Qty, COALESCE(SUM(po_inward_qty),0) Inward FROM po_purchase_req WHERE (po_part_no = :component) AND (po_status = 'A' OR po_status = 'C' AND po_inward_qty != 0)", {
              replacements: {
                component: item.component_key
              },
              type: invtDB.QueryTypes.SELECT
            });
            let po_transit = stmt_po_intransit[0].totalReq_Qty > stmt_po_intransit[0].Inward ? helper.number(stmt_po_intransit[0].totalReq_Qty - stmt_po_intransit[0].Inward) : 0;

            // END PO INTRANSIT

            let rm_stock = Rm_opening_qty + Rm_inward_all_qty - Rm_outward_all_qty;
            let sf_stock = Number(Sf_opening_qty + Sf_inward_all_qty) - Sf_outward_all_qty;
            let reqStock = item.qty * req.body.product_fg_qty;
            let free_qty = rm_stock + sf_stock + po_transit - (ppr_qty * item.qty);

            data.push({
              serial_no: srno + 1,
              partno: item.c_part_no,
              components: item.c_name,
              currentStock: rm_stock,
              reqStock: reqStock,
              uom: item.units_name,
              bomqty: item.qty,
              sf_qty: sf_stock,
              ppr_qty: ppr_qty * item.qty,
              po_intransit: po_transit,
              free_qty: free_qty,
              new_order_qty: reqStock - free_qty
            });
            srno++;
          }
          count++;

          if (stmt2.length == count) {
            res.json({
              status: "success",
              code: "200",
              response: {
                data: data,
              },
            });
            return;
          }
        });
      } else {
        res.json({
          status: "error",
          message: "product BOM doesn't mapped any components",
          code: "500",
        });
        return;
      }
    } else {
      res.json({
        status: "error",
        message: "product BOM doesn't exists",
        code: "500",
      });
      return;
    }
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

// UPDATE RDO EXECUTED QTY
router.post("/updateRDOExecutedQty",  [auth.isAuthorized], async (req, res) => {

  const valid = new Validator(req.body, {
    date: "required",
  });
  if (valid.fails()) {
    return res.json({ status: "error", success: false, message: "Validation failed" });
  }

  if (moment(req.body.date, "DD-MM-YYYY").format("YYYY-MM-DD") == "Invalid date") {
    return res.json({ status: "error", success: false, message: "Invalid date" });
  }

  const transaction = await otherDB.transaction();

  try {

    let selectPPR = await otherDB.query("SELECT * FROM invt_projects WHERE DATE_FORMAT(project_insert_dt, '%Y-%m-%d') >= :date ", {
      replacements: {
        date: moment(req.body.date, "DD-MM-YYYY").format("YYYY-MM-DD"),
      },
      type: invtDB.QueryTypes.SELECT,
    });

    // console.log(selectPPR.length);
    // return;
    if (selectPPR.length > 0) {
      let updatePPR;
      for (let i = 0; i < selectPPR.length; i++) {
        // let countConsmp = await invtDB.query("SELECT COALESCE(SUM(`mfg_prod_planing_qty`), 0) AS `totalConsumpQTY`  FROM `mfg_production_2` WHERE `mfg_ref_id` = :ppr AND `mfg_sku` = :sku AND mfg_prod_type = 'A'", {
        let countConsmp = await invtDB.query("SELECT COALESCE(SUM(prod_executed_qty), 0) AS totalConsumpQTY  FROM mfg_production_1 WHERE prod_transaction = :ppr AND prod_product_sku = :sku", {
          replacements: {
            ppr: selectPPR[i].project_ppr_no,
            sku: selectPPR[i].project_ppr_sku
          },
          type: invtDB.QueryTypes.SELECT,
        });

        if (countConsmp.length > 0) {
          updatePPR = await otherDB.query("UPDATE invt_projects SET executed_qty = :executed_qty WHERE ID = :id AND project_ppr_no = :ppr AND project_rm = :component", {
            replacements: {
              id: selectPPR[i].ID,
              ppr: selectPPR[i].project_ppr_no,
              component: selectPPR[i].project_rm,
              executed_qty: helper.number(helper.number(countConsmp[0].totalConsumpQTY) * helper.number(selectPPR[i].project_ppr_bom_qty))
            },
            type: otherDB.QueryTypes.UPDATE,
            transaction: transaction
          });
        }
        // else {
        //   transaction.rollback();
        //   // res.json({ status: "error", code: 500, message: "Error for PPR " + selectPPR[i].id + "& RM " + selectPPR[i].component_key });
        //   // console.log("Error for PPR " + selectPPR[i].id + "& RM " + selectPPR[i].component_key);
        //   // return;
        // }
      }

      if (updatePPR.length > 0) {
        await transaction.commit();
        res.json({ status: "success", code: 200, message: "OK" });
        // console.log("OK for PPR - ROW ID " + selectPPR[0].ID);
        return;
      } else {
        transaction.rollback();
        res.json({ status: "error", code: 500, message: "SORRY" });
        // console.log("SORRY for PPR - ROW ID " + selectPPR[0].ID);
        return;
      }

    } else {
      transaction.rollback();
      res.json({ status: "error", success: false, message: "no projects found" });
      // console.log("no projects found");
      return;
    }

  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

module.exports = router;
