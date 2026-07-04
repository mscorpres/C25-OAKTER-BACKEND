const express = require("express");
const router = express.Router();
const fs = require("fs");
const axios = require("axios");
const FormData = require("form-data");
let { format } = require("timeago.js");
let { invtDB, otherDB } = require("../../config/db/connection");
const auth = require("../../middleware/auth");
const permission = require("../../middleware/permission");
const { encode, decode } = require("html-entities");
const Validator = require("validatorjs");
const multer = require("multer");
const path = require("path");
const { s3Client, s3Config } = require("../../config/awsConfig");


var version_storage = multer.memoryStorage();
var version_uploadfile = multer({ storage: version_storage });

// Upload version file API
router.post(
  "/uploadVersion",
  [auth.isAuthorized, version_uploadfile.single("file")],
  async (req, res) => {
    try {
      if (!req.file) {
        return res.json({
          success: false,
          message: "Add a version file",
        });
      }
      if (!req.body.doc_name) {
        return res.json({
          success: false,
          message: "Add version file name",
        });
      }

  
      const fileExtension = path.extname(req.file.originalname);
      const filename = `version-${Date.now()}${fileExtension}`;
      const attachmentId = helper.getUniqueNumber();
      
     
      const s3Key = `version-files/${filename}`;

    
      try {
        await s3Config.uploadFile(req.file, s3Key);
        // console.log(`File uploaded to S3: ${s3Key}`);
      } catch (s3Error) {
          return helper.errorResponse(res, s3Error);
      }

      const transaction = await invtDB.transaction();
      

      let stmt = await invtDB.query(
        "INSERT INTO `ims_version_files` (`doc_file_name`, `version_file`, `uploaded_by`, `upload_dt`, `version_id`, `trans_type`, `attachment_id`) VALUES(:label, :file, :by, :date, :version, :type, :attachment_id)",
        {
          replacements: {
            label: req.body.doc_name,
            file: s3Key, 
            by: req.logedINUser,
            date: moment(new Date()).tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss"),
            version: req.body.version_id || "2.1",
            type: "VERSION",
            attachment_id: attachmentId,
          },
          type: invtDB.QueryTypes.INSERT,
          transaction: transaction,
        }
      );

      if (stmt.length > 0) {
        await transaction.commit();
        
        
        const signedUrl = await s3Config.getSignedUrl(s3Key);
        
        return res.json({
          success: true,
          message: "Version file attached successfully",
          data: {
            filename: filename,
            attachment_id: attachmentId,
            doc_name: req.body.doc_name,
            upload_date: moment(new Date()).tz("Asia/Kolkata").format("DD-MM-YYYY hh:mm:ss A"),
            is_new: true, 
            doc_url: signedUrl 
          },
        });
      } else {
        
        try {
          await s3Config.deleteObject(s3Key);
          // console.log(`Deleted file from S3: ${s3Key}`);
        } catch (deleteError) {
          // console.error("Error deleting file from S3:", deleteError);
        }
        
        await transaction.rollback();
        return res.json({
          success: false,
          message: "An error occurred while uploading version file",
        });
      }
    } catch (err) {
        return helper.errorResponse(res, err);
    }
  }
);

// Fetch uploaded version files API
router.post("/fetchVersionFiles", async (req, res) => {
  try {
    const stmt = await invtDB.query(
      "SELECT * FROM `ims_version_files` LEFT JOIN `admin_login` ON `admin_login`.`CustID` = `ims_version_files`.`uploaded_by` WHERE `ims_version_files`.`trans_type` = 'VERSION' AND `ims_version_files`.`version_id` = :version_id AND `ims_version_files`.`status` = 'ON' ORDER BY `ims_version_files`.`ID` DESC",
      {
        replacements: { version_id: req.body.version_id || "2.1" },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (stmt.length === 0) {
      return res.json({
        success: false,
        message: "No version files found for the provided version ID",
      });
    }

   
    const result = await Promise.all(
      stmt.map(async (value) => {
        const s3Key = value.version_file; 
        let fileSize = "Unknown";
        let signedUrl = "";

        try {
          
          const headData = await s3Config.headObject(s3Key);
          
          fileSize = helper.fileSize(headData.ContentLength);
          
          
          signedUrl = await s3Config.getSignedUrl(s3Key);
        } catch (err) {
          // console.log(`Error accessing S3 file ${s3Key}:`, err.message);
          signedUrl = ""; 
        }

        const uploadDate = moment(value.upload_dt).tz("Asia/Kolkata");
        const isNew = moment().tz("Asia/Kolkata").diff(uploadDate, "days") <= 7;

        return {
          doc_name: value.doc_file_name,
          doc_url: signedUrl, 
          doc_id: value.attachment_id,
          uploaded_date: uploadDate.format("DD-MM-YYYY hh:mm:ss A"),
          uploaded_by: value.user_name || value.uploaded_by || "Unknown",
          serial_no: helper.randomNumber(1000, 9999),
          is_new: isNew,
          file_size: fileSize,
          s3_key: s3Key 
        };
      })
    );

    return res.json({
      success: true,
      message: "Version files fetched successfully",
      data: result,
    });
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});


router.delete("/deleteVersionFile/:attachmentId", [auth.isAuthorized], async (req, res) => {
  try {
    const { attachmentId } = req.params;

    const fileInfo = await invtDB.query(
      "SELECT `version_file` FROM `ims_version_files` WHERE `attachment_id` = :attachmentId",
      {
        replacements: { attachmentId },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (fileInfo.length === 0) {
      return res.json({
        success: false,
        message: "File not found",
      });
    }

    const s3Key = fileInfo[0].version_file;

    try {
      await s3Config.deleteObject(s3Key);
      // console.log(`Deleted file from S3: ${s3Key}`);
    } catch (s3Error) {
      // console.error("Error deleting from S3:", s3Error);
    }

    // Delete from database
    const transaction = await invtDB.transaction();
    await invtDB.query(
      "DELETE FROM `ims_version_files` WHERE `attachment_id` = :attachmentId",
      {
        replacements: { attachmentId },
        type: invtDB.QueryTypes.DELETE,
        transaction: transaction,
      }
    );
    await transaction.commit();

    return res.json({
      success: true,
      message: "File deleted successfully",
    });
  } catch (err) {
      return helper.errorResponse(res, err);
  }
});

module.exports = router;