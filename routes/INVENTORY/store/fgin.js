const express = require("express");
const router = express.Router();



let { invtDB } = require("../../../config/db/connection");

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");
const Validator = require("validatorjs");

// FETCH ALL PENDING FG
router.get("/pending", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt0 = await invtDB.query(
      "SELECT `mfg_production_2`.`mfg_sku`, `mfg_production_2`.`mfg_ref_id`, `mfg_production_2`.`mfg_transaction`, `mfg_production_2`.`mfg_prod_type`, `mfg_production_2`.mfg_prod_planing_qty, `products`.`p_sku`, `products`.`p_name`, COALESCE( SUM( `mfg_production_2`.`mfg_prod_planing_qty` ), 0 ) AS totalReqQty, IF( table1.testAMT IS NULL, '0', table1.testAMT ) AS testAMT, `mfg_production_2`.`mfg_full_date` FROM `mfg_production_2` LEFT JOIN( SELECT `mfg_ref_id`, `mfg_transaction`, `mfg_prod_planing_qty`, COALESCE(SUM(`mfg_prod_in`), 0) AS testAMT, `mfg_prod_type` FROM `mfg_production_2` GROUP BY mfg_transaction,mfg_ref_id ) table1 ON `mfg_production_2`.`mfg_transaction` = table1.`mfg_transaction` AND `mfg_production_2`.`mfg_ref_id` = table1.`mfg_ref_id` LEFT JOIN products ON `mfg_production_2`.`mfg_sku` = `products`.`p_sku` WHERE `mfg_production_2`.`mfg_prod_type` = 'C' AND `mfg_production_2`.`company_branch` = :branch AND `mfg_production_2`.`mfg_sku_type` = 'FG' GROUP BY `mfg_production_2`.`mfg_transaction`,`mfg_production_2`.`step_count` ORDER BY `mfg_production_2`.`ID` DESC",
      { replacements: { branch: req.branch }, type: invtDB.QueryTypes.SELECT }
    );

    resData = [];
    count = 0;

    if (stmt0.length > 0) {
      let stmt1;
      let qtycount = 0;
      for (let i = 0; i < stmt0.length; i++) {
        let item0 = stmt0[i];
        // stmt0.forEach(async (item0) => {
        if (item0.totalReqQty > item0.testAMT) {
          qtycount++;
          stmt1 = await invtDB.query(
            "SELECT `mfg_pro_apr_sku`, `mfg_ref_transid_2`, `mfg_ref_transid_1`, `mfg_approve_in_qty`, COALESCE( SUM(`mfg_approve_in_qty`), 0 ) AS `totalApprovedQty` FROM `mfg_production_3` WHERE `mfg_ref_transid_1` = :transaction1 AND `mfg_ref_transid_2` = :transaction2 AND `mfg_production_3`.`company_branch` = :branch GROUP BY mfg_production_3.mfg_ref_transid_2",
            {
              replacements: { transaction1: item0.mfg_ref_id, transaction2: item0.mfg_transaction, branch: req.branch },
              type: invtDB.QueryTypes.SELECT,
            }
          );
          if (stmt1.length > 0) {
            for (let j = 0; j < stmt1.length; j++) {
              let item1 = stmt1[j];
              // stmt1.forEach(async (item1) => {
              let completedQTY;
              let stmt2 = await invtDB.query("SELECT COALESCE(SUM(mfg_approve_in_qty),0) AS totalApprovedQty FROM `mfg_production_3` WHERE mfg_pro_apr_sku = :sku AND mfg_ref_transid_1 = :transaction1 AND mfg_ref_transid_2 = :transaction2 AND `mfg_production_3`.`company_branch` = :branch", {
                replacements: { sku: item1.mfg_pro_apr_sku, transaction1: item1.mfg_ref_transid_1, transaction2: item1.mfg_ref_transid_2, branch: req.branch },
                type: invtDB.QueryTypes.SELECT,
              });
              if (stmt2.length > 0) {
                completedQTY = stmt2[0].totalApprovedQty ?? 0;
              } else {
                completedQTY = 0;
              }

              let stmt3 = await invtDB.query("SELECT prod_type FROM `mfg_production_1` WHERE `prod_transaction` = :transaction1 AND `prod_branch` = :branch", { replacements: { transaction1: item1.mfg_ref_transid_1, branch: req.branch }, type: invtDB.QueryTypes.SELECT });
              if (stmt3.length > 0) {
                stmt3.forEach((item3) => {
                  typeOfPPR = item3.prod_type.toUpperCase();
                });
              } else {
                typeOfPPR = "N/A";
              }

              resData.push({
                mfg_transaction: item0.mfg_transaction,
                mfg_ref_transid_1: item1.mfg_ref_transid_1,
                typeOfPPR: typeOfPPR,
                mfg_full_date: item0.mfg_full_date,
                mfg_sku: item0.mfg_sku,
                p_name: item0.p_name,
                mfg_ref_id: item0.mfg_ref_id,
                mfg_prod_planing_qty: item0.mfg_prod_planing_qty,
                completedQTY: completedQTY,
              });
              // sendResponse();
              // }); //stmt1 end
            }
          } else {
            let stmt4 = await invtDB.query("SELECT * FROM `mfg_production_1` WHERE `prod_transaction` = :transaction1 AND `prod_branch` = :branch", { replacements: { transaction1: item0.mfg_ref_id, branch: req.branch }, type: invtDB.QueryTypes.SELECT });
            if (stmt4.length > 0) {
              typeOfPPR = stmt4[0].prod_type.toUpperCase();
            } else {
              typeOfPPR = "N/A";
            }

            resData.push({
              mfg_transaction: item0.mfg_transaction,
              mfg_ref_transid_1: item0.mfg_ref_id,
              typeOfPPR: typeOfPPR,
              mfg_full_date: item0.mfg_full_date,
              mfg_sku: item0.mfg_sku,
              p_name: item0.p_name,
              mfg_ref_id: item0.mfg_ref_id,
              mfg_prod_planing_qty: item0.mfg_prod_planing_qty,
              completedQTY: 0,
            });
            // sendResponse();
          }
          count++;
        } else {
          count++;
        }

        // function sendResponse() {
        //   console.log(qtycount, resData.length);
        // while (qtycount == resData.length) {
        //   console.log(qtycount, resData.length);
        //   res.json({ status: "success", success: true, data: resData});
        //   return;
        // }
        // }
        // }); //STM0 END
      }


      if (resData.length > 0) {
        return res.json({ status: "success", success: true, data: resData });
      } else {
        return res.json({ status: "error", success: false, message: "No data found" });
      }

    } else {
      return res.json({ status: "error", success: false, message: "No data found" });
    }
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

// Fetch ALL SKU from FG REQUEST
router.post("/getFGs", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    pprrequest2: "required",
    pprrequest1: "required",
    pprsku: "required",
  });

  if (validation.fails()) {
    return res.json({ status: "error", success: false, message: "Something is missing in form field to supply", data: validation.errors.all() });
  }

  let stmt1 = await invtDB.query(
    "SELECT *, COALESCE( SUM(`mfg_prod_planing_qty`), 0 ) AS totalReqQTY, COALESCE(SUM(`mfg_prod_in`), 0) AS totalINQTY FROM `mfg_production_2` LEFT JOIN `products` ON `mfg_production_2`.`mfg_sku` = `products`.`p_sku` WHERE mfg_production_2.mfg_sku = :sku AND `mfg_production_2`.`mfg_transaction` = :transaction AND `mfg_production_2`.`mfg_ref_id`= :refid AND `mfg_production_2`.`mfg_prod_type` != 'C' AND `mfg_production_2`.`company_branch` = :branch",
    {
      replacements: { sku: req.body.pprsku, transaction: req.body.pprrequest2, refid: req.body.pprrequest1, branch: req.branch },
      type: invtDB.QueryTypes.SELECT,
    }
  );

  let ppr_reqQTY, ppr_productSKU, ppr_productName, ppr_pendingQty, ppr_mfgTransaction, ppr_mfgCompletedQty;
  if (stmt1.length > 0) {
    stmt1.forEach(async (item1) => {
      if (item1.mfg_sku) {
        ppr_reqQTY = item1.totalReqQTY;
        ppr_productSKU = item1.p_sku;
        ppr_productName = item1.p_name;
        ppr_pendingQty = helper.number(item1.totalReqQTY) - helper.number(item1.totalINQTY ?? 0);
        ppr_mfgTransaction = item1.mfg_transaction;
        ppr_mfgCompletedQty = item1.totalINQTY ?? 0;
      } else {
        let stmt2 = await invtDB.query(
          "SELECT *, COALESCE(SUM(`mfg_prod_planing_qty`), 0) AS totalReqQTY FROM `mfg_production_2` LEFT JOIN products ON mfg_production_2.mfg_sku = products.p_sku WHERE mfg_production_2.mfg_sku = :sku AND mfg_production_2.mfg_transaction = :transaction AND mfg_production_2.mfg_ref_id = :refid AND `mfg_production_2`.`company_branch` = :branch",
          {
            replacements: { sku: req.body.pprsku, transaction: req.body.pprrequest2, refid: req.body.pprrequest1, branch: req.branch },
            type: invtDB.QueryTypes.SELECT,
          }
        );
        if (stmt2.length > 0) {
          stmt2.map(async (item2) => {
            ppr_reqQTY = item2.totalReqQTY;
            ppr_productSKU = item2.p_sku;
            ppr_productName = item2.p_name;
            ppr_pendingQty = helper.number(item2.totalReqQTY) - helper.number(item2.totalINQTY ?? 0);
            ppr_mfgTransaction = item2.mfg_transaction;
            ppr_mfgCompletedQty = item2.totalINQTY ?? 0;
          });
        } else {
          return res.json({ status: "error", success: false, message: "Unable to fetch any registered PPR from database" });
        }
      }

      return res.json({
        status: "success", success: true,
        success: true,
        data: { qtyCount: ppr_reqQTY, pprSku: ppr_productSKU, pprName: ppr_productName, pendingQty: ppr_pendingQty, mfgTransaction: ppr_mfgTransaction, completedQty: ppr_mfgCompletedQty, pprTransaction: req.body.pprrequest1 },
      });
    });
  } else {
    let stmt4 = await invtDB.query(
      "SELECT *, COALESCE(SUM(`mfg_prod_planing_qty`), 0) AS totalReqQTY FROM `mfg_production_2` LEFT JOIN products ON mfg_production_2.mfg_sku = products.p_sku WHERE mfg_production_2.mfg_sku = :sku AND mfg_production_2.mfg_transaction = :transaction AND mfg_production_2.mfg_ref_id = :refid AND `mfg_production_2`.`company_branch` = :branch",
      {
        replacements: { sku: req.body.pprsku, transaction: req.body.pprrequest2, refid: req.body.pprrequest1, branch: req.branch },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt4.length > 0) {
      stmt4.forEach(async (item4) => {
        ppr_reqQTY = item4.totalReqQTY;
        ppr_productSKU = item4.p_sku;
        ppr_productName = item4.p_name;
        ppr_pendingQty = helper.number(item4.totalReqQTY) - helper.number(item4.totalINQTY);
        ppr_mfgTransaction = item4.mfg_transaction;
        ppr_mfgCompletedQty = item4.totalINQTY ?? 0;
      });
    } else {
      return res.json({ status: "error", success: false, message: "Unable to fetch any registered PPR" });
    }
  }
});

