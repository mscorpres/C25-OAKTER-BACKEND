const express = require("express");
const router = express.Router();
const { invtDB, otherDB } = require("../../config/db/connection");
const Validator = require("validatorjs");
const auth = require("../../middleware/auth");

const axios = require("axios");

// Helper to generate unique changelog ID
const generateChangelogId = () => {
  const date = moment().tz("Asia/Kolkata").format("YYYYMMDD");
  const random = Math.floor(1000 + Math.random() * 9000);
  return `CHL${date}${random}`;
};

async function urlExists(url) {
  try {
    const response = await axios.head(url, { timeout: 4000 });
    return response.status >= 200 && response.status < 400;
  } catch (err) {
    return false;
  }
}

// =============================================
// FETCH ALL CHANGELOG (with filters)
// =============================================
router.get("/fetch", [auth.isAuthorized], async (req, res) => {
  try {
    const { year, month, hasDoc, hasVideo } = req.query;

    let whereClause = "WHERE status = 'ON'";
    let replacements = {};

    // Filter by year
    if (year) {
      whereClause += " AND YEAR(date) = :year";
      replacements.year = year;
    }

    // Filter by month (0-11 from frontend, convert to 1-12 for MySQL)
    if (month !== null && month !== undefined && month !== "") {
      whereClause += " AND MONTH(date) = :month";
      replacements.month = parseInt(month) + 1;
    }

    // Filter by having doc
    if (hasDoc === true) {
      whereClause += " AND doc_url IS NOT NULL AND doc_url != ''";
    }

    // Filter by having video
    if (hasVideo === true) {
      whereClause += " AND video_url IS NOT NULL AND video_url != ''";
    }

    const query = `
      SELECT 
        changelog_id,
        DATE_FORMAT(date, '%Y-%m-%d') as date,
        title,
        description,
        video_url,
        doc_url,
        created_by,
        status,
        DATE_FORMAT(created_at, '%d-%m-%Y %h:%i %p') as created_at,
        DATE_FORMAT(updated_at, '%d-%m-%Y %h:%i %p') as updated_at
      FROM ims_changelog
      ${whereClause}
      ORDER BY date DESC, id DESC
    `;

    const result = await otherDB.query(query, {
      replacements,
      type: otherDB.QueryTypes.SELECT,
    });

    const formattedResult = result.map((item) => {
      let description = item.description;
      try {
        description = JSON.parse(item.description);
      } catch (e) {
        // Keep as string if not valid JSON
      }

      return {
        changelogId: item.changelog_id,
        date: item.date,
        title: item.title,
        description: description,
        videoUrl: item.video_url || null,
        docUrl: item.doc_url || null,
        createdBy: item.created_by,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
        status: item.status,
      };
    });

    return res.json({
      success: true,
      status: "success",
      data: formattedResult,
    });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// =============================================
// ADD NEW CHANGELOG
// =============================================
router.post("/add", [auth.isAuthorized], async (req, res) => {
  try {
    const { date, title, description, videoUrl, docUrl, createdBy } = req.body;

    const validation = new Validator(req.body, {
      date: "required",
      title: "required|string|max:255",
      description: "required",
      createdBy: "required",
    });

    if (validation.fails()) {
      return res.json({
        status: "error",
        success: false,
        message: "Required form fields are missing.",
      });
    }

    const admin = await invtDB.query(
      `SELECT login_status FROM admin_login WHERE CustID = :createdBy LIMIT 1`,
      {
        replacements: { createdBy },
        type: invtDB.QueryTypes.SELECT,
      }
    );

    if (!admin.length || admin[0].login_status != 1) {
      return res.json({
        status: "error",
        success: false,
        message: "CreatedBy admin is disabled or invalid.",
      });
    }

    const now = moment().format("YYYY-MM-DD");
   
    if (moment(date).isAfter(now)) {
      return res.json({
        status: "error",
        success: false,
        message: "Date cannot be in the future.",
      });
    }

    const urlsToCheck = [
      { url: videoUrl, msg: "Invalid video URL. The URL does not exist." },
      { url: docUrl, msg: "Invalid document URL. The URL does not exist." },
    ];

    for (const item of urlsToCheck) {
      if (item.url && !(await urlExists(item.url))) {
        return res.json({
          status: "error",
          success: false,
          message: item.msg,
        });
      }
    }

    const changelogId = generateChangelogId();

    const descriptionStr = Array.isArray(description)? JSON.stringify(description)  : JSON.stringify(
      description.split('\n').map(line => line.trim()).filter(line => line !== '') );

    await otherDB.query(
      `
      INSERT INTO ims_changelog 
      (changelog_id, date, title, description, video_url, doc_url, created_by, created_at)
      VALUES (:changelogId, :date, :title, :description, :videoUrl, :docUrl, :createdBy, :createdAt)
      `,
      {
        replacements: {
          changelogId,
          date: date,
          title,
          description: descriptionStr,
          videoUrl: videoUrl || null,
          docUrl: docUrl || null,
          createdBy,
          createdAt: moment(new Date()).format("YYYY-MM-DD HH:mm:ss"),
        },
        type: otherDB.QueryTypes.INSERT,
      }
    );

    return res.json({
      success: true,
      status: "success",
      message: "Changelog added successfully",
      data: {
        changelogId,
        date: date,
        title,
        status: "ON",
      },
    });
  } catch (err) {
    console.log(err, "--------------------------");
    return helper.errorResponse(res, err);
  }
});

// =============================================
// UPDATE CHANGELOG
// =============================================
router.put("/edit/:changelogId", [auth.isAuthorized], async (req, res) => {
  try {
    const { date, title, description, videoUrl, docUrl } = req.body;
    const { changelogId } = req.params;
    const { status } = req.query;

    const updatedAt = moment().tz("Asia/Kolkata").format("YYYY-MM-DD HH:mm:ss");
    const updatedBy = req.logedINUser;

    // --------------------------------------------------
    // 0️⃣ CHECK IF CHANGELOG EXISTS
    // --------------------------------------------------
    const changelog = await otherDB.query(
      `SELECT  status FROM ims_changelog WHERE changelog_id = :changelogId`,
      {
        replacements: { changelogId },
        type: otherDB.QueryTypes.SELECT,
      }
    );

    if (changelog.length === 0) {
      return res.json({
        success: false,
        message: "Changelog not found to alter",
      });
    }

    // --------------------------------------------------
    // 1️⃣ STATUS-ONLY UPDATE
    // --------------------------------------------------
    if (status !== undefined) {
      if (!["0", "1"].includes(status)) {
        return res.json({
          success: false,
          message: "Invalid status value. It should be 0 or 1.",
        });
      }

      const newStatus = status === "1" ? "ON" : "OFF";

      await otherDB.query(
        `
        UPDATE ims_changelog
        SET status = :status,
            updated_by = :updatedBy,
            updated_at = :updatedAt
        WHERE changelog_id = :changelogId
      `,
        {
          replacements: {
            changelogId,
            status: newStatus,
            updatedBy,
            updatedAt,
          },
          type: otherDB.QueryTypes.UPDATE,
        }
      );

      return res.json({
        success: true,
        message: "Status updated successfully",
        data: {
          changelogId,
          status: newStatus,
        },
      });
    }

    // --------------------------------------------------
    // 2️⃣ FULL UPDATE
    // --------------------------------------------------
    const validation = new Validator(req.body, {
      date: "required",
      title: "required|string|max:255",
      description: "required",
    });

    if (validation.fails()) {
      return res.json({
        success: false,
        message: "Validation failed",
        errors: validation.errors.all(),
      });
    }

    const formattedDate = moment(date, "DD-MM-YYYY").format("YYYY-MM-DD");
    const descriptionStr = Array.isArray(description)
      ? JSON.stringify(description)
      : description;

    await otherDB.query(
      `
      UPDATE ims_changelog
      SET date = :date,
          title = :title,
          description = :description,
          video_url = :videoUrl,
          doc_url = :docUrl,
          updated_by = :updatedBy,
          updated_at = :updatedAt
      WHERE changelog_id = :changelogId
    `,
      {
        replacements: {
          changelogId,
          date: formattedDate,
          title,
          description: descriptionStr,
          videoUrl: videoUrl || null,
          docUrl: docUrl || null,
          updatedBy,
          updatedAt,
        },
        type: otherDB.QueryTypes.UPDATE,
      }
    );

    // Return latest status (unchanged)
    const latestStatus = changelog[0].status;

    return res.json({
      success: true,
      message: "Changelog updated successfully",
      data: {
        changelogId,
        date: formattedDate,
        title,
        status: latestStatus,
      },
    });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

// =============================================
// DELETE CHANGELOG (Soft Delete)
// =============================================
router.delete("/delete/:changelogId", [auth.isAuthorized], async (req, res) => {
  try {
    const { changelogId } = req.params;

    const existing = await otherDB.query(
      `SELECT id, title FROM ims_changelog WHERE changelog_id = :changelogId`,
      {
        replacements: { changelogId },
        type: otherDB.QueryTypes.SELECT,
      }
    );

    if (existing.length === 0) {
      return res.json({
        success: false,
        message: "Changelog not found",
      });
    }

    await otherDB.query(
      `DELETE FROM ims_changelog WHERE changelog_id = :changelogId`,
      {
        replacements: { changelogId },
        type: otherDB.QueryTypes.DELETE,
      }
    );

    return res.json({
      success: true,
      message: `Changelog "${existing[0].title}" deleted permanently`,
    });
  } catch (err) {
    return helper.errorResponse(res, err);
  }
});

module.exports = router;
