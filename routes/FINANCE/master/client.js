const express = require("express");
const router = express.Router();

const Validator = require("validatorjs");

const { tallyDB,  tallyOakterDB} = require("../../../config/db/connection");
const auth = require("../../../middleware/auth");


function getRandomCode(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}


// add client
router.post("/add", [auth.isAuthorized], async (req, res) => {
  const validator = new Validator(req.body, {
    clientName: "required",
    panNo: "required",
    mobileNo: "required",
  });

  if (validator.fails()) {
    return res.json({ status: "error", success: false, message: validator.errors.all() });
  }

  const t1 = await tallyDB.transaction();
  const t2 = await tallyOakterDB.transaction();

  try {
    const fetchCode = await tallyDB.query(
      "SELECT ID, code FROM client_basic_detail ORDER BY ID DESC LIMIT 1",
      { type: tallyDB.QueryTypes.SELECT }
    );

    let clientCode = "CUS0001";
    if (fetchCode.length > 0) {
      const last = fetchCode[0].code;
      let strings = last.replace(/[0-9]/g, "");
      let digits = (parseInt(last.replace(/[^0-9]/g, "")) + 1).toString();
      if (digits.length < 4) digits = ("000" + digits).substr(-4);
      clientCode = strings + digits;
    }

    const payload = {
      name: req.body.clientName,
      code: clientCode,
      panNo: req.body.panNo,
      email: req.body.email ?? "",
      mobile: req.body.mobileNo,
      website: req.body.website ?? "",
      salesPerson: req.body.salesPerson ?? "",
      insertBy: req.logedINUser,
      insertedAt: moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
      status: "active",
    };

    const sql = `
      INSERT INTO client_basic_detail
      (name, code, panNo, email, mobile, website, salesPerson, insertBy, insertedAt, status)
      VALUES (:name, :code, :panNo, :email, :mobile, :website, :salesPerson, :insertBy, :insertedAt, :status)
    `;

    const [r1, r2] = await Promise.all([
      tallyDB.query(sql, { replacements: payload, type: tallyDB.QueryTypes.INSERT, transaction: t1 }),
      tallyOakterDB.query(sql, { replacements: payload, type: tallyOakterDB.QueryTypes.INSERT, transaction: t2 })
    ]);

    if (!r1[0] || !r2[0]) {
      if (!t1.finished) await t1.rollback();
      if (!t2.finished) await t2.rollback();
      return res.json({ status: "error", success: false, message: "Client not added" });
    }

    await Promise.all([t1.commit(), t2.commit()]);
    return res.json({ status: "success", success: true, message: "Client added successfully" });

  } catch (error) {
    if (!t1.finished) await t1.rollback();
    if (!t2.finished) await t2.rollback();
    return helper.errorResponse(res, error);
  }
});


// add branch
router.post("/addBranch", [auth.isAuthorized], async (req, res) => {
  const validator = new Validator(req.body, {
    state: "required", country: "required", address: "required", city: "required",
    pinCode: "required", phoneNo: "required", gst: "required", clientCode: "required"
  });

  if (validator.fails()) {
    return res.json({ status: "error", success: false, message: validator.errors.all() });
  }

  const t1 = await tallyDB.transaction();
  const t2 = await tallyOakterDB.transaction();

  try {
    const fetchClient = await tallyDB.query(
      "SELECT * FROM client_basic_detail WHERE code = :code",
      { replacements: { code: req.body.clientCode }, type: tallyDB.QueryTypes.SELECT }
    );

    if (!fetchClient.length) {
      await Promise.all([t1.rollback(), t2.rollback()]);
      return res.json({ status: "error", success: false, message: "Client not found" });
    }

    const payload = {
      addressID: "CLI" + getRandomCode(999999999, 100000000),
      state: req.body.state,
      country: req.body.country,
      address: req.body.address,
      city: req.body.city,
      pinCode: req.body.pinCode,
      phoneNo: req.body.phoneNo,
      gst: req.body.gst,
      insertBy: req.logedINUser,
      insertedAt: moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
      status: "active",
      clientCode: req.body.clientCode,
    };

    const sql = `
      INSERT INTO client_address_detail
      (addressID, state, country, address, city, pinCode, phoneNo, gst, clientCode, insertBy, insertedAt, status)
      VALUES (:addressID, :state, :country, :address, :city, :pinCode, :phoneNo, :gst, :clientCode, :insertBy, :insertedAt, :status)
    `;

    const [r1, r2] = await Promise.all([
      tallyDB.query(sql, { replacements: payload, type: tallyDB.QueryTypes.INSERT, transaction: t1 }),
      tallyOakterDB.query(sql, { replacements: payload, type: tallyOakterDB.QueryTypes.INSERT, transaction: t2 }),
    ]);

    if (!r1[0] || !r2[0]) {
      await Promise.all([t1.rollback(), t2.rollback()]);
      return res.json({ status: "error", success: false, message: "Address not added" });
    }

    await Promise.all([t1.commit(), t2.commit()]);
    return res.json({ status: "success", success: true, message: "Address added successfully" });

  } catch (error) {
    if (!t1.finished) await t1.rollback();
    if (!t2.finished) await t2.rollback();
    return helper.errorResponse(res, error);
  }
});


