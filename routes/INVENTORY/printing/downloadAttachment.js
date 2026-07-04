// let { invtDB } = require("../../../config/db/connection");

// const Validator = require("validatorjs");
// const archiver = require('archiver');
// const fs = require('fs');
// const path = require('path');

// const express = require("express");
// const router = express.Router();

// const auth = require("./../../../middleware/auth");
// const permission = require("./../../../middleware/permission");

// router.post("/download", [auth.isAuthorized], async (req, res) => {
//     try {
//         const valid = new Validator(req.body, {
//             transaction: "required",
//         });

//         if (valid.fails()) {
//             return res.json({ data: null, success: false, message: "transaction ID is required"  });
//         }

//         const images = await invtDB.query(
//             "SELECT * FROM ims_min_invoices WHERE `min_min_id` = :min_transaction_id",
//             {
//                 replacements: { min_transaction_id: req.body.transaction },
//                 type: invtDB.QueryTypes.SELECT,
//             }
//         );

//         if (images.length === 0) {
//             return res.json({ success: false, data: null, message: "no attachment found"});
//         }

//         if (images.length === 1) {
//             const imageUrl = `${process.env.API_URL}/uploads/minInvoices/${images[0].min_inv_file}`;
//             return res.json({ success: true, message: "File Generated Successfully", data: { url: imageUrl } });
//         } else {
//             const zipPath = path.join(__dirname, '..', '..', '..', 'tmp', `${req.body.transaction.replace(/[^\w\s]/gi, '') + '.zip'}`);
//             const output = fs.createWriteStream(zipPath);
//             const archive = archiver('zip', {
//                 zlib: { level: 9 }
//             });

//             output.on('close', () => {
//                 return res.json({ success: true, message: null, data: { url: `${process.env.API_URL}/tmp/${req.body.transaction.replace(/[^\w\s]/gi, '')}.zip` } });
//             });

//             archive.on('error', (err) => {
//                 return res.json({ data: null, success: false, message: "Error creating zip archive"});
//             });

//             archive.pipe(output);
//             images.forEach((image) => {
//                const imageUrl = `uploads/minInvoices/${image.min_inv_file}`;
//                 archive.append(fs.createReadStream(imageUrl), { name: image.min_inv_file });
//             });

//             archive.finalize();
//         }
//     } catch (err) {
//         return res.json({ data: null, success: false, message:  "Internal error!!!"});
//     }
// });

// module.exports = router;


/*===============================================================================================*/
//NEW API AS PER AWS S3 BUCKET

let { invtDB } = require("../../../config/db/connection");

const Validator = require("validatorjs");
const archiver = require('archiver');
const fs = require('fs');
const path = require('path');
const { s3Client, s3Config } = require("../../../config/awsConfig");
const { GetObjectCommand } = require("@aws-sdk/client-s3");
const { Readable } = require('stream');

const express = require("express");
const router = express.Router();

const auth = require("./../../../middleware/auth");
const permission = require("./../../../middleware/permission");