// INSERT FGIN
router.post("/saveFGs", [auth.isAuthorized, auth.checkDuplicacy_db], async (req, res) => {
  let validation = new Validator(req.body, {
    pprqty: "required|integer|min:1",
    pprrequest1: "required",
    pprrequest2: "required",
  });
  if (validation.fails()) {
    return res.json({ status: "error", success: false, message: "Something is missing in form field to supply", data: validation.errors.all() });
  }
  try {
    const t = await invtDB.transaction();

    let stmt1 = await invtDB.query("SELECT `ID` FROM `mfg_production_3` GROUP BY `ID` ORDER BY `ID` DESC LIMIT 1", { type: invtDB.QueryTypes.SELECT });

    let transactionID;
    if (stmt1.length > 0) {
      transactionID = "FG00" + stmt1[0].ID + 1;
    } else {
      transactionID = "FG001";
    }

    if (helper.number(req.body.pprqty) == "" && helper.number(req.body.pprqty) <= 0) {
      return res.json({ status: "error", success: false, message: "FG inwarding quantity should not be empty, zero, or a negative integer." });
    }

    let stmt2 = await invtDB.query("SELECT * FROM `mfg_production_1` WHERE `prod_transaction` = :pprid AND `prod_branch` = :branch", { replacements: { pprid: req.body.pprrequest1, branch: req.branch }, type: invtDB.QueryTypes.SELECT });
    if (stmt2.length > 0) {
      let stmt3 = await invtDB.query("SELECT * FROM `mfg_production_2` WHERE `mfg_transaction` = :transaction AND `mfg_ref_id` = :refid LIMIT 1", {
        replacements: { transaction: req.body.pprrequest2, refid: req.body.pprrequest1 },
        type: invtDB.QueryTypes.SELECT,
      });
      if (stmt3.length > 0) {
        stmt3.map(async (item3) => {
          //PPR CREATED BY
          let stmt4 = await invtDB.query("SELECT * FROM `admin_login` WHERE `CustID` = :ppr_created_by", { replacements: { ppr_created_by: item3.mfg_ppr_created_by }, type: invtDB.QueryTypes.SELECT });
          let ppr_created_by;
          if (stmt4.length > 0) {
            ppr_created_by = stmt4[0].CustID;
          }

          //MFG CREATED BY
          let stmt5 = await invtDB.query("SELECT * FROM `admin_login` WHERE `CustID` = :mfg_created_by", { replacements: { mfg_created_by: item3.mfg_approved_by }, type: invtDB.QueryTypes.SELECT });
          let mfg_created_by;
          if (stmt5.length > 0) {
            mfg_created_by = stmt5[0].CustID;
          }

          let stmt6 = await invtDB.query("SELECT * FROM `mfg_production_2` WHERE `mfg_prod_type` = :type AND `mfg_transaction` = :transaction AND `mfg_ref_id` = :refid AND `company_branch` = :branch", {
            replacements: { type: "A", transaction: req.body.pprrequest2, refid: req.body.pprrequest1, branch: req.branch },
            type: invtDB.QueryTypes.SELECT,
          });

          let closeApproval;
          if (stmt6.length > 0) {
            let stmt7 = await invtDB.query(
              "SELECT *, COALESCE( SUM(DISTINCT(`mfg_prod_planing_qty`)), 0 ) AS totalPPRQTY, COALESCE(SUM(`mfg_prod_in`), 0) AS approvedQty FROM `mfg_production_2` WHERE `mfg_prod_type` = :type AND `mfg_transaction` = :transaction AND `mfg_ref_id`= :refid AND `company_branch` = :branch LIMIT 1",
              {
                replacements: { type: "A", transaction: req.body.pprrequest2, refid: req.body.pprrequest1, branch: req.branch },
                type: invtDB.QueryTypes.SELECT,
              }
            );
            if (stmt7.length > 0) {
              stmt7.map(async (item7) => {
                if (item7.approvedQty + helper.number(req.body.pprqty) <= item7.totalPPRQTY) {
                  let stmt8 = await invtDB.query(
                    "INSERT INTO `mfg_production_3` (`company_branch`,`mfg_pro_apr_sku`,`mfg_approve_in_qty`,`mfg_pro_apr_by`,`mfg_pro_apr_date`,`mfg_pro_apr_fulldate`,`mfg_pro_apr_transaction`,`mfg_ref_transid_1`,`mfg_ref_transid_2`,`mfg_pro_location_in`,`mfgphase2_insert_date`,`type`,`ppr_created_by`,`mfg_created_by`) VALUES (:branch,:sku, :totalIn, :by, :insertdate, :fulldate, :transaction, :ppr_id, :mfg_id, :location, :mfginsertdate,'IN', :pprcreatedby, :mfgcreatedby)",
                    {
                      replacements: {
                        branch: req.branch,
                        sku: item3.mfg_sku,
                        totalIn: helper.number(req.body.pprqty),
                        by: req.logedINUser,
                        insertdate: moment(new Date()).tz("Asia/Kolkata").format("DD-MM-YYYY"),
                        fulldate: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
                        transaction: transactionID,
                        ppr_id: req.body.pprrequest1,
                        mfg_id: req.body.pprrequest2,
                        location: item7.mfg_send_location,
                        mfginsertdate: item3.mfg_full_date,
                        pprcreatedby: item3.mfg_ppr_created_by,
                        mfgcreatedby: item3.mfg_approved_by,
                      },
                      type: invtDB.QueryTypes.INSERT,
                      transaction: t,
                    }
                  );
                  if (stmt8.length > 0) {
                    let stmt9 = await invtDB.query(
                      "INSERT INTO `fg_location` (`fg_type`,`sku_code`,`fg_loc_in`,`qty`,`ppr_id`,`mfg_id`,`fg_in_transaction`,`ppr_created_by`,`mfg_created_by`,`insert_by`,`mfg_created_dt`,`insert_dt`) VALUES ('IN', :sku, :loc_in, :qty, :ppr_id, :mfg_id, :transaction_id, :ppr_created_by, :mfg_created_by, :insert_by, :mfg_created_dt, :insert_dt)",
                      {
                        replacements: {
                          sku: item3.mfg_sku,
                          loc_in: item7.mfg_send_location,
                          qty: helper.number(req.body.pprqty),
                          ppr_id: req.body.pprrequest1,
                          mfg_id: req.body.pprrequest2,
                          transaction_id: transactionID,
                          ppr_created_by: ppr_created_by,
                          mfg_created_by: mfg_created_by,
                          insert_by: req.logedINUser,
                          mfg_created_dt: item3.mfg_full_date,
                          insert_dt: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
                        },
                        type: invtDB.QueryTypes.INSERT,
                        transaction: t,
                      }
                    );
                    if (stmt9.length > 0) {
                      let stmt10 = await invtDB.query(
                        "UPDATE `mfg_production_2` SET `mfg_sku` = :sku, `mfg_prod_planing_qty` = :planingqty, `mfg_prod_in` = mfg_prod_in + :totalIn, `mfg_transaction` = :transaction, `mfg_ref_id` = :refid WHERE `mfg_transaction` = :transaction AND `mfg_ref_id` = :refid AND `mfg_prod_type` = 'A'",
                        {
                          replacements: { sku: item3.mfg_sku, planingqty: item7.mfg_prod_planing_qty, totalIn: helper.number(req.body.pprqty), transaction: req.body.pprrequest2, refid: req.body.pprrequest1 },
                          type: invtDB.QueryTypes.UPDATE,
                          transaction: t,
                        }
                      );

                      if (item7.approvedQty == item7.totalPPRQTY) {
                        closeApproval = 0; //close approval
                      } else {
                        closeApproval = 1; //open approval
                      }
                      if (stmt10.length > 0) {
                        t.commit();
                        return res.json({ status: "success", success: true, message: "PPR Updated.", data: { totalInUpdated: item7.totalPPRQTY + " / " + (item7.approvedQty + helper.number(req.body.pprqty)), isActive: closeApproval } });
                      } else {
                        t.rollback();
                        return res.json({ status: "error", success: false, message: "An error occurred while executing your request (3). Contact system administrator.", data: { isActive: 1 } });
                      }
                    } else {
                      t.rollback();
                      return res.json({ status: "error", success: false, message: "An error occurred while executing your request (2). Contact system administrator." });
                    }
                  } else {
                    t.rollback();
                    return res.json({ status: "error", success: false, message: "An error occurred while executing your request (1). Contact system administrator." });
                  }
                } else if (item7.approvedQty == item7.totalPPRQTY) {
                  return res.json({ status: "error", success: false, message: "No pending quantity found." });
                } else {
                  return res.json({ status: "error", success: false, message: "Quantity should be less than PPR quantity." });
                }
              });
            } else {
              return res.json({ status: "error", success: false, message: "An error occurred while handling your request." });
            }
          } else {
            let stmt11 = await invtDB.query(
              "SELECT *, COALESCE( SUM(`mfg_prod_planing_qty`), 0 ) AS totalPPRQTY, COALESCE(SUM(`mfg_prod_in`), 0) AS approvedQty FROM `mfg_production_2` WHERE `mfg_transaction` = :transaction AND `mfg_ref_id`= :refid AND `company_branch` = :branch",
              {
                replacements: { transaction: req.body.pprrequest2, refid: req.body.pprrequest1, branch: req.branch },
                type: invtDB.QueryTypes.SELECT,
              }
            );
            if (stmt11.length > 0) {
              stmt11.map(async (item11) => {
                //PPR CREATED BY
                let stmt12 = await invtDB.query("SELECT * FROM `admin_login` WHERE `CustID` = :ppr_created_by", { replacements: { ppr_created_by: item11.mfg_ppr_created_by }, type: invtDB.QueryTypes.SELECT });

                let ppr_created_by;
                if (stmt12.length > 0) {
                  ppr_created_by = stmt12[0].CustID;
                }

                //MFG CREATED BY
                let stmt13 = await invtDB.query("SELECT * FROM `admin_login` WHERE `CustID` = :mfg_created_by", { replacements: { mfg_created_by: item11.mfg_approved_by }, type: invtDB.QueryTypes.SELECT });

                let mfg_created_by;
                if (stmt13.length > 0) {
                  mfg_created_by = stmt13[0].CustID;
                }

                if (item11.approvedQty + helper.number(req.body.pprqty) <= item11.totalPPRQTY) {
                  let stmt14 = await invtDB.query(
                    "INSERT INTO `mfg_production_3` (`company_branch`,`mfg_pro_apr_sku`,`mfg_approve_in_qty`,`mfg_pro_apr_by`,`mfg_pro_apr_date`,`mfg_pro_apr_fulldate`,`mfg_pro_apr_transaction`,`mfg_ref_transid_1`,`mfg_ref_transid_2`,`mfg_pro_location_in`,`mfgphase2_insert_date`,`type`,`ppr_created_by`,`mfg_created_by`) VALUES (:branch,:sku, :totalIn, :by, :insertdate, :fulldate, :transaction, :ppr_id, :mfg_id, :location, :mfginsertdate, 'IN', :pprcreatedby, :mfgcreatedby)",
                    {
                      replacements: {
                        branch: req.branch,
                        sku: item11.mfg_sku,
                        totalIn: helper.number(req.body.pprqty),
                        by: req.logedINUser,
                        insertdate: moment(new Date()).tz("Asia/Kolkata").format("DD-MM-YYYY"),
                        fulldate: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
                        transaction: transactionID,
                        ppr_id: req.body.pprrequest1,
                        mfg_id: req.body.pprrequest2,
                        location: item11.mfg_con_location,
                        mfginsertdate: item11.mfg_full_date,
                        pprcreatedby: item11.mfg_ppr_created_by,
                        mfgcreatedby: item11.mfg_approved_by,
                      },
                      type: invtDB.QueryTypes.INSERT,
                      transaction: t,
                    }
                  );
                  if (stmt14.length > 0) {
                    let stmt15 = await invtDB.query(
                      "INSERT INTO `fg_location` (`fg_type`,`sku_code`,`fg_loc_in`,`qty`,`ppr_id`,`mfg_id`,`fg_in_transaction`,`ppr_created_by`,`mfg_created_by`,`insert_by`,`mfg_created_dt`,`insert_dt`) VALUES ('IN', :sku, :loc_in, :qty, :ppr_id, :mfg_id, :transaction_id, :ppr_created_by, :mfg_created_by, :insert_by, :mfg_created_dt, :insert_dt)",
                      {
                        replacements: {
                          sku: item11.mfg_sku,
                          loc_in: item11.mfg_con_location,
                          qty: helper.number(req.body.pprqty),
                          ppr_id: req.body.pprrequest1,
                          mfg_id: req.body.pprrequest2,
                          transaction_id: transactionID,
                          ppr_created_by: item11.mfg_ppr_created_by,
                          mfg_created_by: item11.mfg_approved_by,
                          insert_by: req.logedINUser,
                          mfg_created_dt: item11.mfg_full_date,
                          insert_dt: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
                        },
                        type: invtDB.QueryTypes.INSERT,
                        transaction: t,
                      }
                    );
                    if (stmt15.length > 0) {
                      let stmt16 = await invtDB.query(
                        "INSERT INTO `mfg_production_2` (`company_branch`,`mfg_sku`,`mfg_prod_planing_qty`,`mfg_prod_in`,`mfg_transaction`,`mfg_ref_id`,`mfg_prod_type`,`mfg_send_location`) VALUES (:branch,:sku, :planingqty, :totalIn, :mfg_id, :ppr_id, :type, :location)",
                        {
                          replacements: {
                            branch: req.branch,
                            sku: item11.mfg_sku,
                            planingqty: item11.mfg_prod_planing_qty,
                            totalIn: helper.number(req.body.pprqty),
                            ppr_id: req.body.pprrequest1,
                            mfg_id: req.body.pprrequest2,
                            type: "A",
                            location: item11.mfg_con_location,
                          },
                          type: invtDB.QueryTypes.INSERT,
                          transaction: t,
                        }
                      );

                      if (item11.approvedQty == item11.totalPPRQTY) {
                        closeApproval = 0; // close approval
                      } else {
                        closeApproval = 1; // open approval
                      }

                      if (stmt16.length > 0) {
                        t.commit();
                        return res.json({ status: "success", success: true, message: "PPR Updated.", data: { totalInUpdated: item11.totalPPRQTY + " / " + (item11.approvedQty + helper.number(req.body.pprqty)), isActive: closeApproval } });
                      } else {
                        t.rollback();
                      }
                    } else {
                      t.rollback();
                      return res.json({ status: "error", success: false, message: "An error occurred while executing your request (5). Contact system administrator." });
                    }
                  } else {
                    t.rollback();
                    return res.json({ status: "error", success: false, message: "An error occurred while executing your request (4). Contact system administrator." });
                  }
                } else if (item11.approvedQty == item11.totalPPRQTY) {
                  t.rollback();
                  return res.json({ status: "error", success: false, message: "No pending quantity available." });
                } else {
                  t.rollback();
                  return res.json({ status: "error", success: false, message: "Quantity should be less than PPR quantity." });
                }
              });
            }
          }
        });
      } else {
        return res.json({ status: "error", success: false, message: "An error occurred while handling your request." });
      }
    } else {
      return res.json({ status: "error", success: false, message: "Unable to fetch any registered PPR" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// FETCH ALL COMPLTED FG
router.post("/fgInCompleted", [auth.isAuthorized], async (req, res) => {
  const searchBy = req.body.searchBy;
  const searchValue = req.body.searchValue;

  let validation = new Validator(req.body, {
    searchBy: "required",
    searchValue: "required",
  });

  if (validation.fails()) {
    return res.json({ status: "error", success: false, message: helper.firstErrorValidatorjs(validation) });
  }

  try {
    let stmt0 = [];
    if (req.body.searchBy == "datewise") {
      const date = searchValue.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);

      const fromdate = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
      const todate = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");
      const durationInMonths = moment(date[1], "DD-MM-YYYY").diff(moment(date[0], "DD-MM-YYYY"), "months");
      if (durationInMonths > 3) {
        return res.json({
          status: "error", success: false,
          success: false,
          message: "As of Nov 11, 2021, we can only provide 90 days (3 months) of data.",
        });
      }

      stmt0 = await invtDB.query(
        "SELECT `mfg_production_2`.`mfg_sku`, `mfg_production_2`.`mfg_ref_id`, `mfg_production_2`.`mfg_transaction`, `mfg_production_2`.`mfg_prod_type`, `mfg_production_2`.mfg_prod_planing_qty, `products`.`p_sku`, `products`.`p_name`, COALESCE( SUM( `mfg_production_2`.`mfg_prod_planing_qty` ), 0 ) AS `totalReqQty`, IF(`table1`.`testAMT` IS NULL, '0', `table1`.`testAMT`) AS `testAMT`, `mfg_production_2`.`mfg_full_date` FROM `mfg_production_2` LEFT JOIN(SELECT `mfg_ref_id`, `mfg_transaction`, `mfg_prod_planing_qty`, COALESCE(SUM(`mfg_prod_in`), 0) AS `testAMT`, `mfg_prod_type` FROM `mfg_production_2` GROUP BY `mfg_transaction`,`mfg_ref_id`) `table1` ON `mfg_production_2`.`mfg_transaction` = `table1`.`mfg_transaction` AND `mfg_production_2`.`mfg_ref_id` = `table1`.`mfg_ref_id` LEFT JOIN `products` ON `mfg_production_2`.`mfg_sku` = `products`.`p_sku` WHERE `mfg_production_2`.`mfg_prod_type` = 'C' AND DATE_FORMAT(`mfg_production_2`.`mfg_full_date`,'%Y-%m-%d') BETWEEN :date1 AND :date2 GROUP BY `mfg_production_2`.`mfg_transaction`,`mfg_production_2`.`step_count` ORDER BY `mfg_production_2`.`ID` DESC",
        {
          replacements: { date1: fromdate, date2: todate },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    } else if (req.body.searchBy == "skuwise") {
      let checkSku = await invtDB.query("SELECT * FROM `products` WHERE `p_sku` = :sku_code", { replacements: { sku_code: req.body.searchValue }, type: invtDB.QueryTypes.SELECT });
      if (checkSku.length == 0) {
        return res.json({ status: "error", success: false, message: "Invalid SKU" });
      } else {
        product_sku = checkSku[0].p_sku;
      }
      stmt0 = await invtDB.query(
        "SELECT `mfg_production_2`.`mfg_sku`, `mfg_production_2`.`mfg_ref_id`, `mfg_production_2`.`mfg_transaction`, `mfg_production_2`.`mfg_prod_type`, `mfg_production_2`.mfg_prod_planing_qty, `products`.`p_sku`, `products`.`p_name`, COALESCE( SUM( `mfg_production_2`.`mfg_prod_planing_qty` ), 0 ) AS `totalReqQty`, IF(`table1`.`testAMT` IS NULL, '0', `table1`.`testAMT`) AS `testAMT`, `mfg_production_2`.`mfg_full_date` FROM `mfg_production_2` LEFT JOIN(SELECT `mfg_ref_id`, `mfg_transaction`, `mfg_prod_planing_qty`, COALESCE(SUM(`mfg_prod_in`), 0) AS `testAMT`, `mfg_prod_type` FROM `mfg_production_2` GROUP BY `mfg_transaction`,`mfg_ref_id`) `table1` ON `mfg_production_2`.`mfg_transaction` = `table1`.`mfg_transaction` AND `mfg_production_2`.`mfg_ref_id` = `table1`.`mfg_ref_id` LEFT JOIN `products` ON `mfg_production_2`.`mfg_sku` = `products`.`p_sku` WHERE `mfg_production_2`.`mfg_prod_type` = 'C' AND `mfg_production_2`.`mfg_sku` LIKE CONCAT('%', :sku_code, '%') GROUP BY `mfg_production_2`.`mfg_transaction`,`mfg_production_2`.`step_count` ORDER BY `mfg_production_2`.`ID` DESC",
        {
          replacements: { sku_code: product_sku },
          type: invtDB.QueryTypes.SELECT,
        }
      );
    }

    if (stmt0.length > 0) {
      let resData = [];
      let count = 0;
      stmt0.map(async (item0) => {
        if (helper.number(item0.totalReqQty) <= helper.number(item0.testAMT)) {
          count++;
          let completedQTY;
          let typeOfPPR;
          let stmt1 = await invtDB.query(
            "SELECT `mfg_pro_apr_sku`, `mfg_ref_transid_2`, `mfg_ref_transid_1`, `mfg_approve_in_qty`, `mfg_pro_apr_fulldate`, COALESCE( SUM(`mfg_approve_in_qty`), 0 ) AS totalApprovedQty FROM `mfg_production_3` WHERE `mfg_ref_transid_1` = :transaction1 AND `mfg_ref_transid_2` = :transaction2 GROUP BY mfg_production_3.mfg_ref_transid_2",
            {
              replacements: { transaction1: item0.mfg_ref_id, transaction2: item0.mfg_transaction },
              type: invtDB.QueryTypes.SELECT,
            }
          );
          if (stmt1.length > 0) {
            stmt1.map(async (item1) => {
              let stmt2 = await invtDB.query("SELECT COALESCE(SUM(mfg_approve_in_qty),0) AS totalApprovedQty FROM `mfg_production_3` WHERE mfg_pro_apr_sku = :sku AND `mfg_ref_transid_1` = :transaction1 AND mfg_ref_transid_2 = :transaction2", {
                replacements: { sku: item1.mfg_pro_apr_sku, transaction1: item1.mfg_ref_transid_1, transaction2: item1.mfg_ref_transid_2 },
                type: invtDB.QueryTypes.SELECT,
              });

              if (stmt2.length > 0) {
                completedQTY = stmt2[0].totalApprovedQty ?? 0;
              } else {
                completedQTY = 0;
              }

              let stmt3 = await invtDB.query("SELECT prod_type FROM `mfg_production_1` WHERE `prod_transaction` = :transaction1", {
                replacements: { transaction1: item1.mfg_ref_transid_1 },
                type: invtDB.QueryTypes.SELECT,
              });
              if (stmt3.length > 0) {
                typeOfPPR = stmt3[0].prod_type.toUpperCase();
              } else {
                typeOfPPR = "N/A";
              }
              resData.push({
                mfg_transaction: item0.mfg_transaction,
                ppr_transaction: item0.mfg_ref_id,
                ppr_type: typeOfPPR,
                mfg_date: moment(item1.mfg_pro_apr_fulldate).tz("Asia/Kolkata").format("DD-MM-YYYY HH:mm:ss"),
                ppr_sku: item0.mfg_sku,
                sku_name: item0.p_name,
                completed_qty: item0.mfg_prod_planing_qty + "/" + completedQTY,
              });
              sendRes();
            });
          } else {
            let stmt4 = await invtDB.query("SELECT prod_type FROM `mfg_production_1` WHERE `prod_transaction` = :transaction1", {
              replacements: { transaction1: item0.mfg_ref_id },
              type: invtDB.QueryTypes.SELECT,
            });
            if (stmt4.length > 0) {
              typeOfPPR = stmt4[0].prod_type.toUpperCase();
            } else {
              typeOfPPR = "N/A";
            }

            resData.push({
              mfg_transaction: item0.mfg_transaction,
              ppr_transaction: item0.mfg_ref_id,
              ppr_type: typeOfPPR,
              mfg_date: item0.mfg_full_date,
              ppr_sku: item0.mfg_sku,
              sku_name: item0.p_name,
              completed_qty: item0.mfg_prod_planing_qty + "/" + completedQTY,
            });
            sendRes();
          }
        }
      });

      function sendRes() {
        if (resData.length == count) {
          res.json({ status: "success", success: true, data: resData });
          return;
        }
      }
    } else {
      return res.json({ status: "error", success: false, message: "No Data Found" });
    }
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

module.exports = router;