// edit client
router.put("/update", [auth.isAuthorized], async (req, res) => {
  const validator = new Validator(req.body, {
    clientName: "required", panNo: "required", mobileNo: "required",
    code: "required", status: "required"
  });

  if (validator.fails()) {
    return res.json({ status: "error", success: false, message: validator.errors.all() });
  }

  const t1 = await tallyDB.transaction();
  const t2 = await tallyOakterDB.transaction();

  try {
    const payload = {
      name: req.body.clientName,
      panNo: req.body.panNo,
      email: req.body.email ?? "",
      mobile: req.body.mobileNo,
      website: req.body.website ?? "",
      salesPerson: req.body.salesPerson ?? "",
      status: req.body.status,
      tds: req.body.tds ? req.body.tds.join(",") : "",
      tcs: req.body.tcs ? req.body.tcs.join(",") : "",
      updateBy: req.logedINUser,
      updatedAt: moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
      code: req.body.code
    };

    const sql = `
      UPDATE client_basic_detail SET 
      name=:name, panNo=:panNo, email=:email, mobile=:mobile, website=:website,
      salesPerson=:salesPerson, status=:status, tds=:tds, tcs=:tcs,
      updateBy=:updateBy, updatedAt=:updatedAt
      WHERE code=:code
    `;

    const [r1, r2] = await Promise.all([
      tallyDB.query(sql, { replacements: payload, type: tallyDB.QueryTypes.UPDATE, transaction: t1 }),
      tallyOakterDB.query(sql, { replacements: payload, type: tallyOakterDB.QueryTypes.UPDATE, transaction: t2 })
    ]);

    if (!r1[1] && !r2[1]) {
      await Promise.all([t1.rollback(), t2.rollback()]);
      return res.json({ status: "error", success: false, message: "Client not updated" });
    }

    await Promise.all([t1.commit(), t2.commit()]);
    return res.json({ status: "success", success: true, message: "Client updated successfully" });

  } catch (error) {
    if (!t1.finished) await t1.rollback();
    if (!t2.finished) await t2.rollback();
    return helper.errorResponse(res, error);
  }
});

// get client branch
router.get("/branches", [auth.isAuthorized], async (req, res) => {
  try {
    let validator = new Validator(req.query, {
      clientCode: "required"
    });

    if (validator.fails()) {
      return res.json({ status: "error", success: false, message: validator.errors.all() });
    }

    let fetchBranches = await tallyDB.query("SELECT client_address_detail.* , state_code.name AS stateName , country.name AS countryName FROM client_address_detail LEFT JOIN state_code ON client_address_detail.state = state_code.code LEFT JOIN country ON client_address_detail.country = country.ID WHERE clientCode = :clientCode", {
      replacements: {
        clientCode: req.query.clientCode,
      },
      type: tallyDB.QueryTypes.SELECT,
    });

    if (fetchBranches.length <= 0) {
      return res.json({ status: "error", success: false, message: "client not found" });
    }

    let result = []
    for (let i = 0; i < fetchBranches.length; i++) {
      result.push({
        clientCode: fetchBranches[i].clientCode,
        addressID: fetchBranches[i].addressID,
        address: fetchBranches[i].address,
        city: {
          id: fetchBranches[i].addressID,
          name: fetchBranches[i].city
        },
        pinCode: fetchBranches[i].pinCode,
        phoneNo: fetchBranches[i].phoneNo,
        email: fetchBranches[i].email,
        gst: fetchBranches[i].gst,
        status: fetchBranches[i].status,
        state: {
          code: fetchBranches[i].state,
          name: fetchBranches[i].stateName
        },
        country: {
          code: fetchBranches[i].country,
          name: fetchBranches[i].countryName
        }
      });
    }

    return res.json({ status: "success", success: true, data: result });
  } catch (error) {
      return helper.errorResponse(res, error);
  }
})

