const express = require("express");
const router = express.Router();
const axios = require("axios");
const auth = require("../../middleware/auth");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const helper = require("../../helper/helper");

// =============================================
// FETCH MASTERS (Topic, Language, Priority)
// =============================================
router.get("/masters", [auth.isAuthorized], async (req, res) => {
  try {
    const response = await axios.get(
      `${process.env.SUPPORT_API_BASE}/api/custom/masters.php`,
      {
        params: { filter: "Oakter" },
        headers: { Accept: "application/json" },
      }
    );

    return res.json({
      success: true,
      status: "success",
      data: response.data?.data || response.data,
    });
  } catch (error) {
    return helper.errorResponse(res, error);
  }
});

// =============================================
// FETCH ALL TICKETS
// =============================================
router.get("/fetch", [auth.isAuthorized], async (req, res) => {
  try {
    const { email, topic } = req.query;

    if (!email) {
      return res.json({
        success: false,
        status: "error",
        message:
          "You don't have permission to access this resource temporarily.\nPlease contact support for assistance.",
      });
    }

    const params = { email };
    if (topic) params.topic = topic;

    const response = await axios.get(
      `${process.env.SUPPORT_API_BASE}/api/custom/fetch.php`,
      {
        params,
        headers: { Accept: "application/json" },
      }
    );

    return res.json({
      success: true,
      status: "success",
      data: response.data?.data || response.data,
    });
  } catch (error) {
    console.error("Error fetching tickets:", error.message);
    return helper.errorResponse(res, error);
  }
});

// =============================================
// CREATE TICKET
// =============================================
const ATTACHMENT_DIR = path.join(__dirname, "../../files/ticket/attachments");
if (!fs.existsSync(ATTACHMENT_DIR)) fs.mkdirSync(ATTACHMENT_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, ATTACHMENT_DIR),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage });

router.use("/attachments", express.static(ATTACHMENT_DIR));

router.post("/create", [auth.isAuthorized, upload.array("attachment[]")], async (req, res) => {
  try {
    const { email, name, topic, subject, message, priority, language, phone } = req.body;

    if (!email || !name || !topic || !subject || !message, !priority, !language, !phone ) {
      return res.json({
        status: "error",
        success: false,
        message:
          "You don't have permission to access this resource temporarily.\nPlease contact support for assistance.",
      });
    }

    const attachments = req.files?.map(
      (file) => `${process.env.API_URL}/files/ticket/attachments/${file.filename}`
    ) || [];

    const payload = {
      name,
      email,
      phone: phone || "--",
      project: "alwar",
      subject,
      message,
      topicId: parseInt(topic),
      priority: priority || "1",
      language: language || "E",
      attachments,
    };

    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-API-Key": process.env.SUPPORT_API_KEY,
    };

    const response = await axios.post(
      `${process.env.SUPPORT_API_BASE}/api/custom/create.php`,
      payload,
      { headers }
    );

    return res.status(response.status).json(response.data);
  } catch (error) {
    console.error("Error creating ticket:", error.response?.data || error.message);
    return helper.errorResponse(res, error);
  }
});

module.exports = router;