const express = require("express");
const router = express.Router();

let { tallyDB, invtDB } = require("../../../config/db/connection");

const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");


const Validator = require("validatorjs");

// FETCH ONLY LEDGER
router.post("/fetchLedger", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt;
    if (req.body.search == null || req.body.search == "" || req.body.search == undefined) {
      stmt = await tallyDB.query("SELECT ledger_key, code ,ladger_name FROM `tally_ledger` WHERE `ledger_type` = 'L' LIMIT 50", {
        type: tallyDB.QueryTypes.SELECT,
      });
    } else {
      stmt = await tallyDB.query("SELECT ledger_key, code ,ladger_name FROM `tally_ledger` WHERE `ledger_type` = 'L' AND (`code` like :name OR `ladger_name` LIKE :name) LIMIT 50", {
        replacements: { name: `%${req.body.search}%` },
        type: tallyDB.QueryTypes.SELECT,
      });
    }

    if (stmt.length > 0) {
      let final = [];

      for (let i = 0; i < stmt.length; i++) {
        final.push({
          id: stmt[i].ledger_key,
          text: `(${stmt[i].code})${stmt[i].ladger_name}`,
        });
      }
      return res.json({ data: final, status: "success", success: true });
    } else {
      return res.json({ status: "error", success: false, message: "Data not found" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});
//FETCH ONLY VENDOR LEDGER
router.post("/fetchVendorLedger", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt;
    if (req.body.search == null || req.body.search == "" || req.body.search == undefined) {
      stmt = await tallyDB.query("SELECT ledger_key, code ,ladger_name FROM `tally_ledger` WHERE `ledger_type` = 'V' LIMIT 50", {
        type: tallyDB.QueryTypes.SELECT,
      });
    } else {
      stmt = await tallyDB.query("SELECT ledger_key, code ,ladger_name FROM `tally_ledger` WHERE `ledger_type` = 'V' AND (`code` like :name OR `ladger_name` LIKE :name) LIMIT 50", {
        replacements: { name: `%${req.body.search}%` },
        type: tallyDB.QueryTypes.SELECT,
      });
    }

    if (stmt.length > 0) {
      let final = [];

      for (let i = 0; i < stmt.length; i++) {
        final.push({
          id: stmt[i].ledger_key,
          text: `(${stmt[i].code})${stmt[i].ladger_name}`,
        });
      }
      return res.json({ data: final, status: "success", success: true });
    } else {
      return res.json({ status: "error", success: false, message: "Data not found" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// FETCH ONLY BANK LEDGER
router.post("/fetchBankLedger", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt;
    if (req.body.search == null || req.body.search == "" || req.body.search == undefined) {
      stmt = await tallyDB.query("SELECT ledger_key, code ,ladger_name FROM `tally_ledger` WHERE `ledger_type` = 'B' LIMIT 50", {
        type: tallyDB.QueryTypes.SELECT,
      });
    } else {
      stmt = await tallyDB.query("SELECT ledger_key, code ,ladger_name FROM `tally_ledger` WHERE `ledger_type` = 'B' AND (`code` like :name OR `ladger_name` LIKE :name) LIMIT 50", {
        replacements: { name: `%${req.body.search}%` },
        type: tallyDB.QueryTypes.SELECT,
      });
    }

    if (stmt.length > 0) {
      let final = [];

      for (let i = 0; i < stmt.length; i++) {
        final.push({
          id: stmt[i].ledger_key,
          text: `(${stmt[i].code})${stmt[i].ladger_name}`,
        });
      }
      return res.json({ data: final, status: "success", success: true });
    } else {
      return res.json({ status: "error", success: false, message: "Data not found" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});
// FETCH ONLY CASH LEDEGR
router.post("/fetchCashLedger", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt;
    if (req.body.search == null || req.body.search == "" || req.body.search == undefined) {
      stmt = await tallyDB.query("SELECT ledger_key, code ,ladger_name FROM `tally_ledger` WHERE `ledger_type` = 'CA' LIMIT 50", {
        type: tallyDB.QueryTypes.SELECT,
      });
    } else {
      stmt = await tallyDB.query("SELECT ledger_key, code ,ladger_name FROM `tally_ledger` WHERE `ledger_type` = 'CA' AND (`code` like :name OR `ladger_name` LIKE :name) LIMIT 50", {
        replacements: { name: `%${req.body.search}%` },
        type: tallyDB.QueryTypes.SELECT,
      });
    }

    if (stmt.length > 0) {
      let final = [];

      for (let i = 0; i < stmt.length; i++) {
        final.push({
          id: stmt[i].ledger_key,
          text: `(${stmt[i].code})${stmt[i].ladger_name}`,
        });
      }
      return res.json({ data: final, status: "success", success: true });
    } else {
      return res.json({ status: "error", success: false, message: "Data not found" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// FETCH ONLY CUSTUMER LEDGER
router.post("/fetchCustumerLedger", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt;
    if (req.body.search == null || req.body.search == "" || req.body.search == undefined) {
      stmt = await tallyDB.query("SELECT ledger_key, code ,ladger_name FROM `tally_ledger` WHERE `ledger_type` = 'CU' LIMIT 50", {
        type: tallyDB.QueryTypes.SELECT,
      });
    } else {
      stmt = await tallyDB.query("SELECT ledger_key, code ,ladger_name FROM `tally_ledger` WHERE `ledger_type` = 'CU' AND (`code` like :name OR `ladger_name` LIKE :name) LIMIT 50", {
        replacements: { name: `%${req.body.search}%` },
        type: tallyDB.QueryTypes.SELECT,
      });
    }

    if (stmt.length > 0) {
      let final = [];

      for (let i = 0; i < stmt.length; i++) {
        final.push({
          id: stmt[i].ledger_key,
          text: `(${stmt[i].code})${stmt[i].ladger_name}`,
        });
      }
      return res.json({ data: final, status: "success", success: true });
    } else {
      return res.json({ status: "error", success: false, message: "Data not found" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

// FETCH CUSTOMER OPTION
router.post("/fetchCustmors", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt;
    if (req.body.search == null || req.body.search == "" || req.body.search == undefined) {
      stmt = await tallyDB.query("SELECT code, name FROM `client_basic_detail`  LIMIT 50", {
        type: tallyDB.QueryTypes.SELECT,
      });
    } else {
      stmt = await tallyDB.query("SELECT code, name FROM `client_basic_detail` WHERE  (`code` like :name OR `name` LIKE :name) LIMIT 50", {
        replacements: { name: `%${req.body.search}%` },
        type: tallyDB.QueryTypes.SELECT,
      });
    }

    if (stmt.length > 0) {
      let final = [];

      for (let i = 0; i < stmt.length; i++) {
        final.push({
          id: stmt[i].code,
          text: `(${stmt[i].code})${stmt[i].name}`,
        });
      }
      return res.json({ data: final, status: "success", success: true } );
    } else {
      return res.json({ status: "error", success: false, message: "Data not found" });
    }
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

router.get("/states", async (req, res) => {
  try {
    let stmt = await tallyDB.query("SELECT * FROM `state_code`", {
      type: tallyDB.QueryTypes.SELECT,
    });
    if (stmt.length > 0) {
      let finalData = [];
      for (let i = 0; i < stmt.length; i++) {
        finalData.push({
          code: stmt[i].id,
          name: stmt[i].name,
        });
      }
      return res.json({ data: finalData, status: "success", success: true });
    } else {
      return res.json({ status: "error", success: false, message: "Something went wrong" });
    }
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

router.get("/countries", async (req, res) => {
  try {
    let stmt = await tallyDB.query("SELECT * FROM `country`", {
      type: tallyDB.QueryTypes.SELECT,
    });
    if (stmt.length > 0) {
      let finalData = [];
      for (let i = 0; i < stmt.length; i++) {
        finalData.push({
          code: stmt[i].ID,
          name: stmt[i].name,
        });
      }
      return res.json({ data: finalData, status: "success", success: true });
    } else {
      return res.json({ status: "error", success: false, message: "Something went wrong" });
    }
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

module.exports = router;
