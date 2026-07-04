const express = require("express");
const router = express.Router();
const axios = require("axios");

let { invtDB, otherDB } = require("../../../config/db/connection");


const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");
const Validator = require("validatorjs");

// HIT CONSOLE
router.get("/hitConsole", async (req, res) => {
  try {
    const fromDate = moment(new Date()).subtract("1", "hour").format("YYYY-MM-DDTHH:00");
    const dateTill = moment(fromDate, "YYYY-MM-DDTHH:00").add("1", "hour").format("YYYY-MM-DDTHH:00");

    const stmt_check = await otherDB.query("SELECT ID FROM invt_console WHERE console_dateFrom = :dfrom AND console_dateTill = :dateTill", {
      replacements: {
        dfrom: fromDate,
        dateTill: dateTill,
      },
      type: otherDB.QueryTypes.SELECT,
    });

    if (stmt_check.length > 0) {
      return res.json({ status: "error", success: false, message: `all ready saved for time ${fromDate} - ${dateTill}` });
    }

    const response = await axios.post(
      "https://packageservice.in/Test/api/OakterVQCData",
      {
        // dateFrom: "2023-04-14T17:00",
        // dateTill: "2023-04-14T18:00",
        dateFrom: fromDate,
        dateTill: dateTill,
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    if (response.data.code != 200) {
      return res.json({ status: "error", success: false, message: `there is something error in Console API (${response.data.status} / ${response.data.code}) ` });
    } else {
      let stmt = await otherDB.query("INSERT INTO `invt_console`(console_txn_id , `console_sku`, `console_line`, `console_qty`, `console_language`, `console_dateFrom`, `console_dateTill`, `insert_dt`, `console_imei`) VALUES ( :console_txn_id , :sku , :line , :qty , :language , :datefrom , :dateTill , :insert_dt , :imei )", {
        replacements: {
          console_txn_id: helper.getUniqueNumber(),
          sku: response.data.data.modelName,
          line: response.data.data.lineNo,
          qty: response.data.data.toatlCount,
          language: response.data.data.language,
          datefrom: fromDate,
          dateTill: dateTill,
          insert_dt: moment(new Date()).format("YYYY-MM-DD HH:mm:ss"),
          imei: response.data.data.imei.toString(),
        },
        type: otherDB.QueryTypes.INSERT,
      });

      if (stmt.length > 0) {
        return res.json({ status: "success", success: true, message: "Console Recorded" });
      } else {
        return res.json({ status: "error", success: false, message: "an unexpected error has occurred. Our technical staff has been automatically notified and will be looking into this with utmost urgency." });
      }
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// FETCH CONSOLE
router.get("/fetchConsole", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt = await otherDB.query("SELECT console_txn_id , console_sku , console_line , console_qty , console_language , console_dateFrom , console_dateTill FROM invt_console", { type: otherDB.QueryTypes.SELECT });

    if (stmt.length > 0) {
      let final = [];

      for (let i = 0; i < stmt.length; i++) {
        final.push({
          txn_id: stmt[i].console_txn_id,
          sku: stmt[i].console_sku,
          line: stmt[i].console_line,
          qty: stmt[i].console_qty,
          language: stmt[i].console_language,
          dateFrom: stmt[i].console_dateFrom,
          dateTill: stmt[i].console_dateTill,
        });
      }

      return res.json({ status: "success", success: true, message: "Data fetched successfully", data: final });
    } else {
      return res.json({ status: "error", success: false, message: "No Data Found!!!" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// CREATE
router.post("/createConsoleMfg", [auth.isAuthorized], async (req, res) => {
  const transaction = await invtDB.transaction();

  try {
    let valid = new Validator(req.body, {
      // skucode: "required",
      txnid: "required",
    });

    if (valid.fails()) {
      await transaction.rollback();
      return res.json({ status: "error", success: false, message: "Validation error", data: valid.errors.all() });
    }

    let stmt = await otherDB.query("SELECT * FROM invt_console WHERE console_txn_id = :txn_id", {
      replacements: { txn_id: req.body.txnid },
      type: otherDB.QueryTypes.SELECT,
    });

    if (stmt.length > 0) {
      const mfgQty = +stmt[0].console_qty;
      const mfg_location = "20210910143759"; //SF021
      const insertDate = moment(new Date()).format("YYYY-MM-DD HH:mm:ss");

      const stmt_bom = await invtDB.query("SELECT * FROM `bom_recipe` WHERE `console_sku` = :console_sku AND bom_status = 'ENABLE'", {
        replacements: { console_sku: stmt[0].console_sku },
        type: invtDB.QueryTypes.SELECT,
      });

      if (stmt_bom.length > 0) {
        const subject_id = stmt_bom[0].subject_id;
        const bom_product_sku = stmt_bom[0].bom_product_sku;

        // GET CONPONENETS IN BOMS
        let stmt_bom_components = await invtDB.query("SELECT bom_quantity.qty , bom_quantity.component_id , c_part_no , c_name  FROM bom_quantity LEFT JOIN components ON components.component_key = bom_quantity.component_id WHERE  bom_status != 'I' AND subject_under = :subject", {
          replacements: { subject: subject_id },
          type: invtDB.QueryTypes.SELECT,
        });

        let stmt5 = await invtDB.query(
          "INSERT INTO `mfg_production_2` (`company_branch`,`mfg_prod_planing_qty`,`mfg_sku`,`mfg_send_location`,`mfg_con_location`,`mfg_comment`,`mfg_insert_date`,`mfg_full_date`,`mfg_approved_by`,`mfg_transaction`,`mfg_ref_id`,`step_count`,`mfg_prod_type`,`mfg_ppr_created_by`,`ppr_randomcode`) VALUES (:branch,:mfgqty,:sku,:sendLoc,:conLoc,:comment,:insertdate,:fulldate,:by,:transaction,:ref,:count,:type,:pprinsertedby,:random)",
          {
            replacements: {
              branch: "BRALWR36",
              mfgqty: mfgQty,
              sku: req.body.skucode,
              sendLoc: "",// SF021 // req.body.sendinglocation,
              conLoc: mfg_location, //req.body.conlocation,
              comment: "", // req.body.comment,
              insertdate: insertDate,
              fulldate: insertDate,
              by: req.logedINUser,
              transaction: "", // mfg_transaction,
              ref: "", // req.body.ppr_transaction,
              count: 1, //stepcount,
              type: "C",
              pprinsertedby: "", // pprcreatedBY,
              random: "", // req.body.accesstoken,
            },
            type: invtDB.QueryTypes.INSERT,
            transaction: transaction,
          }
        );

        if (stmt_bom_components.length > 0) {
          for (let i = 0; i < stmt_bom_components.length; i++) {
            let mother_com = stmt_bom_components[i].component_id;
            let mother_com_code = stmt_bom_components[i].c_part_no;
            let bom_qty = +stmt_bom_components[i].qty;
            let use_in_mfg_qty = mfgQty * bom_qty;
            let total_qty_found = 0;

            // GET STOCK
            // ALL INWARD
            let stmt_stock_inward = await invtDB.query("SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Inward` FROM `rm_location` WHERE `components_id` = :component AND `loc_in` = :location AND (`trans_type` != 'CONSUMPTION' AND `trans_type` != 'CANCELLED')", {
              replacements: {
                component: mother_com,
                location: mfg_location,
              },
              type: invtDB.QueryTypes.SELECT,
            });

            let component_qty_yet_in_location = 0;
            if (stmt_stock_inward.length > 0) {
              component_qty_yet_in_location = helper.number(stmt_stock_inward[0].Inward);
            }

            // ALL OUTWARD
            let out_stmt = await invtDB.query("SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Outward` FROM `rm_location` WHERE `components_id` = :component AND `loc_out` = :location AND (`trans_type` != 'CONSUMPTION' OR `trans_type` != 'CANCELLED')", {
              replacements: {
                component: mother_com,
                location: mfg_location,
              },
              type: invtDB.QueryTypes.SELECT,
            });
            let component_qty_yet_out_location = 0;
            if (out_stmt.length > 0) {
              component_qty_yet_out_location = helper.number(out_stmt[0].Outward);
            }

            let stock_qty = parseInt(component_qty_yet_in_location - component_qty_yet_out_location);
            // END STOCK

            total_qty_found = stock_qty;

            // GET ALTERNATIVE IF QTY IS OUT OF STOCK
            if (use_in_mfg_qty > stock_qty) {
              // total_qty_found = total_qty_found + stock_qty;
              let stmt_get_alter = await invtDB.query("SELECT alternative_components.* , c_part_no , c_name  FROM alternative_components  LEFT JOIN components ON components.component_key = alternative_components.alt_daughter_component WHERE alt_mother_component = :mother_com AND alt_subject = :subject", {
                replacements: {
                  mother_com: mother_com,
                  subject: subject_id,
                },
                type: invtDB.QueryTypes.SELECT,
              });

              if (stmt_get_alter.length > 0) {
                let alt_comp = [mother_com_code];
                // console.log(11111111111111);
                for (let j = 0; use_in_mfg_qty > total_qty_found && j < stmt_get_alter.length; j++) {
                  // console.log(0000000000000000);
                  // console.log(stmt_get_alter[j]);
                  alt_comp.push(stmt_get_alter[j].c_part_no);
                  //
                  // GET STOCK
                  // ALL INWARD
                  let stmt_stock_inward = await invtDB.query("SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Inward` FROM `rm_location` WHERE `components_id` = :component AND `loc_in` = :location AND (`trans_type` != 'CONSUMPTION' AND `trans_type` != 'CANCELLED')", {
                    replacements: {
                      component: stmt_get_alter[j].alt_daughter_component,
                      location: mfg_location,
                    },
                    type: invtDB.QueryTypes.SELECT,
                  });

                  let component_qty_yet_in_location = 0;
                  if (stmt_stock_inward.length > 0) {
                    component_qty_yet_in_location = helper.number(stmt_stock_inward[0].Inward);
                  }

                  // ALL OUTWARD
                  let out_stmt = await invtDB.query("SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Outward` FROM `rm_location` WHERE `components_id` = :component AND `loc_out` = :location AND (`trans_type` != 'CONSUMPTION' OR `trans_type` != 'CANCELLED')", {
                    replacements: {
                      component: stmt_get_alter[j].alt_daughter_component,
                      location: mfg_location,
                    },
                    type: invtDB.QueryTypes.SELECT,
                  });
                  let component_qty_yet_out_location = 0;
                  if (out_stmt.length) {
                    component_qty_yet_out_location = helper.number(out_stmt[0].Outward);
                  }

                  let stock_qty = parseInt(component_qty_yet_in_location - component_qty_yet_out_location);
                  //

                  total_qty_found = total_qty_found + stock_qty;

                  let comp_stmt = await invtDB.query(
                    "INSERT INTO `rm_location` (`company_branch`,`trans_type`,`components_id`,`qty`,`other_qty`,`loc_out`,`insert_date`,`insert_by`,`mfg_ppr_trans_id_1`,`mfg_ppr_trans_id_2`,`mfg_step_count`,`bom_subject_id`,`any_remark`) VALUES(:branch, 'CONSUMPTION', :component, :qty, :other_qty, :loc_out, :insert_date, :insert_by, :mfg_id_1, :mfg_id_2, :step_count, :subject, :remark)",
                    {
                      replacements: {
                        branch: "BRALWR36",
                        component: stmt_get_alter[j].alt_daughter_component, //req.body.component[i],
                        qty: stock_qty, //req.body.conqty[i],
                        other_qty: "0", //req.body.reject[i],
                        loc_out: mfg_location, // req.body.sendinglocation,
                        insert_date: insertDate,
                        insert_by: req.logedINUser,
                        mfg_id_1: "", //req.body.ppr_transaction,
                        mfg_id_2: "", //mfg_transaction,
                        step_count: "", //stepcount,
                        subject: subject_id, //req.body.bom,
                        remark: "", //req.body.remark[i],
                      },
                      type: invtDB.QueryTypes.INSERT,
                      transaction: transaction,
                    }
                  );
                } // ALT LOOP

                if (total_qty_found < use_in_mfg_qty) {
                  // ROLLBACK STOCK WITH ALTERNATE COMPONENT
                  await transaction.rollback();

                  return res.json({ status: "error", success: false, message: `2.Stock ${total_qty_found} / ${use_in_mfg_qty} not available for ${alt_comp.toString()} ` });
                }
              } else {
                // ROLL BACK STOCK NOT available
                await transaction.rollback();
                return res.json({ status: "error", success: false, message: `1.Stock ${total_qty_found} / ${use_in_mfg_qty} not available for ${mother_com_code} ` });
              }
            } else {
              total_qty_found = use_in_mfg_qty;

              let comp_stmt = await invtDB.query(
                "INSERT INTO `rm_location` (`company_branch`,`trans_type`,`components_id`,`qty`,`other_qty`,`loc_out`,`insert_date`,`insert_by`,`mfg_ppr_trans_id_1`,`mfg_ppr_trans_id_2`,`mfg_step_count`,`bom_subject_id`,`any_remark`) VALUES(:branch, 'CONSUMPTION', :component, :qty, :other_qty, :loc_out, :insert_date, :insert_by, :mfg_id_1, :mfg_id_2, :step_count, :subject, :remark)",
                {
                  replacements: {
                    branch: "BRALWR36",
                    component: mother_com, //req.body.component[i],
                    qty: use_in_mfg_qty, //req.body.conqty[i],
                    other_qty: "0", //req.body.reject[i],
                    loc_out: mfg_location, // req.body.sendinglocation,
                    insert_date: insertDate,
                    insert_by: req.logedINUser,
                    mfg_id_1: "", //req.body.ppr_transaction,
                    mfg_id_2: "", //mfg_transaction,
                    step_count: "", //stepcount,
                    subject: subject_id, // req.body.bom,
                    remark: "", //req.body.remark[i],
                  },
                  type: invtDB.QueryTypes.INSERT,
                  transaction: transaction,
                }
              );
            }
          }

          // COMMIT
          await transaction.commit();
          return res.json({ status: "success", success: true, message: "MFG CREATED successfully" });
        } else {
          await transaction.rollback();
          return res.json({ status: "error", success: false, message: "BOM component ot found!!!" });
        }
      } else {
        await transaction.rollback();
        return res.json({ status: "error", success: false, message: "BOM NOT FOUND!!!" });
      }
    } else {
      await transaction.rollback();
      return res.json({ status: "error", success: false, message: "Something wrong!!! try again later..." });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// MAP BOM WITH CONSOLE SKU
router.post("/mapBomConsoleSku", [auth.isAuthorized], async (req, res) => {
  try {
    const valid = new Validator(req.body, {
      product: "required",
      bom: "required",
      console_sku: "required",
    });

    if (valid.fails()) {
      return res.json({ status: "error", success: false, message: "Validation error", data: valid.errors.all() });
    }

    let stmt = await invtDB.query("SELECT * FROM bom_recipe  WHERE subject_id = :subject AND console_sku != '--' ", {
      replacements: { subject: req.body.bom },
      type: invtDB.QueryTypes.SELECT,
    });

    if (stmt.length > 0) {
      return res.json({ status: "error", success: false, message: "BOM ALL READY MAPPED!!!!" });
    } else {
      let stmt_update = await invtDB.query("UPDATE bom_recipe SET console_sku = :console_sku WHERE subject_id = :subject", {
        replacements: { subject: req.body.bom, console_sku: req.body.console_sku },
        type: invtDB.QueryTypes.UPDATE,
      });

      if (stmt_update.length > 0) {
        return res.json({ status: "success", success: true, message: "Mapped!!!" });
      } else {
        return res.json({ status: "error", success: false, message: "Something wrong!!!" });
      }
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});


// FETCH PPR NUMBER
router.post("/fetchPpr", [auth.isAuthorized], async (req, res) => {
  const valid = new Validator(req.body, {
    searchTerm: "required",
  });

  let stmt;

  if (valid.fails()) {
    stmt = await invtDB.query("SELECT prod_transaction FROM mfg_production_1 GROUP BY prod_transaction LIMIT 50", {
      type: invtDB.QueryTypes.SELECT,
    });
  } else {
    stmt = await invtDB.query("SELECT prod_transaction FROM mfg_production_1 WHERE prod_transaction LIKE :searchTerm GROUP BY prod_transaction LIMIT 50", {
      replacements: {
        searchTerm: `%${req.body.searchTerm}%`,
      },
      type: invtDB.QueryTypes.SELECT,
    });
  }

  if (stmt.length > 0) {
    const data = [];

    for (let i = 0; i < stmt.length; i++) {
      data.push({
        id: stmt[i].prod_transaction,
        text: stmt[i].prod_transaction,
      });
    }

    return res.json({ status: "success", success: true, message: "Data fetched successfully", data: data });
  } else {
    return res.json({ status: "error", success: false, message: "PPR not found!!!" });
  }
});

// CONSOLE LOCATION LIST
router.get("/consoleLocations", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt1 = await invtDB.query("SELECT * FROM `location_allotted` WHERE `loc_all_key` = :location_key", {
      replacements: { location_key: "20235311101978" },
      type: invtDB.QueryTypes.SELECT,
    });
    // string to array
    let loc_ids = stmt1[0].locations.split(",");
    let locations = [];
    for (let i = 0; i < loc_ids.length; i++) {
      let stmt2 = await invtDB.query("SELECT * FROM `location_main` WHERE `location_key` = :location_defined AND loc_status = 'ACTIVE' ", {
        replacements: { location_defined: loc_ids[i] },
        type: invtDB.QueryTypes.SELECT,
      });

      stmt2.forEach((element) => {
        locations.push({ id: element.location_key, text: element.loc_name });
      });

      if (i == loc_ids.length - 1) {
        return res.json({ status: "success", success: true, message: "Data fetched successfully", data: locations });
      }
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

module.exports = router;
