const router = require("express").Router();

const { tallyDB, invtDB, otherDB } = require("../../../config/db/connection");
const auth = require("../../../middleware/auth");
const permission = require("../../../middleware/permission");
const { getUniqueNumber } = require("../../../helper/helper");
const nodemailer = require("nodemailer");
const multer = require("multer");

const Validator = require("validatorjs");
const { pdfTemplate } = require("./template");
const { default: axios } = require("axios");
require("dotenv").config();
const htmlToPdf = require("html-pdf-node");
const fs = require("fs");

var storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, `./files/ledgers/received/`);
  },
  filename: function (req, file, cb) {
    cb(
      null,
      req.query.vendor +
        "-" +
        "F-" +
        Math.floor(1000 + Math.random() * 9000) +
        file.originalname
    );
  },
});

var uploadLedger = multer({ storage: storage });

const sendMail = async function (
  to,
  cc = null,
  subject,
  message,
  attachments = null,
  username,
  userEmail,
  userAppPassword
) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: process.env.SMTP_SECURE,
    auth: {
      user: userEmail,
      pass: userAppPassword,
    },
  });

  let mail_res = await transporter
    .sendMail({
      from: username + userEmail,
      to: to,
      cc: cc,
      subject: subject,
      html: message,
      attachments: attachments,
    })
    .then((info) => {
      return {
        messageId: info.messageId,
      };
    })
    .catch((err) => {
      return {
        error: err,
      };
    });
  return mail_res;
};