// update client branch
router.put("/updateBranch", [auth.isAuthorized], async (req, res) => {
  const validator = new Validator(req.body, {
    clientCode: "required", addressID: "required", address: "required",
    city: "required", pinCode: "required", phoneNo: "required",
    gst: "required", status: "required", state: "required", country: "required"
  });

  if (validator.fails()) {
    return res.json({ status: "error", success: false, message: validator.errors.all() });
  }

  const t1 = await tallyDB.transaction();
  const t2 = await tallyOakterDB.transaction();

  try {
    const payload = {
      state: req.body.state,
      country: req.body.country,
      city: req.body.city,
      address: req.body.address,
      pinCode: req.body.pinCode,
      phoneNo: req.body.phoneNo,
      email: req.body.email ?? "",
      gst: req.body.gst,
      status: req.body.status,
      updateBy: req.logedINUser,
      updatedAt: moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
      addressID: req.body.addressID,
      clientCode: req.body.clientCode
    };

    const sql = `
      UPDATE client_address_detail SET 
      state=:state, country=:country, city=:city, address=:address,
      pinCode=:pinCode, phoneNo=:phoneNo, email=:email, gst=:gst,
      status=:status, updateBy=:updateBy, updatedAt=:updatedAt
      WHERE addressID=:addressID AND clientCode=:clientCode
    `;

    const [r1, r2] = await Promise.all([
      tallyDB.query(sql, { replacements: payload, type: tallyDB.QueryTypes.UPDATE, transaction: t1 }),
      tallyOakterDB.query(sql, { replacements: payload, type: tallyOakterDB.QueryTypes.UPDATE, transaction: t2 })
    ]);

    if (!r1[1] && !r2[1]) {
      await Promise.all([t1.rollback(), t2.rollback()]);
      return res.json({ status: "error", success: false, message: "Branch not updated" });
    }

    await Promise.all([t1.commit(), t2.commit()]);
    return res.json({ status: "success", success: true, message: "Branch updated successfully" });

  } catch (error) {
    if (!t1.finished) await t1.rollback();
    if (!t2.finished) await t2.rollback();
    return helper.errorResponse(res, error);
  }
});


// if req.query have code then all details of particular client will be fetched || if req. query have name then search will be done || if nothing then all clients will be fetched
router.get("/getClient", [auth.isAuthorized], async (req, res) => {
  try {

    if (req.query.code) {
      let fetchClient = await tallyDB.query("SELECT * FROM client_basic_detail WHERE code = :code", {
        replacements: {
          code: req.query.code,
        },
        type: tallyDB.QueryTypes.SELECT,
      });

      if (fetchClient.length > 0) {
        let arr = [];

        for (let i = 0; i < fetchClient.length; i++) {
          let tds, tcs;
          if (fetchClient[i].tds !== null) {
            tds = fetchClient[i].tds.split(",");
          }

          if (fetchClient[i].tcs !== null) {
            tcs = fetchClient[i].tcs.split(",");
          }

          let fetchTds = await tallyDB.query("SELECT tds_name, tds_gl_code , tds_percent , tally_ledger.ladger_name FROM `tally_tds` LEFT JOIN tally_ledger ON tally_tds.tds_gl_code = tally_ledger.ledger_key WHERE `tds_key` IN (:gl)", {
            replacements: {
              gl: tds
            },
            type: tallyDB.QueryTypes.SELECT
          });

          let fetchTcs = await tallyDB.query("SELECT tcs_name, tcs_gl_code , tcs_percent , tally_ledger.ladger_name FROM `tally_tcs` LEFT JOIN tally_ledger ON tally_tcs.tcs_gl_code = tally_ledger.ledger_key WHERE `tcs_key` IN (:gl)", {
            replacements: {
              gl: tcs
            },
            type: tallyDB.QueryTypes.SELECT
          });

          arr.push({
            code: fetchClient[i].code,
            name: fetchClient[i].name,
            panNo: fetchClient[i].panNo,
            tcs: tcs,
            tcsOption: fetchTcs,
            tds: tds,
            tdsOption: fetchTds,
            status: fetchClient[i].status,
            email: fetchClient[i].email,
            mobile: fetchClient[i].mobile,
            website: fetchClient[i].website,
            salesPerson: fetchClient[i].salesPerson,
          })
        }

        if (fetchClient.length == arr.length) {
          return res.json({ status: "success", success: true, data: arr })
        }
      }
      return res.json({ status: "error", success: false, message: "client not found" });
    }

    if (req.query.name) {
      let fetchClient = await tallyDB.query("SELECT code , name FROM client_basic_detail WHERE name LIKE :name", {
        replacements: {
          name: `%${req.query.name}%`,
        },
        type: tallyDB.QueryTypes.SELECT,
      });

      if (fetchClient.length <= 0) {
        return res.json({ status: "error", success: false, message: "client not found" });
      }

      return res.json({ status: "success", success: true, data: fetchClient });
    }
    else {
      let fetchClients = await tallyDB.query("SELECT * FROM client_basic_detail", {
        type: tallyDB.QueryTypes.SELECT,
      });
      if (fetchClients.length < 0) {
        return res.json({

          status: "error", success: false,
          message: "no client found",
        });
      }

      let arr = [];

      for (let i = 0; i < fetchClients.length; i++) {
        arr.push({
          id: Buffer.from(JSON.stringify(fetchClients[i].ID)).toString("base64"),
          name: fetchClients[i].name,
          code: fetchClients[i].code,
          panNo: fetchClients[i].panNo,
          mobile: fetchClients[i].mobile,
          email: fetchClients[i].email,
          salesperson: fetchClients[i].csalesperson,
          status: fetchClients[i].status,
        });
      }
      return res.json({ status: "success", success: true, data: arr });
    }

  } catch (error) {
      return helper.errorResponse(res, error);
  }
})

