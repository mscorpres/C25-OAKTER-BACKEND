const express = require("express");
const router = express.Router();
const multer = require("multer");
const { encode, decode } = require("html-entities");

let {
  invtDB,
  otherDB,
  invtOakterDB,
} = require("../../../../config/db/connection");
const auth = require("../../../../middleware/auth");
const permission = require("../../../../middleware/permission");

const Validator = require("validatorjs");
const fs = require("fs");
const xlsx = require("xlsx");
const path = require("path");
const axios = require("axios");
const FormData = require("form-data");
const { s3Config } = require("../../../../config/awsConfig");

// Multer config for S3 uploads – keep file in memory
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5242880 }, // 5 MB (in binary)
  fileFilter: function (_req, file, cb) {
    // Allowed ext
    const filetypes = /jpeg|jpg|png|gif/;
    // Check ext
    const extname = filetypes.test(
      path.extname(file.originalname).toLowerCase()
    );
    // Check mime
    const mimetype = filetypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb("Error: Images Only!");
    }
  },
});

// Build S3 key for component images: uploads/<year>/<month>/componentsImg/<filename>
const buildComponentImageS3Key = (filename) => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `uploads/${year}/${month}/componentsImg/${filename}`;
};

// GET ALL COMPONENTS TYPE R
router.get("/", [auth.isAuthorized], async (req, res) => {
  try {
    const result = await invtDB.query(
      "SELECT c_part_no,c_new_part_no,c_new_part_no,c_name,units_name,component_key , c_attr_category, c_is_enabled as is_enabled FROM components LEFT JOIN units ON units.units_id = components.c_uom WHERE c_type= 'R' ORDER BY components.ID DESC ",
      { type: invtDB.QueryTypes.SELECT }
    );

    if (result.length > 0) {
      for (let i = 0; i < result.length; i++) {
        result[i].component_key = Buffer.from(
          result[i].component_key.toString()
        ).toString("base64");
        result[i].c_attr_category = result[i].c_attr_category ?? "NA";
        result[i].c_new_part_no = result[i].c_new_part_no ?? "NA";
        result[i].is_enabled =
          result[i].is_enabled == "Y"
            ? "YES"
            : result[i].is_enabled == "N"
            ? "NO"
            : "NA";
      }
      return res.json({
        status: "success",
        success: true,
        message: "Data fetched successfully",
        data: result,
      });
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "No Component Found!!!",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// GTE PART NAME AND PART NO
router.post("/getCompNameAndPartNo", [auth.isAuthorized], async (req, res) => {
  try {
    const validation = new Validator(req.body, {
      component: "required",
    });

    if (validation.fails()) {
      return res.json({
        status: "error",
        success: false,
        message: helper.firstErrorValidatorjs(validation),
      });
    }

    const result = await invtDB.query(
      "SELECT c_part_no, c_new_part_no, c_name FROM components WHERE component_key = :component",
      {
        replacements: {
          component: Buffer.from(req.body.component, "base64").toString(
            "ascii"
          ),
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (result.length > 0) {
      return res.json({
        status: "success",
        success: true,
        message: "Data fetched successfully",
        data: result[0],
      });
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "No Component Found!!!",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// GET ALL SERVICES
router.get("/service", [auth.isAuthorized], async (req, res) => {
  try {
    const result = await invtDB.query(
      "SELECT c_part_no, c_new_part_no, c_name, c_name, component_key, units_name, component_key FROM components LEFT JOIN units ON units.units_id = components.c_uom WHERE c_type= 'S'",
      { type: invtDB.QueryTypes.SELECT }
    );

    if (result.length > 0) {
      for (let i = 0; i < result.length; i++) {
        result[i].component_key = Buffer.from(
          result[i].component_key.toString()
        ).toString("base64");
      }
      return res.json({
        status: "success",
        success: true,
        message: "Data fetched successfully",
        data: result,
      });
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "No Component Found!!!",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// INSERT NEW COMPONENT
router.post("/addComponent/:type", [auth.isAuthorized], async (req, res) => {
  let tx1, tx2;

  try {
    [tx1, tx2] = await Promise.all([
      invtDB.transaction(),
      invtOakterDB.transaction(),
    ]);

    const validation = new Validator(req.body, {
      component: "required",
      part: "required",
      uom: "required",
      comp_type: "required",
      group: "required",
      subgroup: "required",
    });

    if (validation.fails()) {
      await Promise.all([tx1.rollback(), tx2.rollback()]);
      return res.json({
        status: "error",
        success: false,
        message: "something you missing in form field to supply",
        data: validation.errors.all(),
      });
    }

    let checkPermission = await invtDB.query(
      `SELECT CustID FROM admin_login 
       WHERE CustID IN ('CRN9560637','CRN103522','CRN0581783','CRN301718','CRN919551','CRN991091','CRN710830','CRN7494602') 
       AND CustID = :userCustID`,
      {
        replacements: { userCustID: req.logedINUser },
        type: invtDB.QueryTypes.SELECT,
        transaction: tx1,
      }
    );

    if (!checkPermission.length) {
      await Promise.all([tx1.rollback(), tx2.rollback()]);
      return res.json({
        success: false,
        message: "Sorry! You don't have permission to perform this action",
        status: "error",
      });
    }

    let {
      attr_raw,
      comp_type,
      part,
      uom,
      component,
      notes,
      hsns,
      taxs,
      attr_category,
      attr_code,
      group,
      subgroup,
      new_partno,
    } = req.body;

    if (comp_type !== "O" && Object.keys(attr_raw).length === 0) {
      let validation_attr_raw = new Validator(attr_raw, {
        multipler: "required",
        tolerance: "required",
        mountingStyle: "required",
        packageSize: "required",
        powerRating: "required",
        value: "required",
      });

      if (validation_attr_raw.fails()) {
        await Promise.all([tx1.rollback(), tx2.rollback()]);
        return res.json({
          status: "error",
          success: false,
          message: "Validation error",
          data: validation_attr_raw.errors.all(),
        });
      }
    }

    const component_name = helper.trimString(component);
    const shortnotes = helper.trimString(notes);

    const strvalid = helper.strCharValid(component_name);
    if (strvalid !== true) {
      await Promise.all([tx1.rollback(), tx2.rollback()]);
      return res.json({ status: "error", success: false, message: strvalid });
    }

    if (hsns.length !== taxs.length) {
      await Promise.all([tx1.rollback(), tx2.rollback()]);
      return res.json({
        status: "error",
        success: false,
        message: "HSN and Tax field should be filled",
      });
    }

    const partCheck = await invtDB.query(
      "SELECT 1 FROM components WHERE c_part_no = ?",
      { replacements: [part], type: invtDB.QueryTypes.SELECT, transaction: tx1 }
    );

    if (partCheck.length > 0) {
      await Promise.all([tx1.rollback(), tx2.rollback()]);
      return res.json({
        status: "error",
        success: false,
        message: "Part no already exists",
      });
    }

    const nameCheck = await invtDB.query(
      "SELECT 1 FROM components WHERE c_name = ?",
      {
        replacements: [component_name],
        type: invtDB.QueryTypes.SELECT,
        transaction: tx1,
      }
    );

    if (nameCheck.length > 0) {
      await Promise.all([tx1.rollback(), tx2.rollback()]);
      return res.json({
        status: "error",
        success: false,
        message: "Component name already exists",
      });
    }

    if (req.params.type === "verify") {
      const checkAttr = await invtDB.query(
        "SELECT * FROM components WHERE attribute_code = ?",
        {
          replacements: [attr_code],
          type: invtDB.QueryTypes.SELECT,
          transaction: tx1,
        }
      );

      await Promise.all([tx1.rollback(), tx2.rollback()]);

      if (checkAttr.length > 0 && checkAttr[0].attribute_code !== "--") {
        return res.json({
          status: "error",
          success: false,
          message:
            "assigning uID already mapped with partcode [" +
            checkAttr[0].c_part_no +
            "] with uID " +
            checkAttr[0].attribute_code,
        });
      }

      return res.json({
        status: "success",
        success: true,
        message: "uID is available for assigning",
      });
    }

    if (req.params.type === "save") {
      const key = helper.getUniqueNumber();
      const insertDate = moment().format("YYYY-MM-DD HH:mm:ss");

      const componentPayload = {
        c_group: group,
        c_sub_group: subgroup,
        attribute_raw: JSON.stringify(attr_raw),
        attribute_code: attr_code,
        c_part_no: part,
        c_new_part_no: new_partno,
        c_name: component_name,
        c_uom: uom,
        c_type: "R",
        c_specification: shortnotes,
        attr_category: attr_category,
        inserted_by: req.logedINUser,
        component_key: key,
        insert_date: insertDate,
      };

      const componentSQL = `
        INSERT INTO components 
        (c_group, c_sub_group, attribute_raw, attribute_code, c_part_no, c_new_part_no,
         c_name, c_uom, c_type, c_specification, c_attr_category, component_key,
         inserted_by, insert_date)
        VALUES
        (:c_group, :c_sub_group, :attribute_raw, :attribute_code, :c_part_no, :c_new_part_no,
         :c_name, :c_uom, :c_type, :c_specification, :attr_category, :component_key,
         :inserted_by, :insert_date)
      `;

      await Promise.all([
        invtDB.query(componentSQL, {
          replacements: componentPayload,
          type: invtDB.QueryTypes.INSERT,
          transaction: tx1,
        }),
        invtOakterDB.query(componentSQL, {
          replacements: componentPayload,
          type: invtOakterDB.QueryTypes.INSERT,
          transaction: tx2,
        }),
      ]);

      for (let i = 0; i < hsns.length; i++) {
        const hsnPayload = {
          component_key: key,
          hsn_code: hsns[i],
          tax_percent: taxs[i],
        };

        const hsnSQL = `
          INSERT INTO tbl_rm_hsn (component_key, hsn_code, tax_percent)
          VALUES (:component_key, :hsn_code, :tax_percent)
        `;

        await Promise.all([
          invtDB.query(hsnSQL, {
            replacements: hsnPayload,
            type: invtDB.QueryTypes.INSERT,
            transaction: tx1,
          }),
          invtOakterDB.query(hsnSQL, {
            replacements: hsnPayload,
            type: invtOakterDB.QueryTypes.INSERT,
            transaction: tx2,
          }),
        ]);
      }

      await Promise.all([tx1.commit(), tx2.commit()]);

      return res.json({
        status: "success",
        success: true,
        message: "Component added successfully",
        data: { component_key: Buffer.from(key.toString()).toString("base64") },
      });
    }
  } catch (err) {
    if (tx1) await tx1.rollback();
    if (tx2) await tx2.rollback();
    return helper.errorResponse(res, err);
  }
});

// INSERT NEW SERVICES
router.post("/addServices", [auth.isAuthorized], async (req, res) => {
  const validation = new Validator(req.body, {
    component: "required",
    part: "required",
    uom: "required",
    notes: "required",
  });

  if (validation.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: "something you missing in form field to supply",
      data: validation.errors.all(),
    });
  }

  const component_type = "S";
  const part_no = req.body.part;
  const component_uom = req.body.uom;
  const component_name = helper.trimString(req.body.component);
  const shortnotes = helper.trimString(req.body.notes);

  let tx1, tx2;

  try {
    // ✅ Start both DB transactions
    [tx1, tx2] = await Promise.all([
      invtDB.transaction(),
      invtOakterDB.transaction(),
    ]);

    // ✅ Duplicate check
    const result = await invtDB.query(
      "SELECT 1 FROM components WHERE c_part_no = :part_no LIMIT 1",
      {
        replacements: { part_no },
        type: invtDB.QueryTypes.SELECT,
        transaction: tx1,
      }
    );

    if (result.length > 0) {
      await Promise.all([tx1.rollback(), tx2.rollback()]);
      return res.json({
        status: "error",
        success: false,
        message: "Part already exists",
      });
    }

    const key = helper.getUniqueNumber();

    // ✅ NAMED PLACEHOLDER QUERY (what you asked for)
    const sql = `
      INSERT INTO components 
      (c_part_no, c_name, c_uom, c_type, c_specification, component_key)
      VALUES (:part_no, :cname, :uom, :ctype, :spec, :ckey)
    `;

    const payload = {
      part_no: part_no,
      cname: component_name,
      uom: component_uom,
      ctype: component_type,
      spec: shortnotes,
      ckey: key,
    };

    // ✅ Insert into BOTH databases
    await Promise.all([
      invtDB.query(sql, {
        replacements: payload,
        type: invtDB.QueryTypes.INSERT,
        transaction: tx1,
      }),

      invtOakterDB.query(sql, {
        replacements: payload,
        type: invtOakterDB.QueryTypes.INSERT,
        transaction: tx2,
      }),
    ]);

    // ✅ Commit both
    await Promise.all([tx1.commit(), tx2.commit()]);

    return res.json({
      status: "success",
      success: true,
      message: "Operation completed successfully in both databases",
    });
  } catch (err) {
    if (tx1) await tx1.rollback();
    if (tx2) await tx2.rollback();
    return helper.errorResponse(res, err);
  }
});

// GET ALL COMPONENT
router.get("/getComponentForBom", [auth.isAuthorized], async (req, res) => {
  try {
    const result = await invtDB.query(
      "SELECT * FROM components WHERE c_type = 'R' ORDER BY c_name",
      { type: invtDB.QueryTypes.SELECT }
    );
    if (result.length > 0) {
      await res.json({
        status: "success",
        success: true,
        message: "Data fetched successfully",
        data: result,
      });
    } else {
      await res.json({
        status: "error",
        success: false,
        message: "No Component Found!!!",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// FETCH UPDATE COMPONENT
router.post("/fetchUpdateComponent", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    componentKey: "required",
  });

  if (validation.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: "something you missing in form field to supply",
    });
  }

  try {
    let stmt = await invtDB.query(
      "SELECT * FROM components LEFT JOIN units ON components.c_uom = units.units_id WHERE component_key = :key",
      {
        replacements: {
          key: Buffer.from(req.body.componentKey, "base64").toString("ascii"),
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length > 0) {
      let stmt_group = await invtDB.query(
        "SELECT * FROM all_groups WHERE group_id = :groupcode",
        {
          replacements: { groupcode: stmt[0].c_group },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      let group_id = "--";
      let group_name = "-- SELECT --";
      if (stmt_group.length > 0) {
        group_id = decode(stmt_group[0].group_id);
        group_name = decode(stmt_group[0].group_name);
      }

      // SUB GROUP
      let stmt_subgroup = await invtDB.query(
        "SELECT * FROM all_sub_groups WHERE sub_group_id = :subgroupcode",
        {
          replacements: { subgroupcode: stmt[0].c_sub_group },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      let subgroup_id = "--";
      let subgroup_name = "--";
      if (stmt_subgroup.length > 0) {
        subgroup_id = decode(stmt_subgroup[0].sub_group_id);
        subgroup_name = decode(stmt_subgroup[0].sub_group_name);
      }

      //NOTIFICATION CHECK
      let alert_status =
        stmt[0].c_notification == "Y"
          ? "Y"
          : stmt[0].c_notification == "N"
          ? "N"
          : stmt[0].c_notification == "0"
          ? "0"
          : "";

      //QC ENABLED / DISABLED
      //NOTIFICATION CHECK
      let qc_status =
        stmt[0].c_qc_status == "E"
          ? "E"
          : stmt[0].c_qc_status == "D"
          ? "D"
          : stmt[0].c_qc_status == "0"
          ? "0"
          : "";

      //STATUS
      let enable_status =
        stmt[0].c_is_enabled == "Y"
          ? "Y"
          : stmt[0].c_is_enabled == "N"
          ? "N"
          : stmt[0].c_is_enabled == "0"
          ? "0"
          : "";

      //GST TYPE
      let tax_type =
        stmt[0].c_tax_type == "L"
          ? "L"
          : stmt[0].c_tax_type == "I"
          ? "I"
          : stmt[0].c_tax_type == "0"
          ? "0"
          : "";

      //GST RATE
      let gst_rate =
        stmt[0].c_gst == "05"
          ? "05"
          : stmt[0].c_gst == "12"
          ? "12"
          : stmt[0].c_gst == "18"
          ? "18"
          : stmt[0].c_gst == "28"
          ? "28"
          : "";

      let stmt_comp_name = await invtDB.query(
        "SELECT c_name FROM components WHERE component_key IN (:component_key) ",
        {
          replacements: { component_key: stmt[0].c_alt_part_key.split(",") },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      let cNames = stmt_comp_name.map((item) => item.c_name);

      return res.json({
        success: true,
        status: "success",
        data: {
          attr_code: stmt[0].attribute_code,
          attr_raw:
            stmt[0].attribute_raw !== ""
              ? JSON.parse(stmt[0].attribute_raw)
              : "",
          partcode: stmt[0].c_part_no,
          new_partcode: stmt[0].c_new_part_no,
          alternate_part_codes: stmt[0].c_alt_part_no.split(","),
          alternate_part_keys: stmt[0].c_alt_part_key.split(","),
          alternate_part_name: cNames,
          uomname: stmt[0].units_name,
          uomid: stmt[0].units_id,
          name: decode(stmt[0].c_name),
          mrp: stmt[0].c_mrp,

          category: stmt[0].c_category,
          attr_category: stmt[0].c_attr_category,

          groupid: group_id,
          groupname: group_name,

          subgroupid: subgroup_id,
          subgroupname: subgroup_name,

          enable_status: enable_status,
          alert_status: alert_status,
          qc_status: qc_status,
          tax_type: tax_type,
          gst_rate: gst_rate,
          sac: stmt[0].c_sac,

          jobwork_rate: stmt[0].c_jobwork_rate,
          brand: stmt[0].c_brand,
          ean: stmt[0].c_ean,
          weight: stmt[0].c_weight,
          vweight: stmt[0].c_vweight,
          height: stmt[0].c_height,
          width: stmt[0].c_width,

          minqty: stmt[0].c_min_stock,
          maxqty: stmt[0].c_max_stock,
          minorderqty: stmt[0].c_min_order_qty,
          leadtime: stmt[0].c_lead_time,

          location: stmt[0].c_default_loc,
          pocost: stmt[0].c_pocost,
          othercost: stmt[0].c_othercost,
          description: stmt[0].c_specification,
        },
      });
    } else {
      return res.json({
        message: "seems like the component is not vaild longer",
        success: false,
        status: "error",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// DELETE IN COMPONENET CREATE BY VIBHORE
router.post("/ComponentDelete", [auth.isAuthorized], async (req, res) => {
  const transaction = await otherDB.transaction();
  try {
    // Check Permission
    let checkPermission = await invtDB.query(
      "SELECT CustID FROM admin_login WHERE CustID IN ('CRN9560637','CRN0581783', 'CRN301718', 'CRN919551' , 'CRN991091', 'CRN710830', 'CRN7494602') AND CustID = :userCustID",
      {
        replacements: { userCustID: req.logedINUser },
        type: invtDB.QueryTypes.SELECT,
      }
    );
    if (!checkPermission.length) {
      return res.json({
        success: false,
        message: "Sorry! You don't have permission to perform this action",
        status: "error",
      });
    }

    let stmt = await otherDB.query(
      "SELECT * FROM rm_sku_images WHERE img_attach_id = :img_attach_id AND rm_sku_key = :rm_sku_key",
      {
        replacements: {
          img_attach_id: req.body.image,
          rm_sku_key: req.body.component,
        },
        type: otherDB.QueryTypes.SELECT,
        transaction: transaction,
      }
    );

    if (stmt.length > 0) {
      const imgUrl = stmt[0].img_url;

      if (!imgUrl) {
        await transaction.rollback();
        return res.json({
          success: false,
          message: "Image key not found for delete",
          status: "error",
        });
      }

      try {
        await s3Config.deleteObject(imgUrl);
      } catch (err) {
        await transaction.rollback();
        return res.json({
          success: false,
          message: "Failed to delete image from storage",
          status: "error",
        });
      }
    } else {
      await transaction.rollback();
      return res.json({
        success: false,
        message: "Image record not found",
        status: "error",
      });
    }
    if (stmt.length > 0) {
      let stmt2 = await otherDB.query(
        "DELETE FROM rm_sku_images WHERE img_attach_id = :img_attach_id AND rm_sku_key = :rm_sku_key",
        {
          replacements: {
            img_attach_id: req.body.image,
            rm_sku_key: Buffer.from(req.body.component, "base64").toString(
              "ascii"
            ),
          },
          type: otherDB.QueryTypes.DELETE,
          transaction: transaction,
        }
      );
    }
    await transaction.commit();
    return res.json({
      success: true,
      message: "Image deleted successfully",
      status: "success",
    });
  } catch (e) {
    return helper.errorResponse(res, e);
  }
});

// UPLAOD COMP IMAGE
router.post(
  "/upload_comp_img",
  [auth.isAuthorized, upload.array("files")],
  async (req, res) => {
    const transaction = await otherDB.transaction();
    try {
      const filesLenth = req.files.length;

      if (filesLenth <= 0) {
        return res.json({
          success: false,
          message: "add some attachment",
          status: "error",
        });
      }

      for (let i = 0; i < filesLenth; i++) {
        const file = req.files[i];

        // Generate unique filename (same pattern as before)
        const filename =
          "RM" +
          helper.getUniqueNumber() +
          helper.randomNumber(100, 999) +
          path.extname(file.originalname);

        const s3Key = buildComponentImageS3Key(filename);

        // Upload to S3
        await s3Config.uploadFile(file, s3Key);

        // Save S3 key in DB
        const stmt = await otherDB.query(
          "INSERT INTO rm_sku_images (img_url, img_attach_id, img_caption, rm_sku_key,insert_date,insert_by) VALUES( :img_url, :img_attach_id, :img_caption, :rm_sku_key , :insert_date, :insert_by)",
          {
            replacements: {
              img_url: s3Key,
              img_attach_id: helper.getUniqueNumber(),
              img_caption: req.body.caption,
              rm_sku_key: Buffer.from(req.body.component, "base64").toString(
                "ascii"
              ),
              insert_date: moment().format("YYYY-MM-DD HH:mm:ss"),
              insert_by: req.logedINUser,
            },
            type: otherDB.QueryTypes.INSERT,
            transaction: transaction,
          }
        );

        if (stmt.length <= 0) {
          await transaction.rollback();
          return res.json({
            success: false,
            message: "an error occured while uploading image",
            status: "error",
          });
        }
      }

      await transaction.commit();
      return res.json({
        success: true,
        message: "Image attached successfully",
        status: "success",
      });
    } catch (err) {
      console.log(err)
      return helper.errorResponse(res, err);
    }
  }
);

// UPLOAD COMP IMAGE VIA APPLICATION
router.post(
  "/app_upload_comp_img",
  [upload.array("files")],
  async (req, res) => {
    const transaction = await otherDB.transaction();
    try {
      const filesLenth = req.files.length;

      if (filesLenth <= 0) {
        return res.json({
          success: false,
          message: "add some image attachment",
          status: "error",
        });
      }

      for (let i = 0; i < filesLenth; i++) {
        const file = req.files[i];

        const filename =
          "RM" +
          helper.getUniqueNumber() +
          helper.randomNumber(100, 999) +
          path.extname(file.originalname);

        const s3Key = buildComponentImageS3Key(filename);

        await s3Config.uploadFile(file, s3Key);

        const stmt = await otherDB.query(
          "INSERT INTO rm_sku_images (img_url, img_attach_id, img_caption, rm_sku_key,insert_date,insert_by) VALUES( :img_url, :img_attach_id, :img_caption, :rm_sku_key , :insert_date, :insert_by)",
          {
            replacements: {
              img_url: s3Key,
              img_attach_id: helper.getUniqueNumber(),
              img_caption: req.body.caption,
              rm_sku_key: req.body.component,
              insert_date: moment().format("YYYY-MM-DD HH:mm:ss"),
              insert_by: "CRN301718",
            },
            type: otherDB.QueryTypes.INSERT,
            transaction: transaction,
          }
        );

        if (stmt.length == 0) {
          await transaction.rollback();
          return res.json({
            success: false,
            message: "an error occured while uploading image",
            status: "error",
          });
        }
      }

      await transaction.commit();
      return res.json({
        success: true,
        message: "Image attached successfully",
        status: "success",
      });
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

// UPDATE COMPONENT
router.post("/updateComponent/:type", [auth.isAuthorized], async (req, res) => {
  const t1 = await invtDB.transaction();
  const t2 = await invtOakterDB.transaction();

  const component_key = Buffer.from(req.body.componentKey, "base64").toString(
    "ascii"
  );

  const validation = new Validator(req.body, {
    componentname: "required",
    componentKey: "required",
    componentcategory: "required",
  });

  if (validation.fails()) {
    await t1.rollback();
    await t2.rollback();
    return res.json({
      success: false,
      message: "Something is missing in form field to supply",
      status: "error",
    });
  }

  try {
    // Check permission
    // const checkPermission = await invtDB.query(
    //   "SELECT CustID FROM admin_login WHERE CustID IN ('CRN9560637','CRN0581783','CRN301718','CRN919551','CRN991091','CRN710830','CRN7494602','CRN615672','CRN103622') AND CustID = :userCustID",
    //   { replacements: { userCustID: req.logedINUser }, type: invtDB.QueryTypes.SELECT }
    // );

    // if (!checkPermission.length) {
    //   await t1.rollback();
    //   await t2.rollback();
    //   return res.json({
    //     success: false,
    //     message: "Sorry! You don't have permission to perform this action",
    //     status: "error",
    //   });
    // }

    const attr_raw = req.body.attr_raw ?? {};
    if (req.body.attr_category !== "O" && Object.keys(attr_raw).length === 0) {
      const validation_attr_raw = new Validator(attr_raw, {
        tolerance: "required",
        mountingStyle: "required",
        packageSize: "required",
        value: "required",
      });
      if (validation_attr_raw.fails()) {
        await t1.rollback();
        await t2.rollback();
        return res.json({
          status: "error",
          success: false,
          message: "Validation error",
        });
      }
    }

    const component = await invtDB.query(
      "SELECT * FROM components WHERE component_key = :component AND c_type = 'R'",
      {
        replacements: { component: component_key },
        type: invtDB.QueryTypes.SELECT,
      }
    );
    if (!component.length) {
      await t1.rollback();
      await t2.rollback();
      return res.json({
        success: false,
        message: "Component not found",
        status: "error",
      });
    }

    // If frontend does not send group / subgroup, keep existing ones
    const resolvedGroup = req.body.group || component[0].c_group;
    const resolvedSubgroup = req.body.subgroup || component[0].c_sub_group;

    // Validate resolved group
    const groupCheck = await invtDB.query(
      "SELECT * FROM all_groups WHERE group_id = :group_code",
      {
        replacements: { group_code: resolvedGroup },
        type: invtDB.QueryTypes.SELECT,
      }
    );
    if (!groupCheck.length) {
      await t1.rollback();
      await t2.rollback();
      return res.json({
        success: false,
        message: "Group not found",
        status: "error",
      });
    }

    if (req.params.type === "verify") {
      if (
        component[0].attribute_code === req.body.attr_code &&
        req.body.attr_code !== "--"
      ) {
        await t1.rollback();
        await t2.rollback();
        return res.json({
          success: false,
          message: `Assigning uID is already mapped with partcode [${component[0].c_part_no}] with uID ${component[0].attribute_code}`,
        });
      } else {
        await t1.rollback();
        await t2.rollback();
        return res.json({
          status: "success",
          success: true,
          message: "uID is available for assigning",
        });
      }
    }

    if (req.params.type === "save") {
      const payload = {
        new_part_no: req.body.new_partno,
        attr_raw: JSON.stringify(attr_raw),
        attr_code: req.body.attr_code,
        componentname: req.body.componentname,
        qc_status: req.body.qc_status,
        description: req.body.description,
        componentcategory: req.body.componentcategory,
        c_attr_category: req.body.attr_category ?? "",
        uom: req.body.uom,
        mrp: req.body.mrn,
        // use resolved group / subgroup so missing values from frontend do not break
        group: resolvedGroup,
        subgroup: resolvedSubgroup,
        status: req.body.enable_status,
        taxtype: req.body.taxtype,
        taxrate: req.body.taxrate,
        hsn: "--",
        brand: req.body.brand,
        ean: req.body.ean,
        weight: req.body.weightgms,
        vweight: req.body.vweightgms,
        height: req.body.height,
        width: req.body.width,
        pocost: req.body.pocost,
        othercost: req.body.othercost,
        min: req.body.minqty,
        max: req.body.maxqty,
        minorder: req.body.minorder,
        leadtime: req.body.leadtime,
        alert_status: req.body.alert,
        jobworkrate: req.body.jobwork_rate,
        pia_status: req.body.pia_status,
        key: component_key,
        update_dt: moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
        update_by: req.logedINUser,
      };

      const updateSQL = `
        UPDATE components 
        SET attribute_code = :attr_code,
            attribute_raw = :attr_raw,
            c_name = :componentname,
            c_qc_status = :qc_status,
            c_specification = :description,
            c_category = :componentcategory,
            c_min_stock = :min,
            c_max_stock = :max,
            c_min_order_qty = :minorder,
            c_lead_time = :leadtime,
            c_notification = :alert_status,
            update_date = :update_dt,
            updated_by = :update_by,
            c_uom = :uom,
            c_mrp = :mrp,
            c_group = :group,
            c_sub_group = :subgroup,
            c_is_enabled = :status,
            c_tax_type = :taxtype,
            c_gst = :taxrate,
            c_hsn = :hsn,
            c_brand = :brand,
            c_ean = :ean,
            c_weight = :weight,
            c_vweight = :vweight,
            c_height = :height,
            c_width = :width,
            c_pocost = :pocost,
            c_othercost = :othercost,
            c_jobwork_rate = :jobworkrate,
            c_attr_category = :c_attr_category,
            c_new_part_no = :new_part_no,
            pia_status = :pia_status
        WHERE component_key = :key
      `;

      await Promise.all([
        invtDB.query(updateSQL, {
          replacements: payload,
          transaction: t1,
        }),
        invtOakterDB.query(updateSQL, {
          replacements: payload,
          transaction: t2,
        }),
      ]);

      // Find and update replacement components (components that have this component as their replacement)
      // Check if any components have this component_key in their c_alt_part_key field
      const replComponents = await invtDB.query(
        "SELECT component_key FROM components WHERE FIND_IN_SET(:component_key, c_alt_part_key) > 0 AND c_type = 'R'",
        {
          replacements: { component_key: component_key },
          type: invtDB.QueryTypes.SELECT,
          transaction: t1,
        }
      );

      // Update all replacement components with the same data
      if (replComponents.length > 0) {
        for (const replComp of replComponents) {
          const replPayload = { ...payload, key: replComp.component_key };
          await Promise.all([
            invtDB.query(updateSQL, {
              replacements: replPayload,
              transaction: t1,
            }),
            invtOakterDB.query(updateSQL, {
              replacements: replPayload,
              transaction: t2,
            }),
          ]);
        }
      }

      await Promise.all([t1.commit(), t2.commit()]);
      return res.json({
        success: true,
        message: `Component updated successfully${replComponents.length > 0 ? ` along with ${replComponents.length} replacement component(s)` : ""}`,
        status: "success",
      });
    }
  } catch (err) {
    console.log(err)
    if (t1) await t1.rollback();
    if (t2) await t2.rollback();
    return helper.errorResponse(res, err);
  }
});

// GET COMPONENT DETAILS BY COMP CODE
// WITH UOM
// router.post(
//   "/getComponentDetailsByCode",
//   [auth.isAuthorized],
//   async (req, res) => {
//     const validation = new Validator(req.body, {
//       component_code: "required",
//     });

//     if (validation.fails()) {
//       return res.json({
//         success: false,
//         message: "something you missing in form field to supply",
//         status: "error",
//       });
//     }

//     try {
//       const result = await invtDB.query(
//         "SELECT * FROM components LEFT JOIN units ON components.c_uom = units.units_id WHERE components.component_key = :key AND components.c_is_enabled = 'Y'",
//         {
//           replacements: { key: req.body.component_code },
//           type: invtDB.QueryTypes.SELECT,
//         }
//       );
//       if (result.length > 0) {
//         result.map(async (item) => {
//           let gsttype;
//           if (item.c_gst == "--") {
//             gsttype = 0;
//           } else {
//             gsttype = item.c_gst;
//           }

//           unit = item.units_name;
//           hsn = item.c_hsn;
//           gstrate = gsttype;
//           mfgCode = item.manufacturing_code;
//         });

//         let stmt = await invtDB.query(
//           "SELECT COALESCE(SUM(qty+other_qty), 0) AS Outward FROM rm_location WHERE components_id = :component AND (trans_type != 'CONSUMPTION' AND trans_type != 'INWARD' AND trans_type != 'CANCELLED')",
//           {
//             replacements: { component: req.body.component_code },
//             type: invtDB.QueryTypes.SELECT,
//           }
//         );

//         if (stmt.length > 0) {
//           outward_all_qty = stmt[0].Outward;
//         }

//         let stmt1 = await invtDB.query(
//           "SELECT *, COALESCE(SUM(rm_location.qty+rm_location.other_qty), 0) AS Inward FROM rm_location LEFT JOIN components ON rm_location.components_id = components.component_key LEFT JOIN units ON components.c_uom = units.units_id WHERE components.c_type = 'R' AND components.component_key = :component AND (rm_location.trans_type = 'INWARD' OR rm_location.trans_type = 'TRANSFER')",
//           {
//             replacements: { component: req.body.component_code },
//             type: invtDB.QueryTypes.SELECT,
//           }
//         );
//         let currentQty = 0;
//         let key, comp_name;
//         if (stmt1.length > 0) {
//           comp_name = stmt1[0].c_name;
//           currentQty =
//             helper.number(stmt1[0].Inward) - helper.number(outward_all_qty);
//           key = stmt1[0].component_key;
//           piaStatus = stmt1[0].pia_status;
//         }

//         // LAST RATE FETCH
//         // var rate = await invtDB.query("SELECT * FROM po_purchase_req WHERE po_part_no = :key ORDER BY ID DESC LIMIT 1", {
//         //   replacements: { key: req.body.component_code },
//         //   type: invtDB.QueryTypes.SELECT,
//         // });

//         // if (rate.length > 0) {
//         //   old_rate = rate[0].po_order_rate;
//         // } else {
//         //   old_rate = 0;
//         // }

//         const old_rate =
//           await require("../../../../helper/utils/avgRate").getWeightedPurchaseRate(
//             req.body.component_code,
//             moment(new Date()).format("YYYY-MM-DD HH:mm:ss")
//           );

//         return res.json({
//           success: true,
//           message: "success",
//           data: {
//             key: key,
//             currentQty: currentQty,
//             unit: unit,
//             hsn: hsn,
//             gstrate: gstrate,
//             rate: old_rate,
//             mfgCode: mfgCode,
//           },
//         });
//       } else {
//         return res.json({
//           success: false,
//           message: "Component not found",
//           status: "error",
//         });
//       }
//     } catch (err) {
//       return helper.errorResponse(res, err);
//     }
//   }
// );
router.post(
  "/getComponentDetailsByCode",
  [auth.isAuthorized],
  async (req, res) => {
    const validation = new Validator(req.body, {
      component_code: "required",
    });

    if (validation.fails()) {
      return res.json({
        success: false,
        message: "something you missing in form field to supply",
        status: "error",
      });
    }

    try {
      const [result, stmt, stmt1, avgRateRows] = await Promise.all([
        // Component + unit info
        invtDB.query(
          `SELECT * FROM components
           LEFT JOIN units ON components.c_uom = units.units_id
           WHERE components.component_key = :key
             AND components.c_is_enabled  = 'Y'`,
          {
            replacements: { key: req.body.component_code },
            type: invtDB.QueryTypes.SELECT,
          },
        ),

        // Outward qty (non-consumption, non-inward, non-cancelled)
        invtDB.query(
          `SELECT COALESCE(SUM(qty + other_qty), 0) AS Outward
           FROM   rm_location
           WHERE  components_id = :component
             AND  trans_type NOT IN ('CONSUMPTION', 'INWARD', 'CANCELLED')`,
          {
            replacements: { component: req.body.component_code },
            type: invtDB.QueryTypes.SELECT,
          },
        ),

        // Inward qty
        invtDB.query(
          `SELECT *, COALESCE(SUM(rm_location.qty + rm_location.other_qty), 0) AS Inward
           FROM   rm_location
           LEFT JOIN components ON rm_location.components_id = components.component_key
           LEFT JOIN units      ON components.c_uom          = units.units_id
           WHERE  components.c_type        = 'R'
             AND  components.component_key = :component
             AND  rm_location.trans_type  IN ('INWARD', 'TRANSFER')`,
          {
            replacements: { component: req.body.component_code },
            type: invtDB.QueryTypes.SELECT,
          },
        ),

        require("../../../../helper/utils/newAvgRate").lastNewWeightedAverageRate(
          req.body.component_code,
        ),
      ]);

      if (result.length <= 0) {
        return res.json({
          success: false,
          message: "Component not found",
          status: "error",
        });
      }

      const item = result[0];
      const gstrate = item.c_gst === "--" ? 0 : item.c_gst;
      const unit = item.units_name;
      const hsn = item.c_hsn;
      const mfgCode = item.manufacturing_code;

      const outward_all_qty = stmt.length ? helper.number(stmt[0].Outward) : 0;
      const inward_all_qty = stmt1.length ? helper.number(stmt1[0].Inward) : 0;

      const key = stmt1.length ? stmt1[0].component_key : null;
      const currentQty = helper.number(inward_all_qty - outward_all_qty);

      const old_rate = avgRateRows ?? 0;

      return res.json({
        success: true,
        status: "success",
        data: {
          key,
          currentQty,
          unit,
          hsn,
          gstrate,
          rate: old_rate,
          mfgCode,
        },
      });
    } catch (err) {
      console.log(err);
      return helper.errorResponse(res, err);
    }
  },
);

// FETCH UPDATE SERVICE COMPONENT
router.post(
  "/fetchUpdateServiceComponent",
  [auth.isAuthorized],
  async (req, res) => {
    let validation = new Validator(req.body, {
      componentKey: "required",
    });

    if (validation.fails()) {
      return res.json({
        success: false,
        message: "something you missing in form field to supply",
        status: "error",
      });
    }

    try {
      let stmt1 = await invtDB.query(
        "SELECT * FROM components LEFT JOIN units ON components.c_uom = units.units_id WHERE component_key = :key AND c_type = 'S'",
        {
          replacements: { key: req.body.componentKey },
          type: invtDB.QueryTypes.SELECT,
        }
      );
      if (stmt1.length > 0) {
        let data = [];
        //STATUS
        enable_status =
          stmt[0].c_is_enabled == "Y"
            ? "Y"
            : stmt[0].c_is_enabled == "N"
            ? "N"
            : stmt[0].c_is_enabled == "0"
            ? "0"
            : "";

        //GST TYPE
        tax_type =
          stmt[0].c_tax_type == "L"
            ? "L"
            : stmt[0].c_tax_type == "I"
            ? "I"
            : stmt[0].c_tax_type == "0"
            ? "0"
            : "";

        //GST RATE
        gst_rate =
          stmt[0].c_gst == "05"
            ? "05"
            : stmt[0].c_gst == "12"
            ? "12"
            : stmt[0].c_gst == "18"
            ? "18"
            : stmt[0].c_gst == "28"
            ? "28"
            : "";

        data.push({
          serial_no: count,
          servicecode: stmt[0].c_part_no,
          unitname: stmt[0].units_name,
          uomid: stmt[0].units_id,
          name: stmt[0].c_name,
          enablestatus: enable_status,
          taxtype: tax_type,
          gstrate: gst_rate,
          servicename: stmt[0].c_name,
          description: stmt[0].c_specification,
          sac: c_sac,
        });

        return res.json({ success: true, message: "success", data: data });
      } else {
        return res.json({
          success: false,
          message: "seems like the component is not vaild longer",
        });
      }
    } catch (err) {
      return helper.errorResponse(res, err);
    }
  }
);

// UPDATE SERVICE COMPONENT
router.post(
  "/updateServiceComponent",
  [auth.isAuthorized],
  async (req, res) => {
    const t1 = await invtDB.transaction();
    const t2 = await invtOakterDB.transaction();

    const validation = new Validator(req.body, {
      componentname: "required",
      componentKey: "required",
    });

    if (validation.fails()) {
      await t1.rollback();
      await t2.rollback();
      return res.json({
        success: false,
        message: "Something is missing in form field to supply",
        data: validation.errors.all(),
        status: "error",
      });
    }

    const component_key = Buffer.from(req.body.componentKey, "base64").toString(
      "ascii"
    );

    try {
      const component = await invtDB.query(
        "SELECT * FROM components WHERE component_key = :component AND c_type = 'S'",
        {
          replacements: { component: component_key },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      if (!component.length) {
        await t1.rollback();
        await t2.rollback();
        return res.json({
          success: false,
          status: "error",
          message: "Component not found or invalid",
        });
      }

      const payload = {
        name: req.body.componentname,
        sac: req.body.sac,
        description: req.body.description,
        uom: req.body.uom,
        gstrate: req.body.gstrate,
        taxtype: req.body.taxtype,
        enable_status: req.body.enable_status,
        componentKey: component_key,
      };

      const updateSQL = `
      UPDATE components
      SET c_name = :name,
          c_sac = :sac,
          c_specification = :description,
          c_uom = :uom,
          c_gst = :gstrate,
          c_tax_type = :taxtype,
          c_is_enabled = :enable_status
      WHERE component_key = :componentKey
    `;

      await Promise.all([
        invtDB.query(updateSQL, {
          replacements: payload,
          type: invtDB.QueryTypes.UPDATE,
          transaction: t1,
        }),
        invtOakterDB.query(updateSQL, {
          replacements: payload,
          type: invtOakterDB.QueryTypes.UPDATE,
          transaction: t2,
        }),
      ]);

      await Promise.all([t1.commit(), t2.commit()]);

      return res.json({
        success: true,
        status: "success",
        message: "Service component updated successfully",
      });
    } catch (err) {
      if (t1) await t1.rollback();
      if (t2) await t2.rollback();
      return helper.errorResponse(res, err);
    }
  }
);

// FETCH COMPONENT IMAGES
router.post("/fetchImageComponent", async (req, res) => {
  try {
    let stmt = await otherDB.query(
      `SELECT invt.user_name, other.* FROM \`${global.ims_db_name}\`.admin_login as invt INNER JOIN \`${global.other_db_name}\`.rm_sku_images as other ON invt.CustID = other.insert_by WHERE other.rm_sku_key = :key ORDER BY other.ID DESC`,
      {
        replacements: {
          key: Buffer.from(req.body.component, "base64").toString("ascii"),
        },
        type: otherDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length > 0) {
      let result = [];

      for (let i = 0; i < stmt.length; i++) {
        let value = stmt[i];

        if (!value.img_url) {
          return res.json({
            success: false,
            status: "error",
            message: "Image key missing in database",
          });
        }

        let imageUrl;
        try {
          imageUrl = await s3Config.getSignedUrl(value.img_url);
        } catch (e) {
          return res.json({
            success: false,
            status: "error",
            message: "Unable to generate image URL from storage",
          });
        }

        result.push({
          image_name: value.img_caption,
          image_url: imageUrl,
          image_id: value.img_attach_id,
          uploaded_date: moment(value.insert_date)
            .tz("Asia/Kolkata")
            .format("DD-MM-YYYY hh:mm:ss A"),
          uploaded_by: value.user_name,
        });
      }

      return res.json({ success: true, data: result, status: "success" });
    } else {
      return res.json({
        success: false,
        message: "no any image(s) found with component",
        status: "error",
      });
    }
  } catch (err) {
    console.log(err)
    return helper.errorResponse(res, err);
  }
});

router.post("/fetchImageComponentv2", [auth.isAuthorized], async (req, res) => {
  try {
    let stmt = await otherDB.query(
      `SELECT invt.user_name, other.* FROM \`${global.ims_db_name}\`.admin_login as invt INNER JOIN \`${global.other_db_name}\`.rm_sku_images as other ON invt.CustID = other.insert_by WHERE other.rm_sku_key = :key ORDER BY other.ID DESC`,
      {
        replacements: { key: req.body.component },
        type: otherDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length > 0) {
      let result = [];
      for (let i = 0; i < stmt.length; i++) {
        let value = stmt[i];

        if (!value.img_url) {
          return res.json({
            success: false,
            status: "error",
            message: "Image key missing in database",
          });
        }

        let imageUrl;
        try {
          imageUrl = await s3Config.getSignedUrl(value.img_url);
        } catch (e) {
          return res.json({
            success: false,
            status: "error",
            message: "Unable to generate image URL from storage",
          });
        }

        result.push({
          image_name: value.img_caption,
          image_url: imageUrl,
          image_id: value.img_attach_id,
          uploaded_date: moment(value.insert_date)
            .tz("Asia/Kolkata")
            .format("DD-MM-YYYY hh:mm:ss A"),
          uploaded_by: value.user_name,
        });
      }
      return res.json({
        success: true,
        message: "Data fetched successfully",
        data: result,
        status: "success",
      });
    } else {
      return res.json({
        success: false,
        message: "no any image(s) found with component",
        status: "error",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// GET ALL REFURBISH COMPONENTS TYPE R
// router.get("/refurbish/", [auth.isAuthorized], (req, res) => {
//   refbDB
//     .query(
//       "SELECT `c_part_no`,`c_name`,`units_name`,`component_key` FROM `components` LEFT JOIN units ON units.units_id = components.c_uom WHERE c_type= 'R' ORDER BY components.ID DESC ",
//       { type: invtDB.QueryTypes.SELECT }
//     )
//     .then((result) => {
//       res.json({
//         success: true,
//         message: "Data fetched successfully",
//         data: result,
//         status: "success",
//       });
//     })
//     .catch((err) => {
//       return helper.errorResponse(res, err);
//     });

//   return;
// });

// INSERT REFURBISH NEW COMPONENT
// router.post(
//   "/refurbish/addComponent",
//   [auth.isAuthorized],
//   async (req, res) => {
//     try {
//       const validation = new Validator(req.body, {
//         component: "required",
//         part: "required",
//         uom: "required",
//         comp_type: "required",
//         group: "required",
//       });

//       const component_type = req.body.comp_type;
//       const part_no = req.body.part;
//       const component_uom = req.body.uom;
//       const component_name = req.body.component;
//       const shortnotes = req.body.notes;

//       const strvalid = helper.strCharValid(component_name);
//       if (strvalid != true) {
//         return res.json({ message: strvalid, success: false, status: "error" });
//       }

//       if (validation.passes()) {
//         const result = await refbDB.query(
//           "SELECT * FROM components WHERE c_part_no = ?",
//           { replacements: [part_no], type: refbDB.QueryTypes.SELECT }
//         );

//         if (result.length > 0) {
//           return res.json({
//             success: false,
//             message: "Part no already exists",
//             status: "error",
//           });
//         }

//         const t = await refbDB.transaction();

//         var key = new Date().getTime();

//         await refbDB.query(
//           "INSERT INTO components (`c_part_no`,`c_name`,`c_uom`,`c_type`,`c_specification`,`component_key`,`c_group`) VALUES (:c_part_no, :c_name, :c_uom, :c_type, :c_specification, :component_key, :c_group)",
//           {
//             replacements: {
//               c_part_no: part_no,
//               c_name: component_name,
//               c_uom: component_uom,
//               c_type: component_type,
//               c_specification: shortnotes,
//               component_key: key,
//               c_group: req.body.group,
//             },
//             type: refbDB.QueryTypes.INSERT,
//             transaction: t,
//           }
//         );

//         await t.commit();
//         return res.json({
//           success: true,
//           message: "Component added successfully",
//           status: "success",
//         });
//       } else {
//         return res.json({
//           message: "something you missing in form field to supply",
//           success: false,
//           data: validation.errors.all(),
//           status: "error",
//         });
//       }
//     } catch (err) {
//       return helper.errorResponse(res, err);
//     }
//   }
// );

// // FETCH REFURBISH UPDATE COMPONENT
// router.post(
//   "/refurbish/fetchUpdateComponent",
//   [auth.isAuthorized],
//   async (req, res) => {
//     let validation = new Validator(req.body, {
//       componentKey: "required",
//     });

//     if (validation.fails()) {
//       res.json({
//         success: false,
//         message: "something you missing in form field to supply",
//         data: validation.errors.all(),
//         status: "error",
//       });
//       return;
//     }

//     try {
//       let stmt = await refbDB.query(
//         "SELECT * FROM `components` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` WHERE `component_key` = :key",
//         {
//           replacements: { key: req.body.componentKey },
//           type: refbDB.QueryTypes.SELECT,
//         }
//       );

//       if (stmt.length > 0) {
//         logs = [];
//         let stmt_group = await refbDB.query(
//           "SELECT * FROM `all_groups` WHERE `group_id` = :groupcode",
//           {
//             replacements: { groupcode: stmt[0].c_group },
//             type: refbDB.QueryTypes.SELECT,
//           }
//         );
//         if (stmt_group.length > 0) {
//           stmt_group.forEach(async (stmt_group_data) => {
//             group_id = stmt_group_data.group_id;
//             group_name = stmt_group_data.group_name;
//           });
//         } else {
//           group_id = "--";
//           group_name = "-- SELECT --";
//         }

//         //NOTIFICATION CHECK
//         alert_status =
//           stmt[0].c_notification == "Y"
//             ? "Y"
//             : stmt[0].c_notification == "N"
//             ? "N"
//             : stmt[0].c_notification == "0"
//             ? "0"
//             : "";

//         //QC ENABLED / DISABLED
//         //NOTIFICATION CHECK
//         qc_status =
//           stmt[0].c_qc_status == "E"
//             ? "E"
//             : stmt[0].c_qc_status == "D"
//             ? "D"
//             : stmt[0].c_qc_status == "0"
//             ? "0"
//             : "";

//         //STATUS
//         enable_status =
//           stmt[0].c_is_enabled == "Y"
//             ? "Y"
//             : stmt[0].c_is_enabled == "N"
//             ? "N"
//             : stmt[0].c_is_enabled == "0"
//             ? "0"
//             : "";

//         //GST TYPE
//         tax_type =
//           stmt[0].c_tax_type == "L"
//             ? "L"
//             : stmt[0].c_tax_type == "I"
//             ? "I"
//             : stmt[0].c_tax_type == "0"
//             ? "0"
//             : "";

//         //GST RATE
//         gst_rate =
//           stmt[0].c_gst == "05"
//             ? "05"
//             : stmt[0].c_gst == "12"
//             ? "12"
//             : stmt[0].c_gst == "18"
//             ? "18"
//             : stmt[0].c_gst == "28"
//             ? "28"
//             : "";

//         const stmt_get_category = await invtDB.query(
//           "SELECT * FROM rm_cat_comp WHERE rm_cat_id = :comp GROUP BY rm_cat_id ",
//           {
//             replacements: { rm_cat_id: stmt[0].component_key },
//             type: invtDB.QueryTypes.SELECT,
//           }
//         );

//         let comp_category_code = "NA";
//         if (stmt_get_category.length > 0) {
//           comp_category_code = stmt_get_category[0].rm_cat_code;
//         }

//         logs.push({
//           comp_cat_code: comp_category_code,
//           attr_code: stmt[0].attribute_code,
//           attr_raw:
//             stmt[0].attribute_raw !== ""
//               ? JSON.parse(stmt[0].attribute_raw)
//               : "",
//           partcode: stmt[0].c_part_no,
//           uomname: stmt[0].units_name,
//           uomid: stmt[0].units_id,
//           name: decode(stmt[0].c_name),
//           mrp: stmt[0].c_mrp,

//           groupid: group_id,
//           groupname: group_name,

//           enable_status: enable_status,
//           alert_status: alert_status,
//           qc_status: qc_status,
//           tax_type: tax_type,
//           gst_rate: gst_rate,
//           sac: stmt[0].c_sac,

//           jobwork_rate: stmt[0].c_jobwork_rate,
//           brand: stmt[0].c_brand,
//           ean: stmt[0].c_ean,
//           weight: stmt[0].c_weight,
//           vweight: stmt[0].c_vweight,
//           height: stmt[0].c_height,
//           width: stmt[0].c_width,

//           minqty: stmt[0].c_min_stock,
//           maxqty: stmt[0].c_max_stock,
//           minorderqty: stmt[0].c_min_order_qty,
//           leadtime: stmt[0].c_lead_time,

//           location: stmt[0].c_default_loc,
//           pocost: stmt[0].c_pocost,
//           othercost: stmt[0].c_othercost,
//           description: stmt[0].c_specification,
//         });
//         return res.json({
//           success: true,
//           message: "Data fetched successfully",
//           data: logs,
//           status: "success",
//         });
//       } else {
//         return res.json({
//           success: false,
//           message: "seems like the component is not vaild longer",
//           status: "error",
//         });
//       }
//       //}
//     } catch (err) {
//       return helper.errorResponse(res, err);
//     }
//     return;
//   }
// );

// // UPDATE REFURBISH COMPONENT
// router.post(
//   "/refurbish/updateComponent",
//   [auth.isAuthorized],
//   async (req, res) => {
//     let validation = new Validator(req.body, {
//       componentname: "required",
//       componentKey: "required",
//     });

//     if (validation.fails()) {
//       res.json({
//         success: false,
//         message: "something you missing in form field to supply",
//         data: validation.errors.all(),
//         status: "error",
//       });
//       return;
//     }
//     let component_key = req.body.componentKey;
//     let component_name = req.body.componentname;
//     let uom = req.body.uom;
//     let description = req.body.description;
//     let mrp = req.body.mrn;
//     let group = req.body.group;
//     let enablestatus = req.body.enable_status;
//     let taxtype = req.body.taxtype;
//     let taxrate = req.body.taxrate;
//     let brand = req.body.brand;
//     let ean = req.body.ean;
//     let othercost = req.body.othercost;
//     let pocost = req.body.pocost;
//     let hsn = "--";
//     let weight = req.body.weightgms;
//     let vweight = req.body.vweightgms;
//     let height = req.body.height;
//     let width = req.body.width;
//     let minqty = req.body.minqty;
//     let maxqty = req.body.maxqty;
//     let minorder = req.body.minorder;
//     let leadtime = req.body.leadtime;
//     let alert_status = req.body.alert;
//     let qc_status = req.body.qc_status;

//     if (group == "--") {
//       return res.json({
//         success: false,
//         message: "supply the component group",
//         status: "error",
//       });
//     } else {
//       const t = await refbDB.transaction();
//       try {
//         let stmt = await refbDB.query(
//           "SELECT * FROM `all_groups` WHERE `group_id` = :group_code",
//           {
//             replacements: { group_code: req.body.group },
//             type: refbDB.QueryTypes.SELECT,
//           }
//         );

//         if (stmt.length > 0) {
//           let stmt2 = await refbDB.query(
//             "SELECT * FROM `components` WHERE `component_key` = :component AND `c_type` = 'R'",
//             {
//               replacements: { component: component_key },
//               type: refbDB.QueryTypes.SELECT,
//             }
//           );

//           if (stmt2.length > 0) {
//             let url_valid = new Validator(req.body, {
//               url: "required",
//             });

//             if (url_valid.passes()) {
//             } else {
//               let stmt = await refbDB.query(
//                 "UPDATE `components` SET `c_name` = :componentname, `c_qc_status` = :qc_status, `c_specification` = :description, `c_min_stock` = :min, `c_max_stock` = :max, `c_min_order_qty` = :minorder, `c_lead_time` = :leadtime, `c_notification` = :alert_status, `update_date` = :update_dt, `updated_by` = :update_by, `c_uom` = :uom, `c_mrp` = :mrp, `c_group` = :group, `c_is_enabled` = :status, `c_tax_type` = :taxtype, `c_gst` = :taxrate, `c_hsn` = :hsn, `c_brand` = :brand, `c_ean` = :ean, `c_weight` = :weight, `c_vweight` = :vweight, `c_height` = :height, `c_width` = :width, `c_pocost` = :pocost, `c_othercost` = :othercost WHERE `component_key` = :key",
//                 {
//                   replacements: {
//                     componentname: component_name,
//                     qc_status: qc_status,
//                     description: description,
//                     uom: uom,
//                     mrp: mrp,
//                     group: group,
//                     status: enablestatus,
//                     taxtype: taxtype,
//                     taxrate: taxrate,
//                     hsn: hsn,
//                     brand: brand,
//                     ean: ean,
//                     weight: weight,
//                     vweight: vweight,
//                     height: height,
//                     width: width,
//                     pocost: pocost,
//                     othercost: othercost,
//                     min: minqty,
//                     max: maxqty,
//                     minorder: minorder,
//                     leadtime: leadtime,
//                     alert_status: alert_status,
//                     key: component_key,
//                     update_dt: moment(new Date())
//                       .tz("Asia/Kolkata")
//                       .format("YYYY-MM-DD HH:mm:ss"),
//                     update_by: req.logedINUser,
//                   },
//                 }
//               );
//               if (stmt.length > 0) {
//                 await t.commit();
//                 return res.json({
//                   success: true,
//                   message: "Component updated successfully",
//                   status: "success",
//                 });
//               }
//             }
//           } else {
//             t.rollback();
//             return res.json({
//               success: false,
//               message: "component not found",
//               status: "error",
//             });
//           }
//         } else {
//           t.rollback();
//           return res.json({
//             success: false,
//             message: "Group not found",
//             status: "error",
//           });
//         }
//       } catch (err) {
//         return helper.errorResponse(res, err);
//       }
//     }
//   }
// );

// // REFURBISH WITH UOM
// router.post(
//   "/refurbish/getComponentDetailsByCode",
//   [auth.isAuthorized],
//   async (req, res) => {
//     const validation = new Validator(req.body, {
//       component_code: "required",
//     });

//     if (validation.passes()) {
//       try {
//         const result = await refbDB.query(
//           "SELECT * FROM `components` LEFT JOIN `units` ON `components`.`c_uom` = `units`.`units_id` WHERE `components`.`component_key` = :key AND `components`.`c_is_enabled` = 'Y'",
//           {
//             replacements: { key: req.body.component_code },
//             type: refbDB.QueryTypes.SELECT,
//           }
//         );
//         if (result.length > 0) {
//           let stmt = await refbDB.query(
//             "SELECT COALESCE(SUM(`qty`+`other_qty`), 0) AS `Outward` FROM `rm_location` WHERE `components_id` = :component AND (`trans_type` != 'INWARD' AND `trans_type` != 'CANCELLED')",
//             {
//               replacements: { component: req.body.component_code },
//               type: refbDB.QueryTypes.SELECT,
//             }
//           );

//           if (stmt.length > 0) {
//             outward_all_qty = stmt[0].Outward;
//           }

//           let stmt1 = await refbDB.query(
//             "SELECT *, COALESCE(SUM(rm_location.qty+rm_location.other_qty), 0) AS Inward FROM rm_location LEFT JOIN components ON rm_location.components_id = components.component_key LEFT JOIN units ON components.c_uom = units.units_id WHERE components.c_type = 'R' AND `components`.`component_key` = :component AND (`rm_location`.`trans_type` = 'INWARD' OR `rm_location`.`trans_type` = 'TRANSFER')",
//             {
//               replacements: { component: req.body.component_code },
//               type: refbDB.QueryTypes.SELECT,
//             }
//           );
//           let currentQty = 0;
//           let key;
//           if (stmt1.length > 0) {
//             currentQty =
//               helper.number(stmt1[0].Inward) - helper.number(outward_all_qty);
//             key = stmt1[0].component_key;
//           }

//           return res.json({
//             success: true,
//             message: "success",
//             data: {
//               key: key,
//               currentQty: currentQty,
//               unit: result[0].units_name,
//             },
//             status: "success",
//           });
//         } else {
//           return res.json({
//             success: false,
//             message: "Component not found",
//             status: "error",
//           });
//         }
//       } catch (err) {
//         return helper.errorResponse(res, err);
//       }
//     } else {
//       return res.json({
//         success: false,
//         message: validation.errors.all(),
//         status: "error",
//       });
//     }
//   }
// );

// SF STOCK CONTROLL
const excel_storage = multer.diskStorage({
  destination: "./files/excel",
  filename: function (req, file, cb) {
    cb(
      null,
      "SF" +
        helper.getUniqueNumber() +
        helper.randomNumber(100, 999) +
        path.extname(file.originalname)
    );
  },
});
const upload_sf_stock = multer({
  storage: excel_storage,
  limits: { fileSize: 5242880 }, // 5 MB (in binary)
  fileFilter: function (_req, file, cb) {
    // Allowed ext
    const filetypes = /csv/;
    // Check ext
    const extname = filetypes.test(
      path.extname(file.originalname).toLowerCase()
    );
    // Check mime
    const mimetype = filetypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb("Error: CSV Only!");
    }
  },
});

// router.post("/uploadSfCtrlFile", [auth.isAuthorized, upload_sf_stock.single("file")], async (req, res) => {
// router.post(
//   "/uploadSfCtrlFile",
//   [upload_sf_stock.single("file")],
//   async (req, res) => {
//     try {
//       if (req.file) {
//         const file = req.file;
//         // console.log(file);
//         const file_name = file.originalname;
//         // GET CSV FILE DATA IN xlsx
//         const workbook = xlsx.readFile(file.path);
//         const worksheet = workbook.Sheets[workbook.SheetNames[0]];
//         const data = xlsx.utils.sheet_to_json(worksheet);
//         const data_length = data.length;
//         for (let i = 0; i < data_length; i++) {
//           let stmt = await invtDB.query(
//             "UPDATE components SET sf_ctrl = :sf_ctrl , sf_ctrl_qty = :sf_ctrl_qty WHERE c_part_no = :part_no ",
//             {
//               replacements: {
//                 sf_ctrl: "Y",
//                 sf_ctrl_qty: data[i].SF_CTRL_QTY,
//                 part_no: data[i].PART_CODE,
//               },
//               type: invtDB.QueryTypes.UPDATE,
//             }
//           );
//         }

//         fs.unlinkSync(file.path);

//         return res.json({
//           success: true,
//           message: "File uploaded successfully",
//           status: "success",
//         });
//       } else {
//         return res.json({
//           success: false,
//           message: "file not found",
//           status: "error",
//         });
//       }
//     } catch (err) {
//       return helper.errorResponse(res, err);
//     }
//   }
// );

// FETCH SF STOCK CONTROLL
// router.get("/fetchSfCtrl", [auth.isAuthorized], async (req, res) => {
//   try {
//     const result = await invtDB.query(
//       "SELECT c_part_no as part_no  , c_name as part_name , sf_ctrl_qty FROM components WHERE sf_ctrl = 'Y'",
//       {
//         type: invtDB.QueryTypes.SELECT,
//       }
//     );

//     if (result.length > 0) {
//       return res.json({
//         success: true,
//         message: "Data fetched successfully",
//         data: result,
//         status: "success",
//       });
//     } else {
//       return res.json({
//         success: false,
//         message: "No data found",
//         status: "error",
//       });
//     }
//   } catch (err) {
//     return helper.errorResponse(res, err);
//   }
// });

// UPDATE ATTRIBUTE
router.post("/updateAttrCode", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    componentKey: "required",
    attributeCode: "required",
  });

  if (validation.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: "something you missing in form field to supply",
      data: validation.errors.all(),
    });
  }
  let component_key = Buffer.from(req.body.componentKey, "base64").toString(
    "ascii"
  );
  let attribute_code = req.body.attributeCode;

  const t = await invtDB.transaction();
  try {
    let stmt0 = await invtDB.query(
      "SELECT * FROM components WHERE attribute_code = :attr_code",
      {
        replacements: { attr_code: attribute_code },
      }
    );
    if (stmt0.length > 0) {
      await t.rollback();
      return res.json({
        success: false,
        message:
          "same attribute code already mapped with another component (" +
          stmt0[0].c_part_no +
          ")",
        status: "error",
      });
    }
    let stmt1 = await invtDB.query(
      "SELECT * FROM components WHERE component_key = :component AND c_type = 'R'",
      {
        replacements: { component: component_key },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt1.length > 0) {
      if (stmt1[0].attribute_code == attribute_code) {
        await t.rollback();
        return res.json({
          success: false,
          message: "same attribute code already mapped",
          status: "error",
        });
      }
      if (stmt1[0].attribute_code !== "--") {
        await t.rollback();
        return res.json({
          success: false,
          message: "once attribute code is mapped cannot be changed",
          status: "error",
        });
      }

      let stmt2 = await invtDB.query(
        "UPDATE components SET attribute_code = :attr_code, update_date = :update_dt, updated_by = :update_by WHERE component_key = :key",
        {
          replacements: {
            key: component_key,
            update_dt: moment(new Date())
              .tz("Asia/Kolkata")
              .format("YYYY-MM-DD HH:mm:ss"),
            update_by: req.logedINUser,
            attr_code: attribute_code,
          },
          type: invtDB.QueryTypes.UPDATE,
          transaction: t,
        }
      );
      if (stmt2.length > 0) {
        await t.commit();
        return res.json({
          success: true,
          message: "Attribute mapped successfully",
          status: "success",
        });
      }
    } else {
      await t.rollback();
      return res.json({
        success: false,
        message: "component not found",
        status: "error",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

router.get("/compMasterReport", [auth.isAuthorized], async (req, res) => {
  try {
    const stmt = await invtDB.query(
      "SELECT components.* , units.units_name , all_groups.group_name , admin_login.user_name , update_user.user_name as update_user FROM components LEFT JOIN units ON units.units_id = components.c_uom LEFT JOIN all_groups ON all_groups.group_id = components.c_group LEFT JOIN admin_login ON admin_login.CustID = components.inserted_by LEFT JOIN admin_login update_user ON update_user.CustID = components.updated_by WHERE c_type = 'R'",
      {
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length > 0) {
      const data = [];

      for (let i = 0; i < stmt.length; i++) {
        if (stmt[i].c_attr_category == "O") {
          stmt[i].c_attr_category = "Other";
        }
        if (stmt[i].c_attr_category == "C") {
          stmt[i].c_attr_category = "Capacitor";
        }
        if (stmt[i].c_attr_category == "R") {
          stmt[i].c_attr_category = "Resistor";
        }
        data.push({
          "PART CODE": stmt[i].c_part_no,
          "NEW PART CODE": stmt[i].c_new_part_no,
          "PART NAME": stmt[i].c_name,
          UOM: stmt[i].units_name,
          DESC: stmt[i].c_specification,
          "CREATE DATE": moment(
            stmt[i].insert_date,
            "YYYY-MM-DD HH:mm:ss"
          ).format("DD-MM-YYYY HH:mm"),
          "CREATE BY": stmt[i].user_name,
          "UPDATE BY": stmt[i].update_user,
          "UPDATE DATE": moment(
            stmt[i].update_date,
            "YYYY-MM-DD HH:mm:ss"
          ).format("DD-MM-YYYY HH:mm"),
          CATEGORY: stmt[i].c_category,
          "ATTRIBUTE CODE": stmt[i].attribute_code,
          "ATTRIBUTE VALUE": stmt[i].attribute_raw,
          "IS ENABLED": stmt[i].c_is_enabled,
          GROUP: stmt[i].group_name,
          "Min STOCK": stmt[i].c_min_stock,
          "Max STOCK": stmt[i].c_max_stock,
          "Min ORDER QTY": stmt[i].c_min_order_qty,
          HSN: stmt[i].c_hsn,
          "TAX TYPE": stmt[i].c_tax_type,
          BRAND: stmt[i].c_brand,
          WEIGHT: stmt[i].c_weight,
          HEIGHT: stmt[i].c_height,
          "PO COST": stmt[i].c_po_cost,
          "OTHER COST": stmt[i].c_other_cost,
          "JOBWORK RATE": stmt[i].c_jobwork_rate,
          "STANDARD PRICE": stmt[i].c_standard_price,
        });
      }

      const workbook = xlsx.utils.book_new();
      const worksheet = xlsx.utils.json_to_sheet(data);
      xlsx.utils.book_append_sheet(workbook, worksheet, "COMP MASTER");

      const fileName = "Compnente Master " + helper.getUniqueNumber() + ".csv";
      const filePath = "./files/excel/";

      xlsx.writeFile(workbook, filePath + fileName);

      return res.json({
        success: true,
        data: {
          filePath: `${process.env.API_URL}` + filePath + fileName,
          fileName: fileName,
        },
        status: "success",
      });
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "No data found",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

router.get("/serviceMasterReport", [auth.isAuthorized], async (req, res) => {
  try {
    const stmt = await invtDB.query(
      "SELECT components.* , units.units_name , all_groups.group_name , admin_login.user_name , update_user.user_name as update_user FROM components LEFT JOIN units ON units.units_id = components.c_uom LEFT JOIN all_groups ON all_groups.group_id = components.c_group LEFT JOIN admin_login ON admin_login.CustID = components.inserted_by LEFT JOIN admin_login update_user ON update_user.CustID = components.updated_by WHERE c_type = 'S'",
      {
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length > 0) {
      const data = [];

      for (let i = 0; i < stmt.length; i++) {
        data.push({
          "PART CODE": stmt[i].c_part_no,
          "NEW PART CODE": stmt[i].c_new_part_no,
          "PART NAME": stmt[i].c_name,
          UOM: stmt[i].units_name,
          DESC: stmt[i].c_specification,
          "CREATE DATE": moment(
            stmt[i].insert_date,
            "YYYY-MM-DD HH:mm:ss"
          ).format("DD-MM-YYYY HH:mm"),
          "CREATE BY": stmt[i].user_name,
          "UPDATE BY": stmt[i].update_user,
          "UPDATE DATE": moment(
            stmt[i].update_date,
            "YYYY-MM-DD HH:mm:ss"
          ).format("DD-MM-YYYY HH:mm"),
          CATEGORY: stmt[i].c_category,
          "ATTRIBUTE CODE": stmt[i].attribute_code,
          "IS ENABLED": stmt[i].c_is_enabled,
          GROUP: stmt[i].group_name,
          "Min STOCK": stmt[i].c_min_stock,
          "Max STOCK": stmt[i].c_max_stock,
          "Min ORDER QTY": stmt[i].c_min_order_qty,
          HSN: stmt[i].c_hsn,
          "TAX TYPE": stmt[i].c_tax_type,
          BRAND: stmt[i].c_brand,
          WEIGHT: stmt[i].c_weight,
          HEIGHT: stmt[i].c_height,
          "PO COST": stmt[i].c_po_cost,
          "OTHER COST": stmt[i].c_other_cost,
          "JOBWORK RATE": stmt[i].c_jobwork_rate,
          "STANDARD PRICE": stmt[i].c_standard_price,
        });
      }

      const workbook = xlsx.utils.book_new();
      const worksheet = xlsx.utils.json_to_sheet(data);
      xlsx.utils.book_append_sheet(workbook, worksheet, "Service Master");

      const fileName = "serviceMaster.csv";
      const filePath = "./files/excel/";

      xlsx.writeFile(workbook, filePath + fileName);

      return res.json({
        success: true,
        data: {
          filePath: `${process.env.API_URL}` + filePath + fileName,
          fileName: fileName,
        },
        status: "success",
      });
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "No data found",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

//UPDATE ALT_PART_NO
router.post("/update_alt_part_no", [auth.isAuthorized], async (req, res) => {
  let validation = new Validator(req.body, {
    componentKey: "required",
    alt_part_key: "required",
  });

  if (validation.fails()) {
    return res.json({
      status: "error",
      success: false,
      message: "something you missing in form field to supply",
    });
  }

  let component_key = Buffer.from(req.body.componentKey, "base64").toString(
    "ascii"
  );
  let part_key = req.body.alt_part_key.toString();

  let part_code = "";
  const t = await invtDB.transaction();
  try {
    let part_key_array = part_key.split(",");
    for (let altComponentKey of part_key_array) {
      if (altComponentKey === component_key) {
        await t.rollback();
        return res.json({
          status: "error",
          success: false,
          message: "Similar part code is not same as component",
        });
      }

      let result = await invtDB.query(
        "SELECT * FROM components WHERE component_key = :component AND c_type = 'R'",
        {
          replacements: { component: altComponentKey },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      let partCodeFromQuery = result[0].c_part_no;

      if (part_code !== "") {
        part_code += ",";
      }
      part_code += partCodeFromQuery;
    }

    let stmt1 = await invtDB.query(
      "SELECT * FROM components WHERE component_key = :component AND c_type = 'R'",
      {
        replacements: { component: component_key },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt1.length > 0) {
      let stmt2 = await invtDB.query(
        "UPDATE components SET c_alt_part_no = :part_code, c_alt_part_key = :part_key, update_date = :update_dt, updated_by = :update_by WHERE component_key = :key",
        {
          replacements: {
            key: component_key,
            part_code: part_code,
            part_key: part_key,
            update_dt: moment(new Date())
              .tz("Asia/Kolkata")
              .format("YYYY-MM-DD HH:mm:ss"),
            update_by: req.logedINUser,
          },
          type: invtDB.QueryTypes.UPDATE,
          transaction: t,
        }
      );
      if (stmt2.length > 0) {
        await t.commit();
        return res.json({
          status: "success",
          success: true,
          message: "Similar Part Codes mapped successfully",
        });
      }
    } else {
      await t.rollback();
      return res.json({
        status: "error",
        success: false,
        message: "Component not found",
      });
    }
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

router.post(
  "/fetchalternatePartcode",
  [auth.isAuthorized],
  async (req, res) => {
    let validation = new Validator(req.body, {
      componentKey: "required",
    });

    if (validation.fails()) {
      return res.json({
        status: "error",
        success: false,
        message: "something you missing in form field to supply",
      });
    }

    let component_key = Buffer.from(req.body.componentKey, "base64").toString(
      "ascii"
    );

    try {
      let stmt = await invtDB.query(
        "SELECT * FROM components WHERE component_key = :key",
        {
          replacements: { key: component_key },
          type: invtDB.QueryTypes.SELECT,
        }
      );

      const data = [];
      if (stmt.length > 0) {
        let stmt_comp_name = await invtDB.query(
          "SELECT c_name, c_part_no, units_name FROM components LEFT JOIN units ON components.c_uom = units.units_id WHERE component_key IN (:component_key) ",
          {
            replacements: { component_key: stmt[0].c_alt_part_key.split(",") },
            type: invtDB.QueryTypes.SELECT,
          }
        );

        stmt_comp_name.forEach((item, index) => {
          data.push({
            alternatepartCode: stmt[0].c_alt_part_no.split(",")[index],
            alternatepartKey: stmt[0].c_alt_part_key.split(",")[index],
            alternatepartName: item.c_name,
            alternatepartUOM: item.units_name,
          });
        });
      } else {
        return res.json({
          status: "error",
          success: false,
          message: "No data found",
        });
      }

      return res.json({
        success: true,
        status: "success",
        data: data,
      });
    } catch (error) {
      return helper.errorResponse(res, error);
    }
  }
);

router.get("/electronicReport", [auth.isAuthorized], async (req, res) => {
  try {
    const components = await invtDB.query(
      "SELECT c_part_no AS partCode , c_name AS componentName , c_attr_category , attribute_code AS attributeCode , attribute_raw FROM components WHERE c_attr_category IN ('C','R','I')",
      {
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (components.length <= 0) {
      return res.json({
        success: false,
        status: "error",
        message: "No data found",
      });
    }

    let capacitors = [];
    let resistors = [];
    let inductors = [];

    for (let i = 0; i < components.length; i++) {
      if (components[i].c_attr_category == "C") {
        let attributes = JSON.parse(components[i].attribute_raw);

        delete components[i].attribute_raw;
        delete components[i].c_attr_category;

        const merged = Object.assign({}, components[i], attributes);

        capacitors.push(merged);
      }

      if (components[i].c_attr_category == "R") {
        let attributes = JSON.parse(components[i].attribute_raw);

        delete components[i].attribute_raw;
        delete components[i].c_attr_category;

        const merged = Object.assign({}, components[i], attributes);

        resistors.push(merged);
      }

      if (components[i].c_attr_category == "I") {
        let attributes = JSON.parse(components[i].attribute_raw);

        delete components[i].attribute_raw;
        delete components[i].c_attr_category;

        const merged = Object.assign({}, components[i], attributes);

        inductors.push(merged);
      }
    }

    const capcacitorSheet = xlsx.utils.json_to_sheet(capacitors);
    const resistorSheet = xlsx.utils.json_to_sheet(resistors);
    const inductorSheet = xlsx.utils.json_to_sheet(inductors);

    const workbook = xlsx.utils.book_new();

    xlsx.utils.book_append_sheet(workbook, capcacitorSheet, "Capacitors");
    xlsx.utils.book_append_sheet(workbook, resistorSheet, "Resistors");
    xlsx.utils.book_append_sheet(workbook, inductorSheet, "Inductors");

    xlsx.write(workbook, { bookType: "xlsx", type: "buffer" });

    let filename = "electronicReport_" + helper.getUniqueNumber() + ".xlsx";

    xlsx.writeFile(workbook, "./files/electronicReport/" + filename);

    return res.json({
      success: true,
      data: `${process.env.API_URL}/files/electronicReport/` + filename,
      status: "success",
    });
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

module.exports = router;
