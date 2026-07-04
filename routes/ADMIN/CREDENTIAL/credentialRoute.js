const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");

const Validator = require("validatorjs");

const helper = require("../../../helper/helper");

const auth = require("../../../middleware/auth");
const { invtDB} = require("../../../config/db/connection");

const permission = require("../../../middleware/permission");

const getCredentials = async (req, res, credential_key) => {
  try {
    const result = await invtDB.query("SELECT * FROM `credentials` WHERE `credential_key` = :credential_key", {
      replacements: { credential_key: credential_key },
      type: invtDB.QueryTypes.SELECT,
    });
    console.log(result);

    if (result.length == 0) {
      return res.status(400).json({ success: false, message: "Credential settings not found!!!" });
    }

    if (result.length > 0) {
      let credential_data = JSON.parse(result[0].credential_data);


      for (let i = 0; i < credential_data.length; i++) {
        let cValue = credential_data[i].value;
        credential_data[i].value = await jwt.verify(cValue, process.env.CREDENTIAL_TOKEN);
      }

      const data = {
        code: result[0].credential_key,
        name: result[0].credential_name,
        data: credential_data,
        updated: moment(result[0].last_updated, "YYYY-MM-DD HH:mm:ss").format("DD-MM-YYYY HH:mm:ss"),
      };

      return res.status(200).json({ success: true, data: data });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
};



router.get("/getfynCredentials",  async (req, res, next) => {
  try {
    await getCredentials(req, res, req.body.code);
    return;
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// router.get("/getfynToken", [auth.isAuthorized], async (req, res, next) => {
//   try {
//     await getCredentials(req, res, req.body.code);
//     return;
//   } catch (err) {
//     return res.status(500).json({ success: false, error: err });
//   }
// });

router.post("/updateCredentials",  async (req, res, next) => {
  const transaction = await invtDB.transaction();
  try {
    const validation = new Validator(req.body, {
      code: "required",
      data: "required|array",
    });
    if (validation.fails()) {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: helper.firstErrorValidatorjs(validation) });
    }

    const credential = await invtDB.query("SELECT * FROM credentials WHERE credential_key = :credential_key", {
      replacements: { credential_key: req.body.code },
      type: invtDB.QueryTypes.SELECT,
    });

    if (credential.length == 0) {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: "Credential settings not found!!!" });
    }

    // const saveInLog = await utills.saveupdateLog({
    //   module: "credentials",
    //   module_key: req.body.code,
    //   data: credential,
    //   transaction: transaction,
    // });

    const dbFeild = JSON.parse(credential[0].credential_data);
    const userFeild = req.body.data;

    // VALID FILED MATCH
    let dbFieldno = Object.keys(dbFeild).length;
    let userFieldno = Object.keys(userFeild).length;
    if (dbFieldno != userFieldno) {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: "Field not match!!!" });
    }

    //   VALID FILED CODE
    let dbFieldCode = Object.keys(dbFeild).map((key) => dbFeild[key].field_code);
    let userFieldCode = Object.keys(userFeild).map((key) => userFeild[key].field_code);
    for (let i = 0; i < dbFieldCode.length; i++) {
      if (!userFieldCode.includes(dbFieldCode[i])) {
        await transaction.rollback();
        return res.status(400).json({ success: false, message: "Invalid Field!!!" });
      }
    }

    //   VALID FILED LABEL
    let dbFieldLable = Object.keys(dbFeild).map((key) => dbFeild[key].field_lable);
    let userFieldLable = Object.keys(userFeild).map((key) => userFeild[key].field_lable);
    for (let i = 0; i < dbFieldLable.length; i++) {
      if (!userFieldLable.includes(dbFieldLable[i])) {
        await transaction.rollback();
        return res.status(400).json({ success: false, message: "Invalid Field (*)!!!" });
      }
    }

    //   VALID FILED VALUE
    for (let i = 0; i < userFeild.length; i++) {
      const Valid = new Validator(userFeild[i], {
        value: "required",
      });

      if (Valid.fails()) {
        await transaction.rollback();
        return res.status(400).json({ success: false, message: `${userFeild[i].field_lable} is required.` });
      }
    }

    let updateData = [];

    for (let i = 0; i < userFeild.length; i++) {
      const cValue = await jwt.sign(userFeild[i].value, process.env.CREDENTIAL_TOKEN);

      updateData.push({ field_lable: userFeild[i].field_lable, field_code: userFeild[i].field_code, value: cValue });
    }

    const result = await invtDB.query("UPDATE credentials SET credential_data = :credential_data, last_updated = :last_updated WHERE credential_key = :credential_key", {
      replacements: { credential_key: req.body.code, credential_data: JSON.stringify(updateData), last_updated: moment().format("YYYY-MM-DD HH:mm:ss") },
      type: invtDB.QueryTypes.UPDATE,
      transaction: transaction,
    });

    if (result[1] != 1) {
      await transaction.rollback();
      return res.status(400).json({ success: false, message: "Credential settings not updated!!!" });
    }

    await transaction.commit();
    return res.status(200).json({ success: true, message: "Updated Successfully!!!" });
  } catch (err) {
    await transaction.rollback();
    return helper.errorResponse(res, err);
  }
});

module.exports = router;
