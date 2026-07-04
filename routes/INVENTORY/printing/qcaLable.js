let { invtDB } = require("../../../config/db/connection");


const QRCode = require("qrcode");
const htmlToPdf = require("html-pdf-node");
const fs = require("fs");

const express = require("express");
const router = express.Router();
const Validator = require("validatorjs");

const auth = require("./../../../middleware/auth");
const permission = require("./../../../middleware/permission");

router.post("/generateQcaLable", [auth.isAuthorized], async (req, res) => {
  const valid = new Validator(req.body, {
    skuType: "required",
    totalQr: "required",
  });

  if (valid.fails()) {
    return res.status(400).send(helper.firstErrorValidatorjs(valid));
  }

  const t = await invtDB.transaction();
  try {
    const { skuType } = req.body;
    if (skuType == "FG") {
      fornumber = "FGQR";
    }
    if (skuType == "SFG") {
      fornumber = "SFGQR";
    }

    let getNumber = await invtDB.query("SELECT * FROM `ims_numbering` WHERE `for_number` = :for_number FOR UPDATE", {
      replacements: { for_number: fornumber },
      type: invtDB.QueryTypes.SELECT,
      transaction: t,
    });

    let currentId;
    let prefix;
    let suffix;

    if (getNumber.length > 0) {
      suffix = getNumber[0].suffix;
      suffix = suffix.toString();
      suffix = suffix.padStart(parseInt(getNumber[0].number_length_limit), "0");

      prefix = getNumber[0].prefix;
    } else {
      return res.json({ status: "error", success: false, message: "Internal Error<br/>If this condition persists, contact your system administrator" });
    }

    html = `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Document</title>
        </head>
        <body>
        <table>
        `;

    let newSuffix;
    for (var i = 0; i < req.body.totalQr; i++) {
      suffix = parseInt(suffix) + 1;
      newSuffix = suffix.toString();
      newSuffix = newSuffix.padStart(parseInt(getNumber[0].number_length_limit), "0");

      if (i % 6 === 0) {
        if (i != 6) {
          html += "<tr>";
        }
      }

      let qr_data = prefix + newSuffix;
      let qr = await QRCode.toDataURL(qr_data);
      html += `
                        <td>
                            <img height='120px' weight='80px' src='${qr}'alt='QR Code' />
                        </td>
                    `;

      if (i % 6 === 5 || i === req.body.totalQr - 1) {
        html += "</tr>";
      }
    }

    html += `</table></body></html>`;

    let options = { format: "A4" };
    let file = { content: html };
    htmlToPdf
      .generatePdf(file, options)
      .then(async (pdfBuffer) => {
        const UPDATE = await invtDB.query("UPDATE `ims_numbering` SET `suffix` = suffix + :suffix WHERE `for_number` = :for_number", {
          replacements: { suffix: req.body.totalQr, for_number: fornumber },
          type: invtDB.QueryTypes.UPDATE,
          transaction: t,
        });

        await t.commit();

        // res.header("Content-Type", "application/pdf");
        // res.header("Content-Disposition", "attachment; filename=QCA.pdf");
        // res.send(pdfBuffer);

        // return;

        return res.json({

          message: "QCA Lable Generated..",
          status: "success", success: true,
          data: {
            buffer: pdfBuffer,
            filename: "QCA.pdf",
          },
        });
      })
      .catch(async (err) => {
        await t.rollback();
        return helper.errorResponse(res, err);
      });

    return;
  } catch (error) {
    await t.rollback();
    return helper.errorResponse(res, error);
  }
});

router.post("/generateQcaLableforlot", [auth.isAuthorized], async (req, res) => {
  const valid = new Validator(req.body, {
    Lot_Number: "required",
    Lot_qty: "required",
    PPR_No: "required",
    Lot_type: "required",
    Sku: "required",
    Process: "required",
  });

  if (valid.fails()) {
    return res.status(400).send(helper.firstErrorValidatorjs(valid));
  }

  const t = await invtDB.transaction();
  try {
    const { Lot_Number, Lot_qty, PPR_No, Lot_type, Sku, Process } = req.body;

    const Data = {
        Lot_Number: Lot_Number,
        Lot_Quantity: Lot_qty,
        PPR_NO: PPR_No,
        Lot_Type: Lot_type,
        SKU: Sku,
        Process: Process
      };

    const qr_data_json = JSON.stringify(Data);

    let qr = await QRCode.toDataURL(qr_data_json);

    const html = `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Document</title>
        </head>
        <body>
        <table>
        <tr>

        <td>
            <b>PPR No.</b> ${Data.PPR_NO} <br />
            <b>Lot No.</b> ${Data.Lot_Number} <br />
            <b>Lot QTY.</b> ${Data.Lot_Quantity} <br />
            <b>SKU</b> ${Data.SKU} <br />
            <b>PROCESS</b> ${Data.Process} <br />
            <b>LOT TYPE</b> ${Data.Lot_Type}
        </td>

        <td>
            <img height='200px' weight='100px' src='${qr}' alt='QR Code' />
        </td>
        
        </tr>
        </table>
        </body>
        </html>`;

    let options = { format: "A4" };
    let file = { content: html };
    htmlToPdf
      .generatePdf(file, options)
      .then(async (pdfBuffer) => {
        await t.commit();

        // res.header("Content-Type", "application/pdf");
        // res.header("Content-Disposition", "attachment; filename=QCA.pdf");
        // res.send(pdfBuffer);

        // return;

        return res.json({

          message: "QCA Label Generated..",
          status: "success", success: true,
          data: {
            buffer: pdfBuffer,
            filename: "QCA.pdf",
          },
        });
      })
      .catch(async (err) => {
        await t.rollback();
        return helper.errorResponse(res, err);
      });

    return;
  } catch (error) {
    await t.rollback();
    return helper.errorResponse(res, error);
  }
});

module.exports = router;
