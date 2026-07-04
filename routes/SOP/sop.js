const express = require("express");
const router = express.Router();
const multer = require("multer");
const { v4 } = require("uuid");

const auth = require("../../middleware/auth");
const permission = require("../../middleware/permission");
let { invtDB, otherDB } = require("../../config/db/connection");
// const sms = require("../../../helper/smsGateway");
var storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "./files/policies/");
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname);
  },
});
const upload = multer({ storage: storage, limits: { fileSize: 50000000 } });

const Validator = require("validatorjs");

//FETCH USER DETAILS
router.get("/getRootDirectory", [auth.isAuthorized], async (req, res) => {
  try {
    const rootDir = await otherDB.query("SELECT * from ims_drive where parent = '--'", {
      type: otherDB.QueryTypes.SELECT,
    });
    res.json({ data: rootDir });
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});
router.post("/setChildDirectories", [auth.isAuthorized], async (req, res) => {
  try {
    const rootDir = await otherDB.query("SELECT * from ims_drive where parent = :parent", {
      replacements: {
        parent: req.body.parent,
      },
      type: otherDB.QueryTypes.SELECT,
    });
    let arr = rootDir;
    arr = arr.map((row) => ({
      ...row,
      file_path: row.type === "file" && `https://ims.mscapi.live/files/policies/${row.file_path}`,
    }));
    res.json({ data: arr });
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});
router.post("/getSpecificDirectory", [auth.isAuthorized], async (req, res) => {
  try {
    const directory = await otherDB.query("SELECT * from ims_drive where unique_id = :id", {
      replacements: {
        id: req.body.id,
      },
      type: otherDB.QueryTypes.SELECT,
    });
    res.json({ data: directory[0] });
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});
router.post("/newDirectory", [auth.isAuthorized], async (req, res) => {
  const transaction = otherDB.transaction();
  try {
    const departmentId = v4();
    const sopFolderId = v4();
    const formFolderId = v4();
    await otherDB.query(
      "INSERT INTO  ims_drive (name,parent,unique_id,type, file_path, description, insert_dt, insert_time) VALUES(:name, '--', :unique_id,'dir','--','--', :insert_dt,:insert_time),('SOP', :unique_id, :sop_unique_id,'dir','--','--', :insert_dt,:insert_time),('Form', :unique_id, :formFolderId,'dir','--','--', :insert_dt,:insert_time)",
      {
        replacements: {
          name: req.body.name,
          unique_id: departmentId,
          sop_unique_id: sopFolderId,
          formFolderId: formFolderId,
          insert_dt: helper.getCurrentDate(),
          description: req.body.description,
          insert_time: helper.getCurrentTime(),
        },
      }
    );
    await transaction;
    res.json({ message: "New Folder Created" });
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});
router.post("/uploadFile", [auth.isAuthorized], upload.single("file"), async (req, res) => {
  const transaction = otherDB.transaction();
  try {
    let unique_id = helper.getUniqueNumber();
    const directory = await otherDB.query("INSERT INTO  ims_drive (name, parent,unique_id,type, file_path,description, insert_dt, insert_time) VALUES(:name, :parent, :unique_id,'file',:file_path,:description, :insert_dt, :insert_time)", {
      replacements: {
        name: req.body.name,
        parent: req.body.parent,
        unique_id: unique_id,
        file_path: req.file.originalname,
        insert_dt: helper.getCurrentDate(),
        description: req.body.description,
        insert_time: helper.getCurrentTime(),
      },
    });
    await transaction;
    res.json({

      message: "File Uploaded Created",
      data: {
        unique_id: unique_id,
        filePath: `https://ims.mscapi.live/files/policies/${req.file.originalname}`,
      },
    });
  } catch (error) {
      return helper.errorResponse(res, error);
  }
});

module.exports = router;
