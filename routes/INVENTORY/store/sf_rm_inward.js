const express = require("express");
const router = express.Router();

let { invtDB, otherDB } = require("../../../config/db/connection");

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");

const Validator = require("validatorjs");

// SF TO SF999 TRANSFER LIST
router.post("/sfMinTransferList", [auth.isAuthorized], async (req, res) => {
  try {
    const validation = new Validator(req.body, {
      date: "required",
    });

    if (validation.fails()) {
      return res.json({
        status: "error",
        success: false,
        message: helper.firstErrorValidatorjs(validation),
      });
    }

    const date = req.body.date.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
    const fromdate = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
    const todate = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

    const stmt = await invtDB.query(
      "SELECT sf_rm_inward.*, admin_login.user_name FROM sf_rm_inward LEFT JOIN admin_login ON admin_login.CustID = sf_rm_inward.insert_by WHERE DATE_FORMAT(sf_rm_inward.insert_date, '%Y-%m-%d') BETWEEN :fromdate AND :todate AND sf_rm_status = 'P' GROUP BY transaction_id",
      {
        replacements: {
          fromdate: fromdate,
          todate: todate,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length == 0) {
      return res.json({
        status: "error",
        success: false,
        message: "No Data Found",
      });
    }

    const data = [];

    for (let i = 0; i < stmt.length; i++) {
      data.push({
        trans_id: stmt[i].transaction_id,
        remark: stmt[i].any_remark,
        insert_date: moment(stmt[i].insert_date, "YYYY-MM-DD HH:mm:ss").format(
          "DD-MM-YYYY HH:mm:ss"
        ),
        insert_by: stmt[i].user_name,
      });
    }

    return res.json({
      status: "success",
      success: true,
      message: "",
      data: data,
    });
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

// SF MIN TRANSCTION DETAIL
router.post("/sfMinTransferDetail", [auth.isAuthorized], async (req, res) => {
  try {
    const validation = new Validator(req.body, {
      trans_id: "required",
    });

    if (validation.fails()) {
      return res.json({
        status: "error",
        success: false,
        message: helper.firstErrorValidatorjs(validation),
      });
    }

    const stmt = await invtDB.query(
      "SELECT sf_rm_inward.*, components.c_name, components.c_part_no, units.units_name, ( SELECT JSON_OBJECT('rate', `rm_location`.`in_po_rate`, 'currency', `ims_currency`.`currency_symbol`) FROM `rm_location` LEFT JOIN `ims_currency` ON `rm_location`.`currency_type` = `ims_currency`.`currency_id` WHERE `rm_location`.`trans_type` = 'INWARD' AND `rm_location`.`components_id` = sf_rm_inward.components_id ORDER BY `rm_location`.`ID` DESC LIMIT 1 ) AS last_rate FROM sf_rm_inward LEFT JOIN components ON components.component_key = sf_rm_inward.components_id LEFT JOIN units ON units.units_id = components.c_uom WHERE transaction_id = :trans_id AND sf_rm_status = 'P'",
      {
        replacements: {
          trans_id: req.body.trans_id,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length == 0) {
      return res.json({
        status: "error",
        success: false,
        message: "No Data Found",
      });
    }

    const data = [];

    for (let i = 0; i < stmt.length; i++) {
      data.push({
        serial: i + 1,
        trans_id: stmt[i].transaction_id,
        components_id: stmt[i].components_id,
        part: stmt[i].c_part_no,
        name: stmt[i].c_name,
        qty: stmt[i].qty,
        uom: stmt[i].units_name,
        remark: stmt[i].any_remark,
        rate: JSON.parse(stmt[i].last_rate).rate,
        currency: JSON.parse(stmt[i].last_rate).currency,
      });
    }

    return res.json({
      status: "success",
      success: true,
      message: "",
      data: data,
    });
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

// SF MIN TRANSCTION INWARD AS PRODUCTION RETURN
router.post(
  "/sfMinInward",
  [auth.isAuthorized, auth.checkDuplicacy_db],
  async (req, res) => {
    const transaction = await invtDB.transaction();
    try {
      const validation = new Validator(req.body, {
        trans_id: "required",
      });

      if (validation.fails()) {
        await transaction.rollback();
        return res.json({
          status: "error",
          success: false,
          message: helper.firstErrorValidatorjs(validation),
        });
      }

      const component_length = req.body.components.length;
      const location_length = req.body.location.length;

      if (component_length == 0) {
        await transaction.rollback();
        return res.json({
          status: "error",
          success: false,
          message: "Select components",
        });
      }

      if (location_length == 0) {
        await transaction.rollback();
        return res.json({
          status: "error",
          success: false,
          message: "Select location",
        });
      }

      for (let i = 0; i < component_length; i++) {
        const valid_comp = new Validator(
          {
            components: req.body.components[i],
            location: req.body.location[i],
            qty: req.body.qty[i],
            rate: req.body.rate[i],
          },
          {
            components: "required",
            location: "required",
            qty: "required|not_in:0",
            rate: "required|min:0",
          }
        );

        if (valid_comp.fails()) {
          await transaction.rollback();
          return res.json({
            status: "error",
            success: false,
            message: helper.firstErrorValidatorjs(valid_comp),
          });
        }
      }

      // MIN NUMBERING
      var in_txn_no = await helper.genTransaction("MIN", transaction);
      let out_txn_no = helper.getUniqueNumber(); //Transaction OUT ID

      // END MIN NUMBERING

      for (let i = 0; i < component_length; i++) {
        // CHECK COMPONENT
        const stmt_check = await invtDB.query(
          "SELECT * FROM sf_rm_inward WHERE components_id = :components_id AND transaction_id = :trans_id AND sf_rm_status = 'P' ",
          {
            replacements: {
              trans_id: req.body.trans_id,
              components_id: req.body.components[i],
            },
            type: invtDB.QueryTypes.SELECT,
            transaction: transaction,
          }
        );

        if (stmt_check.length <= 0) {
          await transaction.rollback();
          return res.json({
            status: "error",
            success: false,
            message: `component row ${i + 1} is already returned or not found `,
          });
        }
        // END CHECK COMPONENT

        if (stmt_check[0].qty != req.body.qty[i]) {
          await transaction.rollback();
          return res.json({
            status: "error",
            success: false,
            message: `component row ${i + 1} qty is not matched `,
          });
        }
        // ISSUE FROM SF INWARD
        let stmt_sf_out = await invtDB.query(
          "INSERT INTO  rm_location  ( company_branch , trans_type , components_id , loc_out , qty , insert_date , insert_by, in_transaction_id , out_transaction_id, in_po_rate )VALUES (:branch, :type, :component, :loc_out, :qty, :indate, :inby, :in_transaction_id , :out_transaction_id, :rate)",
          {
            replacements: {
              branch: req.branch,
              type: "ISSUE",
              component: req.body.components[i],
              loc_out: stmt_check[0].loc_in,
              qty: stmt_check[0].qty,
              indate: moment(new Date()).format("YYYY-MM-DD HH:mm:ss"),
              inby: req.logedINUser,
              in_transaction_id: in_txn_no,
              out_transaction_id: out_txn_no,
              rate: req.body.rate[i],
            },
            type: invtDB.QueryTypes.INSERT,
            transaction: transaction,
          }
        );
        // INSERT RM LOCATION
        const stmt_insert = await invtDB.query(
          "INSERT INTO  rm_location  ( in_module, inward_type,company_branch , vendor_type , components_id , loc_in , qty , insert_date , insert_by , in_transaction_id , any_remark , rm_loc_cost_center ,rm_loc_project_id , in_po_rate)VALUES ('IN-SF-INWARD','SF999', :branch, :vendor_type, :components_id, :location_in, :qty, :insertdate, :insertby, :trans_id, :comment , :cost_center, :project, :rate )",
          {
            replacements: {
              trans_id: in_txn_no,
              branch: req.branch,
              components_id: req.body.components[i],
              location_in: req.body.location[i],
              qty: stmt_check[0].qty,
              insertdate: moment(new Date()).format("YYYY-MM-DD HH:mm:ss"),
              insertby: req.logedINUser,
              comment: req.body.remark[i] ?? "--",
              vendor_type: "p01",
              cost_center: req.body.costCenter ?? "--",
              project: req.body.projectId ?? "--",
              rate: req.body.rate[i],
            },
            type: invtDB.QueryTypes.INSERT,
            transaction: transaction,
          }
        );

        const stmt_update = await invtDB.query(
          "UPDATE sf_rm_inward SET sf_rm_status = 'A' WHERE components_id = :components_id AND transaction_id = :trans_id ",
          {
            replacements: {
              components_id: req.body.components[i],
              trans_id: req.body.trans_id,
            },
            type: invtDB.QueryTypes.UPDATE,
            transaction: transaction,
          }
        );
      }

      await transaction.commit();
      return res.json({
        status: "success",
        success: true,
        message: `MIN TXN [${in_txn_no}] has been created`,
        data: {},
      });
    } catch (error) {
      console.log(error);
      return helper.errorResponse(res, error);
    }
  }
);

module.exports = router;