// get client basic detail and branch detail by addressid
router.get("/getClientDetail", [auth.isAuthorized], async (req, res) => {
  try {
    let validation = new Validator(req.query, {
      addressID: "required",
    })

    if (validation.fails()) {
      return res.status(403).send(Object.values(validation.errors.all())[0].join());
    }

    let fetchClient = await tallyDB.query("SELECT client_basic_detail.*, client_address_detail.* , state_code.name AS stateName , country.name AS countryName FROM client_address_detail LEFT JOIN state_code ON client_address_detail.state = state_code.code LEFT JOIN country ON client_address_detail.country = country.ID LEFT JOIN client_basic_detail ON client_basic_detail.code = client_address_detail.clientCode WHERE addressID = :addressID", {
      replacements: {
        addressID: req.query.addressID,
      },
      type: tallyDB.QueryTypes.SELECT,
    });

    if (fetchClient.length <= 0) {
      return res.json({ status: "error", success: false, message: "wrong client code or address id" });
    }
    let arr = [];
    for (let i = 0; i < fetchClient.length; i++) {

      let tds, tcs;
      if (fetchClient[i].tds !== null) {
        tds = fetchClient[i].tds.split(",");
      }

      if (fetchClient[i].tcs !== null) {
        tcs = fetchClient[i].tcs.split(",");
      }

      let fetchTds = await tallyDB.query("SELECT tds_name, tds_gl_code , tds_percent , tds_key , tally_ledger.ladger_name FROM `tally_tds` LEFT JOIN tally_ledger ON tally_tds.tds_gl_code = tally_ledger.ledger_key WHERE `tds_key` IN (:gl)", {
        replacements: {
          gl: tds
        },
        type: tallyDB.QueryTypes.SELECT
      });

      let fetchTcs = await tallyDB.query("SELECT tcs_name, tcs_gl_code , tcs_percent , tcs_key , tally_ledger.ladger_name FROM `tally_tcs` LEFT JOIN tally_ledger ON tally_tcs.tcs_gl_code = tally_ledger.ledger_key WHERE `tcs_key` IN (:gl)", {
        replacements: {
          gl: tcs
        },
        type: tallyDB.QueryTypes.SELECT
      });


      arr.push({
        clientCode: fetchClient[i].code,
        name: fetchClient[i].name,
        panNo: fetchClient[i].panNo,
        phoneNo: fetchClient[i].phoneNo,
        state: {
          code: fetchClient[i].state,
          name: fetchClient[i].stateName
        },
        country: {
          code: fetchClient[i].country,
          name: fetchClient[i].countryName
        },
        city: fetchClient[i].city,
        address: fetchClient[i].address,
        gst: fetchClient[i].gst,
        pinCode: fetchClient[i].pinCode,
        tcs: tcs,
        tcsOption: fetchTcs,
        tds: tds,
        tdsOption: fetchTds
      })
    }
    return res.status(200).send(arr);
  } catch (error) {
      return helper.errorResponse(res, error);
  }
})

module.exports = router;
