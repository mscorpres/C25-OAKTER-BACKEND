const express = require("express");
const router = express.Router();

let { invtDB } = require("../../../config/db/connection");

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");
const Validator = require("validatorjs");

// GET ALL PART CONVERSION LOCATIONS
router.post("/conversion_locations", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt1 = await invtDB.query("SELECT locations FROM location_allotted WHERE loc_all_key = :location_key", {
      replacements: { location_key: "2023112175131523" },
      type: invtDB.QueryTypes.SELECT,
    });

    let loc_ids = stmt1[0].locations.split(",");
    let locations = [];
    locations = await invtDB.query("SELECT location_key as id , loc_name as text FROM `location_main` WHERE `location_key` IN (:location_defined)", {
      replacements: { location_defined: loc_ids },
      type: invtDB.QueryTypes.SELECT,
    });
    return res.json({ status: "success", success: true, message: "", data: locations });
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

// INSERT CONVERSION OF PART
router.post("/saveConversion", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(
    {
      initial: req.body.initial,
      final: req.body.final,
    },
    {
      "initial.component_in": "required",
      "initial.qty_in": "required",
      "initial.loc_in": "required",
      "initial.rate": "required",
      "final.component_out": "required",
      "final.qty_out": "required",
      "final.loc_out": "required",
      "final.rate": "required",
    },
  );

  if (validation.fails()) {
    return res.json({
      success: false,
      message: "something you missing in form field to supply",
      status: "error",
    });
  }

  const rawType = req.body.type;
  const typeNorm =
    rawType == null || String(rawType).trim() === ""
      ? "rm"
      : String(rawType).trim().toLowerCase();
  if (typeNorm !== "rm" && typeNorm !== "sf") {
    return res.json({
      success: false,
      message: "type must be RM / SF",
      status: "error",
    });
  }
  const partInwardType = typeNorm === "sf" ? "SF_PART" : "RM_PART";

  let component_length = req.body.initial.component_in.length;

  const transaction = await invtDB.transaction();

  try {
    let transactionCode;

    let insert_dt = moment(new Date())
      .tz("Asia/Kolkata")
      .format("YYYY-MM-DD HH:mm:ss");

    let stmt6 = await invtDB.query(
      "SELECT * FROM ims_numbering WHERE for_number = 'CONVERSION' FOR UPDATE",
      {
        transaction: transaction,
        type: invtDB.QueryTypes.SELECT,
      },
    );

    if (stmt6.length > 0) {
      var suffix = stmt6[0].suffix;
      suffix = parseInt(suffix) + 1;
      suffix = suffix.toString();
      suffix = suffix.padStart(parseInt(stmt6[0].number_length_limit), "0");
      transactionCode = stmt6[0].prefix + "/" + stmt6[0].session + "/" + suffix;
    } else {
      let currYear = parseInt(new Date().getFullYear().toString().substr(2, 2));
      transactionCode = "CONV/" + currYear + "-" + (currYear + 1) + "/0001";
    }

    await invtDB.query(
      "UPDATE ims_numbering SET suffix = suffix+1 WHERE for_number = 'CONVERSION'",
      {
        transaction: transaction,
        type: invtDB.QueryTypes.UPDATE,
      },
    );

    //OUT Components
    for (let i = 0; i < component_length; i++) {
      // INWARD + OUTWARD in a single query via conditional aggregation
      let stmt1 = await invtDB.query(
        "SELECT COALESCE(SUM(CASE WHEN trans_type IN ('INWARD','ISSUE','JOBWORK','REJECTION','TRANSFER') AND loc_in = :location THEN qty+other_qty ELSE 0 END), 0) AS total_inward, COALESCE(SUM(CASE WHEN trans_type IN ('CONSUMPTION','ISSUE','JOBWORK','REJECTION','TRANSFER') AND loc_out = :location THEN qty+other_qty ELSE 0 END), 0) AS total_outward FROM rm_location WHERE components_id = :component AND (loc_in = :location OR loc_out = :location)",
        {
          replacements: {
            component: req.body.initial.component_in[i],
            location: req.body.initial.loc_in[i],
          },
          type: invtDB.QueryTypes.SELECT,
        },
      );

      let totalIn = stmt1.length > 0 ? stmt1[0].total_inward : 0;
      let totalOut = stmt1.length > 0 ? stmt1[0].total_outward : 0;

      if (
        parseInt(totalIn) - parseInt(totalOut) >=
        parseInt(req.body.initial.qty_in[i])
      ) {
        let stmt4 = await invtDB.query(
          "INSERT INTO rm_location (txn_session,company_branch,loc_out,in_module,trans_type,inward_type,components_id,qty,insert_by,insert_date,any_remark,out_transaction_id, in_po_rate) VALUES (:txn_session,:branch,:loc_out,'PART-CONV','CONSUMPTION',:inward_type,:component,:qty,:insert_by,:insert_date,:remark,:out_transaction, :rate)",
          {
            replacements: {
              txn_session: helper.generateTxnSession(),
              branch: req.branch,
              loc_out: req.body.initial.loc_in[i],
              inward_type: partInwardType,
              component: req.body.initial.component_in[i],
              qty: req.body.initial.qty_in[i],
              insert_by: req.logedINUser,
              insert_date: insert_dt,
              remark: req.body.remarks == null ? "--" : req.body.remarks,
              out_transaction: transactionCode,
              rate: req.body.initial.rate[i],
            },
            type: invtDB.QueryTypes.INSERT,
            transaction: transaction,
          },
        );

        if (stmt4.length === 0) {
          await transaction.rollback();
          return res.json({
            success: false,
            status: "error",
            message: "an error occurred while inserting the consumption data",
          });
        }
      } else {
        await transaction.rollback();
        return res.json({
          success: false,
          message: " Out quantity not available at the location",
          status: "error",
        });
      }
    }

    //IN Component
    let stmt3 = await invtDB.query(
      "INSERT INTO rm_location (txn_session,company_branch,loc_in,in_module,trans_type,inward_type,components_id,qty,insert_by,insert_date,any_remark,in_transaction_id, in_po_rate) VALUES (:txn_session,:branch,:loc_in,'PART-CONV','INWARD',:inward_type,:component,:qty,:insert_by,:insert_date,:remark,:in_transaction, :rate)",
      {
        replacements: {
          txn_session: helper.generateTxnSession(),
          branch: req.branch,
          loc_in: req.body.final.loc_out,
          inward_type: partInwardType,
          component: req.body.final.component_out,
          qty: req.body.final.qty_out,
          insert_by: req.logedINUser,
          insert_date: moment(insert_dt)
            .add(1, "seconds")
            .format("YYYY-MM-DD HH:mm:ss"),
          remark: req.body.remarks == null ? "--" : req.body.remarks,
          in_transaction: transactionCode,
          rate: req.body.final.rate,
        },
        type: invtDB.QueryTypes.INSERT,
        transaction: transaction,
      },
    );

    if (stmt3.length === 0) {
      await transaction.rollback();
      return res.json({
        success: false,
        status: "error",
        message: "Internal Error contact to system administrator",
      });
    }

    await transaction.commit();
    return res.json({
      success: true,
      status: "success",
      message: `Conversion Completed with TXN ID: ${transactionCode}.`,
      data: {
        txn: transactionCode,
      },
    });
  } catch (err) {
    console.log(err);
    await transaction.rollback();
    return helper.errorResponse(res, err);
  }
});