router.put("/update", [auth.isAuthorized], async (req, res) => {
  const transaction = await tallyDB.transaction();

  try {
    const validation = new Validator(req.body, {
      status: "required",
      voucherNo: "required",
    });

    if (validation.fails()) {
      return res
        .status(403)
        .send(Object.values(validation.errors.all())[0].join());
    }

    for (let i = 0; i < req.body.voucherNo.length; i++) {
      const updateVoucher = await tallyDB.query(
        "UPDATE tally_ledger_data SET recoStatus = :status WHERE module_used = :voucherNo OR debit_key = :voucherNo",
        {
          replacements: {
            status: req.body.status,
            voucherNo: req.body.voucherNo[i],
          },
          type: tallyDB.QueryTypes.UPDATE,
          transaction: transaction,
        }
      );

      if (updateVoucher.length <= 0) {
        await transaction.rollback();
        return res.json({
          status: "error",
          success: false,
          message: "error while updating voucher",
        });
      }
    }
    await transaction.commit();
    return res.status(200).send(`Voucher's status updated successfully`);
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

//add notes for vendor
router.post("/notes/add", [auth.isAuthorized], async (req, res) => {
  try {
    const validation = new Validator(req.body, {
      vendor: "required",
      message: "required",
    });

    if (validation.fails()) {
      return res
        .status(403)
        .send(Object.values(validation.errors.all())[0].join());
    }

    const addNotes = await tallyDB.query(
      "INSERT INTO reconciliation_notes(vendor, note , insertBy , insertDate) VALUES(:vendor , :note , :insertBy , :insertDate)",
      {
        replacements: {
          vendor: req.body.vendor,
          note: req.body.message,
          insertBy: req.logedINUser,
          insertDate: moment(new Date())
            .tz("Asia/Kolkata")
            .format("YYYY-MM-DD HH:mm:ss"),
        },
        type: tallyDB.QueryTypes.INSERT,
      }
    );

    if (addNotes.length <= 0) {
      return res.json({
        status: "error",
        success: false,
        message: "not able to update note",
      });
    }

    return res.json({
      status: "error",
      success: false,
      message: "note added successfully",
    });
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

//view notes
router.get("/notes/view", [auth.isAuthorized], async (req, res) => {
  try {
    const validation = new Validator(req.query, {
      vendor: "required",
    });

    if (validation.fails()) {
      return res.json({
        status: "error",
        message: Object.values(validation.errors.all())[0].join(),
        success: false,
      });
    }

    const fetchNotes = await tallyDB.query(
      "SELECT note , DATE_FORMAT(insertDate, '%d-%m-%Y') AS date FROM reconciliation_notes WHERE vendor = :vendor ORDER BY ID DESC",
      {
        replacements: {
          vendor: req.query.vendor,
        },
        type: tallyDB.QueryTypes.SELECT,
      }
    );

    return res.json({
      success: true,
      status: "success",
      data: fetchNotes,
    });
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

//add less transaction
router.post("/addTransactions", [auth.isAuthorized], async (req, res) => {
  try {
    const validation = new Validator(req.body, {
      vendor: "required",
      invoiceDate: "required",
      amount: "required",
      type: "required",
      description: "required",
      invoiceNo: "required",
      impactOn: "required",
    });

    if (validation.fails()) {
      return res
        .status(403)
        .send(Object.values(validation.errors.all())[0].join());
    }

    const transactionID = "TR" + getUniqueNumber();

    let debit = 0;
    let credit = 0;

    if (req.body.type == "credit") {
      credit = req.body.amount;
    } else if (req.body.type == "debit") {
      debit = req.body.amount;
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "invalid type",
      });
    }

    const fetchTransaction = await tallyDB.query(
      "SELECT * FROM reconciliation_transactions WHERE invoiceNo = :invoiceNo AND vendor = :vendor AND isBooked = 'no'",
      {
        replacements: {
          invoiceNo: req.body.invoiceNo,
          vendor: req.body.vendor,
        },
        type: tallyDB.QueryTypes.SELECT,
      }
    );

    if (fetchTransaction.length > 0) {
      return res.json({
        status: "error",
        success: false,
        message: "transaction already added",
      });
    }

    const addTransaction = await tallyDB.query(
      "INSERT INTO reconciliation_transactions(vendor, invoiceNo , invoiceDate, debit , credit , description , impactOn , insertBy , insertDate , transactionID) VALUES(:vendor , :invoiceNo , :invoiceDate , :debit , :credit , :description , :impactOn , :insertBy , :insertDate , :transactionID)",
      {
        replacements: {
          vendor: req.body.vendor,
          invoiceNo: req.body.invoiceNo,
          invoiceDate: req.body.invoiceDate,
          amount: req.body.amount,
          debit: debit,
          credit: credit,
          description: req.body.description,
          impactOn: req.body.impactOn,
          insertBy: req.logedINUser,
          insertDate: moment(new Date())
            .tz("Asia/Kolkata")
            .format("YYYY-MM-DD HH:mm:ss"),
          transactionID: transactionID,
        },
        type: tallyDB.QueryTypes.INSERT,
      }
    );

    if (addTransaction.length <= 0) {
      return res.json({
        status: "error",
        success: false,
        message: "not able to add transaction",
      });
    }

    return res.json({
      status: "error",
      success: false,
      message: "Transaction added successfully",
    });
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

//view add less transaction
router.get("/view/transactions", [auth.isAuthorized], async (req, res) => {
  try {
    const validation = new Validator(req.query, {
      vendor: "required",
      date: "required",
    });

    if (validation.fails()) {
      return res
        .status(403)
        .send(Object.values(validation.errors.all())[0].join());
    }

    const date = req.query.date.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
    const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
    const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

    let data = [];

    const findTransactions = await tallyDB.query(
      "SELECT * FROM reconciliation_transactions WHERE vendor = :vendor AND (DATE_FORMAT(invoiceDate , '%Y-%m-%d') BETWEEN :date1 AND :date2) AND isBooked = 'no'",
      {
        replacements: {
          vendor: req.query.vendor,
          date1: date1,
          date2: date2,
        },
        type: tallyDB.QueryTypes.SELECT,
      }
    );

    if (findTransactions.length > 0) {
      for (let i = 0; i < findTransactions.length; i++) {
        let type;
        let amount = 0;

        if (findTransactions[i].debit > 0) {
          type = "debit";
          amount = findTransactions[i].debit;
        }

        if (findTransactions[i].credit > 0) {
          type = "credit";
          amount = findTransactions[i].credit;
        }

        data.push({
          vendor: findTransactions[i].vendor,
          invoiceDate: findTransactions[i].invoiceDate,
          invoiceNo: findTransactions[i].invoiceNo,
          description: findTransactions[i].description,
          type: type,
          amount: amount,
          impactOn: findTransactions[i].impactOn,
          transactionID: findTransactions[i].transactionID,
        });
      }
    }
    return res.json(data);
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

//remove transaction
router.delete("/delete/transaction", [auth.isAuthorized], async (req, res) => {
  try {
    const validation = new Validator(req.query, {
      transactionID: "required",
    });

    if (validation.fails()) {
      return res
        .status(403)
        .send(Object.values(validation.errors.all())[0].join());
    }

    const deleteTransaction = await tallyDB.query(
      "UPDATE reconciliation_transactions SET isBooked = 'yes' WHERE transactionID = :transactionID",
      {
        replacements: {
          transactionID: req.query.transactionID,
        },
        type: tallyDB.QueryTypes.UPDATE,
      }
    );

    if (deleteTransaction.length <= 0) {
      return res.json({
        status: "error",
        success: false,
        message: "not able to delete transaction",
      });
    }

    return res.json({
      status: "error",
      success: false,
      message: "Transaction deleted successfully",
    });
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

//edit transaction
router.put("/edit/transaction", [auth.isAuthorized], async (req, res) => {
  try {
    const validation = new Validator(req.body, {
      transactionID: "required",
      vendor: "required",
      invoiceDate: "required",
      amount: "required",
      type: "required",
      description: "required",
      invoiceNo: "required",
      impactOn: "required",
    });

    if (validation.fails()) {
      return res
        .status(403)
        .send(Object.values(validation.errors.all())[0].join());
    }

    const fetchTransaction = await tallyDB.query(
      "SELECT * FROM reconciliation_transactions WHERE transactionID = :transactionID AND isBooked = 'no'",
      {
        replacements: {
          transactionID: req.body.transactionID,
        },
        type: tallyDB.QueryTypes.SELECT,
      }
    );

    if (fetchTransaction.length <= 0) {
      return res.json({
        status: "error",
        success: false,
        message: "transaction not found",
      });
    }

    let debit = 0;
    let credit = 0;

    if (req.body.type == "credit") {
      credit = req.body.amount;
    } else if (req.body.type == "debit") {
      debit = req.body.amount;
    } else {
      return res.json({
        status: "error",
        success: false,
        message: "invalid type",
      });
    }

    const editTransaction = await tallyDB.query(
      "UPDATE reconciliation_transactions SET vendor = :vendor , invoiceNo = :invoiceNo , invoiceDate = :invoiceDate , debit = :debit , credit = :credit , description = :description , impactOn = :impactOn , updateBy = :updateBy , updateDate = :updateDate WHERE transactionID = :transactionID",
      {
        replacements: {
          transactionID: req.body.transactionID,
          vendor: req.body.vendor,
          invoiceNo: req.body.invoiceNo,
          invoiceDate: req.body.invoiceDate,
          amount: req.body.amount,
          debit: debit,
          credit: credit,
          description: req.body.description,
          impactOn: req.body.impactOn,
          updateBy: req.logedINUser,
          updateDate: moment(new Date())
            .tz("Asia/Kolkata")
            .format("YYYY-MM-DD HH:mm:ss"),
        },
        type: tallyDB.QueryTypes.UPDATE,
      }
    );

    if (editTransaction.length <= 0) {
      return res.json({
        status: "error",
        success: false,
        message: "not able to update transaction",
      });
    }

    return res.json({
      status: "error",
      success: false,
      message: "Transaction updated successfully",
    });
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

//send mail
router.post("/mail", [auth.isAuthorized], async (req, res) => {
  try {
    const validation = new Validator(req.body, {
      mailTo: "required",
      mailFrom: "required",
      subject: "required",
      body: "required",
      refID: "required",
    });

    if (validation.fails()) {
      return res.json({
        success: false,
        message: Object.values(validation.errors.all())[0].join(),
        status: "error",
      });
    }
    const refID = req.body.refID;

    const fetchReco = await tallyDB.query(
      "SELECT * FROM reconciliations WHERE recoID = :recoID",
      {
        replacements: {
          recoID: refID,
        },
        type: tallyDB.QueryTypes.SELECT,
      }
    );

    if (fetchReco.length <= 0) {
      return res.json({
        status: "error",
        success: false,
        message: "reconciliation not found",
      });
    }

    const insertLog = await otherDB.query(
      "INSERT INTO mails_log(referenceID , reqDate , reqVendor , status , mail_from , mail_to , subject , message , attachments , sent_dt , sent_by) VALUES(:referenceID , :reqDate , :reqVendor , :status , :mail_from , :mail_to , :subject , :message , :attachments , :sent_dt , :sent_by)",
      {
        replacements: {
          referenceID: refID,
          reqDate: fetchReco[0].reqDate,
          reqVendor: fetchReco[0].vendorCode,
          status: "pending",
          mail_from: req.body.mailFrom,
          mail_to: req.body.mailTo,
          subject: req.body.subject,
          message: req.body.body,
          attachments: req.body.attachments ?? null,
          sent_dt: moment(new Date())
            .tz("Asia/Kolkata")
            .format("YYYY-MM-DD HH:mm:ss"),
          sent_by: req.logedINUser,
        },
        type: otherDB.QueryTypes.INSERT,
      }
    );

    const fetchUser = await invtDB.query(
      "SELECT user_name , email_app_pass from admin_login WHERE Email_ID = :email",
      {
        replacements: {
          email: req.body.mailFrom,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (
      fetchUser[0].user_name == null ||
      fetchUser[0].user_name == undefined ||
      fetchUser[0].user_name == "" ||
      fetchUser[0].email_app_pass == null ||
      fetchUser[0].email_app_pass == undefined ||
      fetchUser[0].email_app_pass == ""
    ) {
      const updateLog = await otherDB.query(
        "UPDATE mails_log SET error = :error WHERE referenceID = :referenceID",
        {
          replacements: {
            error: "Either username or email app password not set.",
            referenceID: refID,
          },
          type: otherDB.QueryTypes.UPDATE,
        }
      );

      return res.json({
        success: false,
        message: "Please contact developer for setting up mail credentials.",
        status: "error",
      });
    }

    let email = await sendMail(
      req.body.mailTo,
      null,
      req.body.subject,
      req.body.body.replaceAll("\n", "<br />"),
      null,
      fetchUser[0].user_name,
      req.body.mailFrom,
      fetchUser[0].email_app_pass
    );

    if (email.code === 200) {
      const updateLog = await otherDB.query(
        "UPDATE mails_log SET status = :status , mail_sent_dt = :mail_sent_dt WHERE referenceID = :referenceID",
        {
          replacements: {
            status: "success",
            success: true,
            referenceID: refID,
            mail_sent_dt: moment(new Date())
              .tz("Asia/Kolkata")
              .format("YYYY-MM-DD HH:mm:ss"),
          },
          type: otherDB.QueryTypes.UPDATE,
        }
      );

      return res.json({
        success: true,
        message: "mail sent successfully",
        status: "success",
      });
    } else if (email.code === 500) {
      const updateLog = await otherDB.query(
        "UPDATE mails_log SET error = :error WHERE referenceID = :referenceID",
        {
          replacements: {
            error: JSON.stringify(email.error),
            referenceID: refID,
          },
          type: otherDB.QueryTypes.UPDATE,
        }
      );

      return res.json({
        success: false,
        message: "Error while sending mail. Contact administrator.",
        status: "error",
      });
    }
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

router.get("/mails", [auth.isAuthorized], async (req, res) => {
  try {
    const validation = new Validator(req.query, {
      refID: "required",
    });

    if (validation.fails()) {
      return res.json({
        success: false,
        message: Object.values(validation.errors.all())[0].join(),
        status: "error",
      });
    }

    const fetchMails = await otherDB.query(
      "SELECT referenceID AS refID , reqDate AS requestedDate , reqVendor AS requestedVendor , status , mail_from AS mailFrom , mail_to AS mailTo , subject , message AS body , attachments , receivedLedgers AS  uploadedLedgers , DATE_FORMAT(sent_dt,'%d-%m-%Y') AS sentDate FROM mails_log WHERE referenceID = :referenceID AND status = 'success' ORDER BY sent_dt DESC",
      {
        replacements: {
          referenceID: req.query.refID,
        },
        type: otherDB.QueryTypes.SELECT,
      }
    );
    let result = [];

    for (let i = 0; i < fetchMails.length; i++) {
      result.push({
        refID: fetchMails[i].refID,
        requestedDate: fetchMails[i].requestedDate,
        requestedVendor: fetchMails[i].requestedVendor,
        status: fetchMails[i].status,
        mailFrom: fetchMails[i].mailFrom,
        mailTo: fetchMails[i].mailTo,
        subject: fetchMails[i].subject,
        body: fetchMails[i].body,
        attachments: fetchMails[i].attachments,
        uploadedLedgers: fetchMails[i].uploadedLedgers
          ? fetchMails[i].uploadedLedgers
              .split(",")
              .map(
                (item) =>
                  `${process.env.API_URL}/files/ledgers/received/` + item
              )
          : [],
        sentDate: fetchMails[i].sentDate,
      });
    }

    return res.json({
      success: true,
      status: "success",
      data: result,
    });
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

//get vendor email
router.get("/vendor/email", [auth.isAuthorized], async (req, res) => {
  try {
    const validation = new Validator(req.query, {
      vendor: "required",
    });

    if (validation.fails()) {
      return res.json({
        success: false,
        message: Object.values(validation.errors.all())[0].join(),
        status: "error",
      });
    }

    const fetchEmail = await invtDB.query(
      "SELECT ven_reco_email AS email FROM ven_basic_detail WHERE ven_register_id = :vendor",
      {
        replacements: {
          vendor: req.query.vendor,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    return res.json({
      success: true,
      status: "success",
      data: fetchEmail[0],
    });
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

//update vendor email
router.put("/vendor/email", [auth.isAuthorized], async (req, res) => {
  const transaction = await invtDB.transaction();
  try {
    const validation = new Validator(req.body, {
      vendor: "required",
      email: "required",
    });

    if (validation.fails()) {
      return res.json({
        success: false,
        message: Object.values(validation.errors.all())[0].join(),
        status: "error",
      });
    }

    const updateEmail = await invtDB.query(
      "UPDATE ven_basic_detail SET ven_reco_email = :email WHERE ven_register_id = :vendor",
      {
        replacements: {
          email: req.body.email,
          vendor: req.body.vendor,
        },
        type: invtDB.QueryTypes.UPDATE,
        transaction: transaction,
      }
    );

    if (updateEmail.length <= 0) {
      await transaction.rollback();
      return res.json({
        success: false,
        message: "not able to update email",
        status: "error",
      });
    }

    await transaction.commit();

    return res.json({
      success: true,
      status: "success",
      data: {
        email: req.body.email,
      },
    });
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

router.put(
  "/uploadLedger",
  [auth.isAuthorized],
  uploadLedger.single("file"),
  async (req, res) => {
    const transaction = await otherDB.transaction();
    try {
      const validation = new Validator(req.query, {
        vendor: "required",
        refID: "required",
      });

      if (validation.fails()) {
        return res.json({
          success: false,
          message: Object.values(validation.errors.all())[0].join(),
          status: "error",
        });
      }

      const fileValidation = new Validator(req.file, {
        filename: "required",
      });

      if (fileValidation.fails()) {
        return res.json({
          success: false,
          message: Object.values(fileValidation.errors.all())[0].join(),
          status: "error",
        });
      }

      const filename = req.file.filename;

      const fetchLog = await otherDB.query(
        "SELECT * FROM mails_log WHERE referenceID = :refID AND reqVendor = :reqVendor",
        {
          replacements: {
            refID: req.query.refID,
            reqVendor: req.query.vendor,
          },
          type: otherDB.QueryTypes.SELECT,
        }
      );

      const updateLog = await otherDB.query(
        "UPDATE mails_log SET receivedLedgers = :filename WHERE referenceID = :refID AND reqVendor = :reqVendor",
        {
          replacements: {
            filename: fetchLog[0].receivedLedgers
              ? fetchLog[0].receivedLedgers + "," + filename
              : filename,
            refID: req.query.refID,
            reqVendor: req.query.vendor,
          },
          type: otherDB.QueryTypes.UPDATE,
          transaction: transaction,
        }
      );

      if (updateLog.length <= 0) {
        await transaction.rollback();
        return res.json({
          success: false,
          message: "not able to update document",
          status: "error",
        });
      }

      await transaction.commit();

      return res.json({
        success: true,
        message: "Document uploaded successfully",
        status: "success",
      });
    } catch (error) {
      return helper.errorResponse(res, error);
    }
  }
);

//create reco
router.post("/create", [auth.isAuthorized], async (req, res) => {
  try {
    const validation = new Validator(req.body, {
      vendor: "required",
      date: "required",
    });

    if (validation.fails()) {
      return res.json({
        success: false,
        message: Object.values(validation.errors.all())[0].join(),
        status: "error",
      });
    }

    const fetchReco = await tallyDB.query(
      "SELECT * FROM reconciliations WHERE vendorCode = :vendor AND reqDate = :date",
      {
        replacements: {
          vendor: req.body.vendor,
          date: req.body.date,
        },
        type: tallyDB.QueryTypes.SELECT,
      }
    );

    if (fetchReco.length > 0) {
      if (
        fetchReco[0].status === "completed" &&
        moment(new Date()).diff(moment(fetchReco[0].updateDate), "days") > 7
      ) {
        return res.json({
          success: false,
          message: "Reconciliation already completed and closed",
          status: "error",
        });
      }

      return res.json({
        success: true,
        status: "success",
        data: fetchReco.map((item) => ({
          recoID: item.recoID,
          draftData: {
            status: item.status,
            date: item.reqDate,
            vendor: item.vendorCode,
            vendorClosingBalance:
              !item.vendorClosingBalance || item.vendorClosingBalance === ""
                ? 0
                : item.vendorClosingBalance,
            vendorOpeningBalance:
              !item.vendorOpeningBalance || item.vendorOpeningBalance === ""
                ? 0
                : item.vendorOpeningBalance,
          },
          createdOn: moment(item.insertDate).format("DD-MM-YYYY"),
        }))[0],
      });
    }

    const recoID = "RECO-" + getUniqueNumber();

    const insertReco = await tallyDB.query(
      "INSERT INTO reconciliations (recoID, vendorCode, reqDate , insertDate , insertBy , status) VALUES (:recoID, :vendor, :date , :insertDate , :insertBy , :status)",
      {
        replacements: {
          recoID: recoID,
          date: req.body.date,
          vendor: req.body.vendor,
          insertDate: moment(new Date()).format("YYYY-MM-DD HH:mm:ss"),
          insertBy: req.logedINUser,
          status: "draft",
        },
        type: tallyDB.QueryTypes.INSERT,
      }
    );

    if (insertReco.length <= 0) {
      return res.json({
        success: false,
        message: "not able to create reconciliation",
        status: "error",
      });
    }

    return res.json({
      success: true,
      status: "success",
      data: {
        recoID: recoID,
        draftData: null,
        createdOn: null,
      },
    });
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

//update reco
router.put("/update/reco", [auth.isAuthorized], async (req, res) => {
  try {
    const validation = new Validator(req.body, {
      recoID: "required",
      status: "required",
    });

    if (validation.fails()) {
      return res.json({
        success: false,
        message: Object.values(validation.errors.all())[0].join(),
        status: "error",
      });
    }

    if (req.body.status === "completed") {
      const fetchReco = await tallyDB.query(
        "SELECT * FROM reconciliations WHERE recoID = :recoID",
        {
          replacements: {
            recoID: req.body.recoID,
          },
          type: tallyDB.QueryTypes.SELECT,
        }
      );

      const date = fetchReco[0].reqDate.match(
        /([0-9]{2})-([0-9]{2})-([0-9]{4})/g
      );
      const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
      const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

      const fetchLedgers = await tallyDB.query(
        "SELECT * FROM tally_ledger_data WHERE ladger_key = :vendor AND (DATE_FORMAT(ref_date ,'%Y-%m-%d') BETWEEN :date1 AND :date2 ) AND recoStatus != :status GROUP BY module_used , debit_key ",
        {
          replacements: {
            vendor: fetchReco[0].vendorCode,
            date1: date1,
            date2: date2,
            status: "matched",
          },
          type: tallyDB.QueryTypes.SELECT,
        }
      );

      if (fetchLedgers.length > 0) {
        return res.json({
          success: false,
          status: "error",
          data: fetchLedgers.map((item) => ({
            moduleUsed:
              item.debit_key === "--" ? item.module_used : item.debit_key,
          })),
        });
      }
    }

    const updateReco = await tallyDB.query(
      "UPDATE reconciliations SET vendorClosingBalance = :vendorClosingBalance, vendorOpeningBalance = :vendorOpeningBalance, status = :status , updateDate = :updateDate , updateBy = :updateBy WHERE recoID = :recoID",
      {
        replacements: {
          recoID: req.body.recoID,
          status: req.body.status,
          vendorClosingBalance: req.body.vendorClosingBalance ?? 0,
          vendorOpeningBalance: req.body.vendorOpeningBalance ?? 0,
          updateDate: moment(new Date()).format("YYYY-MM-DD HH:mm:ss"),
          updateBy: req.logedINUser,
        },
        type: tallyDB.QueryTypes.UPDATE,
      }
    );

    if (updateReco.length <= 0) {
      return res.json({
        success: false,
        message: "not able to update reconciliation",
        status: "error",
      });
    }

    return res.json({
      success: true,
      message: `Reconciliation saved as ${req.body.status}.`,
      status: "success",
    });
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

//view draft reconciliation
// router.get("/view/reconciliation", [auth.isAuthorized], async (req, res) => {
//     try {
//         const validation = new Validator(req.query, {
//             wise: "required",
//             data: "required"
//         });

//         if (validation.fails()) {
//             return res.json({
//                 success: false,
//                 message: Object.values(validation.errors.all())[0].join(),
//                 data: null
//             });
//         }

//         const wise = req.query.wise;
//         const data = req.query.data;

//         if (wise == "vendorwise") {

//             const fetchReconciliation = await tallyDB.query("SELECT tally_ledger.ladger_name AS vendorName , tally_ledger_data.ladger_key AS vendorCode , MONTHNAME(tally_ledger_data.ref_date) AS month , YEAR(tally_ledger_data.ref_date) AS year , tally_ledger_data.recoStatus AS status FROM `tally_ledger_data` LEFT JOIN tally_ledger ON tally_ledger.ledger_key = tally_ledger_data.ladger_key WHERE ladger_key = :vendor GROUP BY MONTH(ref_date) , recoStatus", {
//                 replacements: {
//                     vendor: data
//                 },
//                 type: tallyDB.QueryTypes.SELECT
//             });

//             let result = [];

//             let filteredArray = Array.from(
//                 new Map(fetchReconciliation.filter((item, index, arr) => {
//                     return arr.filter(i => i.month.toLowerCase() === item.month.toLowerCase()).length > 1
//                 }).map(item => [item.month, item])).values()
//             )

//             if (filteredArray.length > 0) {
//                 for (let i = 0; i < filteredArray.length; i++) {
//                     result.push({
//                         vendorCode: filteredArray[i].vendorCode,
//                         vendorName: filteredArray[i].vendorName,
//                         month: filteredArray[i].month,
//                         status: "pending",
//                         dateRange: await getDateRangeByMonth(filteredArray[i].month, filteredArray[i].year)
//                     })
//                 }
//             }

//             return res.json({
//                 success: true,
//                 message: null,
//                 data: result
//             });

//         } else {
//             return res.json({
//                 success: false,
//                 message: "only vendorwise allowed",
//                 data: null
//             })
//         }

//     } catch (error) {
//         return res.json({
//             success: false,
//             message: "Internal error",
//             data: null
//         });
//     }
// });

router.get("/view/reconciliation", [auth.isAuthorized], async (req, res) => {
  try {
    const validation = new Validator(req.query, {
      wise: "required", //vendorwise || all
      // data: "required",   // not required for all
      status: "required", //draft || completed || all
    });

    if (validation.fails()) {
      return res.json({
        success: false,
        message: Object.values(validation.errors.all())[0].join(),
        status: "error",
      });
    }

    const wise = req.query.wise;
    const data = req.query.data;
    const status = req.query.status;

    if (wise == "vendorwise") {
      let fetchDrafts;

      if (status == "all") {
        fetchDrafts = await tallyDB.query(
          `SELECT reconciliations.* , vendorTable.ven_name AS vendorName FROM reconciliations LEFT JOIN ${global.ims_db_name}.ven_basic_detail AS vendorTable ON vendorTable.ven_register_id = reconciliations.vendorCode WHERE reconciliations.vendorCode = :vendor`,
          {
            replacements: {
              vendor: data,
            },
            type: tallyDB.QueryTypes.SELECT,
          }
        );
      } else {
        fetchDrafts = await tallyDB.query(
          `SELECT reconciliations.* , vendorTable.ven_name AS vendorName FROM reconciliations LEFT JOIN ${global.ims_db_name}.ven_basic_detail AS vendorTable ON vendorTable.ven_register_id = reconciliations.vendorCode WHERE reconciliations.vendorCode = :vendor AND reconciliations.status = :status`,
          {
            replacements: {
              vendor: data,
              status: status,
            },
            type: tallyDB.QueryTypes.SELECT,
          }
        );
      }

      let result = [];

      if (fetchDrafts.length > 0) {
        for (let i = 0; i < fetchDrafts.length; i++) {
          result.push({
            recoID: fetchDrafts[i].recoID,
            vendor: fetchDrafts[i].vendorCode,
            vendorName: fetchDrafts[i].vendorName,
            period: fetchDrafts[i].reqDate,
            vendorClosingBalance: fetchDrafts[i].vendorClosingBalance,
            vendorOpeningBalance: fetchDrafts[i].vendorOpeningBalance,
            status: fetchDrafts[i].status,
          });
        }
      }

      return res.json({
        success: true,
        status: "success",
        data: result,
      });
    } else {
      let fetchDrafts;

      if (status == "all") {
        fetchDrafts = await tallyDB.query(
          `SELECT reconciliations.* , vendorTable.ven_name AS vendorName FROM reconciliations LEFT JOIN ${global.ims_db_name}.ven_basic_detail AS vendorTable ON vendorTable.ven_register_id = reconciliations.vendorCode`,
          {
            type: tallyDB.QueryTypes.SELECT,
          }
        );
      } else {
        fetchDrafts = await tallyDB.query(
          `SELECT reconciliations.* , vendorTable.ven_name AS vendorName FROM reconciliations LEFT JOIN ${global.ims_db_name}.ven_basic_detail AS vendorTable ON vendorTable.ven_register_id = reconciliations.vendorCode WHERE reconciliations.status = :status`,
          {
            replacements: {
              status: status,
            },
            type: tallyDB.QueryTypes.SELECT,
          }
        );
      }

      let result = [];

      if (fetchDrafts.length > 0) {
        for (let i = 0; i < fetchDrafts.length; i++) {
          result.push({
            recoID: fetchDrafts[i].recoID,
            vendor: fetchDrafts[i].vendorCode,
            vendorName: fetchDrafts[i].vendorName,
            period: fetchDrafts[i].reqDate,
            vendorClosingBalance: fetchDrafts[i].vendorClosingBalance,
            vendorOpeningBalance: fetchDrafts[i].vendorOpeningBalance,
            status: fetchDrafts[i].status,
          });
        }
      }

      return res.json({
        success: true,
        status: "success",
        data: result,
      });
    }
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

router.get("/download", [auth.isAuthorized], async (req, res) => {
  try {
    const validation = new Validator(req.query, {
      vendor: "required",
      date: "required",
    });

    if (validation.fails()) {
      return res
        .status(403)
        .send(Object.values(validation.errors.all())[0].join());
    }

    const fetchVendor = await invtDB.query(
      "SELECT ven_name AS vendorName FROM ven_basic_detail WHERE ven_register_id = :vendor",
      {
        replacements: {
          vendor: req.query.vendor,
        },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (fetchVendor.length <= 0) {
      return res.json({
        success: false,
        message: "No vendor found",
        status: "error",
      });
    }

    const fetchReco = await tallyDB.query(
      `SELECT reconciliations.* , adminTable.user_name AS creator FROM reconciliations LEFT JOIN ${global.ims_db_name}.admin_login AS adminTable ON adminTable.CustID = reconciliations.insertBy WHERE vendorCode = :vendor AND reqDate = :date`,
      {
        replacements: {
          vendor: req.query.vendor,
          date: req.query.date,
        },
        type: tallyDB.QueryTypes.SELECT,
      }
    );

    if (fetchReco.length <= 0) {
      return res.json({
        success: false,
        message: "No data found",
        status: "error",
      });
    }

    const date = req.query.date.match(/([0-9]{2})-([0-9]{2})-([0-9]{4})/g);
    const date1 = moment(date[0], "DD-MM-YYYY").format("YYYY-MM-DD");
    const date2 = moment(date[1], "DD-MM-YYYY").format("YYYY-MM-DD");

    let data = [];

    const findTransactions = await tallyDB.query(
      "SELECT * FROM reconciliation_transactions WHERE vendor = :vendor AND (DATE_FORMAT(invoiceDate , '%Y-%m-%d') BETWEEN :date1 AND :date2) AND isBooked = 'no'",
      {
        replacements: {
          vendor: req.query.vendor,
          date1: date1,
          date2: date2,
        },
        type: tallyDB.QueryTypes.SELECT,
      }
    );

    if (findTransactions.length > 0) {
      for (let i = 0; i < findTransactions.length; i++) {
        let type;
        let amount = 0;

        if (findTransactions[i].debit > 0) {
          type = "debit";
          amount = findTransactions[i].debit;
        }

        if (findTransactions[i].credit > 0) {
          type = "credit";
          amount = findTransactions[i].credit;
        }

        data.push({
          vendor: findTransactions[i].vendor,
          invoiceDate: findTransactions[i].invoiceDate,
          invoiceNo: findTransactions[i].invoiceNo,
          description: findTransactions[i].description,
          type: type,
          amount: amount,
          impactOn: findTransactions[i].impactOn,
          transactionID: findTransactions[i].transactionID,
        });
      }
    }

    let response = await axios.post(
      "https://ims.mscapi.live/tally/ledger/ledger_report",
      {
        data: req.query.vendor,
        date: req.query.date,
      },
      {
        headers: {
          "Authorization": req.headers["authorization"],
          "Company-Branch": req.headers["company-branch"],
        },
      }
    );

    const ledgerReportSummary = response.data.data.summary;

    const pdfHtml = pdfTemplate(
      data,
      fetchReco.map((item) => ({
        recoID: item.recoID,
        draftData: {
          status: item.status,
          date: item.reqDate,
          vendor: item.vendorCode,
          vendorClosingBalance:
            !item.vendorClosingBalance || item.vendorClosingBalance === ""
              ? 0
              : item.vendorClosingBalance,
          vendorOpeningBalance:
            !item.vendorOpeningBalance || item.vendorOpeningBalance === ""
              ? 0
              : item.vendorOpeningBalance,
        },
        createdOn: item.updateDate
          ? moment(item.updateDate).format("DD-MM-YYYY")
          : moment(item.insertDate).format("DD-MM-YYYY"),
        createdBy: item.creator,
      }))[0],
      fetchVendor[0].vendorName,
      ledgerReportSummary
    );

    let options = {
      format: "A4",
      margin: { top: "0px", right: "0px", left: "0px", bottom: "0px" },
    };

    await htmlToPdf
      .generatePdf({ content: pdfHtml }, options)
      .then((pdfBuffer) => {
        fs.writeFileSync(
          "Reco-" + fetchVendor[0].vendorName + ".pdf",
          pdfBuffer
        );

        return res.json({
          success: true,
          status: "success",
          data: {
            buffer: pdfBuffer,
            fileName: "Reco-" + fetchVendor[0].vendorName + ".pdf",
          },
        });
      })
      .catch((err) => {
        return res.json({
          success: false,
          message: "Internal error.",
          status: "error",
          error: err,
        });
      });
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

module.exports = router;
