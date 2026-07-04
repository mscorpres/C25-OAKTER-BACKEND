const multer = require("multer");
const QRCode = require("qrcode");
const router = require("express").Router();
const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");
const path = require("path");
const xlsx = require("xlsx");
const htmlToPdf = require("html-pdf-node");
const fs = require("fs");

const Validator = require("validatorjs");
const { pdfTemplate } = require("./farPrint.js");

var storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, "uploads");
    },

    filename: function (req, file, cb) {
        cb(null, 'FAR' + '-' + helper.getUniqueNumber() + helper.randomNumber(100, 999) + path.extname(file.originalname));
    },
});

var upload = multer({ storage: storage });

router.post("/upload", [auth.isAuthorized], upload.single("file"), async (req, res) => {
    try {

        if (!req.file) {
            return res.json({ status: "error", success: false, message: "File not found" });
        }

        let workbook = xlsx.readFile("./uploads/" + req.file.filename, {
            type: "binary",
            cellDates: true,
            cellNF: false,
            cellText: false
        });

        let farData = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

        let result = [];

        for (let i = 0; i < farData.length; i++) {
            result.push({
                "Head": farData[i]["Head"],
                "Assets code": farData[i]["Assets code"],
                "Vendor's name": farData[i]["Vendor's name"],
                "Invoice date": moment(farData[i]["Invoice date"]).add(1, 'days').format("DD-MMM-YYYY") ?? "",
                "Put to Use": moment(farData[i]["Put to Use"]).add(1, 'days').format("DD-MMM-YYYY") ?? "",
                "Bill No.": farData[i]["Bill No."],
            })
        }

        let options = {
            // format: "A4",
            width: '52mm',
            height: '35mm',
            margin: { top: "9mm", right: "0mm", left: "0mm", bottom: "0mm" }
        };

        await htmlToPdf.generatePdf({ content: await pdfTemplate(result) }, options).then((pdfBuffer) => {
            return res.json({
                status: "success", success: true,
                message: "File uploaded successfully and generated pdf",
                data: {
                    buffer: pdfBuffer,
                    filename: "FAR-" + helper.getUniqueNumber()
                }
            });
        }).catch((error) => {
            return helper.errorResponse(res, error);
        });

    } catch (error) {
        return helper.errorResponse(res, error);
    }
})

module.exports = router