// GET REPORT OF PART CODE CONVERSION
router.get("/fetch/conversion", [auth.isAuthorized], async (req, res) => {
  const searchBy = req.query.wise;
  const searchValue = req.query.data;
  // const type = req.query.type;

  const validation = new Validator(req.query, {
    wise: "required",
    data: "required",
    // type: "required|in:sf,rm",
  });

  if (validation.fails()) {
    res.json({
      success: false,
      message: "something you missing in form field to supply",
      data: validation.errors.all(),
      status: "error",
    });
    return;
  }
  try {
    let stmt1;
    if (searchBy == "date") {
      const date = searchValue.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
      const fromdate = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
      const todate = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");
      const durationInMonths = moment(date[1], "DD-MM-YYYY").diff(
        moment(date[0], "DD-MM-YYYY"),
        "months",
      );

      if (durationInMonths > 3) {
        return res.json({
          success: false,
          message:
            "on the w.e.f Nov 11, 2021: We can provide you 90 days OR (3 months) data only",
          status: "error",
        });
      }

      stmt1 = await invtDB.query(
        "SELECT admin_login.user_name, location_main.loc_name, rm_location.in_transaction_id, rm_location.qty, components.c_part_no, components.c_new_part_no, components.c_name, units.units_name, rm_location.insert_date FROM rm_location LEFT JOIN components ON components.component_key = rm_location.components_id LEFT JOIN units On units.units_id = components.c_uom LEFT JOIN admin_login ON admin_login.CustID = rm_location.insert_by LEFT JOIN location_main ON location_main.location_key = rm_location.loc_in WHERE rm_location.company_branch = :branch AND rm_location.in_module = 'PART-CONV' AND rm_location.trans_type = 'INWARD' AND DATE_FORMAT(rm_location.insert_date,'%Y-%m-%d') BETWEEN :from AND :to ORDER BY rm_location.ID DESC",
        {
          replacements: { branch: req.branch, from: fromdate, to: todate },
          type: invtDB.QueryTypes.SELECT,
        },
      );
    } 
    // else if (searchBy == "rm") {
    //   stmt1 = await invtDB.query(
    //     "SELECT admin_login.user_name, location_main.loc_name, rm_location.in_transaction_id, rm_location.components_id, rm_location.qty, components.c_part_no, components.c_new_part_no, components.c_name, units.units_name, rm_location.insert_date FROM rm_location LEFT JOIN components ON components.component_key = rm_location.components_id LEFT JOIN units On units.units_id = components.c_uom LEFT JOIN admin_login ON admin_login.CustID = rm_location.insert_by LEFT JOIN location_main ON location_main.location_key = rm_location.loc_in WHERE rm_location.company_branch = :branch AND rm_location.in_module = 'PART-CONV' AND rm_location.trans_type = 'INWARD' AND rm_location.components_id = :component ORDER BY rm_location.ID DESC",
    //     {
    //       replacements: { branch: req.branch, component: searchValue },
    //       type: invtDB.QueryTypes.SELECT,
    //     },
    //   );
    // } 
    else {
      return res.json({
        success: false,
        status: "error",
        message: "search method is not valid",
      });
    }

    if (stmt1.length === 0) {
      return res.json({
        success: false,
        status: "error",
        message: "No Data Found" ,
      });
    }

    const transactionIds = stmt1.map((item) => item.in_transaction_id);

    const stmt2 = await invtDB.query(
      "SELECT rm_location.qty, location_main.loc_name, components.c_part_no, components.c_new_part_no, components.c_name, units.units_name, rm_location.out_transaction_id FROM rm_location LEFT JOIN components ON components.component_key = rm_location.components_id LEFT JOIN units On units.units_id = components.c_uom LEFT JOIN location_main ON location_main.location_key = rm_location.loc_out WHERE rm_location.in_module = 'PART-CONV' AND rm_location.trans_type = 'CONSUMPTION' AND rm_location.out_transaction_id IN (:transactions) ORDER BY rm_location.ID DESC",
      {
        replacements: { transactions: transactionIds },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    const result = stmt1.map((item, index) => {
      const relatedStmt2 = stmt2.filter(
        (consumptionItem) =>
          consumptionItem.out_transaction_id === item.in_transaction_id,
      );

      return {
        serial_no: index + 1,
        final_label: item.c_name,
        final_part: item.c_part_no,
        final_new_part: item.c_new_part_no,
        final_qty: item.qty,
        uom: item.units_name,
        txn_dt: moment(item.insert_date).format("DD-MM-YYYY HH:mm:ss"),
        txn_by: item.user_name,
        txn_id: item.in_transaction_id,
        drop_location: item.loc_name,
        consumption: relatedStmt2.map((consumptionItem, index) => ({
          serial_no: index + 1,
          uom: consumptionItem.units_name,
          consump_part_code: consumptionItem.c_part_no,
          consump_part_name: consumptionItem.c_name,
          consump_qty: consumptionItem.qty,
          pick_location: consumptionItem.loc_name,
        })),
      };
    });

    return res.json({ success: true, status: "success", data: result });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// GET ALL PART CONVERSION LOCATIONS
router.get("/rm/location", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt1 = await invtDB.query(
      "SELECT locations FROM location_allotted WHERE loc_all_key = :location_key",
      {
        replacements: { location_key: "2026217123155624" },
        type: invtDB.QueryTypes.SELECT,
      },
    );

    let loc_ids = stmt1[0].locations.split(",");
    let locations = [];
    locations = await invtDB.query(
      "SELECT location_key as id , loc_name as text FROM `location_main` WHERE `location_key` IN (:location_defined)",
      {
        replacements: { location_defined: loc_ids },
        type: invtDB.QueryTypes.SELECT,
      },
    );
    return res.json({ success: true, status: "success", data: locations });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

module.exports = router;
