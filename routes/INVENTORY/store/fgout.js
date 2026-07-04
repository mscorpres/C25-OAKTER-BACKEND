const express = require("express");
const router = express.Router();

let { invtDB } = require("../../../config/db/connection");

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");
const Validator = require("validatorjs");

// FETCH PRODUCT
router.post("/fetchProduct", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    searchTerm: "required",
  });

  if (validation.fails()) {
    return res.json({ status: "error", success: false, message: "something you missing in form field to supply" });
  }
  try {
    let result = await invtDB.query("SELECT * FROM `products` WHERE p_name LIKE :search OR p_sku LIKE :search  ORDER BY `p_name` ASC", {
      replacements: {
        search: `%${req.body.searchTerm}%`,
      },
      type: invtDB.QueryTypes.SELECT,
    });
    if (result.length > 0) {
      let final = [];

      result.map((item) => {
        final.push({ id: item.product_key, text: "(" + item.p_sku + ") " + item.p_name });
      });

      if (result.length == final.length) {
        res.json({
          status: "success", success: true,
          data: final
        });
        return;
      }
    } else {
      return res.json({ status: "error", success: false, message: "No Data Found" });
    }
    return;
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});
// FETCH PRODUCT DETAILS
router.post("/fetchProductData", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt0 = await invtDB.query("SELECT * FROM `products` LEFT JOIN `units` ON `products`.`p_uom` = `units`.`units_id` WHERE products.product_key = :key ORDER BY `products`.`p_name` ASC", {
      replacements: { key: req.body.search },
      type: invtDB.QueryTypes.SELECT,
    });

    let totalYetMade;
    let totalYetOut;

    if (stmt0.length > 0) {
      //TOTAL IN YET
      let stmt1 = await invtDB.query(
        "SELECT COALESCE(SUM(`mfg_approve_in_qty`),0) AS `totalQTYinTODAY` FROM `mfg_production_3` WHERE `company_branch` = :branch AND `mfg_pro_apr_sku` = :sku AND `type` IN('IN', 'FGMIN') AND `fg_status` = 'ACTIVE'",
        {
          replacements: { sku: stmt0[0].p_sku, branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (stmt1.length > 0) {
        totalYetMade = stmt1[0].totalQTYinTODAY;
      } else {
        totalYetMade = 0;
      }

      //TOTAL OUT YET
      let stmt2 = await invtDB.query(
        "SELECT COALESCE(SUM(`fgout_approve_out_qty`),0) AS `totalQTYoutTODAY` FROM `mfg_production_3` WHERE `company_branch` = :branch AND `fgout_pro_apr_sku` = :sku AND `type` = 'OUT' AND `fg_status` = 'ACTIVE'",
        {
          replacements: { sku: stmt0[0].product_key, branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      if (stmt2.length > 0) {
        totalYetOut = stmt2[0].totalQTYoutTODAY;
      } else {
        totalYetOut = 0;
      }
    }

    return res.json({
      status: "success", success: true,
      data: {
        part: stmt0[0].p_sku,
        name: stmt0[0].p_name,
        key: stmt0[0].product_key,
        unit: stmt0[0].units_name,
        total: parseFloat(totalYetMade) - parseFloat(totalYetOut) < 0 ? 0 : parseFloat(totalYetMade) - parseFloat(totalYetOut),
      },
    });
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});
// CREATE FGOUT
router.post("/createFGOUT", [auth.isAuthorized, auth.checkDuplicacy_db], async (req, res) => {
  let validation = new Validator(req.body, {
    fg_out_type: "required",
  });
  if (validation.fails()) {
    return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(validation) });
  }

  let product_length = req.body.product.length;

  for (let i = 0; i < product_length; i++) {
    let validation = new Validator(
      {
        product: req.body.product[i],
        qty: helper.number(req.body.qty[i]),
      },
      {
        product: "required",
        qty: "required|min:1",
      }
    );
    if (validation.fails()) {
      return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(validation) });
    }
  }

  const toFindDublicates = (arry) => arry.filter((item, index) => arry.indexOf(item) !== index);
  const dubliEle = toFindDublicates(req.body.product);
  if (dubliEle.length > 0) {
    return res.json({ status: "error", success: false, message: "You have entered a same product twice of time in a single request" });
  }

  const t = await invtDB.transaction();

  try {
    let stmt = await invtDB.query(
      "SELECT `mfg_pro_FGout_transaction`,`type` FROM `mfg_production_3` WHERE `type` = 'OUT' AND `company_branch` = :branch AND `fg_status` = 'ACTIVE' GROUP BY `mfg_pro_FGout_transaction` ORDER BY ID DESC LIMIT 1",
      {
        replacements: { branch: req.branch },
        type: invtDB.QueryTypes.SELECT,
      }
    );
    let transactionCode;

    if (stmt.length > 0) {
      stmt.map((item) => {
        transactionCode = item.mfg_pro_FGout_transaction;
        let strings = transactionCode.replace(/[0-9]/g, "");
        let digits = (Number(transactionCode.replace(/[^0-9]/g, "")) + 1).toString();
        if (digits.length < 3) digits = ("000" + digits).substr(-3);
        transactionCode = strings + digits;
      });
    } else {
      transactionCode = "FGO001";
    }

    for (let i = 0; i < product_length; i++) {
      if (helper.number(req.body.qty[i]) > 0) {
        let stmt1 = await invtDB.query(
          "INSERT INTO `mfg_production_3` (`company_branch`,`fgout_pro_apr_sku`,`fgout_approve_out_qty`,`fgout_pro_apr_by`,`fgout_pro_apr_date`,`fgout_pro_apr_fulldate`, `fgout_pro_location_out`,`mfg_pro_FGout_transaction`,`type`,`fg_out_type`,`fg_out_remark`)VALUES (:branch,:sku,:aproutqty,:outby,:outdate,:outfulldate, :fgout_pro_location_out,:transactioncode,:type, :fg_out_type,:remark)",
          {
            replacements: {
              branch: req.branch,
              sku: req.body.product[i], // product key will use for fetching product data
              aproutqty: helper.number(req.body.qty[i]),
              outby: req.logedINUser,
              outdate: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD"),
              outfulldate: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
              fgout_pro_location_out: req.body.location[i] == null ? "--" : req.body.location[i],
              transactioncode: transactionCode,
              type: "OUT",
              fg_out_type: req.body.fg_out_type,
              remark: req.body.remark[i],
            },
            type: invtDB.QueryTypes.INSERT,
            transaction: t,
          }
        );

        if (stmt1.length > 0) {
          let stmt2 = await invtDB.query(
            "INSERT INTO `fg_location` (`fg_type`,`sku_code`, `fg_loc_out`,`qty`,`insert_dt`,`insert_by`,`fg_out_transaction`) VALUES ('OUT',:sku_code, :fg_loc_out,:fg_qty, :fg_insert_dt,:fg_insert_by,:out_id)",
            {
              replacements: {
                sku_code: req.body.product[i],
                fg_qty: helper.number(req.body.qty[i]),
                fg_loc_out: req.body.location[i] == null ? "--" : req.body.location[i],
                fg_insert_dt: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
                fg_insert_by: req.logedINUser,
                out_id: transactionCode,
              },
              type: invtDB.QueryTypes.INSERT,
              transaction: t,
            }
          );

          if (stmt2.length > 0) {
            let stmt3 = await invtDB.query("SELECT * FROM `products` WHERE `product_key` = :key", { replacements: { key: req.body.product[i] }, type: invtDB.QueryTypes.SELECT });
            if (stmt3.length > 0) {
              //TOTAL IN YET
              let stmt4 = await invtDB.query(
                "SELECT `mfg_pro_apr_sku`,`type`,`entry_mode`, COALESCE(SUM(`mfg_approve_in_qty`),0) AS `totalYetInstock` FROM `mfg_production_3` WHERE `mfg_pro_apr_sku`= :sku AND `type` IN('IN', 'FGMIN') AND `company_branch` = :branch AND `fg_status` = 'ACTIVE'",
                {
                  replacements: { sku: stmt3[0].p_sku, branch: req.branch },
                  type: invtDB.QueryTypes.SELECT,
                }
              );

              let totalYetInstock;
              if (stmt4.length > 0) {
                totalYetInstock = helper.number(stmt4[0].totalYetInstock);
              } else {
                totalYetInstock = 0;
              }
              //TOTAL OUT YET
              let stmt5 = await invtDB.query(
                "SELECT COALESCE(SUM(`fgout_approve_out_qty`),0) AS `totalYetOutstock` FROM `mfg_production_3` WHERE `fgout_pro_apr_sku` = :sku AND `type` = 'OUT' AND `company_branch` = :branch AND `fg_status` = 'ACTIVE'",
                {
                  replacements: { sku: stmt3[0].product_key, branch: req.branch },
                  type: invtDB.QueryTypes.SELECT,
                }
              );

              let totalYetOutstock;
              if (stmt5.length > 0) {
                totalYetOutstock = helper.number(stmt5[0].totalYetOutstock);
              } else {
                totalYetOutstock = 0;
              }

              if (helper.number(totalYetInstock - totalYetOutstock) >= helper.number(req.body.qty[i])) {
                if (i == product_length - 1) {
                  await t.commit();
                  return res.json({ status: "success", success: true, message: "FG OUT Completed..<br>TxnID: #" + transactionCode, data: {} });
                }
              } else {
                t.rollback();
                return res.json({ status: "error", success: false, message: "getting an insufficient stock for out" });
              }
            } else {
              t.rollback();
              return res.json({ status: "error", success: false, message: "some of the SKU(s) are not valid" });
            }
          } else {
            t.rollback();
            return res.json({ status: "error", success: false, message: "an error while executing your request(2)" });
          }
        } else {
          t.rollback();
          return res.json({ status: "error", success: false, message: "an error while executing your request (1)" });
        }
      }
    }
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});
// FETCH FG OUT STOCK
router.post("/fetchFgOutRpt", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    method: "required",
    date: "required",
  });
  if (validation.fails()) {
    return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(validation) });
  }
  try {
    if (req.body.method == "O" && /^(0[1-9]|[1-2][0-9]|3[0-1])-(0[1-9]|1[0-2])-[0-9]{4}$/.test(req.body.date)) {
      let final = [];
      let stmt1 = await invtDB.query(
        "SELECT *, `admin_login`.`user_name` FROM `mfg_production_3` LEFT JOIN `admin_login` ON `admin_login`.`CustID` = `mfg_production_3`.`fgout_pro_apr_by` LEFT JOIN `products` ON `mfg_production_3`.`fgout_pro_apr_sku` = `products`.`product_key` LEFT JOIN units ON products.p_uom = units.units_id WHERE `mfg_production_3`.`type` = 'OUT' AND `mfg_production_3`.`fgout_pro_apr_date` = :date AND `mfg_production_3`.`company_branch` = :branch AND `mfg_production_3`.`fg_status` = 'ACTIVE' ORDER BY `mfg_production_3`.`fgout_pro_apr_fulldate` DESC",
        {
          replacements: { date: moment(req.body.date, "DD-MM-YYYY").format("YYYY-MM-DD"), branch: req.branch },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      if (stmt1.length > 0) {
        stmt1.map((item1) => {
          final.push({
            approvedate: moment(item1.fgout_pro_apr_date, "YYYY-MM-DD").format("DD-MM-YYYY"),
            approveby: item1.user_name,
            sku: item1.p_sku,
            name: item1.p_name,
            approveqty: item1.fgout_approve_out_qty,
            fg_type: item1.fg_out_type === "SL001" ? "SALES" : item1.fg_out_type === "OT001" ? "OTHER" : item1.fg_out_type === "REPL" ? "REPLACEMENT" : item1.fg_out_type,
          });
        });
        return res.json({ status: "success", success: true, message: "", data: final });
      } else {
        return res.json({ status: "error", success: false, message: "No data found" });
      }
    } else {
      return res.json({ status: "error", success: false, message: "Invalid date format" });
    }
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

module.exports = router;