router.post("/download",[auth.isAuthorized], async (req, res) => {
  let responseSent = false;

  try {
    const valid = new Validator(req.body, {
      transaction: "required",
    });

    if (valid.fails()) {
      return res.json({ data: null, status: "error", success: false, message: "transaction ID is required" });
    }

    const images = await invtDB.query("SELECT * FROM ims_min_invoices WHERE `min_min_id` = :min_transaction_id", {
      replacements: { min_transaction_id: req.body.transaction },
      type: invtDB.QueryTypes.SELECT,
    });

    if (images.length === 0) {
      return res.json({ status: "error", success: false, data: null, message: "no attachment found" });
    }

    // ⭐ CHOOSE THE CORRECT PATH - Use whichever matches your S3 structure
    // Option 1: With date folders
    const getS3Key = (filename) => `uploads/2025/2025-09/uploads/minInvoices/${filename}`;

    // Option 2: Without date folders (simpler)
    // const getS3Key = (filename) => `uploads/minInvoices/${filename}`;

    if (images.length === 1) {
      // Single file - return direct URL
      const s3Key = getS3Key(images[0].min_inv_file);

      console.log("🔍 Attempting to fetch single file from S3:", s3Key); // DEBUG

      try {
        const imageUrl = await s3Config.getSignedUrl(s3Key);
        return res.json({  status: "success", success: true, message: "File Generated Successfully", data: { url: imageUrl } });
      } catch (err) {
        console.log(`❌ Error accessing S3 file ${s3Key}:`, err.message);
        return res.json({ status: "error", success: false, data: null, message: "File not found in S3" });
      }
    } else {
      // Multiple files - create zip
      const zipFilename = `${req.body.transaction.replace(/[^\w\s]/gi, "")}.zip`;
      const zipPath = path.join(__dirname, "..", "..", "..", "tmp", zipFilename);

      // Ensure tmp directory exists
      const tmpDir = path.join(__dirname, "..", "..", "..", "tmp");
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
      }

      const output = fs.createWriteStream(zipPath);
      const archive = archiver("zip", {
        zlib: { level: 9 },
      });

      // Handle successful zip creation
      output.on("close", async () => {
        if (responseSent) return;
        responseSent = true;

        console.log(`✅ Archive finalized: ${archive.pointer()} bytes`); // DEBUG

        try {
          // Read the created zip file
          const zipBuffer = fs.readFileSync(zipPath);

          console.log(`📦 Zip file size: ${zipBuffer.length} bytes`); // DEBUG

          // Upload to S3
          const s3ZipKey = `tmp/${zipFilename}`;

          await s3Config.uploadFile(
            {
              buffer: zipBuffer,
              mimetype: "application/zip",
            },
            s3ZipKey
          );

          // Get signed URL
          const zipUrl = await s3Config.getSignedUrl(s3ZipKey);

          // Clean up local file
          fs.unlinkSync(zipPath);

          return res.json({ status: "success", success: true, message: "Zip file created successfully", data: { url: zipUrl } });
        } catch (uploadErr) {
          console.error("❌ Error uploading zip to S3:", uploadErr);

          // Clean up local file on error
          if (fs.existsSync(zipPath)) {
            fs.unlinkSync(zipPath);
          }

          return res.json({ data: null, success: false, message: "Error uploading zip to S3", err: uploadErr.message });
        }
      });

      // Handle archive errors
      archive.on("error", (err) => {
        if (responseSent) return;
        responseSent = true;

        console.error("❌ Archive error:", err);

        if (fs.existsSync(zipPath)) {
          fs.unlinkSync(zipPath);
        }

        return res.json({ data: null, success: false, message: "Error creating zip archive", err: err.message });
      });

      output.on("error", (err) => {
        if (responseSent) return;
        responseSent = true;

        return res.json({ data: null, success: false, message: "Error writing zip file", err: err.message });
      });

      
      archive.pipe(output);

      console.log(`📥 Fetching ${images.length} files from S3...`);

      
      let successCount = 0;
      let failCount = 0;

      const appendPromises = images.map(async (image, index) => {
        const s3Key = getS3Key(image.min_inv_file);

        console.log(`🔍 [${index + 1}/${images.length}] Fetching: ${s3Key}`);

        try {
          
          const command = new GetObjectCommand({
            Bucket: s3Config.bucket,
            Key: s3Key,
          });
          const response = await s3Client.send(command);

          console.log(`✅ [${index + 1}/${images.length}] Successfully fetched: ${image.min_inv_file}`); // DEBUG

          const stream = response.Body instanceof Readable ? response.Body : Readable.from(response.Body);

          return new Promise((resolve, reject) => {
            archive.append(stream, { name: image.min_inv_file });

            stream.on("end", () => {
              successCount++;
              resolve();
            });

            stream.on("error", (err) => {
              failCount++;
              reject(err);
            });
          });
        } catch (err) {
          failCount++;
          return Promise.resolve();
        }
      });

      await Promise.all(appendPromises);
      await archive.finalize();
    }
  } catch (err) {
    if (responseSent) return;
    responseSent = true;

    console.error("❌ Unexpected error:", err);
    return res.json({ data: null, success: false, message: "Internal error!!!", err: err.message });
  }
});

module.exports = router;